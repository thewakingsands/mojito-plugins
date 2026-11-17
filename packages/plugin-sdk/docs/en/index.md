# Plugin development

Mojito plugins can read game data, add pages, settings pages and overlays to Mojito, read text aloud, or provide services to other plugins. Plugins are written in JavaScript/TypeScript and web technologies, without modifying Mojito itself.

## What a plugin contains

```text
my-plugin/
├─ plugin.json      Plugin declaration: ID, name, version, required permissions, entry file
├─ entry.mjs        Background: the plugin's logic, run when Mojito starts the plugin
└─ main.html …      Pages and overlays (optional): ordinary web pages that display data prepared by the background
```

- The **background** is a JavaScript module that exports an `activate(context)` function. It runs in an isolated environment (a browser Worker) provided by Mojito. Everything goes through `context`: reading session and game state, subscribing to events, saving configuration, registering pages and so on.
- **Pages** are HTML files in the plugin package. Once the background registers them, pages appear in Mojito's sidebar, home page, settings or overlays. Pages read data published by the background and send commands to it through the bridge.
- **`plugin.json`** (the manifest) declares who the plugin is, which file it starts from and which permissions (capabilities) it uses. Users see these permissions when installing.

A plugin that only needs a background can have no pages. A Windows native DLL can also act as the background; see [Native plugins](native.md).

## From development to publishing

1. **Develop**: register the plugin directory in Mojito's 开发者工具 (developer tools) and run it directly, without packaging. See [Getting started](getting-started.md).
2. **Package and sign**: pack the built plugin directory into a `.mojito` file signed with your private key. See [Package and sign](packaging.md).
3. **Publish**: put the `.mojito` and a `catalog.json` describing it online. See [Publish and update](publishing.md).
4. **Install**: users add your catalog URL in Mojito, choose the plugin to install and confirm its permissions.

## Reading order

Complete [Getting started](getting-started.md) first, then read [Core concepts](concepts.md). After that, read as needed:

- Add pages and overlays: [Pages and overlays](features.md), [Style](style.md)
- Debug and troubleshoot: [Development](development.md)
- Look up methods and data: [Services and lifecycle](api/context.md), [Data and events](api/data-model.md), [View bridge](api/view.md)

## Compatible versions

This documentation covers Plugin API **2.0.0**; write `"apiVersion": "^2.0.0"` in the manifest. API 2 is incompatible with 1.x. The SDK npm version and the Plugin API version are numbered independently.

Full method signatures ship with the SDK's type declarations (`.d.ts`) and can be viewed directly in an editor.

## For agents

Find the Markdown for a topic in [llms.txt](../llms.txt), or read [llms-full.txt](../llms-full.txt). Both are generated from this site's content.
