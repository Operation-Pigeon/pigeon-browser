// The case that failed in the app: typing into a rich (contenteditable)
// editor and a textarea, mirrored to a hidden follower, with identity fields
// still substituting per inbox.
// Run: npm run build && npx electron tools/test-mirror-typing.js
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const { join } = require('path');

// Never let an error pop Electron's modal dialog: it blocks the run forever
// with no output. Same for a hang.
process.on('uncaughtException', (e) => {
  console.log('HARNESS ERROR:', String(e).slice(0, 200));
  app.exit(1);
});
setTimeout(() => {
  console.log('HARNESS TIMEOUT');
  app.exit(1);
}, 60000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` want ${JSON.stringify(expected)}`}`);
}

const PAGE = `
<input type="email" id="email" name="email">
<textarea id="note"></textarea>
<div id="editor" contenteditable style="border:1px solid #999;min-height:40px"></div>`;

const KEY_NAMES = { ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc' };

// Hardware typing fires keyDown (what the agent listens for) and char (what
// actually inserts); a lone char event fires no keydown at all.
async function typeInto(wc, text) {
  for (const ch of text) {
    wc.sendInputEvent({ type: 'keyDown', keyCode: ch });
    wc.sendInputEvent({ type: 'char', keyCode: ch });
    wc.sendInputEvent({ type: 'keyUp', keyCode: ch });
    await new Promise((r) => setTimeout(r, 30));
  }
}

async function makeTab(win, partition, attachHidden) {
  const view = new WebContentsView({
    webPreferences: {
      partition,
      sandbox: true,
      preload: join(__dirname, '..', 'out', 'preload', 'tab.js'),
    },
  });
  // Both attached, as the app now does: the leader visible, followers
  // attached-but-invisible so they still receive input.
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  if (attachHidden) view.setVisible(false);
  await view.webContents.loadURL('data:text/html,' + encodeURIComponent(PAGE));
  return view.webContents;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 800, height: 600 });
  const leader = await makeTab(win, 'persist:inbox/leader@test');
  const follower = await makeTab(win, 'persist:inbox/follower@test', true);
  const FOLLOWER_ADDRESS = 'follower@mailpigeon.vip';

  // Stands in for MirrorController: focus tracking, key suppression on
  // identity fields, raw key dispatch otherwise.
  let focusedField = 'other';
  ipcMain.on('mirror:event', (e, event) => {
    // Late events arrive after the run finishes; dispatching into a
    // destroyed webContents is what crashed this harness before.
    if (follower.isDestroyed() || e.sender.isDestroyed() || e.sender.id !== leader.id) return;
    if (event.kind === 'focus') focusedField = event.target.field ?? 'other';
    if (event.kind === 'keystroke') {
      if (focusedField !== 'other') return; // identity/OTP never replay verbatim
      const { key, ctrl, shift, alt, meta } = event.stroke;
      const modifiers = [];
      if (ctrl) modifiers.push('control');
      if (shift) modifiers.push('shift');
      if (alt) modifiers.push('alt');
      if (meta) modifiers.push('meta');
      if (key.length === 1 && !ctrl && !meta) {
        follower.sendInputEvent({ type: 'char', keyCode: key, modifiers });
      } else {
        const keyCode = KEY_NAMES[key] ?? key;
        follower.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
        follower.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      }
      return;
    }
    let outgoing = event;
    if (event.kind === 'input' && event.target.field === 'email') {
      outgoing = { ...event, value: FOLLOWER_ADDRESS };
    }
    follower.send('mirror:apply', outgoing);
  });

  // Attaching the follower takes focus with it; the app restores it too.
  leader.focus();
  leader.send('mirror:role', 'leader');
  follower.send('mirror:role', 'follower');
  await sleep(300);

  // Type into the rich editor the way a person would: focus, then keys.
  await leader.executeJavaScript(`document.getElementById('editor').focus(); true`);
  await sleep(250);
  await typeInto(leader, 'hello rich');
  await sleep(500);
  check(
    'contenteditable mirrors',
    await follower.executeJavaScript(`document.getElementById('editor').textContent`),
    'hello rich',
  );

  // Textarea — the other thing the value-only path missed.
  await leader.executeJavaScript(`document.getElementById('note').focus(); true`);
  await sleep(250);
  await typeInto(leader, 'notes');
  await sleep(500);
  check(
    'textarea mirrors',
    await follower.executeJavaScript(`document.getElementById('note').value`),
    'notes',
  );

  // Identity: typing the leader's address must still land as the FOLLOWER's,
  // and the keystrokes themselves must not leak through.
  await leader.executeJavaScript(`document.getElementById('email').focus(); true`);
  await sleep(250);
  await leader.executeJavaScript(`
    const el = document.getElementById('email');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    setter.call(el, 'leader@mailpigeon.vip');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    true
  `);
  await typeInto(leader, 'xy');
  await sleep(500);
  check(
    'email substituted, keystrokes suppressed',
    await follower.executeJavaScript(`document.getElementById('email').value`),
    FOLLOWER_ADDRESS,
  );

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  app.exit(failures === 0 ? 0 : 1);
});
