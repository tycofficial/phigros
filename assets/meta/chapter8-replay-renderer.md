# Luminescence scene renderer

`js/chapter8-replay-visuals.js` reconstructs a live, clock-driven particle scene. There is no video, animation timer, score producer, judgement hook, unlock writer, input listener or global Canvas mutation in the renderer.

## Integration

```js
const renderer = PhiChapter8ReplayVisuals.create(gameCanvas, {
  // Keep false for a shared gameplay canvas; true is for a dedicated visual canvas.
  clear: false,
  background: true,
});
await renderer.ready; // Optional: textures load immediately on construction.
// Call after drawing the background and before drawing judgement lines / notes.
renderer.sample({time: musicTime, phase: 'luminescence', branch: actualPassed ? 'success' : 'failed', width, height});
renderer.dispose();
```

The instance has `sample`, `ready`, `reset(seed)`, `dispose` and a read-only `stats` snapshot. `sample` returns its reusable statistics object. The host owns the clock and outcome. Pending/unknown/failed branches emit no success particles. A backward seek is a direct resample, and pause repeats the same music position. Stop at 150 s stops emission; already living particles expire naturally by 155 s. No frame delta is accumulated. `decorative: true` sets `pointer-events: none` only when the host explicitly marks a dedicated Canvas decorative; default construction never changes input behavior.

Canvas transforms, alpha, blend, fill, shadow and filter state are protected by `save` and `finally restore`, including exceptions. Rendering is clipped by any existing host clip. Main Canvas dimensions are never changed. WebGL work happens on a separate offscreen surface and is composited additively. Supply `{forceCanvas:true}` to exercise the Canvas fallback.

## Source and implemented operations

The local research source is `phigros-research-effects/official-bundles/1c13a4d74d41617f2f85a93b319ea68e.bundle`, obtained from a third-party modified 3.0.0.1 archive. It is not authenticated current official 4.x. Exact SHA-256 fingerprints for the extracted JSON, mask and shader are embedded in `PhiChapter8ReplayVisuals.metadata.sourceSHA256`.

- Original 203 vertices, normals, UVs and 1,032 indices (344 triangles) of the shared sphere/cube mesh are embedded; no replacement mesh is invented.
- Original `CubeSphereMask`, `DefaultParticle` and `LightSpot` textures are included under distinct new filenames in `assets/chapter8/` (77,757 bytes total).
- SphereCube has two GPU passes using the recovered material's edge 0.158, edge alpha 0.075, body alpha 0.269, glow size -4.2, smoothing 0.918 and glow brightness 1.15. The original mask discard, normal facing smoothstep, normal expansion, front culling and SrcAlpha/One RGB addition are ported. Source mesh normals face inward on the sphere; the browser winding is explicitly set for Unity's handedness. The explosion emitter lacks SizeX in its original stream, so it has no SizeX glow expansion.
- ShootUp rate 2/s, 4–5 s lifetime, size 0.05–0.2, 27.8 × 1.94 × 2.24 box, velocity-over-life, 3-axis rotation and trail feed its SubTail child at 5/s. Color and start size inheritance are implemented.
- Explode rate 1.5/s, 1–2 s lifetime, size 1.5, 30.1 × 1.93 × 5.77 box and weighted size curve feed a burst of 50 SubSpark particles per emitted parent. Spark lifetime 2.5–3.5 s, speed 5–10, cone 25°, gravity, velocity-over-life, size, rotation and native trail gradients are implemented. SubTail cone 8.18°, size/lifetime curve, inherited size/color and gravity are implemented.
- Weighted Unity AnimationCurve tangent handles are solved as parametric Bezier segments; velocity integrals are tabulated once using Simpson integration. The renderer samples absolute particle age. Native looping start-color gradients, emitter intervals and child inheritance are retained.
- Recovered Canvas reference height 600, anchor/position -104.62 for ShootUp and +438 for Explode determine emitter origins. Native black background opacity keys are sampled; the success-only second event starts at 130.5, explosion emitter at 133 and stop emission at 150.

## Explicit limits

This port does not claim identical Unity RNG, sub-emitter simulation ordering or exact original lens. Main camera data is not in the recovered scene bundle; the default orthographic world height 18.75 is a browser calibration and can be overridden with `camera: {worldHeight, distance}`. The Canvas fallback uses the same sampled particles, original mesh and mask samples, with approximate triangle opacity/trail rasterization; its GPU glow fragment stage is unavailable. Unity postprocessing, light-space/color-space treatment and HDR tone mapping are not reconstructed here. The native spark trail vertex-distance simplification is bounded by a small sampled polyline. These are live engine ports of recovered operations, not evidence of full visual equivalence or current-version authenticity.

This module currently supports Luminescence only. The Chariot, Retribution phase geometry and later scenes need their own source scene/shader ports; do not label this module a complete chapter-eight original renderer.

## Performance and verification

Low memory/core devices begin at 0.65 quality; children use a stable particle cap and trails use fewer segments. The offscreen surface is capped at 960 or 1,440 pixels on its largest side and quality decreases when a draw exceeds 12 ms. A pending quality change applies only after the music position changes, so paused frames keep their resolution; `adaptiveQuality: false` fixes quality for image comparisons. Parent mesh emission is retained at every quality. The module never allocates a full-screen postprocessing framebuffer chain or listens to input.

`node --test tests/chapter8-replay-visuals.test.cjs` verifies emission rates, branch gates, stop/lifetime behavior, weighted curves, deterministic seeking, pause sampling, provenance and Canvas restoration on normal and thrown paths. `tests/chapter8-replay-browser.cjs` verifies real WebGL compilation, original texture loading, visible output, absence of failed-branch pixels, seek/pause behavior and Canvas fallback in Chromium. The interactive preview is `tests/previews/chapter8-replay.html`.
