// Do before-input-event handlers fire for keys typed into a WebContentsView,
// and can focus be pulled back to the chrome renderer while the view holds it?
const { app, BrowserWindow, WebContentsView } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 900, height: 600 });
  await win.webContents.loadURL(
    'data:text/html,' + encodeURIComponent('<h1>chrome</h1><input id="a" style="width:300px">'),
  );

  const view = new WebContentsView({ webPreferences: { sandbox: true } });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 100, width: 900, height: 500 });
  await view.webContents.loadURL(
    'data:text/html,' + encodeURIComponent('<h1>page</h1><input id="b" style="width:300px">'),
  );

  let chromeFired = 0;
  let viewFired = 0;
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown') chromeFired++;
  });
  view.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown') viewFired++;
  });

  // Focus the page and click into its input, then send Ctrl+T to it.
  view.webContents.focus();
  await view.webContents.executeJavaScript(`document.getElementById('b').focus(); true`);
  await sleep(300);
  view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 't', modifiers: ['control'] });
  await sleep(300);
  console.log(`after ctrl+T to view: viewFired=${viewFired} chromeFired=${chromeFired}`);

  // Can we yank focus back to the chrome renderer?
  win.webContents.focus();
  await sleep(300);
  const chromeHasFocus = await win.webContents.executeJavaScript('document.hasFocus()');
  const viewHasFocus = await view.webContents.executeJavaScript('document.hasFocus()');
  console.log(`after win.webContents.focus(): chrome=${chromeHasFocus} view=${viewHasFocus}`);

  // Does focusing the input in the chrome work once focus is there?
  await win.webContents.executeJavaScript(`document.getElementById('a').focus(); true`);
  await sleep(200);
  const activeId = await win.webContents.executeJavaScript('document.activeElement.id');
  console.log(`chrome activeElement=${JSON.stringify(activeId)}`);

  app.exit(0);
});
