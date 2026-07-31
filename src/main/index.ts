import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { TabManager } from './tabs';
import { pigeon } from './pigeonApi';

let win: BrowserWindow;
let tabs: TabManager;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
    },
  });
  win.setMenuBarVisibility(false);

  tabs = new TabManager(win);

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
  ipcMain.handle('tabs:snapshot', () => tabs.snapshot());

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
