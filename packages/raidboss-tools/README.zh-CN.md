# 社区 Raidboss 规则包构建工具

[English](README.md) | 简体中文

在仓库根目录构建固定版本的运行时、共用的插件视图和本工具：

```sh
pnpm --filter @ffcafe/mojito-plugin-sdk build
pnpm build:package
pnpm --filter @ffcafe/mojito-raidboss build
pnpm --filter @ffcafe/mojito-plugin-raidboss build
pnpm --filter @ffcafe/mojito-raidboss-tools build
node packages/raidboss-tools/dist/cli.js \
  --key /path/to/private-key.json \
  --id author.raidboss-rules --name 'My Raidboss rules' --version 1.0.0 \
  --entry /path/to/rules.ts --timeline /path/to/timeline.txt \
  --out /path/to/MyRaidbossRules.mojito
```

`--entry` 和 `--timeline` 可以重复。入口必须是同一文件系统根下的本地 `.js`、`.mjs` 或 `.ts` 文件。
时间轴以文件名为键，文件名重复会失败。更新规则时保持明确且稳定的 `set.id` 和 `trigger.id`。
没有 ID 的 set 以其入口相对于公共入口目录的路径作为备用标识。使用社区自己的插件 ID，不能与
`ffcafe.raidboss` 相同。

入口可以默认导出一个触发器集合，也可以使用 `Options.Triggers.push(...)` /
`Options.Triggers = [...]`。普通的动态构造和回调闭包会保留。模块加载完成后注册即关闭，不支持运行时追加。
本地辅助模块的 import 会被打包。`@cactbot/resources/outputs` 这类固定的辅助 import 指向固定版本的
改编版 cactbot 资源。Node 内置模块、远程模块和未知包的 import 会失败。本工具不安装依赖，也不运行输入中的
npm 脚本、构建插件或 tsconfig。编译不会执行输入代码；启用生成的普通 Worker 插件时，代码会在现有的宿主
权限下执行。

生成结果包含共用的管理页、悬浮窗、固定运行时的来源说明和许可证。它用现有的 Rust 编解码器生成签名的
`.mojito` 外壳和 7z 归档，生成的包可以用同一个 CLI 校验。`--key` 是 Ed25519 私钥 JWK；把它放在源码和
插件目录之外。通过普通的插件安装程序导入，并且只启用一个 Raidboss 插件。音频是可选的。规则能加载
并不代表与真实游戏兼容：不支持的字段、旧的整行匹配和不可用的时间轴同步仍按原样报告单条规则的诊断。
在插件设置中用 type/netRegex 补全旧的匹配器，并保留所有来源/目标约束；时间轴同步需要转换时，编辑时间轴源文件
后重新构建。构建工具不会添加任何权限，也不会退回到日志行匹配。

合成的构建和运行时测试覆盖注册、闭包、部分支持、路径和包校验。真实的社区文件以及 Windows 上的 P1N
视图和音频验收仍需各自的验证；不要把真实的玩家录像和规则源码一起分发。
