// Drives the running app over its debug port and asserts the tunnel
// lifecycle: enable, unlink, and the state it lands in afterwards.
//
// This exercises the same IPC the rail and settings panel call, in the same
// renderer, so a pass means the thing a person clicks works. Nothing here is
// mocked.
//
// Run:  PIGEON_DEBUG_PORT=9222 npm run dev      (in one shell)
//       node tools/test-tunnels.js             (in another)
const PORT = process.env.PIGEON_DEBUG_PORT || '9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` - ${detail}`}`);
}

/** The app's own window, as opposed to any page it happens to be browsing. */
async function findChrome() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  return targets.find(
    (t) => t.type === 'page' && (t.url.includes('localhost:51') || t.url.includes('index.html')),
  );
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
  });
  const ready = new Promise((r) => ws.addEventListener('open', r));
  return {
    ready,
    close: () => ws.close(),
    /** Evaluate in the renderer and return the awaited value. */
    async evaluate(expression) {
      const msgId = ++id;
      const reply = new Promise((r) => pending.set(msgId, r));
      ws.send(
        JSON.stringify({
          id: msgId,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
      const msg = await reply;
      if (msg.result?.exceptionDetails) {
        throw new Error(msg.result.exceptionDetails.exception?.description ?? 'eval failed');
      }
      return msg.result?.result?.value;
    },
  };
}

async function main() {
  const target = await findChrome();
  if (!target) {
    console.log(`no app window on port ${PORT}. Start with PIGEON_DEBUG_PORT=${PORT} npm run dev`);
    process.exit(2);
  }
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;

  const setup = await cdp.evaluate('window.bridge.exits.setup()');
  console.log(`setup stage: ${setup.stage}, balance ${setup.balance}`);
  if (setup.stage !== 'ready') {
    console.log('account is not ready; link and fund an identity before running this');
    process.exit(2);
  }

  const inboxes = await cdp.evaluate(
    'window.bridge.pigeon.inboxes().then(r => r.inboxes.map(i => i.address))',
  );
  const inbox = inboxes[0];
  console.log(`using ${inbox}`);

  // 1. Enable, and wait for it to actually connect.
  await cdp.evaluate(`window.bridge.exits.enable(${JSON.stringify(inbox)}, 'GB')`);
  let state = null;
  for (let i = 0; i < 40; i++) {
    state = (await cdp.evaluate('window.bridge.exits.state()'))[inbox];
    if (state?.status === 'connected') break;
    await sleep(3000);
  }
  check('tunnel connects', state?.status === 'connected', `stuck at ${state?.status}`);

  // 2. Unlink. This is the case that was looping.
  await cdp.evaluate('window.bridge.exits.signOut(false)');

  // 3. Nothing should be left running or retrying.
  await sleep(15000);
  const after = await cdp.evaluate('window.bridge.exits.state()');
  const stillThere = Object.keys(after);
  check('no tunnels left after unlink', stillThere.length === 0, `still present: ${stillThere}`);

  // Give the supervisor several passes to misbehave if it is going to.
  await sleep(30000);
  const later = await cdp.evaluate('window.bridge.exits.state()');
  check(
    'nothing resurrects itself',
    Object.keys(later).length === 0,
    `reappeared: ${JSON.stringify(later)}`,
  );

  // The weak version of this check passed while the app sat wedged on
  // "starting" for ever, because a stuck app also reports no identity. What
  // matters is that the control node came back and the panel is usable again.
  let setupAfter = null;
  for (let i = 0; i < 30; i++) {
    setupAfter = await cdp.evaluate('window.bridge.exits.setup()');
    if (setupAfter.stage !== 'starting') break;
    await sleep(2000);
  }
  check(
    'setup settles, not stuck starting',
    setupAfter.stage !== 'starting',
    `stage is ${setupAfter.stage}`,
  );
  check(
    'a usable stage',
    ['no-identity', 'unregistered', 'unfunded', 'ready'].includes(setupAfter.stage),
    `stage is ${setupAfter.stage}`,
  );

  cdp.close();
  console.log(failures ? `\n${failures} failed` : '\nall good');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
