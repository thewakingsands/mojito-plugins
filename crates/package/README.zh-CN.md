# Mojito 插件包

[English](README.md) | 简体中文

一个 Rust 编解码器，附带独立 CLI、Node-API addon，以及 Node 和浏览器共用的 WASM 工具。
运行时不依赖系统安装的压缩工具。包使用非固实（non-solid）7z，压缩方式为 Copy 或 LZMA2；
原生条目会自动解包到磁盘（unplugged）。

## 构建和使用

插件作者使用 Node 24 即可运行 [npm 工具](../../packages/package/README.zh-CN.md)：

```sh
npx @ffcafe/mojito-package keygen
npx @ffcafe/mojito-package pack ./dist
npx @ffcafe/mojito-package verify ./dist.mojito
```

工具内置预编译 WASM，并输出完整文件的 catalog `size` 和 `sha256`。下文的原生 CLI 由宿主和服务端开发者从源码构建。

使用仓库指定的 Node/pnpm 版本和 stable Rust：

```sh
pnpm build:package
cargo test --locked --package mojito-package
node scripts/package-cli-smoke.mjs
```

可执行文件是 `target/release/mojito-package`（Windows 上为 `.exe`）。编解码器在根目录的 Cargo workspace 中构建，宿主的 Node addon 也复用它。CLI 和 bindings 可在 Windows、Linux 和 macOS 上构建；
CI 测试 Linux 和 Windows。Windows 安装程序使用同一个 addon。

服务端使用的原生 C ABI 只需构建这个库：

```sh
cargo build --locked --release --package mojito-package --lib --features ffi
cargo test --locked --package mojito-package --features ffi
```

把 `target/release/mojito_package.dll`（Windows）或 `target/release/libmojito_package.so`（Linux）
放在服务端可执行文件旁边分发，并随产物记录源码的 Git 提交。头文件是 `include/mojito_package.h`；
C 导出只有 `mojito_package_verify` 和 `mojito_package_free`。校验会读取每个成员。输入只在同步调用
期间借用；输出是带长度的 UTF-8 JSON 缓冲区，即使失败也必须由对应的库恰好释放一次。调用方可以把
包大小上限调低到 256 MiB 以下。`ffi` feature 要求 panic 使用 unwind，并在 ABI 边界捕获 Rust panic；
进程 abort 和内存分配失败无法恢复。在所有调用和缓冲区释放完成之前，保持库处于加载状态。

```sh
mojito-package pack ./plugin ./private.jwk ./plugin.mojito lzma2
mojito-package inspect ./plugin.mojito
mojito-package verify ./plugin.mojito EXPECTED_SHA256_FINGERPRINT
mojito-package read ./plugin.mojito backend/index.mjs
```

输入目录必须包含 `plugin.json` 及其声明的入口。Ed25519 私钥 JWK 和输出文件要放在输入目录之外。
已存在的输出文件不会被覆盖。`copy` 表示不压缩。支持带空格和 Unicode 名称的目录；符号链接、
特殊文件以及在 Windows 上会冲突的路径会被拒绝。打包时不会执行任何包脚本或插件代码。
CLI 校验会检查所有成员的 CRC。

Ed25519 私钥 JWK 使用 `kty: "OKP"`、`crv: "Ed25519"`、base64url 编码的公钥 `x`，以及 32 字节的
私钥种子 `d`。现有的 Mojito 签名密钥可以直接使用。Node 可以用
`generateKeyPairSync('ed25519').privateKey.export({format:'jwk'})` 生成。私钥须保密，公钥指纹另行分发。

宿主的 `@ffcafe/mojito-rust` Node 入口导出同步的 `packFiles(files, privateJwk, compression?)`，
接受 `{path, bytes}` 条目和私钥 JWK 的 JSON 字符串。`openPackage(buffer)` 在原生工作队列上运行。
返回的 `PackageArchive` 持有自己的字节；`read(path)` 解码单个成员，`readAll()` 用于安装时校验。
`inspection` 和 `entries` 是 JSON 字符串。编解码器检查格式安全和条目是否存在；manifest schema、
API 兼容性和签名者连续性规则由宿主按 SDK 执行。

## 发布

每个 `.mojito` 自带签名。分发包的 `preparePublication(bytes, downloadUrl)` 校验包并返回该产物的
仓库（catalog）发布条目。安装程序把 worker 包按归档保存，原生包则按签名 manifest 中的入口解压。

## 浏览器

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
pnpm build:web
```

用任意静态 HTTP 服务器提供 `dist/package-web` 即可。worker 使用与 npm 工具相同的 WASM，校验签名、归档、manifest，以及每个成员的解码大小和 CRC。文件只在浏览器中处理，不会上传。可选预期指纹可绑定已知密钥，自签名有效并不能证明发布者身份。

`@ffcafe/mojito-package/web` 导出 `init`、`generatePrivateKey`、`validatePrivateKey`、`packFiles` 和 `verifyPackage`，使用前先等待 `init()`。私钥统一使用 JWK JSON 文本，独立私钥校验只返回公钥和指纹；包校验结果包含完整文件的 `size` 和 `sha256`。

## 格式版本 1

| 字节 | 内容 |
| --- | --- |
| 0–7 | `MJPKG01` 后跟 NUL |
| 8–11 | 无符号小端序的 compact JWS 字节长度 |
| 12… | UTF-8 compact JWS，最多 128 KiB |
| 其余部分 | 完整且未改动的标准 7z 归档 |

JWS 使用 EdDSA/Ed25519、`typ: mojito-package+jws`，protected header 中带一个只含公钥的 OKP JWK。
payload 包含 `formatVersion`、完整的 `manifest`、`archiveSize` 和小写十六进制的 `archiveSha256`。
宿主解压原生条目，worker 条目则直接从归档中读取。版本 1 沿用现有的 Windows x64 原生 ABI；
跨平台打包并不扩大原生运行时的支持范围。

签名摘要覆盖内层 7z，而仓库（catalog）中的大小和哈希描述的是完整的 `.mojito` 产物。
解析按声明的前缀长度进行，不扫描魔数。重复的 JSON 键、不支持的字段或算法、非规范的 base64url、
被改动的字节、不一致的 manifest、固实块、不安全或冲突的路径、链接以及超大内容都会被拒绝。
上限：包 256 MiB，解压后 256 MiB，单个成员 32 MiB，4096 个条目。7z 头部用 sevenz-rust2 解析；
数据块只接受 Copy/LZMA2。

Mojito 把 JS 包作为一个不可变的归档快照安装，并通过 `mojito-plugin:` 提供其中的 ESM、HTML 和资源。
读取压缩过的 JS 仍需在内存中解码。原生包在加载前解压到版本目录。两种方式都保留现有的事务日志、
回滚和发布者密钥绑定。

已验证可直接用 7-Zip 25.01 和 26.05 打开。这不代表所有压缩工具都兼容：libarchive 3.7.4 会拒绝非空的
自定义前缀。用其他工具编辑或重新打包会使签名失效；须用本编解码器重新签名。

## 许可证

AGPL-3.0-only，正文见 [LICENSE](LICENSE)。
