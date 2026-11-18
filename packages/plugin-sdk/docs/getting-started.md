# 快速开始

这一页从一个空目录开始，写一个最小的插件，在 Mojito 里运行它，并看到它在工作。需要 Windows 上已安装的 Mojito，不需要构建工具，也不需要游戏在运行。

## 1. 创建插件

新建一个目录，例如 `D:\hello-mojito`，放入两个文件。

`plugin.json` 声明插件：

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

- `id` 是插件的唯一标识，发布以后不能再改。
- `entry` 指向后台文件。
- `capabilities` 列出插件要用的权限。这里只读取会话状态，所以只要 `session.read`。

`entry.mjs` 是后台：

```js
export async function activate(context) {
  const subscription = context.session.subscribe((batch) => {
    for (const session of batch.items) context.log.info('Session changed', { state: session.state })
  })
  await subscription.ready
  return () => subscription.dispose()
}
```

Mojito 启动插件时调用 `activate(context)`。这段代码订阅会话状态，每次变化都写一条日志；订阅建立时先收到一次当前状态。返回的函数在插件停止时调用，用来取消订阅。

## 2. 打开开发者工具

开发者设置默认隐藏：

1. 打开 Mojito 的“关于”页，连续点击 Build 后面的值五次，出现“已显示开发者设置”。
2. 在“设置 › 开发者”中打开“开发者模式”。
3. 侧栏出现“开发者工具”，进入其中的“插件”页。

## 3. 登记并启动

1. 点击“登记来源”，填写“开发配置名称”（例如 `dev`）和“plugin.json 的绝对路径”（`D:\hello-mojito\plugin.json`），其他字段留空，点击“登记来源”。
2. Mojito 弹出“登记插件开发来源”确认框，确认。
3. 在列表里选择 Hello Mojito，点击“启动”。

状态变为“运行中”后，点击详情里的“查看日志”，或进入“开发者工具 › 插件日志”，可以看到一条 `Session changed {"state":"idle"}`。启动游戏后会再出现一条 `live`。

修改 `entry.mjs` 以后，点击“停止”再“启动”即可加载新代码。启动失败时，详情顶部会显示原因，见[排查问题](development.md#排查问题)。

## 下一步

- [核心概念](concepts.md)：理解 `context`、权限、订阅和页面 bridge。
- [页面与悬浮窗](features.md)：用 TypeScript 和 Vite 给插件加上页面。
- [打包与签名](packaging.md)：把插件交给用户。
