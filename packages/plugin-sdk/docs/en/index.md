# Plugin development

Mojito plugins run their logic in a background Worker or a Windows native module. Isolated web pages provide features, settings and overlays.

Run a Worker with [Getting started](getting-started.md). For a UI, read [Pages and overlays](features.md) and the [View bridge](api/view.md). Distribute it with [Package and sign](packaging.md) and [Publish and update](publishing.md).

## Compatible versions

This guide targets Plugin API **2.0.0**. Examples declare `apiVersion: "^2.0.0"`. The SDK npm version, Plugin API version, manifest `schemaVersion: 1` and native `abiVersion: 1` are numbered independently.

API 2 is incompatible with 1.x. [Permissions](permissions.md) describes current capabilities and denial behavior. The SDK package includes full `.d.ts` signatures; type links on this site lead to public source.

## Find a use case

- [Services and lifecycle](api/context.md): game data, storage, network, speech and plugin services.
- [Data and events](api/data-model.md): availability, batches, sessions and replay clocks.
- [Manifest](manifest.md): declarations and version ranges.
- [SDK entry points](api/exports.md): imports and test tools.

## For agents

Use [llms.txt](../llms.txt) to find Markdown pages, or read [llms-full.txt](../llms-full.txt). Both are generated from this site's content.
