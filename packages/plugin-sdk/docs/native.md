# 原生插件

当前 native 运行时支持 **Windows x64**，使用 ABI 1。跨平台 CLI 能打包和校验 `.mojito`，但不改变 DLL 的运行平台。

现成 Rust 项目在 [examples/plugin-native-rust](https://github.com/thewakingsands/mojito-plugins/tree/main/examples/plugin-native-rust)。它是独立的 Cargo workspace，依赖仓库内的 `plugin-protocol`，导出 C ABI 接口，并通过协议订阅会话。

## 构建

在 Windows x64 的 Rust 开发环境中，从仓库根目录执行：

```sh
node examples/plugin-native-rust/build.mjs
```

构建脚本生成示例的 `dist` 目录。登记构建后的 manifest 用于开发；分发时以该目录作为[打包输入](packaging.md)。

```json
{
  "schemaVersion": 1,
  "id": "NativeSessionNotes",
  "name": "Native session notes example",
  "version": "0.1.0",
  "apiVersion": "^2.0.0",
  "entry": {
    "kind": "native",
    "path": "mojito_native_example.dll",
    "os": "win32",
    "arch": "x64",
    "abiVersion": 1
  },
  "capabilities": ["session.read"],
  "networkOrigins": []
}
```

## ABI 与协议

C 声明见 [mojito_plugin_v1.h](https://github.com/thewakingsands/mojito-plugins/blob/main/include/mojito_plugin_v1.h)，协议类型见 [plugin-protocol](https://github.com/thewakingsands/mojito-plugins/tree/main/crates/plugin-protocol)。按头文件约定传递缓冲区和回调，保留协议的 activation ID 与请求关联；宿主 API 仍使用声明的 capability。

native 使用独立 runner。每条传输消息必须放进 4 MiB frame；存储单文件预算保持 3 MiB。只在本机 Windows x64 验证过的 DLL 上声明运行支持。
