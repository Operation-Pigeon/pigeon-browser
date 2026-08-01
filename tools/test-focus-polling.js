// Verifies the focus-gated pollers against the REAL app (not a mock of it):
//   1. focusing a tab's WebContentsView must NOT read as "window unfocused" —
//      that's why the gate uses BrowserWindow focus, not document.hasFocus()
//   2. polling stops while the window is blurred
//   3. regaining focus refreshes immediately, not on the next tick
// Counts actual api.mailpigeon.vip requests, so it measures spend, not intent.
// Run: npm run build && npx electron tools/test-focus-polling.js
const { app, BrowserWindow, WebContentsView } = require('electron');

process.on('uncaughtException', (e) => {
  console.log('HARNESS ERROR:', String(e).slice(0, 300));
  app.exit(1);
});
setTimeout(() => {
  console.log('HARNESS TIMEOUT');
  app.exit(1);
}, 120000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}

let apiCalls = 0;
const since = () => {
  const start = apiCalls;
  return () => apiCalls - start;
};

// The API client in main uses Node's global fetch, which never touches the
// Electron session — so session.webRequest sees nothing. Patch the transport
// itself, before main loads and captures a reference to it.
const realFetch = globalThis.fetch;
globalThis.fetch = (url, ...rest) => {
  if (String(url).startsWith('https://api.mailpigeon.vip')) {
    apiCalls++;
    console.log(`  [api] ${String(url).replace('https://api.mailpigeon.vip', '')}`);
  }
  return realFetch(url, ...rest);
};

// Boot the real main process.
require('../out/main/index.js');

app.whenReady().then(async () => {
  await sleep(6000); // window + renderer + key check + first poll
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    console.log('HARNESS ERROR: no window');
    return app.exit(1);
  }
  win.focus();

  // The dev profile has its own userData, so it carries no key and nothing
  // would poll at all. Seed one, then reload so `keyed` picks it up.
  const KEY = process.env.PIGEON_KEY;
  if (!KEY) {
    console.log('HARNESS ERROR: set PIGEON_KEY to a valid pgn_ key');
    return app.exit(1);
  }
  await win.webContents.executeJavaScript(`window.bridge.pigeon.saveKey(${JSON.stringify(KEY)})`);
  win.webContents.reload();
  await sleep(4000);

  // --- 1. a focused tab must not look like an unfocused app -----------------
  const probe = new WebContentsView({});
  win.contentView.addChildView(probe);
  probe.setBounds({ x: 0, y: 0, width: 400, height: 300 });
  await probe.webContents.loadURL('data:text/html,<input id=i autofocus>');
  probe.webContents.focus();
  await sleep(800);

  const chromeSeesDomFocus = await win.webContents.executeJavaScript('document.hasFocus()');
  check(
    'window stays focused while a tab has focus',
    win.isFocused() === true,
    `win.isFocused()=${win.isFocused()}`,
  );
  check(
    'chrome DOM focus is lost to the tab (why document.hasFocus() is wrong here)',
    chromeSeesDomFocus === false,
    `document.hasFocus()=${chromeSeesDomFocus}`,
  );
  win.contentView.removeChildView(probe);
  probe.webContents.close();
  win.focus();
  await sleep(1500);

  // --- 2. polling runs while focused ---------------------------------------
  let count = since();
  await sleep(22000); // ~2 ticks at 10s
  const whileFocused = count();
  check('polls while focused', whileFocused >= 2, `${whileFocused} calls in 22s`);

  // --- 3. polling stops while blurred --------------------------------------
  // Real OS focus change: another window taking focus, not just win.blur().
  const other = new BrowserWindow({ width: 300, height: 200 });
  await other.loadURL('data:text/html,<h1>steal focus</h1>');
  other.focus();
  await sleep(1500);
  check('window reports blurred', win.isFocused() === false, `win.isFocused()=${win.isFocused()}`);

  count = since();
  await sleep(25000);
  const whileBlurred = count();
  check('no polling while blurred', whileBlurred === 0, `${whileBlurred} calls in 25s`);

  // --- 4. regaining focus refreshes immediately ----------------------------
  count = since();
  win.focus();
  await sleep(2000); // well under the 10s tick
  const onRefocus = count();
  check('refreshes immediately on refocus', onRefocus >= 1, `${onRefocus} calls within 2s`);

  other.destroy();
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  app.exit(failures === 0 ? 0 : 1);
});
