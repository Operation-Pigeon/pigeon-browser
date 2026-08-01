// Opening a message must mark it read in the LIST immediately — the server
// marks it on detail fetch, but the list is a separate snapshot, so backing
// out used to show the row still bold until the next poll.
// Run: npm run build && npx electron tools/test-mail-actions.js
const { app, BrowserWindow } = require('electron');

const bail = (e) => {
  console.log('HARNESS ERROR:', String(e).slice(0, 300));
  app.exit(1);
};
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);
setTimeout(() => {
  console.log('HARNESS TIMEOUT');
  app.exit(1);
}, 90000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}

require('../out/main/index.js');

const ROW = '.group.relative.border-b';
// The unread marker is the dot the row renders only when !read.
const firstRowUnread = `(() => {
  const row = document.querySelector('${ROW}');
  return row ? !!row.querySelector('.bg-primary') : 'no rows';
})()`;

app.whenReady().then(async () => {
  await sleep(5000);
  const win = BrowserWindow.getAllWindows()[0];
  win.focus();
  const js = (code) => win.webContents.executeJavaScript(code);

  await js(`window.bridge.tabs.setProfile('john6@mailpigeon.vip')`);
  await sleep(2000);
  await js(`(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => (b.title || '').toLowerCase().includes('mail'));
    btn && btn.click();
  })()`);
  await sleep(3000);

  // Force an unread row through the API, then refresh the panel.
  const id = await js(`(async () => {
    const r = await window.bridge.pigeon.mail('john6@mailpigeon.vip');
    const first = r.emails[0];
    await window.bridge.pigeon.markUnread(first.id);
    return first.id;
  })()`);
  await js(`[...document.querySelectorAll('button')].find((b) => b.title === 'Refresh')?.click()`);
  await sleep(2500);
  const dbg = await js(`(() => {
    const rows = document.querySelectorAll('${ROW}');
    const r0 = rows[0];
    return JSON.stringify({
      rows: rows.length,
      html: r0 ? r0.innerHTML.slice(0, 200) : null,
      refreshTitles: [...document.querySelectorAll('button')].map((b) => b.title).filter(Boolean),
    });
  })()`);
  console.log('  debug:', dbg);
  check('row shows unread after markUnread', (await js(firstRowUnread)) === true, `id=${id}`);

  // Open it, then go back — the list must already show it read.
  await js(`document.querySelector('${ROW} button').click()`);
  await sleep(2500);
  const inDetail = await js(`!!document.querySelector('iframe[title="Message body"], pre')`);
  check('message opened', inDetail === true);

  await js(`[...document.querySelectorAll('button')].find((b) => b.title === 'Back to mail list')?.click()`);
  await sleep(1200);
  const finalState = await js(firstRowUnread);
  check(
    'row is read immediately on returning to the list (no refresh)',
    finalState === false,
    `state=${JSON.stringify(finalState)}`,
  );

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  app.exit(failures === 0 ? 0 : 1);
});
