# 第八章重演控制与来源

`js/chapter8-replay-rules.js` 是浏览器纯控制模块；不会写游戏存档。来源是重新恢复元数据并反汇编的第三方修改历史 **3.0.0.1** ARM64 库，不能据此声称与现行官方 4.x 完全一致。核心原生库 SHA-256：`28ca6a2388618e0d92651afa4b9edcaf385903826bb5564ec0daabf0b4c41eb8`。本地完整证据位于独立研究目录 `phigros-replay-prototype`，发布资源不包含库、APK 或元数据。

## 已核对的直接控制链

| 入口 | 原生控制与后续 |
| --- | --- |
| The Chariot | `Update` 0x28e80e4，首次 time >=145.5 采样原始分数 >=920000 后隐藏 UI、自动消息和环境音；`UnlockRetribution` 协程 0x28e8ae8 最终给 Retribution 加入 `HPDisplay` + `RetributionEffect`，2 秒黑屏进入关卡，即 **phase 1**。 |
| Luminescence | 原生 `Update` 0x26905c4，86.087–96.521 两端含入窗口的 Bad/Miss 失败；首次 time >=130.434 比较 float32 原始分数；两个失败标记都为假才依次在 >130.5、>133、>150 触发演出。`UnlockRetribution` 0x26911c0 最终加入 `RetributionEffectSecondPhase`，即 **phase 2**。 |
| Retribution phase 1 | HP 耗尽触发 redFlash、1 秒音量淡出、1.5 秒后回调；回调 0x21f8908 补剩余 Miss、更新记录，再 `BlackScreen.Show("321Unlock",2)`。0x21f8b18 的间接字符串指针 0x4c8d9a8 经 ELF 映射解出 **321Unlock**。它是章节推进，不应误写成普通失败。141.4737 不是固定成功分支。 |
| 321Unlock | `D321UnlockControl.<Start>.MoveNext` 0x235b2bc 等准备、播放、实际播放状态，再等停止；视频 time >=11.56666666 显示歌曲信息；停止后黑屏 2 秒进入带 `Destruction321LevelEffect` 的 DESTRUCTION 3,2,1。 |
| Retribution phase 2 | `Update` 0x21f932c：time >101.68419647216797 先锁定并跳过该帧 HP 死亡；后续停止 HP 计算。音频时间 >长度-6.5 时递减 1.8 秒 outro，outro==0 且实际音频停止时进入 **DFUnlock**。HP 耗尽则 1.5 秒后回 Loading。 |
| DFUnlock | Start 协程 0x235d370：准备两个视频，等 3 秒，播放 Touch2Start，time>=1.5 暂停待输入。`StartAnimation` 0x235cb78 也检查 time>=1.5。手势触发的协程 0x235d930 把 touch 视频 seek 到 **2.066** 后播放；末尾 0.5 秒黑幕，实际停止后等 **0.2** 秒，准备主视频、播放、time>=0.005 解除黑幕，time>=**26.8** 显示歌曲信息；末尾 0.5 秒黑幕，实际停止后再黑屏 2 秒进入带 `DFLevelEffect` 的 **Distorted Fate**。 |
| Distorted Fate 结束 | `DFLevelEffect.Update` 0x235bd44 确认原音频停止后更新歌曲记录；IN 结算分数 >=920000 时写 `DistortedFateINSGrade`。0x235c304–328 明确调用 **BlackScreen.Show("QDEvent",4)**，不是普通分数结算。 |
| QDEvent | `QDEventControl.<Start>.MoveNext` 0x21f65f0：准备原 `QD` 视频，等待实际播放和 time>=.005 后撤黑幕并开始字幕协程。先等 time>=视频长度-.5，再等 time>=21.15，随后开始一条原生自动消息。消息结束后背景声淡出 2 秒、等待 2 秒，最后 **BlackScreen.Show("AboutUs",.5)**。视频播放器的原 `m_Looping=false`，实际 MP4 长度 24.066667 秒。 |
| AboutUs | 原 `level21` 的 Button pathID89.OnClick 为 **StartPlay**，该方法要求场景已运行 >=1 秒才开始滚动。滚动 321 秒，音乐在 >127 秒切第二段，>321 秒停止，>327 秒自动 Back。Back（0x22d25b0）首次通关时置 `chapter8Passed`、`C8DistortedFateUnlocked`，随后 .66 秒过场到 BootScene，目标章节选择；已通关时经 Loading 返回。网页将相同退出意图映射为返回选曲，不写主线存档。 |

## 协程与输入细节

Luminescence 与 Chariot 的消息是自动推进，不是点按对话。`Ch8Effect.MessageController.PopMessage` 0x22dd824 先等 1 秒，再为各条消息随机等待 4.5–6.5 秒。第二条消息的 `OnMessageShow` 回调开始 `Ambient_Retri` 音频并在 1 秒内淡入。解锁协程等待该音频 float32 time 转 double 后 >=14.7，再按原生 .2/.1/.5/.1/.5/.1 秒等待执行 glitch 闪烁，等音频实际结束，再等 .5 秒；随后黑屏 2 秒切歌。Lumi 另外有 1 秒 UI 淡出协程；phase 2 的 LockAnim 时长 1 秒，原生透明度由所导出动画曲线驱动，规则模块提供 lockProgress，实际渲染由宿主管理。

QDEvent 的字幕协程（0x21f6014）在视频时钟 14.4、15.85、18.4、20.15、21.9 秒分别显示以下原文，每条等待 1 秒后清除：`...九....鸟..`、`...鸠...!`、`......喂？`、`...听得到吗？`、`鸠？！`。原自动消息为 `O Fortuna velut luna statu variabilis……`。字幕、消息和背景声分别由独立事件处理。最后一条消息等待结束后还有 .5 秒隐藏动画，才置原 messageEnd。

AboutUs 的原制作人员文字、双列曲目名单、字号、对齐、位置与 footer 已从 level21 导出到 `assets/vision-replay/chapter8-about-us.json`。原 `sharedassets21.assets` 的 AnimationClip pathID3 是 `skip`：0–.05 秒透明度从 0 线性到 .4，.05–.5 秒保持 .4，.5–1.5 秒线性到 1。按住时透明度 **>.9900000095367432** 调用 Back；松手后 normalizedTime >.33000001311302185 时速度设为 -6，否则 -1。模块按该曲线计算 `skipOpacity`，不使用凭空设定的长按秒数。

DESTRUCTION 3,2,1 在 `time >156.14999389648438` 开始原 `DestructAnimation(4)`：pitch=.75，约 .03125 秒音频短片段循环与跳时，4 秒后停止，写章节第二阶段相关标记并弹出原文对话：标题“PhigrOS已崩溃”、正文“模拟结束，谢谢你的参与。”、按钮“好”。该按钮回调 0x235eedc 的直接调用是 **UnityEngine.Application.Quit**。网页保留原对话和确认，之后返回选曲，并在事件中标 `nativeAction:"Application.Quit"`；不把浏览器返回选曲冒称成原应用行为。协程有逐帧与 WaitForSeconds 调度，宿主负责音频短片段的实际重放，控制模块的 `audio-stutter` 提供原参数。

`judge(kind,time?)` 中 Lumi 使用最近 `Update` 缓存的窗口，故忽略额外 time；Retribution 回调原生读取当前 ProgressControl 时间，宿主应传实际判定时钟作为第二参数。两阶段 HP 参数、溢出修正和 double 运算顺序来自已恢复 native；`rawScore` 单独实现普通计分模式每步 float32 的 900000 准确度项与 100000 最大连击项，避免使用四舍五入后的显示分数。

音频 PCM/WAV 是通过 UnityPy 从上述 bundle 内 FSB 音频解码，保留全部采样；可选 m4a 为 AAC64k 衍生文件。各 pathID、字节数、采样数、哈希见 `assets/vision-replay/chapter8-audio-provenance.json`。原 `Ambient_Retri` 715267 帧 / 44100 Hz =16.2192063492 秒；原消息背景 15 秒；消息音效 1 秒。视频原时长分别 3.1666667 秒和 47 秒。

原消息背景 AudioSource 初始音量 0、Loop=true；PopMessage 最初 1 秒等待结束后才启动背景声，AmbientPlay 在 1 秒内将其从 0 淡入至 1。对应事件为 `message-ambient-play {fadeIn:1,volume:1,loop:true}`，不是在 `messages-start` 时立即播放。Message 单次音效原音量 .5，Ambient_Retri 原音量 1、Loop=false。`messages-end` 不停止背景声；QD 的 `message-ambient-stop {duration:2}` 才请求结束淡出。

## 浏览器接入

```js
const c = PhiChapter8ReplayRules.createController('df-unlock', 'IN');
const events = c.update({deltaTime, time, rawScore, audioTime, audioPlaying,
  clipLength, ambientTime, ambientPlaying, videoTime, videoPlaying,
  videoDuration, videoPrepared}); // 全部时间单位为秒
c.judge('Perfect', judgementSongTime);
c.input('touch'); // 仅在触屏等待阶段消费；返回 seek-video + play-clip
c.input('exit');
c.finish();
c.snapshot();
```

每个方法直接返回事件数组，没有 drain。`scene` 会在同一 controller 内切换原生演出；`next-song` 要求宿主按 songKey/difficulty/phase 重建 controller 并启动正常可玩的谱面。`play-clip` 的 clip 为 `DF_Touch2Start`、`DF_Unlock`、`321_Unlock`；重复同 clip 的 seek/play 应复用已经下载的资源。宿主必须持续处理视频/环境音结束后的帧，不能在谱面结束时直接停止控制器。

曲内结束的调用为 `finish({score,rawScore,...})`；Distorted Fate 会继续 QDEvent，不能直接显示分数页。新增 `QD` clip、`subtitle`、`message`、`message-hide`、`message-ambient-stop`、`dialog`、`credits-start`、`credits-audio(track:0|1)`、`credits-audio-stop`、`credits-exit` 和 `return-selection` 事件。AboutUs 开始使用 `input('touch')`/`input('start')`，长按使用 `hold-start`/`hold-end`，显式返回为 `back`；321 原对话使用 `confirm`。快照的 `creditsProgress`、`creditsTime`、`skipOpacity`、`subtitle` 供原场景绘制。

## 章节存档与版本边界

`chapter8UnlockBegin` 在 Chapter8SelectMusicControl.Start 置真；`chapter8UnlockSecondPhase` 在 Destruction321LevelEffect 的完成协程置真，同时置 `C8TheChariotREVIIVALUnlocked`、`C8RetributionUnlocked`、`C8DESTRUCTION321Unlocked`；Lumi 结束写 `C8LuminescenceUnlocked`；AboutUs Back 才置最后两个通关标记。规则模块发 `chapter-flag` 观察事件并标 `persist:false`，不借主线存档绕过重演，也没有把不明的 `debug` 字符串假设成官方“意象重演”开关。本历史版本的可恢复字符串中没有“意象重演”入口，对现版开关位置不作断言。

当前实现的重点是上述原生入口、分数与 HP 分支、触屏门槛、切歌和原生章节后续。它不实现所有 UI/着色器逐像素还原，也未证明当前站点谱面与历史谱面逐字段一致。规则与渲染、音频引擎保持明确边界；当前版本一致性和逐帧数值差分仍是验证限制。

验证：`node --test tests/chapter8-replay-rules.test.cjs` 覆盖 23 项边界、两 HP 阶段的不同去向、原始分数、完整触屏和双视频切歌、QD 字幕与消息、制作人员开始/切曲/长按松手/自动返回、原崩溃确认、重入与退出。

普通游玩：关闭独立章节重演时，内置 Luminescence EZ/HD/IN 也使用同一原生条件控制器驱动烟花和 HUD；宿主不消费其章节跳转、对话或存档事件，保留普通结算。重开和练习回退重新创建条件控制器。

网页 AT 直入：DF 与 321 保留实际选择的 AT 谱面及歌曲信息；历史控制模块只验证过 EZ/HD/IN，因此过场控制仍沿用已验证的 IN 配置，不据此声称现版 AT 控制逐帧等同。
