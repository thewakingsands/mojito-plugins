English | [简体中文](README.zh-CN.md)

# Deep dungeon bestiary

Shows the selected monster's name, HP, guide and control resistances. The reference view offers a searchable bestiary and manual floor guides. Arrow keys move between tabs; Enter or Space opens the focused tab.

## Build

From the repository root:

```sh
git submodule update --init --recursive
pnpm --filter @ffcafe/mojito-plugin-deep-dungeon build
```

The build reads the pinned MonsterDex data submodule without network access and converts the indexed Deep Dungeon monsters, English and Simplified Chinese guides, floor redirects and territory ranges. It checks the two known duplicate IDs against their source records before applying corrections. Generated files are excluded from Git.

The package includes the converted catalog, its source and credit record, and a copy of the MonsterDex code license. The pinned data snapshot has no standalone license file. Guide text retains upstream wording and line breaks. When Chinese text is missing, the reference uses the English text.

Client names use `session.dataLanguage` with `data.rows` and the verified zero-based BNpcName column 0. The guide uses upstream names and IDs when a requested name is unavailable. Plugin API `^2.0.0` supplies the target, entity, session and data interfaces this plugin uses.
