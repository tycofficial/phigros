# 本轮复核记录 · 2026-10-30

本文中的 `evidence/`、`tools/` 和 `/workspace/` 是本地复核证据，不随可移植研究分支分发。其哈希、已知原始来源和恢复步骤在下面记录；纯 JavaScript 原型及测试可独立运行。此说明不把未分发的文件伪装成分支内附件。

## 来源和范围

已知来源：[SteveZMTstudios/Phigros-history 的 v3.0.0.1 发布](https://github.com/SteveZMTstudios/Phigros-history/releases/tag/v3.0.0.1)，发布标题为 `phigrOS_v3.0.0_crack`。这是第三方修改的历史 APK/存档，未与发行方提供的原始二进制对照；本记录不把目录名 `official-bundles` 当作来源或官方一致性证明。

本轮没有使用先前 agent 的结论作为代码证据。重新取得原生库、恢复元数据并反汇编后，才实现这个窄范围控制模型。

## 原始输入与恢复

本地 `/workspace/phigros-research-effects/sparse.apk` 仅保留部分资源和 ZIP central directory；其 `game.dat`、`libUnityPlugin.so`、`libil2cpp.so` 对应区段是稀疏空洞，直接读 entry 报 `Bad magic number for file header`，不能作为反汇编输入。

从已知 APK 地址只请求原生库所在的 21,275,217 字节区间：

```text
https://github.com/SteveZMTstudios/Phigros-history/releases/download/v3.0.0.1/Phigros_3.0.0.1.apk
Range: bytes=1356409103-1377684319
HTTP 206; Content-Range: bytes 1356409103-1377684319/1411717826
```

记录保存在 `evidence/native-download.json`。解压前核对 ZIP local header，解压后核对长度与 ZIP CRC32。没有下载整个 APK。

| 输入 | 字节数 | SHA-256 |
| --- | ---: | --- |
| ARM64 `libil2cpp.so` | 83,994,736 | `28ca6a2388618e0d92651afa4b9edcaf385903826bb5564ec0daabf0b4c41eb8` |
| ARM64 `libUnityPlugin.so` | 2,923,304 | `11b56970f3f157f244088c76ae37124eea9ca918b28a9b63555ffc9ff1383205` |
| 加密 `game.dat` | 12,721,264 | `01fd0e1c5a6e30359430a8ca2c8a7468ba949f41fe620cb686c92d3be5c9684e` |

`game.dat` 来自现有 `gamedata-v3.0.0.1.zip` → `com.PigeonGames.Phigros/覆盖/data.tar.zst` → `com.PigeonGames.Phigros/files/il2cpp/Metadata/game.dat`。`user.tar.zst` 内副本哈希相同；其 CRC32 `82026097` 也与该 APK central directory 的 `game.dat` 一致。

元数据恢复使用 [7aGiven/PhigrosMetadata](https://github.com/7aGiven/PhigrosMetadata) 本地提交 `bc800b303da12176fe866db6fa1c87ac0e54f90b` 的 `Main.java` / `IO.java`。1.2 发布 jar 内的 Main 仍为 ARM32，因此本轮以 jar 作为依赖，编译本地 ARM64 源码后运行，没有修改其算法：

```sh
java com.sun.tools.javac.Main -cp tools/metadata-tool.jar -d tools/metadata-classes \
  /workspace/phigros-metadata-tool/src/main/java/Main.java \
  /workspace/phigros-metadata-tool/src/main/java/IO.java
cd evidence
java -cp ../tools/metadata-classes:../tools/metadata-tool.jar Main metadata-input.apk
```

`metadata-input.apk` 只是把三项已核对输入放回工具预期路径的本地 ZIP。输出 `global-metadata.dat` 为 12,721,196 字节。随后运行 [Il2CppDumper 6.7.46 net6](https://github.com/Perfare/Il2CppDumper/releases/tag/v6.7.46)：

```sh
tools/dotnet/dotnet tools/il2cppdumper/Il2CppDumper.dll \
  evidence/libil2cpp.so evidence/global-metadata.dat evidence/dump
```

元数据版本 24.4，自动选择 IL2CPP 24.5；CodeRegistration `0x4bd2790`，MetadataRegistration `0x4c516c8`。`dump.cs`、`script.json` 和头文件生成完成；工具最后因重定向环境下的 `Console.ReadKey` 报错退出，日志保存在 `evidence/dumper.log`，该退出发生在所有文件生成之后。

主要输入及工具哈希见 `evidence/checksums.json`。原生库和工具仅保留在独立研究目录中，没有加入发布资源。

## 从 bundle 复核的配置

`/workspace/phigros-research-effects/official-bundles/1c13a4d74d41617f2f85a93b319ea68e.bundle` 中，MonoBehaviour path ID 为 `3058949334611908021`。本轮用 UnityPy 重新读取 typetree，核对已有 `LuminescenceLevelEffect.json`；配置副本保存在 `evidence/`。

| 字段 | 原始 float32 值 |
| --- | ---: |
| eventStartTime | 86.08699798583984 |
| eventEndTime | 96.52100372314453 |
| scoreCheckTime | 130.4340057373047 |
| startEffectTime | 130.5 |
| explosionTime | 133 |
| stopTime | 150 |
| ezTargetScore / hdTargetScore / inTargetScore | 744344 / 736919 / 853090 |

配置字段本身不能证明比较符号、乘数或分支行为。下面各项来自本轮恢复的原生代码。

## 从原生代码复核的行为

完整窄范围反汇编保存在 `evidence/luminescence-arm64.asm`，方法名称通过本轮 `script.json` 标注，字节来自 `libil2cpp.so`。`scripts/disassemble.py` 可重新生成。下表地址均为此历史 ARM64 ELF 的 RVA/VA，不能直接用于其他版本。

| 位置 | 已复核行为 |
| --- | --- |
| OnEnable `0x268f9e0`；目标设置 `0x2690018–0x2690090` | 按难度载入基准目标，执行 float32 乘法并写入 `_targetScore`。常量地址 `0x3eb9950`，字节 `1f856b3f`，值 `0.9200000166893005`。EZ / HD / IN 最终目标为 **684796.5 / 677965.5 / 784842.8125**。 |
| OnEnable `0x268fc98–0x268fd48` | 向 `ScoreControl.OnBad`（字段 `0x90`）和 `OnMiss`（`0x88`）加入回调。 |
| Update `0x2690620–0x2690648` | 将 `ProgressControl.nowTime` 与窗口开始、结束比较；含两端点，写入 `_eventStart`（`0xd2`）。 |
| 两个回调 `0x2690aa0`、`0x2690ab4` | **只读取最近一次 Update 缓存的 `_eventStart`**；为真时置 `_eventP1Failed`（`0xd0`）。回调本身没有时间戳参数，也没有读取当前时间。 |
| Update `0x269064c–0x2690688` | 首次 `nowTime >= scoreCheckTime` 时比较当前 `ScoreControl._score`（float32，字段 `0x38`）与 `_targetScore`；低于目标置第二阶段失败；随后置 `_checkEnd`，不再重新采样。 |
| Update `0x269068c–0x26907b0` | 两个失败标记均为假时，`nowTime > 130.5` 且 timeTag=0：播放 ShootUp、开始 HideUI 协程；`>133` 且 tag=1：播放 Explode；`>150` 且 tag=2：停止两粒子、StartPopMessage、开始 UnlockRetribution 协程。三个是连续 if，单次跳帧可依次触发全部。 |

因此“Bad/Miss 在窗口内失败”必须保留 **Update / 判定回调顺序**，不能给回调临时添加一个事件时间并假装等价。普通 JavaScript `Math.round` 后的分数也不能用来判定：IN 原始分数 `784842.75` 和目标 `784842.8125` 都显示成 `784843`，前者仍低于原生目标。

`ProgressControl.nowTime` 在本轮 dump 中声明为 float，偏移 `0x80`；`ScoreControl._score` 为 float，偏移 `0x38`。原型在入口转换为 float32。非有限输入是原型主动拒绝的非法测试输入，不声称该拒绝逻辑来自游戏。

## 实现边界及下一步缺口

本原型只实现 fresh component 的失败标记、首次分数采样、timeTag 和上述演出调用请求。原生 `UpdateEffectParam`、HideUI/AmbientPlay/UnlockRetribution 协程、消息内容、谱面游玩、分数生成、入口旋转、主线持久化、场景对象或摄像机错误路径均不属于这个模型。事件名和 `score-check` 记录是原型可观察输出，游戏并没有同名事件 API。

原生 UnlockRetribution 协程已被反汇编保存，但尚未完整核对它的等待、UI、保存与切歌分支；不能把请求协程等同于立即解锁。也未确认当前曲库谱面与历史谱面逐字段一致，音符数相同不证明位置和规则相同。

要接入主线与独立重演，仍需：明确版本的合法官方包及资源；对应谱面/二进制哈希；完整入口与协程规则；真实渲染和输入时序对照。不能将历史修改版规则接到当前 4.x 谱面后称为官方原版。本轮没有修改、发布或部署现有站点。

## 复核命令

```sh
cd /workspace/phigros-replay-prototype
npm test
/workspace/phigros-research-effects/.venv/bin/python scripts/verify-evidence.py
/workspace/phigros-research-effects/.venv/bin/python scripts/disassemble.py
```
