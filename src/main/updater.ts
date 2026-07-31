import { app, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

/**
 * Auto-update from public GitHub Releases (feed = the latest.yml
 * electron-builder attaches). Downloads happen silently; the update installs
 * on quit (electron-updater's default), and the chrome shows a pill when
 * one is ready so a restart is a choice, not a surprise.
 */
export function startUpdater(win: BrowserWindow): void {
  if (!app.isPackaged) return; // dev builds have nothing to update

  autoUpdater.on('update-downloaded', (info) => {
    win.webContents.send('chrome:notice', `Update v${info.version} ready — restart to apply`);
  });
  autoUpdater.on('error', () => {
    // Offline or GitHub hiccup — silent; the next interval retries.
  });

  void autoUpdater.checkForUpdates();
  setInterval(() => void autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);
}
