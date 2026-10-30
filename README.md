# 主线历史控制逻辑研究原型

这是可运行、独立的研究原型：输入真实顺序的 `Update` 和判定回调，输出失败分支和演出调用。规则已在本轮从历史 ARM64 二进制复核。来源为第三方修改的 **3.0.0.1** 存档；没有证据说明它与官方现版 4.x 相同。

```sh
# 在本研究分支根目录执行
npm test
npm run demo
node run-trace.mjs traces/stage1-failure.json
node run-trace.mjs traces/stage2-failure.json
```

运行只需 Node.js，无 npm 依赖。19 个测试覆盖浮点相邻值、窗口端点、判定调用顺序、首次分数采样、严格时间阈值、跳帧、失败锁存、重开，以及 Retribution 两阶段的独立 HP 参数和锁定顺序。

Retribution 的可复用判定增量 / 单次 HP 决策位于 [retribution-hp.mjs](retribution-hp.mjs)，精确可证实范围与缺口见 [RETRIBUTION-EVIDENCE.md](RETRIBUTION-EVIDENCE.md)。HP 模块不把阶段锁定、协程或跳转请求标记成完整主线成功。

`luminescence.mjs` 的入口：

```js
import { HistoricalLuminescence } from './luminescence.mjs';
const run = new HistoricalLuminescence('IN');
run.update(90, 600000); // ProgressControl.nowTime / ScoreControl._score，均为 float32
run.judge('Bad');      // 使用最近一次 Update 缓存的窗口状态
console.log(run.update(151, 1000000));
console.log(run.snapshot());
```

这里的分数是外部传入的原始浮点分数，不由显示用整数、最终成绩或本原型自造的计分器推算。每局建立新实例；时间倒退不会清除已发生的失败或完成标记。

原型只输出控制调用，没有伪造原版粒子、着色器、歌曲、剧情 UI 或存档解锁。`unlock-retribution-coroutine-requested` 表示开始协程，不表示已经解锁 Retribution。它没有接入 `/workspace/phigros-publish`，也没有独立站点入口。不能把本原型作为“完整官方意象重演”上线。

证据、地址、恢复过程及还缺少的资料见 [EVIDENCE.md](EVIDENCE.md)。

可移植文件清单见 [PORTABLE.md](PORTABLE.md)。原始 so、APK、metadata、工具和完整反汇编仅保留在本地研究目录，不是运行原型的依赖。

## 已发布主站

https://tycofficial.github.io/phigros/?v=4.0.1.2-pages-16

本分支只保存已核对的历史控制原型。主站的触控、品牌与 AAC 兼容更新独立发布；这些研究模块没有接入主站。Retribution 的 HP 公式和边界见 [RETRIBUTION-EVIDENCE.md](RETRIBUTION-EVIDENCE.md)。
