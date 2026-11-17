# Mojito plugins

[English](README.md) | 简体中文

[插件开发文档](https://thewakingsands.github.io/mojito-plugins/docs/)：API、权限、页面、样式、签名与发布。

Mojito 插件 SDK、包格式编解码器、开发者示例和官方插件。
需要 Node 24、pnpm 12.13.0 和 stable Rust。本仓库单独克隆即可：

```sh
git submodule update --init --recursive
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
pnpm install --frozen-lockfile
pnpm build:official
pnpm typecheck
pnpm test
pnpm test:package
pnpm test:official
pnpm lint
```

`build:official` 构建 SDK、Rust CLI、WASM 打包工具和官方插件，不需要签名密钥。
悬浮窗模板按 `scripts/overlay-templates/build.mjs` 中记录的上游地址和完整提交拉取源码，
再应用仓库里的补丁和 lockfile。源码归档和许可证放在生成的运行时目录旁边。

## 包

- `packages/plugin-sdk`：`@ffcafe/mojito-plugin-sdk` 及其公开导出。
- `packages/package`：`@ffcafe/mojito-package`，Node CLI 和浏览器共用的 WASM API。插件作者使用已发布工具包只需要 Node 24。
- `packages/matcha`：Matcha 的 worker、设置页，以及来自 `vendor/matcha-overlay` 的界面。
- `packages/combat-model`：战斗模型（拆分持续伤害、按增益分摊伤害、采集威力样本）。
- `packages/combat-statistics`：战斗统计及其悬浮窗服务。
- `packages/overlay-plugins`：OverlayPlugin 模板插件（Kagerou、Skyline、MopiMopi2 等）。
- `packages/raidboss`：固定版本的 Raidboss 运行时和规则集。
- `packages/plugin-raidboss`：官方 Raidboss 插件和共用的视图。
- `packages/raidboss-tools`：社区规则包构建工具。
- `packages/plugin-skill-display`：SkillDisplay，见下文。
- `packages/deepseek-tts`：DeepSeek 语音，见下文。
- `crates/plugin-protocol` 和 `include`：共用的原生协议和 C ABI。
- `crates/package`：CLI、编解码器、原生校验器和浏览器校验器。

包名和插件 ID 保持不变。宿主以 git 依赖的方式引用本仓库某个固定提交上的 SDK，由 pnpm 运行
其 `prepare` 脚本构建；原生包则通过 Cargo git tag 引用。不要给这样的提交推送 `sdk-v*` tag：
该 tag 会把 SDK 发布到 npm。同时修改两个仓库时，开发阶段用临时的本地链接或 Cargo override，
最后提交锁定的 git 源。本地 override 不要提交。

## 发布 SDK

先在 `packages/plugin-sdk/package.json` 中设好版本号，再推送 `sdk-v<version>`。
tag 必须与该版本一致，并指向 `main` 上的提交。SDK 工作流会先构建、类型检查并测试 SDK，
再通过 OIDC 发布到 npm。

在 npm 上为 `@ffcafe/mojito-plugin-sdk` 配置可信发布者：仓库 `thewakingsands/mojito-plugins`，
工作流 `sdk-publish.yml`，不设 environment，允许运行 `npm publish`。不需要 npm token secret。
添加可信发布者后，须在两天内完成首次发布。

```sh
npm trust github @ffcafe/mojito-plugin-sdk --repo thewakingsands/mojito-plugins --file sdk-publish.yml --allow-publish
```

## 发布打包工具

`pnpm build:package:npm` 构建 WASM 和 JavaScript 包；`pnpm test:package:npm` 校验 CLI、原生互操作，以及 PATH 中没有 Rust 时安装的 npm tarball。
发布前确认打包工具的许可证，将正文和许可声明纳入 npm 包，并为 `@ffcafe/mojito-package` 配置本仓库 `package-publish.yml` 的 npm 可信发布者。
获授权后推送 `package-v<version>`，标签须匹配 `packages/package/package.json` 的版本并指向 `main` 上的提交。工作流完成构建和测试后通过 OIDC 发布。

## 为官方包签名

首次正式发布前，为全部官方插件生成一个 Ed25519 JWK，并保留下来用于以后的更新。
密钥放在仓库和插件输入目录之外：

```sh
pnpm pack:official /path/to/official.jwk EXPECTED_FINGERPRINT
```

该命令打包并校验现有的 `dist` 目录，读取签名后的 manifest，在 `dist/official` 下为每个官方插件
（列表见 `scripts/pack-official.mjs`）写出一个 `.mojito` 包，以及 `SHA256SUMS` 和模板源码归档。
插件版本取自各自的 manifest。

`official-v*` tag 工作流在没有 secret 的情况下构建，通过 artifact 传递运行时目录和 CLI，
再在单独的 job 中签名。把共用私钥配置为 secret `OFFICIAL_SIGNING_JWK`，把它的公钥指纹配置为
变量 `OFFICIAL_SIGNER_FINGERPRINT`。Release 附件需手动上传到 Mojito server。
发布 SDK 版本、推送 tag 和发布官方包都需要相应的发布授权。Cargo 使用的源码 tag `v0.1.0`
与官方发布 tag 相互独立。

## 开发者示例

`examples/plugin-worker` 在 Worker 中运行，[`examples/plugin-views`](examples/plugin-views/README.zh-CN.md)
演示页面和开发时的 HMR，`examples/plugin-native-rust` 是一个独立的原生插件项目。
[`examples/overlayplugin-fixture`](examples/overlayplugin-fixture/README.zh-CN.md) 提供合成的悬浮窗输入。
`examples/tts-provider` 提供两个蜂鸣音色，并在两个 TTS 频道中说话。
[`examples/catalog`](examples/catalog/README.zh-CN.md) 是一个静态发布示例，包含签名的 `.mojito` 包和对应的插件仓库（catalog）元数据。
插件在已安装的 Mojito 宿主中运行；构建插件只需要本仓库。
宿主集成驱动脚本在 [Mojito](https://github.com/thewakingsands/mojito) 仓库中。

## 编解码器与 web CI

当编解码器的 Rust 源码、协议、头文件、测试脚本、`examples/catalog` 示例或共用的 Rust 构建输入发生变化时，
CI 在 Linux 和 Windows 上校验编解码器。PR 中的 web 构建关注校验库、web 资源、npm 打包工具、构建脚本和共用的 Rust 输入。
工作区依赖变化也会触发 web 构建。修改 checks 工作流会同时触发两者。

浏览器校验器构建到 `dist/package-web`，Worker 和 WASM 使用相对地址，因此可以部署在 Pages 的
`/mojito-plugins/` 路径下。只有仓库变量 `PAGES_DEPLOY_ENABLED` 为 `true` 时，推送到 `main`
才会构建校验器与文档，合成为一个 `dist/pages` 产物，并通过 `github-pages` environment 部署；
文档位于其中的 `docs/`。设置该变量之前，
先把 Pages 的来源设为 GitHub Actions、在该 environment 中允许 `main` 并授权部署；
工作流不会自动修改这些设置。

## SkillDisplay

`packages/plugin-skill-display` 以时间条显示自己释放的技能。在宿主的悬浮窗管理中添加 SkillDisplay，
再在插件设置中选择时间范围、图标大小和方向。设置页带有循环播放的预览；置顶、锁定和鼠标穿透使用
宿主的悬浮窗控制。

## DeepSeek 语音

`packages/deepseek-tts` 为 Mojito 提供 DeepSeek 的海星（stella）和暗潮（tide）两个 TTS 音色。
需要自己的 DeepSeek API key：在插件设置页填写后，这两个音色会出现在 Mojito 的 TTS 设置中。
设置页还会显示按官方价格估算的累计费用。
