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

export function getMystUnlinked(): boolean {
  return load().mystUnlinked ?? false;
}

export function setMystUnlinked(value: boolean): void {
  load().mystUnlinked = value;
  persist();
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
