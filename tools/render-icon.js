// Renders the app icon: the platform's actual color 🐦 glyph on the dark
// rounded tile, rasterized by Chromium (GDI can't draw color emoji).
// Run: npx electron tools/render-icon.js
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('fs');
const { join } = require('path');

const html = `<!doctype html><body style="margin:0;background:transparent">
  <div style="width:512px;height:512px;display:flex;align-items:center;justify-content:center;
              background:#18181b;border-radius:110px">
    <span style="font-size:340px;font-family:'Segoe UI Emoji',sans-serif">&#128038;</span>
  </div></body>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 512,
    height: 512,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 800)); // let fonts rasterize
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  writeFileSync(join(__dirname, '..', 'build', 'icon.png'), img.toPNG());
  console.log('icon written');
  app.quit();
});
