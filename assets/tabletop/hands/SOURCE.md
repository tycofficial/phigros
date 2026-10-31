The hand meshes originate from the `generic-hand` profile in
`@webxr-input-profiles/assets@1.0.20` (MIT; see LICENSE.md). The package's original
left/right meshes have been modified with two Loop subdivisions, welded geometric
seams, interpolated skin weights, and recalculated smooth normals. The original
25-joint skeleton and inverse bind matrices are retained.

Reproduce with `scripts/subdivide-tabletop-hands.py` against the package's
`dist/profiles/generic-hand/{left,right}.glb`. Joint poses, glass contact response,
materials and animation are implemented in `js/tabletop-hand.mjs`.

Three.js 0.187.0 and its GLTFLoader / geometry / skeleton helpers are distributed under
MIT in `js/vendor/three/LICENSE`. All export assets load from this repository;
there are no runtime CDN dependencies for the tabletop scene.
