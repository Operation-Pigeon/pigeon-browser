// Follow-up: does an ATTACHED but visually covered view accept coordinate
// input? Determines whether followers can take real mouse/wheel events.
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
<div id="scroller" style="position:absolute;left:400px;top:50px;width:200px;height:150px;overflow:auto"><div style="height:2000px"></div></div>
<span id="clicks">0</span>
<script>document.getElementById('box').addEventListener('click',()=>{const c=document.getElementById('clicks');c.textContent=String(Number(c.textContent)+1);});<\/script>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 900, height: 700 });
  await win.webContents.loadURL('data:text/html,' + encodeURIComponent('<h1>chrome</h1>'));

  const bounds = { x: 0, y: 0, width: 900, height: 700 };
  const back = new WebContentsView({ webPreferences: { sandbox: true } });
  const front = new WebContentsView({ webPreferences: { sandbox: true } });

  // Both attached; `front` added last, so it covers `back` entirely.
  win.contentView.addChildView(back);
  back.setBounds(bounds);
  win.contentView.addChildView(front);
  front.setBounds(bounds);

  await back.webContents.loadURL('data:text/html,' + encodeURIComponent(PAGE));
  await front.webContents.loadURL('data:text/html,' + encodeURIComponent(PAGE));
  await sleep(500);

  const wc = back.webContents; // the covered one — stands in for a follower
  wc.sendInputEvent({ type: 'mouseDown', x: 100, y: 80, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: 100, y: 80, button: 'left', clickCount: 1 });
  await sleep(400);
  check('covered view takes clicks', await wc.executeJavaScript(`document.getElementById('clicks').textContent`), '1');

  check('covered view has layout', await wc.executeJavaScript(`document.elementFromPoint(100,80)?.id`), 'box');

  wc.sendInputEvent({ type: 'mouseWheel', x: 500, y: 100, deltaX: 0, deltaY: -200, canScroll: true });
  await sleep(500);
  check(
    'covered view scrolls',
    (await wc.executeJavaScript(`document.getElementById('scroller').scrollTop`)) > 0,
    true,
  );

  // And with setVisible(false) — cheaper, but does it keep layout?
  back.setVisible(false);
  await sleep(300);
  wc.sendInputEvent({ type: 'mouseDown', x: 100, y: 80, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: 100, y: 80, button: 'left', clickCount: 1 });
  await sleep(400);
  check(
    'setVisible(false) view still takes clicks',
    await wc.executeJavaScript(`document.getElementById('clicks').textContent`),
    '2',
  );

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  app.exit(0);
});
