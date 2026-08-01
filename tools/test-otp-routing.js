// A code landing in the inbox you're driving pops a card; a code landing in
// any other inbox only marks that inbox in the rail.
//
// Drives the shipped app against a local stand-in API (PIGEON_API_URL, which
// the client already honours) rather than patching the page: the contextBridge
// object is frozen, so assigning over window.bridge.pigeon silently does
// nothing and the app just keeps talking to production.
// Run: npm run build && npx electron tools/test-otp-routing.js
const { createServer } = require('http');

const ACTIVE = 'john6@mailpigeon.vip';
const OTHER = 'john5@mailpigeon.vip';

// Seeded BEFORE the app boots: the "already there at startup" case only
// means anything if the code is present for the app's very first poll.
let otpFor = 'john6@mailpigeon.vip';
let mailId = 'seed';

const inbox = (address) => ({
  address,
  displayName: address.split('@')[0],
  createdAt: '2026-07-01T00:00:00Z',
  unread: 0,
  otp:
    address === otpFor
      ? {
          code: '123456',
          confidence: 'HIGH',
          mailId,
          from: [{ email: 'noreply@example.com', name: 'Example' }],
          subject: 'Your code',
          receivedAt: new Date().toISOString(),
        }
      : null,
});

const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/me') return res.end(JSON.stringify({ tenantId: 't_test', name: 'test' }));
  if (req.url === '/inboxes') {
    return res.end(JSON.stringify({ inboxes: [inbox(ACTIVE), inbox(OTHER)] }));
  }
  if (req.url.includes('/emails')) return res.end(JSON.stringify({ emails: [] }));
  res.end('{}');
});

server.listen(0, '127.0.0.1', () => {
  process.env.PIGEON_API_URL = `http://127.0.0.1:${server.address().port}`;
  run();
});

function run() {
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
  }, 120000);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let failures = 0;
  const check = (name, ok, detail) => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  };

  require('../out/main/index.js');

  const POPUP = `document.querySelectorAll('.fixed.right-4.bottom-4 .font-mono').length`;
  const BADGE = `document.querySelectorAll('[title^="Code arrived here"]').length`;
  // Poll is 10s; give each phase a poll plus slack.
  const POLL = 13000;

  app.whenReady().then(async () => {
    await sleep(5000);
    const win = BrowserWindow.getAllWindows()[0];
    win.focus();
    const js = (code) => win.webContents.executeJavaScript(code);
    await js(`window.bridge.tabs.setProfile('${ACTIVE}')`);
    await sleep(2000);

    // Codes already there when the app starts are history, not news.
    await sleep(POLL);
    check('code present at first poll stays silent', (await js(POPUP)) === 0);

    mailId = 'mail-active';
    await sleep(POLL);
    check('new code for the active inbox pops a card', (await js(POPUP)) > 0);
    check('...and does not badge the rail', (await js(BADGE)) === 0);

    // Clear every card, not just the first — a leftover would masquerade as
    // a pop for the next phase.
    await js(`document.querySelectorAll('.fixed.right-4.bottom-4 [title="Dismiss"]')
      .forEach((b) => b.click())`);
    await sleep(800);
    check('dismiss clears the cards', (await js(POPUP)) === 0);

    otpFor = OTHER;
    mailId = 'mail-other';
    await sleep(POLL);
    check('code for another inbox does not pop', (await js(POPUP)) === 0);
    check('code for another inbox badges the rail', (await js(BADGE)) === 1);

    await js(`[...document.querySelectorAll('button')]
      .find((b) => b.textContent.includes('${OTHER}'))?.click()`);
    await sleep(2000);
    check('badge clears when you open that inbox', (await js(BADGE)) === 0);

    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
    app.exit(failures === 0 ? 0 : 1);
  });
}
