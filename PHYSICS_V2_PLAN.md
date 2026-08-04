# Transmission / Steering v2 — Implementation Plan

Feedback verdict: the architecture is right (input → wheel angle → bicycle geometry →
grip limit → yaw; and speed → gear → RPM → torque curve → gear torque → drag → accel).
No wholesale rewrite. Make changes in isolated passes and **measure** between them.

Guardrails carried from the feedback:
- Keep `ACCELERATION = 8` for now (measure before changing).
- Keep `GEAR_RATIOS = [3.0, 1.95, 1.38, 0.98, 0.60]` for now.
- Keep the current steering/bicycle model for now.
- Keep the manual "aggressive downshift screams past redline" behavior. Automatic must
  **never** intentionally overspeed the engine.
- `this.rpm` is **display/audio RPM**; `rpmForGear(gear, speed)` is **drivetrain RPM**.
  Physics uses drivetrain RPM; the shift blend only smooths display/audio. Don't merge them.
- Do **not** change `ENGINE_TORQUE_CURVE` yet — the aggressive redline cliff is currently
  useful (clear "out of breath", underpins the 152 mph top speed). Revisit only after data.

---

## Pass 1 — Automatic transmission: kickdown + safe downshift  ✅ DONE
- [x] Add constants: `AUTOMATIC_KICKDOWN_RPM = 4000`, `AUTOMATIC_KICKDOWN_MIN_GAIN = 0.12`,
      `AUTOMATIC_MAX_DOWNSHIFT_RPM = 6800`.
      (Skipped `AUTOMATIC_KICKDOWN_THROTTLE`: our throttle is binary, not analog.)
- [x] Rewrite `automaticGearFor(gear, speed, throttle, brake)` with full-throttle kickdown.
- [x] Verify no gear hunting: post-kickdown RPM stays below the upshift RPM (confirmed).
- Checks:
  - [x] Typecheck / build clean.
  - [x] Manual mode unaffected (still allows the screaming downshift).
  - [x] Automatic never downshifts into an over-redline RPM (refuses 5→4 at 100+ mph).

## Telemetry (item 15) — measurement tooling ("I want telemetry now")  ✅ DONE
- [x] Expose per-frame from `Player`: engine torque, gear multiplier, longitudinal accel,
      wheel-steer angle, yaw rate, lateral accel, grip-limited flag.
- [x] Surface them in the debug panel Telemetry folder.
- [x] Produce full-throttle table + shift table + kickdown probe (via dist-backed sim).
- [x] Send tables to reviewer → **Pass 1 approved.** Next move: Pass 3 (shift interruption).
      Reviewer confirms: leave gearing, torque curve, kickdown, top-speed model alone.

## Pass 2 — Torque curve  ⛔ PARKED (reviewer: do NOT touch)
- The surge/drop/surge across gears and the 140→152 mph "runs out of breath" are the
  gearing working as intended. No change unless later data demands it.

## Pass 3 — Shift quality: upshift torque interruption  ✅ DONE
Goal: NOT slow shifting. A ~55 ms torque dip so the player feels
"scream → shift → tiny thump → power back" instead of an instant 88% accel jump.
Steady-state post-shift acceleration must stay UNCHANGED (don't nerf the next gear).
- [x] Add constants: `SHIFT_TORQUE_CUT_MS = 55`, `SHIFT_TORQUE_CUT_FACTOR = 0.15`.
- [x] `Player.shiftTorqueCutRemaining` + `SHIFT_TORQUE_CUT_SECONDS`; decrement each frame.
- [x] Start the cut on **upshifts only** (automatic AND manual). Reset on respawn.
- [x] `shiftTorqueFactor` multiplied into `accel`. Nothing else touched.
- [x] Telemetry: `shiftTorqueCutActive` / remaining ms in the debug panel.
- Tuning knobs (change ONE at a time if needed): duration 40/55/70 ms; severity 0.05–0.30.
- Validation (dist-backed sim) ✅:
  - [x] Shift table before | during | after — after matches pre-Pass-3 (10.26 vs 10.28 etc).
  - [x] Cut ≈ 50 ms (3 frames); min accel during ~1.0–1.5 m/s².
  - [x] Top speed unchanged (151.6); 0–60 2.97→3.05 s; no RPM logic touched.

**Transmission is now frozen** per reviewer — next major system is the track generator.

## Pass 4 — Steering validation (no code change first)  ✅ VALIDATED (numerically)
- [x] Measured full-lock cornering across speed (real model): constant 1.63g above ~15 mph,
      radius grows as v²/grip → 3/11/25/45/101/180/281 m at 15/30/45/60/90/120/150 mph.
      Clean, consistent progression — no bicycle-model change (reviewer: leave it alone).
- [x] Min-radius-per-speed target table (feeds Pass 5): 30→11, 60→45, 90→101, 120→180,
      150→281 m. Confirms current 22/35/45 m corners cap at ~49/63 mph.
- [ ] Confirm actual FEEL in-browser (can't be done headless).
- [ ] Possible later: speed-sensitive steering lock (40°@≤40mph → 20°@150mph). Not yet.
- [ ] Possible later: surface grip multiplier (road 16 / gravel 10 / grass 7 / ice 2). Not yet.

## Pass 4b — "Overshooting turns" review: steering feel + diagnostics + interaction
Reviewer diagnosis: overshoot is a speed/track mismatch, NOT a steering bug. Do NOT fix it by
inflating TIRE_GRIP. Preserve the fast car; improve turn-in, add diagnostics, then make
braking + track geometry create the challenge. Two independent radius limits exist:
`R_steer = wheelbase / tan(δmax)` (geometry) and `R_grip = v² / TIRE_GRIP` (grip); actual = max.
NOTE on radius math: at TIRE_GRIP=16, R = v²/grip → 150 mph ≈ **281 m** (the reviewer's
175 m table is ~0.6× low). The new live RADIUS readout is the source of truth.

Do now (steps 1–3):  ✅ DONE
- [x] Faster turn-in: `WHEEL_STEER_SMOOTH_PER_SEC` 16 → 28 (reduces lag, not max cornering).
- [x] Telemetry: STEERING-limited vs GRIP-limited (`steeringLimit` label + `lastSteeringLimited`).
      Confirmed: steering-limited only below ~18 mph; grip-limited (1.63g) at all real corner speeds.
- [x] Telemetry: actual turn radius `|speed / yawRate|` (Corner Limit + Turn Radius in panel).
- [ ] Then test existing tracks at 50/60/70/80 mph in-browser; only then consider TIRE_GRIP. ← YOU

Deferred (later passes, in order):
- [ ] Pass 6 — friction circle: `availableLateral = sqrt(max(0, TIRE_GRIP² − longAccel²))`,
      `maxYaw = availableLateral / speed`. Braking then eats cornering grip → brake-then-turn loop.
- [ ] Pass 7 — handbrake reduces REAR grip so the car rotates (arcade handbrake turn), instead
      of just decelerating. (Needs a rear-grip / rotation term.)
- [ ] TIRE_GRIP tuning — only after the above and in-browser testing.

## Pass 5 — Track generator  ← MAJOR SYSTEM (after Pass 4b)
Findings from reading `src/world/{trackDefinitions,trackSpline,trackWorld}.ts`:
- It is **not** a procedural generator — 3 fixed, hand-authored loops (rounded rectangle,
  oval, figure-eight) built from explicit arcs, then Catmull-Rom sampled at ~3 m spacing
  (`TRACK_SAMPLE_SPACING`). All flat (z = 0) — no elevation. So reviewer questions about
  "abrupt procedural curvature / procedural machinery" don't apply as posed.
- **Corner radii are far too tight for the 152 mph / 1.6g car.** Max grip-limited corner
  speed = sqrt(radius × TIRE_GRIP):
  - rounded rectangle cornerRadius 22 m → ~42 mph
  - oval radius 35 m → ~53 mph
  - figure-eight radius 45 m → ~60 mph
  Above those the car understeers off. Tracks were sized for the old ~90 mph car.
- **Straights too short to reach top speed**: rounded-rect long straight ~96 m (short sides
  ~46 m); oval straight ~180 m. Reaching 150+ mph needs ~600–900 m.
- Road width `ROAD_WIDTH = 10 m` leaves little margin once understeering at speed.

TODO (decide with reviewer before building):
- [ ] Choose direction: (a) resize/redesign the fixed tracks with speed-appropriate radii,
      or (b) build a real procedural generator.
- [ ] Add helper: `minCornerRadius(speed) = speed² / (TIRE_GRIP)` and design targets from it
      — e.g. 100 mph → 125 m, 130 mph → 211 m, 150 mph → 281 m radius.
- [ ] Long straights (~600–900 m) so top speed is actually reachable.
- [ ] Curvature transitions (clothoid/spiral) so corners ramp in rather than step.
- [ ] Revisit `ROAD_WIDTH` vs the grip/understeer envelope.
- [ ] Hand track code + these numbers to reviewer for the track-design pass.

## Backlog (explicitly deferred)
- [ ] Handbrake that reduces rear grip → arcade handbrake-turn rotation (needs a slip/drift
      state; the current single-heading model only decelerates on Space).
