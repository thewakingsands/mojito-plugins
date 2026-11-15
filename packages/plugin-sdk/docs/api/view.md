# 页面 bridge

后台持有 PluginContext，页面从 `@ffcafe/mojito-plugin-sdk/view` 调用 `connectView()`，得到绑定到当前文档的 [ViewBridge](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/view.ts)。页面通过 channel 与本插件后台通信。

| 方法 | 用途 |
| --- | --- |
| `snapshot(channel)` | 读取最新状态 |
| `subscribe(channel, listener)` | 订阅最新状态，等待返回值的 `ready` |
| `command(channel, value)` | 调用后台注册的命令，取得结果 |
| `on(name, listener)` | 接收宿主页面事件，返回取消监听函数 |

`identity` 包含当前页面、定义和悬浮窗实例的身份；功能页的 `placement` 是 `sidebar`、`home` 或 `settings`，悬浮窗为 `null`。

## 发布状态和接收命令

后台用 `views.set` 发布最新值。SDK 最多每 200ms 发送一次，每个 channel 只保留最新值；传入对象之后不再修改它。需要命令返回前让页面看到状态时，调用 `await views.flush()`。

下面是计数器后台，注册了页面、设置页与悬浮窗：

[entry.ts](https://github.com/thewakingsands/mojito-plugins/blob/main/examples/plugin-views/entry.ts)

页面订阅同一个 channel，并通过命令发起操作：

[page.ts](https://github.com/thewakingsands/mojito-plugins/blob/main/examples/plugin-views/page.ts)

## 生命周期

离开功能页会释放文档，返回时创建新文档；后台保存需要保留的状态。关闭页面时释放订阅和 Blob URL。

`navigate-to-preference-item` 只发给设置页，数据为 `{ id, keyword }`。事件在监听器注册前到达时，SDK 保留每种事件的最新一项给第一个监听器，见[设置搜索](../features.md#设置搜索)。

后台拒绝状态值时，SDK 写入警告，并在下一次 `set` 或 `flush` 抛出错误；宿主保留之前接受的值。页面命令失败由页面处理；宿主负责页面加载失败和后台停用的外框状态。
