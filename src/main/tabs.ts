import { BrowserWindow, WebContentsView } from 'electron';
import { randomUUID } from 'crypto';
import type { BrowserState, TabInfo } from '../shared/types';

/** Chrome geometry — must match the renderer's CSS. */
export const RAIL_W = 224;
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
  private attached: string | null = null;

  constructor(private win: BrowserWindow) {
    win.on('resize', () => this.layout());
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

  create(profile: string, url?: string): void {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        partition: `persist:inbox/${profile}`,
        sandbox: true,
      },
    });

    // Google (and friends) reject logins from an obviously-Electron UA —
    // and logging into accounts is this browser's whole purpose.
    const wc = view.webContents;
    wc.setUserAgent(wc.getUserAgent().replace(/\sElectron\/\S+/, ''));

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
    this.activeByProfile.set(profile, id);

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
    wc.on('page-favicon-updated', (_e, favicons) => {
      info.favicon = favicons[0] ?? null;
      this.emit();
    });
    // target=_blank and window.open stay inside the same inbox's cookie jar.
    wc.setWindowOpenHandler(({ url: popupUrl }) => {
      this.create(profile, popupUrl);
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
      x: RAIL_W,
      y: TOP_H,
      width: Math.max(0, w - RAIL_W - (this.panelOpen ? PANEL_W : 0)),
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
