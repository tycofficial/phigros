Three.js 0.187.0, MIT (see LICENSE). Sources are the package's `build/three.core.js`,
`build/three.module.js`, and `examples/jsm/{loaders/GLTFLoader,utils/BufferGeometryUtils,utils/SkeletonUtils}.js`.
Bare `three` imports and sibling utility imports were rewritten to these local
files. Files were minified with esbuild 0.28.2 (`format: esm`, `target: es2022`,
`minify: true`, `legalComments: inline`); public exports are retained.
