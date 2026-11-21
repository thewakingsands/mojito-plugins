# 数据与事件

完整类型见 [types.ts](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/types.ts) 和 [context.ts](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/context.ts)。

## 可用性

`Field<T>` 在 `state === 'ok'` 时包含 `value`、`observedAt`、`timeBase` 和来源 `from`；其他状态带 `reason`。未请求的字段可以省略。未知或不可用不能转换成零、空名字或 `false`。

`Sample<T>` 把数据放在 `value`，来源放在 `meta`。`sessionId`、`characterGeneration`、`clockGeneration` 和 live/replay 来源用于识别数据所属的会话；比较时间之前先比较这些代数。

`Json` 用于配置和日志，符合 JSON 的基本类型；`Value` 还可以携带 `bigint`、`Uint8Array` 和它们组成的数组或对象，用于 API 与视图传输。

## 订阅

订阅返回 `ready`、`dispose()` 和 `closed`。等待 `ready` 确认建立；释放订阅后检查 `closed` 的原因和可选错误。回调收到 `Batch<T>`，包含 `items`、顺序号、`initial` 和 `complete`；按顺序消费，关注完整性信息，不把每一批都当作完整快照。

异步回调完成前 SDK 不会送下一批。宿主每次等待插件时对每个订阅最多等 300ms，超时的订阅在处理完当时已收到的数据之前不再被等待，期间查询到的游戏状态可能比正在处理的事件新；积压超过上限时订阅以 `overflow` 关闭。保存必要数据后尽快返回；订阅失败、中止、来源结束或数据缺失应反映到功能状态。

## 初始快照和失效

既要当前值又要后续变化时，先订阅，再查询当前值。查询返回之前如果订阅已经送来了新数据，查询结果就过期了，应该丢弃，即使两者的时间戳相同：

```ts
let revision = 0
let player: PlayerState | null = null
const subscription = context.game.subscribe('player', (batch) => {
  revision++
  for (const sample of batch.items) player = sample.value
}, { fields: ['inCombat'] })
await subscription.ready
const before = revision
const initial = await context.game.getPlayer({ fields: ['inCombat'] })
if (revision === before) player = initial.value
```

会话或角色变化、事件源丢失和回放重置时，清理旧状态。

游戏状态订阅可以合并快速变化；需要保留每次变化时使用事件订阅。需要跨事件顺序时在同一次 `events.subscribe` 中列出多个类型。

## 战斗与状态

玩家 `inCombat` 来自自身 ToggleAggro 数据包，用 `game.read` 或 `events.read` 获取，不要求原始数据包或内存 capability。`playerCombatChanged` 的初始有效值会发出，相同值只刷新观察时间；区域切换、会话变化和来源丢失可能使它不可用，不会合成一个 `false` 事件。

`targetableChanged` 和 `cutsceneChanged` 来自采样内存，没有 packet 元数据；旧记录或缺少相应签名的客户端可能不提供。`statusesReplaced` 保留原始 `slot`；状态变化按槽位匹配。`statusSlotsChanged` 中刷新表现为旧状态消失后新状态出现。

战斗计算使用 `actionEffect`、`statusSlotsChanged`、`actorProfileChanged`、`overTimeTick`、`jobGaugeChanged` 和 `playerStatsChanged` 等输入。`SessionSnapshot.opcodeVersion` 与插件状态数据不匹配时停止相应计算。需要派生战斗结果时使用公开的 [combat-model](https://github.com/thewakingsands/mojito-plugins/tree/main/packages/combat-model)。

`statusSlotsChanged.data.changes[].status.durationMs` 保留包内时长的符号，单位为毫秒。内存移除触发 `lost` 时，状态的 `observedAt` 与 `timeBase` 仍对应最初的包；事件自身使用移除观测的时间。

## 时间与错误

live 使用宿主时钟，replay 使用记录时钟。用 `context.clock.now/state/sleep/setTimeout` 跟随暂停和倍速；`now()` 尚不可用时返回 `null`。回放倒退引起代数变化和失效，按 `clock_reset` 处理等待失败。

API 失败使用带 `code`、`message`、`retryable` 的 `PluginError`。常见的 `invalid_argument` 要修正输入，`permission_denied` 要核对声明，`unavailable` 要处理当前不可用，`stale_session` 要丢弃过期结果，`cancelled` / `plugin_stopped` 要结束工作。传输和队列仍有限制，以 `context.limits` 的当前值为准。
