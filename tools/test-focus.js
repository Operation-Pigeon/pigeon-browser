// Reproduces the orphaned-focus bug: after swapping the attached
// WebContentsView, does the on-screen view still receive keys?
const { app, BrowserWindow, WebContentsView } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeView(win, label) {
  const view = new WebContentsView({ webPreferences: { sandbox: true } });
  await view.webContents.loadURL('data:text/html,' + encodeURIComponent(`<h1>${label}</h1>`));
  return view;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 900, height: 600 });
  await win.webContents.loadURL('data:text/html,' + encodeURIComponent('<h1>chrome</h1>'));

  const a = await makeView(win, 'A');
  const b = await makeView(win, 'B');
  let fired = 0;
  b.webContents.on('before-input-event', (_e, i) => {
    if (i.type === 'keyDown') fired++;
  });

  // Attach A, focus it (user clicking the page).
  win.contentView.addChildView(a);
  a.setBounds({ x: 0, y: 80, width: 900, height: 500 });
  a.webContents.focus();
  await sleep(300);

  // Swap to B the way TabManager does.
  win.contentView.removeChildView(a);
  win.contentView.addChildView(b);
  b.setBounds({ x: 0, y: 80, width: 900, height: 500 });
  await sleep(300);

  const beforeFocus = await b.webContents.executeJavaScript('document.hasFocus()');
  b.webContents.focus(); // the fix
  await sleep(300);
  const afterFocus = await b.webContents.executeJavaScript('document.hasFocus()');

  console.log(`swapped view hasFocus: before=${beforeFocus} afterExplicitFocus=${afterFocus}`);
  console.log(fired >= 0 ? 'handler attached' : '');
  app.exit(0);
});
