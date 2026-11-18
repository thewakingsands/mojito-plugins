# Getting started

This page starts from an empty directory, writes a minimal plugin, runs it in Mojito and shows it working. You need Mojito installed on Windows. You do not need build tools, and the game does not need to be running.

## 1. Create the plugin

Create a directory, for example `D:\hello-mojito`, and add two files.

`plugin.json` declares the plugin:

```json
{
  "schemaVersion": 1,
  "id": "example.hello-mojito",
  "name": "Hello Mojito",
  "version": "0.1.0",
  "apiVersion": "^2.0.0",
  "entry": { "kind": "worker", "path": "entry.mjs" },
  "capabilities": ["session.read"],
  "networkOrigins": []
}
```

- `id` is the plugin's unique identifier and cannot change after publishing.
- `entry` points to the background file.
- `capabilities` lists the permissions the plugin uses. This plugin only reads session state, so it only needs `session.read`.

`entry.mjs` is the background:

```js
export async function activate(context) {
  const subscription = context.session.subscribe((batch) => {
    for (const session of batch.items) context.log.info('Session changed', { state: session.state })
  })
  await subscription.ready
  return () => subscription.dispose()
}
```

Mojito calls `activate(context)` when it starts the plugin. This code subscribes to session state and writes a log entry on every change; when the subscription is established, it first receives the current state once. The returned function is called when the plugin stops and cancels the subscription.

## 2. Open developer tools

Developer settings are hidden by default:

1. Open Mojito's 关于 (About) page and click the value after Build five times in a row until 已显示开发者设置 (developer settings shown) appears.
2. In 设置 › 开发者 (Settings › Developer), turn on 开发者模式 (developer mode).
3. 开发者工具 (developer tools) appears in the sidebar; open its 插件 (plugins) page.

## 3. Register and start

1. Click 登记来源 (register source), fill in 开发配置名称 (configuration name), for example `dev`, and plugin.json 的绝对路径 (absolute path of plugin.json), `D:\hello-mojito\plugin.json`. Leave the other fields empty and click 登记来源.
2. Mojito shows the 登记插件开发来源 (register plugin development source) confirmation dialog; confirm it.
3. Select Hello Mojito in the list and click 启动 (start).

When the status changes to 运行中 (running), click 查看日志 (view logs) in the details, or open 开发者工具 › 插件日志 (developer tools › plugin logs). You see an entry `Session changed {"state":"idle"}`. After you start the game, another one with `live` appears.

After changing `entry.mjs`, click 停止 (stop) and then 启动 to load the new code. If starting fails, the reason is shown at the top of the details; see [Troubleshooting](development.md#troubleshooting).

## Next steps

- [Core concepts](concepts.md): understand `context`, permissions, subscriptions and the view bridge.
- [Pages and overlays](features.md): add pages to the plugin with TypeScript and Vite.
- [Package and sign](packaging.md): deliver the plugin to users.
