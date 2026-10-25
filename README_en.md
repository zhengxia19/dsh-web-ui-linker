[中文文档](README.md) | English

# dsh-web-ui-linker

A tiny [DeepSeek Harness](https://github.com/deepseek-ai) (dsh) plugin with two jobs:

1. On every dsh boot, ask this instance's own `connection` service for its browser-authenticated
   Web UI link (`connection.authenticatedUrl(cleanBaseUrl)`) and write it to a fixed file,
   overwriting the previous one.
2. In the **desktop app's** Web GUI, put one button at the sidebar footer (beside the settings
   icon) that opens that live link — token included — in the **system default browser**.

It registers exactly one route, `GET /web-ui-linker/url`, gated by `connection.admit` (browser
authentication plus host-origin trust), and touches nothing that could restart or interrupt the
instance.

## The button (desktop shell only)

The browser half (`lib/client.js`, a hand-written module-loader bundle — no bundler needed) is
gated to the desktop shell: `apply()` returns early unless the page runs on the shell's custom
`dsh-app://app` origin (the same test the shell preload uses to expose `window.dshDesktop`). In a
plain browser the Web UI *is* the page, so the bundle loads with zero side effects — no slot
registration, no CSS, no prefetch, no probes.

Inside the desktop GUI the button registers at `sidebar.footer.action` (id `web-ui-linker`,
`order: 120`) and stacks **vertically** with sibling footer actions (e.g. the goal-queue button)
via a `:has`-guarded flex-column rule; in the collapsed rail it shows a centered 36×36 round
icon button. Its look mirrors ds-bot's sidebar-footer button (`.bt-return`): borderless pill,
transparent fill, `border-radius:999px`, 36px tall, 14px/20px text, gray wash on hover,
`scale(.96)` on press — without ds-bot's own avatar mark; only this plugin's icon and text stay.

Click behaviour:

- The live URL is **prefetched** at mount and refreshed every 10s, so a click calls `window.open`
  **synchronously inside the click handler's own call stack** (transient user activation visible
  to Chromium). Only when the cache is stale (>30s) does the click fall back to the async fetch
  path. A 1.2s cooldown keeps one physical click from emitting `window.open` twice.
- The host recomputes the reading live, so every click carries a fresh token. The target is the
  host-provided `http://127.0.0.1:<port>/?token=…`; the shell's `setWindowOpenHandler`
  (http/https-only) hands it to `shell.openExternal` → your **system default browser**. No Electron
  popup.
- Origin rewrite safety belt: only when the *page itself* is an http(s) origin and it differs from
  the host answer, the button rebuilds the URL on the page's own origin and keeps the token
  (remote/proxy access). On `dsh-app:` pages the host URL is used as-is — rewriting it to
  `dsh-app://app/?token=…` would be silently denied by the shell handler.
- Errors (expired page cookie, service not ready) show as red text plus a tooltip (auto-clears
  after 6s, button text switches to 重试 ("retry")); a successful click flashes "已请求打开"
  ("open requested") in green text for 2.5s. Nothing else moves.

## Diagnostics (no DevTools needed)

- ~800ms after mounting, the button answers back a one-line ancestor chain plus the computed
  `flexDirection` of the footer-actions container through `GET /web-ui-linker/url?probe=…`;
  clicks tag requests with `?src=click`. Both land (throttled) in `web-ui-url.status.txt` as
  `probe chain[…] dir=… kids=… page=…` and `route answered <status> src:…`.
- Each open logs `[web-ui-linker] window.open -> <target> activation=<bool>` to the page console.

## Output

| File / route | Content |
| --- | --- |
| `web-ui-url.txt` | The authenticated URL, plus a comment with the write time, pid, and the clean origin |
| `web-ui-url.status.txt` | Diagnostics trail, so a failure is distinguishable from an unmounted plugin |
| `GET /web-ui-linker/url` | JSON `{url, clean, token, origin, generatedAt}`, recomputed per request, `cache-control: no-store` |

Both files are runtime artifacts and are gitignored — `web-ui-url.txt` contains a live session token.

## How it works

The plugin injects `connection` and `webServer`. In the installed host, WebServer initialization
awaits its bound port, and Cordis activates dependent plugins once their services are ready.
`apply()` registers the route, generates and writes the authenticated link once, then returns
immediately. The host half has no polling or keep-alive timers. A dependency reload reactivates
the plugin and updates the file. The launch token stays stable within the application root
context; the HTTP route still computes the link from the current services on every request.
File-write failures or an unexpectedly missing port are diagnosed without retrying or delaying
startup. The route remains registered and returns `503 web-server-not-ready` if the port is absent.
Unauthenticated local processes get `401`,
untrusted `Host` headers get `403` — the token never leaks to a local curl without credentials.
The host half (route + link/status files) intentionally stays active on every boot, desktop or CLI;
only the browser half is desktop-gated.

The browser's initial prefetch, 10-second refresh and 30-second cache lifetime are unchanged,
preserving synchronous browser opening from clicks without holding up host startup. The removed
host loop used to wait about 60 seconds even after writing the link, delaying Host readiness and
the desktop window.

## Usage

Bundle it into a dsh profile through its patch entry (`cordis.patch.yml`):

```json
{
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

Requires Node.js >= 22 and dsh `>=0.2.1-rc.2 <0.2.2` (pinned: the open behaviour depends on the
shell's `setWindowOpenHandler`). Tests: `npm test`, covering routes, startup without polling,
reactivation, failure diagnostics and route disposal. Tests create link/status files; run them
in a temporary copy while a real instance is running to preserve its diagnostic files.
Archived process docs live in [`docs/archive/`](<docs/archive/改造任务清单-V1.0-过程文档.md>)
(Chinese). MIT licensed.
