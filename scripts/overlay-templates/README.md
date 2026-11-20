# Overlay plugin resources

English | [简体中文](README.zh-CN.md)

`node scripts/overlay-templates/build.mjs` builds the pinned upstream sources fetched into `.tmp/overlay-templates/sources`
into `packages/overlay-plugins/dist/<template>`, one directory per template listed in the script. Build
that workspace to add its manifests and workers. The launcher builds independently.

The script uses checked-in npm locks, the build tool each template pins (for example Parcel 2.16.4), Bun 1.3.11 and source patches.
Dependencies and generated sources stay in `.tmp/overlay-templates`; fixed source checkouts stay
unchanged. Runtime outputs include the upstream and patch links in `SOURCE.txt`,
upstream metadata in `SOURCE.json` and applicable licenses.

Package pages use the existing sandboxed compatibility preload and their owner's
ResourceProvider. Navigation is restricted to the plugin's declared documents.
See the [overlay plugin workspace README](../../packages/overlay-plugins/README.md) for packaging and service setup.

The default build and official packaging share `templates.mjs`. MopiMopi2 is excluded pending a redistribution license. Explicit single-template builds remain available for research. The default build clears the template output. Official packaging writes only verified plugin packages and checksums.

Supplemental licenses for bundled Aldrich, Lato and Material Icons fonts are recorded in [font-licenses](font-licenses/README.md); existing Fontsource licenses remain included.
