English | [简体中文](README.zh-CN.md)

# Deep dungeon bestiary

Native worker and views for selected monster information, a searchable bestiary and manually selected floor notes. Host tabs switch between monsters and floors; arrow keys move focus and Enter or Space activates a view. The overlay groups crowd controls by effective, immune and unknown. The manifest uses Plugin API `^2.0.0`; the code consumes existing target, entity, zone, session and row APIs.

## Development preview

```sh
pnpm --filter @ffcafe/mojito-plugin-sdk build
pnpm --filter @ffcafe/mojito-plugin-deep-dungeon build:fixture
pnpm exec vitest run packages/plugin-deep-dungeon
```

Serve `dist-fixture` with Mojito's `/host/mojito-base.css` and theme variables. The preview pages use a synthetic host and catalog, display a synthetic-data banner, and include long Chinese notes, missing notes, English fallback and manual floor redirects. The preview manifest has ID `example.deep-dungeon-fixture`; it is not an official distribution. Browser checks can select a synthetic target with `window.deepDungeonFixture.select(910001)`, `select(919999)` (missing guide), or `select(null)` (clear).

The regular build requires `src/generated/catalog.json` and fails when it is absent. This stage does not supply a production catalog or an unverified BNpcName column. Generated data is excluded from Git, and the official packaging path only uses `dist`, never `dist-fixture`.

Once the generated production catalog is integrated, browser checks will use it and the synthetic build mode, catalog, host, bridge and aliases will be removed. Small unit-test samples will live in the test files.

## Data boundary

The future build conversion supplies the `Catalog` structure in `src/data.ts`. `nameColumn` must come from actual client reads. Synthetic tests supply arbitrary columns to test indexing and language forwarding; those values are not client layout evidence. Name lookups pass `session.dataLanguage` to `data.rows` without named columns, and missing or invalid results leave the upstream name and ID visible. Each request uses the session language captured at its start. Changing the page language or dungeon starts a new request; late responses cannot replace newer results.

Linux tests and preview screenshots validate plugin behavior with synthetic inputs. Real client name/ID verification, conversion of the pinned source data, screenshots using that data, package verification and Windows game acceptance remain separate checks.
