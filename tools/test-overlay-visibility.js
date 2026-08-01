// The bookmarks dropdown bug: it opens, main hides the page view so the menu
// is on top, then any tab switch / create / close runs showActive(), which
// used to setVisible(true) unconditionally. The native view came back over
// the chrome and swallowed hover and clicks while the menu still looked open.
// Run: npm run build && npx electron tools/test-overlay-visibility.js
const { app, BrowserWindow, WebContentsView } = require('electron');

// This Electron has no View#getVisible, so record the calls instead — which
// is the behaviour under test anyway: who flips the page view back on.
const visibility = new WeakMap();
const realSetVisible = WebContentsView.prototype.setVisible;
WebContentsView.prototype.setVisible = function (v) {
  visibility.set(this, v);
  if (v && process.env.TRACE_SHOW) {
    console.log('  [setVisible true]', new Error().stack.split('\n').slice(1, 4).join(' | '));
  }
  return realSetVisible.call(this, v);
};

process.on('uncaughtException', (e) => {
  console.log('HARNESS ERROR:', String(e).slice(0, 300));
  app.exit(1);
});
// A rejected executeJavaScript strands the whole chain with zero output —
// surface it instead of letting the run look like a hang.
process.on('unhandledRejection', (e) => {
  console.log('HARNESS REJECTION:', String(e).slice(0, 300));
  app.exit(1);
});
setTimeout(() => {
  console.log('HARNESS TIMEOUT');
  app.exit(1);
}, 60000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Positive assertions race tab creation and page load; give them room. */
async function waitFor(cond, ms = 6000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await sleep(200);
  }
  return false;
}
let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}

require('../out/main/index.js');

// The page view is whichever child view isn't the chrome — the chrome is the
// window's own webContents, which isn't in contentView's children.
const pageViews = (win) => win.contentView.children.filter((v) => v.webContents);
// Never-set means visible: views start visible.
const anyVisible = (win) => pageViews(win).some((v) => (visibility.has(v) ? visibility.get(v) : true));

app.whenReady().then(async () => {
  await sleep(5000);
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    console.log('HARNESS ERROR: no window');
    return app.exit(1);
  }
  win.focus();

  const tabsApi = {
    setProfile: (p) => win.webContents.executeJavaScript(`window.bridge.tabs.setProfile(${JSON.stringify(p)})`),
    create: (p, url) =>
      win.webContents.executeJavaScript(`window.bridge.tabs.create(${JSON.stringify(p)}, ${JSON.stringify(url)}, false)`),
    // v=false means hide, matching the old setContentVisible signature.
    hideContent: (v) => win.webContents.executeJavaScript(`window.bridge.tabs.setOverlay('bookmarks', ${!v})`),
  };

  const PROFILE = 'john6@mailpigeon.vip';
  await tabsApi.setProfile(PROFILE);
  await tabsApi.create(PROFILE, 'data:text/html,<h1>page one</h1>');
  check('page view visible normally', await waitFor(() => anyVisible(win)));
  // Let creation fully settle before hiding: a tab still being wired up runs
  // showActive() again, and the point here is what happens AFTER things
  // are stable, not mid-flight.
  await sleep(2500);

  // --- open the dropdown ---------------------------------------------------
  await tabsApi.hideContent(false);
  await sleep(600);
  check('page hidden while dropdown open', anyVisible(win) === false);

  // --- the regression: a new tab arrives while the menu is open ------------
  await tabsApi.create(PROFILE, 'data:text/html,<h1>page two</h1>');
  await sleep(2000);
  check(
    'page STAYS hidden when a tab opens under the dropdown',
    anyVisible(win) === false,
    anyVisible(win) ? 'view came back over the menu — links unclickable' : '',
  );

  // --- and on a profile switch --------------------------------------------
  await tabsApi.setProfile('john5@mailpigeon.vip');
  await sleep(1500);
  const afterSwitchAway = anyVisible(win);
  await tabsApi.setProfile(PROFILE);
  await sleep(1500);
  const states = pageViews(win).map((v) => (visibility.has(v) ? visibility.get(v) : 'unset'));
  check(
    'page STAYS hidden across a profile switch',
    anyVisible(win) === false,
    `awaySwitch=${afterSwitchAway} views=[${states.join(',')}]`,
  );

  // --- closing the dropdown restores the page ------------------------------
  await tabsApi.hideContent(true);
  check('page returns when the dropdown closes', await waitFor(() => anyVisible(win)));

  // --- reloading the chrome must not strand a hidden page ------------------
  await tabsApi.hideContent(false);
  await sleep(500);
  win.webContents.reload();
  check('chrome reload un-hides the page', await waitFor(() => anyVisible(win)));

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  app.exit(failures === 0 ? 0 : 1);
});
