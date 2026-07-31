// Closer-to-production check: real HTTP page, and the push happens from
// did-finish-load exactly the way TabManager.pushAutofill does.
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const { createServer } = require('http');
const { join } = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(
      '<form id="f"><input type="email" id="email" name="email">' +
        '<input type="password" id="pw"><button type="submit">Go</button></form>',
    );
  });
  await new Promise((r) => server.listen(18923, r));

  let captured = null;
  ipcMain.on('autofill:captured', (_e, p) => (captured = p));

  const win = new BrowserWindow({ show: false, width: 800, height: 600 });
  const view = new WebContentsView({
    webPreferences: {
      partition: 'persist:inbox/e2e@test',
      sandbox: true,
      preload: join(__dirname, '..', 'out', 'preload', 'tab.js'),
    },
  });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  const wc = view.webContents;
  wc.on('preload-error', (_e, p, err) => console.log('PRELOAD ERROR', p, String(err)));

  // Replicates TabManager.pushAutofill verbatim.
  wc.on('did-finish-load', () => {
    let origin;
    try {
      const url = new URL(wc.getURL());
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
      origin = url.origin;
    } catch {
      return;
    }
    console.log('push for', origin);
    wc.send('autofill:data', { email: 'coop@mailpigeon.vip' });
  });

  await wc.loadURL('http://127.0.0.1:18923/');
  await sleep(600);
  const email = await wc.executeJavaScript(`document.getElementById('email').value`);
  console.log(email === 'coop@mailpigeon.vip' ? 'PASS http fill' : `FAIL http fill: ${JSON.stringify(email)}`);

  await wc.executeJavaScript(
    `document.getElementById('pw').value='s3cret';` +
      `document.querySelector('button').click(); true`,
  );
  await sleep(400);
  console.log(
    captured && captured.password === 's3cret' && captured.username === 'coop@mailpigeon.vip'
      ? 'PASS click capture'
      : `FAIL click capture: ${JSON.stringify(captured)}`,
  );

  server.close();
  app.exit(0);
});
