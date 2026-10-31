# Chapter 8 live stage effects

`js/chapter8-stage-effects.js` samples the music clock. It does not play a video, advance judgements, manufacture scores, attach input listeners or change canvas dimensions. It complements the native-rule coordinator and the separate Luminescence particle renderer.

## Recovered operations

The source is the locally recovered third-party modified 3.0.0.1 archive, its DF `AnimationDirector` data, `PostEffects/ESCContol`, `Chapter8/Grid` and `PostEffects/VignettePlus` shaders. It is not verified against current official 4.x.

- DF float-valued native animation tracks include exposure, saturation, contrast, grid parameters, vignette, noise and the 125.19999694824219–150 s countdown. The initial countdown value is 24.799999237060547 s. Sampling supports pause and backward seek without accumulating a second clock.
- Exposure, saturation and contrast use the recovered affine RGB formula, with the native luminance weights and average color. Negative contrast in the ending is preserved. A local SVG color matrix applies this operation to the existing canvas while preserving alpha and restoring its previous CSS filter on disposal.
- The original `FrameBase` grid texture is in `assets/chapter8/df-grid-native.png`. The WebGL fragment ports the recovered `VIEW_POS_ON` ring algebra, material colors and additive blend, including the source alpha-squared RGB contribution.
- The recovered VignettePlus noise hash/HSV adjustment, horizontal scanline function and radial darkening factor are rendered on an independent WebGL surface and composited onto the gameplay canvas in their native relative order.

## Performance and limits

These passes perform no main-canvas pixel readbacks and no main-canvas GPU texture uploads. Offscreen rendering starts at a maximum width of 480 or 720 px according to device core count. It reduces resolution after repeated slow frames; Canvas fallback provides approximate grid, scanline and vignette passes when WebGL is unavailable. Noise is unavailable in that fallback. Adaptive resolution changes the exact noise raster and ring sampling. The recovered grid projection uses a browser camera calibration; pixel identity with Unity is not established.

Bloom, radial blur, edge light, glitch, Unity HDR/color-space handling and the full original framebuffer chain are **not implemented by this module**. Their timeline parameters are retained for future work. This module does not establish complete original-game visual equivalence. The standalone preview is `tests/previews/chapter8-stage.html`.

## Validation

`node --test tests/chapter8-stage-effects.test.cjs` checks the countdown/inversion boundary, native color-operation order, pause/seek determinism, shared-canvas state restoration and exception cleanup. `tests/chapter8-stage-browser.cjs` checks actual WebGL output, original texture loading, source effect activation, color inversion in a screenshot, disposal and Canvas fallback in Chromium. This does not substitute for Safari/iOS device validation.
