import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';
import { join } from 'path';
import { TabManager } from './tabs';
import { pigeon } from './pigeonApi';
import { bookmarks } from './bookmarks';

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
    // Dev-mode taskbar icon; packaged builds get it baked into the exe by
    // electron-builder from the same file.
    icon: nativeImage.createFromPath(join(app.getAppPath(), 'build/icon.png')),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
    },
  });
  win.setMenuBarVisibility(false);

  tabs = new TabManager(win);
  bookmarks.init(win);

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  // Tab commands — thin pass-throughs; TabManager owns all state.
  ipcMain.handle('tabs:setProfile', (_e, profile: string) => tabs.setProfile(profile));
  ipcMain.handle('tabs:create', (_e, profile: string, url?: string) => tabs.create(profile, url));
  ipcMain.handle('tabs:close', (_e, id: string) => tabs.close(id));
  ipcMain.handle('tabs:activate', (_e, id: string) => tabs.activate(id));
  ipcMain.handle('tabs:navigate', (_e, id: string, url: string) => tabs.navigate(id, url));
  ipcMain.handle('tabs:back', (_e, id: string) => tabs.back(id));
  ipcMain.handle('tabs:forward', (_e, id: string) => tabs.forward(id));
  ipcMain.handle('tabs:reload', (_e, id: string) => tabs.reload(id));
  ipcMain.handle('tabs:panel', (_e, open: boolean) => tabs.setPanelOpen(open));
  ipcMain.handle('tabs:railWidth', (_e, width: number) => tabs.setRailWidth(width));
  ipcMain.handle('tabs:snapshot', () => tabs.snapshot());

  // Bookmarks — global across all inbox profiles.
  ipcMain.handle('bookmarks:list', () => bookmarks.list());
  ipcMain.handle('bookmarks:toggle', (_e, url: string, title: string, favicon: string | null) =>
    bookmarks.toggle(url, title, favicon),
  );
  ipcMain.handle('bookmarks:remove', (_e, id: string) => bookmarks.remove(id));

  // Pigeon API — main-process only; the key never reaches a renderer.
  ipcMain.handle('pigeon:hasKey', () => pigeon.hasKey());
  ipcMain.handle('pigeon:saveKey', (_e, key: string) => pigeon.saveKey(key));
  ipcMain.handle('pigeon:me', () => pigeon.me());
  ipcMain.handle('pigeon:inboxes', () => pigeon.inboxes());
  ipcMain.handle('pigeon:mail', (_e, address: string) => pigeon.mail(address));
  ipcMain.handle('pigeon:mailDetail', (_e, id: string) => pigeon.mailDetail(id));
  ipcMain.handle('pigeon:mailHtml', (_e, id: string) => pigeon.mailHtml(id));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
