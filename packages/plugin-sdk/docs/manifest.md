# Manifest

包根目录必须有 `plugin.json`。使用 [Manifest 类型](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/manifest.ts)和 [manifest 校验器](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/schema.ts)确认字段；未知字段、重复 capability 和无效路径会被拒绝。

| 字段 | 要求 |
| --- | --- |
| `schemaVersion` | 固定为 `1` |
| `id` | 稳定的插件 ID；字母或数字开头，后续可用点、下划线、短横线；避开 Windows 保留名和末尾的点 |
| `name`, `version` | 非空名称和规范的 SemVer；更新时保留 `id` |
| `apiVersion` | 包含宿主 Plugin API 版本的 SemVer 范围，例如 `^2.0.0` |
| `entry` | Worker 使用 `{ "kind": "worker", "path": "entry.mjs" }`；native 见[原生插件](native.md) |
| `capabilities` | 插件使用的[权限名称](permissions.md)，可为空数组 |
| `networkOrigins` | 规范的 `http:` / `https:` origin，例如 `https://api.example.com`；不带路径、尾斜杠或凭据 |
| `author`, `description`, `homepage`, `license` | 可选的非空字符串 |

包内路径用 `/`，相对包根目录，不含 `..`、反斜杠、空段、Windows 保留名或末尾的点和空格。Worker 入口以 `.js` 或 `.mjs` 结尾。

## 存储预算

`storage` 可选，默认总量 32 MiB、单文件 3 MiB。`totalBytes` 和 `fileBytes` 是不低于默认值的安全整数，单文件预算不能超过总预算；native 的单文件预算保持默认上限。

```json
{ "storage": { "totalBytes": 536870912, "fileBytes": 33554432 } }
```

API 2 中这是插件申报和自行遵守的预算，宿主报告它们，但不按该预算拒绝写入。实际传输仍受消息大小限制。

## 服务与语音

`services.provides` 声明本地服务名和版本；`services.consumes` 声明 `pluginId/name`、`versionRange` 和 `optional`。服务本地名称使用小写字母、数字及分隔用的点、短横线、下划线，完整用法见[服务](api/context.md#服务)。

```json
{
  "services": {
    "provides": [{ "name": "summary", "version": "1.0.0" }],
    "consumes": [{ "name": "CombatStatistics/overlay", "versionRange": "^1.0.0", "optional": true }]
  },
  "tts": { "channels": [{ "id": "alarm", "name": "Alarm" }] }
}
```

`tts.channels` 使用服务本地名称的 ID 格式，ID 不能重复。每个有 `tts.say` 的插件都拥有 `default` channel；显式列出它只会改变显示名称。
