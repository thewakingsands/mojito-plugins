# 开发时页面热更新

[English](README.md) | 简体中文

先构建 SDK，再启动本示例；示例在已安装的 Mojito 宿主中加载。开发服务器使用 Vite 8.3.4，端口 5173。用 `MOJITO_DEV_HMR=1 pnpm exec vite --config examples/plugin-views/vite.config.ts` 启用现成的配置（PowerShell 中先执行 `$env:MOJITO_DEV_HMR = '1'`）。

通过宿主的开发者注册操作注册，传入本示例 `plugin.json` 的绝对路径：

```ts
await host.registerDevelopment('author', {
  manifestPath: '/absolute/path/examples/plugin-views/plugin.json',
  serverOrigin: 'http://127.0.0.1:5173',
  mountPath: '/dev/example-views/',
  workerEntry: 'entry.ts',
  hmr: true,
})
```

确认框会显示确切的 WebSocket 目标地址。注册不会启用插件，也不会授予 capability：先授予 `ui.register`，再通过宿主启用这个开发实例。`hmr: true` 从服务器地址推出 `ws://127.0.0.1:5173`，并使用挂载路径；HTTPS 服务器则推出 WSS。`hmrOrigin` 和 `hmrPath` 可以覆盖这两个默认值，提供其中任何一个也会开启 HMR。不含这些字段的已有注册保持 HMR 关闭。修改注册会停止旧实例；确认后需重新启用。

本示例使用以下 Vite 8 设置：

```ts
server: {
  host: '127.0.0.1',
  port: 5173,
  strictPort: true,
  hmr: true,
  ws: { host: '127.0.0.1', protocol: 'ws', clientPort: 5173 },
}
```

它的 `base` 是 `/dev/example-views/`，因此最终的 WebSocket 路径是 `/dev/example-views/`。如果自定义了 Vite 的 `server.ws.path`，注册时要填写包含 base 在内的最终路径。协议、主机名、端口和路径都必须完全一致。Vite 的 token 和 `vite-hmr` 子协议原样透传。不要关闭 Vite 的 token 检查，也不要修改它的客户端代码。

在应用模块中用 Vite 的 `import.meta.hot` API 接受更新，可以保留页面状态；未被接受的修改可能让整个视图重新加载。CSS 更新自动生效。后台 Worker 代码需要通过宿主显式重新加载。关闭视图、停止插件、删除注册、修改目标或重新加载后台，都会销毁旧视图及其 socket。重新打开的视图按新的注册连接。

只有被准入的开发视图主框架可以建立连接。后台文档、Worker、正式插件、普通 HTTP 请求和未注册的目标都不会因此获得网络访问。连接遵循浏览器正常的 DNS 和 TLS 行为。权限、证书检查、沙箱和 web 安全始终开启；需要额外浏览器权限的端点仍不可用。只使用可信的开发服务器。

## 验证

宿主集成测试在单独的 Mojito 检出目录中运行：

```sh
node /path/to/mojito/scripts/plugin-isolation/run-vite-hmr.mjs /absolute/path/to/electron /absolute/new/output-directory /path/to/mojito-plugins/examples/plugin-views
```

该脚本使用正式的加载器和真实的 Vite 服务器，检查 JS/CSS 更新、整页重新加载、请求限制，以及服务器端观察到的断开和重连。脚本可以在 Windows 上运行；需使用实际的 Electron 可执行文件路径。`MOJITO_HMR_HOST` 选择要测试的主机名或本地网络接口。`MJT28_LAB_HEADLESS=1` 让 Electron 使用 headless 平台，用于 Linux 测试环境。输出记录版本和结果，不含 Vite token。Linux 上的结果不能证明 Windows、局域网或 WSS 可用；实际测试了哪些环境就记录哪些。不要为了让测试通过而绕过权限或证书检查。

本示例还以 `placement: 'home'` 注册了 `home.html`，以 `placement: 'settings'` 注册了
`settings.html`。两个页面显示自己的 placement 和当前的 `prefers-color-scheme`；宿主的外观设置会同时改变这两个页面。
两个页面的颜色、尺寸和控件样式都取自宿主：宿主注入的 `--mojito-*` 变量和 `/host/mojito-base.css`。见 SDK 的
`docs/style.md`。
`main.html` 和 `details.html` 使用默认的侧栏 placement。每个页面调用
`connectView()`，只拿到绑定在自己文档上的视图 bridge。
worker 还通过 `context.ui.setPreferenceItems` 提交 `settings.html` 的三项设置。在宿主的设置搜索或 Ctrl K 中
选中其中一项会打开设置页，设置页在收到 `navigate-to-preference-item` 时高亮该项。
