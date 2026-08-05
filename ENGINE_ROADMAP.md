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

## 4. Build automated physics telemetry/tests  ✅ DONE

Deterministic simulation tests for acceleration, braking, shifting, top speed, steering
radius, grip limits, and control transitions.

**Goal:** every physics change produces measurable before/after results.

**Why:** telemetry-driven tuning (dist-backed sim tables driving the real compiled
classes) is already the working method for every pass above — formalize it into
repeatable tests before more tuning makes the model harder to reason about.

**What was built:** Node's built-in test runner (`node:test`/`node:assert/strict`) —
no new runtime dependency, only `@types/node` (dev-only, for type declarations).
`npm test` runs `tsc && node --test dist/test`. `src/test/helpers.ts` holds shared
setup (`controls()` builds a `ControlState` with everything released except overrides;
`playerAtSpeed(mph)` drives a fresh headless `Player` to a target speed via full
throttle — the exact pattern used ad hoc to verify every physics pass above, now
reusable). Five test files convert this session's ad hoc verification into permanent
regression tests:
- `acceleration.test.ts` — 0-60/0-100 timing within a generous tolerance band (regression
  guard, not a tuning target), `MAX_SPEED` never exceeded, top speed/gear at sustained
  full throttle.
- `braking.test.ts` — brake/handbrake/coast decelerate at exactly `BRAKE_FORCE`/
  `HANDBRAKE_FORCE`/`FRICTION`; handbrake stops exactly at zero and never reverses.
- `shifting.test.ts` — automatic gear sequence climbs 1-by-1 to 5th, never out of
  range; manual R-N-1-...-5 cascades one gear per cooldown window when held; upshift
  torque-cut activates and fully clears after `SHIFT_TORQUE_CUT_MS`.
- `steering.test.ts` — friction-circle coasting grip matches
  `sqrt(TIRE_GRIP² - FRICTION²)` exactly at every speed; full brake zeroes cornering
  capacity; no steering input means no yaw regardless of speed.
- `handbrakeSlide.test.ts` — the most valuable regression guard here: `driftAngleDeg`
  is exactly `0` during ordinary cornering that never touches the handbrake, at every
  speed (this is precisely the steady-state-lag bug caught and fixed during the
  handbrake pass — this test fails loudly if that regresses). Also covers: handbrake
  produces a real slide, releasing it recovers to exactly 0, high-speed handbrake+lock
  stays bounded at `HANDBRAKE_MAX_YAW_RATE`, handbrake alone doesn't rotate.
- `trackQuery.test.ts` — oval/figure-eight geometry checks from item 1's ad hoc
  verification (lateral offset sign/magnitude, curvature vs. analytic radius,
  multi-loop `loopIndex` resolution, off-track detection).

26 tests, all passing. One assertion had to tolerate `-0` vs `0` (`Math.abs(...)` before
comparing) — a harmless floating-point sign-bit artifact from `Math.max(-0, ...)` when
a grip cap is exactly zero, not a real behavior difference; fixed in the test, not the
production code.

Left alone: no coverage yet for `Input`/`readControlState` (constructing `Input` needs
a `window`, so it can't run headless under plain Node without a DOM shim — not
attempted here, low value relative to the physics coverage above) or `TrackWorld`'s
mesh-building (rendering-adjacent, out of scope for physics tests).

## 5. Add a proper road/off-road state  ✅ DONE

Once `TrackQuery` exists (done), determine whether the car is on-road, shoulder, or
off-road and apply appropriate grip/drag. The detection + drag-application mechanism is
feature work and can be built now; the actual per-surface grip *numbers* (Tuning
backlog) are tuning and can be placeholder values until then.

**Goal:** make leaving the track meaningful without requiring elaborate terrain.

**Why:** turns the track from scenery into gameplay.

**What was built:**
- `src/world/surfaceState.ts` (new): `SurfaceState { kind, gripMultiplier, dragMultiplier }`
  and `classifySurface(distanceFromCenterline)`, three tiers — `road` (within
  `ROAD_WIDTH/2`), `shoulder` (up to 2m beyond the paved edge), `offRoad` (further out).
  `ROAD_SURFACE` (multipliers of 1) is exported as the default.
- `Player.update(dt, controls, surface = ROAD_SURFACE)` gained a third parameter.
  `surface.gripMultiplier` scales `TIRE_GRIP` in the friction-circle cornering cap;
  `surface.dragMultiplier` scales `FRICTION` (coast drag) and `BRAKE_FORCE` (regular
  brake) — off-road/shoulder braking distance grows too, not just cornering. The
  default parameter means every existing call site (including all prior tests, which
  call `Player.update` directly in several places) needed zero changes; verified
  identical behavior with the parameter omitted vs. explicit `ROAD_SURFACE`.
- `Game.stepPhysics` classifies the surface from `trackQuery.nearestPoint(player.position).distance`
  once per physics step (mirroring how `ControlState` is sampled once per step) and
  passes it into `player.update`. `Telemetry.surfaceKind` added (debug panel) for
  observability of what's actually driving physics grip/drag right now.

**Deliberately left alone:** the handbrake's yaw cap (`HANDBRAKE_MAX_YAW_RATE`) is not
scaled by surface — handbrake rear-grip rotation is a separately-verified mechanic
(item 2 pass 4) and touching its interaction with surface state is scoped out of this
pass. Acceleration/throttle traction is untouched — wheelspin/reduced traction under
power is a distinct mechanic from the grip/drag covered here.

**Verified (7 new tests in `src/test/surfaceState.test.ts`):** `classifySurface`
tier boundaries; `Player.update` with the surface argument omitted is bit-identical to
passing `ROAD_SURFACE` explicitly; off-road cornering grip matches
`sqrt(max(0, (TIRE_GRIP·gripMultiplier)² − (FRICTION·dragMultiplier)²))` exactly; off-road
coast drag decelerates harder than on-road.

**Notable finding, not a bug:** with the current placeholder multipliers (`offRoad`:
grip ×0.45, drag ×2.2), off-road coast friction alone (`FRICTION × 2.2 ≈ 13.2`) already
consumes nearly the entire reduced grip budget (`TIRE_GRIP × 0.45 = 7.2`) — cornering
grip while coasting off-road floors at (or very near) zero even with no braking. That's
a real, if likely too-extreme, consequence of these specific placeholder numbers; the
Tuning backlog's surface-grip pass should treat this as a concrete data point, not
re-derive it from scratch.

## 6. Build gameplay systems on those primitives  ⏳ IN PROGRESS

Lap/progress tracking → checkpoints → AI opponents → traffic/hazards → race modes.

**Goal:** turn the driving sandbox into an actual game.

**Why:** these should consume the track/vehicle APIs rather than invent their own
geometry and physics. Each link in this chain is its own isolated pass, same as every
other item above — this entry tracks progress through the chain rather than being one
single deliverable.

**Done so far:**

1. **Lap/progress tracking** — `src/gameplay/lapTracker.ts` (new): `LapTracker` watches
   arc-length progress along one loop (the one the spawn point sits on) via `TrackQuery`
   — no separate "am I near the line" geometry of its own. A lap completes when
   arc-length drops by more than half the loop's length in one step: ordinary driving
   (forward or reverse) never moves arc-length anywhere near that much in a single
   physics step, so this only fires on an actual seam crossing, and only in the forward
   direction (a backward crossing jumps arc-length *up* by about the loop length, which
   this check doesn't treat as a completion — verified explicitly, see tests). Progress
   on a different loop than the tracked one (e.g. the figure-eight's second loop) simply
   doesn't advance detection; the lap clock keeps running, nothing resets.
   - `TrackQuery` gained `loopLength(loopIndex)` (the wrap threshold `LapTracker` needs)
     — the one small addition to that API this required.
   - Wired into `Game`: `LapTracker` is (re)built in `setTrackType` alongside
     `trackQuery`, updated once per physics step in `stepPhysics` (same cadence as
     `ControlState`/surface classification), and reset on respawn. Lap count/current/best
     time surfaced in both `Telemetry` (debug panel) and, since this is the first system
     meant to be visibly playable rather than a diagnostic, a new lap block in the HUD
     itself (`Hud.updateLap`) — "LAP N  M:SS.d" plus a best-time line underneath the tach.
   - Verified (8 new tests, `src/test/lapTracker.test.ts`, using the actual sampled
     track's own coordinates rather than guessed geometry): forward seam-crossing
     completes a lap; backward seam-crossing does not; small forward steps walking the
     entire loop's sample set never falsely trigger; `lastLapTime`/`bestLapTime` track
     correctly across a fast lap followed by a slower one; progress on a different loop
     doesn't affect the tracked loop's lap count; `reset()` clears everything.

2. **Checkpoints (sector splits)** — extended `LapTracker` rather than adding a
   separate class: checkpoints are evenly-spaced arc-length thresholds
   (`sectorCount - 1` of them, default 3 sectors → 2 checkpoints) crossed the same way
   the finish line is (forward progress past a threshold, once per lap), so there's one
   piece of arc-length-progress/wrap logic, not two duplicating each other.
   `LapState.splits: ReadonlyArray<number | null>` — this lap's checkpoint times so far,
   `null` until reached, reset to all-`null` the moment a lap completes. Checkpoints are
   checked *before* the lap-wrap check each `update()`, so a threshold sitting right at
   the finish line still gets its split recorded before the wrap resets everything.
   - Surfaced in the HUD: a sector-splits line under the lap/best-time block
     ("S1 0:12.3  S2 0:24.1").
   - **Scope explicitly limited to informational splits** — this pass does *not* gate
     lap validity on having reached every checkpoint (e.g. a reversed-then-forward or
     short-cut lap still completes and counts). Real anti-cheat/validity gating would be
     a natural follow-up, not built here.
   - Verified (4 new tests): splits start all-`null`; crossing each threshold forward
     records the correct elapsed time, in order; re-visiting an already-crossed
     checkpoint doesn't re-record it; splits reset to all-`null` exactly when a new lap
     starts. Built against real sampled track coordinates (`sample.arcLength >= target`,
     not "nearest sample to target" — nearest can land just short of the threshold and
     silently fail to trigger the crossing check, which is exactly the bug this test
     methodology caught in its first draft).

3. **Autopilot for the existing car** — not the roadmap's "AI opponents" (a second,
   separate car); this is a toggleable AI that drives the *same* car, confirmed with the
   user before building. Immediate motivation: a way to auto-lap the Pass 2 track
   redesign and sanity-check it without driving every lap by hand.
   - `src/gameplay/aiDriver.ts` (new): `AiDriver.computeControls(player, trackQuery)`
     produces one `ControlState` per physics step — same contract/seam as
     `readControlState(input)`, swapped in `Game.stepPhysics` behind a debug-panel
     checkbox (`setAiDriverEnabled`). Steering and braking both approximate a "point
     on the track ahead" the same way (walk forward along the current tangent, re-query
     `TrackQuery.nearestPoint` on that projection to snap to the real curve) — no new
     `TrackQuery` API needed.
   - **Steering** uses one short, fixed lookahead (~15m) — just "which way does the road
     go next." **Braking** samples several points out to a lookahead that scales with the
     car's own speed (`speed × 2.5s`, minimum 20m), taking the tightest curvature found —
     a fixed lookahead is nowhere near enough warning across this car's actual speed
     range (standstill to ~152 mph): the first version used one fixed 18m lookahead for
     both and the AI braked far too late for the Circuit's tight compound corner (missed
     a ~55mph corner while still doing ~96mph with only 18m of warning, needed 30m+),
     ending up 90% off-road for the lap. Speed-scaling the braking lookahead fixed it to
     0% off-road. Samples resolving to a different loop (relevant on the figure-eight,
     where two loops pass close together) are discarded rather than allowed to distort
     the target.
   - Relies entirely on the existing automatic transmission and never uses the
     handbrake; known limitation, not worked around: if transmission mode is set to
     Manual while the autopilot drives, the car never shifts.
   - Verified (`src/test/aiDriver.test.ts`, 2 new tests, 47 total): drives a headless
     `Player` with real `AiDriver` output around the actual Circuit and figure-eight,
     watched by a real `LapTracker` — completes a lap of each with 0% time off-road (not
     just under a threshold — genuinely clean). Direct measurement outside the test
     suite: full laps in 35.4s (Circuit, ~98 mph top speed), 28.7s (oval, ~104 mph),
     17.6s (figure-eight loop, ~73 mph) — sensible relative to each track's character.
     This test doubles as an automated sanity check of the Pass 2 track geometry itself.

**Next in the chain:** a second, separate AI opponent car, traffic/hazards, and race
modes — not started. Lap-validity gating on checkpoints (noted above) is also still open, whenever it's
wanted.

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
- **Track geometry resize** (item 1's known gap): ✅ Pass 1 done, out of turn (done before
  the performance envelope above was formally finalized — user-directed, current car
  numbers used as the target instead). `ROAD_WIDTH` 10 → 14m; corner radii: rounded
  rectangle 22 → 55m, oval 35 → 60m, figure-eight 45 → 65m (footprints enlarged to
  match: rounded-rect `halfWidth/halfHeight` 70/45 → 90/55, oval `halfStraight` 90 →
  110). New grip-limited corner speeds: ~66/69/72 mph (target was 60-75 mph — matches).
  `trackQuery.test.ts`'s hardcoded geometry constants updated to match (was already
  fragile to any geometry change — the values are named constants now, but still have
  to be kept in sync by hand since there's no way to derive them from the sampled
  output). **Note:** with `cornerRadius == halfHeight` on the rounded-rectangle track,
  the left/right straights collapse to zero length — it's now geometrically a stadium
  (long top/bottom straights, semicircular ends), not 4 distinct corners. That's a
  direct consequence of the requested numbers, not a bug; worth knowing before judging
  the shape in-browser. **Pass 2 done** (user confirmed Pass 1 felt right, and explicitly
  wanted the oval left alone as the "just go fast" baseline track): the rounded-rectangle
  and figure-eight's technical loop now each have four *distinct* corners instead of one
  radius repeated. Oval untouched.
  - Rounded rectangle → renamed **"Circuit"**: sweeper (r=95, ~87 mph), medium (r=65,
    ~72 mph), tight (r=45, ~60 mph, not a hairpin), and a genuine compound "tight-in,
    opening-out" corner (two tangent-joined arcs, r=38 entering → r=80 exiting — verified
    numerically that curvature actually tightens then opens through the corner, and that
    the two arcs' join point matches to 6 decimal places). Straights: 222m (start/finish),
    168m, 129m (braking zone into the tight corner), 84m (short link out of the opening
    corner into the sweeper). Total lap 1005m.
  - Figure-eight's loop A (fast sweeper) resized (65→80m) but otherwise left alone —
    same "keep it simple, it's the fast one" logic as the oval. Loop B rebuilt as its own
    small rounded rectangle with four different corner radii (40/45/50/55m) instead of a
    plain circle — a genuinely more technical loop, still crossing loop A at the shared
    origin point with the same tangent relationship as before.
  - The reusable technique for both: `arcPoints()`'s tangent at angle θ is
    `(−sinθ, cosθ)` — independent of radius — so any two arcs sharing a join angle
    automatically share a tangent there (no kink), with the second circle's center offset
    from the first along the join-angle radius direction by `(r1 − r2)`. This is what
    makes the compound corner (same direction, changing radius) simple to build with the
    existing `arcPoints()`, no new spline machinery. A small `pointOnCircle()` and
    `midpoint()` helper were added alongside it for single-point anchors.
  - Verified numerically (dist-backed, same technique as every pass this session): both
    tracks' loops close cleanly (gap ≈ one sample spacing, ~3m — expected, not an error);
    every corner's curvature matches its target radius within ~2%; the compound corner's
    two arcs meet at literally the same point (0.000000m gap). One test
    (`trackQuery.test.ts`'s figure-eight `loopIndex` check) had to move off the old
    "circle center" query points since loop B isn't a circle anymore — now queries a
    point unambiguously inside each loop's actual footprint instead.
  - Still open: `minCornerRadius(speed) = speed² / TIRE_GRIP` as the formal sizing
    formula, once a performance envelope is actually finalized (this pass used the car's
    *current*, not-yet-finalized numbers as a practical stand-in, per explicit user
    direction). Variable per-segment road width (noted, explicitly deferred by the user).
- **Surface-grip/drag multiplier values** in `world/surfaceState.ts` (item 5, done):
  `shoulder` grip ×0.7 / drag ×1.3, `offRoad` grip ×0.45 / drag ×2.2 — placeholder, not
  measured/tuned. Known issue to address in this pass: off-road coast friction alone
  (`FRICTION × 2.2`) already exceeds the reduced grip budget (`TIRE_GRIP × 0.45`), so
  cornering grip floors at ~0 off-road even without braking — probably too severe,
  revisit both numbers together rather than in isolation.

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
  owns all Three.js concerns; `Player` is Three.js-free and verified headless.
- 2026-08-04 — Item 4 (automated physics tests) done: Node's built-in test runner,
  `npm test`, 26 tests across acceleration/braking/shifting/steering/handbrake-slide/
  TrackQuery, all passing.
- 2026-08-04 — Item 5 (road/off-road state) done: `SurfaceState`/`classifySurface` in
  `world/surfaceState.ts`, wired into `Player.update` via a defaulted third parameter
  (zero changes needed at existing call sites) and `Game.stepPhysics`. 7 new tests, 33
  total, all passing. Placeholder off-road numbers produce a known-too-severe zero-grip
  effect while coasting — flagged concretely in the Tuning backlog.
- 2026-08-04 — Item 6, first link (lap/progress tracking) done: `LapTracker` consumes
  `TrackQuery` (which gained `loopLength`), wired into `Game` and the HUD (first
  player-visible, not just debug-panel, gameplay system). 8 new tests, 41 total, all
  passing.
- 2026-08-04 — Item 6, second link (checkpoints/sector splits) done: extended
  `LapTracker` rather than a separate class, reusing its arc-length-progress/wrap logic
  instead of duplicating it. Splits surfaced in the HUD. 4 new tests, 45 total, all
  passing — caught a real test-methodology bug (nearest-sample vs. at-or-past-threshold
  sample) along the way.
- 2026-08-04 — Item 6, autopilot for the existing car done (user-confirmed scope: same
  car, not a second opponent). Speed-scaled braking lookahead was the key fix — a fixed
  lookahead braked too late at high speed and put the AI 90% off-road; scaling it with
  the car's own speed fixed it to 0% off-road on all three tracks. Doubles as an
  automated sanity check that the Pass 2 track redesign is actually drivable. 2 new
  tests, 47 total, all passing. Next: a second AI opponent car, traffic/hazards, race
  modes — no tuning until item 6's chain is done.
