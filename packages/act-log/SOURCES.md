# ACT 日志插件源码

本插件使用 GPL-3.0-only 许可证。构建源码在 [mojito-plugins](https://github.com/thewakingsands/mojito-plugins) 的 `packages/act-log` 与 `packages/plugin-sdk`，依赖和工具版本由仓库根目录的 `pnpm-lock.yaml` 与 `package.json` 固定。使用该版本的 pnpm 安装依赖后，依次运行 `pnpm --filter @ffcafe/mojito-plugin-sdk build` 和 `pnpm --filter @ffcafe/mojito-act-log build`。

日志解析使用 Elpis 的 network、struct 和 sestring 0.2.0。三者的 ESM 构建产物均已与 npm 包逐字节核对。[Elpis 对应源码](https://github.com/thewakingsands/elpis/tree/8c028b36d2221f39610bb36d73f6fabd0a8affdc)

归档内的 LICENSE、FFXIVClientStructs.LICENSE 和 THIRD-PARTY-LICENSES.md 随插件一并提供。
