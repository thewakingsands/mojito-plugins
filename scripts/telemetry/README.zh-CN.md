# 遥测验收

[English](README.md) | 简体中文

运行 `pnpm typecheck`、`pnpm test`、`pnpm lint` 和 `pnpm build:official`。
`packages/combat-statistics/testdata/telemetry-v1.json` 必须与 mojito-server 的
`testdata/telemetry-v1.json` 逐字节一致。

服务端可选的 `TestTelemetryClientRoundtrip` 使用本检出目录中真实的
入口、模型、权限和收尾测试，只替换其中的 HTTP 传输。
在 mojito-server 中运行该测试时，设置 `TEST_TELEMETRY_PLUGINS_DIR` 和
`TEST_TELEMETRY_CLIENT_DATABASE_URL`；数据库必须是全新的、可丢弃的。

要测试真实的 Worker 和设置页，先构建一个兼容 Plugin API 2.0 的 Mojito 宿主，再用它的 Electron
可执行文件运行：

```sh
MOJITO_HOST_ROOT=/absolute/mojito \
MOJITO_TELEMETRY_OUTPUT=/absolute/disposable-output \
/absolute/mojito/packages/@ffcafe/mojito-launcher/node_modules/electron/dist/electron \
  scripts/telemetry/isolation.cjs
```

Linux 需要显示环境（虚拟显示即可）。脚本把构建好的战斗统计插件安装到一个可丢弃的宿主配置中，
通过真实的设置页检查敏感权限和自动保存的同意状态，然后注入合成的实时输入。它只替换宿主的
HTTP fetch 传输，保留来源和权限检查；测试请求不会到达正式的收集服务。收到 503 响应以及重启之后，
都不能重试。`result.json` 和设置页截图写入输出目录。测试使用全部玩家范围，因为 Linux
无法读取 Windows 游戏进程中的小队内存。

Windows 验收仍需要真实的游戏连接。需要验证：开启和拒绝权限两种情况、完整的状态输入、
符合条件的一场战斗结束后只向隔离服务发送一次请求，以及断线或重启后不重试。
一场没有符合条件的未知状态的战斗只能说明不会误报，不能证明正常上报的路径可用。

## 离线统计

先构建模型：`pnpm --filter @ffcafe/mojito-combat-model build`。
用管理员会话 Cookie 请求 `GET /api/admin/telemetry/events?type=combat.unknown-status`，
将每页响应保存为 JSON 文件；有 `nextCursor` 时，把它作为下一页的 `cursor` 参数继续读取。
也可以直接提供事件数组。脚本按 `eventId` 去重，因此重叠页不会重复计入。

```sh
pnpm --filter @ffcafe/mojito-combat-model telemetry:stats page1.json page2.json
pnpm --filter @ffcafe/mojito-combat-model telemetry:stats --json --model-version 7.57 page1.json
```

客户端只上传正常命中伤害的计数、和、平方和与威力，以及暴击和直击次数、已知概率加成之和，
不上传逐击记录。每场至多一次；样本达到下限即可参与，不要求伤害偏差超过 10%。
伤害对照使用同场同玩家、技能和目标的干净命中，概率对照按同场玩家汇总。
观测超过 1024 条或整个请求超过 256 KiB 时，优先删除样本最少的观测，保留完整状态组合。

输出包含伤害比、暴击率差、直击率差的估计值与 95% 区间，以及技能分类、平均威力和样本量。
多状态组合不拆分。缺少对照时，相应统计量为空；不符合格式的事件会跳过并计数。
脚本只输出统计量，修改 `ClassJobActions` 或公共状态定义前需要人工核对。
