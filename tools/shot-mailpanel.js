// Screenshots the chrome with the mail panel open, to eyeball the per-row
// actions and the restyled scrollbars. Writes shot-mailpanel.png.
// Run: npm run build && npx electron tools/shot-mailpanel.js
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('fs');
const { join } = require('path');

const bail = (e) => {
  console.log('HARNESS ERROR:', String(e).slice(0, 300));
  app.exit(1);
};
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);
setTimeout(() => {
  console.log('HARNESS TIMEOUT');
  app.exit(1);
}, 60000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

require('../out/main/index.js');

app.whenReady().then(async () => {
  await sleep(5000);
  const win = BrowserWindow.getAllWindows()[0];
  win.focus();
  await win.webContents.executeJavaScript(
    `window.bridge.tabs.setProfile('john6@mailpigeon.vip')`,
  );
  await sleep(2500);

  // Click the mail-panel button by its accessible title, then hover the first
  // row so the actions render in the shot.
  const opened = await win.webContents.executeJavaScript(`(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => (b.title || '').toLowerCase().includes('mail'));
    if (!btn) return 'no mail button: ' + [...document.querySelectorAll('button')].map(b=>b.title).join('|');
    btn.click();
    return 'clicked';
  })()`);
  console.log('panel:', opened);
  await sleep(3500);

  const rowInfo = await win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('.group.relative.border-b');
    if (!row) return 'no rows';
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const actions = row.querySelectorAll('button');
    return 'rows ok, buttons in row: ' + actions.length;
  })()`);
  console.log('row:', rowInfo);
  await sleep(800);

  const img = await win.webContents.capturePage();
  const out = join(__dirname, 'shot-mailpanel.png');
  writeFileSync(out, img.toPNG());
  console.log('wrote', out);
  app.exit(0);
});
