# Matcha for Mojito

MJT-43 的独立分支实现。后端迁移自 `Cafe.Matcha`，界面使用 `vendor/matcha-overlay` 固定提交，保留 AGPL-3.0 许可。

## 构建和安装

仓库根目录运行：

```powershell
git submodule update --init --recursive
pnpm install
pnpm --filter @ffcafe/mojito-matcha... build
```

构建结果位于 `packages/matcha/dist`。用现有 Rust CLI 和自己的 Ed25519 私钥 JWK 签名：

```sh
mojito-package pack packages/matcha/dist private-key.json Matcha-4.0.0-mojito.9.mojito lzma2
mojito-package verify Matcha-4.0.0-mojito.9.mojito
```

在 Mojito 的插件页安装生成的 `.mojito` 包，按需授予敏感权限，然后启用。启动后提供 **Matcha** 悬浮窗，以及“设置 › 插件设置”里的 **Matcha 设置**页。主窗口里没有 Matcha 的功能页，全部功能都在悬浮窗里。

悬浮窗的界面来自 `vendor/matcha-overlay`，和 ACT 版共用同一套界面：固定的深色半透明底，配色、字号和控件沿用 Mojito 的深色主题。设置页使用宿主的 `/host/mojito-base.css`，修改立即生效。

包格式与 worker 状态发布使用当前 Mojito SDK。需要 Plugin API 2.0；能力以 context.capabilities.get() 报告的状态为准，运行中修改授权无需重启。通知使用 SDK 的 context.notifications.send。

## 功能

- FATE 关注列表（按版本和区域批量选择）、预设与通知；副本匹配、地区、咬钩、临界遭遇和寻宝结果通知。
- 市场板价格与 Universalis 比较、装备比较、仙人微彩计算、藏宝图位置和寻宝结果。
- 潜水艇部件、航行状态与规划。
- 钓鱼状态、鱼获归档、社区鱼漂分布、可选匿名数据上传，以及登录数据中的钓鱼笔记导出。
- Webhook、设置备份和导入导出。

一个 worker 收集数据并维护共享状态。打开设置页或多个悬浮窗不会重复抓包或上报；新视图恢复当前状态。切换会话、角色、回放时间或抓包订阅中断时清除旧状态。正常换地图保留角色的钓鱼笔记。

## 双数据源

`matcha-overlay` 可独立构建、部署为静态网站，用在 ACT OverlayPlugin。原有 `OVERLAY_WS` WebSocket 参数及 `OverlayPluginApi` 接入继续可用。

在 Mojito 内加载时自动使用 SDK bridge。可以用 `?source=mojito` 显式选择；此模式需要真正的 Mojito bridge。ACT 与 Mojito 模式分别使用各自的配置存储，不会共享两个宿主的个人数据。

Mojito 模式通过宿主本地数据接口读取物品、地图、图标、FATE、副本、世界、钓鱼和潜水艇数据。宝图坐标由游戏的藏宝点与地图表换算，FATE 和临界遭遇通过客户端场景资源关联区域；预设从 RelicNote 读取。客户端版本或数据语言变化后重新加载，读取失败时显示不可用，不回退到静态游戏表或 XIVAPI。ACT 模式单独加载原有数据，Mojito 构建不包含这批静态表。

潜水艇的探索解锁前置关系属于人工规则，仍随插件提供；名称、属性、经验和坐标均取自当前客户端。首次读取会按批扫描游戏表，仅保留 Matcha 使用的字段。社区服务仍通过宿主 HTTP 代理，并遵守权限和 CSP。

## 权限和联网

会话、游戏信息、本地数据、UI 和音频随安装启用。数据包、内存、HTTP 和真实角色身份为敏感权限，可在安装时拒绝或之后撤回。未授权的功能显示不可用或不执行；未授予真实角色身份时使用宿主提供的匿名身份。导入使用浏览器文件选择，导出使用下载保存。

鱼漂与 Universalis 各使用一个开关，同时控制查询和上传，默认关闭。回放不会触发通知、Webhook 或上报。Universalis 的 API key 和 uploader ID 在打包时由环境变量 `MATCHA_UNIVERSALIS_API_KEY`、`MATCHA_UNIVERSALIS_UPLOADER_ID` 注入，用户不能自行填写；打包时没有这两个值，Universalis 的查询和上传都不可用，设置页里的开关也不可用。

默认允许的网络源限于游戏资料、地图及图标资源、Universalis 和鱼漂查询。使用自建 Webhook 服务时，需要在打包时明确加入对应 HTTPS origin，再重新安装并授权：

```powershell
node packages/matcha/scripts/package.mjs --origin=https://your-service.example
```

自定义源不会通过设置绕过宿主限制；HTTP 请求及重定向必须匹配 networkOrigins，使用系统代理，超时由调用方指定。设置备份包含 Webhook 请求头，请自行保管。归档保留 Matcha 自身的单文件存储预算；API 2.0 的宿主不再强制该预算。

## 数据与兼容性

数据包使用 Mojito 提供的类型名称，不引入另一套 opcode 或扫描器。二进制字段沿用 Matcha 的已知布局；实际游戏版本仍须由宿主提供匹配的客户端配置。采集属性只读，不能读取时不编造数值，也不会上传不完整的钓鱼样本。

后端迁移来源：Cafe.Matcha `15b2d4adece864c7a0f15729d7179e5b7d2ab821`；前端的版本由 `vendor/matcha-overlay` 子模块提交固定。此分支不包含源仓库的私密配置、发布凭据或本地验收记录。

## 开发验证

```powershell
pnpm exec vitest run packages/matcha
pnpm --filter matcha-overlay test
```

测试使用合成数据包和假 HTTP，覆盖协议字段、状态重置、跨视图恢复、同意撤回、旧请求失效及导入导出边界。真实客户端版本兼容和外部服务响应需在对应环境另行确认。
