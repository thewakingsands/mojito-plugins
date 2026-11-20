# 统计验收

[English](README.md) | 简体中文

构建 `@ffcafe/mojito-combat-model`、`@ffcafe/mojito-combat-statistics` 及兼容的 Mojito 宿主后，在插件仓库运行下列命令。输出目录必须可丢弃；驱动会安装插件并清空自己的历史。

```sh
MOJITO_ACCEPTANCE_OUTPUT=/absolute/capacity.json \
  pnpm exec vitest run packages/combat-statistics/src/log/acceptance.test.ts

DISPLAY=:99 MOJITO_HOST_ROOT=/absolute/mojito \
MOJITO_ACCEPTANCE_OUTPUT=/absolute/worker-results \
  /absolute/electron --js-flags=--expose-gc scripts/statistics/acceptance.cjs
```

容量测试生成人工输入：24 名成员及宠物，每人 150 个技能、15 个目标、100 场战斗。它核对整数总量、重复 tick/修订、待处理分配、宠物合并及重开日志后的每场摘要。摘要 JSON 与实际 Parquet 文件大小分别报告，使用当前插件声明的 2 GiB 总量和 16 MiB 单文件额度。

Electron 驱动使用正式宿主、Worker 和功能/设置页面。相同合成负载（24 名攻击者、每三秒一次来源未知的周期伤害）先完整运行一轮来预热 Worker 和界面，然后测量五轮。每轮不限速推进一小时来源时间，停用后观察 60 秒现实时间。这是合成压力测试，不是真实录制或一小时连续实时运行。`MOJITO_ACCEPTANCE_SECONDS` 和 `MOJITO_ACCEPTANCE_SETTLE_MS` 可缩短诊断运行；报告须保留实际参数。

`result.json` 记录提交、版本、精确总量、队列条目数、主进程内的 RPC 计时（排除主动等待的时钟请求）、进程树 RSS 和释放计数。详细内存与排空样本写入 `round-*.json`；摘要不保留往轮完整采样，避免测量脚本本身持续占用内存。RSS 为 Electron 各进程工作集之和，共享页可能重复计入；Worker 与渲染进程共用进程，不再单独累加。

确定性通过条件：整数总量相等；结束时没有尚未确认的输入；每轮停用后的订阅、来源定时器和窗口数恢复基线；Worker 所属窗口与功能视图销毁；停用后消息数和日志哈希不再变化；重开历史值一致；页面清空操作能移除已完成历史。容量测试还要求 post 修订后待处理分配为零。若负载反复达到等待上限或队列持续增长，即使最终排空也须调查。

每轮停用并完成观察后，在相同的空闲状态下每秒采样一次，共九次。每次采样前对主进程执行 GC。`memoryTrend` 分别记录两项指标的采样值、各轮中位数和极差（最大值减最小值），以及连续两轮中位数之差。以各轮极差的最大值作为实测波动范围，预热轮单独记录。主进程堆和进程树 RSS 的最后两轮增量均不超过各自实测的波动范围，内存检查才算通过。

样本同时记录 V8 编译代码大小。如果某项指标最后两轮的增量均超出实测波动，且最后一轮增量不小于前一轮，设置 `MOJITO_ACCEPTANCE_HEAP_SNAPSHOTS=1` 重跑相同负载，对比每轮停用后仍保留的对象。生成堆快照可能影响测量值，因此这组结果用于诊断。任一检查失败时，驱动以非零状态退出并保留结果。

## 真实录制与 Windows

宿主已有 `scripts/plugin-isolation/combat-replay-main.cjs`，通过正式 ParserService、PacketSession 和插件宿主读取 `.mjrec`：

```sh
MOJITO_COMBAT_OUTPUT=/absolute/disposable-profile \
  /absolute/electron /absolute/mojito/scripts/plugin-isolation/combat-replay-main.cjs \
  --plugins-root /absolute/mojito-plugins --recording /absolute/sample.mjrec \
  --speed 1 --out /absolute/private-results.json
```

录制须包含客户端配置和 opcode 表。有合适样本时使用来源时间至少一小时的完整录制，记录实际时长、客户端版本和输入缺口，对照 1x 与不限速（`--speed 0`）结果。现有驱动输出原始事件行，与录制一起留在本机。该驱动不包含 `acceptance.cjs` 的资源采样；真实长录制资源验收还须配合采集主进程请求/回复和队列、进程内存及停用后资源，不能用合成结果代替。

现场游戏采集、小队内存身份、真实跨服同名/宠物变化及同场 ACT 对照需要游戏环境。分别比较报文治疗、周期观测与估计量、未知量、承伤和死亡。角色身份及原始日志留本机，只分享汇总测量和覆盖缺口。
