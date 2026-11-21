# 页面与悬浮窗

插件的页面是插件包里的普通 HTML 文件，运行在与 Mojito 隔离的网页里。后台用 `context.ui` 注册页面，Mojito 就会在侧栏、首页、设置或悬浮窗里显示它。页面通过 [bridge](api/view.md) 读取后台发布的数据。

注册页面需要 `ui.register` 权限。

## 创建项目

页面通常用 TypeScript 写，并用 Vite 把后台和页面一起构建到 `dist`。项目结构：

```text
my-plugin/
├─ plugin.json
├─ vite.config.ts
├─ main.html
└─ src/
   ├─ worker.ts      后台
   └─ main.ts        页面脚本
```

安装依赖：

```sh
npm init -y
npm pkg set type=module
npm install --save-dev vite @ffcafe/mojito-plugin-sdk
```

`plugin.json` 的入口指向构建后的文件名 `entry.mjs`：

```json
{
  "schemaVersion": 1,
  "id": "example.my-plugin",
  "name": "My plugin",
  "version": "0.1.0",
  "apiVersion": "^2.0.0",
  "entry": { "kind": "worker", "path": "entry.mjs" },
  "capabilities": ["ui.register"],
  "networkOrigins": []
}
```

`vite.config.ts`：

```ts
import { copyFile } from 'node:fs/promises'
import { defineConfig } from 'vite'

const hmr = false

export default defineConfig(({ command }) => ({
  // 构建结果使用相对路径；开发服务器的路径和登记开发来源时填写的挂载路径一致
  base: command === 'serve' ? '/my-plugin/' : './',
  // Mojito 把这个占位符换成页面的 nonce，开发服务器上的脚本才能运行
  html: { cspNonce: '__MOJITO_DEV_NONCE__' },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr,
    ws: hmr ? { host: '127.0.0.1', protocol: 'ws', clientPort: 5173 } : false,
  },
  build: {
    rolldownOptions: {
      // 保留后台的 activate 导出
      preserveEntrySignatures: 'strict',
      input: { entry: 'src/worker.ts', main: 'main.html' },
      output: { entryFileNames: (chunk) => (chunk.name === 'entry' ? 'entry.mjs' : 'assets/[name]-[hash].js') },
    },
  },
  plugins: [
    {
      name: 'mojito-dev-pages',
      apply: 'serve',
      // 不使用 HMR 时，去掉 Vite 自动加入的 HMR 客户端
      transformIndexHtml: {
        order: 'post',
        handler: (html) => (hmr ? html : html.replace(/<script\b[^>]*\/@vite\/client"[^>]*><\/script>/g, '')),
      },
    },
    {
      name: 'mojito-manifest',
      apply: 'build',
      // 把 manifest 复制进构建结果
      closeBundle: () => copyFile('plugin.json', 'dist/plugin.json'),
    },
  ],
}))
```

启用页面热更新时，将 `hmr` 改为 `true`，并在登记来源时勾选“页面热更新（HMR）”，见[开发与调试](development.md#vite-hmr)。`ws` 明确指定浏览器直连的地址和端口，因为页面由 Mojito 的自定义协议加载，不能从页面地址推导 WebSocket 连接。HMR 开启时保留 Vite 注入的客户端脚本。

## 后台注册页面

下面的后台维护一个计数，注册一个侧栏页面，并处理页面发来的“加一”命令：

```ts
// src/worker.ts
import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'

export async function activate(context: PluginContext) {
  let count = 0
  context.views.set('counter', { count })
  const removeCommand = await context.views.onCommand('increment', async () => {
    count++
    context.views.set('counter', { count })
    await context.views.flush() // 命令返回时页面已经收到新值
    return count
  })
  const removePage = await context.ui.registerFeature({ id: 'main', name: '计数器', entry: 'main.html' })
  return async () => {
    await removeCommand()
    await removePage()
  }
}
```

## 页面

```html
<!-- main.html -->
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="/host/mojito-base.css" vite-ignore>
</head>
<body>
  <h1>计数器</h1>
  <output>连接中…</output>
  <button type="button" disabled>加一</button>
  <script type="module" src="./src/main.ts" nonce="__MOJITO_DEV_NONCE__"></script>
</body>
</html>
```

```ts
// src/main.ts
import { connectView } from '@ffcafe/mojito-plugin-sdk/view'

const output = document.querySelector('output')!
const button = document.querySelector('button')!
const view = await connectView()
const subscription = view.subscribe('counter', (batch) => {
  for (const item of batch.items) output.value = String((item as { count: number }).count)
})
await subscription.ready
button.disabled = false
button.addEventListener('click', () => void view.command('increment', null))
```

`/host/mojito-base.css` 由 Mojito 提供，让按钮、输入框等元素和 Mojito 的界面一致，见[样式](style.md)。`vite-ignore` 让 Vite 保留这个地址，不在开发服务器上加挂载路径。

## 构建并运行

```sh
npx vite build
```

`dist` 里有 `plugin.json`、`entry.mjs`、`main.html` 和 `assets`。在开发者工具里登记 `dist\plugin.json` 的绝对路径并启动，侧栏会出现“计数器”。用开发服务器免去每次构建，见[开发与调试](development.md)。

## 页面放在哪里

`registerFeature` 的 `placement` 决定页面的位置：

| `placement` | 位置 | 数量 |
| --- | --- | --- |
| `sidebar`（默认） | 侧栏里的一个功能页 | 不限 |
| `home` | 首页的面板 | 每个插件一个 |
| `settings` | 设置里这个插件的设置页 | 每个插件一个 |

```ts
await context.ui.registerFeature({ id: 'overview', name: '概览', entry: 'overview.html', placement: 'home' })
```

重复注册首页面板或设置页会以 `invalid_argument` 失败；取消注册后可以再注册。多个插件都有首页面板时，用户选择显示哪一个，默认按插件 ID 排序取第一个。

同一时间只显示一个功能页。离开页面时页面被销毁，回来时重新加载，所以需要保留的状态放在后台。页面里可以用 `view.identity.placement` 知道自己在哪里（悬浮窗为 `null`）。

## 悬浮窗

悬浮窗是显示在游戏上方的独立窗口。后台用 `registerOverlay` 注册，参数和页面类似，另外给出默认尺寸：

```ts
const removeOverlay = await context.ui.registerOverlay({
  id: 'counter',
  name: '计数器悬浮窗',
  entry: 'overlay.html',
  defaultSize: { width: 320, height: 180 },
})
```

注册以后，用户在 Mojito 的悬浮窗管理里添加它，并设置置顶、锁定和鼠标穿透。一个悬浮窗可以添加多个实例。悬浮窗页面和功能页一样用 `connectView()` 读取数据。

为 ACT/OverlayPlugin 写的现成悬浮窗也可以作为插件运行：声明 `ui.overlayplugin`，注册时用 `compatibility` 代替 `entry`。定义见 [overlayplugin.ts](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/overlayplugin.ts)。

从 Plugin API 2.3 起，`OverlayState.custom` 可附带插件自定义 JSON。值只交给该插件包内已授权并绑定的文档，远程文档只收到普通兼容状态。包内页面可监听 `document` 的 `mojitoOverlayCustomData`，从 `event.detail` 读取值。宿主沿用 `overlayProducer` 的状态合并和消息限制。

Modern 兼容页面可用 `OverlayPluginApi.callHandler(JSON.stringify({ call: 'getGameIcon', type: 'action', id: 3 }), callback)` 请求技能图标，`type: 'status'` 请求状态图标。
宿主把 `{ type, id }` 交给该插件的 `${channel}/icons` view command；worker 用已有的 `data.read` 权限查询游戏数据并返回 `data.image` URL 或 `null`。回调参数为 JSON 字符串，包含该 URL、`null` 或 `{ error }`。

## 设置搜索

Mojito 的设置搜索和命令面板（Ctrl K）可以找到插件设置页里的设置项。后台用 `setPreferenceItems` 提交条目，每次调用替换全部条目，空数组表示清空：

```ts
await context.ui.setPreferenceItems([
  { id: 'scope', title: '统计范围', description: '悬浮窗和记录里计入哪些人。' },
  { id: 'split', title: '分段间隔', description: '' },
])
```

- `id` 在同一次调用中不能重复；`title` 为 1–100 个字符；`description` 为 0–300 个字符。参数不对时以 `invalid_argument` 失败，之前的条目保留。
- 条目只在本次激活中有效，所以在 `activate` 里提交。
- 条目在插件设置页注册之后才显示。

用户选中条目时，Mojito 打开插件的设置页，并发送一次 `navigate-to-preference-item` 事件，由页面自己滚动并高亮：

```ts
view.on('navigate-to-preference-item', ({ id }) => {
  document.querySelector(`[data-preference="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' })
})
```

事件在页面调用 `view.on` 之前到达时，SDK 会保留它，交给第一个监听器。不认识的 `id` 忽略即可。

## 主题

Mojito 把颜色、字体和尺寸以 `--mojito-*` CSS 变量注入每个插件页面，深浅色主题切换时自动更新。用这些变量和 `/host/mojito-base.css`，插件就能和 Mojito 保持一致，见[样式](style.md)。

完整的多页面示例在仓库的 [examples/plugin-views](https://github.com/thewakingsands/mojito-plugins/tree/main/examples/plugin-views)。
