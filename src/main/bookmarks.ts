import { app, type BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { Bookmark } from '../shared/types';

/**
 * Bookmarks are deliberately GLOBAL — one list shared by every inbox
 * profile. Opening one navigates whatever session you're currently in.
 * Plain JSON in userData; sync is a future problem.
 */
const file = () => join(app.getPath('userData'), 'bookmarks.json');

let cache: Bookmark[] | null = null;
let win: BrowserWindow | null = null;

function load(): Bookmark[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(file(), 'utf8')) as Bookmark[];
  } catch {
    cache = [];
  }
  return cache;
}

function persist(): void {
  writeFileSync(file(), JSON.stringify(cache ?? [], null, 2));
  win?.webContents.send('bookmarks:changed', load());
}

export const bookmarks = {
  init(w: BrowserWindow): void {
    win = w;
  },

  list(): Bookmark[] {
    return load();
  },

  /** Star behavior: bookmarked -> remove, else add. Returns whether it's now bookmarked. */
  toggle(url: string, title: string, favicon: string | null): boolean {
    if (!url || url === 'about:blank') return false;
    const all = load();
    const existing = all.find((b) => b.url === url);
    if (existing) {
      cache = all.filter((b) => b.id !== existing.id);
      persist();
      return false;
    }
    cache = [
      ...all,
      { id: randomUUID(), url, title: title || url, favicon, createdAt: new Date().toISOString() },
    ];
    persist();
    return true;
  },

  remove(id: string): void {
    cache = load().filter((b) => b.id !== id);
    persist();
  },
};
