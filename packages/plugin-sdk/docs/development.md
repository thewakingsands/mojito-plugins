# 开发与调试

使用[快速开始](getting-started.md)中的开发来源登记，在已安装的 Mojito 中运行插件。后台和页面分别重载：后台修改后停止并重新启动，页面可以使用 Vite HMR。

## 页面示例

在仓库根目录构建示例：

```sh
pnpm --filter @ffcafe/mojito-plugin-sdk build
pnpm exec vite build --config examples/plugin-views/vite.config.ts
```

登记 `examples/plugin-views/dist/plugin.json` 可以运行构建后的本地文件。构建配置把后台与页面编入同一个分发目录，并复制 manifest：

[vite.config.ts](https://github.com/thewakingsands/mojito-plugins/blob/main/examples/plugin-views/vite.config.ts)

## Vite HMR

启动开发服务器，在 PowerShell 中设置环境变量后运行相同的 Vite 命令：

```powershell
$env:MOJITO_DEV_HMR = '1'
pnpm exec vite --config examples/plugin-views/vite.config.ts
```

在登记来源的表单中填写源码 `examples/plugin-views/plugin.json` 的绝对路径、服务器 `http://127.0.0.1:5173`、挂载路径 `/dev/example-views/`、后台入口 `entry.ts`，并启用 HMR。

确认框显示推导出的 `ws://127.0.0.1:5173/dev/example-views/`。HTTPS 服务器使用 WSS；覆盖 origin 或 path 时，协议、主机、端口和包含 Vite base 的最终路径都必须一致。

接受模块的 `import.meta.hot` 更新可以保留页面状态；CSS 自动更新，其他修改可能整页重载。HMR 不替换后台 Worker；后台仍通过停止/启动重载。修改登记来源会停止旧实例。

## 排查问题

- 启动失败：核对 manifest、`apiVersion` 和构建入口路径，查看开发者日志。
- 页面状态：在开发插件详情的“视图”中选择“预览”，再选择“打开 DevTools”。
- 网络失败：核对 `networkOrigins`、HTTP capability 和开发登记中确认的地址。
- HMR 失败：检查最终 WebSocket 路径；保留 Vite token 校验、证书校验和宿主隔离设置。

`@ffcafe/mojito-plugin-sdk/testing` 提供显式测试上下文。已有示例参加仓库 `pnpm typecheck`；SDK 自身测试使用 `pnpm --filter @ffcafe/mojito-plugin-sdk test`。测试数据和服务响应由测试显式提供，见[SDK 入口](api/exports.md)。
