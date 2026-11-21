# 插件 SDK

[中文开发文档](docs/index.md) · [English documentation](docs/en/index.md)

文档包含 Plugin API 2 的快速开始、manifest、权限、服务与页面、样式、开发调试、打包签名及发布流程。完整方法签名随 SDK 的 `.d.ts` 提供。

也可以阅读[在线文档](https://thewakingsands.github.io/mojito-plugins/docs/)或从 [llms.txt](https://thewakingsands.github.io/mojito-plugins/docs/llms.txt) 按主题读取 Markdown。

## 按来源顺序记录观测

清单要求 Plugin API `^2.2.0` 时，旧宿主会在启动插件前提示版本不兼容。以下示例只记录队伍变化。快照可能分批，空闲或空回放没有可虚构的开始时间。文件由用户在系统保存对话框中选择。

```ts
import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'

async function recordParty(ctx: PluginContext) {
  const file = await ctx.host.openWriteFile({ extensions: ['txt'] })
  if (!file) return
  const encoder = new TextEncoder()
  let initialized = false
  const sub = ctx.observations.subscribe({ memory: ['party'], initial: true }, async batch => {
    for (const { value } of batch.items) {
      if (value.kind === 'snapshotEnd') initialized = true
      if (value.kind === 'snapshotParty' && value.party.state === 'ok')
        await file.write(encoder.encode(value.party.value.memberIds.join(',') + '\n'))
      if (initialized && value.kind === 'memory' && value.memory.kind === 'party')
        await file.write(encoder.encode(value.memory.memberIds.join(',') + '\n'))
    }
  })
  const done = sub.closed.then(async result => {
    await file.close()
    if (result.reason !== 'completed') throw new Error(result.error?.message ?? result.reason)
  })
  return { ready: sub.ready, done, stop: () => sub.finish() }
}
```

页面停止命令调用 `stop()`。调用方同时处理 `ready` 和 `done` 的失败，只有 `done` 成功后才能显示写入完成。跨订阅回调不保证顺序；需要合流时在同一个 selection 中选取所需输入。
