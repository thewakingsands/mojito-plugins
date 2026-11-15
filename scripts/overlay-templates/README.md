# Overlay plugin resources

English | [简体中文](README.zh-CN.md)

`node scripts/overlay-templates/build.mjs` builds the pinned upstream sources fetched into `.tmp/overlay-templates/sources`
into `packages/overlay-plugins/dist/<template>`, one directory per template listed in the script. Build
that workspace to add its manifests and workers. The launcher builds independently.

The script uses checked-in npm locks, the build tool each template pins (for example Parcel 2.16.4), Bun 1.3.11 and source patches.
Dependencies and generated sources stay in `.tmp/overlay-templates`; fixed source checkouts stay
unchanged. Runtime outputs include SOURCE metadata and applicable licenses; patched
source archives with build inputs are written to the sibling `dist/sources` directory.

Package pages use the existing sandboxed compatibility preload and their owner's
ResourceProvider. Navigation is restricted to the plugin's declared documents.
See the [overlay plugin workspace README](../../packages/overlay-plugins/README.md) for packaging and service setup.
