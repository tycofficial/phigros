# Chapter 8 community effect timeline

`js/chapter8-community-effects.js` adapts the event keyframes, easing equations,
background dimming and countdown layout from PhiTogether's
[`SpecialChartsProcessor`](https://github.com/Team-PhiTogether/PhiTogether/tree/817fc3469f9d5120e53f260359cf87f718997cc1/src/components/renderer/renderers/sim-phi/plugins/SpecialChartsProcessor),
pinned commit `817fc3469f9d5120e53f260359cf87f718997cc1`. The upstream
software is licensed under AGPL-3.0; the complete license is supplied at
`assets/licenses/AGPL-3.0.txt`. The full corresponding source, including this
adaptation, is published at https://github.com/tycofficial/phigros.

Supported source charts are selected by their exact decompressed SHA-256,
corresponding to the upstream implementation's original MD5 whitelist:
Distorted Fate EZ/HD/IN and DESTRUCTION 3,2,1 IN. The renderer intentionally
does not simulate an application crash or stop the user's game. This is a
partial community approximation: PhiTogether's implementation references a
shader that is not present in the published repository; consequently the full
original filters, postprocessing and story/replay animation are not supplied.
Upstream's repository explicitly excludes multimedia assets from its software
license; no additional art, audio or game assets are copied here.

The native music-clock timelines are also applied to the exact pinned current DF AT and DESTRUCTION 3,2,1 EZ/HD/AT chart hashes. This extends the upstream chart whitelist; it does not claim upstream supplied or verified those difficulty mappings. Modified chart bytes are still rejected. DF countdown data is 125.2s:24.8 through 150s:0.
