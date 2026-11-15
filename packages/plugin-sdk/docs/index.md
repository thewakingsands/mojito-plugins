# 插件开发文档

Mojito 插件由后台 Worker 或 Windows 原生模块提供逻辑，通过独立网页提供功能页、设置页和悬浮窗。

从[快速开始](getting-started.md)运行一个 Worker；需要页面时阅读[页面与悬浮窗](features.md)和[页面 bridge](api/view.md)，准备分发时阅读[打包与签名](packaging.md)及[发布与更新](publishing.md)。

## 兼容版本

本指南面向 Plugin API **2.0.0**，示例声明 `apiVersion: "^2.0.0"`。SDK 的 npm 版本、Plugin API 版本、manifest 的 `schemaVersion: 1` 和 native `abiVersion: 1` 分别独立编号。

API 2 与 1.x 不兼容。[权限](permissions.md)解释当前的 capability 和拒绝行为；完整签名由 SDK 包中的 `.d.ts` 提供，网页中的类型链接指向公开源码。

## 查找用法

- [服务与生命周期](api/context.md)：读取游戏数据、存储、网络、语音及跨插件服务。
- [数据与事件](api/data-model.md)：可用性、批次、会话和回放时钟。
- [Manifest](manifest.md)：插件声明和版本范围。
- [SDK 入口](api/exports.md)：导入位置和测试工具。

## 给 Agent

从 [llms.txt](./llms.txt) 找到主题的 Markdown，也可以读取 [llms-full.txt](./llms-full.txt)。两者都从本网站的正文生成。
