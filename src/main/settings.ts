import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * App settings + the Pigeon API key (encrypted at rest with the OS keychain,
 * DPAPI on Windows).
 */
interface SettingsFile {
  key?: string;
  autoSavePasswords?: boolean;
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
