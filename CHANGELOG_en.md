[Chinese changelog](CHANGELOG.md) | English changelog

# Changelog

## Unreleased

- Fix startup latency by removing about 60 seconds of port polling and keep-alive waits from
  host `apply()`. Write the link once after dependencies are ready and again on reactivation;
  file-write failures do not block startup. Browser prefetch, refresh and click behaviour stay unchanged.
- Add regression coverage for startup without polling, reactivation, diagnostics and route disposal;
  correct the documented service startup order.
- Verified on 2026-10-25: all 18 tests and syntax checks passed. A local restart without debugger
  flags showed the window in 5.04 seconds, down from 65.38 seconds before the fix. Link-file and
  route checks passed (401 unauthenticated, 200 authenticated); browser opening was not retested.
- The button now mirrors ds-bot's sidebar-footer button (`.bt-return`) pill look: transparent
  fill, no border, `border-radius:999px`, 36px tall, 14px/20px text, gray hover wash
  (`rgba(127,127,127,.14)`), `scale(.96)` on press. ds-bot's own avatar mark is not copied —
  the plugin's icon and text stay unchanged. The collapsed-rail icon button shrinks from
  40×40 to a 36×36 circle accordingly.
- Error/success feedback switches from ring recoloring to **text tinting** (red/green), since
  the new look has no border to recolor.

## 0.2.1 — accepted, archived (accepted 2026-10-23, frozen release)

This is the accepted release: the desktop button opens the live token-bearing Web UI in the system
default browser, and the browser half is gated to the desktop shell (`dsh-app://app`). Process docs
were moved to `docs/archive/`; a source snapshot lives in `release/`.

- Layout: the footer button now stacks **vertically** with sibling footer actions (e.g. the
  goal-queue button) via `div[class*=_footerActions]:has(.wul-root){flex-direction:column}` —
  the host container is a flex row by default, which squeezed both buttons horizontally.
  The selector uses a **descendant** `:has` (not child `:has(> …)`): the slot renderer wraps
  registered entries, so the earlier child-combinator rule never matched on the desktop app.
- The button is compact (text-fit height, `padding:5px 10px`, line-height 1.45) and full-width,
  sharing the host `--dsw-alias-button-tool-bar-fill` background with the queue button; the
  collapsed rail still shows a 40×40 icon centered.
- Click reliability: the live URL is **prefetched** at mount and refreshed every 10s, so a click
  calls `window.open` **synchronously inside the click handler's own call stack** (transient user
  activation visible to Chromium) instead of from an async `.then`, where the desktop shell could
  silently drop the popup before `setWindowOpenHandler` ran. Only when the cache is stale (>30s)
  does the click fall back to the async fetch path. A 1.2s cooldown prevents one physical click
  from emitting `window.open` twice (observed on the desktop shell).
- **Desktop root cause found**: the desktop GUI page runs on a custom scheme (`dsh-app://app`)
  proxied by Electron, and the old origin rewrite turned the target into `dsh-app://app/?token=…`,
  which the shell's `setWindowOpenHandler` (http/https-only → `shell.openExternal`) silently
  denied. The target is now rewritten to the page origin **only when the page itself is an
  http(s) origin**; on `dsh-app:` the host-provided `http://127.0.0.1:<port>` URL is used as-is.
- Console diagnostics: `[web-ui-linker] window.open -> <target> activation=<bool>` logs whether
  `navigator.userActivation.isActive` held at open time.
- DOM probe: ~800ms after mounting, the button answers back a one-line ancestor chain plus the
  computed `flexDirection` of the footer-actions container through
  `GET /web-ui-linker/url?probe=…`; clicks tag requests with `?src=click`. Both land (throttled)
  in `web-ui-url.status.txt` as `probe chain[...] dir=… kids=…` and `route answered <status>
  src:…` — layout/click evidence without DevTools.
- Diagnostics for click handling: the route logs throttled `route answered <status>` lines to
  `web-ui-url.status.txt`, and the button flashes "已请求打开" ("open requested", green outline,
  2.5s) after a successful request.
- Desktop-only gate: `apply()` returns early unless the page runs on the shell's custom
  `dsh-app://app` origin (the same test the shell preload uses to expose `window.dshDesktop`).
  In a plain browser the Web UI *is* the page, so the bundle now loads with zero side effects —
  no slot registration, no CSS, no prefetch, no probes. CSS injection moved from module scope
  into `ensureCss()`, called only after the gate passes. The host half (route + link/status
  files) intentionally stays active everywhere: it has no UI side effects and keeps the CLI
  test rig usable.
- Tests: `onServe`/`onProbe` observers covered (`src` tag passthrough; authenticated probe
  reaches `onProbe`, rejected requests never probe) — 14 total.

## 0.2.0

- New browser half: a sidebar-footer button (`sidebar.footer.action`, id `web-ui-linker`) in the
  Web GUI. One click opens the live token-bearing Web UI URL in the **system default browser**
  (inside the desktop app this is `shell.openExternal`; in a real browser it is a new tab).
- New host route `GET /web-ui-linker/url`: returns
  `{url, clean, token, origin, generatedAt}` recomputed on every request, `cache-control: no-store`,
  gated by `connection.admit` (401 unauthenticated, 403 untrusted Host, 405 non-GET/HEAD,
  503 before the web listener binds).
- Remote/proxy access: when the host answer carries a different origin than the page, the button
  rebuilds the URL on the page's own origin and keeps the token.
- `package.json` now exports `./client` and declares the `dsh.client` bundle entry
  (platform `web`, inject `@deepseek-ai/dsh-client-runtime`); engines pin `dsh >=0.2.1-rc.2 <0.2.2`.
- File-writing behavior (`web-ui-url.txt`, `web-ui-url.status.txt`) is unchanged.
- Tests: `node --test test/route.test.js` covers the route's auth/method/status paths.

## 0.1.0

- Initial release: writes the live browser-authenticated Web UI link
  (`connection.authenticatedUrl`) to `web-ui-url.txt` once per boot, with a diagnostics trail in
  `web-ui-url.status.txt`.
