// Asserts each inbox's session leaves through its own exit: distinct address,
// distinct /24, the country and ASN the config claims, and — with --hold —
// that the exit is still there an hour later rather than having been a node
// that dropped mid-run.
//
// Measured through session.fetch, so it reports the path the browser actually
// takes rather than what the config says it should.
//
// Run: npm run build && PIGEON_IDENTITIES=./identities.json npx electron tools/test-identity.js
//      add --hold to re-check stability after an hour
const { app, session } = require('electron');
const { readFileSync } = require('fs');

const HOLD = process.argv.includes('--hold');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`);
}

// Hosting ASNs read as datacenter no matter what the provider's marketing
// says. Not exhaustive; it catches the common ones and the point is to make
// a residential claim falsifiable rather than to classify every network.
const HOSTING = /ovh|hetzner|digitalocean|linode|vultr|m247|contabo|amazon|google|microsoft|choopa|leaseweb|datacamp/i;

async function exitFor(address) {
  const ses = session.fromPartition(`persist:inbox/${address}`);
  const response = await ses.fetch('https://ipinfo.io/json');
  return response.json();
}

app.whenReady().then(async () => {
  const file = process.env.PIGEON_IDENTITIES;
  if (!file) {
    console.log('set PIGEON_IDENTITIES to the identities file to test');
    app.exit(2);
    return;
  }
  const identities = JSON.parse(readFileSync(file, 'utf8'));
  const seen = new Map(); // ip -> inbox
  const first = new Map(); // inbox -> ip, for the --hold re-check

  for (const [address, identity] of Object.entries(identities)) {
    const ses = session.fromPartition(`persist:inbox/${address}`);
    await ses.setProxy({ proxyRules: identity.proxy ?? 'direct://' });

    let info;
    try {
      info = await exitFor(address);
    } catch (err) {
      check(`${address} reachable`, false, String(err).slice(0, 120));
      continue;
    }

    console.log(`\n${address} -> ${info.ip} ${info.country} ${info.org}`);
    first.set(address, info.ip);

    check(`${address} has an exit`, !!info.ip, 'no address returned');
    if (identity.expectCountry) {
      check(
        `${address} country`,
        info.country === identity.expectCountry,
        `got ${info.country}, want ${identity.expectCountry}`,
      );
    }
    if (identity.expectAsn) {
      check(
        `${address} asn`,
        (info.org || '').includes(identity.expectAsn),
        `got "${info.org}", want ${identity.expectAsn}`,
      );
    }
    check(
      `${address} is not a hosting ASN`,
      !HOSTING.test(info.org || ''),
      `"${info.org}" looks like a datacenter, not a residential ISP`,
    );

    // The failure that looks like success: two inboxes quietly sharing an
    // exit still load every page fine, and every other test passes for the
    // wrong reason.
    const prior = seen.get(info.ip);
    check(`${address} exit is its own`, !prior, `shares ${info.ip} with ${prior}`);
    seen.set(info.ip, address);

    // Same /24 is the same actor as far as anti-fraud is concerned, so
    // neighbouring addresses are barely better than one address.
    const subnet = info.ip.split('.').slice(0, 3).join('.') + '.';
    const neighbour = [...seen].find(([ip, who]) => who !== address && ip.startsWith(subnet));
    check(`${address} subnet is distinct`, !neighbour, `same /24 as ${neighbour && neighbour[1]}`);
  }

  if (HOLD) {
    console.log('\nholding an hour to see whether the exits survive...');
    await sleep(60 * 60 * 1000);
    for (const [address, before] of first) {
      let after = null;
      try {
        after = (await exitFor(address)).ip;
      } catch {
        /* reported as a failure below */
      }
      // A node that drops takes the address with it. Config these as static
      // per inbox and the app carries on with a silently different identity;
      // config them as rotating and the storage wipe keeps it coherent.
      check(`${address} exit held`, after === before, `was ${before}, now ${after ?? 'unreachable'}`);
    }
  }

  console.log(failures ? `\n${failures} failed` : '\nall good');
  app.exit(failures ? 1 : 0);
});
