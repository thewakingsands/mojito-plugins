# 开发与调试

## 用开发服务器运行

[页面与悬浮窗](features.md)里的项目每次修改都要构建一次。改用 Vite 开发服务器，Mojito 直接从开发服务器读取后台和页面，省去构建：

```sh
npx vite
```

在开发者工具的“插件”页登记来源：

| 字段 | 填写 |
| --- | --- |
| 开发配置名称 | 例如 `dev` |
| 开发服务器来源 | `http://127.0.0.1:5173` |
| plugin.json 的绝对路径 | 项目根目录的 `plugin.json`，例如 `D:\my-plugin\plugin.json` |
| 挂载路径 | 与 `vite.config.ts` 中开发时的 `base` 相同，例如 `/my-plugin/` |
| Worker 入口 | 后台源码，例如 `src/worker.ts` |
| 页面热更新（HMR） | 默认关闭；启用时必须填写开发服务器来源，并在 Vite 中启用 HMR |

修改代码以后：

- **页面**：开启 HMR 时由 Vite 热更新或重新加载；未开启时，离开页面再回来，悬浮窗关闭后重新打开。
- **后台**：在开发插件详情中点击“停止”，再点击“启动”。

## Vite HMR

先按[页面与悬浮窗](features.md)中的配置将 `hmr` 设为 `true`，再在登记表单勾选“页面热更新（HMR）”。HMR 只更新页面，后台代码修改后仍需停止并重新启动插件。

点击“登记来源”后，宿主确认框会显示代码来源、本地 manifest 路径和浏览器直连的 WebSocket 地址。地址由开发服务器来源将 `http://` 转为 `ws://`、`https://` 转为 `wss://`，再加上挂载路径得出；表单无需另填 HMR 来源或路径。例如 `http://127.0.0.1:5173` 加 `/my-plugin/` 对应 `ws://127.0.0.1:5173/my-plugin/`，应与 Vite 的 `ws` 设置和开发时的 `base` 一致。

核对地址后确认登记，来源才会保存；取消不会保存。使用开发服务器但未勾选 HMR 时，确认框显示“页面热更新：关闭”。

## 查看运行情况

- **页面**：在开发插件详情的“视图”中选择页面，点击“预览”，再点击“打开 DevTools”，可以看到页面的 console、网络请求和元素。
- **后台**：在“开发者工具 › 插件日志”中查看 `context.log` 和后台 `console.*` 的输出，以及 `activate` 抛出的错误，可以按插件和级别筛选、复制。开发插件详情里的“查看日志”直接打开这个插件的日志。页面里的 `console.*` 不在这里，仍在页面的 DevTools 里查看。

## 排查问题

启动失败时，开发插件详情的顶部会显示原因。

| 现象 | 原因和处理 |
| --- | --- |
| 登记或启动时提示 manifest 错误 | `plugin.json` 的字段不符合要求，按提示核对 [Manifest](manifest.md)。常见的是 `apiVersion` 不包含 `2.0.0`、`id` 含不允许的字符、`networkOrigins` 带了路径或结尾的 `/` |
| 启动失败，原因为 `worker_failed` | 后台没能完成启动，可能是：<br>· `entry.path`（或开发时的“Worker 入口”）指向的文件不存在、有语法错误，或者导入了没有打包进去的模块、Node.js 模块。后台运行在浏览器环境，只能用浏览器 API<br>· 文件没有导出 `activate`<br>· `activate` 抛出了错误，最常见的是调用了 manifest 没有声明的权限（`permission_denied`）或参数不对（`invalid_argument`）。错误和堆栈会显示在“插件日志”里 |
| 页面空白 | 在页面的 DevTools 里看 console。开发服务器上的脚本缺少 `nonce="__MOJITO_DEV_NONCE__"` 时会被拦截；页面不能加载插件包以外、也不在 `networkOrigins` 里的资源 |
| 开发时页面没有 Mojito 样式 | `/host/mojito-base.css` 的 `<link>` 缺少 `vite-ignore`，Vite 给它加上了挂载路径 |
| 网络请求失败 | 目标网站的 origin 要写进 `networkOrigins`；后台的 `context.http.request` 还需要 `http.request` 权限，且用户没有拒绝 |

## 测试

`@ffcafe/mojito-plugin-sdk/testing` 的 `createTestContext` 创建一个不需要 Mojito 的 `context`，用于单元测试后台逻辑。会话数据、权限和各个方法的返回值都由测试提供，见[SDK 入口](api/exports.md)。
