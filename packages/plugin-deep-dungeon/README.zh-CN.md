[English](README.md) | 简体中文

# 深层迷宫图鉴

原生 worker 和页面提供选中怪物信息、图鉴搜索与手动楼层攻略。清单使用 Plugin API `^2.0.0`，代码消费已有 target、entity、zone、session 和行查询接口。

## 开发预览

```sh
pnpm --filter @ffcafe/mojito-plugin-sdk build
pnpm --filter @ffcafe/mojito-plugin-deep-dungeon build:fixture
pnpm exec vitest run packages/plugin-deep-dungeon
```

用静态服务器提供 `dist-fixture`，同时提供 Mojito 的 `/host/mojito-base.css` 和主题变量。预览页使用合成宿主与资料，并显示合成资料标记；包含长中文备注、无备注、英文回退和手动楼层重定向。预览清单 ID 为 `example.deep-dungeon-fixture`，不作为官方发行包。浏览器检查可用 `window.deepDungeonFixture.select(910001)`、`select(919999)`（无攻略）或 `select(null)`（清除目标）选择合成目标。

常规构建要求存在 `src/generated/catalog.json`，缺失时明确失败。此阶段不提供正式资料或未经实读的 BNpcName 名称列。生成资料排除出 Git，官方打包路径只读取 `dist`，不读取 `dist-fixture`。

## 资料边界

后续构建转换提供 `src/data.ts` 中的 `Catalog` 结构，`nameColumn` 必须来自实际客户端读取。合成测试传入任意列号以测试索引和语言透传，这些值不能作为客户端布局证据。名称查询把 `session.dataLanguage` 原样传给不带具名列的 `data.rows`，缺失或无效结果保留上游名称和 ID。

Linux 测试与预览截图验证合成输入下的插件行为。真实客户端名称与 ID 核验、固定资料转换、真实资料截图、正式包验证及 Windows 游戏验收分别完成。
