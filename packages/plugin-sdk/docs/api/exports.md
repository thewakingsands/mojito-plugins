# SDK 入口

```sh
pnpm add @ffcafe/mojito-plugin-sdk
```

后台通过 `activate(context)` 接收上下文；导入包本身不会启动插件。当前导出定义见 [package.json](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/package.json)。

| 导入路径 | 插件作者的用途 |
| --- | --- |
| `@ffcafe/mojito-plugin-sdk` | PluginContext、Manifest、数据类型、PluginError、limits 和 capability 名称 |
| `@ffcafe/mojito-plugin-sdk/view` | 页面中的 `connectView` 和 ViewBridge |
| `@ffcafe/mojito-plugin-sdk/schema` | 校验 manifest、版本范围和包内路径 |
| `@ffcafe/mojito-plugin-sdk/errors` | PluginError 和错误构造/转换工具 |
| `@ffcafe/mojito-plugin-sdk/overlayplugin` | OverlayPlugin 兼容声明、状态类型与 `overlayProducer` |
| `@ffcafe/mojito-plugin-sdk/testing` | 单元测试中的 `createTestContext`，显式提供会话、limits 和方法处理器 |

`testing` 会记录请求，并允许测试发布批次、发起宿主请求和关闭连接；它只响应测试提供的行为。测试工具的完整签名见 [testing.ts](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/testing.ts)。

## 宿主入口

`client`、`connection`、`messages`、`protocol` 和 `transport` 供宿主建立连接、握手和传输消息使用。插件通过宿主传入的上下文以及页面 `connectView()` 使用 API。
