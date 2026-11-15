# 发布与更新

把签名的 `.mojito` 上传到稳定的 HTTPS 地址，再发布指向它的静态 `catalog.json`。使用 [catalog 示例](https://github.com/thewakingsands/mojito-plugins/tree/main/examples/catalog)作为底稿。

## Catalog 条目

```json
{
  "schemaVersion": 1,
  "releases": [{
    "pluginId": "SessionNotes",
    "version": "1.0.0",
    "apiVersion": "^2.0.0",
    "downloadUrl": "https://example.com/plugins/SessionNotes-1.0.0.mojito",
    "size": 1234,
    "sha256": "REPLACE_WITH_COMPLETE_PACKAGE_SHA256"
  }]
}
```

这里的 `size` 和 `sha256` 是占位值，发布前必须换成完整 `.mojito` 文件的实际结果。`pluginId`、`version` 和 `apiVersion` 来自包内已签名的 manifest。

```sh
node --input-type=module -e "import{readFileSync}from'node:fs';import{createHash}from'node:crypto';const b=readFileSync(process.argv[1]);console.log(JSON.stringify({size:b.length,sha256:createHash('sha256').update(b).digest('hex')}))" ./plugin.mojito
```

Worker 条目省略 `os`、`arch`；native 条目同时提供 `os: "win32"` 和 `arch: "x64"`。`display` 和 `changelog` 可选。签名包含在包内。

## 托管和安装

Catalog 与 `downloadUrl` 都使用指向实际文件的绝对 HTTPS URL，例如 GitHub Pages 地址或 `raw.githubusercontent.com` 地址。GitHub 的 `blob` 页面是网页，不能作为 JSON 或包的下载地址。

本地开发允许 loopback HTTP，例如 `http://127.0.0.1:18080/catalog.json`；HTTPS 重定向不能降级成 HTTP。Catalog 的 ETag 和 Last-Modified 可选。

在 Mojito 的插件仓库设置中添加 catalog 地址，再从目录中选择安装。先用 CLI 校验实际下载的包；安装时用户确认来源、运行方式和权限。

## 更新

增加 manifest 的 SemVer 版本，保持插件 ID 和签名密钥，重新构建并签名，再为新文件写入新的大小和 SHA-256。签名者变化会阻止直接更新。

只改变 `downloadUrl` 不改变包内容，无需重新签名。改变任何包字节都要重新签名。发布插件包与发布 SDK npm 版本是各自独立的流程。
