// Does sendInputEvent reach a HIDDEN WebContentsView (a background follower
// tab)? Everything about the hybrid mirror rests on this.
// Run: npx electron tools/test-rawinput.js
const { app, BrowserWindow, WebContentsView } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` want ${JSON.stringify(expected)}`}`);
}

const PAGE = `
<div id="box" style="position:absolute;left:50px;top:50px;width:200px;height:80px;background:#eee"></div>
<input id="text" style="position:absolute;left:50px;top:200px;width:300px">
<div id="editor" contenteditable style="position:absolute;left:50px;top:260px;width:300px;height:80px;border:1px solid #999"></div>
<div id="scroller" style="position:absolute;left:400px;top:50px;width:200px;height:150px;overflow:auto">
  <div style="height:2000px"></div>
</div>
<span id="clicks">0</span>
<script>
  document.getElementById('box').addEventListener('click', () => {
    const c = document.getElementById('clicks');
    c.textContent = String(Number(c.textContent) + 1);
  });
<\/script>`;

async function makeView(win, attach) {
  const view = new WebContentsView({ webPreferences: { sandbox: true } });
  if (attach) {
    win.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 900, height: 700 });
  }
  await view.webContents.loadURL('data:text/html,' + encodeURIComponent(PAGE));
  return view;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 900, height: 700 });
  await win.webContents.loadURL('data:text/html,' + encodeURIComponent('<h1>chrome</h1>'));

  // The realistic follower: created but never attached to the window.
  const hidden = await makeView(win, false);
  const wc = hidden.webContents;
  // Followers are laid out even while detached, so coordinates line up.
  hidden.setBounds({ x: 0, y: 0, width: 900, height: 700 });
  await sleep(300);

  // 1. Click by coordinate.
  wc.sendInputEvent({ type: 'mouseDown', x: 100, y: 80, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: 100, y: 80, button: 'left', clickCount: 1 });
  await sleep(400);
  check('click reaches hidden view', await wc.executeJavaScript(`document.getElementById('clicks').textContent`), '1');

  // 2. Typing into a focused input.
  await wc.executeJavaScript(`document.getElementById('text').focus(); true`);
  for (const ch of 'hey') {
    wc.sendInputEvent({ type: 'char', keyCode: ch });
  }
  await sleep(400);
  check('keys reach hidden view', await wc.executeJavaScript(`document.getElementById('text').value`), 'hey');

  // 3. Typing into contenteditable — the case the DOM path couldn't do.
  await wc.executeJavaScript(`document.getElementById('editor').focus(); true`);
  for (const ch of 'rich') {
    wc.sendInputEvent({ type: 'char', keyCode: ch });
  }
  await sleep(400);
  check('contenteditable takes keys', await wc.executeJavaScript(`document.getElementById('editor').textContent`), 'rich');

  // 4. Wheel scrolling.
  wc.sendInputEvent({ type: 'mouseWheel', x: 500, y: 100, deltaX: 0, deltaY: -200, canScroll: true });
  await sleep(500);
  const scrolled = await wc.executeJavaScript(`document.getElementById('scroller').scrollTop`);
  check('wheel scrolls hidden view', scrolled > 0, true);

  // 5. elementFromPoint agrees with where we clicked (the guard's basis).
  const at = await wc.executeJavaScript(`document.elementFromPoint(100, 80)?.id`);
  check('elementFromPoint matches coordinates', at, 'box');

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  app.exit(failures === 0 ? 0 : 1);
});
