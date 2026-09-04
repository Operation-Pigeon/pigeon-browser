import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';
import { join } from 'path';
import { TabManager } from './tabs';
import { pigeon } from './pigeonApi';
import { bookmarks } from './bookmarks';
import { passwords } from './passwords';
import { history } from './history';
import { mirror } from './mirror';
import {
  getAutoSavePasswords,
  getShareHistorySuggestions,
  setAutoSavePasswords,
  setShareHistorySuggestions,
} from './settings';
import { startUpdater } from './updater';
import { proxyPassword, proxyUsername } from './identities';
import { exits } from './exits';

/**
 * A packaged asset as a real file on disk.
 *
 * Packed assets live inside app.asar, and the Windows icon loader is native
 * code that knows nothing about asar archives: handed a path inside one it
 * fails silently and the window gets no icon at all. `asarUnpack` in
 * package.json keeps a genuine copy beside the archive, and this points at
 * it. In development there is no asar and the replace does nothing.
 */
function assetPath(relative: string): string {
  return join(app.getAppPath(), relative).replace('app.asar', 'app.asar.unpacked');
}

/** Capture waiting on a save prompt (auto-save off). Cleared on answer. */
let pendingCredential: { profile: string; origin: string; username: string; password: string } | null =
  null;

let win: BrowserWindow;
let tabs: TabManager;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#252525',
    // Custom chrome: no OS titlebar, but keep native min/max/close as an
    // overlay — the renderer reserves drag space at the top for it.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#d4d4d4',
      height: 40,
    },
    // Windows gets the .ico **as a path**, not as a NativeImage. The file
    // carries seven bitmaps, 16 through 256, and the taskbar wants one of the
    // small ones — but `nativeImage.createFromPath` flattens an .ico to its
    // largest representation, so handing it one throws away the very sizes it
    // was made for. A path goes to the platform's own ICO loader, which keeps
    // them. Elsewhere the PNG is the only thing there is.
    icon:
      process.platform === 'win32'
        ? assetPath('build/icon.ico')
        : nativeImage.createFromPath(assetPath('build/icon.png')),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
    },
  });
  win.setMenuBarVisibility(false);
  // The constructor's `icon` is not always honoured on Windows once the
  // window is up; setting it again afterwards is what actually sticks.
  if (process.platform === 'win32') win.setIcon(assetPath('build/icon.ico'));

  // Window-level focus, not DOM focus: clicking into a tab moves DOM focus to
  // that WebContentsView and blurs the chrome, though the user is plainly
  // still using the app. Only the BrowserWindow knows the difference, so
  // pollers subscribe to this rather than window.onblur.
  const sendFocus = (focused: boolean): void => {
    if (!win.isDestroyed()) win.webContents.send('chrome:focus', focused);
  };
  win.on('focus', () => sendFocus(true));
  win.on('blur', () => sendFocus(false));
  // Minimized windows keep "focus" if they were focused on the way down.
  win.on('minimize', () => sendFocus(false));
  win.on('restore', () => sendFocus(true));

  tabs = new TabManager(win);
  bookmarks.init(win);
  void exits.init(win);
  startUpdater(win);

  // Mail-panel links (sandboxed iframes firing window.open) become tabs in
  // the active inbox's session instead of separate windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      tabs.openInActiveProfile(url);
    }
    return { action: 'deny' };
  });

  // Reloading the chrome discards whatever dropdown was open, so a page left
  // hidden under it would stay hidden with nothing left to close.
  win.webContents.on('did-finish-load', () => tabs.clearOverlays());

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Opt-in debugging port, for driving the app from a test script the way a
// person drives it: same IPC, same renderer, no mocks. Off unless asked for,
// and the switch has to be set before the app is ready.
if (process.env['PIGEON_DEBUG_PORT']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['PIGEON_DEBUG_PORT']);
}

// Async work started with `void` reports failures here, not as an exception.
// Without this an exit node that fails to start does so in total silence.
process.on('unhandledRejection', (reason) => {
  console.error('main unhandled rejection:', reason);
});

// A browser shouldn't die because one page interaction threw somewhere in
// main. Log it, tell the chrome, keep running — the default dialog kills the
// app mid-session and loses every tab.
process.on('uncaughtException', (err) => {
  console.error('main uncaught:', err);
  if (win && !win.isDestroyed()) {
    win.webContents.send('chrome:notice', `Something went wrong: ${String(err).slice(0, 120)}`);
  }
});

// Proxy credentials, keyed off the tab's own inbox — the same rule the rest
// of this file follows: the sender decides, never the payload. Fires for HTTP
// and HTTPS proxies only; Chromium's SOCKS5 client supports no authentication
// method, so a socks5:// endpoint wanting a password fails here in silence.
app.on('login', (event, wc, _details, authInfo, callback) => {
  if (!authInfo.isProxy) return;
  const profile = tabs?.profileFor(wc);
  if (!profile) return;
  const username = proxyUsername(profile);
  const password = proxyPassword(profile);
  if (!username || !password) return;
  event.preventDefault();
  callback(username, password);
});

app.whenReady().then(() => {
  // Windows identifies a running window by its AppUserModelID, and the Start
  // Menu shortcut NSIS writes carries `vip.mailpigeon.browser`. Without this
  // the window declares a different one, so Windows never associates the two
  // — which is what breaks pinning, taskbar grouping and the icon that comes
  // with them. It has to be set before any window exists.
  //
  // Packaged only. In development there is no shortcut carrying that ID, and
  // an ID that resolves to nothing makes Windows fall back to a default icon
  // instead of using the window's own — so the very thing meant to fix the
  // taskbar icon is what removes it while developing.
  if (process.platform === 'win32' && app.isPackaged) {
    app.setAppUserModelId('vip.mailpigeon.browser');
  }

  // Tab commands — thin pass-throughs; TabManager owns all state.
  // Initial value for pollers — focus events only fire on change, so a
  // renderer that loads while unfocused would otherwise assume it's focused.
  ipcMain.handle('chrome:isFocused', () => !win.isDestroyed() && win.isFocused());
  ipcMain.handle('tabs:setProfile', (_e, profile: string) => tabs.setProfile(profile));
  ipcMain.handle('tabs:create', (_e, profile: string, url?: string, background?: boolean) =>
    tabs.create(profile, url, background ?? false),
  );
  ipcMain.handle('tabs:close', (_e, id: string) => tabs.close(id));
  ipcMain.handle('tabs:activate', (_e, id: string) => tabs.activate(id));
  ipcMain.handle('tabs:navigate', (_e, id: string, url: string) => tabs.navigate(id, url));
  ipcMain.handle('tabs:back', (_e, id: string) => tabs.back(id));
  ipcMain.handle('tabs:forward', (_e, id: string) => tabs.forward(id));
  ipcMain.handle('tabs:reload', (_e, id: string) => tabs.reload(id));
  ipcMain.handle('tabs:panel', (_e, open: boolean) => tabs.setPanelOpen(open));
  ipcMain.handle('tabs:railWidth', (_e, width: number) => tabs.setRailWidth(width));
  ipcMain.handle('tabs:panelWidth', (_e, width: number) => tabs.setPanelWidth(width));
  ipcMain.handle('tabs:topHeight', (_e, height: number) => tabs.setTopHeight(height));
  ipcMain.handle('tabs:overlay', (_e, name: string, open: boolean) => tabs.setOverlay(name, open));
  ipcMain.handle('tabs:snapshot', () => tabs.snapshot());

  // Credential capture from tab preloads. Everything is derived from the
  // SENDER — its profile, its current origin — never from the payload, so a
  // hostile page can only ever affect its own (profile, origin) slot.
  ipcMain.on('autofill:captured', (e, payload: { username?: unknown; password?: unknown }) => {
    const profile = tabs.profileFor(e.sender);
    if (!profile) return;
    let origin: string;
    try {
      const url = new URL(e.sender.getURL());
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
      origin = url.origin;
    } catch {
      return;
    }
    const username = typeof payload.username === 'string' ? payload.username.slice(0, 200) : '';
    const password = typeof payload.password === 'string' ? payload.password.slice(0, 500) : '';
    if (!password) return;

    if (getAutoSavePasswords()) {
      if (passwords.upsert(profile, origin, username, password)) {
        win.webContents.send('chrome:notice', `Password saved · ${new URL(origin).host} · ${profile}`);
      }
      return;
    }

    // Prompt mode: hold it in memory and ask the chrome. Nothing touches
    // disk until the user says yes.
    const existing = passwords.get(profile, origin);
    if (existing?.username === username && existing?.password === password) return;
    pendingCredential = { profile, origin, username, password };
    win.webContents.send('passwords:prompt', {
      profile,
      origin,
      host: new URL(origin).host,
      username,
    });
  });

  ipcMain.handle('passwords:resolvePrompt', (_e, save: boolean) => {
    const pending = pendingCredential;
    pendingCredential = null;
    if (!pending || !save) return false;
    return passwords.upsert(pending.profile, pending.origin, pending.username, pending.password);
  });

  ipcMain.handle('settings:get', () => ({
    autoSavePasswords: getAutoSavePasswords(),
    shareHistorySuggestions: getShareHistorySuggestions(),
  }));
  ipcMain.handle('settings:setAutoSave', (_e, value: boolean) => setAutoSavePasswords(value));
  ipcMain.handle('settings:setShareHistory', (_e, value: boolean) =>
    setShareHistorySuggestions(value),
  );

  // Multi-inbox control. The leading profile is derived from the SENDER, so
  // a page can't nominate itself as leader and drive other sessions.
  ipcMain.on('mirror:event', (e, event) => {
    const profile = tabs.profileOfWebContents(e.sender);
    if (profile) mirror.onLeaderEvent(profile, event);
  });
  ipcMain.on('mirror:result', (e, ok: boolean) => {
    const profile = tabs.profileOfWebContents(e.sender);
    if (profile) mirror.onApplyResult(profile, ok);
  });
  ipcMain.handle('mirror:state', () => mirror.state());
  ipcMain.handle('mirror:start', (_e, leader: string, followers: string[]) =>
    mirror.start(leader, followers),
  );
  ipcMain.handle('mirror:stop', () => mirror.stop());
  ipcMain.handle('mirror:pause', (_e, paused: boolean) => mirror.setPaused(paused));
  ipcMain.handle('mirror:pauseFollower', (_e, profile: string, paused: boolean) =>
    mirror.setFollowerPaused(profile, paused),
  );
  ipcMain.handle('mirror:makeLeader', (_e, profile: string) => mirror.makeLeader(profile));
  ipcMain.handle('mirror:resync', () => mirror.resync());

  // History — panel is always per-inbox; only suggestions honour the
  // share setting.
  ipcMain.handle('history:list', (_e, profile: string) => history.list(profile));
  ipcMain.handle('history:suggest', (_e, profile: string, query: string) =>
    history.suggest(profile, query, getShareHistorySuggestions()),
  );
  ipcMain.handle('history:remove', (_e, entryId: string) => history.remove(entryId));
  ipcMain.handle('history:clear', (_e, profile: string) => history.clear(profile));

  // Saved-password management — chrome renderer only (never tab preloads).
  ipcMain.handle('passwords:list', () => passwords.list());
  ipcMain.handle('passwords:reveal', (_e, id: string) => passwords.reveal(id));
  ipcMain.handle('passwords:remove', (_e, id: string) => passwords.remove(id));

  // Bookmarks — global across all inbox profiles.
  ipcMain.handle('bookmarks:list', () => bookmarks.list());
  ipcMain.handle('bookmarks:toggle', (_e, url: string, title: string, favicon: string | null) =>
    bookmarks.toggle(url, title, favicon),
  );
  ipcMain.handle('bookmarks:remove', (_e, id: string) => bookmarks.remove(id));

  // Per-inbox network exits, and the one-time Mysterium setup behind them.
  ipcMain.handle('exits:state', () => exits.state());
  ipcMain.handle('exits:setup', () => exits.setup());
  ipcMain.handle('exits:refresh', () => exits.refresh());
  ipcMain.handle('exits:install', () => exits.install());
  ipcMain.handle('exits:useBinary', (_e, path: string) => exits.useBinary(path));
  ipcMain.handle('exits:createIdentity', () => exits.createIdentity());
  ipcMain.handle('exits:importIdentity', (_e, path: string, passphrase: string) =>
    exits.importIdentity(path, passphrase),
  );
  ipcMain.handle('exits:register', () => exits.register());
  ipcMain.handle('exits:countries', () => exits.countries());
  ipcMain.handle('exits:enable', (_e, profile: string, country: string) =>
    exits.enable(profile, country),
  );
  ipcMain.handle('exits:disable', (_e, profile: string) => exits.disable(profile));
  ipcMain.handle('exits:signOut', (_e, wipe: boolean) => exits.signOut(wipe));
  ipcMain.handle('exits:relink', () => exits.relink());

  // Pigeon API — main-process only; the key never reaches a renderer.
  ipcMain.handle('pigeon:hasKey', () => pigeon.hasKey());
  ipcMain.handle('pigeon:saveKey', (_e, key: string) => pigeon.saveKey(key));
  ipcMain.handle('pigeon:me', () => pigeon.me());
  ipcMain.handle('pigeon:inboxes', () => pigeon.inboxes());
  ipcMain.handle('pigeon:mail', (_e, address: string) => pigeon.mail(address));
  ipcMain.handle('pigeon:mailDetail', (_e, id: string) => pigeon.mailDetail(id));
  ipcMain.handle('pigeon:markRead', (_e, id: string) => pigeon.markRead(id));
  ipcMain.handle('pigeon:markUnread', (_e, id: string) => pigeon.markUnread(id));
  ipcMain.handle('pigeon:deleteMail', (_e, id: string) => pigeon.deleteMail(id));
  ipcMain.handle('pigeon:mailHtml', (_e, id: string) => pigeon.mailHtml(id));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Exit nodes are child processes; without this they outlive the app and keep
// holding (and paying for) connections nobody is using.
app.on('before-quit', () => exits.stop());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
