# 功能页面的位置

`ui.registerFeature({ id, name, entry, icon?, placement? })` 的 `placement` 可以是 `sidebar`（默认）、
`home` 或 `settings`。三者都使用已有的 `ui.register` 权限和同一个隔离的页面 bridge；选择位置不会授予额外的
capability。

一个插件可以注册多个侧栏页面，但同一时间只能有一个首页面板和一个设置页。尚未完成的注册也会占用这两个位置。
无效的 placement 值以及重复注册首页面板或设置页都以 `invalid_argument` 拒绝。销毁注册后释放对应的位置。

```ts
const remove = await context.ui.registerFeature({
  id: 'overview',
  name: 'Overview',
  entry: 'overview.html',
  placement: 'home',
})
```

页面从 `@ffcafe/mojito-plugin-sdk/view` 调用 `connectView()`。功能页面的 `identity.placement` 不可变，
取值为 `sidebar`、`home` 或 `settings`；悬浮窗为 `null`。没有显式指定位置的功能页面得到 `sidebar`。

宿主按用户的偏好选择一个可用的首页面板；没有偏好或设为自动时，按插件 ID 升序选择。选择状态页会关闭首页面板的自动选择。
同一时间只挂载一个功能页面文档：离开时释放它，返回时创建一个新的文档。

主题变化用 `prefers-color-scheme` 判断。宿主的原生主题设置同样作用于隔离的插件页面。宿主还以 `--mojito-*`
CSS 变量注入自己的颜色、字体和尺寸，并提供可选的 `/host/mojito-base.css`；变量、页面边界和核对清单见
[style.md](style.md)。三种位置的示例见 `examples/plugin-views`。

## 设置搜索

从 Plugin API 1.5.0 起，宿主的设置搜索和命令面板（Ctrl K）可以找到插件设置页里的设置项。worker 用
`context.ui.setPreferenceItems(items)` 一次提交全部条目，需要 `ui.register`。每次调用都替换之前提交的全部条目，
不做合并；空数组表示清空。

```ts
await context.ui.setPreferenceItems([
  { id: 'scope', title: '统计范围', description: '悬浮窗和记录里计入哪些人。' },
  { id: 'split', title: '分段间隔', description: '' },
])
```

`id` 采用功能 ID 的格式，在同一次调用中不能重复。`title` 为 1–100 个字符，不能为空；`description` 为 0–300 个字符。
ID 重复或格式错误、`title` 为空或含未知字段时以 `invalid_argument` 拒绝；调用失败时保留之前的条目。条目属于当前激活：
插件停止、停用或更新后条目被移除，所以要在 `activate` 中重新提交。

宿主用匹配自身设置的方式匹配这些条目（全文、拼音和首字母），并且只在插件设置页可用时显示；在设置页注册之前提交的条目
会等到设置页注册后再显示。这些条目没有“已修改”状态，所以“只看已修改”会隐藏它们。

用户选中某个条目时，宿主清空搜索，重新打开插件的设置页（即使它已经打开），并向页面发送一次
`navigate-to-preference-item` 事件。由页面自己高亮该条目：

```ts
const view = await connectView()
view.on('navigate-to-preference-item', ({ id, keyword }) => {
  document.querySelector(`[data-preference="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' })
})
```

`keyword` 是用户输入的内容（去掉首尾空白），可能是拼音或首字母。页面不认识的 `id`（例如条目刚被替换）应忽略。
只有设置页会收到这个事件，每次选中发送一次。如果事件在页面调用 `view.on` 之前到达，SDK 会保留每种事件的最新一次，
交给第一个监听器。`examples/plugin-views` 提交了其设置页的条目，并高亮被选中的条目。

## 悬浮窗

`ui.registerOverlay` 接收 ID、名称、entry 和 `defaultSize: { width, height }`，返回 disposer。用户在悬浮窗管理中添加实例并控制置顶、锁定和穿透；状态通过[页面 bridge](api/view.md)发布。

OverlayPlugin 兼容页面声明 `ui.register` 和 `ui.overlayplugin`，注册时用 `compatibility` 替代 `entry`，用 `overlayProducer` 发布 `OverlayState`。包内来源列出入口和允许访问的文档；远程来源引用宿主管理的 profile，另需 `ui.overlayplugin.remote`。定义见 [overlayplugin.ts](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/overlayplugin.ts)。
