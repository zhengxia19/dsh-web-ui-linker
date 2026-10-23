# 更新日志

中文版见本文；English version: [CHANGELOG_en.md](CHANGELOG_en.md)。

## 0.2.1 —— 验收通过，定版归档（2026-10-23）

这是验收定版：桌面按钮一键用系统默认浏览器打开含实时 token 的 Web UI，浏览器半边门控在桌面壳内
（`dsh-app://app`）。过程文档移入 `docs/archive/`；源码快照存于 `release/`。

- 布局：底部按钮通过 `div[class*=_footerActions]:has(.wul-root){flex-direction:column}` 与同席位的
  其他按钮（如任务队列按钮）**纵向堆叠**——宿主容器默认是 flex row，此前两个按钮被横向挤压。
  选择器用的是**后代** `:has`（不是子级 `:has(> …)`）：slot 渲染器会把注册项包一层，
  早先的子选择器规则在桌面应用上从未命中。
- 按钮紧凑（高度随文字、`padding:5px 10px`、line-height 1.45）且全宽，与队列按钮共用宿主
  `--dsw-alias-button-tool-bar-fill` 底色；折叠窄栏仍显示居中的 40×40 图标。
- 点击可靠性：挂载时**预取**实时 URL、每 10s 刷新，使点击在 click 处理器**自己的调用栈内同步**
  调用 `window.open`（Chromium 可见的 transient user activation），而不是在异步 `.then` 里调用——
  后者会在 `setWindowOpenHandler` 执行前就被桌面壳静默吞掉弹窗。仅当缓存过期（>30s）时才回退到
  异步 fetch 路径。1.2s 冷却防止一次物理点击发出两次 `window.open`（桌面壳上实测出现过）。
- **桌面端根因确诊**：桌面 GUI 页面跑在 Electron 代理的自定义协议（`dsh-app://app`）上，旧的
  origin 重写把目标改成了 `dsh-app://app/?token=…`，而壳的 `setWindowOpenHandler`
  （只转 http/https → `shell.openExternal`）会静默拒绝。现在**仅当页面本身是 http(s) origin**
  时才重写到页面 origin；`dsh-app:` 页面直接采用宿主给出的 `http://127.0.0.1:<port>` URL。
- Console 诊断：`[web-ui-linker] window.open -> <target> activation=<bool>`
  记录打开时 `navigator.userActivation.isActive` 是否为真。
- DOM 探针：挂载约 800ms 后，按钮经 `GET /web-ui-linker/url?probe=…` 回报一行祖先链 +
  footer-actions 容器的计算后 `flexDirection`；点击请求带 `?src=click` 标签。两者（带节流）落盘到
  `web-ui-url.status.txt`：`probe chain[...] dir=… kids=…` 与 `route answered <status> src:…`
  ——无需 DevTools 的布局/点击证据。
- 点击处理诊断：路由向 `web-ui-url.status.txt` 写节流的 `route answered <status>` 行，
  按钮在请求成功后闪绿色描边「已请求打开」（2.5s）。
- 桌面专用门控：页面不在壳的自定义 `dsh-app://app` origin 上时 `apply()` 直接早退
  （判据与壳 preload 暴露 `window.dshDesktop` 所用的相同）。在普通浏览器里 Web UI *就是页面本身*，
  所以 bundle 现在加载后零副作用——不注册 slot、不注入 CSS、不预取、不发探针。CSS 注入从模块顶层
  挪入 `ensureCss()`，仅门控通过后调用。host 半边（路由 + 链接/状态文件）有意在所有环境保持活跃：
  它没有 UI 副作用，还能让 CLI 工装继续可用。
- 测试：覆盖 `onServe`/`onProbe` 观察者（`src` 标签透传；已鉴权探针抵达 `onProbe`，
  被拒请求绝不探针）——共 14 例。

## 0.2.0

- 新增浏览器半边：Web GUI 侧边栏底部按钮（`sidebar.footer.action`，id `web-ui-linker`）。
  一键在**系统默认浏览器**打开含实时 token 的 Web UI URL（桌面应用内即 `shell.openExternal`；
  真实浏览器里是新标签页）。
- 新增 host 路由 `GET /web-ui-linker/url`：每请求实时重算并返回
  `{url, clean, token, origin, generatedAt}`，`cache-control: no-store`，由 `connection.admit`
  把关（未认证 401、不可信 Host 403、非 GET/HEAD 405、web 监听未绑定前 503）。
- 远程/代理访问：宿主应答的 origin 与页面不一致时，按钮在页面自身 origin 上重组 URL 并保留 token。
- `package.json` 新增 `./client` 导出并声明 `dsh.client` bundle 入口（platform `web`，
  inject `@deepseek-ai/dsh-client-runtime`）；engines 锁 `dsh >=0.2.1-rc.2 <0.2.2`。
- 文件写出行为（`web-ui-url.txt`、`web-ui-url.status.txt`）保持不变。
- 测试：`node --test test/route.test.js` 覆盖路由的鉴权/方法/状态路径。

## 0.1.0

- 首发：每次启动把实时浏览器认证后的 Web UI 链接（`connection.authenticatedUrl`）写入
  `web-ui-url.txt`，并在 `web-ui-url.status.txt` 留下诊断轨迹。
