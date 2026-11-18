# AGENTS.md

本仓库是 Mojito 的插件 SDK、包格式编解码器、开发者示例和官方插件的 pnpm monorepo，另有一个 Cargo workspace。
使用说明见 [README.zh-CN.md](README.zh-CN.md)。

## 文档规则

- **语言**：文档以中文为主。代码标识、命令、文件名、协议名，以及习惯用英文的专有名词（Plugin API、manifest、capability、worker、IPC、HMR、CI、Electron、Velopack 等）保持英文，不硬译。
- **README 中英两份**：`README.md` 写英文，同目录的 `README.zh-CN.md` 写中文，两份内容一致，开头互相链接：英文版写 `English | [简体中文](README.zh-CN.md)`，中文版写 `[English](README.md) | 简体中文`。改其中一份时同时改另一份。
- **独立可读**：仓库里的文档要不依赖外部系统就能读懂。不写内部工单编号、评论链接、spec 版本，也不写某人的意见或决定过程；需要理由时直接写理由本身（写“光泽渐变显得过时，不用”，不写“某某认为像 Aero”）。
- **规范与设计记录分开**：
  - 规范写给之后改代码的人和 Agent，用“要／不要”的句式，适用于新功能。
  - 设计记录写某个页面或流程现在是什么样、为什么这样。
  - 本仓库的规范是本文件和 SDK 的 `docs/style.md`（插件样式规则）；SDK 的 `GUIDE.md`、`docs/features.md` 是对外文档。
- **随代码更新**：改变规范或页面行为的提交，在同一个提交里更新对应的文档。文档和代码不一致时修正文档，不保留过时的段落。
- 提交信息和代码注释用英文。

SDK 开发文档在 `packages/plugin-sdk/docs/`，中文位于根目录，英文位于 `en/`，`GUIDE.md` 提供入口。正文随 SDK 发布，`.vitepress/` 保存站点配置并排除在 npm 包外。改动公开 API 或宿主行为约定时，同步更新中英文正文；完整签名链接到类型定义，示例与 `packages/plugin-sdk/src` 的实际导出一致。

## 目录结构

- `packages/plugin-sdk`：`@ffcafe/mojito-plugin-sdk`，插件作者使用的 SDK，以 LGPL-3.0-only 发布到 npm。
- `packages/package`：`@ffcafe/mojito-package`，Node CLI 和浏览器共用的 WASM 工具包。
- `packages/*` 的其余目录：官方插件及其依赖（`matcha`、`combat-model`、`combat-statistics`、`overlay-plugins`、`raidboss`、`plugin-raidboss`、`raidboss-tools`、`plugin-skill-display`、`deepseek-tts`）。这些包都是 `private`，不发布到 npm；官方插件以签名的 `.mojito` 包发布，列表见 `scripts/pack-official.mjs`。
- `examples/*`：开发者示例和测试插件，同属 pnpm workspace。
- `crates/package`：包格式编解码器、CLI `mojito-package`、C ABI（`ffi` feature）和浏览器校验器（`crates/package/web`）。
- `crates/plugin-protocol` 和 `include/`：原生插件协议和 C 头文件。
- `scripts/`：官方包打包（`pack-official.mjs`）、悬浮窗模板构建（`overlay-templates/`）、浏览器校验器构建、冒烟测试和遥测验收脚本。
- `vendor/matcha-overlay`：git submodule，Matcha 的界面，也是 pnpm workspace 成员。`packages/raidboss/vendor/cactbot` 是改编的 cactbot 副本。`vendor/` 下的内容不经过 biome 检查。

## 构建与检查

环境：Node 24（`.nvmrc`）、pnpm 12.13.0（`packageManager`）、stable Rust。首次检出先运行 `git submodule update --init --recursive` 和 `pnpm install --frozen-lockfile`。

根目录 `package.json` 中的脚本：

- `pnpm build`：构建 Rust CLI（`build:package`）和所有 workspace 包，包括 WASM 打包工具；`pnpm build:official` 等同于它。
- `pnpm build:package:npm`：构建 npm 打包工具，需要 `wasm32-unknown-unknown` target 和 `wasm-bindgen-cli` 0.2.129。`pnpm test:package:npm` 验证 CLI、原生互操作和安装后的 tarball。
- `pnpm docs:dev`、`pnpm docs:build`、`pnpm docs:preview`：启动、构建和预览插件开发文档。
- `pnpm build:web`：构建浏览器校验器到 `dist/package-web`（需要 `wasm32-unknown-unknown` target 和 `wasm-bindgen-cli` 0.2.129）。
- `pnpm typecheck`、`pnpm lint`（`biome check`）、`pnpm lint:fix`（`biome check --write`）。
- `pnpm test`：vitest 加上 `scripts/overlay-templates/*.test.mjs`。
- `pnpm test:package`：Rust 编解码器、协议、CLI 和 FFI 的测试与冒烟测试。
- `pnpm test:official`：`scripts/pack-official.test.mjs`。
- `pnpm pack:official <private.jwk> <expected-fingerprint>`：为官方插件签名打包。

CI（`.github/workflows/checks.yml`）的 plugins job 依次运行 `pnpm install --frozen-lockfile`、`pnpm docs:build`、`pnpm build:official`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:official`，并构建 `examples/overlayplugin-fixture`。改动 Rust 代码、协议、头文件或 `examples/catalog` 时，codec job 还会在 Linux 和 Windows 上运行 `cargo fmt --all --check`、`cargo clippy --locked --package mojito-package --features ffi --all-targets -- -D warnings`、Cargo 测试和冒烟测试。web job 在 PR 中构建受影响的验证器；启用 `PAGES_DEPLOY_ENABLED` 后，main push 的 pages job 构建验证器和文档，合并为一个 Pages 产物并部署。提交前在本地跑过对应的检查。

格式：TypeScript/JavaScript/JSON 由 biome 格式化（2 空格缩进、行宽 120、单引号、不写分号）；Rust 由 `rustfmt.toml` 约束（2 空格缩进，style edition 2024）。

## SDK 与宿主的版本锁定

- 宿主以 `github:thewakingsands/mojito-plugins#<commit>&path:packages/plugin-sdk` 引用 SDK，pnpm 通过 `prepare` 脚本构建；原生 crate 通过 Cargo git tag `v0.1.0` 引用。包名和插件 ID 要保持不变。
- `sdk-v*` tag 会把 SDK 发布到 npm（`.github/workflows/sdk-publish.yml`）。不要给只供宿主锁定的提交推送这类 tag；发布时 tag 必须与 `packages/plugin-sdk/package.json` 的版本一致，并指向 `main` 上的提交。
- `package-v*` tag 发布 `@ffcafe/mojito-package`（`.github/workflows/package-publish.yml`），须匹配该包版本并指向 `main`。npm 产物携带预编译 WASM；发布前须具备确认适用的许可证和 npm 发布权限。
- 宿主从不含 submodule 的 GitHub tarball 安装 SDK，因此 Matcha 用 `link:` 引用 `vendor/matcha-overlay`，`pnpm-workspace.yaml` 设置 `frozenLockfile: false`。本仓库的检查仍要使用 `--frozen-lockfile`。
- 同时改两个仓库时，开发阶段用临时的本地链接或 Cargo override，最后提交锁定的 git 源；不要提交本地 override。
- SDK 包的 `files` 包含 `dist`、`GUIDE.md`、`docs` 和 `COPYING`；移动或重命名这些文档时同步修改 `files`。
