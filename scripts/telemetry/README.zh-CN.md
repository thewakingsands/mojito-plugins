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
