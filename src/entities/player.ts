import type { Vec3 } from "../math/vector3.js";
import { angleDelta } from "../math/vector3.js";
import { interpolateCurve } from "../math/curve.js";
import type { ControlState } from "../engine/controlState.js";
import type { SurfaceState } from "../world/surfaceState.js";
import { ROAD_SURFACE } from "../world/surfaceState.js";
import { transmissionSettings } from "../util/transmissionSettings.js";
import { rpmForGear, accelerationMultiplierForGear, engineTorqueFraction } from "../util/engineModel.js";
import type { CarConfig } from "../util/cars/index.js";
import { DEFAULT_CAR } from "../util/cars/index.js";
import { effectiveGrip, availableLateral } from "../util/vehicleDynamics.js";

/** Why automaticGearFor picked the gear it did — surfaced as telemetry so hunting is visible/diagnosable instead of just felt. */
export type AutomaticShiftReason = "upshift" | "downshift" | "kickdown" | "hold";

export interface AutomaticGearDecision {
  gear: number;
  reason: AutomaticShiftReason;
}

/**
 * Picks the automatic gear one step at a time (never Neutral/Reverse), with
 * explicit hysteresis so it settles on a decision instead of hunting between
 * two adjacent gears:
 *
 *   - RPM too high                    -> upshift (later, flat out; earlier
 *                                         when coasting). No torque check:
 *                                         more speed always eventually wants
 *                                         a taller gear, and torque only
 *                                         gets worse from upshifting, so an
 *                                         RPM threshold alone is sufficient.
 *   - RPM too low, OR throttle + weak
 *     pull (kickdown)                 -> downshift, but ONLY if the lower
 *                                         gear makes meaningfully
 *                                         (automaticKickdownMinGain) more
 *                                         torque and wouldn't overspeed the
 *                                         engine (automaticMaxDownshiftRpm).
 *
 * That torque-benefit gate used to apply only to kickdown; it now gates
 * every downshift, so cruising right at the plain RPM threshold can't
 * flicker between two gears that are functionally equivalent for the
 * driver — the actual fix for gear hunting, not just a longer cooldown
 * after the fact (see update()'s shiftCooldown, which still rate-limits how
 * often ANY shift can happen, but no longer has to do all the work alone).
 * The gate is safe even near a dead stop: as speed -> 0 every gear's RPM
 * converges to idleRpm, so the torque comparison there reduces to
 * gearAccelMultipliers' own ratio between adjacent gears — which the table
 * (deliberately) already spaces further apart than automaticKickdownMinGain,
 * so the cascade down to 1st gear when coming to a stop still happens.
 */
function automaticGearFor(currentGear: number, speed: number, throttle: boolean, brake: boolean, car: CarConfig): AutomaticGearDecision {
  const gear = Math.max(1, Math.min(5, currentGear));
  const rpm = rpmForGear(gear, speed, car);

  const upshiftRpm = throttle ? car.automaticUpshiftRpm : car.automaticCoastUpshiftRpm;
  if (gear < 5 && rpm >= upshiftRpm) {
    return { gear: gear + 1, reason: "upshift" };
  }

  const downshiftRpm = brake ? car.automaticBrakeDownshiftRpm : car.automaticDownshiftRpm;
  const wantsKickdown = throttle && rpm < car.automaticKickdownRpm;
  if (gear > 1 && (rpm <= downshiftRpm || wantsKickdown)) {
    const lowerGear = gear - 1;
    const lowerRpm = rpmForGear(lowerGear, speed, car);
    if (lowerRpm <= car.automaticMaxDownshiftRpm) {
      const currentTorque = accelerationMultiplierForGear(gear, car) * engineTorqueFraction(rpm, car);
      const lowerTorque = accelerationMultiplierForGear(lowerGear, car) * engineTorqueFraction(lowerRpm, car);
      if (lowerTorque > currentTorque * (1 + car.automaticKickdownMinGain)) {
        return { gear: lowerGear, reason: wantsKickdown ? "kickdown" : "downshift" };
      }
    }
  }

  return { gear, reason: "hold" };
}

/**
 * Linear up to `threshold`, then eases toward `hardCap`, continuous in value
 * AND slope at the knee (matches identity's slope of 1 there) — so there's
 * no felt kink where softening begins. hardCap<=0 / headroom<=0 (grip fully
 * consumed by braking/accel, e.g. full-brake steering) return exactly
 * 0/hardCap rather than an asymptotic near-miss.
 */
function softSaturate(desired: number, threshold: number, hardCap: number): number {
  if (hardCap <= 0) return 0;
  const sign = Math.sign(desired);
  const magnitude = Math.abs(desired);
  if (magnitude <= threshold) return desired;
  const headroom = hardCap - threshold;
  if (headroom <= 0) return sign * hardCap;
  const excess = magnitude - threshold;
  return sign * (threshold + headroom * (1 - Math.exp(-excess / headroom)));
}

/**
 * The player's car. Simple arcade physics: speed, heading, position,
 * and an engine RPM derived from speed and gear (see util/engineModel.ts).
 *
 * Automatic mode (default): gear auto-selects among 1-5 by RPM, and
 * holding brake (S) while stopped backs the car up — no gear-shifting
 * to think about, matching a regular automatic car.
 *
 * Manual mode: gear is one of Reverse/Neutral/1-5, shifted sequentially
 * with Q (down) / E (up), no clutch. Neutral disengages the drivetrain
 * (throttle free-revs the engine instead of moving the car). Shifting
 * is instant at the physics level — an upshift drops RPM immediately,
 * a downshift jumps it — which is what makes shifting audible. A
 * downshift is never rejected: an aggressive one can briefly push RPM
 * above redline (capped at MAX_TRANSMISSION_RPM) before settling into
 * the normal limiter bounce — the "BRAAAP." Brake is a plain brake in
 * this mode; reverse is only reached via Q.
 *
 * Pure vehicle state/physics — no Three.js or any other rendering concern.
 * `entities/playerView.ts` owns the meshes and reads this class's public
 * pose (renderPosition/renderHeading/renderWheelSteer, refreshed once per
 * render frame by updateRenderPose) to draw the car; this class never
 * touches a scene graph, so it can be constructed and driven headless.
 */
export class Player {
  position: Vec3 = { x: 0, y: 0, z: 0 };
  heading = 0; // radians; 0 = facing +Y (straight down the road) — the car's NOSE direction
  // Direction the car is actually TRAVELING, in radians. Normally chases `heading`
  // almost instantly (see applySteering), so position moves exactly where the nose
  // points, same as before this field existed. Only while the handbrake is held does
  // it lag behind heading — that gap is the slide. Position integrates along this,
  // not `heading`.
  private velocityHeading = 0;
  speed = 0;
  gear = 1; // -1 = reverse, 0 = neutral, 1-5 = forward
  rpm: number;
  private limiterPhase = 0;
  private shiftCooldown = 0; // seconds remaining before another gear change is allowed
  private downshiftSettleRemaining = 0; // seconds remaining in the post-downshift RPM overshoot window
  private shiftBlendRemaining = 0; // seconds remaining easing displayed RPM down after an upshift
  private shiftTorqueCutRemaining = 0; // seconds remaining in the post-upshift torque interruption
  private wheelSteer = 0; // current front-wheel yaw in radians, eased toward the steer target
  private currentMaxWheelSteer: number; // this frame's speed-scaled effective lock (see updateWheelSteer), for the full-lock telemetry check below
  // Per-frame telemetry snapshots (read via getters for the debug panel).
  private lastLongAccel = 0; // longitudinal acceleration, m/s^2 (negative under braking)
  private lastYawRate = 0; // rad/s
  private lastLateralAccel = 0; // m/s^2
  private lastDesiredYaw = 0; // rad/s, from steering geometry alone, before any grip/assist/reverse shaping
  private lastHardMaxYaw = 0; // rad/s, the tireGrip-based physical yaw ceiling this same step
  private lastGripLimited = false; // yaw demand crossed the soft-knee threshold (understeer starting)
  private lastSteeringLimited = false; // at full lock but NOT grip-limited (out of steering angle)
  private lastTurnRadius = Infinity; // |speed / yawRate|, meters (Infinity when going straight)
  private lastAutomaticDesiredGear = 1; // what automaticGearFor wants this frame, even if shiftCooldown is blocking it -- diagnostic for hunting
  private lastAutomaticShiftReason: AutomaticShiftReason = "hold";
  // Debounced throttle signal fed to automaticGearFor's shift-threshold
  // selection ONLY (not the actual accel/brake physics) -- see
  // CarConfig.automaticThrottleLiftDebounceMs. A true->false transition
  // must persist for that long before this flips to false; false->true is
  // immediate.
  //
  // Added after diagnosing AI-driven gear hunting on a technical track
  // (Serpentine): a single 8.3ms throttle blip from AiDriver's bang-bang
  // throttle was enough to swing automaticGearFor between the throttle-on
  // (7350 RPM) and coast (5600 RPM) upshift thresholds — a ~1750 RPM
  // regime change from one physics frame. This field's debounce fixed
  // that specific failure (measured: 109 -> 69 shifts and 24 -> 12
  // "oscillation clusters" over 2 laps on the Serpentine track, all of
  // the pure-straight-line hunting eliminated, no lap-time regression).
  //
  // The remaining rapid-shift clusters (concentrated in the track's
  // densest corner sequence) were investigated frame-by-frame and found
  // to be legitimate: throttle is genuinely released for a sustained
  // ~70ms+ (not a blip) as target speed drops into a corner, and
  // kickdowns line up with real braking-induced RPM decay -- not the
  // same operating point flip-flopping. util/vehicleDynamics.ts's
  // maxAcceleration() (used only during racing-line/speed-profile
  // generation) was confirmed to have no live wiring into this decision
  // at all, so it can't be the cause either. Conclusion: a car with an
  // automatic transmission WILL shift often through a genuinely dense,
  // closely-spaced corner sequence -- that's correct behavior, not a bug
  // to chase further.
  private shiftThrottleState = true;
  private throttleLiftMs = 0; // how long raw throttle has been continuously false, toward the debounce threshold
  // Fixed-step render interpolation: the pose at the START of the current
  // physics step, so a variable-rate render loop can blend toward the new pose
  // (see updateRenderPose) and stay smooth even when physics runs at a different Hz.
  private readonly prevPosition: Vec3 = { x: 0, y: 0, z: 0 };
  private prevHeading = 0;
  private prevWheelSteer = 0;
  /** Interpolated render-space position — the camera follows this (not the raw physics position) so it stays smooth. Refreshed by updateRenderPose. */
  readonly renderPosition: Vec3 = { x: 0, y: 0, z: 0 };
  /** Interpolated nose heading, radians. Refreshed by updateRenderPose; read by PlayerView. */
  renderHeading = 0;
  /** Interpolated front-wheel steer angle, radians. Refreshed by updateRenderPose; read by PlayerView. */
  renderWheelSteer = 0;

  /** Which car/engine this instance simulates — see util/cars/. Fixed for the instance's lifetime; swap cars by constructing a new Player. */
  readonly car: CarConfig;
  // Shift-timing constants converted to seconds once at construction (car.*Ms doesn't change afterward).
  private readonly manualShiftCooldownSeconds: number;
  private readonly automaticShiftCooldownSeconds: number;
  private readonly downshiftSettleSeconds: number;
  private readonly shiftRpmBlendSeconds: number;
  private readonly shiftTorqueCutSeconds: number;
  private readonly limiterBouncePeriodSeconds: number;

  constructor(car: CarConfig = DEFAULT_CAR) {
    this.car = car;
    this.rpm = car.idleRpm;
    this.currentMaxWheelSteer = car.chassis.wheelMaxSteerRad;
    this.manualShiftCooldownSeconds = car.manualShiftCooldownMs / 1000;
    this.automaticShiftCooldownSeconds = car.automaticShiftCooldownMs / 1000;
    this.downshiftSettleSeconds = car.downshiftSettleMs / 1000;
    this.shiftRpmBlendSeconds = car.shiftRpmBlendMs / 1000;
    this.shiftTorqueCutSeconds = car.shiftTorqueCutMs / 1000;
    this.limiterBouncePeriodSeconds = car.limiterBouncePeriodMs / 1000;
  }

  update(dt: number, controls: ControlState, surface: SurfaceState = ROAD_SURFACE): void {
    // Snapshot the pose before this step mutates it, for render interpolation.
    this.prevPosition.x = this.position.x;
    this.prevPosition.y = this.position.y;
    this.prevPosition.z = this.position.z;
    this.prevHeading = this.heading;
    this.prevWheelSteer = this.wheelSteer;

    const { throttle, brake, steerLeft, steerRight, handbrake } = controls;
    const manual = transmissionSettings.mode === "manual";
    const speedBefore = this.speed; // for longitudinal-accel telemetry
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    this.shiftTorqueCutRemaining = Math.max(0, this.shiftTorqueCutRemaining - dt);

    if (manual) {
      if (controls.shiftUp) this.shiftUp();
      if (controls.shiftDown) this.shiftDown();
    }

    // Set only while coasting (see below) -- the magnitude of decel that
    // should count against applySteering's friction circle, excluding
    // engine braking.
    let coastSteeringDecelOverride: number | null = null;
    const engaged = this.gear !== 0; // false only in Neutral
    const direction = this.gear === -1 ? -1 : 1;

    if (throttle && engaged) {
      const cap = this.gear === -1 ? this.car.maxReverseSpeed : this.car.maxSpeed;
      // Torque chain: engine torque at the current RPM * the gear's torque
      // multiplier, trimmed by a light aerodynamic-drag falloff toward the
      // speed cap. The engine torque curve is fat mid-range and falls to
      // zero at redline, so a gear still can't pull past its own redline
      // speed (accel hits 0 there — gears keep mattering), and every upshift
      // drops the revs back into the fat part of the curve: surge, drop,
      // surge. See engineModel.ts.
      const enginePower = engineTorqueFraction(rpmForGear(this.gear, this.speed, this.car), this.car);
      const speedRatio = Math.min(Math.abs(this.speed) / cap, 1);
      const dragFalloff = 1 - Math.pow(speedRatio, 3) * this.car.topSpeedFalloff;
      // Brief torque interruption right after an upshift (see CarConfig) — a
      // physical "thump" between gears, not a lingering nerf.
      const shiftTorqueFactor = this.shiftTorqueCutRemaining > 0 ? this.car.shiftTorqueCutFactor : 1;
      const accel =
        this.car.acceleration *
        accelerationMultiplierForGear(this.gear, this.car) *
        enginePower *
        dragFalloff *
        shiftTorqueFactor;
      if (direction > 0) {
        this.speed = Math.min(this.speed + accel * dt, cap);
      } else {
        this.speed = Math.max(this.speed - accel * dt, -cap);
      }
    } else if (handbrake) {
      // Strong deceleration toward zero from either direction; never reverses.
      const decel = this.car.handbrakeForce * dt;
      this.speed = this.speed > 0 ? Math.max(0, this.speed - decel) : Math.min(0, this.speed + decel);
    } else if (brake) {
      // Off-road/shoulder braking distance grows with surface.dragMultiplier — lower
      // grip means worse braking, not just worse cornering. Handbrake is unaffected;
      // it's already a distinct, separately-tuned mechanic (see applySteering).
      const brakeForce = this.car.brakeForce * surface.dragMultiplier;
      if (manual) {
        // Plain brake — reverse is only reached by shifting to R.
        this.speed = this.speed > 0 ? Math.max(0, this.speed - brakeForce * dt) : Math.min(0, this.speed + brakeForce * dt);
      } else {
        // Automatic mode keeps the simple "hold brake past zero to back up" shortcut.
        this.speed -= brakeForce * dt;
      }
    } else {
      // Coast drag also scales with surface — grass/gravel bleed off speed faster
      // than smooth pavement even with no brake input. Engine braking adds to it
      // while in gear, scaling with RPM — so a downshift (higher RPM at the same
      // speed) genuinely slows the car, not just the sound/gauge.
      const engineBrakingFraction = engaged
        ? Math.max(0, Math.min(1, (rpmForGear(this.gear, this.speed, this.car) - this.car.idleRpm) / (this.car.redlineRpm - this.car.idleRpm)))
        : 0;
      const baseDragForce = this.car.friction * surface.dragMultiplier;
      const frictionForce = baseDragForce + this.car.engineBraking * engineBrakingFraction;
      this.speed -= Math.sign(this.speed) * frictionForce * dt;
      if (Math.abs(this.speed) < frictionForce * dt) this.speed = 0;
      // Engine braking genuinely slows the car (above), but shouldn't also
      // compete with cornering grip in applySteering's friction circle the
      // way active braking/throttle do -- it's a drivetrain effect, not
      // additional tire demand. Testing showed coast/engine-braking alone
      // was eating ~1g of the friction circle while cornering, tightening
      // corners far more than intended just from lifting off the throttle.
      // Track only the base drag's contribution for the steering calc below.
      coastSteeringDecelOverride = baseDragForce;
    }
    this.speed = Math.max(-this.car.maxReverseSpeed, Math.min(this.car.maxSpeed, this.speed));
    // Measured now (not at the end of update()): this is this step's actual
    // longitudinal accel, for telemetry and (outside coasting) the value fed
    // to applySteering's friction circle.
    const longAccel = dt > 0 ? (this.speed - speedBefore) / dt : 0;
    this.lastLongAccel = longAccel;
    const steeringLongAccel = coastSteeringDecelOverride !== null ? Math.sign(longAccel) * coastSteeringDecelOverride : longAccel;

    if (!manual) {
      // Debounce the throttle signal used for shift-threshold selection
      // (see shiftThrottleState's doc comment) -- a single-frame throttle
      // lift shouldn't itself swing automaticGearFor between the
      // throttle-on and coast RPM thresholds (a ~1750 RPM gap on this
      // car). Lifting off requires automaticThrottleLiftDebounceMs of
      // sustained release; getting back on throttle is immediate, since
      // there's no hunting risk in promptly restoring the normal
      // (higher, harder-to-reach) upshift threshold.
      if (throttle) {
        this.throttleLiftMs = 0;
        this.shiftThrottleState = true;
      } else {
        this.throttleLiftMs += dt * 1000;
        if (this.throttleLiftMs >= this.car.automaticThrottleLiftDebounceMs) {
          this.shiftThrottleState = false;
        }
      }

      // Computed every frame (not just when the cooldown allows acting on
      // it) so lastDesiredGear/lastShiftReason telemetry always reflects
      // what the automatic currently wants — visible evidence of hunting
      // (desiredGear flickering while the cooldown holds actual gear still)
      // even when the cooldown is masking it from the player.
      const decision: AutomaticGearDecision =
        this.speed < -0.3
          ? { gear: -1, reason: "downshift" }
          : automaticGearFor(this.gear > 0 ? this.gear : 1, this.speed, this.shiftThrottleState, brake, this.car);
      this.lastAutomaticDesiredGear = decision.gear;
      this.lastAutomaticShiftReason = decision.reason;
      if (this.shiftCooldown <= 0 && decision.gear !== this.gear) {
        if (decision.gear > this.gear) {
          this.shiftBlendRemaining = this.shiftRpmBlendSeconds; // ease the RPM drop on an upshift
          this.shiftTorqueCutRemaining = this.shiftTorqueCutSeconds; // brief torque cut (upshift only)
        }
        this.gear = decision.gear;
        this.shiftCooldown = this.automaticShiftCooldownSeconds;
      }
    }
    this.updateRpm(dt, throttle);

    const steerInput = controls.steerAxis ?? ((steerRight ? 1 : 0) - (steerLeft ? 1 : 0));
    // Wheels first: they deflect toward the input (eased), and that deflection
    // — not the raw key — is what steers the car.
    this.updateWheelSteer(dt, steerInput);
    this.applySteering(dt, steeringLongAccel, handbrake, surface);

    // Along velocityHeading (direction of travel), not heading (nose direction) —
    // normally identical, but they diverge mid-slide (see applySteering).
    this.position.x += Math.sin(this.velocityHeading) * this.speed * dt;
    this.position.y += Math.cos(this.velocityHeading) * this.speed * dt;
    // Visuals are applied at render time (syncVisuals) from the interpolated
    // pose, not here — physics only advances state.
  }

  /** R -> N -> 1 -> 2 -> 3 -> 4 -> 5, no clutch, one step per call. */
  private shiftUp(): void {
    if (this.shiftCooldown > 0) return;
    const next = Math.min(5, this.gear + 1);
    if (next === this.gear) return;
    this.gear = next;
    this.shiftCooldown = this.manualShiftCooldownSeconds;
    this.shiftBlendRemaining = this.shiftRpmBlendSeconds; // ease the RPM drop instead of teleporting
    this.shiftTorqueCutRemaining = this.shiftTorqueCutSeconds; // brief torque cut (upshift only)
  }

  /**
   * 5 -> 4 -> ... -> 1 -> N -> R, no clutch. Never rejected — an
   * aggressive downshift is more fun to hear and learn from than to
   * have silently refused. Instead it opens a brief window (see
   * updateRpm) where displayed RPM can scream up to
   * MAX_TRANSMISSION_RPM before settling into the normal limiter bounce.
   */
  private shiftDown(): void {
    if (this.shiftCooldown > 0) return;
    const candidate = this.gear - 1;
    if (candidate < -1) return;
    this.gear = candidate;
    this.shiftCooldown = this.manualShiftCooldownSeconds;
    this.downshiftSettleRemaining = this.downshiftSettleSeconds;
  }

  private updateRpm(dt: number, throttleOn: boolean): void {
    this.downshiftSettleRemaining = Math.max(0, this.downshiftSettleRemaining - dt);
    this.shiftBlendRemaining = Math.max(0, this.shiftBlendRemaining - dt);

    if (this.gear === 0) {
      // Neutral: free-revving, decoupled from road speed.
      const target = throttleOn ? this.car.redlineRpm * this.car.neutralRevTargetFraction : this.car.idleRpm;
      const rate = (throttleOn ? this.car.neutralRevRateUpRpmPerSec : this.car.neutralRevRateDownRpmPerSec) * dt;
      this.rpm = this.rpm < target ? Math.min(this.rpm + rate, target) : Math.max(this.rpm - rate, target);
      this.limiterPhase = 0;
      return;
    }

    const raw = rpmForGear(this.gear, this.speed, this.car);
    if (raw > this.car.redlineRpm) {
      if (this.downshiftSettleRemaining > 0) {
        // Fresh off an aggressive downshift: let it briefly scream above
        // redline (capped, not bouncing) instead of immediately clamping.
        this.limiterPhase = 0;
        this.rpm = Math.min(raw, this.car.maxTransmissionRpm);
      } else {
        // Pinned at redline with no recent downshift: rapidly bounce
        // against the limiter — the "time to shift" sound.
        this.limiterPhase += dt;
        const cycle = Math.floor(this.limiterPhase / this.limiterBouncePeriodSeconds) % 2;
        this.rpm = cycle === 0 ? this.car.redlineRpm : this.car.limiterRpm;
      }
    } else {
      this.limiterPhase = 0;
      const target = Math.max(this.car.idleRpm, raw);
      if (this.shiftBlendRemaining > 0) {
        // Just upshifted: ease the displayed RPM down to the new gear's
        // value over shiftRpmBlendSeconds instead of teleporting, so the
        // drop reads like a real gearchange. (Only meaningful right after an
        // upshift, where target is well below the current RPM; normal
        // acceleration changes raw too gradually for this to lag.)
        this.rpm += (target - this.rpm) * Math.min(1, dt / this.shiftRpmBlendSeconds);
      } else {
        this.rpm = target;
      }
    }
  }

  /**
   * Eases the front-wheel deflection toward the steer input (like a steering
   * rack, not an instant snap). This deflection is the steering input to
   * applySteering — the car turns in as the wheels come over — and it drives
   * the visible wheel angle too (rendered by syncVisuals). `steerInput` is
   * -1/0/+1.
   */
  private updateWheelSteer(dt: number, steerInput: number): void {
    // Speed-sensitive steering ratio: a full input produces less wheel lock
    // at speed (car.chassis.steeringRatioCurve), so the same input range
    // stays useful instead of the bicycle model's geometry making full lock
    // unmanageable once the friction circle is already involved.
    // wheelSteerSmoothPerSec (the physical wheel-response rate) is unaffected.
    this.currentMaxWheelSteer =
      this.car.chassis.wheelMaxSteerRad * interpolateCurve(Math.abs(this.speed), this.car.chassis.steeringRatioCurve);
    // Negated to match the heading convention (D / steer-right decreases
    // heading), so the wheels visibly point the way the car turns.
    const target = -steerInput * this.currentMaxWheelSteer;
    this.wheelSteer += (target - this.wheelSteer) * Math.min(1, this.car.chassis.wheelSteerSmoothPerSec * dt);
  }

  /**
   * Turns the car from the front-wheel deflection via a curvature-first
   * model, softly capped by a friction circle:
   *
   *   wheelFraction         = wheelSteer / currentMaxWheelSteer   [-1..1, how much of this frame's authority is used]
   *   geometricMaxCurvature = tan(wheelMaxSteerRad) / wheelbase   [constant: the parking-lot ceiling]
   *   gripMaxCurvature      = (hardMaxYaw / speed) * curvatureHeadroom   [shrinks with speed; hardMaxYaw already nets out longAccel]
   *   maxCurvature          = min(geometricMaxCurvature, gripMaxCurvature)
   *   desiredYaw            = speed * (wheelFraction * maxCurvature)
   *
   * Earlier this fed raw `(speed / wheelbase) * tan(wheelSteer)` — geometric
   * yaw demand — into the grip cap below. That demand grows with speed while
   * the grip cap shrinks as 1/speed, so at any real driving speed the demand
   * blew past the cap by 10-50x, meaning the soft knee below saturated in the
   * first few degrees of wheel angle and the rest of the wheel's travel did
   * nothing to the car's actual rotation — the "wheels spin independently of
   * the car" bug. Expressing the demand as a *curvature* (1/turn-radius)
   * scaled to what's actually achievable (`maxCurvature`) fixes that: full
   * lock now demands only `curvatureHeadroom`x the grip limit (a small,
   * constant overshoot, e.g. 1.2x) at any speed where grip binds, instead of
   * an unbounded multiple, so the soft knee below has the top of the wheel's
   * range to work with rather than just the first few degrees. At low speed
   * `geometricMaxCurvature` binds instead (grip headroom is huge there),
   * reproducing the old low-speed/parking behavior. `wheelFraction`'s
   * division by `currentMaxWheelSteer` (this frame's speed-scaled lock, see
   * updateWheelSteer) also cancels the speed-sensitive steering ratio out of
   * this calculation entirely — that ratio now only shapes the *visible*
   * wheel angle and the low-speed assist below, not this physics.
   *
   *   available lateral = sqrt(max(0, grip² − longAccel²))     [availableLateral()]
   *   yaw cap           = available lateral / speed   (lateral accel = speed * yaw)
   *
   * Unlike a hard clamp, the cap is progressive (softSaturate()): below
   * car.chassis.steeringGrip's cap (scaled by steeringSaturationKnee) the
   * curvature term passes through unshaped — "normal" cornering; beyond it,
   * response eases toward the tireGrip-based physical ceiling instead of
   * snapping straight to maximum. Accelerating or braking hard (`longAccel`,
   * measured this same step) eats into the same budget via availableLateral,
   * same for both grip values.
   *
   * Handbrake is a separate case, and deliberately keeps the *old* raw
   * geometric formula: the rear tires lose grip, so cornering is no longer
   * limited by the friction circle at all — yaw is driven almost directly by
   * steering geometry (not the grip-scaled curvature above, which would
   * undermine the point), up to a bounded handbrakeMaxYawRate (a stability
   * cap, not a tire limit). That's what lets the nose rotate faster than the
   * car's momentum can follow — see the velocityHeading blend below, which
   * is the actual slide. (The handbrake cap is not scaled by surface, and
   * isn't part of this pass's changes — see ENGINE_ROADMAP.md item 5.)
   *
   * `surface.gripMultiplier` scales both grip values, so off-road/shoulder
   * driving washes out into understeer at a much lower speed than on the
   * paved surface, same shape of behavior, just less grip to spend.
   *
   * `longAccel` here is `steeringLongAccel` from update() — the same
   * measured longitudinal accel EXCEPT while coasting, where it excludes
   * engine braking's contribution (see update()'s coastSteeringDecelOverride).
   * Testing found engine braking alone was consuming ~1g of the friction
   * circle while cornering, tightening every corner far more than intended
   * just from lifting off the throttle; active braking/accelerating still
   * count fully, since those are real driver-chosen tire demand.
   *
   * `chassis.gripBonusCurve` adds a speed-scaled "downforce" bonus to both
   * tireGrip and steeringGrip *before* the friction-circle calc above (not
   * as a separate additive yaw term afterward) — ~0 through parking/mid
   * speed (60-100mph testing showed the car using nearly all of base
   * tireGrip well before reaching highway speed, so low/mid-speed corners
   * keep today's tuning untouched), ramping up at highway speed where the
   * base grip alone left corners far wider than the game wants.
   *
   * No separate low-speed assist: `geometricMaxCurvature` above is already a
   * fixed, finite ceiling (not derived from grip, so it doesn't shrink to
   * nothing as speed drops), and since `desiredYaw = speed * curvature`, low
   * speed naturally produces smoothly-scaled-down yaw — proportional to how
   * far the car has actually rolled, not to how long the input's been held.
   * An earlier pass added a time-based assist here to make parking-lot
   * maneuvering feel responsive; measurement showed it let a car pumping the
   * throttle to creep (covering almost no ground) rack up 50°+ of rotation
   * in a few seconds — turning without traveling. Removed; reverse is still
   * separately capped at reverseMaxYawRate so it can't inherit an
   * unreasonably large yaw from the forward friction-circle math.
   */
  private applySteering(dt: number, longAccel: number, handbrake: boolean, surface: SurfaceState): void {
    if (this.wheelSteer === 0) {
      this.lastYawRate = 0;
      this.lastLateralAccel = 0;
      this.lastDesiredYaw = 0;
      this.lastHardMaxYaw = 0;
      this.lastGripLimited = false;
      this.lastSteeringLimited = false;
      this.lastTurnRadius = Infinity;
      this.blendVelocityHeading(dt, handbrake);
      return;
    }
    const chassis = this.car.chassis;
    const speedDivisor = Math.max(Math.abs(this.speed), 1);
    const softMaxYaw = availableLateral(effectiveGrip(chassis.steeringGrip, this.speed, this.car), surface, longAccel) / speedDivisor;
    const hardMaxYaw = availableLateral(effectiveGrip(chassis.tireGrip, this.speed, this.car), surface, longAccel) / speedDivisor;

    let yawRate: number;
    let desiredYaw: number;
    if (handbrake) {
      desiredYaw = (this.speed / chassis.wheelbase) * Math.tan(this.wheelSteer);
      yawRate = Math.max(-chassis.handbrakeMaxYawRate, Math.min(chassis.handbrakeMaxYawRate, desiredYaw));
    } else {
      const wheelFraction = this.wheelSteer / this.currentMaxWheelSteer;
      const geometricMaxCurvature = Math.tan(chassis.wheelMaxSteerRad) / chassis.wheelbase;
      // Reuses hardMaxYaw (not a fresh tireGrip/speed² calc) so this stays
      // consistent with the same longAccel-reduced budget the saturation
      // step below checks against -- otherwise braking/accelerating while
      // turning would make full lock's demand drift away from
      // curvatureHeadroom instead of tracking it.
      const gripMaxCurvature = (hardMaxYaw / speedDivisor) * chassis.curvatureHeadroom;
      const maxCurvature = Math.min(geometricMaxCurvature, gripMaxCurvature);
      desiredYaw = this.speed * (wheelFraction * maxCurvature);
      yawRate = softSaturate(desiredYaw, softMaxYaw * chassis.steeringSaturationKnee, hardMaxYaw);
    }

    if (this.speed < 0) yawRate = Math.max(-chassis.reverseMaxYawRate, Math.min(chassis.reverseMaxYawRate, yawRate));

    this.heading += yawRate * dt;
    this.lastYawRate = yawRate;
    this.lastLateralAccel = Math.abs(this.speed * yawRate);
    this.lastDesiredYaw = desiredYaw;
    this.lastHardMaxYaw = hardMaxYaw;
    // Demand crossed the soft-knee threshold => understeer is starting (not
    // meaningful under handbrake, which bypasses the friction circle).
    this.lastGripLimited = !handbrake && Math.abs(desiredYaw) > softMaxYaw * chassis.steeringSaturationKnee;
    // At full (speed-scaled) lock and still not grip-limited => running out of
    // steering angle, not grip (only happens at very low speed). Distinguishing
    // the two makes it clear whether more grip would even help.
    const atFullLock = Math.abs(this.wheelSteer) >= this.currentMaxWheelSteer - 1e-3;
    this.lastSteeringLimited = atFullLock && !this.lastGripLimited;
    this.lastTurnRadius = Math.abs(yawRate) > 1e-4 ? Math.abs(this.speed / yawRate) : Infinity;
    this.blendVelocityHeading(dt, handbrake);
  }

  /**
   * Eases velocityHeading (direction of travel) toward heading (nose
   * direction). Holding the handbrake slows the chase way down, so heading
   * can swing ahead of velocityHeading — that gap is the slide. Off the
   * handbrake, it catches up fast, but below chassis.slipCatchEpsilonRad it
   * snaps exactly instead of asymptotically approaching: a continuous blend
   * toward a moving target always has a small nonzero steady-state lag, even
   * starting from equality, and ordinary grip-limited steering's per-step
   * heading change is small enough to fall under that threshold every step —
   * so normal (never-slid) cornering stays exactly lag-free, and only an
   * actual handbrake slide's much larger offset takes the blended path.
   */
  private blendVelocityHeading(dt: number, handbrake: boolean): void {
    const chassis = this.car.chassis;
    if (handbrake) {
      this.velocityHeading += angleDelta(this.velocityHeading, this.heading) * Math.min(1, chassis.slipHoldPerSec * dt);
      return;
    }
    const remaining = angleDelta(this.velocityHeading, this.heading);
    if (Math.abs(remaining) < chassis.slipCatchEpsilonRad) {
      this.velocityHeading = this.heading;
    } else {
      this.velocityHeading += remaining * Math.min(1, chassis.slipRecoveryPerSec * dt);
    }
  }

  /** "R", "N", or the forward gear number — for the HUD. */
  get gearLabel(): string {
    if (this.gear === -1) return "R";
    if (this.gear === 0) return "N";
    return String(this.gear);
  }

  /** Uncapped RPM implied by the current gear/speed alone — the raw value this.rpm is clamped from, for debug telemetry. */
  get targetRpm(): number {
    return this.gear === 0 ? this.rpm : rpmForGear(this.gear, this.speed, this.car);
  }

  /** What the automatic transmission wants this frame — equals `gear` once shiftCooldown allows acting on it; differs from it (visibly, in telemetry) if the cooldown is currently blocking a shift. Manual mode: always equals `gear`. Debug telemetry. */
  get desiredGear(): number {
    return transmissionSettings.mode === "manual" ? this.gear : this.lastAutomaticDesiredGear;
  }

  /** Why the automatic transmission's desiredGear is what it is this frame ("upshift"/"downshift"/"kickdown"/"hold"). Manual mode: always "hold". Debug telemetry. */
  get shiftReason(): AutomaticShiftReason {
    return transmissionSettings.mode === "manual" ? "hold" : this.lastAutomaticShiftReason;
  }

  /** This gear's acceleration multiplier — 0 in Neutral, for debug telemetry. */
  get accelMultiplier(): number {
    return this.gear === 0 ? 0 : accelerationMultiplierForGear(this.gear, this.car);
  }

  /** Engine torque fraction (0..1) at the current drivetrain RPM — 0 in Neutral. Telemetry. */
  get engineTorque(): number {
    return this.gear === 0 ? 0 : engineTorqueFraction(rpmForGear(this.gear, this.speed, this.car), this.car);
  }

  /** Longitudinal acceleration measured last frame, m/s^2 (negative under braking). Telemetry. */
  get longitudinalAccel(): number {
    return this.lastLongAccel;
  }

  /** Front-wheel deflection, degrees. Telemetry. */
  get wheelSteerDeg(): number {
    return (this.wheelSteer * 180) / Math.PI;
  }

  /** Yaw rate last frame, degrees/second. Telemetry. */
  get yawRateDeg(): number {
    return (this.lastYawRate * 180) / Math.PI;
  }

  /** Lateral (cornering) acceleration last frame, m/s^2. Telemetry. */
  get lateralAccel(): number {
    return this.lastLateralAccel;
  }

  /** Yaw demanded by steering geometry alone last frame, degrees/second — before any grip softening, low-speed assist, or reverse cap. Telemetry. */
  get desiredYawDeg(): number {
    return (this.lastDesiredYaw * 180) / Math.PI;
  }

  /** Fraction of the physical (tireGrip-based) yaw ceiling demanded last frame — 0 = no demand, 1 = at the limit, briefly >1 for an aggressive input the soft knee is still easing back. Telemetry. */
  get gripUtilization(): number {
    return this.lastHardMaxYaw > 0 ? Math.abs(this.lastDesiredYaw) / this.lastHardMaxYaw : 0;
  }

  /** Whether steering demand has crossed the soft-knee threshold (understeer starting) last frame. Telemetry. */
  get isGripLimited(): boolean {
    return this.lastGripLimited;
  }

  /** What (if anything) is limiting cornering right now — for tuning. Telemetry. */
  get steeringLimit(): "grip" | "steering" | "none" {
    if (this.lastGripLimited) return "grip";
    if (this.lastSteeringLimited) return "steering";
    return "none";
  }

  /** Current turn radius in meters (|speed / yawRate|); 0 reported when going straight. Telemetry. */
  get turnRadiusM(): number {
    return Number.isFinite(this.lastTurnRadius) ? this.lastTurnRadius : 0;
  }

  /** Whether the post-upshift torque cut is currently active. Telemetry. */
  get shiftTorqueCutActive(): boolean {
    return this.shiftTorqueCutRemaining > 0;
  }

  /** Milliseconds left in the post-upshift torque cut (0 when inactive). Telemetry. */
  get shiftTorqueCutRemainingMs(): number {
    return this.shiftTorqueCutRemaining * 1000;
  }

  /** Angle between nose direction and direction of travel, degrees — 0 unless mid-slide. Telemetry. */
  get driftAngleDeg(): number {
    return (angleDelta(this.velocityHeading, this.heading) * 180) / Math.PI;
  }

  /** True once the drift angle is large enough to read as an actual slide, not steering noise. Telemetry. */
  get isDrifting(): boolean {
    return Math.abs(this.driftAngleDeg) > 5;
  }

  /** Teleports the car to a new position/heading (e.g. spawning onto a track) and resets speed/gear/RPM. */
  respawn(position: Vec3, headingRad: number): void {
    this.position = { ...position };
    this.heading = headingRad;
    this.velocityHeading = headingRad;
    this.speed = 0;
    this.gear = 1;
    this.rpm = this.car.idleRpm;
    this.limiterPhase = 0;
    this.downshiftSettleRemaining = 0;
    this.shiftBlendRemaining = 0;
    this.shiftTorqueCutRemaining = 0;
    this.shiftThrottleState = true;
    this.throttleLiftMs = 0;
    this.wheelSteer = 0;
    // Collapse interpolation history onto the new pose so we don't tween across
    // the teleport, then place the visuals immediately.
    this.prevPosition.x = this.position.x;
    this.prevPosition.y = this.position.y;
    this.prevPosition.z = this.position.z;
    this.prevHeading = this.heading;
    this.prevWheelSteer = this.wheelSteer;
    this.updateRenderPose(1);
  }

  /**
   * Computes the interpolated pose at factor `alpha` (0..1) between the
   * previous and current physics poses, so a variable-rate render loop stays
   * smooth over fixed-step physics — publishing renderPosition/renderHeading/
   * renderWheelSteer for PlayerView (and the camera, which follows
   * renderPosition) to read. Pure state, no rendering: heading/steer use plain
   * lerp since consecutive physics poses differ by at most one small step, so
   * there's no angle-wrap concern.
   */
  updateRenderPose(alpha: number): void {
    this.renderPosition.x = this.prevPosition.x + (this.position.x - this.prevPosition.x) * alpha;
    this.renderPosition.y = this.prevPosition.y + (this.position.y - this.prevPosition.y) * alpha;
    this.renderPosition.z = this.prevPosition.z + (this.position.z - this.prevPosition.z) * alpha;
    this.renderHeading = this.prevHeading + (this.heading - this.prevHeading) * alpha;
    this.renderWheelSteer = this.prevWheelSteer + (this.wheelSteer - this.prevWheelSteer) * alpha;
  }
}
