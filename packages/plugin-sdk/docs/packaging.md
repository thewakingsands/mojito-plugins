# 打包与签名

用户安装的是 `.mojito` 文件：插件构建结果的压缩包，加上你用私钥做的签名。Mojito 用签名确认插件的每次更新都来自同一个发布者。

## 准备打包工具

安装 [Node 24 或更新版本](https://nodejs.org/)，通过 `npx @ffcafe/mojito-package` 使用打包工具。npm 包内置 WASM，无需安装 Rust 或压缩工具。

## 第一次：生成并备份私钥

私钥只生成一次，以后每个版本都用它签名：

```sh
npx @ffcafe/mojito-package keygen
```

工具默认将私钥保存为用户目录中的 `.mojito-keys/author.jwk`，显示保存位置；文件已存在时会报错并保留原文件。把私钥备份到安全的地方，拿到私钥的人可以发布被 Mojito 当作你发布的更新。

也可以通过 `keygen /safe/location/MyPlugin.jwk` 指定另一位置。保存在 git 工作区内时须增加 `--allow-git` 确认，可同时增加 `--gitignore`，将私钥的相对路径追加到工作区的 `.gitignore`。通常直接使用默认用户目录即可。

私钥丢失或更换后，用新私钥签名的版本对用户来说是另一个发布者：用户更新时 Mojito 会提示发布者变化，继续安装会删除旧插件的全部数据和权限。

## 每次发布：打包

先构建插件，再对构建结果打包。构建结果的目录里要有 `plugin.json` 和它引用的全部文件，例如[页面与悬浮窗](features.md)里的 `dist`：

```sh
npx @ffcafe/mojito-package pack ./dist
npx @ffcafe/mojito-package verify ./dist.mojito
```

`pack` 默认使用之前生成的私钥，以 LZMA2 压缩，输出到输入目录旁的同名 `.mojito` 文件。重新打包会覆盖已有包文件。`pack` 和 `verify` 都会完整校验签名和包里的每个文件，并输出 manifest、完整文件的 `size` 和 `sha256`，供[发布目录](publishing.md)使用。

指定另一私钥、输出文件或压缩方式时使用参数：

```sh
npx @ffcafe/mojito-package pack ./dist --key /safe/location/MyPlugin.jwk --output ./MyPlugin-0.1.0.mojito --compression lzma2
```

`--compression copy` 表示不压缩。私钥和输出文件都要放在输入目录之外。输出中的 `signer.fingerprint` 标识签名用的私钥，同一个私钥签的包，这个值都相同。

打包之后再修改或重新压缩 `.mojito`，签名就失效了，需要重新打包。

## 常见失败

| 原因 | 处理 |
| --- | --- |
| 私钥文件已存在 | 继续使用该私钥打包，生成新密钥时另选保存位置 |
| 私钥路径属于 git 工作区 | 使用用户目录，或明确确认后增加 `--allow-git` |
| 插件目录里缺少 `plugin.json` 或入口文件 | 先构建，再核对 `entry.path` |
| 私钥或输出文件在插件目录里 | 移到插件目录之外 |
| 私钥文件不完整或公私钥不匹配 | 使用完整的 Ed25519 私钥 JWK 备份 |
| 包含符号链接、Windows 上会冲突的文件名，或超出大小限制 | 整理构建结果 |

包和解压后总量各不超过 256 MiB，单个文件不超过 32 MiB，最多 4096 个文件。

## 在浏览器里检查

[在线工具](https://thewakingsands.github.io/mojito-plugins/)使用同一 WASM 编解码器，校验签名和全部文件，文件不会上传。

包格式的细节见[包格式说明](https://github.com/thewakingsands/mojito-plugins/blob/main/crates/package/README.zh-CN.md)。下一步：[发布与更新](publishing.md)。
