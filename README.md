# dsh-web-ui-linker

一个小巧的 [DeepSeek Harness](https://github.com/deepseek-ai)（dsh）插件，做两件事：

1. 每次 dsh 启动时，向本实例自己的 `connection` 服务索取浏览器认证后的 Web UI 链接
   （`connection.authenticatedUrl(cleanBaseUrl)`），写入固定文件，覆盖上一次的内容。
2. 在**桌面应用**的 Web GUI 里，于侧边栏底部（设置图标旁）放一个按钮，一键用**系统默认浏览器**
   打开这个实时链接——token 已含在内。

它只注册一条路由 `GET /web-ui-linker/url`，由 `connection.admit` 把关（浏览器认证 + 主机来源信任），
不触碰任何可能重启或打断实例的东西。

## 按钮（仅桌面壳内）

浏览器半边（`lib/client.js`，手写的模块加载器 bundle——无需打包器）门控在桌面壳内：
页面不在壳的自定义 `dsh-app://app` origin 上时，`apply()` 直接早退（判据与壳自身 preload 暴露
`window.dshDesktop` 所用的完全一致）。在普通浏览器里，Web UI **就是页面本身**，所以 bundle 加载后
零副作用——不注册 slot、不注入 CSS、不预取、不发探针。

桌面 GUI 内，按钮注册在 `sidebar.footer.action`（id `web-ui-linker`、`order: 120`），通过带
`:has` 守护的 flex-column 规则与同席位的其他按钮（如任务队列按钮）**纵向堆叠**；
折叠窄栏下显示居中的 36×36 圆形图标按钮。外观沿用 ds-bot 侧栏按钮（`.bt-return`）的胶囊样式：
透明底、无描边、`border-radius:999px`、36px 高、14px/20px 文字，hover 灰底、按下 `scale(.96)`；
不携带 ds-bot 自己的头像图片，只保留本插件的图标与文字。

点击行为：

- 挂载时**预取**实时 URL，之后每 10s 刷新一次，因此点击会在 click 处理器**自己的调用栈内同步**
  调用 `window.open`（Chromium 可见的 transient user activation 仍然有效）。仅当缓存过期（>30s）
  时才回退到异步 fetch 路径。1.2s 冷却确保一次物理点击不会发出两次 `window.open`。
- 宿主每次都实时重算读数，所以每次点击携带的都是**新鲜的 token**。打开目标是宿主给出的
  `http://127.0.0.1:<port>/?token=…`；壳的 `setWindowOpenHandler`（只转 http/https）把它交给
  `shell.openExternal` → 你的**系统默认浏览器**。Electron 内不会弹新窗。
- origin 重写安全带：仅当**页面本身**是 http(s) origin 且与宿主应答的 origin 不同时，按钮才在页面
  自身 origin 上重组 URL 并保留 token（远程/代理访问场景）。`dsh-app:` 页面上直接采用宿主给出的
  URL——若重写成 `dsh-app://app/?token=…`，会被壳的 handler 静默拒绝。
- 出错时（页面 cookie 过期、服务未就绪）按钮文字变红 + tooltip（6s 自动清除，按钮文字变为
  「重试」）；点击成功后「已请求打开」以绿色文字闪 2.5s。其余一切不动。

## 诊断（无需 DevTools）

- 挂载约 800ms 后，按钮经 `GET /web-ui-linker/url?probe=…` 回报一行祖先链 + footer-actions 容器的
  计算后 `flexDirection`；点击请求带 `?src=click` 标签。两者（带节流）落盘到
  `web-ui-url.status.txt`：`probe chain[…] dir=… kids=… page=…` 与 `route answered <status> src:…`。
- 每次打开都会在页面 console 记一条 `[web-ui-linker] window.open -> <target> activation=<bool>`。

## 输出

| 文件 / 路由 | 内容 |
| --- | --- |
| `web-ui-url.txt` | 认证后的 URL，附写入时间、pid、clean origin 注释 |
| `web-ui-url.status.txt` | 诊断轨迹，可区分「插件失败」与「插件未挂载」 |
| `GET /web-ui-linker/url` | JSON `{url, clean, token, origin, generatedAt}`，每请求实时重算，`cache-control: no-store` |

两个文件都是运行时产物且已 gitignore——`web-ui-url.txt` 内含活动会话 token。

## 工作原理

插件声明依赖 `connection` 和 `webServer`。当前安装版中，WebServer 初始化会等待端口绑定完成，
Cordis 在依赖服务就绪后才执行本插件的 `apply()`：注册路由、生成认证链接并写入文件一次，随后立即返回。
后端不创建轮询或保活定时器；依赖服务重新加载时，插件重新激活并更新文件。
链接 token 在同一应用根上下文中保持稳定；HTTP 路由每次请求仍使用当前服务实时生成链接。
文件写入失败或端口异常缺失时只记录诊断，不重试或延迟启动；路由保留，端口缺失时回 `503 web-server-not-ready`。
未认证的本机进程得到 `401`，不可信的 `Host` 头得到 `403`——不带凭据的本地 curl 拿不到 token。
host 半边（路由 + 两个文件写出）有意在每次启动都保持活跃，无论桌面还是 CLI；只有浏览器半边受桌面门控。

前端首次预取、每 10 秒刷新和 30 秒缓存有效期保持不变，用于维持点击时同步打开浏览器的行为，
不参与后端启动等待。后端已删除的旧轮询会在链接早已写出后仍等待约 60 秒，拖延 Host 就绪和窗口显示。

## 用法

通过 patch 入口（`cordis.patch.yml`）打进 dsh profile：

```json
{
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

要求 Node.js >= 22、dsh `>=0.2.1-rc.2 <0.2.2`（锁窗原因：打开行为依赖壳的 `setWindowOpenHandler`）。
测试：`npm test`，覆盖路由以及启动无轮询、重新激活、异常诊断和路由卸载。
测试会产生链接/状态文件；真实实例运行时应在临时副本中运行，以免覆盖当前实例的诊断文件。
过程文档归档在 [`docs/archive/`](<docs/archive/改造任务清单-V1.0-过程文档.md>)。MIT 许可。
English version: [README_en.md](README_en.md).
