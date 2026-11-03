# Overlay plugin resources

`node scripts/overlay-templates/build.mjs` builds the pinned upstream sources fetched into `.tmp/overlay-templates/sources`
into `packages/overlay-plugins/dist/{kagerou,skyline,mopimopi2}`. Build
that workspace to add its manifests and workers. The launcher builds independently.

The script uses checked-in npm locks, Parcel 2.16.4, Bun 1.3.11 and source patches.
Dependencies and generated sources stay in `.tmp/overlay-templates`; fixed source checkouts stay
unchanged. Runtime outputs include SOURCE metadata and applicable licenses; patched
source archives with build inputs are written to the sibling `dist/sources` directory.

Package pages use the existing sandboxed compatibility preload and their owner's
ResourceProvider. Navigation is restricted to the plugin's declared documents.
See the overlay plugin workspace README for packaging and service authorization.
