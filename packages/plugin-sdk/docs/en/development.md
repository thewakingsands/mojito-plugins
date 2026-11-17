# Development

## Run with the development server

The project in [Pages and overlays](features.md) needs a build after every change. With the Vite development server instead, Mojito reads the background and pages directly from the development server, without building:

```sh
npx vite
```

Register a source on the 插件 (plugins) page of 开发者工具 (developer tools):

| Field | Value |
| --- | --- |
| 开发配置名称 (configuration name) | For example `dev` |
| 开发服务器来源 (development server origin) | `http://127.0.0.1:5173` |
| plugin.json 的绝对路径 (absolute path of plugin.json) | The `plugin.json` in the project root, for example `D:\my-plugin\plugin.json` |
| 挂载路径 (mount path) | The same as the development `base` in `vite.config.ts`, for example `/my-plugin/` |
| Worker 入口 (worker entry) | The background source, for example `src/worker.ts` |

After changing code:

- **Pages**: leave the page and come back, and the page reloads the latest code; close an overlay and open it again.
- **Background**: in the development plugin's details, click 停止 (stop), then 启动 (start).

The registration form currently has no HMR option; reload pages as described above after changing them.

## Inspect the running plugin

- **Pages**: in the development plugin's details, select the page under 视图 (views), click 预览 (preview), then 打开 DevTools (open DevTools) to see the page's console, network requests and elements.
- **Background**: Mojito currently does not show `context.log` output. To debug the background, send information to Mojito's notifications with `context.notifications.send()`, or publish it with `context.views.set()` and display it on a page.

## Troubleshooting

When starting fails, the reason is shown at the top of the development plugin's details.

| Symptom | Cause and fix |
| --- | --- |
| A manifest error when registering or starting | Fields in `plugin.json` do not meet the requirements; check them against [Manifest](manifest.md) as the message says. Common cases: `apiVersion` does not include `2.0.0`, `id` contains disallowed characters, `networkOrigins` includes a path or a trailing `/` |
| Starting fails with `worker_failed` | The background could not finish starting. Possible causes:<br>· The file that `entry.path` (or Worker 入口 during development) points to does not exist, has a syntax error, or imports modules that were not bundled, or Node.js modules. The background runs in a browser environment and can only use browser APIs<br>· The file does not export `activate`<br>· `activate` threw an error, most commonly from using a permission the manifest does not declare (`permission_denied`) or wrong arguments (`invalid_argument`). Catch the error with try/catch and show it in a notification to see which step failed |
| Blank page | Check the console in the page's DevTools. Scripts from the development server are blocked when they lack `nonce="__MOJITO_DEV_NONCE__"`; pages cannot load resources that are outside the plugin package and not in `networkOrigins` |
| No Mojito styles on pages during development | The `<link>` for `/host/mojito-base.css` lacks `vite-ignore`, so Vite added the mount path to it |
| Network requests fail | The target site's origin must be listed in `networkOrigins`; the background's `context.http.request` also needs the `http.request` permission, not declined by the user |

## Testing

`createTestContext` from `@ffcafe/mojito-plugin-sdk/testing` creates a `context` that does not need Mojito, for unit-testing background logic. Tests provide the session data, permissions and the return values of each method; see [SDK entry points](api/exports.md).
