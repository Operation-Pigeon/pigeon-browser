// End-to-end check of the autofill agent inside real Electron:
//   1. email fill when no credential exists
//   2. username+password fill when one does
//   3. capture on form submit reaching main over IPC
// Run: npm run build && npx electron tools/test-autofill.js
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const { join } = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(actual)}${ok ? '' : ` want ${JSON.stringify(expected)}`}`);
}

app.whenReady().then(async () => {
  let captured = null;
  ipcMain.on('autofill:captured', (_e, p) => {
    captured = p;
  });

  const win = new BrowserWindow({ show: false, width: 800, height: 600 });
  const view = new WebContentsView({
    webPreferences: {
      partition: 'persist:inbox/test@test',
      sandbox: true,
      preload: join(__dirname, '..', 'out', 'preload', 'tab.js'),
    },
  });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  const wc = view.webContents;
  wc.on('preload-error', (_e, path, err) => console.log('PRELOAD ERROR', path, err));

  const html =
    '<form id="f"><input type="email" id="email"><input type="password" id="pw">' +
    '<button type="submit">Go</button></form>';
  await wc.loadURL('data:text/html,' + encodeURIComponent(html));
  await sleep(200);

  // 1. email-only fill
  wc.send('autofill:data', { email: 'coop@mailpigeon.vip' });
  await sleep(400);
  check('email fill', await wc.executeJavaScript(`document.getElementById('email').value`), 'coop@mailpigeon.vip');

  // 2. credential fill (fresh page)
  await wc.loadURL('data:text/html,' + encodeURIComponent(html));
  await sleep(200);
  wc.send('autofill:data', { email: 'coop@mailpigeon.vip', username: 'user@x.com', password: 'hunter2' });
  await sleep(400);
  check('cred user fill', await wc.executeJavaScript(`document.getElementById('email').value`), 'user@x.com');
  check('cred pw fill', await wc.executeJavaScript(`document.getElementById('pw').value`), 'hunter2');

  // 3. capture on submit
  await wc.executeJavaScript(
    `document.getElementById('email').value='me@site.com';` +
      `document.getElementById('pw').value='secret123';` +
      `document.getElementById('f').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); true`,
  );
  await sleep(400);
  check('capture user', captured && captured.username, 'me@site.com');
  check('capture pw', captured && captured.password, 'secret123');

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  app.exit(failures === 0 ? 0 : 1);
});
