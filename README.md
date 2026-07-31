# Pigeon Browser

A multi-identity browser built on Pigeon inboxes. Each inbox on the left rail
is a fully isolated browsing session (its own cookies, storage, cache — an
Electron `persist:` partition), with normal browser tabs along the top scoped
to that session, and a mail panel on the right showing that inbox's Pigeon
mail — fresh OTP codes surface with one-click copy, right next to the login
form that wants them.

Talks to the Pigeon API only (`api.mailpigeon.vip`) — the webapp is just
another website it can browse to.

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
