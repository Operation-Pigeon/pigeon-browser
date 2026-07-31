import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

/**
 * Saved logins, scoped (inbox profile, site origin) — the same site holds a
 * different credential per inbox, which is the entire point of this browser.
 * Passwords are individually encrypted with the OS keychain; usernames and
 * origins stay plaintext so lookups don't need decryption.
 */
interface StoredCred {
  id: string;
  profile: string;
  origin: string;
  username: string;
  passwordEnc: string; // base64(safeStorage.encryptString)
  updatedAt: string;
}

const file = () => join(app.getPath('userData'), 'passwords.json');

let cache: StoredCred[] | null = null;

function load(): StoredCred[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(file(), 'utf8')) as StoredCred[];
  } catch {
    cache = [];
  }
  return cache;
}

function persist(): void {
  writeFileSync(file(), JSON.stringify(cache ?? [], null, 2));
}

export const passwords = {
  /** Metadata only — passwords stay encrypted until a single reveal(id). */
  list(): Array<{ id: string; profile: string; origin: string; username: string; updatedAt: string }> {
    return load().map(({ id, profile, origin, username, updatedAt }) => ({
      id,
      profile,
      origin,
      username,
      updatedAt,
    }));
  },

  reveal(id: string): string | null {
    const cred = load().find((c) => c.id === id);
    if (!cred) return null;
    try {
      return safeStorage.decryptString(Buffer.from(cred.passwordEnc, 'base64'));
    } catch {
      return null;
    }
  },

  remove(id: string): void {
    cache = load().filter((c) => c.id !== id);
    persist();
  },

  get(profile: string, origin: string): { username: string; password: string } | null {
    const cred = load().find((c) => c.profile === profile && c.origin === origin);
    if (!cred) return null;
    try {
      return {
        username: cred.username,
        password: safeStorage.decryptString(Buffer.from(cred.passwordEnc, 'base64')),
      };
    } catch {
      return null;
    }
  },

  /** Returns true when something was actually saved/changed. */
  upsert(profile: string, origin: string, username: string, password: string): boolean {
    if (!password) return false;
    const all = load();
    const existing = all.find((c) => c.profile === profile && c.origin === origin);
    if (existing) {
      const current = this.get(profile, origin);
      if (current?.username === username && current?.password === password) return false;
      existing.username = username;
      existing.passwordEnc = safeStorage.encryptString(password).toString('base64');
      existing.updatedAt = new Date().toISOString();
    } else {
      all.push({
        id: randomUUID(),
        profile,
        origin,
        username,
        passwordEnc: safeStorage.encryptString(password).toString('base64'),
        updatedAt: new Date().toISOString(),
      });
    }
    persist();
    return true;
  },
};
