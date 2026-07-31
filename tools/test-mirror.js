// Mirrors a click and typing from a leader page into a follower page, using
// the real tab preload. Also asserts identity substitution: the email field
// must receive the FOLLOWER's address, and OTP fields must not mirror.
// Run: npm run build && npx electron tools/test-mirror.js
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const { join } = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` want ${JSON.stringify(expected)}`}`,
  );
}

const PAGE =
  '<form id="f">' +
  '<input type="email" id="email" name="email">' +
  '<input type="text" id="nick" name="nickname">' +
  '<input type="text" id="otp" name="otp_code" autocomplete="one-time-code">' +
  '<button type="button" id="go">Go</button>' +
  '<span id="clicks">0</span>' +
  '</form>' +
  '<script>document.getElementById("go").addEventListener("click",()=>{' +
  'const c=document.getElementById("clicks");c.textContent=String(Number(c.textContent)+1);});<\/script>';

async function makeTab(win, partition) {
  const view = new WebContentsView({
    webPreferences: {
      partition,
      sandbox: true,
      preload: join(__dirname, '..', 'out', 'preload', 'tab.js'),
    },
  });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  await view.webContents.loadURL('data:text/html,' + encodeURIComponent(PAGE));
  return view.webContents;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 600 });
  const leader = await makeTab(win, 'persist:inbox/leader@test');
  const follower = await makeTab(win, 'persist:inbox/follower@test');

  // Stand in for main's routing + substitution.
  const FOLLOWER_ADDRESS = 'follower@mailpigeon.vip';
  ipcMain.on('mirror:event', (e, event) => {
    if (e.sender.id !== leader.id) return;
    let outgoing = event;
    if (event.kind === 'input') {
      if (event.target.field === 'otp') return; // never mirrored
      if (event.target.field === 'email') outgoing = { ...event, value: FOLLOWER_ADDRESS };
    }
    follower.send('mirror:apply', outgoing);
  });

  leader.send('mirror:role', 'leader');
  follower.send('mirror:role', 'follower');
  await sleep(300);

  // Type into three fields on the leader.
  await leader.executeJavaScript(`
    function type(id, v) {
      const el = document.getElementById(id);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    type('email','leader@mailpigeon.vip');
    type('nick','shared-nickname');
    type('otp','123456');
    document.getElementById('go').click();
    true
  `);
  await sleep(600);

  const state = await follower.executeJavaScript(`({
    email: document.getElementById('email').value,
    nick: document.getElementById('nick').value,
    otp: document.getElementById('otp').value,
    clicks: document.getElementById('clicks').textContent,
  })`);

  check('email substituted per inbox', state.email, FOLLOWER_ADDRESS);
  check('ordinary field mirrored', state.nick, 'shared-nickname');
  check('otp NOT mirrored', state.otp, '');
  check('click mirrored', state.clicks, '1');

  // Paused/off followers must ignore everything.
  follower.send('mirror:role', 'off');
  await sleep(200);
  await leader.executeJavaScript(`document.getElementById('go').click(); true`);
  await sleep(400);
  const afterPause = await follower.executeJavaScript(
    `document.getElementById('clicks').textContent`,
  );
  check('paused follower ignores events', afterPause, '1');

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  app.exit(failures === 0 ? 0 : 1);
});
