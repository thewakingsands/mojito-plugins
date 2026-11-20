# Raidboss 运行时（预览）

[English](README.md) | 简体中文

本包改编自 [vendor/cactbot/PROVENANCE.md](vendor/cactbot/PROVENANCE.md) 中记录的固定 cactbot 版本。
它消费结构化的 Mojito 事件；正式匹配从不合成战斗日志行。对应的普通 Worker 插件是
`@ffcafe/mojito-plugin-raidboss`，附带固定的上游规则和时间轴集合。P1N 是验收的参考战斗。
每条规则分别报告不支持或不可用的输入。

先构建 SDK 和运行时，再构建 `@ffcafe/mojito-plugin-raidboss`。用现有的包 CLI 为生成的目录签名：

```sh
mojito-package pack packages/plugin-raidboss/dist private-key.json Raidboss.mojito lzma2
mojito-package verify Raidboss.mojito
```

私钥是 Ed25519 JWK，放在包之外。签名后的包通过普通的插件界面安装。插件需要 Plugin API 2.0。
收集运行期间，管理页中提供收集策略的默认值和已保存的覆盖设置。设置了
`resetWhenOutOfCombat: false` 的收集会一直保留状态，直到显式重置或来源、区域变化。

合成测试覆盖完整的 P1N 触发器集合、固定上游版本的 network-regex 匹配和回调顺序、翻译后的条件、
小队职业和职能、坐标轴、多目标排序、时间轴窗口和循环/重置、取消、单条规则故障的隔离、缺失字段以及
配置冲突。顺序参照实现与改编后的运行时共用输出辅助函数；它不能独立验证浏览器渲染、语音或真实的游戏录像。
测试数据中没有真实玩家数据。

不支持的事件类型和字段会作为单条规则的诊断明确报告。必需的时间轴同步不可用时，该时间轴及其附带的触发器
停止。历史名称从不用之后的实体快照补全。小队职能需要真实观察到的实体 classJob。缺失的查询属性会直接失败，
而不是返回编造的零值。因此，旧录像或玩家身份、战斗字段不可用的宿主可能无法完整激活 P1N；这里不使用
任何推断出的战斗或身份数据作为替代。

注册快照保留回调对象和闭包，匹配参数则在模块加载时复制。按稳定的 set/id 配置规则。文本按纯文本渲染，
所有视图共用一个 Worker 和一条音频输出路径。只启用一个 Raidboss 插件。音频是可选的；没有音频时文本照常显示。

在宿主的 TTS 专业模式中，「信息」沿用插件默认频道的音色和优先级，「注意」和「警报」可分别设置。
播报优先使用玩家为规则指定的级别，否则取本次产生提示文字的最高级别。纯语音规则默认使用「信息」，时间轴直读也使用「信息」。

社区规则包可以用 [仓库内的工具](../raidboss-tools/README.zh-CN.md) 构建。它的合成验收不能代替真实社区文件
或 P1N 的验证。

CombatantMemory 由观察到的实体差异推出。重复生成的 NPC 使用有序的 `npcSpawn` 事件，而不是快照差异。
只有文本的旧条件需要结构化的替代写法，不会悄悄退回到日志匹配。
