# 发布与更新

发布插件需要两样东西放在网上：打包好的 `.mojito` 文件，以及描述它的 `catalog.json`。用户在 Mojito 里添加 `catalog.json` 的地址，就能看到并安装其中的插件。

## catalog.json

为已签名的插件包填写发布条目时，先读取校验结果。`pack` 命令也会输出相同的字段。

```sh
npx @ffcafe/mojito-package verify ./MyPlugin-0.1.0.mojito
```

| 发布条目字段 | 填写内容 |
| --- | --- |
| `manifest` | 复制完整的 `metadata.manifest` 对象。 |
| `pluginId`、`version`、`apiVersion` | 分别取该 manifest 的 `id`、`version` 和 `apiVersion`。 |
| `signer` | 复制 `signer.fingerprint` 中的指纹字符串。 |
| `size`、`sha256` | 复制校验结果顶层的值，表示整个文件的大小和摘要。[插件包工作台](https://thewakingsands.github.io/mojito-plugins/)的“复制发布信息 JSON”也可以复制这两个字段。 |
| `downloadUrl` | 填写已发布的 `.mojito` 文件的 HTTPS 下载直链。 |

原生插件还要从 `manifest.entry` 复制 `os` 和 `arch`。需要说明更新内容时，可在发布条目中增加 `changelog`。

以下目录可用于安装[已签名的示例插件](https://github.com/thewakingsands/mojito-plugins/tree/79d7fa99ce718609bb0423ad7be43d38175c9410/examples/catalog)。

```json
{
  "schemaVersion": 1,
  "releases": [
    {
      "pluginId": "example.static-catalog",
      "version": "1.0.0",
      "apiVersion": "^2.0.0",
      "downloadUrl": "https://raw.githubusercontent.com/thewakingsands/mojito-plugins/79d7fa99ce718609bb0423ad7be43d38175c9410/examples/catalog/first.mojito",
      "size": 1071,
      "sha256": "46a937c4c4e517ba7a29cd6064d70b437e5d3f0b8cb862e9c05aa749620fa331",
      "manifest": {
        "apiVersion": "^2.0.0",
        "capabilities": [],
        "entry": {
          "kind": "worker",
          "path": "entry.mjs"
        },
        "id": "example.static-catalog",
        "name": "Static catalog example",
        "networkOrigins": [],
        "schemaVersion": 1,
        "version": "1.0.0"
      },
      "signer": "83b2b626af08d925f9dc103e1b3515797b2bb097b073291e5516afb751cf9af4"
    }
  ]
}
```

## 托管

`catalog.json` 和 `.mojito` 都要用 HTTPS 地址直接下载到文件本身，例如 GitHub Pages 或 `raw.githubusercontent.com` 的地址。GitHub 网站上路径里带 `/blob/` 的地址是网页，不能用。

本地测试时可以用本机的 HTTP 地址，例如 `http://127.0.0.1:18080/catalog.json`。

## 安装

在 Mojito 的插件仓库设置中添加 `catalog.json` 的地址，然后在列表里选择插件安装。安装时用户会看到插件的来源和权限，并确认。

## 发布更新

1. 提高 `plugin.json` 的 `version`，插件 ID 不变。
2. 重新构建，用同一个私钥打包。
3. 上传新的 `.mojito`，用新包的校验结果和下载地址替换 `catalog.json` 中该插件的发布条目。

只更换下载地址、文件内容不变时，不需要重新打包，只改 `downloadUrl`。

## 私钥丢失或更换

更新必须用原来的私钥签名。用其他私钥签名的版本，Mojito 会提示用户发布者变化；用户继续安装时，旧插件的全部数据和权限会被删除。所以要备份好私钥，见[打包与签名](packaging.md)。
