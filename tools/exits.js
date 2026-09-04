// Brings up one Mysterium consumer node per inbox, each connected to its own
// residential exit, and writes the identities.json the browser reads.
//
//   node tools/exits.js up       start every exit in exits.config.json
//   node tools/exits.js watch    hold them connected (they drop; see watch())
//   node tools/exits.js status   what's connected, and the address each uses
//   node tools/exits.js down     stop them all
//
// Four things this encodes, each of which cost an evening to find out:
//
//  1. Docker is not an option. Docker Desktop presents SYMMETRIC NAT to the
//     container, and Mysterium is peer-to-peer — the UDP hole punch cannot
//     succeed, so every connect fails with "too few connections were built".
//     The same binary run natively on Windows reports `prcone` and works.
//
//  2. Never pin a provider. Most published proposals are stale: their node is
//     offline and connecting to it fails exactly like a network fault. Asking
//     the node to pick from a FILTER makes it walk candidates until one
//     answers, which is the only reliable way to get connected.
//
//  3. The proxy is HTTP, not SOCKS5, and its port floats per connection
//     unless you pin it — `connect_options.proxy_port` does that, which is
//     what makes a stable identities.json possible at all.
//
//  4. One node process holds one connection, so N exits means N processes.
const { spawn } = require('child_process');
const { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, openSync } = require('fs');
const { join, resolve } = require('path');

const ROOT = resolve(__dirname, '..');
const CONFIG = join(ROOT, 'exits.config.json');
const PIDFILE = join(ROOT, '.myst', 'pids.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function config() {
  if (!existsSync(CONFIG)) {
    console.error(`no ${CONFIG} — copy exits.config.example.json and edit it`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(CONFIG, 'utf8'));
}

/** Ports are derived from position so a restart reuses the same ones. */
const apiPort = (i) => 4060 + i;
const proxyPort = (i) => 1081 + i;

async function api(port, path, method = 'GET', body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* some endpoints answer with bare text */
  }
  return { ok: response.ok, status: response.status, body: parsed, text };
}

async function waitForApi(port, seconds = 60) {
  for (let i = 0; i < seconds; i++) {
    try {
      const health = await api(port, '/healthcheck');
      if (health.ok) return true;
    } catch {
      /* not listening yet */
    }
    await sleep(1000);
  }
  return false;
}

/**
 * Every node shares one payment identity, so the balance is topped up once
 * rather than N times. The keystore is just a file; each node needs its own
 * copy because each has its own data directory.
 */
function seedKeystore(dataDir, keystoreSrc) {
  const dest = join(dataDir, 'keystore');
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(keystoreSrc)) {
    copyFileSync(join(keystoreSrc, name), join(dest, name));
  }
}

function startNode(cfg, i) {
  const dataDir = join(ROOT, '.myst', `node${i}`);
  mkdirSync(dataDir, { recursive: true });
  seedKeystore(dataDir, cfg.keystore);

  const out = openSync(join(dataDir, 'node.log'), 'a');
  const err = openSync(join(dataDir, 'node.err'), 'a');
  const child = spawn(
    cfg.bin,
    [
      '--consumer',
      '--proxymode',
      `--data-dir=${dataDir}`,
      `--config-dir=${dataDir}`,
      `--tequilapi.port=${apiPort(i)}`,
      'daemon',
    ],
    { detached: true, stdio: ['ignore', out, err], windowsHide: true },
  );
  child.unref();
  return child.pid;
}

/**
 * Connect, retrying because a filter can still land on a node that stops
 * answering mid-handshake. Each attempt asks the node to choose again, so
 * retrying is genuinely a different provider rather than the same one twice.
 */
async function connect(port, identity, exit, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // A dropped session leaves a connection record behind, and the node then
    // refuses every PUT with "Connection already exists" — forever, because
    // nothing clears it. Status reads NotConnected the whole time, so the
    // node disagrees with itself. Tear it down first; harmless when there is
    // nothing to tear down.
    // The teardown is asynchronous: DELETE answers 202 immediately, but the
    // node rejects a new connection for a few seconds afterwards, still
    // saying "Connection already exists" while status reads NotConnected.
    // Four seconds is what it actually takes; one is not enough.
    await api(port, '/connection', 'DELETE').catch(() => {});
    await sleep(4000);

    const result = await api(port, '/connection', 'PUT', {
      consumer_id: identity,
      service_type: 'wireguard',
      filter: { country_code: exit.country, ip_type: exit.ipType ?? 'residential' },
      connect_options: { proxy_port: proxyPort(exit.index) },
    });
    if (result.ok) return result.body;
    const message = result.body?.error?.message ?? result.text.slice(0, 80);
    console.log(`  attempt ${attempt}/${attempts} failed: ${message}`);
    await sleep(2000);
  }
  return null;
}

async function up() {
  const cfg = config();
  if (!existsSync(cfg.bin)) {
    console.error(`myst binary not found at ${cfg.bin}`);
    console.error('Windows Defender flags it; the folder holding it needs an exclusion.');
    process.exit(2);
  }

  mkdirSync(join(ROOT, '.myst'), { recursive: true });
  const pids = [];
  const identities = {};

  for (let i = 0; i < cfg.exits.length; i++) {
    const exit = { ...cfg.exits[i], index: i };
    console.log(`\n[${exit.inbox}] ${exit.country} — api ${apiPort(i)}, proxy ${proxyPort(i)}`);

    const pid = startNode(cfg, i);
    pids.push({ pid, inbox: exit.inbox, apiPort: apiPort(i), proxyPort: proxyPort(i) });
    writeFileSync(PIDFILE, JSON.stringify(pids, null, 2));

    if (!(await waitForApi(apiPort(i)))) {
      console.log('  node never came up — see .myst/node' + i + '/node.err');
      continue;
    }

    await api(apiPort(i), `/identities/${cfg.identity}/unlock`, 'PUT', {
      passphrase: cfg.passphrase,
    });

    const connection = await connect(apiPort(i), cfg.identity, exit);
    if (!connection) {
      console.log('  could not connect — every candidate refused');
      continue;
    }

    const where = connection.proposal.location;
    console.log(`  connected: ${where.city}, ${where.country} — ${where.isp}`);

    identities[exit.inbox] = {
      proxy: `http://127.0.0.1:${proxyPort(i)}`,
      // The app talks to this node directly — to show whether the exit is up,
      // and to let the rail switch it on and off per inbox.
      apiPort: apiPort(i),
      country: exit.country,
      ...(exit.ua ? { ua: exit.ua, uaMetadata: exit.uaMetadata } : {}),
      ...(exit.acceptLanguage ? { acceptLanguage: exit.acceptLanguage } : {}),
      ...(exit.locale ? { locale: exit.locale } : {}),
      ...(exit.timezone ? { timezone: exit.timezone } : {}),
      ...(exit.viewport ? { viewport: exit.viewport } : {}),
      // Written from what the node actually got, not from what we asked for,
      // so test-identity.js is asserting against reality.
      expectCountry: where.country,
      expectAsn: `AS${where.asn}`,
    };
  }

  writeFileSync(cfg.identities, JSON.stringify(identities, null, 2));
  console.log(`\nwrote ${cfg.identities} with ${Object.keys(identities).length} exits`);
  console.log(`verify: PIGEON_IDENTITIES=${cfg.identities} npx electron tools/test-identity.js`);
}

/**
 * Keeps every exit connected.
 *
 * Exits are strangers' home connections and they drop — the node reports
 * `Failed to send p2p keepalive ping` and the session simply ends. Without
 * something watching, the proxy port stays open and answers every request
 * with ERR_TUNNEL_CONNECTION_FAILED, so the browser looks broken rather than
 * disconnected.
 *
 * Reconnecting asks the filter for a provider again, so an exit that comes
 * back is usually a DIFFERENT address in the same country. That is a rotation
 * the browser did not ask for: anything logged in through that inbox now has
 * its cookies on one address and its traffic on another. Which is why this
 * prints loudly rather than healing quietly — a test run spanning a reconnect
 * is a test run you should discard.
 */
async function watch() {
  const cfg = config();
  if (!existsSync(PIDFILE)) return console.log('nothing running — start with `up` first');
  const pids = JSON.parse(readFileSync(PIDFILE, 'utf8'));
  const every = Number(process.argv[3] ?? 30) * 1000;

  console.log(`watching ${pids.length} exits every ${every / 1000}s — ctrl-c to stop`);
  for (;;) {
    for (let i = 0; i < pids.length; i++) {
      const entry = pids[i];
      const exit = { ...cfg.exits[i], index: i };
      let connected = false;
      try {
        const current = await api(entry.apiPort, '/connection');
        connected = current.body?.status === 'Connected';
      } catch {
        connected = false;
      }
      if (connected) continue;

      const stamp = new Date().toISOString().slice(11, 19);
      console.log(`${stamp} ${entry.inbox} dropped — reconnecting`);
      let reconnected = await connect(entry.apiPort, cfg.identity, exit);

      // A node that keeps answering "Connection already exists" while
      // reporting NotConnected has wedged its own state machine, and no
      // amount of DELETE/PUT gets it back. Restarting the process does,
      // every time — so stop being clever after one failed round.
      if (!reconnected) {
        console.log(`${stamp} ${entry.inbox} wedged — restarting its node`);
        try {
          process.kill(entry.pid);
        } catch {
          /* already gone, which is equally fine */
        }
        await sleep(2000);
        entry.pid = startNode(cfg, i);
        writeFileSync(PIDFILE, JSON.stringify(pids, null, 2));
        if (await waitForApi(entry.apiPort)) {
          await api(entry.apiPort, `/identities/${cfg.identity}/unlock`, 'PUT', {
            passphrase: cfg.passphrase,
          });
          reconnected = await connect(entry.apiPort, cfg.identity, exit);
        }
      }

      if (reconnected) {
        const where = reconnected.proposal.location;
        console.log(`${stamp} ${entry.inbox} back on ${where.city}, ${where.country} (${where.isp})`);
        console.log(`${stamp} NOTE new address — discard any run in progress for this inbox`);
      } else {
        console.log(`${stamp} ${entry.inbox} still down; will retry next pass`);
      }
    }
    await sleep(every);
  }
}

async function status() {
  if (!existsSync(PIDFILE)) return console.log('nothing running');
  const pids = JSON.parse(readFileSync(PIDFILE, 'utf8'));
  for (const entry of pids) {
    let line = `${entry.inbox}  proxy ${entry.proxyPort}  `;
    try {
      const connection = await api(entry.apiPort, '/connection');
      const where = connection.body?.proposal?.location;
      line += connection.body?.status === 'Connected'
        ? `${where.city}, ${where.country} (${where.isp})`
        : (connection.body?.status ?? 'unknown');
    } catch {
      line += 'node not responding';
    }
    console.log(line);
  }
}

function down() {
  if (!existsSync(PIDFILE)) return console.log('nothing to stop');
  const pids = JSON.parse(readFileSync(PIDFILE, 'utf8'));
  for (const entry of pids) {
    try {
      process.kill(entry.pid);
      console.log(`stopped ${entry.inbox} (pid ${entry.pid})`);
    } catch {
      console.log(`${entry.inbox} (pid ${entry.pid}) was already gone`);
    }
  }
  writeFileSync(PIDFILE, '[]');
}

const command = process.argv[2] ?? 'status';
if (command === 'up') void up();
else if (command === 'down') down();
else if (command === 'status') void status();
else if (command === 'watch') void watch();
else {
  console.log('usage: node tools/exits.js [up|watch [seconds]|status|down]');
  process.exit(2);
}
