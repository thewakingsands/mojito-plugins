# 发布与更新

发布插件需要两样东西放在网上：打包好的 `.mojito` 文件，以及描述它的 `catalog.json`。用户在 Mojito 里添加 `catalog.json` 的地址，就能看到并安装其中的插件。

## catalog.json

```json
{
  "schemaVersion": 1,
  "releases": [
    {
      "pluginId": "MyPlugin",
      "version": "0.1.0",
      "apiVersion": "^2.0.0",
      "downloadUrl": "https://example.com/plugins/MyPlugin-0.1.0.mojito",
      "size": 1234,
      "sha256": "…"
    }
  ]
}
```

- `pluginId`、`version`、`apiVersion` 与包里的 `plugin.json` 相同。
- `downloadUrl` 是 `.mojito` 文件的下载地址。
- `size` 和 `sha256` 是整个 `.mojito` 文件的字节数和 SHA-256，Mojito 下载后用它们核对文件。
- 原生插件的条目还要写 `"os": "win32"` 和 `"arch": "x64"`。`display` 和 `changelog` 可选。

完整示例见 [examples/catalog](https://github.com/thewakingsands/mojito-plugins/tree/main/examples/catalog)。

用下面的脚本得到 `size` 和 `sha256`，保存为 `package-info.mjs`：

```js
// node package-info.mjs <.mojito 文件>
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const bytes = readFileSync(process.argv[2])
const sha256 = createHash('sha256').update(bytes).digest('hex')
console.log(JSON.stringify({ size: bytes.length, sha256 }))
```

```sh
node package-info.mjs ./MyPlugin-0.1.0.mojito
```

## 托管

`catalog.json` 和 `.mojito` 都要用 HTTPS 地址直接下载到文件本身，例如 GitHub Pages 或 `raw.githubusercontent.com` 的地址。GitHub 网站上路径里带 `/blob/` 的地址是网页，不能用。

本地测试时可以用本机的 HTTP 地址，例如 `http://127.0.0.1:18080/catalog.json`。

## 安装

在 Mojito 的插件仓库设置中添加 `catalog.json` 的地址，然后在列表里选择插件安装。安装时用户会看到插件的来源和权限，并确认。

## 发布更新

1. 提高 `plugin.json` 的 `version`，插件 ID 不变。
2. 重新构建，用同一个私钥打包。
3. 上传新的 `.mojito`，在 `catalog.json` 里写入新版本的条目，`size` 和 `sha256` 换成新文件的值。

只更换下载地址、文件内容不变时，不需要重新打包，只改 `downloadUrl`。

## 私钥丢失或更换

更新必须用原来的私钥签名。用其他私钥签名的版本，Mojito 会提示用户发布者变化；用户继续安装时，旧插件的全部数据和权限会被删除。所以要备份好私钥，见[打包与签名](packaging.md)。
