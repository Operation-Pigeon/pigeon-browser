# Pigeon Browser

A multi-identity browser built on Pigeon inboxes. Each inbox on the left rail
is a fully isolated browsing session (its own cookies, storage, cache — an
Electron `persist:` partition), with normal browser tabs along the top scoped
to that session, and a mail panel on the right showing that inbox's Pigeon
mail — fresh OTP codes surface with one-click copy, right next to the login
form that wants them.

Talks to the Pigeon API only (`api.mailpigeon.vip`) — the webapp is just
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
vocabulary — `MailSummary`, `OtpHit`, and inbox **addresses** rather than ids,
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

## Layout contract

`RAIL_W` / `TOP_H` / `PANEL_W` in `src/main/tabs.ts` position the native
`WebContentsView`; the renderer's Tailwind classes (`w-56`, `h-[84px]`,
`w-96`) must agree. Change one, change both.

## v1 non-goals

Bookmarks, history UI, downloads manager, extensions, packaging.
