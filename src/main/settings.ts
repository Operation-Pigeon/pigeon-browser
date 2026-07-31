import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * The Pigeon API key, encrypted at rest with the OS keychain (DPAPI on
 * Windows). Nothing else is worth persisting yet.
 */
const file = () => join(app.getPath('userData'), 'pigeon-settings.json');

let cached: string | null | undefined;

export function getApiKey(): string | null {
  if (cached !== undefined) return cached;
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as { key?: string };
    cached = raw.key ? safeStorage.decryptString(Buffer.from(raw.key, 'base64')) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function setApiKey(key: string): void {
  writeFileSync(file(), JSON.stringify({ key: safeStorage.encryptString(key).toString('base64') }));
  cached = key;
}
