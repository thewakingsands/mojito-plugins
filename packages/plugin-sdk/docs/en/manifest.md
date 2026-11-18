# Manifest

Every package has a root `plugin.json`. Consult the [Manifest type](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/manifest.ts) and [validator](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/schema.ts). Unknown fields, duplicate capabilities and invalid paths are rejected.

| Field | Requirement |
| --- | --- |
| `schemaVersion` | Always `1` |
| `id` | Stable plugin ID in the form `<namespace>.<plugin-name>` or `<author>.<plugin-name>`, such as `ffcafe.matcha`: exactly one dot, both parts only lowercase letters, digits, hyphens and underscores, at most 64 characters, and the first part is not a Windows device name (such as `con` or `nul`) |
| `name`, `version` | Nonempty name and canonical SemVer; retain the ID across updates |
| `apiVersion` | SemVer range containing the host's Plugin API version, such as `^2.0.0` |
| `entry` | A Worker uses `{ "kind": "worker", "path": "entry.mjs" }`; see [Native plugins](native.md) for native entries |
| `capabilities` | [Permission names](permissions.md) the plugin uses; an empty array is valid |
| `networkOrigins` | Canonical `http:` / `https:` origins, such as `https://api.example.com`; no path, trailing slash or credentials |
| `author`, `description`, `homepage`, `license` | Optional nonempty strings |

Package paths use `/`, relative to the package root. They cannot contain `..`, backslashes, empty segments, Windows device names or trailing dots/spaces. Worker entry files end in `.js` or `.mjs`.

## Storage budgets

Optional `storage` defaults to 32 MiB total and 3 MiB per file. `totalBytes` and `fileBytes` are safe integers at least as large as the defaults; the file budget cannot exceed the total. Native plugins retain the default per-file ceiling.

```json
{ "storage": { "totalBytes": 536870912, "fileBytes": 33554432 } }
```

In API 2 these are declared budgets for the plugin to follow. The host reports them but does not reject writes based on them. Transport message limits still apply.

## Services and speech

`services.provides` declares local names and versions. `services.consumes` declares `pluginId/name`, `versionRange` and `optional`. Local names use lowercase letters, digits and separating dots, hyphens or underscores. See [Services](api/context.md#services).

```json
{
  "services": {
    "provides": [{ "name": "summary", "version": "1.0.0" }],
    "consumes": [{ "name": "ffcafe.combat-statistics/overlay", "versionRange": "^1.0.0", "optional": true }]
  },
  "tts": { "channels": [{ "id": "alarm", "name": "Alarm" }] }
}
```

`tts.channels` IDs follow the local service-name format and must be unique. Every plugin with `tts.say` has a `default` channel; declaring it explicitly changes its display name.
