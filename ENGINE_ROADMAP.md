# Driving-Game Engine Roadmap

Captures the next major phase of work, in priority/dependency order. Each item is its
own isolated pass — build it, measure it, don't bundle passes together. This mirrors the
approach in `PHYSICS_V2_PLAN.md` (transmission/steering v2): scaffolding first, tuning
against data second, no reactive constant-tweaking.

Guardrail carried over from that doc and from the recent `ControlState` pass: don't spend
time on Three.js/graphics cleanup or further input abstraction right now. The current
architecture (fixed-timestep physics + interpolation, `ControlState` input boundary) is
already sufficient to support this phase. The next real step is making the car and track
interact as physical/gameplay objects, not just a car driving over rendered geometry.

## Dependency order

```
TrackQuery → vehicle dynamics → performance tuning → deterministic telemetry/tests → off-road → racing/gameplay
```

Each arrow is a hard dependency: don't start an item until the one before it is done and
measured. (Automated telemetry/tests slot in after dynamics + tuning so there's a
meaningful, stable physics model to write regression tests against — but nothing stops
writing tests earlier for pieces that are already frozen, e.g. `ControlState`.)

---

## 1. Track-relative vehicle physics — `TrackQuery` API  ✅ DONE (Pass 1)

Add a clean `TrackQuery`/track-surface API: nearest point, tangent, curvature, lateral
offset, surface state (on-road / off-road).

**Goal:** make the car actually understand the road, not just its own kinematics.

**Why:** this unlocks off-track behavior, progress tracking, AI, curvature-aware speed,
racing lines, and better cameras. It's the biggest architectural gap in the current code
— `trackSpline.ts`/`trackWorld.ts` currently expose zero query surface, only flat
precomputed sample arrays consumed ad hoc by mesh-building and gas-station placement.

**Scope for this pass:** build the query API and wire it up as *observable telemetry*
only. Do **not** change vehicle dynamics behavior yet — that's item 2. Proving the API
works end-to-end (car's live distance-from-centerline, curvature, on/off-road state
visible in telemetry) is the right-sized deliverable before anything consumes it for
gameplay or physics.

**What was built:**
- `perpendicular()` moved from `graphics/trackMesh.ts` to `math/vector3.ts` — it's pure
  vector math and `trackQuery.ts` needed it too; kept `trackWorld.ts` (world layer) from
  reaching into `graphics/` to get it.
- `src/world/trackQuery.ts` (new): `TrackQuery.nearestPoint(position): TrackSurfaceSample`
  — brute-force nearest-sample scan per loop (samples are `TRACK_SAMPLE_SPACING` = 3m
  apart, low hundreds per track; fine at one query/physics-step, revisit only if profiling
  says otherwise), returning point/tangent/loopIndex/arcLength, signed `lateralOffset`
  (+ = left of tangent), unsigned `distance`, signed `curvature` (finite-difference of
  tangent angle over arc length; + = turning left), and `onRoad` (within `ROAD_WIDTH/2`).
- `TrackWorld` gained a `query: TrackQuery` field, built once per track in
  `buildTrackWorld` from the `SampledTrack` it already computes.
- `Game.presentFrame` queries `trackQuery.nearestPoint(player.position)` once per render
  frame and publishes `lateralOffsetM` / `trackCurvature` / `onRoad` on `Telemetry`;
  wired into the debug panel. No vehicle physics changed.

**Verified (dist-backed, node scripts against known geometry):**
- Oval track: point on straight centerline → `lateralOffset ≈ 0`; ±3m off centerline →
  `lateralOffset ≈ ∓3` (sign matches `perpendicular()`'s existing left/right convention
  used for road-ribbon rendering); circular-arc section → `|curvature| ≈ 0.0286 ≈ 1/35`,
  matching the arc's actual 35m radius analytically.
- Figure-eight (two independent loops): querying near each loop's own circle center
  resolves `loopIndex` 0 vs 1 correctly, confirming multi-loop nearest-point resolution.
- Far off-track point → `onRoad: false`, large `distance`.
- `npm run build` clean.

Left alone: `trackSpline.ts`/`trackDefinitions.ts` geometry generation untouched;
`TrackWorld`'s mesh/gameplay-data mixing (noted in the earlier `ControlState` pass) still
stands — not addressed here, still just future work.

## 2. Fix/upgrade the vehicle dynamics model  ⏳ IN PROGRESS (Pass 6 done)

Move beyond the current essentially kinematic bicycle model toward usable arcade vehicle
dynamics: acceleration/braking, lateral grip, weight-transfer feel, steering sensitivity,
speed-dependent behavior.

**Goal:** make high-speed driving feel convincing and controllable.

**Why:** the current desiredYaw → grip-cap model is good scaffolding, but it will
eventually limit driving feel more than graphics or engine architecture.

**Progress:** this item continues the numbered-pass sequence already underway in
`PHYSICS_V2_PLAN.md` rather than starting a separate doc — Pass 6 (friction circle:
braking/throttle now eats into cornering grip, continuously, replacing the old flat
`TIRE_GRIP / speed` cap) is done and verified there. That was also the clearest fix of
the "binary threshold" gap in the old model. See `PHYSICS_V2_PLAN.md` Pass 6 for the
full writeup and validation numbers.

**Still open for this item** (in the order that plan already lays out): Pass 7 —
handbrake reduces rear grip so the car actually rotates (arcade handbrake turn) instead
of just decelerating in a straight line; this needs a rear/front grip split, which is
also the natural home for weight-transfer feel. Speed-dependent steering sensitivity
and a surface-grip multiplier (for the future off-road pass, item 6) are noted as later
candidates in that doc too, not yet started.

## 3. Make speed/acceleration performance intentional

Revisit `ACCELERATION`, gear multipliers, torque curve, drag/top-speed falloff, and shift
points as one system.

**Goal:** a deliberate target for 0–60, 0–100, top speed, and acceleration through each
gear.

**Why:** stop tuning individual constants reactively — define the performance envelope
first, then tune the powertrain against it.

## 4. Separate simulation from presentation further

Keep `Player` as vehicle state/physics and progressively remove Three.js/render concerns
from it (constructor mesh setup, `syncVisuals`).

**Goal:** make vehicle simulation independently testable and reusable.

**Why:** `ControlState` (done) is the first good boundary; the next valuable one is
`VehicleState`/`VehicleSimulation` → renderer. Not on the critical dependency path below —
useful, but doesn't block anything; pick it up opportunistically rather than blocking the
physics-facing items on it.

## 5. Build automated physics telemetry/tests

Deterministic simulation tests for acceleration, braking, shifting, top speed, steering
radius, grip limits, and control transitions.

**Goal:** every physics change produces measurable before/after results.

**Why:** telemetry-driven transmission tuning is already the working method (see
`PHYSICS_V2_PLAN.md`'s dist-backed sim tables) — formalize it into repeatable tests before
more tuning makes the model harder to reason about. (Note: this repo currently has no
test framework — first sub-step here is picking a minimal one, or continuing the existing
dist-backed-sim-script approach if that's preferred.)

## 6. Add a proper road/off-road state

Once `TrackQuery` exists, determine whether the car is on-road, shoulder, or off-road and
apply appropriate grip/drag.

**Goal:** make leaving the track meaningful without requiring elaborate terrain.

**Why:** turns the track from scenery into gameplay.

## 7. Build gameplay systems on those primitives

Lap/progress tracking → checkpoints → AI opponents → traffic/hazards → race modes.

**Goal:** turn the driving sandbox into an actual game.

**Why:** these should consume the track/vehicle APIs rather than invent their own
geometry and physics.

---

## Status log

- 2026-08-04 — Roadmap written. Pass 1 (`TrackQuery` API) built, verified against known
  geometry, wired into telemetry/debug panel.
- 2026-08-04 — Item 2 (vehicle dynamics), Pass 6 (friction circle) done and verified —
  see `PHYSICS_V2_PLAN.md`. Next: Pass 7 (handbrake rear-grip rotation), or move on to
  item 3 (performance envelope) if Pass 7 needs more design time first.
