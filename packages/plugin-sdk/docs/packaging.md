# 打包与签名

用户安装的是 `.mojito` 文件：插件构建结果的压缩包，加上你用私钥做的签名。Mojito 用签名确认插件的每次更新都来自同一个发布者。

## 准备打包工具

打包工具 `mojito-package` 目前需要从源码构建，需要 [Rust](https://rustup.rs/)（stable）：

```sh
git clone https://github.com/thewakingsands/mojito-plugins.git
cd mojito-plugins
cargo build --locked --release --package mojito-package
```

构建结果是 `target/release/mojito-package`（Windows 上是 `mojito-package.exe`）。下面的命令用 `mojito-package` 指代它。

## 第一次：生成并备份私钥

私钥只生成一次，以后每个版本都用它签名。把下面的脚本保存为 `keygen.mjs`：

```js
// node keygen.mjs <私钥文件路径>
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const file = process.argv[2]
const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
mkdirSync(dirname(file), { recursive: true })
// 'wx'：文件已存在时报错，不会覆盖已有的私钥
writeFileSync(file, JSON.stringify(jwk), { mode: 0o600, flag: 'wx' })
```

把私钥保存在用户目录里，不要放进插件项目或 git 仓库：

```sh
node keygen.mjs ~/.mojito-keys/MyPlugin.jwk
```

然后把这个文件备份到安全的地方。拿到私钥的人可以发布被 Mojito 当作你发布的更新。

私钥丢失或更换后，用新私钥签名的版本对用户来说是另一个发布者：用户更新时 Mojito 会提示发布者变化，继续安装会删除旧插件的全部数据和权限。

## 每次发布：打包

先构建插件，再对构建结果打包。构建结果的目录里要有 `plugin.json` 和它引用的全部文件，例如[页面与悬浮窗](features.md)里的 `dist`：

```sh
mojito-package pack ./dist ~/.mojito-keys/MyPlugin.jwk ./MyPlugin-0.1.0.mojito lzma2
mojito-package inspect ./MyPlugin-0.1.0.mojito
```

- `pack` 的参数依次是：插件目录、私钥、输出文件、压缩方式。`lzma2` 压缩，`copy` 不压缩。
- 私钥和输出文件要放在插件目录之外。已存在的输出文件不会被覆盖，所以文件名里带上版本号。
- `inspect` 检查签名和包里的每个文件，并输出 manifest 信息。输出里的 `signer.fingerprint` 标识签名用的私钥，同一个私钥签的包，这个值都相同。

打包之后再修改或重新压缩 `.mojito`，签名就失效了，需要重新打包。

## 常见失败

| 原因 | 处理 |
| --- | --- |
| 插件目录里缺少 `plugin.json` 或它引用的文件 | 先构建，再核对 `entry.path` 和页面文件 |
| 输出文件已存在 | 换一个文件名，例如带上新版本号 |
| 私钥或输出文件在插件目录里 | 移到插件目录之外 |
| 私钥文件不完整 | 使用 `keygen.mjs` 生成的完整文件 |
| 包含符号链接、Windows 上会冲突的文件名，或超出大小限制 | 整理构建结果；限制见下 |

包的大小限制：整个包和解压后都不超过 256 MiB，单个文件不超过 32 MiB，最多 4096 个文件。

## 在浏览器里检查

[验证器](https://thewakingsands.github.io/mojito-plugins/)可以在浏览器里检查 `.mojito` 的签名和完整性，文件不会上传。它不逐个解压文件，发布前仍以 `inspect` 的结果为准。

包格式的细节见[包格式说明](https://github.com/thewakingsands/mojito-plugins/blob/main/crates/package/README.zh-CN.md)。下一步：[发布与更新](publishing.md)。
