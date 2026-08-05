# Driving-Game Engine Roadmap

The single backlog for engine/physics work — supersedes the old, separate
`PHYSICS_V2_PLAN.md` (folded in below; that doc predated this one and having two
overlapping backlogs with different numbering was a mistake). Captures the next major
phase of work in priority/dependency order. Each item is its own isolated pass — build
it, measure it, don't bundle passes together.

Guardrail: don't spend time on Three.js/graphics cleanup or further input abstraction
right now. The current architecture (fixed-timestep physics + interpolation,
`ControlState` input boundary) is already sufficient to support this phase. The next
real step is making the car and track interact as physical/gameplay objects, not just a
car driving over rendered geometry.

Guardrails carried forward from the original transmission/steering feedback (still
binding unless a later note says otherwise):
- Keep `GEAR_RATIOS = [3.0, 1.95, 1.38, 0.98, 0.60]` for now.
- Do **not** change `ENGINE_TORQUE_CURVE` — the aggressive redline cliff is currently
  useful (clear "out of breath", underpins the 152 mph top speed). Revisit only after data.
- `this.rpm` is **display/audio RPM**; `rpmForGear(gear, speed)` is **drivetrain RPM**.
  Physics uses drivetrain RPM; the shift blend only smooths display/audio. Don't merge them.
- Manual mode keeps the "aggressive downshift screams past redline" behavior. Automatic
  must **never** intentionally overspeed the engine.
- Change the smallest relevant variable per pass; measure (dist-backed sim against the
  actual compiled classes, not a reimplementation) before/after; don't bundle changes.

## Dependency order

```
TrackQuery → vehicle dynamics (structural) → sim/presentation split → automated tests → off-road → racing/gameplay
```

Feature/architecture work now takes priority over feel-tuning: numeric tuning items
(performance envelope, remaining steering/grip feel passes, track-geometry resize) are
set aside in the **Tuning backlog** at the end of this doc and picked up after the
feature-work items above are done, not interleaved with them. Each arrow above is a
hard dependency: don't start an item until the one before it is done and measured.

---

## Foundation (done, pre-dates this roadmap)

- **Fixed-step physics, decoupled from rendering** — physics runs at a fixed 120 Hz via
  an accumulator, independent of the variable render rate; the render loop draws an
  interpolated pose between the last two physics states (`PHYSICS_HZ`/`PHYSICS_DT`/
  `MAX_FRAME_SECONDS` in `constants.ts`; `Player.syncVisuals(alpha)` blends
  position/heading/wheel angle; `Player.update` never touches Three.js). Timestep
  convergence was measured: 60 Hz gives <0.5% error on turn radius, 120 Hz ~0.1–0.2%,
  240/300 Hz negligibly better — 120 Hz is sufficient. Every item below assumes and must
  preserve this.
- **`ControlState` input boundary** — `Player.update(dt, controls: ControlState)` depends
  only on that struct, not on `Input`/key names.
- **Transmission telemetry tooling** — per-frame engine torque, gear multiplier,
  longitudinal accel, wheel-steer angle, yaw rate, lateral accel, and grip-limited state
  are exposed from `Player` and surfaced in the debug panel. This is the measurement
  method every pass below uses (dist-backed sim scripts driving the real compiled
  classes) — formalizing it into repeatable tests is item 5.
- **Automatic transmission: kickdown + safe downshift** — `automaticGearFor` drops a
  gear under throttle when it's off the useful power band and doing so wouldn't overspeed
  the engine (`AUTOMATIC_KICKDOWN_RPM`/`AUTOMATIC_KICKDOWN_MIN_GAIN`/
  `AUTOMATIC_MAX_DOWNSHIFT_RPM`). Verified: no gear hunting, manual mode unaffected,
  automatic never downshifts into an over-redline RPM.
- **Shift quality: upshift torque interruption** — a ~55 ms torque dip
  (`SHIFT_TORQUE_CUT_MS`/`SHIFT_TORQUE_CUT_FACTOR`) on upshifts only, so a shift reads as
  "scream → shift → tiny thump → power back" instead of an instant accel jump.
  Steady-state pull after the window is unchanged (verified: post-shift accel matches
  pre-pass numbers; top speed/0-60 unchanged).
- **Torque curve: parked.** The surge/drop/surge across gears and the 140→152 mph "runs
  out of breath" are the gearing working as intended — no change without a specific
  reason from later data (see item 3).

---

## 1. Track-relative vehicle physics — `TrackQuery` API  ✅ DONE

Add a clean `TrackQuery`/track-surface API: nearest point, tangent, curvature, lateral
offset, surface state (on-road / off-road).

**Goal:** make the car actually understand the road, not just its own kinematics.

**Why:** this unlocks off-track behavior, progress tracking, AI, curvature-aware speed,
racing lines, and better cameras. It's the biggest architectural gap in the current code
— `trackSpline.ts`/`trackWorld.ts` currently expose zero query surface, only flat
precomputed sample arrays consumed ad hoc by mesh-building and gas-station placement.

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
  wired into the debug panel. No vehicle physics changed this pass.

**Verified (dist-backed, node scripts against known geometry):**
- Oval track: point on straight centerline → `lateralOffset ≈ 0`; ±3m off centerline →
  `lateralOffset ≈ ∓3` (sign matches `perpendicular()`'s existing left/right convention
  used for road-ribbon rendering); circular-arc section → `|curvature| ≈ 0.0286 ≈ 1/35`,
  matching the arc's actual 35m radius analytically.
- Figure-eight (two independent loops): querying near each loop's own circle center
  resolves `loopIndex` 0 vs 1 correctly, confirming multi-loop nearest-point resolution.
- Far off-track point → `onRoad: false`, large `distance`.

Left alone: `trackSpline.ts`/`trackDefinitions.ts` geometry generation untouched;
`TrackWorld`'s mesh/gameplay-data mixing (noted in the `ControlState` pass) still
stands — future work, not addressed here.

**Known gap surfaced but not yet scheduled (see Tuning backlog):** the three
hand-authored tracks (rounded rectangle, oval, figure-eight) were sized for a much
slower car and don't match the current 152 mph / 1.6g envelope:
- Corner radii are far too tight: max grip-limited corner speed = `sqrt(radius × TIRE_GRIP)`
  → rounded-rect (22m) ~42 mph, oval (35m) ~53 mph, figure-eight (45m) ~60 mph. Above
  those the car understeers off.
- Straights are too short to reach top speed: rounded-rect long straight ~96m, oval
  ~180m; reaching 150+ mph needs ~600–900m.
- `ROAD_WIDTH = 10m` leaves little margin once understeering at speed.

This is track **content** work, not a TrackQuery API gap, and it's tuning-adjacent —
it can't be sized correctly until the performance envelope (Tuning backlog) is final.
Design formula for later: `minCornerRadius(speed) = speed² / TIRE_GRIP` (targets:
100 mph → 125m, 130 mph → 211m, 150 mph → 281m radius).

## 2. Fix/upgrade the vehicle dynamics model  ⏳ IN PROGRESS

Move beyond the current essentially kinematic bicycle model toward usable arcade vehicle
dynamics: acceleration/braking, lateral grip, weight-transfer feel, steering sensitivity,
speed-dependent behavior.

**Goal:** make high-speed driving feel convincing and controllable.

**Why:** the current desiredYaw → grip-cap model is good scaffolding, but it will
eventually limit driving feel more than graphics or engine architecture.

**Done so far, in order:**

1. **Steering validation (no code change)** — measured full-lock cornering across speed
   on the real model: constant 1.63g above ~15 mph, radius grows as `v²/grip` →
   3/11/25/45/101/180/281m at 15/30/45/60/90/120/150 mph. Clean, consistent progression;
   confirmed the bicycle-model geometry itself didn't need changing. Produced the
   min-radius-per-speed target table used above for track sizing.
2. **Turn-in feel + limiter diagnostics** — `WHEEL_STEER_SMOOTH_PER_SEC` 16 → 28 (faster
   turn-in, doesn't change max cornering). Added `steeringLimit` telemetry
   (`"grip"`/`"steering"`/`"none"`) and live turn-radius readout, so it's now observable
   whether a corner is limited by tire grip or by steering-angle geometry. Confirmed:
   steering-limited only below ~18 mph; grip-limited (1.63g) at all real corner speeds.
3. **Friction-circle cornering grip** — replaced the flat `maxYaw = TIRE_GRIP / speed`
   cap with `availableLateral = sqrt(max(0, TIRE_GRIP² − longAccel²))`, using this
   step's actual longitudinal acceleration (measured right after the throttle/brake/
   friction block, same physics step, no lag). Braking or accelerating hard now
   continuously eats into cornering grip — this was also the clearest "binary
   threshold" violation in the old model (cornering capacity was totally independent of
   longitudinal load). At `longAccel = 0` this is identical to the old flat cap, so
   steady-speed cornering is unchanged.
   - Verified by driving the compiled `Player`: coasting friction (≈−6 m/s²) yields
     `sqrt(16²−6²) ≈ 14.83 m/s²` lateral grip at every speed 30–150 mph, matching the
     formula exactly; full brake (−20, exceeding `TIRE_GRIP`) zeroes cornering capacity
     entirely — full-lock steering produces zero yaw, `steeringLimit` reports `"grip"`.
     This is the brake-then-turn behavior the pass exists to create.
   - **Expected side effect, not a regression:** ordinary engine-braking friction now
     also counts against the circle (not just active braking), so steady coasting through
     a corner is ~7% less grippy than before (14.83 vs. the old flat 16 m/s²). If that
     reads as "looser than before even off the brakes" in-browser, that's this.

4. **Handbrake rear-grip rotation (slip/drift state)** — the model had no way for the
   car's direction of travel to differ from its nose direction at all; position always
   integrated exactly along `heading`. Added `velocityHeading` (direction of travel,
   separate from `heading`, the nose direction) to `Player`; position now integrates
   along `velocityHeading` instead of `heading`. Off the handbrake, `velocityHeading`
   chases `heading` — normally instantly (see the epsilon-snap note below), so nothing
   about existing driving changes. While the handbrake is held: (a) cornering is no
   longer limited by the friction circle at all — yaw is driven almost directly by
   steering geometry, up to a bounded `HANDBRAKE_MAX_YAW_RATE` (a stability cap, not a
   tire limit, so extreme-speed handbrake+full-lock spins hard but doesn't blow up
   numerically); (b) `velocityHeading`'s chase rate drops way down
   (`SLIP_HOLD_PER_SEC`), so the nose can swing ahead of the momentum — that gap is the
   slide, exposed as `driftAngleDeg`/`isDrifting` telemetry. Releasing the handbrake
   speeds the chase back up (`SLIP_RECOVERY_PER_SEC`) so the slide visibly "catches"
   instead of popping straight.
   - **Correctness subtlety caught during verification:** a naive continuous
     blend-toward-`heading`, even at a fast rate, has a small nonzero *steady-state* lag
     whenever `heading` is continuously rotating — i.e. it would have introduced a
     permanent ~1–2° drift angle during ordinary sustained cornering that never touched
     the handbrake, a real (if small) regression. Fixed with
     `SLIP_CATCH_EPSILON_RAD` (~1.1°): below that residual, the recovery snaps exactly
     to `heading` instead of asymptotically approaching it. Normal grip-limited
     steering's per-step heading change always falls under that threshold, so it snaps
     every step and never accumulates lag; only an actual handbrake slide's much larger
     offset takes the blended path, and only while decaying through its last ~1°.
   - Verified (dist-backed, driving the compiled `Player`): sustained full-lock
     cornering at 30/60/90/120 mph with the handbrake never touched → `driftAngleDeg`
     exactly `0.000000` at every speed (confirms zero regression to already-tuned
     cornering). Handbrake + full steering at 40 mph → ~30° slide develops in 0.5s;
     releasing it decays to ~6° in 83ms and snaps to exactly 0 by ~420ms (gradual catch,
     not a pop). Handbrake + full-lock at 150 mph → yaw rate cleanly pins at the
     `HANDBRAKE_MAX_YAW_RATE` bound (~200°/s), no blowup. Handbrake with no steering
     input → zero yaw, zero drift (pure deceleration, as before). Position-path check: a
     0.5s handbrake+steer at 40 mph rotates the nose 71° while the car's actual travel
     direction only shifts 9° — the real signature of a slide, not just faster turning.
   - `angleDelta` (smallest signed angle) extracted from `trackQuery.ts` into
     `math/vector3.ts` as a shared util, now used by both.

Remaining feel-tuning candidates for this item (speed-dependent steering sensitivity,
weight-transfer feel, `TIRE_GRIP` tuning) are moved to the **Tuning backlog** at the end
of this doc — the structural capability (friction circle, handbrake slip state) is done;
what's left is refinement, not new capability, so it waits until the feature-work items
below are done.

## 3. Separate simulation from presentation further  ✅ DONE

Keep `Player` as vehicle state/physics and progressively remove Three.js/render concerns
from it (constructor mesh setup, `syncVisuals`).

**Goal:** make vehicle simulation independently testable and reusable.

**Why:** `ControlState` (done) is the first good boundary; the next valuable one is
`VehicleState`/`VehicleSimulation` → renderer.

**What was built:**
- `src/entities/playerView.ts` (new): `PlayerView` owns `object3D`, the wheel meshes,
  and construction (`createCar`/`createWheel`/`WHEEL_OFFSETS`) — everything `Player`'s
  constructor used to do. `PlayerView.sync(player)` reads `player.renderPosition` /
  `renderHeading` / `renderWheelSteer` and writes the Three.js transform; that's its
  only job.
- `Player` lost its `THREE` import entirely, along with `object3D`, `frontWheels`, and
  its constructor (nothing left for it to do). `syncVisuals(alpha)` renamed
  `updateRenderPose(alpha)`: same interpolation math, but now only writes plain-data
  fields (`renderPosition`, plus new `renderHeading`/`renderWheelSteer`) — zero
  rendering calls. `Game.tick` now calls `player.updateRenderPose(alpha)` then
  `playerView.sync(player)` as two steps where `player.syncVisuals(alpha)` used to be
  one; `Game` also now constructs and scene-adds a `playerView` alongside `player`.
- No behavior change: same interpolation math, same call ordering relative to the
  physics accumulator loop, same camera-follows-`renderPosition` contract.

**Verified:** build clean; confirmed headless — `new Player()` + `.update(...)` runs
correctly with zero `three` package involvement at all (checked the compiled output has
no `three` import, and that `object3D`/`frontWheels` no longer exist on the instance).
This is what "independently testable and reusable" concretely means: `Player` can now
be constructed and driven in a plain Node script (already the pattern used to verify
every physics pass above) without pulling in Three.js, a DOM, or a `PlayerView` at all.

Left alone: the debug panel binds to `Game.telemetry`/`Player` getters, all unchanged;
transmission/steering/handbrake physics untouched, only the presentation boundary moved.

## 4. Build automated physics telemetry/tests

Deterministic simulation tests for acceleration, braking, shifting, top speed, steering
radius, grip limits, and control transitions.

**Goal:** every physics change produces measurable before/after results.

**Why:** telemetry-driven tuning (dist-backed sim tables driving the real compiled
classes) is already the working method for every pass above — formalize it into
repeatable tests before more tuning makes the model harder to reason about. This repo
currently has no test framework — first sub-step is picking a minimal one, or continuing
the existing dist-backed-sim-script approach if that's preferred.

## 5. Add a proper road/off-road state

Once `TrackQuery` exists (done), determine whether the car is on-road, shoulder, or
off-road and apply appropriate grip/drag. The detection + drag-application mechanism is
feature work and can be built now; the actual per-surface grip *numbers* (Tuning
backlog) are tuning and can be placeholder values until then.

**Goal:** make leaving the track meaningful without requiring elaborate terrain.

**Why:** turns the track from scenery into gameplay.

## 6. Build gameplay systems on those primitives

Lap/progress tracking → checkpoints → AI opponents → traffic/hazards → race modes.

**Goal:** turn the driving sandbox into an actual game.

**Why:** these should consume the track/vehicle APIs rather than invent their own
geometry and physics.

---

## Tuning backlog (deferred until the feature-work items above are done)

Numeric/feel tuning, set aside so feature work isn't interleaved with it. Revisit as one
pass once items 3-6 above are done, in-browser, with the real telemetry.

- **Speed-dependent steering sensitivity** (e.g. 40°@≤40mph → 20°@150mph) — item 2
  candidate, not started.
- **Weight-transfer feel** (more front grip under braking, more rear grip under
  throttle) — item 2 candidate, uses the same "load affects grip" reasoning as the
  friction circle and handbrake rear-grip split.
- **`TIRE_GRIP` tuning** — only after in-browser feel testing with the above; the
  diagnosis so far is that "overshooting turns" is a speed/track mismatch (see track
  geometry below), not a steering bug — don't fix it by inflating `TIRE_GRIP`.
- **Performance envelope** (was item 3): revisit `ACCELERATION`, gear multipliers,
  torque curve, drag/top-speed falloff, and shift points as one system, against a
  deliberate target for 0–60, 0–100, top speed, and acceleration through each gear —
  instead of tuning individual constants reactively. Current baseline, not yet treated
  as a deliberate target: `ACCELERATION = 8` gives full-throttle 0→60 mph ≈2.9s,
  0→100 ≈5.8s, 0→130 ≈8.2s, 0→150 ≈12.6s; top speed ≈152 mph in 5th.
- **Track geometry resize** (item 1's known gap): corner radii and straight lengths
  need the performance envelope above finalized first, then size against
  `minCornerRadius(speed) = speed² / TIRE_GRIP`.
- **Surface-grip multiplier values** for item 5 (off-road state): road 16 / gravel 10 /
  grass 7 / ice 2 m/s² are placeholder-plausible, not measured/tuned.

---

## Status log

- 2026-08-04 — Roadmap written. Item 1 (`TrackQuery` API) built, verified against known
  geometry, wired into telemetry/debug panel.
- 2026-08-04 — Item 2, friction-circle cornering grip done and verified.
- 2026-08-04 — Merged `PHYSICS_V2_PLAN.md` into this doc (single backlog going
  forward; that file is deleted). Filed its passes under the correct items above:
  transmission passes → item 3's foundation; steering/cornering passes → item 2;
  track-sizing findings → item 1's known-gap note, blocked on item 3.
- 2026-08-04 — Item 2, handbrake rear-grip rotation (slip/drift state) done and
  verified — zero regression to normal cornering (confirmed numerically), genuine
  recoverable slide under handbrake.
- 2026-08-04 — HUD moved to top-left, gear numeral enlarged, tach made analog (see
  below — this is a presentation change, not on this doc's numbered list, but done
  now per direct request).
- 2026-08-04 — Reordered: numeric/feel tuning (remaining item 2 candidates, the old
  item 3 performance envelope, track-geometry resize, off-road surface-grip values)
  moved to a new Tuning backlog section at the end, to be done as one pass after
  feature work, not interleaved with it. Renumbered items 4-7 → 4-6.
- 2026-08-04 — Item 3 (separate simulation from presentation) done: `PlayerView` now
  owns all Three.js concerns; `Player` is Three.js-free and verified headless. Next:
  item 4 (automated physics tests) — no tuning until items 4-6 are done.
