# 快速开始

使用 Node 24、pnpm 12.13.0。运行插件需要已安装的 Mojito；只构建 Worker 示例不需要游戏、Rust 或签名密钥。

## 准备示例

```sh
git clone https://github.com/thewakingsands/mojito-plugins.git
cd mojito-plugins
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm --filter @ffcafe/mojito-plugin-sdk build
```

`examples/plugin-worker` 是可以直接登记的最小插件。它的 manifest：

```json
{
  "schemaVersion": 1,
  "id": "SessionNotes",
  "name": "Session notes example",
  "version": "1.0.0",
  "apiVersion": "^2.0.0",
  "entry": {
    "kind": "worker",
    "path": "entry.mjs"
  },
  "capabilities": ["session.read"],
  "networkOrigins": []
}
```

后台入口从 `activate(context)` 接收宿主提供的上下文，订阅会话并把最近的状态写入配置；返回的函数在正常停止时解除订阅：

```js
/** A browser-only Worker: the host supplies context and owns its lifetime.
 * @param {import("@ffcafe/mojito-plugin-sdk").PluginContext} context
 */
export async function activate(context) {
  const subscription = context.session.subscribe(async (batch) => {
    for (const session of batch.items) {
      context.log.info('Session changed', { state: session.state, generation: session.characterGeneration })
      await context.config.set('lastSessionState', session.state)
    }
  })
  await subscription.ready
  return () => subscription.dispose()
}
```

Worker 使用浏览器 API。依赖 SDK 的 TypeScript 项目先把入口构建为浏览器 ESM，manifest 的 `entry.path` 指向构建后的 `.mjs` 或 `.js`。页面示例的完整构建配置见[开发与调试](development.md)。

## 在 Mojito 中运行

1. 在设置中启用开发者模式，打开开发插件页面。
2. 选择“登记来源”，填写 profile 名称和 `examples/plugin-worker/plugin.json` 的绝对路径；本例使用本地文件，开发服务器相关字段留空。
3. 确认来源，选择登记的插件，再点击“启动”。普通 capability 随启动授予，敏感 capability 可以分别选择。
4. 在开发者日志中查看 `Session changed`。未连接游戏时，插件仍能接收 idle 会话状态。

修改后台文件后先停止，再启动开发实例。生产安装使用[签名的 `.mojito` 包](packaging.md)。
