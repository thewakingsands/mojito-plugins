# 悬浮窗插件

[English](README.md) | 简体中文

构建 SDK 和本工作区，在 `dist` 下为每个 OverlayPlugin 模板生成一个运行时目录：
`kagerou`、`skyline`、`mopimopi2`、`faceroll`、`horizoverlay`、`cmskin`、`mopimopi1`、`ikegami`、`ember`、
`amethyst`、`klondike` 和 `glass`。构建会把固定的上游提交拉取到自己的临时目录。源码归档和构建补丁
输出到运行时目录旁边的 `dist/sources`。

每个插件都需要 Mojito Plugin API 2.0.0 和 `ffcafe.combat-statistics/overlay` 服务 v1。先安装并启用战斗统计，
再启用悬浮窗插件。服务提供方停止后，恢复它并重新启用使用方即可重新连接。

Ember 通过兼容页面的 `getGameIcon` 调用读取 Mojito 游戏数据中的技能和状态图标，worker 查询对应数据行后
返回属于当前激活的图片 URL。模板构建优先保留 WOFF2，并且只复制页面使用的字体字重。

用现有的 Rust CLI 和 Ed25519 私钥 JWK 为每个插件生成包，例如：

```sh
mojito-package pack dist/kagerou private-key.json Kagerou.mojito lzma2
mojito-package pack dist/skyline private-key.json Skyline.mojito lzma2
mojito-package pack dist/mopimopi2 private-key.json MopiMopi2.mojito lzma2
mojito-package verify Kagerou.mojito
```

普通构建不需要签名密钥。每个运行时目录都包含上游源码链接、版本/修订号和许可证声明。同级的源码归档
包含打过补丁的源码和构建输入；构建脚本中的工作区路径以记录的 Mojito 检出为准。模板页面直接从已安装
的 `.mojito` 资源加载。
