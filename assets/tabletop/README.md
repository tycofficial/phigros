# iPad Pro tabletop export

`ipad/` contains the tablet component extracted from the USDZ supplied for this
feature. The original screen mesh (including its actual curved corners), cameras,
bezels, body and buttons are retained. The separate Magic Keyboard and Apple
Pencil components are excluded. Source filename, SHA-256, selected component,
excluded components, screen dimensions and model hash are recorded in
`ipad/ipad.json`. The original packaging transform is removed using the display
plane; the tablet lies flat, with the glass facing +Y.

Reproduce with `python scripts/extract-tabletop-ipad.py INPUT.usdz`. This script
requires `usd-core` and `numpy`; the application does not require either.
Geometry is gzip-compressed for transfer. The original vertex data is recovered
before SHA-256 validation; rounded corners and source geometry are unchanged.

The renderer lazily imports the local Three.js bundle. The game's existing
offline session renders into a screen-sized canvas, used directly as the texture
of the original rounded screen. The existing MP4 worker receives composed frames
and unchanged stereo music / hit PCM at deterministic timestamps. OPFS keeps the
video bytes outside the JavaScript frame queue, which remains limited to two.

Contacts use real `noteJudgePointInto`, `touchCoordinatesMatchNote`, native
noise-area transforms and subtractive-mask parity. Fake notes are excluded;
coincident notes and Drag notes can share a physically valid contact, as in the
native judgement rules. Disconnected Hold routes use validated finger handoffs.
Animated movement uses absolute music time rather than integrated wall-clock
motion. Every contacted sample is checked before rendering. Unsupported charts
fail with an explicit time instead of silently drawing an invalid touch.

The continuous hand skin has 25 joints and 18,514 vertices per hand. Analytic
joint constraints preserve phalanx lengths and place reachable fingertips at
their planned contacts. The glass plane constrains skin vertices in both color
and depth passes. Palm proximity produces a raised passing trajectory.
Separate Tap notes retain separate presses. Eight independent playing fingers
are spaced using valid judgement-strip positions; thumbs remain in their rest
pose. Hand index/joint formats are packed losslessly, and smooth normals are
reconstructed from the unchanged indexed surface on load.

Validation is performed with Node unit tests, the real Desultory Signals AT 18
chart, full-song contact / joint sampling, and an actual browser MP4 export. This
does not substitute for testing on a physical iPad Safari device. Photorealistic
scanned hands and universal mesh-to-mesh collision proofs are outside the current
implementation.
