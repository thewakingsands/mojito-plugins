# 权限

在 manifest 的 `capabilities` 中声明使用的名称。普通 capability 随安装授予，敏感 capability 可以被用户逐个拒绝或在运行期间撤回。

`context.capabilities.get()` 返回已声明 capability 的 `available`、`denied` 或带原因的 `unavailable` 状态。宿主通过 `capabilitiesChanged` 更新 SDK 中的快照；需要时重新读取状态，不要长期缓存初次授权结果。

## 普通 capability

| 名称 | 用途 |
| --- | --- |
| `session.read` | 会话状态和变化 |
| `game.read` | 玩家、实体、小队和区域的结构化状态 |
| `events.read` | 解析后的游戏事件 |
| `data.read` | 游戏表格、资源、图标和地图 |
| `ui.register` | 注册功能页、设置页、首页面板与悬浮窗 |
| `ui.overlayplugin` | 注册 OverlayPlugin 兼容页面 |
| `ui.overlayplugin.remote` | 使用宿主管理的远程 OverlayPlugin profile |
| `audio.play` | 播放包内音频 |
| `tts.say` | 在插件的语音 channel 中朗读 |
| `tts.provide` | 向宿主提供声音 |
| `services.provide` | 提供跨插件服务 |
| `services.consume` | 使用 manifest 中声明的服务 |

普通 capability 未声明时，相应操作以 `permission_denied` 拒绝。普通 capability 已授予也可能因没有游戏会话或资源不可用而无法提供数据，见[数据状态](api/data-model.md)。

## 敏感 capability

| 名称 | 授予后的用途 | 未声明或被拒绝时 |
| --- | --- | --- |
| `identity.read` | 读取玩家真实身份 | 玩家使用每个会话内的替身 actor ID 和种族/职业简称，没有 content ID 或 `gameLog`；使用替身 ID 的过滤条件仍有效 |
| `packets.read` | 订阅原始 IPC 数据包 | 订阅建立，但没有数据 |
| `memory.read` | 解析签名、读取或观察内存 | 相应调用以 `unavailable` 拒绝并附带原因 |
| `http.request` | 后台通过宿主发起 HTTP 请求 | 调用以 `unavailable` 拒绝并附带原因 |
| `microphone.record` | 页面用 `getUserMedia({ audio: true })` 录音 | 浏览器以 `NotAllowedError` 拒绝 |

身份会影响玩家的 ID、名字和部分事件参数；不要把替身 ID 保存为跨会话身份。`context.capabilities.get()` 中 `denied` 表示用户选择，`unavailable` 表示宿主当前无法提供。

## 网络与页面

`networkOrigins` 声明请求及页面资源可以使用的 origin。后台的 `context.http.request` 还需要敏感 capability `http.request`，并且每一跳重定向都要匹配 origin。请求使用系统代理；`timeoutMs` 只在显式提供时生效。

页面的网络资源受自身的 origin 声明约束。开发服务器的 HMR 使用单独登记并确认的连接地址，见[开发与调试](development.md)。

`host.openExternal(url)` 每次询问用户，不需要 capability。配置、插件存储、日志、通知、clock 和 Worker/页面之间的 bridge 不需要额外 capability。页面读文件使用浏览器文件选择框，保存文件使用下载。

## 服务授权与升级

服务提供者使用自己的 capability 应答，安装界面会告知使用方会接触哪些服务。普通的 `services.consume` 声明配合 `services.consumes`，不另设逐次服务授权。

API 2 把权限合并成一个数组，语音改为 `tts.say`，服务名使用 `pluginId/name`。从 1.x 升级时按当前 manifest 重新构建；完整名称来自 SDK 的 [capability 列表](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/types.ts)。
