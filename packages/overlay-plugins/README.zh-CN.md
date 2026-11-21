# 悬浮窗插件

[English](README.md) | 简体中文

构建 SDK 和本工作区，在 `dist` 下为每个 OverlayPlugin 模板生成一个运行时目录：
`kagerou`、`skyline`、`faceroll`、`horizoverlay`、`cmskin`、`mopimopi1`、`ikegami`、`ember`、
`amethyst`、`klondike` 和 `glass`。构建会把固定的上游提交拉取到自己的临时目录。

Ember 需要 Mojito Plugin API 2.1.0，其他插件需要 API 2.0.0。
所有插件都需要 `ffcafe.combat-statistics/overlay` 服务 v1。先安装并启用战斗统计，
再启用悬浮窗插件。服务提供方停止后，恢复它并重新启用使用方即可重新连接。

Ember 通过兼容页面的 `getGameIcon` 调用读取 Mojito 游戏数据中的技能和状态图标，worker 查询对应数据行后
返回属于当前激活的图片 URL。模板构建优先保留 WOFF2，并且只复制页面使用的字体字重。

用现有的 Rust CLI 和 Ed25519 私钥 JWK 为每个插件生成包，例如：

```sh
mojito-package pack dist/kagerou private-key.json Kagerou.mojito lzma2
mojito-package pack dist/skyline private-key.json Skyline.mojito lzma2
mojito-package verify Kagerou.mojito
```

普通构建不需要签名密钥。插件主页链接到固定的上游源码，运行时目录通过 `SOURCE.txt` 记录
对应的补丁，并保留许可声明。模板页面直接从已安装的 `.mojito` 资源加载。

`src/combatants.ts` 的 `registerCombatants(ctx, channel)` 注册 `${channel}/combatants`，供现代页面的
`getCombatants` 调用。应在打开悬浮窗前注册，停止时释放；Ember 使用 `combat`。查询按 ID 与名称的并集筛选，
名称忽略大小写完整匹配，`props` 区分大小写。空筛选返回所有角色，空 `props` 返回全部可用字段。

支持 `ID`、`Name`、`Job`、`Level`、`CurrentHP`、`MaxHP`、`CurrentMP`、`MaxMP`、`PosX`、`PosY`、
`PosZ`、`Heading`、`OwnerID`、`TargetID`、`WorldID`、`CurrentWorldID`、`WorldName`、`BNpcID`、
`BNpcNameID` 和 `Type`。缺失值省略，已知无主人或目标时对应 ID 为 0。位置按游戏 x/z/y 输出，`PosZ` 为高度，
Heading 保留弧度。请求 `WorldName` 且数据可用时，从客户端的 `World` 表读取所属世界的显示名称。查询沿用 SDK 身份处理，
完成前来源发生变化时返回 `unavailable`。
