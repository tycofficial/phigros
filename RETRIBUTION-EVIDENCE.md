# Retribution 两阶段 · 历史 native 窄范围复核

与 [EVIDENCE.md](EVIDENCE.md) 使用同一批重新恢复、已校验的第三方修改版 3.0.0.1 ARM64 输入。**不能视为官方现版 4.x 规则。** 本轮没有新增网络下载或发布站改动。

完整原生反汇编保存在本地 `evidence/retribution-arm64.asm`，不随可移植研究分支上传。SHA-256 在 [PORTABLE.md](PORTABLE.md) 记录；对应 RVA 和常量地址见本文。已知源与重新恢复步骤见 EVIDENCE.md。本地复现：

```sh
/workspace/phigros-research-effects/.venv/bin/python scripts/disassemble.py retribution
npm test
```

独立纯函数在 [retribution-hp.mjs](retribution-hp.mjs)，覆盖已核对的判定增量和单次 HP/锁定决策，7 项针对性测试。它不伪造画面、不运行保存、延迟回调或场景跳转；不是完整重演状态机。调用方需要保留原始 Update / OnJudge 顺序、死亡锁存以及累计 note 项，不能每帧从最终成绩反推。

## Phase 1

`RetributionEffect.Start` RVA `0x21f7a78` 按 EZ / HD / IN 分别设置：

| 难度 | beginHP | timeAffect | basicNoteAffect |
| --- | ---: | ---: | ---: |
| EZ | 0.9 | 0.001628459272 | 0.012 |
| HD | 0.7 | 0.001835141443 | 0.013 |
| IN | 0.6 | 0.002103500983 | 0.015 |

向量地址为 `0x3eb7ba0 / 0x3eb7bb0 / 0x3eb7bc0`（每项两个 double：beginHP、timeAffect）；basicNoteAffect 位于 `0x3eb7ad8 / ae0 / ae8`。难度字符串间接地址 `0x4d33540 / 0x4d3dba8 / 0x4cfa668` 分别解析为 EZ / HD / IN，与本轮 script.json 核对。ELF 第二个 PT_LOAD 的文件偏移比虚拟地址少 `0x10000`，读取这部分指针时必须做映射。

`OnJudge` RVA `0x21f8078`：dead 时返回。读取当前 `ProgressControl.nowTime`，先以 float32 做 `t = nowTime - 101.68419647216797`；`t < 0` 返回。随后以 double 累加：

```text
totalNoteAffect += basicNoteAffect * max(1 - 0.025956284153 * double(t), 0) * scale
```

`noteAffect` 由 `0x21f7bbc–0x21f7bd4` 装入 double 位型 `0x3f9a9448be405361`。Start 把四个回调依次接到 ScoreControl 的 `0x88 / 0x90 / 0x98 / 0xa0`（Miss / Bad / Good / Perfect）；`0x21f88e0 / e8 / f0 / fc` 的 scale 为 `-1 / -1 / 0.2 / 0.4`。OnJudge 本身没有上界时间检查。

`Update` RVA `0x21f80ec`：`t >= 0` 后以 double，按原生运算顺序计算：

```text
loss = ((timeAffect * -0.5) * double(t)) * double(t)
HP = totalNoteAffect + (beginHP + loss)
```

已核对的 HP/OnJudge 路径使用分开的 `fmul/fadd/fsub`，没有 fused multiply-add 指令。原型保留运算顺序，但没有完成原生逐调用数值差分验证，因此不承诺整个 HP 流程 bit-exact；死亡判定与锁定条件的严格/含等号关系以原生分支为依据。

`0x21f81f8–0x21f82cc`：首次 HP <= 0 置 dead，停止普通游玩标记，实例化 redFlash，请求 **1.5 秒后的失败回调**，开始 **1 秒 AudioFadeOut**。死亡检查使用上述 double HP，先于显示平滑。之后若 HP > 1，`totalNoteAffect -= HP - 1`，将用于显示的目标压到 1；过量恢复不会储存为隐藏血量。显示值经 Lerp / Clamp01，再平方传给 HPDisplayControl，本原型没有把显示条当判定血量。

失败回调 RVA `0x21f8908` 补齐未完成音符的 Miss、更新歌曲记录 / 排名分，最后调用 `BlackScreen.Show(..., 2.0)`；本轮未追踪该 BlackScreen 实例的后续跳转。**Phase 1 Update 中没有 `141.4737 秒即成功` 的分支**；39.78949737548828 仅用于颜色插值进度分母。主线成功与转入下一阶段须继续核对外层控制器。

## Phase 2

`RetributionEffectSecondPhase` 构造函数 RVA `0x21f9f7c` 设置 beginHP=1（double），outro=`1.7999999523162842`（float）。Start RVA `0x21f8c90` 设置：

| 难度 | timeAffect | Miss / Bad | Good | Perfect |
| --- | ---: | ---: | ---: | ---: |
| EZ | 0.000284977021 | -0.03 | 0.0024 | 0.0048 |
| HD | 0.000576304506 | -0.04 | 0.0026 | 0.0052 |
| IN | 0.000897002881 | -0.06 | 0.003 | 0.006 |

向量地址 `0x3eb7bd0 / be0 / bf0` 包含 Miss、Good double；Perfect / timeAffect 分别位于 `0x3eb7b00 / b08`、`b10 / b18`、`b20 / b28`。回调 RVA `0x21fa268 / 288 / 2a8 / 2c8` 接入相同四种判定。

OnJudge RVA `0x21f92dc`：dead 返回；以 float32 计算 `t = nowTime - 40.421051025390625`，`t >= 0` 时将上表对应 double 直接累加。**回调没有 locked 检查**。

Update RVA `0x21f932c`：未 locked 且已开始时，先检查 **nowTime > 101.68419647216797**（`0x21f9748–0x21f9848`），请求 LockAnim，置 locked，直接跳到 Update 末尾，**这一帧不检查 HP 死亡**。精确等于阈值仍走 HP 分支。HP 分支公式、HP<=0 死亡、上限修正和失败延迟与 Phase 1 同结构（`0x21f984c–0x21f9974`）。死亡回调 `0x21f9f98` 更新记录后销毁相关对象，最终 LoadScene **Loading**（原生间接字符串地址 `0x4c5a718`）。

后续 Update 进入 locked 分支，不再执行 HP 计算：当 AddressableAudioSource.time **> ClipLength - 6.5**，每帧用 deltaTime 递减 outro 并下限到零。只有 **outro == 0 && Unity AudioSource.isPlaying == false && isOver == false** 时，才置 isOver、更新歌曲记录及排名分、销毁相关对象、LoadScene **DFUnlock**（`0x21f9424–0x21f96b8`；字符串间接地址 `0x4c7cba0`）。这里的结束还依赖真实音频状态，不能用一个固定歌曲时间替代。

## HPProvider 的 .101 / .05 不能移植进来

已一并保存 HPProvider 方法以供对照。其 dump 常量和回调确认它有自己的 float32 规则；但以上两阶段 Start 明确订阅的是 Retribution 自己的 OnJudge，并采用表中 double 常量与时间衰减。**没有证据支持把 HPProvider 的 .101 / .05 当作 Retribution 的扣血/回血规则。** 本轮不声称已全局证明每个场景中 HPProvider 的挂载情况。

## 本轮收敛范围

已证明并落盘：两阶段难度参数、回调尺度、开始边界、HP公式、溢出修正、死亡顺序、Phase 2 严格锁定边界与音频结束条件，以及失败/完成的直接后续调用。

未完成：Phase 1 外层成功转场、两阶段入口与主线持久化链；BlackScreen 具体实例行为；LockAnim/所有 UI、着色器和声音逐帧对照；当前 4.x 官方包/谱面一致性。没有把这些缺口补成假交互。
