# SDK entry points

```sh
pnpm add @ffcafe/mojito-plugin-sdk
```

The background receives its context through `activate(context)`; importing the package does not start a plugin. Current exports are defined in [package.json](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/package.json).

| Import path | Author use |
| --- | --- |
| `@ffcafe/mojito-plugin-sdk` | PluginContext, Manifest, data types, PluginError, limits and capability names |
| `@ffcafe/mojito-plugin-sdk/view` | `connectView` and ViewBridge in views |
| `@ffcafe/mojito-plugin-sdk/schema` | Validate manifests, version ranges and package paths |
| `@ffcafe/mojito-plugin-sdk/errors` | PluginError and error construction/conversion helpers |
| `@ffcafe/mojito-plugin-sdk/overlayplugin` | OverlayPlugin compatibility declarations, state types and `overlayProducer` |
| `@ffcafe/mojito-plugin-sdk/testing` | Unit-test `createTestContext` with explicit session, limits and method handlers |

`testing` records requests and lets tests publish batches, send host calls and close the connection. It responds only with behavior supplied by the test. See [testing.ts](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/testing.ts) for signatures.

## Host entry points

`client`, `connection`, `messages`, `protocol` and `transport` are for host connection setup, handshakes and message transport. Plugins use the supplied context and a view's `connectView()`.
