# 打包与签名

使用仓库中的 `mojito-package` 构建、签名和校验 `.mojito`。准备只包含运行文件的 `plugin/`，其中包含 `plugin.json` 及其声明的入口、页面和资源。

## 生成发布者密钥

把下面的代码保存为 `keygen.mjs`，放在 `plugin/` 之外。它生成 Ed25519 私钥 JWK，并打印公钥原始字节的 SHA-256 指纹：

```js
import { createHash, generateKeyPairSync } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const { privateKey } = generateKeyPairSync('ed25519')
const jwk = privateKey.export({ format: 'jwk' })
writeFileSync(process.argv[2], JSON.stringify(jwk), { mode: 0o600, flag: 'wx' })
console.log(createHash('sha256').update(Buffer.from(jwk.x, 'base64url')).digest('hex'))
```

长期保存私钥。以同一插件 ID 发布更新时使用同一密钥；通过独立可信渠道分发公钥指纹。

## 打包和校验

在仓库根目录执行以下命令，`EXPECTED_FINGERPRINT` 换成建钥时打印的指纹。Windows 使用 `target/release/mojito-package.exe`。

```sh
pnpm build:package
node keygen.mjs ./author.jwk
./target/release/mojito-package pack ./plugin ./author.jwk ./plugin.mojito lzma2
./target/release/mojito-package inspect ./plugin.mojito
./target/release/mojito-package verify ./plugin.mojito EXPECTED_FINGERPRINT
```

`author.jwk`、`keygen.mjs` 和输出包都在打包输入目录之外。CLI 拒绝覆盖已有输出；每次重新打包使用新的输出文件名。`copy` 可以替换 `lzma2` 以关闭压缩。

`inspect` 和 `verify` 都检查签名、完整归档摘要和每个成员。传入预期指纹后，还会确认包由该公钥签名。签名者身份的依据是你独立信任的指纹。

## 常见失败

| 原因 | 处理 |
| --- | --- |
| 输入缺少 manifest 或声明的入口 | 先完成浏览器 ESM / native 构建，核对 `entry.path` |
| 输出已存在，或密钥/输出放在输入内 | 选择输入之外的新文件路径 |
| 私钥的 `x` 与 `d` 不匹配 | 使用同一对 Ed25519 密钥的完整私钥 JWK |
| 路径冲突、符号链接或超出包格式限制 | 整理运行文件，查看 [Manifest](manifest.md) 和包格式说明 |
| 校验时指纹不同 | 核对预期的发布者密钥与实际签名者 |

包格式上限是完整包 256 MiB、解压后 256 MiB、单个成员 32 MiB、4096 个条目。打包之后再修改或重压缩会使签名失效，需要重新签名。

## 浏览器验证器

站点根目录的[验证器](https://thewakingsands.github.io/mojito-plugins/)在浏览器中读取文件，检查内嵌签名、签名元数据与内层归档的大小和 SHA-256。CLI 与安装过程还解码成员、检查 CRC 并比对归档中的 manifest；发布前运行 CLI 校验。

完整格式与 bindings 见[包格式说明](https://github.com/thewakingsands/mojito-plugins/blob/main/crates/package/README.zh-CN.md)。下一步：[发布与更新](publishing.md)。
