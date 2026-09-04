import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

/**
 * App settings + the Pigeon API key (encrypted at rest with the OS keychain,
 * DPAPI on Windows).
 */
interface SettingsFile {
  key?: string;
  autoSavePasswords?: boolean;
  shareHistorySuggestions?: boolean;
  /** Where the myst binary was installed or pointed at. */
  mystBinary?: string;
  /** Keystore passphrase, encrypted like the API key. Generated, never typed. */
  mystPassphrase?: string;
  /** Which inboxes want an exit, and where. Absent means off. */
  exits?: Record<string, { country: string }>;
  /**
   * The user unlinked while keeping the keystore. Without this the keystore
   * on disk is found again the moment the control node restarts, so unlink
   * undoes itself a few seconds after it happens.
   */
  mystUnlinked?: boolean;
  /**
   * Whether the Fill panel may put invented details on a page. Off is a hard
   * stop rather than a hidden button: the main process refuses too, so a
   * stale renderer cannot fill anyway.
   */
  personaFill?: boolean;
  /**
   * Colour label per inbox, used to group the rail. Absent means unlabelled,
   * which is a group of its own rather than a colour.
   */
  inboxColors?: Record<string, string>;
  /** Colour groups the user has folded away. Survives a restart on purpose.  */
  collapsedGroups?: string[];
}

const file = () => join(app.getPath('userData'), 'pigeon-settings.json');

let cache: SettingsFile | null = null;

function load(): SettingsFile {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(file(), 'utf8')) as SettingsFile;
  } catch {
    cache = {};
  }
  return cache;
}

function persist(): void {
  writeFileSync(file(), JSON.stringify(cache ?? {}));
}

export function getApiKey(): string | null {
  const raw = load().key;
  if (!raw) return null;
  try {
    return safeStorage.decryptString(Buffer.from(raw, 'base64'));
  } catch {
    return null;
  }
}

export function setApiKey(key: string): void {
  load().key = safeStorage.encryptString(key).toString('base64');
  persist();
}

/** Prompt-to-save is the default; flipping this restores silent capture. */
export function getAutoSavePasswords(): boolean {
  return load().autoSavePasswords ?? false;
}

export function setAutoSavePasswords(value: boolean): void {
  load().autoSavePasswords = value;
  persist();
}

export function getMystBinary(): string | null {
  return load().mystBinary ?? null;
}

export function setMystBinary(path: string): void {
  load().mystBinary = path;
  persist();
}

/**
 * The keystore passphrase.
 *
 * Generated rather than asked for: it guards a key file that already sits
 * behind the OS user account, and a passphrase the user invents here is one
 * more thing to lose. Encrypted at rest like the API key.
 */
export function getMystPassphrase(): string {
  const stored = load().mystPassphrase;
  if (stored) {
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      /* unreadable — fall through and mint a new one */
    }
  }
  const fresh = randomBytes(24).toString('hex');
  load().mystPassphrase = safeStorage.encryptString(fresh).toString('base64');
  persist();
  return fresh;
}

export function getPersonaFill(): boolean {
  return load().personaFill ?? true;
}

export function setPersonaFill(value: boolean): void {
  load().personaFill = value;
  persist();
}

export function getMystUnlinked(): boolean {
  return load().mystUnlinked ?? false;
}

export function setMystUnlinked(value: boolean): void {
  load().mystUnlinked = value;
  persist();
}

export function getInboxColors(): Record<string, string> {
  return load().inboxColors ?? {};
}

/** Passing null clears the label, which is how an inbox leaves a group. */
export function setInboxColor(profile: string, color: string | null): void {
  const all = load();
  all.inboxColors = all.inboxColors ?? {};
  if (color) all.inboxColors[profile] = color;
  else delete all.inboxColors[profile];
  persist();
}

export function getCollapsedGroups(): string[] {
  return load().collapsedGroups ?? [];
}

export function setGroupCollapsed(color: string, collapsed: boolean): void {
  const all = load();
  const set = new Set(all.collapsedGroups ?? []);
  if (collapsed) set.add(color);
  else set.delete(color);
  all.collapsedGroups = [...set];
  persist();
}

/**
 * Forgets settings for inboxes that no longer exist.
 *
 * Takes the full list rather than a delete-one call, because the app only
 * ever learns about deletions by noticing an address stopped appearing.
 * Returns what it dropped so the caller can stop anything still running for
 * those inboxes.
 *
 * Refuses an empty list. A failed API call also looks like "no inboxes", and
 * treating that as "delete everything" would wipe every colour, persona and
 * tunnel preference over one bad request.
 */
export function pruneUnknownInboxes(known: string[]): string[] {
  if (!known.length) return [];
  const alive = new Set(known);
  const all = load();
  const dropped = new Set<string>();

  for (const address of Object.keys(all.inboxColors ?? {})) {
    if (!alive.has(address)) {
      delete all.inboxColors![address];
      dropped.add(address);
    }
  }
  for (const address of Object.keys(all.exits ?? {})) {
    if (!alive.has(address)) {
      delete all.exits![address];
      dropped.add(address);
    }
  }
  if (dropped.size) persist();
  return [...dropped];
}


export function getExitPrefs(): Record<string, { country: string }> {
  return load().exits ?? {};
}

export function setExitPref(profile: string, country: string | null): void {
  const all = load();
  all.exits = all.exits ?? {};
  if (country) all.exits[profile] = { country };
  else delete all.exits[profile];
  persist();
}

/** Off by default: history is exactly what separate inboxes exist to separate. */
export function getShareHistorySuggestions(): boolean {
  return load().shareHistorySuggestions ?? false;
}

export function setShareHistorySuggestions(value: boolean): void {
  load().shareHistorySuggestions = value;
  persist();
}
