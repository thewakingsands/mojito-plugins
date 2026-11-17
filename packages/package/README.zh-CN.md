# Mojito 打包工具

[English](README.md) | 简体中文

使用 Node 24 或更新版本打包、签名和校验 Mojito 插件。npm 包内置与浏览器工具相同的 WASM 编解码器。

```sh
npx @ffcafe/mojito-package keygen
npx @ffcafe/mojito-package pack ./dist
npx @ffcafe/mojito-package verify ./dist.mojito
```

私钥只生成一次并妥善备份，默认保存在用户目录的 `.mojito-keys/author.jwk`，已有私钥不会覆盖。私钥丢失或更换会导致插件发布者变化，用户继续安装此类更新时会删除旧插件的数据和权限。

`pack` 使用默认私钥和 LZMA2 压缩，在输入目录旁输出同名文件，并覆盖已有输出。通过 `--key`、`--output` 和 `--compression copy|lzma2` 指定其他设置。私钥和输出须位于输入目录之外。`pack` 和 `verify` 输出的 JSON 包含完整文件的 `size`、`sha256`，可用于 catalog 发布条目。

`keygen [PRIVATE_JWK]` 可指定其他保存位置。在 git 工作区内保存须增加 `--allow-git`；同时增加 `--gitignore` 可将相对路径追加到 `.gitignore`。

## JavaScript API

```js
import { generatePrivateKey, validatePrivateKey, packFiles, verifyPackage } from '@ffcafe/mojito-package'

const privateJwk = generatePrivateKey()
const signer = validatePrivateKey(privateJwk)
const bytes = packFiles(files, privateJwk, 'lzma2')
const result = verifyPackage(bytes)
```

`files` 是 `{ path, bytes: Uint8Array }` 数组。私钥接口统一使用 JWK JSON 文本，`validatePrivateKey` 仅返回 `{ publicKey, fingerprint }`。校验覆盖签名、归档、manifest 及每个成员的大小和 CRC，无效输入会抛出错误。

浏览器和 module worker 从 `@ffcafe/mojito-package/web` 导入同名操作及 `init`，使用前先 `await init()`。模块通过相对 URL 加载自带的 WASM。私钥生成使用运行环境的安全随机源，文件在本地处理。

详见[插件开发文档](https://thewakingsands.github.io/mojito-plugins/docs/packaging)。
