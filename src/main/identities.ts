import { app, session, type WebContents } from 'electron';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

/**
 * Per-inbox network identity: which exit the traffic leaves through, and who
 * the browser claims to be once it gets there.
 *
 * Partitions already keep cookies, storage and cache apart. What they cannot
 * separate is the address every session shares, and a browser presenting ten
 * identities from one address has told the site they are one person. This is
 * the other half of that isolation.
 *
 * Config is a file rather than a setting, because a test run wants a fixture
 * and the real thing wants credentials that never reach a renderer:
 *   PIGEON_IDENTITIES=/path/to/identities.json
 */
export interface Identity {
  /**
   * Chromium proxy rules, e.g. "http://gate.provider.com:8000".
   *
   * Prefer http:// over socks5:// whenever the proxy wants credentials —
   * Chromium's SOCKS5 client implements no authentication method at all, so
   * `proxyAuth` is silently useless against a socks5:// endpoint. A local
   * unauthenticated relay holding the credentials is the way round that.
   */
  proxy?: string;
  proxyAuth?: { username: string; password: string };
  /**
   * Rotating-pool credentials: one gateway endpoint, and the username is
   * what selects the exit. `{session}` is substituted, and changes on rotate.
   */
  rotation?: { usernameTemplate: string; password: string };
  ua?: string;
  /**
   * Client-hint metadata, which must agree with `ua`. Chromium derives
   * Sec-CH-UA from its own build, so a spoofed UA string alongside real
   * client hints contradicts itself in a way any fingerprinter reads
   * immediately — worse than not spoofing at all.
   */
  uaMetadata?: {
    platform: string;
    platformVersion: string;
    architecture: string;
    model: string;
    mobile: boolean;
    brands: Array<{ brand: string; version: string }>;
  };
  acceptLanguage?: string;
  locale?: string;
  timezone?: string;
  viewport?: { width: number; height: number; dpr: number };
  /**
   * The local Mysterium node backing this exit, written by tools/exits.js.
   * Present only for exits the launcher manages; a plain commercial proxy
   * has no node to ask, so the rail shows no switch for it.
   */
  apiPort?: number;
  country?: string;
  /** Asserted by tools/test-identity.js; never read at runtime. */
  expectCountry?: string;
  expectAsn?: string;
}

const file = (): string =>
  process.env['PIGEON_IDENTITIES'] ?? join(app.getPath('userData'), 'identities.json');

let cache: Record<string, Identity> | null = null;

function all(): Record<string, Identity> {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, Identity>;
  } catch {
    // No file is the normal case, and it means every inbox goes out direct —
    // exactly as it did before any of this existed.
    cache = {};
  }
  return cache;
}

export function identityFor(profile: string): Identity {
  return all()[profile] ?? {};
}

export function sessionFor(profile: string): Electron.Session {
  return session.fromPartition(`persist:inbox/${profile}`);
}

/** Sticky-session ids for rotating pools; one per profile until rotated. */
const sessionIds = new Map<string, string>();

/**
 * The proxy username for this profile — which, for a rotating pool, is where
 * the exit address is actually chosen.
 */
export function proxyUsername(profile: string): string | undefined {
  const identity = identityFor(profile);
  if (!identity.rotation) return identity.proxyAuth?.username;
  let id = sessionIds.get(profile);
  if (!id) {
    id = randomUUID().replace(/-/g, '').slice(0, 12);
    sessionIds.set(profile, id);
  }
  return identity.rotation.usernameTemplate.replace('{session}', id);
}

export function proxyPassword(profile: string): string | undefined {
  const identity = identityFor(profile);
  return identity.rotation?.password ?? identity.proxyAuth?.password;
}

/**
 * Session-level setup, applied once per partition.
 *
 * The promise is cached rather than fired and forgotten because the first
 * load has to wait on it: a page that starts loading before setProxy resolves
 * goes out on the default route. It works, it looks right, and it is the one
 * leak that defeats the entire arrangement.
 */
const prepared = new Map<string, Promise<void>>();

/**
 * Proxies the exits supervisor is driving, which outrank identities.json.
 *
 * The file is for proxies somebody else runs — a commercial endpoint, a local
 * relay. Exits the app starts itself are dynamic: their port is assigned when
 * the inbox is switched on and gone when it is switched off, so they cannot
 * be written down in advance. Recorded here so a later prepareSession does
 * not overwrite a live exit with whatever the file said.
 */
const managed = new Map<string, string | null>();

export async function setManagedProxy(profile: string, proxy: string | null): Promise<void> {
  managed.set(profile, proxy);
  await sessionFor(profile).setProxy({ proxyRules: proxy ?? 'direct://' });
}

function proxyRulesFor(profile: string): string {
  if (managed.has(profile)) return managed.get(profile) ?? 'direct://';
  return identityFor(profile).proxy ?? 'direct://';
}

export function prepareSession(profile: string): Promise<void> {
  const existing = prepared.get(profile);
  if (existing) return existing;

  const identity = identityFor(profile);
  const ses = sessionFor(profile);

  const work = (async () => {
    // "direct://" explicitly rather than skipping the call: a session that
    // held a proxy earlier in this run keeps it until told otherwise.
    //
    // No proxyBypassRules — Chromium bypasses loopback by default, which is
    // what the http://127.0.0.1 servers in tools/ depend on.
    await ses.setProxy({ proxyRules: proxyRulesFor(profile) });
    if (identity.ua) ses.setUserAgent(identity.ua, identity.acceptLanguage);
  })();

  prepared.set(profile, work);
  return work;
}

/**
 * Everything Electron exposes no API for, via CDP.
 *
 * `session.setUserAgent` changes one header. It leaves navigator.userAgentData
 * and the Sec-CH-UA headers reporting the real Chromium build, and it cannot
 * touch timezone or locale at all — so a "London" session still answers
 * America/Los_Angeles to any page that asks, which is a louder signal than
 * the address it arrived from.
 *
 * Costs one thing: the debugger is single-attach, so DevTools cannot open
 * while this holds it. See detachForDevTools.
 */
export function applyEmulation(wc: WebContents, profile: string): void {
  const identity = identityFor(profile);
  if (!identity.ua && !identity.timezone && !identity.locale && !identity.viewport) return;

  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  } catch {
    return; // DevTools already holds it; emulation is the thing that yields
  }

  const send = (method: string, params: object): void => {
    void wc.debugger.sendCommand(method, params).catch(() => {
      /* a page can navigate out from under a command; not worth failing over */
    });
  };

  if (identity.ua) {
    send('Emulation.setUserAgentOverride', {
      userAgent: identity.ua,
      acceptLanguage: identity.acceptLanguage,
      platform: identity.uaMetadata?.platform,
      userAgentMetadata: identity.uaMetadata,
    });
  }
  if (identity.timezone) send('Emulation.setTimezoneOverride', { timezoneId: identity.timezone });
  if (identity.locale) send('Emulation.setLocaleOverride', { locale: identity.locale });
  if (identity.viewport) {
    send('Emulation.setDeviceMetricsOverride', {
      width: identity.viewport.width,
      height: identity.viewport.height,
      deviceScaleFactor: identity.viewport.dpr,
      mobile: identity.uaMetadata?.mobile ?? false,
    });
  }
}

/** F12 needs the debugger port back; emulation yields for as long as it's open. */
export function detachForDevTools(wc: WebContents): void {
  try {
    if (wc.debugger.isAttached()) wc.debugger.detach();
  } catch {
    /* nothing attached */
  }
}

/**
 * A new exit address, and the clean slate that has to come with it.
 *
 * Rotating the address alone is worse than not rotating: the cookies say the
 * same person, the address says they teleported. Whatever survives a rotation
 * is what links the two identities, so all of it goes — which is also why
 * this belongs to a harness at a test-case boundary, and is never something
 * the app does on a timer.
 */
export async function rotate(profile: string): Promise<void> {
  const ses = sessionFor(profile);
  sessionIds.delete(profile);
  // Order matters. Sockets already open still hold the old exit, and Chromium
  // caches proxy credentials per session — reuse the old username and the
  // provider hands back the very same address, silently.
  await ses.closeAllConnections();
  await ses.clearAuthCache();
  await ses.clearStorageData();
}

/** The address this session actually leaves through — measured, not assumed. */
export async function exitInfo(
  profile: string,
): Promise<{ ip: string; country: string; org: string }> {
  await prepareSession(profile);
  const response = await sessionFor(profile).fetch('https://ipinfo.io/json');
  const body = (await response.json()) as { ip?: string; country?: string; org?: string };
  return { ip: body.ip ?? '', country: body.country ?? '', org: body.org ?? '' };
}
