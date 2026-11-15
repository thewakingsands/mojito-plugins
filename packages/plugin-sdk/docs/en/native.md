# Native plugins

The native runtime currently supports **Windows x64**, ABI 1. A cross-platform CLI can pack and verify `.mojito` files without changing the DLL's runtime platform.

The ready-to-build Rust project is [examples/plugin-native-rust](https://github.com/thewakingsands/mojito-plugins/tree/main/examples/plugin-native-rust). It is a separate Cargo workspace, depends on this repository's `plugin-protocol`, exports the C ABI and subscribes to sessions through the protocol.

## Build

From the repository root, in a Windows x64 Rust development environment:

```sh
node examples/plugin-native-rust/build.mjs
```

The script creates the example's `dist` directory. Register the built manifest during development; use that directory as [packaging input](packaging.md) for distribution.

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

## ABI and protocol

C declarations are in [mojito_plugin_v1.h](https://github.com/thewakingsands/mojito-plugins/blob/main/include/mojito_plugin_v1.h); protocol types are in [plugin-protocol](https://github.com/thewakingsands/mojito-plugins/tree/main/crates/plugin-protocol). Follow the header's buffer and callback conventions and preserve activation IDs and request correlations. Host API calls still use declared capabilities.

Native plugins use a separate runner. Each transport message must fit a 4 MiB frame; the per-file storage budget remains 3 MiB. Claim Windows x64 runtime support only for DLLs tested there.
