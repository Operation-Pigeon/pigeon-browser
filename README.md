# Pigeon Browser

A multi-identity browser built on Pigeon inboxes. Each inbox on the left rail
is a fully isolated browsing session (its own cookies, storage, cache, an
Electron `persist:` partition), with normal browser tabs along the top scoped
to that session, and a mail panel on the right showing that inbox's Pigeon
mail: fresh OTP codes surface with one-click copy, right next to the login
form that wants them.

Talks to the Pigeon API only (`api.mailpigeon.vip`). The webapp is just
another website it can browse to.

## The API client

`@operation-pigeon/client` is **generated** from the Smithy model in the
`pigeon` repo and published to GitHub Packages. Nothing here hand-writes a
request.

That is not a style preference. The client this replaced was hand-written
against v0, and when the API moved to v1 it went on sending `x-api-key` to
unversioned paths: every call answered `401`, the app was unusable, and
nothing in the codebase disagreed with itself. The same drift is now a
compile error.

Installing it needs a token with `read:packages`:

```sh
export NODE_AUTH_TOKEN=$(gh auth token)
npm install
```

`src/main/pigeonApi.ts` maps the generated shapes onto this app's own
vocabulary: `MailSummary`, `OtpHit`, and inbox **addresses** rather than ids,
because every session, tab, saved password and history row is keyed by
address.

## Run

```sh
npm install
npm run dev
```

First launch asks for a Pigeon API key (tenant key). Stored encrypted via
Electron `safeStorage` (OS keychain / DPAPI); it lives in the main process
and is never exposed to any web-facing renderer.

## Tunnels

Isolated cookies still leave from one IP address, and ten identities arriving
from one address have told the site they are one person. A tunnel gives an
inbox its own exit.

Set up in Settings > Tunnels. The app runs a [Mysterium](https://mysterium.network)
consumer node per inbox, connects it to a residential peer in a chosen
country, and points that inbox's session at the local proxy it offers. Paid
per gigabyte from one shared MYST identity, so a top-up happens once.

`src/main/exits.ts` owns the node processes. Four things it is built around,
each of which cost an evening:

- **Connections are addressed by proxy port.** `GET /connection` returns the
  unnamed default, which is genuinely NotConnected while yours runs fine
  alongside it. Everything uses `?id=<proxyPort>`.
- **Never pin a provider.** Most published proposals are stale and connecting
  to one fails exactly like a network fault. Connect by filter and let the
  node walk candidates.
- **Exits drop.** They are strangers' home connections, so supervision is the
  feature rather than a refinement of it. A dropped tunnel leaves the proxy
  port closed, so pages hold rather than silently leaking the real address.
- **Docker cannot do this.** Docker Desktop presents symmetric NAT and
  Mysterium is peer-to-peer, so the UDP hole punch never succeeds. The node
  binary has to run natively.

`tools/exits.js` is a headless launcher for the same thing, kept for test
runs that have no window.

## Autofill and personas

The Fill panel (wand icon, right bar) works on the page as it is now, which
the load-time autofill cannot: it never sees a form that mounts late or sits
behind a "Sign up" tab.

- **Email and password** from the saved credential for that inbox and origin.
  Credentials are looked up in main from the tab's own `(profile, origin)`;
  the panel asks for a fill and never says what to type.
- **Name, date of birth, location** from the inbox's persona, an invented
  person stored per inbox. Handles split or combined name fields, dates as one
  input, three boxes, dropdowns or radio groups, and country/state selects
  whose values are opaque ids.

Turn all invented data off in Settings > General. Enforced in main, so a stale
renderer cannot fill either.

## Colour groups

Right-click an inbox in the rail for a radial colour picker. Groups sort
together in palette order, fold away, and can have their tunnels switched on
or off as a set. Labels and fold state persist.

## Layout

The rail and mail panel are user-resizable: the renderer owns their widths and
pushes them to main, which positions the native `WebContentsView` to match.
`TOP_H` in `src/main/tabs.ts` is the one fixed dimension, and the renderer
measures the top chrome to keep it honest when the mirror bar appears.

## Debugging

`PIGEON_DEBUG_PORT=9222 npm run dev` exposes a CDP port. `tools/test-tunnels.js`
drives the running app over it, calling the same IPC the rail and settings
call, so a pass means the thing a person clicks works. Off unless asked for.

## v1 non-goals

Downloads manager, extensions.
