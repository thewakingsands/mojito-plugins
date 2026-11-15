# 静态插件仓库

[English](README.md) | 简体中文

本示例包含一个签名的空操作 Worker 插件，适用于 Plugin API 2.0。源码在 `plugin` 目录；
`first.mojito` 包含这份源码和内嵌的签名。`catalog.json` 记录完整 `.mojito` 文件的大小和 SHA-256。
示例不包含签名私钥。这些产物仅供测试使用。

把 `catalog.json` 和 `first.mojito` 上传到静态托管服务，并把仓库中的 `downloadUrl` 改为该包永久的
HTTPS 绝对地址。修改下载地址不需要重新签名；改动包的任何字节则需要。

使用 GitHub Pages 时，填写直接指向文件的地址，例如
`https://<owner>.github.io/<repository>/catalog.json`。使用 GitHub raw 托管时，填写
`https://raw.githubusercontent.com/<owner>/<repository>/<ref>/catalog.json`；
`github.com/.../blob/...` 页面不是仓库文件。不支持相对地址。
只有回环地址可以使用 HTTP，例如 `http://127.0.0.1:18080/catalog.json`。
HTTPS 重定向不能降级到 HTTP。ETag 和 Last-Modified 是可选的。

每个发布条目必须包含 `pluginId`、`version`、`apiVersion`、`downloadUrl`、`size` 和 `sha256`；
`display` 和 `changelog` 可选。原生插件要同时指定 `os: win32` 和 `arch: x64`；Worker 插件两者都不写。
签名内嵌在包中，仓库没有 `signatureUrl` 字段。

构建 CLI 并在本地校验示例：

```sh
pnpm build:package
./target/release/mojito-package verify examples/catalog/first.mojito
node scripts/package-cli-smoke.mjs
```

Windows 上使用 `target/release/mojito-package.exe`。校验会检查内嵌签名和每个归档成员。
自签名有效并不能证明发布者的身份；需要时向 `verify` 提供另行确认可信的指纹。

构建自己的包时，把私钥 JWK 放在插件目录之外，并使用 [包 CLI](../../crates/package/README.zh-CN.md)。
仓库中填写生成的 `.mojito` 文件的大小和 SHA-256，插件 ID、版本和 API 范围从签名的 manifest 中复制。
宿主的 [仓库校验工具](https://github.com/thewakingsands/mojito/tree/master/tools/catalog)
用客户端的解析器检查元数据，并执行 2 MiB 的仓库大小上限。
