import { BrowserWindow, WebContentsView, type Input, type WebContents } from 'electron';
import { randomUUID } from 'crypto';
import { join } from 'path';
import type { BrowserState, TabInfo } from '../shared/types';
import { bookmarks } from './bookmarks';
import { passwords } from './passwords';

/** Chrome geometry — must match the renderer's CSS. Rail width is dynamic (collapse). */
export const RAIL_EXPANDED_W = 224;
export const TOP_H = 84;
export const PANEL_W = 384;

interface Tab {
  view: WebContentsView;
  info: TabInfo;
}

/**
 * Owns every browser tab as a WebContentsView. The load-bearing line is the
 * partition: each inbox gets `persist:inbox/<address>` — its own cookies,
 * storage, and cache, so the same site can hold a different login per inbox
 * with zero leakage between them.
 */
export class TabManager {
  private tabs = new Map<string, Tab>();
  private order = new Map<string, string[]>();
  private activeByProfile = new Map<string, string>();
  private activeProfile: string | null = null;
  private panelOpen = false;
  private railWidth = RAIL_EXPANDED_W;
  private attached: string | null = null;
  /** Recently closed tabs, for Ctrl+Shift+T. */
  private closedStack: Array<{ profile: string; url: string }> = [];

  constructor(private win: BrowserWindow) {
    win.on('resize', () => this.layout());
    // Shortcuts must also work while focus sits in the chrome renderer.
    this.wireKeys(win.webContents);
  }

  /** Links clicked in the chrome (mail panel HTML) open in the active inbox. */
  openInActiveProfile(url: string): void {
    if (!this.activeProfile) return;
    this.create(this.activeProfile, url);
  }

  setProfile(profile: string): void {
    this.activeProfile = profile;
    if ((this.order.get(profile) ?? []).length === 0) {
      this.create(profile);
      return; // create() shows and emits
    }
    this.showActive();
    this.emit();
  }

  create(profile: string, url?: string, background = false): void {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        partition: `persist:inbox/${profile}`,
        sandbox: true,
        preload: join(__dirname, '../preload/tab.js'), // autofill agent
      },
    });

    // Google (and friends) reject logins from an obviously-Electron UA —
    // and logging into accounts is this browser's whole purpose.
    const wc = view.webContents;
    wc.setUserAgent(wc.getUserAgent().replace(/\sElectron\/\S+/, ''));
    this.wireKeys(wc);

    const info: TabInfo = {
      id,
      profile,
      url: url ?? '',
      title: 'New tab',
      favicon: null,
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
    this.tabs.set(id, { view, info });
    this.order.set(profile, [...(this.order.get(profile) ?? []), id]);
    // Background tabs don't steal focus — but a profile with no active tab
    // at all (opened-in-all-inboxes into a fresh profile) still needs one.
    if (!background || !this.activeByProfile.has(profile)) {
      this.activeByProfile.set(profile, id);
    }

    const sync = () => {
      info.url = wc.getURL();
      info.title = wc.getTitle() || info.url || 'New tab';
      info.canGoBack = wc.navigationHistory.canGoBack();
      info.canGoForward = wc.navigationHistory.canGoForward();
      this.emit();
    };
    wc.on('page-title-updated', sync);
    wc.on('did-navigate', sync);
    wc.on('did-navigate-in-page', sync);
    wc.on('did-start-loading', () => {
      info.loading = true;
      this.emit();
    });
    wc.on('did-stop-loading', () => {
      info.loading = false;
      sync();
    });
    wc.on('did-finish-load', () => this.pushAutofill(wc, profile));
    wc.on('page-favicon-updated', (_e, favicons) => {
      info.favicon = favicons[0] ?? null;
      this.emit();
    });
    // target=_blank and window.open stay inside the same inbox's cookie jar;
    // middle-clicked links open in the background like a real browser.
    wc.setWindowOpenHandler(({ url: popupUrl, disposition }) => {
      this.create(profile, popupUrl, disposition === 'background-tab');
      return { action: 'deny' };
    });

    if (url) void wc.loadURL(url);
    this.showActive();
    this.emit();
  }

  close(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    const profile = tab.info.profile;
    if (tab.info.url && tab.info.url !== 'about:blank') {
      this.closedStack.push({ profile, url: tab.info.url });
      if (this.closedStack.length > 25) this.closedStack.shift();
    }
    const ids = (this.order.get(profile) ?? []).filter((t) => t !== id);
    this.order.set(profile, ids);
    if (this.activeByProfile.get(profile) === id) {
      const next = ids[ids.length - 1];
      if (next) this.activeByProfile.set(profile, next);
      else this.activeByProfile.delete(profile);
    }
    if (this.attached === id) {
      this.win.contentView.removeChildView(tab.view);
      this.attached = null;
    }
    tab.view.webContents.close();
    this.tabs.delete(id);
    this.showActive();
    this.emit();
  }

  activate(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    this.activeByProfile.set(tab.info.profile, id);
    this.showActive();
    this.emit();
  }

  navigate(id: string, url: string): void {
    void this.tabs.get(id)?.view.webContents.loadURL(url);
  }

  back(id: string): void {
    this.tabs.get(id)?.view.webContents.navigationHistory.goBack();
  }

  forward(id: string): void {
    this.tabs.get(id)?.view.webContents.navigationHistory.goForward();
  }

  reload(id: string): void {
    this.tabs.get(id)?.view.webContents.reload();
  }

  setPanelOpen(open: boolean): void {
    this.panelOpen = open;
    this.layout();
    this.emit();
  }

  setRailWidth(width: number): void {
    this.railWidth = width;
    this.layout();
  }

  /**
   * Chrome overlays (bookmark dropdown, any popover reaching into the page
   * area) render UNDER the native WebContentsView — it always sits above the
   * renderer. The overlay tells us to hide the page while it's open.
   */
  setContentVisible(visible: boolean): void {
    if (!this.attached) return;
    this.tabs.get(this.attached)?.view.setVisible(visible);
  }

  /** The inbox profile owning a given tab webContents — for autofill IPC. */
  profileFor(wc: WebContents): string | null {
    for (const tab of this.tabs.values()) {
      if (tab.view.webContents.id === wc.id) return tab.info.profile;
    }
    return null;
  }

  private pushAutofill(wc: WebContents, profile: string): void {
    let origin: string;
    try {
      const url = new URL(wc.getURL());
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
      origin = url.origin;
    } catch {
      return;
    }
    const cred = passwords.get(profile, origin);
    wc.send('autofill:data', {
      email: profile,
      ...(cred ? { username: cred.username, password: cred.password } : {}),
    });
  }

  /**
   * Standard browser shortcuts. Attached to every tab's webContents AND the
   * chrome renderer — keystrokes go to whichever holds focus, so both must
   * route here.
   */
  private wireKeys(wc: WebContents): void {
    wc.on('before-input-event', (event, input: Input) => {
      if (input.type !== 'keyDown') return;
      const ctrl = input.control || input.meta;
      const key = input.key.toLowerCase();
      const profile = this.activeProfile;
      const activeId = profile ? this.activeByProfile.get(profile) : undefined;

      const handled = ((): boolean => {
        if (ctrl && !input.shift && key === 't') {
          if (profile) this.create(profile);
          return true;
        }
        if (ctrl && input.shift && key === 't') {
          this.reopenClosed();
          return true;
        }
        if (ctrl && key === 'w') {
          if (activeId) this.close(activeId);
          return true;
        }
        if (ctrl && key === 'tab') {
          this.cycle(input.shift ? -1 : 1);
          return true;
        }
        if (ctrl && /^[1-9]$/.test(input.key)) {
          this.activateIndex(Number(input.key));
          return true;
        }
        if ((ctrl && key === 'r') || key === 'f5') {
          if (activeId) this.reload(activeId);
          return true;
        }
        if (ctrl && key === 'd') {
          const info = activeId ? this.tabs.get(activeId)?.info : undefined;
          if (info) bookmarks.toggle(info.url, info.title, info.favicon);
          return true;
        }
        if (ctrl && key === 'l') {
          // Pull focus out of the page and into the chrome's address bar.
          this.win.webContents.focus();
          this.win.webContents.send('chrome:focusAddress');
          return true;
        }
        if (input.alt && key === 'arrowleft') {
          if (activeId) this.back(activeId);
          return true;
        }
        if (input.alt && key === 'arrowright') {
          if (activeId) this.forward(activeId);
          return true;
        }
        if (key === 'f12' || (ctrl && input.shift && key === 'i')) {
          if (activeId) this.tabs.get(activeId)?.view.webContents.toggleDevTools();
          return true;
        }
        return false;
      })();

      if (handled) event.preventDefault();
    });
  }

  private cycle(dir: 1 | -1): void {
    const profile = this.activeProfile;
    if (!profile) return;
    const ids = this.order.get(profile) ?? [];
    if (ids.length < 2) return;
    const current = ids.indexOf(this.activeByProfile.get(profile) ?? '');
    const next = ids[(current + dir + ids.length) % ids.length];
    this.activate(next);
  }

  /** Chrome convention: Ctrl+1..8 by position, Ctrl+9 = last tab. */
  private activateIndex(n: number): void {
    const profile = this.activeProfile;
    if (!profile) return;
    const ids = this.order.get(profile) ?? [];
    const id = n === 9 ? ids[ids.length - 1] : ids[n - 1];
    if (id) this.activate(id);
  }

  private reopenClosed(): void {
    const entry = this.closedStack.pop();
    if (!entry) return;
    this.activeProfile = entry.profile; // reopening may hop profiles, like Ctrl+Shift+T across windows
    this.create(entry.profile, entry.url);
  }

  private showActive(): void {
    const nextId = this.activeProfile ? this.activeByProfile.get(this.activeProfile) : undefined;
    if (this.attached === nextId) {
      this.layout();
      return;
    }
    if (this.attached) {
      const prev = this.tabs.get(this.attached);
      if (prev) this.win.contentView.removeChildView(prev.view);
      this.attached = null;
    }
    if (nextId) {
      const next = this.tabs.get(nextId);
      if (next) {
        next.view.setVisible(true); // in case it was hidden under an overlay
        this.win.contentView.addChildView(next.view);
        this.attached = nextId;
        this.layout();
      }
    }
  }

  private layout(): void {
    if (!this.attached) return;
    const tab = this.tabs.get(this.attached);
    if (!tab) return;
    const [w, h] = this.win.getContentSize();
    tab.view.setBounds({
      x: this.railWidth,
      y: TOP_H,
      width: Math.max(0, w - this.railWidth - (this.panelOpen ? PANEL_W : 0)),
      height: Math.max(0, h - TOP_H),
    });
  }

  snapshot(): BrowserState {
    const profiles: BrowserState['profiles'] = {};
    for (const [profile, ids] of this.order) {
      profiles[profile] = {
        tabs: ids.map((id) => this.tabs.get(id)!.info),
        activeTabId: this.activeByProfile.get(profile) ?? null,
      };
    }
    return { activeProfile: this.activeProfile, profiles, panelOpen: this.panelOpen };
  }

  private emit(): void {
    this.win.webContents.send('browser:state', this.snapshot());
  }
}
