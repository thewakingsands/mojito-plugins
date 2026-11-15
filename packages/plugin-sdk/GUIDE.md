# 插件开发指南

## 清理

`activate(context)` 可以返回一个 disposer，在正常停止时完成未做完的工作。宿主会暂停推送事件，
允许 disposer 在最多 10 秒（按实际时间计）内继续使用已有的授权，包括 `await context.storage.write(...)`。
用户可以提前结束清理。清理完成、失败、超时或被提前结束后，宿主撤销 context 并终止运行时；
崩溃时不会执行清理。因此平时也要定期保存：强制终止时无法保证最后一次写入。

## 玩家战斗状态

`game.getPlayer({ fields: ['inCombat'] })` 和 `player` 状态订阅返回 `Field<boolean>`。
使用 `value` 前先检查 `state === 'ok'`；`unavailable` 不等于 false。该字段来自本地玩家收到的
ToggleAggro 数据包，不需要内存或数据包权限，也不需要 content ID 或已填充的 `player.actorId` 字段。
它的 `observedAt` 是观测到数据包的时间，不是查询时间。实时观测使用宿主时钟，回放观测使用录像的时钟。

用 `events.subscribe('playerCombatChanged', listener)` 按顺序接收每一次有效观测。数据为
`{ actorId, inCombat }`，附带标准的数据包和来源元数据。第一个有效值（包括 false）会发出；
同一角色的相同值只刷新字段，不重复发出事件。需要和技能保持顺序时，同时订阅
`['playerCombatChanged', 'actionEffect']`。`actorIds` 过滤条件作用于玩家；技能和状态过滤条件
对该事件无效。旧版宿主可能以 `invalid_argument` 拒绝不认识的事件类型。

`targetableChanged` 在玩家或战斗 NPC 首次出现以及可选中状态变化时给出 `{ actorId, targetable }`；
`cutsceneChanged` 在本地玩家开始或停止观看过场动画时给出 `{ playing }`。两者都来自内存采样，
因此没有 `packet`，这两个事件出现之前录制的录像里也没有它们。`actorIds` 适用于 `targetableChanged`，
对 `cutsceneChanged` 无效。客户端配置没有 `conditions` 特征码时，也不会有 `cutsceneChanged`。

状态订阅可能把快速出现的 true → false 合并为一次；事件订阅会保留两次观测。先订阅，再请求初始快照。
在本地记录一个通知序号：如果查询等待期间收到了更新的事件、失效通知或会话重置（时间戳相同也算），
就丢弃这次查询结果。不要用迟到的快照覆盖更新的通知。先比较来源代次（generation），再比较观测时间。
Mojito 仓库的 `scripts/plugin-isolation/fixtures/combat-state` 演示了这种保护。

已知的 false 在切换区域后仍然可用，观测时间不变。区域边界上初始的未知状态或已知的 true 会变为
unavailable，直到下一次有效的 ToggleAggro。会话或角色切换、回放重置以及检测到事件源丢失时，
缓存的状态会被清除；暂停和改变回放速度时保留。无效的 ToggleAggro 值会被忽略并记录宿主诊断信息，
不会伪造 false，也不会终止订阅。失效要通过游戏状态以及会话、区域、数据流结束通知来判断：
宿主不会为此发出合成的 false 事件。

旧的 v1 录像只要包含有效的、以自己为目标的 ToggleAggro，也能提供该字段。从战斗中途开始的录像
在收到这样的数据包之前保持 unavailable。遭遇战活动和 ACT 单独的 `inACTCombat` 都不能代替游戏的战斗状态。

## 存储预算

在 `plugin.json` 中声明存储预算，安装确认界面会在授权前显示。每个字段都可以省略，默认总量 32 MiB、
单个文件 3 MiB。

```json
"storage": { "totalBytes": 536870912 }
```

Worker 插件还可以申请更大的单文件，例如 `"storage": { "totalBytes": 536870912, "fileBytes": 33554432 }`。
读写仍使用整文件的 `context.storage.read/write`，实际生效的值从
`context.limits.values['storage.pluginBytes']` 和 `context.limits.values['storage.fileBytes']` 读取。

显式填写的值必须是不小于默认值的安全整数，单文件预算不能大于总量；native 插件的单文件预算不能超过默认值。
从 Plugin API 2.0.0 起，这些是插件给自己定的预算：宿主报告这些值，但不会拒绝超出预算的写入。
native 插件的每条消息仍要放得进 4 MiB 的传输帧。

## 发布视图

调用 `context.views.set(channel, value)` 发布某个视图 channel 的最新值。之后打开的视图会收到这个值，
已订阅的视图会以更新的形式收到。SDK 只保留每个 channel 的最新值，最多每 200ms 发给宿主一次，
所以每个事件都调用 `set` 也没有问题。传给 `set` 之后不要再修改这个对象：它在发送时才被读取，
而不是在调用 `set` 时。

需要视图立即看到值时，例如在命令返回之前，调用 `await context.views.flush()`。它会发送所有尚未发送的值，
并在宿主处理完后 resolve。

如果宿主拒绝某个值（例如超出大小限制），SDK 会在插件日志中写一条警告，下一次 `set` 或 `flush` 会抛出该错误。
宿主保留上一次接受的值。

```ts
context.views.set('state', { selected })
await context.views.flush()
```

## 游戏图标

有 `data.read` 时，调用 `context.data.icon(iconId)` 从已打开的游戏目录读取 PNG。图标不存在时返回 `null`。
按需把结果发给请求它的视图；不要把图片字节放进定期发布的快照。

```ts
// Worker：把图标返回给请求它的视图。
await context.views.onCommand('icon', async (id) => {
  const icon = await context.data.icon(Number(id))
  return icon ? { ...icon } : null
})
```

```ts
import type { GameIcon } from '@ffcafe/mojito-plugin-sdk'

// 视图：替换图片或销毁视图时释放之前的 URL。
const icon = await bridge.command('icon', iconId) as GameIcon | null
if (objectUrl) URL.revokeObjectURL(objectUrl)
objectUrl = icon ? URL.createObjectURL(new Blob([icon.data], { type: icon.mime })) : undefined
image.src = objectUrl ?? ''
```

## 游戏数据版本

Plugin API 1.4.0 新增 `context.data.version()`，需要 `data.read`。它返回已打开的游戏目录中
`ffxivgame.ver` 的内容（去掉首尾空白），文件不存在或为空时返回 `null`。没有打开游戏数据时以
`unavailable` 失败；调用期间游戏数据被打开或关闭时以 `stale_session` 失败。宿主每次调用都重新读取文件，
所以 Mojito 运行期间游戏更新后会返回新版本。用它在版本变化时丢弃从游戏数据缓存的内容。

```ts
const version = await context.data.version()
if (version !== null && version !== saved.version) await clearCache()
```

## 设置搜索

Plugin API 1.5.0 新增 `context.ui.setPreferenceItems(items)`，需要 `ui.register`。它提交插件设置页里的
`{ id, title, description }` 条目，让宿主的设置搜索和 Ctrl K 能找到它们；每次调用都替换之前的全部条目，
空数组表示清空。用户选中某个条目时，宿主重新打开设置页，并向页面发送 `navigate-to-preference-item`，
数据为 `{ id, keyword }`。在 `connectView()` 得到的对象上用 `view.on(name, listener)` 监听；它返回一个
取消监听的函数，在第一个监听器注册之前到达的事件会保留给它。格式要求和错误见
[docs/features.md](docs/features.md#设置搜索)。

```ts
await context.ui.setPreferenceItems([{ id: 'scope', title: '统计范围', description: '' }])
```

```ts
const view = await connectView()
view.on('navigate-to-preference-item', ({ id }) => highlight(id))
```

## 通知

Plugin API 1.6.0 新增 `context.notifications.send({ title, detail })`，在 Mojito 标题栏铃铛后面的列表里
添加一条通知。用于用户没有在看插件页面时也应该知道的事情。它不需要权限。`title` 不能为空；含未知字段时以
`invalid_argument` 拒绝。Mojito 在主进程中保留所有插件最新的 50 条通知，退出时清空。

低于 1.6.0 的宿主以 `unavailable` 拒绝这个调用。如果插件的 `apiVersion` 范围允许这样的宿主，
应把通知当作可选功能：

```ts
void context.notifications
  .send({ title: '统计已暂停', detail: '恢复后会自动继续统计。' })
  .catch((error) => context.log.debug('发送通知失败', { error: String(error) }))
```

## 打包的 OverlayPlugin 页面

Plugin API 1.1.0 支持 `compatibility.source: { kind: 'package', entry, documents }`。路径指向本插件的文件；
`documents` 列出允许导航和弹出的页面，并且要包含 `entry`。需要声明 `ui.register` 和 `ui.overlayplugin`，
并通过 `overlayProducer` 发布 `OverlayState`。远程页面使用宿主管理的 profile。

有 `data.read` 时，`context.data.resource(path)` 返回 SqPack 中的原始文件字节，不存在时返回 `null`。
`context.data.image(path)` 返回 TEX 资源对应的本地 PNG URL；`context.data.map('s1f1/00')` 返回拼合后的地图 URL。
主文件不存在时这些方法返回 `null`。图片在插件页面请求该 URL 时才解码，URL 只属于当前激活和当前客户端数据。
切换客户端后要重新获取 URL；通过视图 channel 发送 URL，用作图片的来源。

`context.data.rowIds(sheet, language)` 返回普通 EXD 表的全部实际行 ID，按升序排列。它使用 `data.read`，
受传输层集合大小限制。单元格用 `data.rows` 读取。没有语言的表用 `none`；子行通过读取已知的父行来枚举。

## 状态列表槽位

Plugin API 1.7.0 在 `statusesReplaced.data.statuses` 的每一项中保留原始的 `slot`。空槽位仍然省略。
之后的 `statusChanged` 要按槽位匹配，不要按过滤后列表的数组下标匹配。查询得到的 `Status` 值不变。
需要跟踪槽位的插件应要求 `apiVersion: "^1.7.0"`。

## 战斗模型输入

Plugin API 1.9.0 移除了宿主计算的结果：`periodicTick`、`periodicRevision`、`damageAttributed`、
`potencySample` 和 `attributionRevision`，以及它们的类型。1.9.0 及以后的宿主会像对待未知事件类型一样
拒绝对它们的订阅。需要这些结果的插件要求 `apiVersion: "^1.9.0"`，并用 `@ffcafe/mojito-combat-model`
从以下事件自行计算：

- `actionEffect`：每个目标带有 `rawEntries`，即数据包中的 8 个效果条目，模型的 `parseStatusEntries`
  从中读取附加的状态。
- `statusSlotsChanged`：状态更新或状态列表之后某个角色发生变化的槽位，以及按顺序出现和消失的状态。
  刷新的状态先消失再出现。同一数据包的 `statusesReplaced` 先到。
- `actorProfileChanged`：角色的职业、等级或所有者发生变化。可能来自内存记录，没有对应的数据包。
- `overTimeTick`、`jobGaugeChanged` 和 `playerStatsChanged`：持续效果的跳数、玩家的职业量谱，
  以及玩家的暴击和直击属性。

`SessionSnapshot.opcodeVersion` 是宿主解析数据包所用的 opcode 版本。插件把它和自己状态数据对应的版本比较，
不一致时停止计算：游戏已经更新，而数据还没有跟上。

## 语音（TTS）

插件按 channel 发出语音，就像 Android 应用按渠道发送通知。插件决定说什么、在哪个 channel 说；
用户在 Mojito 的 TTS 设置中选择声音和播放方式。

```json
{
  "capabilities": ["tts.say"],
  "tts": { "channels": [{ "id": "alarm", "name": "警报" }] }
}
```

```ts
await context.tts.say('分摊')                         // 默认 channel
await context.tts.say('死刑', { channel: 'alarm' })
```

- 每个有 `tts.say` 的插件都有一个 `default` channel。在 `tts.channels` 中列出 `default` 只是给它命名；
  否则显示为“默认”。channel ID 遵循服务名的格式（`^[a-z0-9]+([._-][a-z0-9]+)*$`）。
- Mojito 从 manifest 中列出 channel，所以用户可以在插件运行之前选好声音。
- `say` 在文字读完后 resolve。channel 不存在时以 `invalid_argument` 拒绝，没有声音能朗读时以 `unavailable`
  拒绝，调用方中止或被其他语音替换时以 `cancelled` 拒绝。
- `audio.play` 立即播放包内的声音，不等待语音。

有 `tts.provide` 的插件可以提供自己的声音。用户可以把它们用于任何插件的任何 channel；之后宿主把文字交给
`synthesize`，并播放它返回的编码音频（MP3、WAV、Ogg/Opus 或其他 Chromium 能播放的格式）。

```ts
const provider = await context.tts.provide(
  [{ id: 'xiaoxiao', name: '晓晓', online: true }],
  async ({ voice, text }, { signal }) => synthesizeWithMyService(voice, text, signal),
)
await provider.update(voices) // 例如在用户填写了 key 之后
```

`online: true` 表示这个声音会把文字发送到网络服务。一个插件同时只有一个注册；调用 `dispose()`、
通过 `signal` 选项中止或插件停止时，注册结束。

宿主会缓存在线声音合成的结果，并按当前小队成员的名字切分文字，每个名字以及名字之间的每段文字分别合成和缓存。
因此 `synthesize` 可能只收到句子的一部分，例如一个角色名，宿主再把各部分连续播放。宿主已经有的文字不会再发给插件，
所以插件看到的请求都是真正需要发出的请求。

## Plugin API 2.0

Plugin API 2.0.0 改变了插件声明什么、用户决定什么。它与 1.x 不兼容：需要重新构建插件，并要求
`apiVersion: "^2.0.0"`。

- `capabilities` 是一个数组。普通 capability（`session.read`、`game.read`、`events.read`、`data.read`、
  `ui.register`、`ui.overlayplugin`、`ui.overlayplugin.remote`、`audio.play`、`tts.say`、`tts.provide`、
  `services.provide`、`services.consume`）随安装授予。敏感 capability（`packets.read`、`memory.read`、
  `http.request`、`identity.read`、`microphone.record`）用户可以在安装时逐个拒绝，也可以之后在插件页面上撤回。
  `host.files` 和 `host.openExternal` 已不存在；包含宿主不认识的名称的包会被拒绝。
- `context.capabilities.get()` 给出每个已声明 capability 的状态。被拒绝的敏感 capability 为
  `{ state: 'denied' }`；`capabilitiesChanged` 会在不重启的情况下更新它。普通 capability 不会被拒绝。
- 被拒绝或未声明的敏感 capability 返回替代结果，而不是报错：
  - 没有 `identity.read` 时，玩家使用每个会话内的替身 actor ID，位于玩家 ID 范围内（`actorControl`、
    `systemLogMessage` 和 `battleTalk` 的 `params` 中也是如此）；名字由种族和 ClassJob 的简称组成
    （`猫白魔`、`猫白魔 2`）；没有 content ID，也没有 `gameLog`。用替身 ID 设置的过滤条件照常生效。
    无论是否授权，玩家都有 `race` 字段；
  - 没有 `packets.read` 时，数据包订阅照常建立，但不会发送任何内容；
  - 没有 `memory.read` 或 `http.request` 时，相应调用以 `unavailable` 拒绝并附带原因；
  - 没有 `microphone.record` 时，`getUserMedia({ audio: true })` 以 `NotAllowedError` 拒绝。
- 服务以提供者命名：`services.provides[].name` 是本地名称，例如 `overlay`；使用方在 `services.consumes`
  和每次调用中使用 `pluginId/name`，例如 `CombatStatistics/overlay`。`connect` 返回 `{ service, version }`
  或 `null`。使用方不需要授权；提供方用自己的 capability 应答，安装界面会告知用户。`dataPermissions`、
  `services.callRequest` 和 `services.callSubscribe` 已移除。
- 语音是 `tts.say(text, { channel })`，需要 `tts.say` capability；`audio.say` 已移除，`audio.play`
  只播放声音。见[语音（TTS）](#语音tts)。
- `host.openExternal(url)` 不需要 capability，每次都会询问用户；也可以打开 `http:` 地址。
- 文件：`host.chooseFile`、`host.readFile` 和 `host.writeFile` 已移除。页面使用 `<input type="file">`
  和下载，下载时会询问保存位置。
- 网络：`http.request` 基于 Electron 的 `net.fetch`，使用系统代理。每一跳重定向都必须在 `networkOrigins`
  中，`networkOrigins` 可以列出 `http:` 和局域网 origin。没有大小和重定向次数的预算，`timeoutMs`
  只在指定时生效。插件页面可以从 `networkOrigins` 加载资源，使用内联样式、Web Worker 和 `blob:`/`data:`
  媒体，并可以在本包的页面之间跳转。
- `context.limits` 只保留传输、事件流控、轮询间隔、回放时钟和存储预算的名称；其他数量、大小和频率限制，
  以及由它们引起的 `quota_exceeded`，都已移除。激活没有时间限制；错过心跳的页面显示为无响应，而不是被停止。
