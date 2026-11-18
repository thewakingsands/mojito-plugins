# 合成的悬浮窗服务测试插件

[English](README.md) | 简体中文

请使用单独的验收配置。本测试插件有意使用 `ffcafe.combat-statistics` 的 ID，向独立的悬浮窗插件提供合成的
`ffcafe.combat-statistics/overlay` 状态；日常使用的配置中请安装真正的战斗统计插件。

先构建本仓库的 SDK、战斗统计和悬浮窗插件工作区，然后运行：

```sh
pnpm exec vite build --config examples/overlayplugin-fixture/vite.config.ts
```

输出位于 `.tmp/overlayplugin-fixture`。用现有的 Rust CLI 把它和各悬浮窗插件目录分别打包。
先启用本测试插件（服务提供方），再启用各使用方。测试插件的控制功能页通过同一份服务约定发布
合成的场景，并处理结束战斗的命令。不使用真实账号、游戏输入或在线客户端。

做远程协议检查时，测试工具可以定义 `__OVERLAY_FIXTURE_SOURCES__`，指向宿主管理的配置。
包内页面和弹出窗口只能访问已声明的文档和自身资源；宿主提供带沙箱的兼容 preload。
远程配置保持原有的 HTTP(S) 网络和权限限制。

验收脚本可以在控制视图中调用 `fixtureState(state)`，发布一个合成的 `OverlayState`。
测试插件发布前先用 SDK 校验它；这样可以精确地修订最后一帧，而不改变统计计算。
