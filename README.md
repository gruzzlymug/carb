# carb

A browser-based, Spy Hunter–inspired driving game with procedurally generated
tracks and a custom low-poly vector aesthetic, built with TypeScript and
Three.js (WebGL).

See [`driving-game-mvp-spec.md`](./driving-game-mvp-spec.md) for the original
project spec.

## Getting started

Requires Node (see `.nvmrc`).

```sh
npm install
npm run build   # compiles src/ -> dist/ via tsc
npm run serve   # serves the project at http://localhost:5500
```

Open `http://localhost:5500` in a browser. `npm run watch` recompiles on
file changes during development.

## Controls

- **W** — throttle
- **S** — brake / reverse (automatic transmission)
- **A / D** — steer
- **Space** — handbrake
- **Q / E** — shift down / up (manual transmission)
- **R** — reset to the track's start

A debug panel (top right) lets you switch tracks, camera type, and
transmission mode, and toggle the controls overlay / engine sound.

## Architecture

No bundler — TypeScript compiles directly to native ES modules, with `three`
and `lil-gui` resolved at runtime via an import map in `index.html` (pinned
to the versions in `package.json`).

- `src/graphics/` — procedural mesh builders (car, wheels, gas station,
  track ribbon) and the `Mesh` → `THREE.BufferGeometry` conversion.
- `src/world/` — track definitions (spline control points), spline
  sampling, and per-track world assembly. Render-agnostic.
- `src/engine/` — the game loop, cameras, renderer, input, HUD, and
  debug panel.
- `src/entities/` — the player car and gas stations.
- `src/util/` — centralized tuning constants and small shared settings
  objects the debug panel binds to live.
