# 服务与生命周期

完整签名见 [PluginContext 与服务类型](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/context.ts)。SDK 的 `.d.ts` 随包提供，编辑器可以直接查看方法参数和返回值。以下示例使用当前导出；权限的拒绝行为见[权限](../permissions.md)。

## 激活与清理

宿主调用导出的 `activate(context)`。它可以同步或异步完成，并返回清理函数。正常停止时宿主暂停新事件，给清理函数最多 10 秒的实际时间，期间可以完成 `storage.write`；崩溃和强制终止可能跳过清理，所以重要状态要定期保存。

`context.signal` 随激活结束而中止。订阅、页面注册和服务注册要保存并释放 disposer。`identity` 描述插件 ID、版本、activation ID、运行方式和开发/生产环境；`limits` 是本次激活的只读参数。

## 服务总览

| 服务 | 用途与注意事项 |
| --- | --- |
| `session` | `get` / `subscribe` 读取会话，需 `session.read`；idle 也是有效状态 |
| `game` | 查询玩家、实体和订阅状态，需 `game.read`；逐个检查 `Field.state` |
| `events` | 订阅解析后的事件，需 `events.read`；一次订阅多个类型可保留跨类型顺序 |
| `packets` | 用 `subscribe('ipc', ...)` 订阅原始数据包，需 `packets.read`；拒绝时订阅无数据 |
| `memory` | `resolve`、`read`、`watch`，需 `memory.read`；读取范围带 session ID 和 character generation，拒绝时为 `unavailable` |
| `data` | EXD 行、名称、资源、图标与地图，需 `data.read`；无游戏数据时为 `unavailable`，不存在的资源可为 `null` |
| `ui` | 注册功能页、悬浮窗和偏好项，需 `ui.register`；注册返回 disposer |
| `views` | 发布最新状态、flush 和接收页面命令；只在同一插件的页面之间通信 |
| `audio` | `play` 播放包内音频，需 `audio.play` |
| `tts` | `say` 需 `tts.say`，`provide` 需 `tts.provide`；用户选择声音和播放方式 |
| `host` | `openExternal` 询问用户后打开 HTTP(S) 地址，返回 `opened` 或 `cancelled` |
| `http` | `request` 需 `http.request` 和 `networkOrigins`，返回状态码、headers、最终 URL 和 body 字节；拒绝时为 `unavailable` |
| `config` | 按 key 读写 JSON 配置；不支持 bigint 或二进制值 |
| `storage` | 读取、写入、删除和列举插件自己的文件；二进制用 `Uint8Array` |
| `log` | `debug` / `info` / `warn` / `error`，附加字段使用 JSON |
| `notifications` | `send` 添加宿主通知；标题非空，通知保留到宿主退出，宿主保留最近 50 条 |
| `clock` | `now`、`state`、`sleep`、`setTimeout` 使用当前 live / replay 时钟 |
| `services` | 提供、发现、调用和订阅其他插件的服务，需相应的 `services.provide` / `services.consume` |


## 状态查询

声明 `game.read` 后查询指定字段。`unknown` 或 `unavailable` 都需要保留为未知状态：

```ts
import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'

export async function activate(context: PluginContext) {
  const sample = await context.game.getPlayer({ fields: ['inCombat'] })
  const field = sample.value.inCombat
  if (field?.state === 'ok') context.views.set('combat', { inCombat: field.value })
}
```

需要持续变化时订阅，等待 `subscription.ready` 后使用。初始查询和订阅之间的先后处理见[数据与事件](data-model.md)。

## 图标与资源

图标按需传给请求它的页面，避免塞入周期快照。声明 `data.read` 后在 Worker 中处理命令：

```ts
import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'

export async function activate(context: PluginContext) {
  const remove = await context.views.onCommand('icon', async (value) => {
    const icon = await context.data.icon(Number(value))
    return icon ? { ...icon } : null
  })
  return remove
}
```

`data.icon` 返回 PNG 字节或 `null`；页面创建 Blob URL，替换或销毁时释放它。`data.image` 和 `data.map` 返回属于当前激活和游戏数据的本地 URL，切换客户端后重新获取。`data.resource` 返回原始字节。

`data.version()` 每次读取 `ffxivgame.ver`，文件不存在或为空时为 `null`，调用期间数据切换时为 `stale_session`。用版本清理游戏数据缓存。`rowIds` 按升序返回普通表的实际行 ID，单元格由 `rows` 读取；无语言的表使用 `none`。

## 语音

manifest 用 `tts.channels` 声明 channel；`tts.say(text, { channel })` 默认使用 `default`。用户在 Mojito 中选择声音和播放模式。朗读完成后 resolve，中止或被替换时以 `cancelled` 拒绝；无可用声音时为 `unavailable`。

`tts.provide` 注册声音与异步合成函数，返回 `VoiceProvider`，可以 `update` 或 `dispose`。`online: true` 表示文字发往网络服务；宿主缓存在线合成结果并按小队成员名字切分文字，因此合成函数可能只接收句子片段，并使用传入的 `signal` 处理中止。

## 服务

提供者用 `services.provide` 注册 manifest 中的本地服务名；使用者在 `services.consumes` 和调用中使用 `pluginId/name`。`connect` 在提供者未运行或版本不匹配时返回 `null`，供可选功能降级：

```ts
import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'

export async function activate(context: PluginContext) {
  const provider = await context.services.connect('ffcafe.combat-statistics/overlay', '^1.0.0')
  context.log.info('Service lookup', { available: provider !== null })
}
```

`request` 调用方法，`subscribe` 接收服务事件，提供者用 `publish` 发布事件。提供者处理函数收到使用方 ID 和中止信号，并使用提供者自己的 capability。
