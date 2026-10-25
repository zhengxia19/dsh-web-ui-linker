/* dsh-web-ui-linker — browser half: one sidebar-footer button that opens the
 * live token-bearing Web UI URL in the system default browser. No bundler
 * required: the bundle registers itself with the platform module loader. */
window.__ModuleLoader__.load({
  id: 'dsh-web-ui-linker',
  factory: function (require) {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement

    function ensureCss() {
      var CSS_ID = 'dsh-web-ui-linker-css'
      if (document.getElementById(CSS_ID) !== null) return
      var style = document.createElement('style')
      style.id = CSS_ID
      style.textContent = [
        // Stack the footer-action row into a column when our button is inside
        // it, so it never squeezes horizontally against sibling occupants (the
        // goal-queue button already expects width:100% / vertical stacking).
        // Descendant :has (not child) because slot renderers may wrap entries.
        'div[class*=_footerActions]:has(.wul-root){flex-direction:column;align-items:stretch}',
        'div[class*=_collapsed] div[class*=_footerActions]:has(.wul-root){align-items:center}',
        '.wul-root{display:flex;width:100%;min-width:0}',
        '.wul-narrow{justify-content:center}',
        // Look mirrors ds-bot's sidebar-footer button (.bt-return): borderless
        // pill, transparent fill, 36px tall, 14px/20px text, gray wash on
        // hover, scale-down on press. Only the text (and our own glyph) stays —
        // ds-bot's own avatar mark is deliberately not copied.
        '.wul-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;min-width:0;box-sizing:border-box;min-height:36px;padding:0 14px;border:0;border-radius:999px;background:none;color:inherit;font:inherit;font-size:14px;line-height:20px;cursor:pointer;transition:background-color .12s ease}',
        '.wul-button:hover{background:rgba(127,127,127,.14)}',
        '.wul-button:active:not(:disabled){transform:scale(.96)}',
        '.wul-button:disabled{opacity:.45;cursor:default}',
        '.wul-narrow .wul-button{justify-content:center;width:36px;min-width:36px;height:36px;padding:0}',
        '.wul-narrow .wul-text{display:none}',
        '.wul-icon{flex:none;width:18px;height:18px}',
        // No border to recolor anymore, so error/flash states tint the text.
        '.wul-button.wul-has-error{color:var(--dsw-alias-state-error-primary,#d44)}',
        '.wul-button.wul-flash{color:var(--dsw-alias-state-success-primary,#6b6)}',
      ].join('\n')
      document.head.appendChild(style)
    }

    function Icon() {
      // External-link glyph: an arrow leaving a window frame.
      return h('svg', {
        className: 'wul-icon', viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3' }),
        h('path', { d: 'M12 4v10' }),
        h('path', { d: 'M8 8l4-4 4 4' }),
      )
    }

    /** Rewrite the authority to the page origin only for an HTTP(S) page whose
     * origin differs from the host answer (remote/proxy access), keeping the
     * token. On the desktop shell the page itself lives on a custom scheme
     * (dsh-app://app) served by Electron; there the host-provided http URL is
     * the browser-reachable target, and the shell's setWindowOpenHandler only
     * forwards http(s) URLs to shell.openExternal — a dsh-app: target would
     * be silently denied. */
    function buildTarget(data) {
      var target = data.url
      try {
        var page = new URL(window.location.href)
        var parsed = new URL(data.url)
        if (/^https?:$/.test(page.protocol) && parsed.origin !== page.origin) {
          var rewritten = new URL(parsed.pathname || '/', page.origin)
          if (data.token) rewritten.searchParams.set('token', data.token)
          target = rewritten.href
        }
      } catch (error) { /* keep the host-provided URL as-is */ }
      return target
    }

    /** Hand the URL to a new top-level window. The desktop shell intercepts
     * this via setWindowOpenHandler and routes http(s) to shell.openExternal.
     * Call this SYNCHRONOUSLY from the click stack so Chromium sees transient
     * user activation and cannot treat the open as an ungestured popup. */
    function openExternal(target) {
      var activation = '?'
      try {
        if (navigator.userActivation) activation = String(navigator.userActivation.isActive)
      } catch (error) { /* older engines lack the API */ }
      console.log('[web-ui-linker] window.open ->', target, 'activation=' + activation)
      window.open(target, '_blank', 'noopener')
    }

    /** One-line description of where our button actually lives in the DOM,
     * answered back to the host route (?probe=) so it lands in the plugin's
     * status file — layout diagnostics without DevTools. */
    function probeText() {
      try {
        var el = document.querySelector('.wul-root')
        if (el === null) return 'no .wul-root'
        var chain = []
        var depth = 0
        while (el !== null && depth < 6) {
          chain.push(el.tagName + '.' + String(el.className).slice(0, 60))
          el = el.parentElement
          depth += 1
        }
        var container = null
        try { container = document.querySelector('div[class*=_footerActions]') } catch (error) { /* bad selector engine */ }
        var dir = container !== null ? getComputedStyle(container).flexDirection : 'no-container'
        var kids = container !== null ? container.children.length : -1
        return 'chain[' + chain.join(' | ') + '] dir=' + dir + ' kids=' + String(kids) + ' page=' + location.protocol
      } catch (error) {
        return 'probe-error:' + String(error && error.message || error)
      }
    }

    function WebUiLinkButton(props) {
      var wide = props.wide === true
      var busy = React.useState(false)
      var error = React.useState(null)
      var flash = React.useState(false)
      var errorTimer = React.useRef(null)
      var flashTimer = React.useRef(null)
      // Pre-fetched live target {target, at}: lets a click open the browser
      // synchronously inside the click handler's own call stack.
      var cache = React.useRef({ target: null, at: 0 })
      // Cooldown: one physical click must not open two windows (the console
      // showed each click emitting window.open twice on the desktop shell).
      var lastOpen = React.useRef(0)

      function pull(src) {
        var url = '/web-ui-linker/url' + (typeof src === 'string' ? '?src=' + encodeURIComponent(src) : '')
        return fetch(url, { cache: 'no-store' }).then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + String(res.status))
          return res.json()
        }).then(function (data) {
          if (typeof data.url === 'string') cache.current = { target: buildTarget(data), at: Date.now() }
        }).catch(function () { /* prefetch stays quiet; clicks surface errors */ })
      }

      React.useEffect(function () {
        // After first paint: send one DOM probe, then keep the URL hot every
        // 10s so clicks never need an async hop.
        var startTimer = setTimeout(function () {
          fetch('/web-ui-linker/url?probe=' + encodeURIComponent(probeText()), { cache: 'no-store' }).catch(function () {})
          pull()
        }, 800)
        var refreshTimer = setInterval(pull, 10000)
        return function () {
          clearTimeout(startTimer)
          clearInterval(refreshTimer)
          if (errorTimer.current !== null) clearTimeout(errorTimer.current)
          if (flashTimer.current !== null) clearTimeout(flashTimer.current)
        }
      }, [])

      function flashOn() {
        flash[1](true)
        if (flashTimer.current !== null) clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(function () { flash[1](false) }, 2500)
      }

      function onClick() {
        if (busy[0]) return
        var now = Date.now()
        if (now - lastOpen.current < 1200) return
        var fresh = cache.current
        if (fresh.target !== null && now - fresh.at < 30000) {
          // Synchronous open inside the user-gesture call stack.
          error[1](null)
          lastOpen.current = now
          openExternal(fresh.target)
          flashOn()
          pull('click')
          return
        }
        busy[1](true)
        fetch('/web-ui-linker/url?src=click-async', { cache: 'no-store' }).then(function (res) {
          if (!res.ok) {
            if (res.status === 401) throw new Error('登录状态已失效，请刷新页面')
            if (res.status === 503) throw new Error('Web 服务尚未就绪，稍后再试')
            throw new Error('HTTP ' + String(res.status))
          }
          return res.json()
        }).then(function (data) {
          if (typeof data.url !== 'string') throw new Error('bad response')
          error[1](null)
          var target = buildTarget(data)
          cache.current = { target: target, at: Date.now() }
          lastOpen.current = Date.now()
          openExternal(target)
          flashOn()
        }).catch(function (e) {
          console.warn('[web-ui-linker] click failed:', e)
          error[1](String(e && e.message || e))
          if (errorTimer.current !== null) clearTimeout(errorTimer.current)
          errorTimer.current = setTimeout(function () { error[1](null) }, 6000)
        }).finally(function () {
          busy[1](false)
        })
      }

      var title = error[0] !== null
        ? '打开 Web UI 失败：' + error[0]
        : flash[0]
          ? '已请求用系统默认浏览器打开；若没有反应请打开开发者工具查看 [web-ui-linker] 日志'
          : '用系统默认浏览器打开 Web UI（Open in system default browser）'

      var buttonClass = 'wul-button'
        + (error[0] !== null ? ' wul-has-error' : '')
        + (flash[0] ? ' wul-flash' : '')

      return h('div', { className: 'wul-root' + (wide ? ' wul-wide' : ' wul-narrow') },
        h('button', {
          type: 'button',
          className: buttonClass,
          title: title,
          disabled: busy[0],
          onClick: onClick,
        },
          Icon(),
          h('span', { className: 'wul-text' },
            error[0] !== null ? '重试' : flash[0] ? '已请求打开' : '打开 Web UI'),
        ),
      )
    }

    module.exports.inject = ['slots']
    module.exports.apply = function apply(ctx) {
      // Desktop shell only. The desktop GUI page is served on the custom
      // `dsh-app://app` origin — the same test the shell's own preload uses to
      // expose its desktop API. In a plain browser the Web UI *is* the page, so
      // a button that "opens the Web UI in the default browser" is pointless:
      // register nothing (no slots, no CSS, no prefetch, no probes).
      if (!(location.protocol === 'dsh-app:' && location.hostname === 'app')) return
      ensureCss()
      ctx.slots.inject('sidebar.footer.action', function () {
        return ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'web-ui-linker', order: 120, label: '打开 Web UI' },
          WebUiLinkButton,
        )
      })
    }
    return module.exports
  },
})
