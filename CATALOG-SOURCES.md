# 曲库来源与覆盖范围

核对日期：2026-10-26。所有来源固定至下列提交；“4.0.1.2”是资源仓库 `info/version.txt` 的版本标记，不据此保证它是官方最新发行版，也不代表所有历史版本资源均在其中。

## 普通曲目、谱面与媒体

来源：[7aGiven/Phigros_Resource](https://github.com/7aGiven/Phigros_Resource)。各资源使用独立分支：

| 分支 | 固定提交 | 用途 |
| --- | --- | --- |
| info | `da34d1de07cd59b096ca0520b2815a2ea11cc13e` | 曲名、曲师、画师、谱师、定数、版本 |
| chart | `5d40bfdf05bee53f5107a6ea5620ca0e953de815` | 原生 JSON 谱面 |
| music | `5142ba2673ccbeb23173886f3bd851e9c881e6ec` | OGG 音乐 |
| illustration | `0c7e90ee5d8ffaaa756d79d8aef879338fdde423` | 曲绘 |
| illustrationLowRes | `931e2effc5bd2e33d547092afbb1ac012bd15161` | 小尺寸曲绘 |
| master | `ab455cff02dc48b08b1fb0f3120c31a1917d6ab3` | 来源说明、提取器及许可证 |

`info.tsv` 有 327 首曲目信息；`chart` 有 334 个目录、1057 份谱面：334 EZ、333 HD、333 IN、56 AT、1 SP。额外目录包括教程与 Random 的六个变体，不能把变体数直接作为不同歌曲数。该分支 SP 只有 Message。

主源 `gameInformation.py` 会跳过 `otherSongs`，并移除第五难度字段。因此单凭 `info.tsv` 或上述版本号无法证明收齐愚人节 SP。原生谱面的判定线运动、音符和 `blockAreaList` 是数据；它们不包含原版完整场景、过场动画或所有按曲名触发的程序演出。

新曲曲绘保留 `illustration` 分支实际原始 PNG，校验值记入完整曲绘索引；选歌缩略图仍来自小尺寸图。进入歌曲使用从原始 PNG 按原始像素尺寸生成的 JPEG 91 渐进式清晰图，不放大小图冒充高清；无损原 PNG 另保留供原图和导出使用。生成脚本为 `scripts/build-catalog-art.py`，不修改既有十二首内置曲绘。

## 章节与精选集

来源：[Catrong/phi-plugin](https://github.com/Catrong/phi-plugin/tree/6bb6fad1db8702d2c8d470930c31538581d16a31/resources/info)，固定提交 `6bb6fad1db8702d2c8d470930c31538581d16a31`。

- `infolist.json`：328 项逐曲章节、BPM、时长等信息。
- `chaplist.yaml`：主线、支线、外传及各精选集名称和别名。
- `spinfo.json`：历史特殊曲目、愚人节活动及曲绘变体说明。只有说明的项目不能标成已可玩谱面。

这些是社区整理的数据。按其中章节字段分组可以使精选集分开；它本身不构成已逐屏核对官方 4.0 页面排版、曲目顺序或解锁流程的证明。

## 已取得的历史 SP

来源：[FallingMY/phi-zone.github.io](https://github.com/FallingMY/phi-zone.github.io/tree/6254d6d4fa5765f32f475cfed1d78c50aac667f0)，固定提交 `6254d6d4fa5765f32f475cfed1d78c50aac667f0`。该仓库自己的总索引标记为 Phigros 2.1.0 / 2021-12-31，作为历史补充使用；不得用它覆盖当前普通曲目的全部信息。

以下八套均实际取得 `Chart_SP.json`、`info.json`、`music.ogg` 和 `illustration.jpg`：

| 源目录 | 曲目 | 原始谱面格式 | 音符数 |
| --- | --- | --- | --- |
| hidden/burn(haocore-mix) | Burn(Haocore Mix) | 3 | 1515 |
| hidden/christmas | Christmas | 1 | 177 |
| hidden/spasmodic(haocore-mix) | Spasmodic(Haocore Mix) | 3 | 2500 |
| hidden/wintercube-(original-mix) | Winter↑Cube↓ (Original mix) | 1 | 924 |
| single/dead-soul | Dead Soul SP | 3 | 564 |
| single/mopemope | もぺもぺ SP | 1 | 720 |
| single/rubbish-sorting | Rubbish Sorting SP | 3 | 416 |
| single/wavetapper | Wavetapper SP | 3 | 906 |

后四项是已有歌曲的 SP 难度。历史谱面可能需要历史音轨，不能仅凭曲名相同而假定与当前版音轨、偏移或时长完全一致。格式 1 的坐标与格式 3 不同，需由播放器正确转换后游玩。

## 代码许可证和资源署名

7aGiven 主分支及 Catrong 项目提供 GNU GPL v3，原始许可证完整保留在 `assets/meta/licenses/`。谱师、曲师、画师等署名应随曲目元数据保留。这里没有将提取器或模拟器的开源许可证表述为第三方音乐、原版美术、动画的统一授权；各作品版权归其权利人。FallingMY 固定提交的根目录未发现 LICENSE 文件，保留其仓库与原始曲目署名，不为其资源另造许可证。

本次没有将其他模拟器整套源码并入项目。可参考的社区课题实现为 [Adai-add/PhiraiAd](https://github.com/Adai-add/PhiraiAd/tree/a60b49ad30b4748327df9a5fae794278a3978520)，GPL-3.0-only；其 `phira/src/challenge.rs` 和 `prpr/src/judge.rs` 是社区实现参考，不是官方代码或官方一致性认证。

## 仍未验证或未取得的内容

本次检查的主源及历史补充并不包含所有历年愚人节资源。`spinfo.json` 中的 Oblivion:PHIN、Dlyrotz 超长名称 Remix、雪降り历史特殊曲，以及部分活动曲绘/演出等，不能因存在名称和活动说明就视为已经完整加入。应以实际构建出的曲库索引和可加载文件为准。

未取得第八章、第九章完整原版过场、交互事件脚本和全部意象动画资源，也未完成与官方客户端逐曲、逐帧和判定行为对照。检查过的 [sim-phi](https://github.com/lchzh3473/sim-phi)、[PhiZone/player](https://github.com/PhiZone/player)、[Phira](https://github.com/TeamFlos/phira)、[PhiCommunity](https://github.com/yuameshi/PhiCommunity) 是模拟器或同人项目，不能据其可运行推断原版全部演出齐全。

[AconHol/phigros-chapter9-web](https://github.com/AconHol/phigros-chapter9-web) 有可运行的第九章地图、曲绘和剧情界面，但明确有替代正文且不含完整游玩；[LyCecilion/Phigros_Chapter_9_ARG](https://github.com/LyCecilion/Phigros_Chapter_9_ARG) 的 `replay` 是外部 ARG 网页存档，不能冒充游戏内的“重演”。因此不能用占位动画、普通自动播放或 ARG 存档宣称已实现原版 1:1 重演。
