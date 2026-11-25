[English](README.md) | 简体中文

# 深层迷宫图鉴

显示选中怪物的名称、HP、攻略和控制抗性。查阅页可搜索怪物和手动选择楼层攻略。方向键移动标签焦点，Enter 或空格打开当前标签。

## 构建

在仓库根目录执行：

```sh
git submodule update --init --recursive
pnpm --filter @ffcafe/mojito-plugin-deep-dungeon build
```

构建离线读取固定的 MonsterDex data 子模块，转换索引中的深层迷宫怪物、英文与简体中文攻略、楼层重定向和区域范围。两处已知重复 ID 必须与预期源记录一致，才会应用修正。生成文件不提交到 Git。

包内包含转换后的图鉴、来源与署名记录以及 MonsterDex 代码许可原文。固定资料提交未包含独立许可文件。攻略保留上游措辞与换行，缺少中文时使用英文。

客户端名称通过 `session.dataLanguage` 调用 `data.rows`，读取已核实的 BNpcName 第 0 列。名称不可用时，图鉴使用上游名称和 ID。目标、实体、会话和数据接口均由 Plugin API `^2.0.0` 提供。
