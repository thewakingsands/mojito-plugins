# 核心概念

这一页解释写插件时反复出现的几个概念。方法的完整列表见[服务与生命周期](api/context.md)。

## 激活与清理

Mojito 每次启动插件，都调用一次后台导出的 `activate(context)`，这一次运行称为一次**激活**（activation）。`context` 只属于这次激活；插件停止、更新或被用户禁用时，激活结束。

订阅、页面注册、命令处理等操作会返回一个取消函数（类型名 `Disposer`）。`activate` 应该返回一个清理函数，在里面调用这些取消函数：

```ts
import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'

export async function activate(context: PluginContext) {
  const subscription = context.session.subscribe((batch) => { /* … */ })
  const removePage = await context.ui.registerFeature({ id: 'main', name: '概览', entry: 'main.html' })
  return async () => {
    subscription.dispose()
    await removePage()
  }
}
```

正常停止时，宿主最多等待清理函数 10 秒。插件崩溃或被强制结束时清理函数不会运行，所以重要的数据要随时保存（`context.config` 或 `context.storage`），不要只在清理时保存。

## 权限

manifest 的 `capabilities` 列出插件要用的权限，例如读取会话要 `session.read`，注册页面要 `ui.register`。没有声明的权限，调用会以 `permission_denied` 失败。

读取玩家真实身份、原始数据包、内存和发起网络请求是**敏感权限**，用户可以单独拒绝，也可以在运行中撤回。插件要能在没有这些权限时继续工作。详见[权限](permissions.md)。

## 订阅与批次

持续变化的数据（会话、游戏状态、事件）通过订阅获得。订阅返回一个 `Subscription`：

- `ready`：订阅建立后完成。先 `await subscription.ready` 再依赖它。
- `dispose()`：取消订阅。
- `closed`：订阅结束时完成，带结束原因。

回调每次收到一个**批次**（`Batch`）：`items` 是这段时间内的数据，按顺序处理即可。订阅刚建立时的第一批带 `initial: true`，通常就是当前状态。回调是异步函数时，SDK 会等它完成再送下一批。宿主每次等待插件处理数据时，对每个订阅最多等 300ms；超时的订阅暂时不再等待，直到它处理完当时已收到的数据，插件日志里会有记录。这段时间里插件查询到的游戏状态（例如角色名称）可能比它正在处理的事件新；积压超过上限时订阅以 `overflow` 关闭。所以回调里只做必须和这批数据对应的工作，其余工作在回调返回之后进行。

## 数据可能未知

游戏数据不总是可用：游戏没开、还没收到对应的数据包、客户端版本不支持……所以单个字段用 `Field` 表示：

```ts
const sample = await context.game.getPlayer({ fields: ['inCombat'] })
const field = sample.value.inCombat
if (field?.state === 'ok') {
  // field.value 是 true 或 false
} else {
  // 'unknown' 或 'unavailable'：显示为未知，不要当作 false
}
```

把未知当成 `0`、空字符串或 `false`，会让插件显示错误的数据。

## 会话

**会话**是 Mojito 与一个游戏进程（或一段回放）的连接。`session.state` 是 `idle`（没有连接）、`live`（正在游戏）或 `replay`（播放录制）。换角色、重启游戏或回放倒退时，旧数据不再有效；数据上带的 `sessionId` 和代数（generation）计数 `characterGeneration`、`clockGeneration` 用来判断数据是否属于当前会话。处理方法见[数据与事件](api/data-model.md)。

## 后台与页面之间的 bridge

页面是独立的网页，不能直接使用 `context`。后台和页面之间通过 **bridge** 按名字（channel）交换数据：

- 后台用 `context.views.set(channel, value)` 发布某个 channel 的最新值，页面用 `view.subscribe(channel, …)` 接收。
- 页面用 `view.command(name, value)` 调用后台用 `context.views.onCommand(name, …)` 注册的命令，并拿到返回值。

页面关闭后就销毁了，再次打开是一个新的页面；需要保留的状态放在后台。完整示例见[页面 bridge](api/view.md)。

## 错误

API 调用失败时抛出 `PluginError`，用 `code` 判断原因：

| `code` | 含义 |
| --- | --- |
| `invalid_argument` | 参数不对，修正调用 |
| `permission_denied` | manifest 没有声明对应权限 |
| `unavailable` | 现在拿不到（例如没开游戏、用户拒绝了敏感权限），稍后可能恢复 |
| `stale_session` | 调用期间会话变了，结果已过期，丢弃即可 |
| `cancelled`、`plugin_stopped` | 操作被取消或插件正在停止，结束手头的工作 |

## 术语

| 术语 | 含义 |
| --- | --- |
| manifest | 插件包根目录的 `plugin.json`，见 [Manifest](manifest.md) |
| capability | manifest 里声明的一项权限 |
| origin | 网址的协议、主机和端口部分，例如 `https://api.example.com`，用于声明插件能访问的网站 |
| catalog | 列出可安装插件版本的 `catalog.json`，用户在 Mojito 里添加它的地址来安装插件 |
| JWK | 一种用 JSON 保存密钥的格式，插件签名的私钥以这种格式保存 |
