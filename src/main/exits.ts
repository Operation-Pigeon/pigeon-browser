import { app, type BrowserWindow } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  copyFileSync,
  openSync,
  rmSync,
} from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ExitCountry, ExitState, ExitStatus, MystSetup, MystStage } from '../shared/types';
import {
  getExitPrefs,
  getMystBinary,
  getMystPassphrase,
  getMystUnlinked,
  setExitPref,
  setMystBinary,
  setMystUnlinked,
} from './settings';
import { setManagedProxy } from './identities';

/**
 * Per-inbox network exits, owned end to end by the app.
 *
 * Each inbox that wants one gets its own Mysterium consumer node: a separate
 * process, holding a connection to a residential peer somewhere, offering it
 * as an HTTP proxy on a private localhost port. The browser session for that
 * inbox is pointed at that port and nothing else changes.
 *
 * One node per inbox rather than one node with many connections, because a
 * node holds exactly one connection. A control node with no connection of its
 * own handles the account — identity, registration, balance — so the settings
 * panel works before any inbox has an exit.
 *
 * Three properties this is built around, each learned the hard way:
 *
 *  - Exits drop constantly. They are strangers' home connections and a
 *    session lasting minutes is normal, so supervision is the feature, not a
 *    refinement of it.
 *  - A node that loses its peer wedges: it answers every reconnect with
 *    "Connection already exists" while reporting NotConnected, disagreeing
 *    with itself, and only a process restart clears it.
 *  - Published proposals are mostly stale. Connecting to a named provider
 *    fails exactly like a network fault, so connections are always made by
 *    FILTER and the node walks candidates until one answers.
 */

const CONTROL_PORT = 4059;
const FIRST_EXIT_PORT = 4060;
const FIRST_PROXY_PORT = 1081;
const POLL_MS = 8000;
/** GitHub publishes one Windows build; the launcher understands only that. */
const RELEASE = 'https://api.github.com/repos/mysteriumnetwork/node/releases/latest';

interface ExitNode {
  profile: string;
  country: string;
  apiPort: number;
  proxyPort: number;
  child: ChildProcess | null;
  state: ExitState;
  /** Consecutive passes where the node did not answer at all. */
  strikes: number;
  /** Consecutive passes where a reconnect was attempted and failed. */
  failures: number;
  /**
   * Torn down. A supervise pass can already be running when a tunnel is
   * switched off or the identity is unlinked, and that pass holds its own
   * reference to this object: without a tombstone it carries on, fails to
   * connect (there is no identity any more), counts failures, and respawns
   * the very process that was just killed. The tunnel then sits restarting
   * forever with nothing left that owns it.
   */
  removed: boolean;
  /**
   * Work already in flight for this node.
   *
   * Connecting can take a minute or more while the node walks candidate
   * peers, and the health loop ticks every few seconds. Without this the
   * passes overlap: each one tears down the connection the last one just
   * established, and a restart spawns a second process onto a port the first
   * is still holding. The node then reports "port 4060 seems to be taken"
   * and "connection already exists" forever, while an exit that is in fact
   * connected shows as down.
   */
  busy: boolean;
}

let win: BrowserWindow | null = null;
let control: ChildProcess | null = null;
let identity: string | null = null;
let setupState: MystSetup = {
  stage: 'no-binary',
  binaryPath: null,
  identity: null,
  channelAddress: null,
  balance: 0,
  pricePerGib: null,
};
const nodes = new Map<string, ExitNode>();
let timer: ReturnType<typeof setInterval> | null = null;

const dataRoot = (): string => join(app.getPath('userData'), 'myst');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function ask(
  port: number,
  path: string,
  method = 'GET',
  body?: unknown,
  timeoutMs = 8000,
): Promise<{ ok: boolean; body: unknown }> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      // A wedged node can hold a socket open indefinitely, and the health
      // loop must not stall behind one and freeze every other inbox.
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    return { ok: response.ok, body: text ? JSON.parse(text) : null };
  } catch {
    return { ok: false, body: null };
  }
}

/**
 * The connection endpoint for one exit.
 *
 * In proxymode a node can hold several connections at once and addresses each
 * by its proxy port, passed as `id`. Plain `/connection` refers to the
 * unnamed default — which, when we create ours with `connect_options.
 * proxy_port`, is a different connection that is genuinely NotConnected.
 *
 * Getting this wrong is silent and vicious: the connect succeeds, the session
 * runs, and every status read says NotConnected. The supervisor then tears
 * down a healthy exit, re-issues the connect, is told "connection already
 * exists" (it does exist), counts a failure, and restarts the node forever.
 * The `?id=` is the whole difference between working and that loop.
 */
const connPath = (node: ExitNode): string => `/connection?id=${node.proxyPort}`;

/**
 * Kill a node and wait for it to actually be gone.
 *
 * `kill()` returns immediately while the process is still holding its
 * TequilAPI port, so spawning the replacement straight away loses the port to
 * the corpse: the new node dies with "the port seems to be taken" and the
 * tunnel never comes back.
 */
async function killAndWait(child: ChildProcess | null, seconds = 10): Promise<void> {
  if (!child || child.exitCode !== null || child.killed) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  try {
    child.kill();
  } catch {
    return;
  }
  await Promise.race([exited, sleep(seconds * 1000)]);
}

async function waitForApi(port: number, seconds = 45): Promise<boolean> {
  for (let i = 0; i < seconds; i++) {
    const health = await ask(port, '/healthcheck', 'GET', undefined, 2000);
    if (health.ok) return true;
    await sleep(1000);
  }
  return false;
}

function emitExits(): void {
  if (!win || win.isDestroyed()) return;
  const payload: Record<string, ExitState> = {};
  for (const [profile, node] of nodes) payload[profile] = node.state;
  win.webContents.send('exits:state', payload);
}

function emitSetup(): void {
  if (win && !win.isDestroyed()) win.webContents.send('exits:setup', setupState);
}

/** Ports are handed out from the lowest free slot so restarts stay tidy. */
function allocatePorts(): { apiPort: number; proxyPort: number } {
  const used = new Set([...nodes.values()].map((n) => n.apiPort));
  let offset = 0;
  while (used.has(FIRST_EXIT_PORT + offset)) offset++;
  return { apiPort: FIRST_EXIT_PORT + offset, proxyPort: FIRST_PROXY_PORT + offset };
}

function spawnNode(dir: string, apiPort: number): ChildProcess {
  const binary = getMystBinary();
  if (!binary) throw new Error('no myst binary configured');
  mkdirSync(dir, { recursive: true });

  // Node output goes to a file rather than being discarded. A node that
  // refuses to start says why on stderr and nowhere else, and without this
  // the only symptom is an inbox that never connects — which is
  // indistinguishable from the network simply being unlucky.
  const log = openSync(join(dir, 'node.log'), 'a');
  const child = spawn(
    binary,
    [
      '--consumer',
      '--proxymode',
      `--data-dir=${dir}`,
      `--config-dir=${dir}`,
      `--tequilapi.port=${apiPort}`,
      'daemon',
    ],
    { detached: false, stdio: ['ignore', log, log], windowsHide: true },
  );
  child.on('exit', (code) => console.log(`[exits] node on ${apiPort} exited with ${code}`));
  child.on('error', (err) => console.error(`[exits] node on ${apiPort} failed to spawn:`, err));
  return child;
}

/**
 * Every exit node shares the control node's payment identity, so the user
 * tops up once instead of once per inbox.
 *
 * The cost is real: promise amounts are global to a payment channel, so
 * several nodes issuing promises at the same moment race, and the loser's
 * session dies. That shows up as extra churn, which supervision already
 * handles — and it is a far better trade than asking someone to fund ten
 * separate channels by hand.
 */
function copyKeystore(into: string): void {
  const from = join(dataRoot(), 'control', 'keystore');
  if (!existsSync(from)) return;
  const to = join(into, 'keystore');
  // Mirror, don't accumulate. Re-importing an identity writes a new file for
  // the same address, and copying on top leaves the exit node holding two
  // keystores for one address encrypted under different passphrases — it
  // then picks one, fails to unlock it, and never connects, with nothing in
  // the logs to say why.
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) copyFileSync(join(from, name), join(to, name));
}

// ---------------------------------------------------------------------------
// Account: binary, identity, registration, balance
// ---------------------------------------------------------------------------

async function refreshSetup(): Promise<void> {
  const binary = getMystBinary();
  setupState.binaryPath = binary;
  if (!binary || !existsSync(binary)) {
    setupState = { ...setupState, stage: 'no-binary', binaryPath: null };
    return emitSetup();
  }

  if (!control) {
    setupState.stage = 'starting';
    emitSetup();
    return;
  }

  const list = await ask(CONTROL_PORT, '/identities');
  const found = (list.body as { identities?: Array<{ id: string }> })?.identities?.[0]?.id ?? null;

  // Unlinked means unlinked. The keystore is still on disk on purpose, so
  // without this check the control node finds it again seconds later and the
  // account relinks itself: tunnels tear down and come straight back, which
  // reads as an app stuck restarting nodes.
  if (getMystUnlinked()) {
    identity = null;
    setupState = {
      ...setupState,
      stage: 'no-identity',
      identity: null,
      channelAddress: null,
      balance: 0,
      relinkable: found,
    };
    return emitSetup();
  }

  if (!found) {
    setupState = { ...setupState, stage: 'no-identity', identity: null, relinkable: null };
    return emitSetup();
  }
  identity = found;

  const detail = await ask(CONTROL_PORT, `/identities/${found}`);
  const info = detail.body as
    | { registration_status?: string; channel_address?: string; balance?: number }
    | null;

  const stage: MystStage =
    info?.registration_status === 'Registered'
      ? (info.balance ?? 0) > 0
        ? 'ready'
        : 'unfunded'
      : info?.registration_status === 'InProgress'
        ? 'registering'
        : 'unregistered';

  const price = await ask(CONTROL_PORT, '/prices/current');
  const perGib = (price.body as { price_per_gib?: number } | null)?.price_per_gib ?? null;

  const wasReady = setupState.stage === 'ready';
  setupState = {
    stage,
    binaryPath: binary,
    identity: found,
    channelAddress: info?.channel_address ?? null,
    // wei -> MYST. Displayed, never used for arithmetic that matters.
    balance: (info?.balance ?? 0) / 1e18,
    pricePerGib: perGib ? perGib / 1e18 : null,
    relinkable: null,
  };
  emitSetup();

  // Becoming usable is the moment to put the saved tunnels back: after an
  // identity is linked, or when a top-up finally lands. Without this they
  // only ever return on a restart, which makes unlink look like it forgot
  // where every inbox was supposed to be.
  if (stage === 'ready' && !wasReady && nodes.size === 0) void restoreTunnels();
}

/** Start every tunnel the user has asked for, in parallel. */
async function restoreTunnels(): Promise<void> {
  const prefs = Object.entries(getExitPrefs());
  if (!prefs.length) return;
  console.log(`[exits] restoring ${prefs.length} tunnel(s)`);
  await Promise.all(prefs.map(([profile, pref]) => exits.enable(profile, pref.country)));
}

async function startControl(): Promise<void> {
  const binary = getMystBinary();
  if (!binary || !existsSync(binary) || control) {
    console.log(
      `[exits] control not started, binary=${binary ?? 'unset'} exists=${binary ? existsSync(binary) : false} running=${!!control}`,
    );
    return;
  }
  console.log(`[exits] starting control node from ${binary}`);
  const dir = join(dataRoot(), 'control');
  const child = spawnNode(dir, CONTROL_PORT);
  control = child;
  // Compare identity before clearing. A dying process emits 'exit' after its
  // replacement has already been assigned, and an unguarded handler nulls the
  // reference to a node that is alive and well: refreshSetup then sees no
  // control node and reports "starting" for ever.
  child.on('exit', () => {
    if (control === child) control = null;
  });
  setupState.stage = 'starting';
  emitSetup();
  if (await waitForApi(CONTROL_PORT)) {
    // Learn which identity the keystore holds BEFORE trying to unlock it.
    // The other order silently skips the unlock on every launch, because
    // `identity` is only populated by the very call being skipped.
    await refreshSetup();
    if (identity) {
      await ask(CONTROL_PORT, `/identities/${identity}/unlock`, 'PUT', {
        passphrase: getMystPassphrase(),
      });
      console.log(`[exits] unlocked ${identity}`);
      // The node reports a cached balance, and the cache starts empty — so
      // without this the panel says 0 MYST on every launch until something
      // else happens to force a fetch, which reads as "your money is gone".
      await ask(CONTROL_PORT, `/identities/${identity}/balance/refresh`, 'PUT');
      await refreshSetup();
    }
  }
}

// ---------------------------------------------------------------------------
// Exits
// ---------------------------------------------------------------------------

function setState(node: ExitNode, status: ExitStatus, extra: Partial<ExitState> = {}): void {
  const before = node.state;
  node.state = { profile: node.profile, status, wanted: node.country, ...extra };
  if (before.status !== status || before.city !== node.state.city) emitExits();
}

/**
 * Tears down whatever the node is holding and waits until it agrees.
 *
 * DELETE answers immediately and finishes later. A fixed sleep guesses at how
 * much later, and when the guess is short the next connect is refused with
 * "connection already exists" — which reads as a broken exit when nothing is
 * broken. Ask the node instead of guessing.
 */
async function ensureDisconnected(node: ExitNode): Promise<void> {
  await ask(node.apiPort, connPath(node), 'DELETE');
  for (let i = 0; i < 20; i++) {
    const state = await ask(node.apiPort, connPath(node), 'GET', undefined, 5000);
    if (state.ok && (state.body as { status?: string }).status === 'NotConnected') return;
    await sleep(1000);
  }
}

/**
 * Poll /connection until it reports Connected, or until it is clear nothing
 * is happening.
 *
 * The subtlety that cost several rounds of debugging: a node that has just
 * been told to connect stays at NotConnected for a moment before flipping to
 * Connecting. Treating the first NotConnected as "it failed" declares defeat
 * roughly one second into a thirteen-second handshake — and the connect then
 * SUCCEEDS in the background, so the node ends up genuinely connected while
 * this reports failure, and the caller tears down a working session.
 *
 * So NotConnected only counts once it has persisted; anything else is
 * progress and resets the count.
 */
const IDLE_BEFORE_GIVING_UP = 12;

async function waitConnected(node: ExitNode, seconds: number): Promise<boolean> {
  let idle = 0;
  for (let i = 0; i < seconds; i++) {
    const state = await ask(node.apiPort, connPath(node), 'GET', undefined, 5000);
    const status = (state.body as { status?: string })?.status;

    if (status === 'Connected') {
      const where = (state.body as { proposal?: { location?: Record<string, string> } }).proposal
        ?.location;
      setState(node, 'connected', {
        country: where?.country,
        city: where?.city,
        isp: where?.isp,
      });
      node.strikes = 0;
      node.failures = 0;
      return true;
    }

    if (status === 'NotConnected') {
      idle += 1;
      if (idle >= IDLE_BEFORE_GIVING_UP) return false;
    } else {
      idle = 0; // Connecting, Disconnecting, or no answer — still working
    }
    await sleep(1000);
  }
  return false;
}

/**
 * Bring a node to Connected, working WITH its own state machine rather than
 * against it.
 *
 * The node persists its last session to disk and resumes it on start, so a
 * fresh process is often already Connecting when we first look. Blindly
 * DELETE-ing and PUT-ing into that resume is what produced the "connection
 * already exists" thrash: we were fighting a connect that was already
 * happening. So: adopt what's there if it's good, wait if it's in progress,
 * and only issue a fresh connect when the node truly has nothing.
 */
async function connectNode(node: ExitNode, why = 'unknown'): Promise<boolean> {
  if (!identity) return false;

  const current = await ask(node.apiPort, connPath(node), 'GET', undefined, 8000);
  const status = (current.body as { status?: string })?.status;
  const where = (current.body as { proposal?: { location?: Record<string, string> } })?.proposal
    ?.location;

  // Already where we want to be — adopt it, don't tear it down.
  if (status === 'Connected' && (!node.country || where?.country === node.country)) {
    setState(node, 'connected', { country: where?.country, city: where?.city, isp: where?.isp });
    node.strikes = 0;
    node.failures = 0;
    return true;
  }

  // A resume or a prior attempt is in flight — a P2P connect is ~13s, so give
  // it real time before deciding it failed.
  if (status === 'Connecting') {
    console.log(`[exits] ${node.profile}: adopting in-flight connect`);
    if (await waitConnected(node, 30)) return true;
  }

  console.log(`[exits] ${node.profile}: connect (${why})`);
  await ensureDisconnected(node);

  const result = await ask(
    node.apiPort,
    '/connection',
    'PUT',
    {
      consumer_id: identity,
      service_type: 'wireguard',
      filter: { country_code: node.country, ip_type: 'residential' },
      connect_options: { proxy_port: node.proxyPort },
    },
    120000,
  );

  // "already exists" is not failure — it means a connect is underway, which
  // is exactly what we asked for. Either way, trust the status, not the
  // immediate reply.
  if (await waitConnected(node, 90)) return true;
  return !!(result.body as { proposal?: unknown })?.proposal && result.ok;
}

/** Kill and respawn. The only thing that reliably clears a wedged node. */
async function restartNode(node: ExitNode): Promise<void> {
  if (node.removed) return;
  const dir = join(dataRoot(), `exit-${node.apiPort}`);
  await killAndWait(node.child);
  copyKeystore(dir);
  node.child = spawnNode(dir, node.apiPort);
  if (!(await waitForApi(node.apiPort))) return;
  await ask(node.apiPort, `/identities/${identity}/unlock`, 'PUT', {
    passphrase: getMystPassphrase(),
  });
}

async function superviseOne(node: ExitNode): Promise<void> {
  if (node.removed || node.state.status === 'off' || node.busy) return;
  // Nothing to connect with. Without this the supervisor treats an unlinked
  // account as a broken tunnel and restarts nodes in a loop.
  if (!identity) return;
  node.busy = true;
  try {
    await superviseNow(node);
  } finally {
    node.busy = false;
  }
}

async function superviseNow(node: ExitNode): Promise<void> {
  // Generous, because the answer is only useful if it is the node's actual
  // opinion. A timeout here used to read as "disconnected" and trigger a
  // teardown of a session that was merely slow to answer — the health check
  // destroying the thing it was watching.
  const current = await ask(node.apiPort, connPath(node), 'GET', undefined, 20000);

  if (!current.ok) {
    // No answer is not the same as "not connected". The node may be busy or
    // starting; only a run of silences means it is genuinely gone.
    node.strikes += 1;
    if (node.strikes >= 3) {
      console.log(`[exits] ${node.profile}: node unresponsive, restarting`);
      await restartNode(node);
      node.strikes = 0;
      if (!(await connectNode(node, "restart-after-silence"))) setState(node, "down", { detail: "node unresponsive" });
    }
    return;
  }

  node.strikes = 0;
  const status = (current.body as { status?: string }).status;
  const where = (current.body as { proposal?: { location?: Record<string, string> } }).proposal
    ?.location;

  if (status === 'Connected') {
    if (node.state.status !== 'connected') {
      setState(node, 'connected', {
        country: where?.country,
        city: where?.city,
        isp: where?.isp,
      });
    }
    return;
  }

  // The node is already working on it. Interrupting to "help" is what caused
  // the cycling: every pass cancelled the attempt the previous one started.
  if (status === 'Connecting' || status === 'Disconnecting') {
    setState(node, 'connecting');
    return;
  }

  // Only NotConnected — the node's own word for it — justifies a reconnect,
  // and only ONE attempt per pass. Retrying in a tight loop inside a single
  // pass, then restarting the process when those fail, is how a healthy exit
  // got killed: the failures were transient and the cure was destructive.
  setState(node, 'connecting');
  if (await connectNode(node, "notconnected-pass")) {
    node.failures = 0;
    return;
  }

  node.failures += 1;
  setState(node, 'connecting', { detail: `looking for an exit (${node.failures})` });

  // Restarting the process is the last resort, not the second. Several
  // consecutive passes have to fail first — by which point the node really
  // has wedged rather than merely lost a peer.
  if (node.failures >= 4) {
    console.log(`[exits] ${node.profile}: ${node.failures} failed passes, restarting node`);
    await restartNode(node);
    node.failures = 0;
    if (!(await connectNode(node, "restart-after-fails"))) setState(node, "down", { detail: "no exit available" });
  }
}

async function supervise(): Promise<void> {
  await Promise.all([...nodes.values()].map((node) => superviseOne(node)));
}

/**
 * Stops a tunnel's node without touching the saved preference.
 *
 * Separate from disable() on purpose: switching a tunnel off is a choice to
 * remember, whereas unlinking an account is a reason the tunnels cannot run
 * right now. Clearing preferences on unlink would silently lose every country
 * choice the moment somebody re-linked the same identity.
 */
async function stopTunnel(profile: string): Promise<void> {
  const node = nodes.get(profile);
  if (!node) return;
  node.removed = true;
  nodes.delete(profile);
  await ask(node.apiPort, connPath(node), 'DELETE', undefined, 4000);
  node.child?.kill();
  node.child = null;
  await setManagedProxy(profile, null);
}

export const exits = {
  async init(window: BrowserWindow): Promise<void> {
    win = window;
    await startControl();
    // Inboxes that had a tunnel last run get one again, without being asked.
    // In parallel: each is a spawn plus a 10-15s P2P connect, and running
    // them one after another meant the second inbox did not begin until the
    // first was fully up. Each node holds its own `busy` flag, so nothing
    // here needs the others to finish.
    await restoreTunnels();
    timer = setInterval(() => void supervise(), POLL_MS);
  },

  stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
    for (const node of nodes.values()) node.child?.kill();
    control?.kill();
  },

  setup(): MystSetup {
    return setupState;
  },

  state(): Record<string, ExitState> {
    const payload: Record<string, ExitState> = {};
    for (const [profile, node] of nodes) payload[profile] = node.state;
    return payload;
  },

  /**
   * Downloads the node binary into userData.
   *
   * Windows Defender flags it — a heuristic detection on a Go networking
   * binary, and the same one that fires on Mysterium's own launcher. The
   * download simply vanishes when that happens, so a missing file after a
   * successful fetch is reported as what it almost certainly is rather than
   * as a mysterious IO error.
   */
  async install(): Promise<{ ok: boolean; error?: string }> {
    if (process.platform !== 'win32') {
      return { ok: false, error: 'automatic install is Windows-only; set the path by hand' };
    }
    try {
      const release = (await (await fetch(RELEASE)).json()) as {
        assets?: Array<{ name: string; browser_download_url: string }>;
      };
      const asset = release.assets?.find((a) => a.name === 'myst_windows_amd64.zip');
      if (!asset) return { ok: false, error: 'no Windows build in the latest release' };

      const dir = join(dataRoot(), 'bin');
      mkdirSync(dir, { recursive: true });
      const zip = join(dir, 'myst.zip');
      const response = await fetch(asset.browser_download_url);
      if (!response.body) return { ok: false, error: 'download failed' };
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(zip));

      await new Promise<void>((done, fail) => {
        const unzip = spawn(
          'powershell',
          ['-NoProfile', '-Command', `Expand-Archive -Path "${zip}" -DestinationPath "${dir}" -Force`],
          { windowsHide: true },
        );
        unzip.on('exit', (code) => (code === 0 ? done() : fail(new Error('extract failed'))));
        unzip.on('error', fail);
      });

      const binary = join(dir, 'myst.exe');
      if (!existsSync(binary)) {
        return {
          ok: false,
          error:
            'Extracted but the binary is missing, Windows Defender almost certainly quarantined it. ' +
            `Add an exclusion for ${dir} and try again.`,
        };
      }
      rmSync(zip, { force: true });
      setMystBinary(binary);
      await startControl();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error).slice(0, 200) };
    }
  },

  async useBinary(path: string): Promise<void> {
    setMystBinary(path);
    await startControl();
  },

  /** Take the unlinked identity back into use. */
  async relink(): Promise<void> {
    setMystUnlinked(false);
    await refreshSetup();
  },

  async createIdentity(): Promise<void> {
    setMystUnlinked(false);
    const created = await ask(CONTROL_PORT, '/identities', 'POST', {
      passphrase: getMystPassphrase(),
    });
    const id = (created.body as { id?: string })?.id;
    if (!id) return;
    identity = id;
    await ask(CONTROL_PORT, `/identities/${id}/unlock`, 'PUT', {
      passphrase: getMystPassphrase(),
    });
    await refreshSetup();
  },

  /**
   * Adopts an identity that already exists — one made on another machine, or
   * by the CLI — so its balance comes with it.
   *
   * The keystore is re-encrypted with this app's own passphrase on the way
   * in, which is the whole reason a copied file is not enough: the node can
   * see a foreign keystore but cannot unlock it, and an identity it cannot
   * unlock is indistinguishable from no identity at all.
   */
  async importIdentity(
    keystorePath: string,
    passphrase: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      setMystUnlinked(false);
      const data = readFileSync(keystorePath, 'utf8');
      const result = await ask(CONTROL_PORT, '/identities-import', 'POST', {
        data: Buffer.from(data).toString('base64'),
        current_passphrase: passphrase,
        new_passphrase: getMystPassphrase(),
        set_default: true,
      });
      if (!result.ok) {
        return { ok: false, error: 'the node refused it, wrong passphrase, or not a keystore' };
      }
      await refreshSetup();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error).slice(0, 160) };
    }
  },

  /**
   * Registration costs about 0.1 MYST, taken from the channel — so it cannot
   * complete before the first top-up. Asking early is still right: the
   * transactor queues it and it settles the moment funds arrive.
   */
  async register(): Promise<void> {
    if (!identity) return;
    await ask(CONTROL_PORT, `/identities/${identity}/register`, 'POST', {});
    await refreshSetup();
  },

  async refresh(): Promise<MystSetup> {
    if (identity) await ask(CONTROL_PORT, `/identities/${identity}/balance/refresh`, 'PUT');
    await refreshSetup();
    return setupState;
  },

  /** Countries with residential exits right now, for the rail's picker. */
  async countries(): Promise<ExitCountry[]> {
    const listed = await ask(CONTROL_PORT, '/proposals/countries?ip_type=residential');
    const counts = (listed.body ?? {}) as Record<string, number>;
    return Object.entries(counts)
      .map(([code, count]) => ({ code, count }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count);
  },

  async enable(profile: string, country: string): Promise<void> {
    setExitPref(profile, country);

    const existing = nodes.get(profile);
    if (existing) {
      if (existing.busy) return; // a connect is already running; let it finish
      existing.busy = true;
      try {
        existing.country = country;
        setState(existing, 'connecting');
        await connectNode(existing, "enable-existing");
      } finally {
        existing.busy = false;
      }
      return;
    }

    const { apiPort, proxyPort } = allocatePorts();
    const node: ExitNode = {
      profile,
      country,
      apiPort,
      proxyPort,
      child: null,
      state: { profile, status: 'connecting', wanted: country },
      strikes: 0,
      failures: 0,
      removed: false,
      // Held for the whole of the first connect, so the health loop cannot
      // start tearing it down before it has finished coming up.
      busy: true,
    };
    nodes.set(profile, node);
    emitExits();

    // Point the inbox's session at this exit before its node is even up. The
    // port is closed until then, so pages fail rather than load — which is
    // the right way round: a tab that opens during startup must not slip out
    // directly and announce this machine's own address.
    await setManagedProxy(profile, `http://127.0.0.1:${proxyPort}`);

    try {
      const dir = join(dataRoot(), `exit-${apiPort}`);
      console.log(
        `[exits] ${profile}: starting node in ${dir} on api ${apiPort}/proxy ${proxyPort}`,
      );
      copyKeystore(dir);
      node.child = spawnNode(dir, apiPort);
      if (!(await waitForApi(apiPort))) {
        console.error(`[exits] ${profile}: api ${apiPort} never answered, see ${dir}\\node.log`);
        setState(node, 'down', { detail: 'node did not start' });
        return;
      }
      console.log(`[exits] ${profile}: node up, connecting to ${country}`);
      await ask(apiPort, `/identities/${identity}/unlock`, 'PUT', {
        passphrase: getMystPassphrase(),
      });
      if (!(await connectNode(node, "enable-new"))) setState(node, "down", { detail: "looking for an exit" });
    } finally {
      node.busy = false;
    }
  },

  /**
   * Turns a whole group on, in parallel.
   *
   * Sequentially would mean the last inbox in a group of ten waits through
   * nine node startups and nine P2P handshakes before its own begins, which
   * is minutes. Each node holds its own busy flag, so nothing here needs the
   * others to finish.
   */
  async enableMany(profiles: string[], country: string): Promise<void> {
    await Promise.all(profiles.map((profile) => this.enable(profile, country)));
  },

  /** Turns a whole group off. */
  async disableMany(profiles: string[]): Promise<void> {
    await Promise.all(profiles.map((profile) => this.disable(profile)));
  },

  /**
   * Switching an inbox off returns it to browsing directly.
   *
   * Deliberate and unintentional are treated differently on purpose. A drop
   * leaves the session pointed at a dead port so pages hold rather than
   * leaking this machine's address — but someone who clicks off is asking for
   * the proxy to stop, and a switch that turns browsing off entirely would be
   * a puzzle rather than a feature. The rail says which state an inbox is in.
   */
  async disable(profile: string): Promise<void> {
    setExitPref(profile, null);
    const node = nodes.get(profile);
    if (!node) return;
    setState(node, 'off');
    await stopTunnel(profile);
    emitExits();
  },

  /**
   * Unlinks the payment identity from this machine.
   *
   * Stops every exit first, so no inbox is left pointed at a proxy that is
   * about to disappear, and puts each one back to browsing directly.
   *
   * `wipe` deletes the keystore. That is the identity — not a copy of it, and
   * not something a passphrase can regenerate — so anything left in its
   * channel becomes unreachable. Off by default for that reason: unlinking
   * should be the reversible thing, and forgetting should take a second,
   * deliberate act.
   */
  async signOut(wipe: boolean): Promise<void> {
    // Supervision off first. A pass that starts mid-teardown races the
    // shutdown and respawns nodes behind it.
    if (timer) clearInterval(timer);
    timer = null;

    // stopTunnel, not disable: the tunnels stop because the account is gone,
    // which is not the user saying they want them off. Re-link and they come
    // back where they were.
    for (const profile of [...nodes.keys()]) await stopTunnel(profile);
    emitExits();

    await killAndWait(control);
    control = null;
    identity = null;

    if (wipe) {
      rmSync(join(dataRoot(), 'control', 'keystore'), { recursive: true, force: true });
      setMystUnlinked(false); // nothing left to re-adopt
    } else {
      setMystUnlinked(true);
    }

    setupState = {
      stage: 'no-identity',
      binaryPath: getMystBinary(),
      identity: null,
      channelAddress: null,
      balance: 0,
      pricePerGib: null,
    };
    emitSetup();
    // Back up so the panel can offer to create or import the next one.
    await startControl();
    timer = setInterval(() => void supervise(), POLL_MS);
  },

  /** The proxy an inbox should use, if it has one running. */
  proxyFor(profile: string): string | null {
    const node = nodes.get(profile);
    return node && node.state.status !== 'off' ? `http://127.0.0.1:${node.proxyPort}` : null;
  },

  usable(profile: string): boolean {
    const node = nodes.get(profile);
    if (!node) return true; // no exit wanted — direct browsing is correct
    return node.state.status === 'connected';
  },

  waiting(profile: string): boolean {
    const node = nodes.get(profile);
    return !!node && (node.state.status === 'connecting' || node.state.status === 'down');
  },
};
