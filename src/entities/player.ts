import * as THREE from "three";
import type { Vec3 } from "../math/vector3.js";
import type { Input } from "../engine/input.js";
import { createCar, createWheel, WHEEL_OFFSETS } from "../graphics/procedural.js";
import { createMeshObject } from "../graphics/toThreeGeometry.js";
import { toThreeVector3 } from "../graphics/coordinates.js";
import { transmissionSettings } from "../util/transmissionSettings.js";
import { rpmForGear, accelerationMultiplierForGear, engineTorqueFraction } from "../util/engineModel.js";
import {
  MAX_SPEED,
  MAX_REVERSE_SPEED,
  ACCELERATION,
  BRAKE_FORCE,
  HANDBRAKE_FORCE,
  FRICTION,
  VEHICLE_WHEELBASE,
  TIRE_GRIP,
  WHEEL_MAX_STEER_RAD,
  WHEEL_STEER_SMOOTH_PER_SEC,
  TOP_SPEED_FALLOFF,
  IDLE_RPM,
  REDLINE_RPM,
  LIMITER_RPM,
  MAX_TRANSMISSION_RPM,
  MANUAL_SHIFT_COOLDOWN_MS,
  AUTOMATIC_SHIFT_COOLDOWN_MS,
  DOWNSHIFT_SETTLE_MS,
  SHIFT_RPM_BLEND_MS,
  SHIFT_TORQUE_CUT_MS,
  SHIFT_TORQUE_CUT_FACTOR,
  AUTOMATIC_UPSHIFT_RPM,
  AUTOMATIC_COAST_UPSHIFT_RPM,
  AUTOMATIC_DOWNSHIFT_RPM,
  AUTOMATIC_BRAKE_DOWNSHIFT_RPM,
  AUTOMATIC_KICKDOWN_RPM,
  AUTOMATIC_KICKDOWN_MIN_GAIN,
  AUTOMATIC_MAX_DOWNSHIFT_RPM,
} from "../util/constants.js";

const CAR_BODY_MESH = createCar();
const WHEEL_MESH = createWheel();

/** How rapidly RPM free-revs in Neutral (no road speed to derive it from). */
const NEUTRAL_REV_RATE_UP = 6000; // RPM/second, throttle held
const NEUTRAL_REV_RATE_DOWN = 4000; // RPM/second, throttle released
const NEUTRAL_REV_TARGET_FRACTION = 0.75; // of redline, when throttle held
const LIMITER_BOUNCE_PERIOD = 0.07; // seconds per REDLINE/LIMITER toggle, while pinned
const MANUAL_SHIFT_COOLDOWN_SECONDS = MANUAL_SHIFT_COOLDOWN_MS / 1000;
const AUTOMATIC_SHIFT_COOLDOWN_SECONDS = AUTOMATIC_SHIFT_COOLDOWN_MS / 1000;
const DOWNSHIFT_SETTLE_SECONDS = DOWNSHIFT_SETTLE_MS / 1000;
const SHIFT_RPM_BLEND_SECONDS = SHIFT_RPM_BLEND_MS / 1000;
const SHIFT_TORQUE_CUT_SECONDS = SHIFT_TORQUE_CUT_MS / 1000;

/**
 * Picks the automatic gear one step at a time (never Neutral/Reverse). Three
 * behaviors, throttle/brake-aware so the box has character rather than being
 * a plain RPM selector:
 *
 *   - RPM too high         -> upshift (later, flat out; earlier when coasting)
 *   - RPM too low          -> downshift (sooner under braking)
 *   - Throttle + weak pull -> kickdown one gear, if a lower gear makes
 *                             meaningfully more torque and wouldn't overspeed
 *                             the engine (AUTOMATIC_MAX_DOWNSHIFT_RPM)
 *
 * Kickdown is the piece a threshold selector misses — it's why flooring it in
 * a tall gear at speed grabs a lower gear instead of lugging. The single-step
 * behavior plus the shift cooldown keep it from jumping several gears at once,
 * and the RPM ceiling keeps the automatic from ever doing the theatrical
 * over-redline downshift that manual mode is allowed.
 */
function automaticGearFor(currentGear: number, speed: number, throttle: boolean, brake: boolean): number {
  const gear = Math.max(1, Math.min(5, currentGear));
  const rpm = rpmForGear(gear, speed);

  // Full-throttle kickdown: below the useful band, drop a gear if it pays off.
  if (throttle && gear > 1 && rpm < AUTOMATIC_KICKDOWN_RPM) {
    const lowerGear = gear - 1;
    const lowerRpm = rpmForGear(lowerGear, speed);
    if (lowerRpm <= AUTOMATIC_MAX_DOWNSHIFT_RPM) {
      const currentTorque = accelerationMultiplierForGear(gear) * engineTorqueFraction(rpm);
      const lowerTorque = accelerationMultiplierForGear(lowerGear) * engineTorqueFraction(lowerRpm);
      if (lowerTorque > currentTorque * (1 + AUTOMATIC_KICKDOWN_MIN_GAIN)) return lowerGear;
    }
  }

  const upshiftRpm = throttle ? AUTOMATIC_UPSHIFT_RPM : AUTOMATIC_COAST_UPSHIFT_RPM;
  const downshiftRpm = brake ? AUTOMATIC_BRAKE_DOWNSHIFT_RPM : AUTOMATIC_DOWNSHIFT_RPM;
  if (gear < 5 && rpm >= upshiftRpm) return gear + 1;
  if (gear > 1 && rpm <= downshiftRpm) return gear - 1;
  return gear;
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
 * Wheels are separate objects (their own mesh, their own Object3D) but
 * are added as children of object3D at fixed local offsets, so the
 * scene graph handles rotating/translating them with the car body for
 * free — no manual per-wheel offset rotation needed.
 */
export class Player {
  position: Vec3 = { x: 0, y: 0, z: 0 };
  heading = 0; // radians; 0 = facing +Y (straight down the road)
  speed = 0;
  gear = 1; // -1 = reverse, 0 = neutral, 1-5 = forward
  rpm = IDLE_RPM;
  private limiterPhase = 0;
  private shiftCooldown = 0; // seconds remaining before another gear change is allowed
  private downshiftSettleRemaining = 0; // seconds remaining in the post-downshift RPM overshoot window
  private shiftBlendRemaining = 0; // seconds remaining easing displayed RPM down after an upshift
  private shiftTorqueCutRemaining = 0; // seconds remaining in the post-upshift torque interruption
  private readonly frontWheels: THREE.Mesh[] = []; // steerable front wheels (rear wheels stay fixed)
  private wheelSteer = 0; // current front-wheel yaw in radians, eased toward the steer target
  // Per-frame telemetry snapshots (read via getters for the debug panel).
  private lastLongAccel = 0; // longitudinal acceleration, m/s^2 (negative under braking)
  private lastYawRate = 0; // rad/s
  private lastLateralAccel = 0; // m/s^2
  private lastGripLimited = false; // was the steering capped by tire grip (understeering)

  readonly object3D = new THREE.Group();

  constructor() {
    this.object3D.add(createMeshObject(CAR_BODY_MESH));

    for (const offset of WHEEL_OFFSETS) {
      const wheel = createMeshObject(WHEEL_MESH);
      wheel.position.copy(toThreeVector3(offset));
      this.object3D.add(wheel);
      // Front wheels sit ahead of the car's center (+Y forward); keep refs
      // so update() can yaw them with the steering. Rears stay fixed.
      if (offset.y > 0) this.frontWheels.push(wheel);
    }
  }

  update(dt: number, input: Input): void {
    const throttle = input.isHeld("w");
    const steerLeft = input.isHeld("a");
    const steerRight = input.isHeld("d");
    const brake = input.isHeld("s");
    const handbrake = input.isHeld("space");
    const manual = transmissionSettings.mode === "manual";
    const speedBefore = this.speed; // for longitudinal-accel telemetry
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    this.shiftTorqueCutRemaining = Math.max(0, this.shiftTorqueCutRemaining - dt);

    if (manual) {
      if (input.wasPressed("e")) this.shiftUp();
      if (input.wasPressed("q")) this.shiftDown();
    }

    const engaged = this.gear !== 0; // false only in Neutral
    const direction = this.gear === -1 ? -1 : 1;

    if (throttle && engaged) {
      const cap = this.gear === -1 ? MAX_REVERSE_SPEED : MAX_SPEED;
      // Torque chain: engine torque at the current RPM * the gear's torque
      // multiplier, trimmed by a light aerodynamic-drag falloff toward the
      // speed cap. The engine torque curve is fat mid-range and falls to
      // zero at redline, so a gear still can't pull past its own redline
      // speed (accel hits 0 there — gears keep mattering), and every upshift
      // drops the revs back into the fat part of the curve: surge, drop,
      // surge. See engineModel.ts.
      const enginePower = engineTorqueFraction(rpmForGear(this.gear, this.speed));
      const speedRatio = Math.min(Math.abs(this.speed) / cap, 1);
      const dragFalloff = 1 - Math.pow(speedRatio, 3) * TOP_SPEED_FALLOFF;
      // Brief torque interruption right after an upshift (see constants) — a
      // physical "thump" between gears, not a lingering nerf.
      const shiftTorqueFactor = this.shiftTorqueCutRemaining > 0 ? SHIFT_TORQUE_CUT_FACTOR : 1;
      const accel =
        ACCELERATION *
        accelerationMultiplierForGear(this.gear) *
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
      const decel = HANDBRAKE_FORCE * dt;
      this.speed = this.speed > 0 ? Math.max(0, this.speed - decel) : Math.min(0, this.speed + decel);
    } else if (brake) {
      if (manual) {
        // Plain brake — reverse is only reached by shifting to R.
        this.speed = this.speed > 0 ? Math.max(0, this.speed - BRAKE_FORCE * dt) : Math.min(0, this.speed + BRAKE_FORCE * dt);
      } else {
        // Automatic mode keeps the simple "hold brake past zero to back up" shortcut.
        this.speed -= BRAKE_FORCE * dt;
      }
    } else {
      this.speed -= Math.sign(this.speed) * FRICTION * dt;
      if (Math.abs(this.speed) < FRICTION * dt) this.speed = 0;
    }
    this.speed = Math.max(-MAX_REVERSE_SPEED, Math.min(MAX_SPEED, this.speed));

    if (!manual && this.shiftCooldown <= 0) {
      const target =
        this.speed < -0.3 ? -1 : automaticGearFor(this.gear > 0 ? this.gear : 1, this.speed, throttle, brake);
      if (target !== this.gear) {
        if (target > this.gear) {
          this.shiftBlendRemaining = SHIFT_RPM_BLEND_SECONDS; // ease the RPM drop on an upshift
          this.shiftTorqueCutRemaining = SHIFT_TORQUE_CUT_SECONDS; // brief torque cut (upshift only)
        }
        this.gear = target;
        this.shiftCooldown = AUTOMATIC_SHIFT_COOLDOWN_SECONDS;
      }
    }
    this.updateRpm(dt, throttle);

    const steerInput = (steerRight ? 1 : 0) - (steerLeft ? 1 : 0);
    // Wheels first: they deflect toward the input (eased), and that deflection
    // — not the raw key — is what steers the car.
    this.updateWheelSteer(dt, steerInput);
    this.applySteering(dt);

    this.position.x += Math.sin(this.heading) * this.speed * dt;
    this.position.y += Math.cos(this.heading) * this.speed * dt;

    this.lastLongAccel = dt > 0 ? (this.speed - speedBefore) / dt : 0;
    this.syncObject3D();
  }

  /** R -> N -> 1 -> 2 -> 3 -> 4 -> 5, no clutch, one step per call. */
  private shiftUp(): void {
    if (this.shiftCooldown > 0) return;
    const next = Math.min(5, this.gear + 1);
    if (next === this.gear) return;
    this.gear = next;
    this.shiftCooldown = MANUAL_SHIFT_COOLDOWN_SECONDS;
    this.shiftBlendRemaining = SHIFT_RPM_BLEND_SECONDS; // ease the RPM drop instead of teleporting
    this.shiftTorqueCutRemaining = SHIFT_TORQUE_CUT_SECONDS; // brief torque cut (upshift only)
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
    this.shiftCooldown = MANUAL_SHIFT_COOLDOWN_SECONDS;
    this.downshiftSettleRemaining = DOWNSHIFT_SETTLE_SECONDS;
  }

  private updateRpm(dt: number, throttleOn: boolean): void {
    this.downshiftSettleRemaining = Math.max(0, this.downshiftSettleRemaining - dt);
    this.shiftBlendRemaining = Math.max(0, this.shiftBlendRemaining - dt);

    if (this.gear === 0) {
      // Neutral: free-revving, decoupled from road speed.
      const target = throttleOn ? REDLINE_RPM * NEUTRAL_REV_TARGET_FRACTION : IDLE_RPM;
      const rate = (throttleOn ? NEUTRAL_REV_RATE_UP : NEUTRAL_REV_RATE_DOWN) * dt;
      this.rpm = this.rpm < target ? Math.min(this.rpm + rate, target) : Math.max(this.rpm - rate, target);
      this.limiterPhase = 0;
      return;
    }

    const raw = rpmForGear(this.gear, this.speed);
    if (raw > REDLINE_RPM) {
      if (this.downshiftSettleRemaining > 0) {
        // Fresh off an aggressive downshift: let it briefly scream above
        // redline (capped, not bouncing) instead of immediately clamping.
        this.limiterPhase = 0;
        this.rpm = Math.min(raw, MAX_TRANSMISSION_RPM);
      } else {
        // Pinned at redline with no recent downshift: rapidly bounce
        // against the limiter — the "time to shift" sound.
        this.limiterPhase += dt;
        const cycle = Math.floor(this.limiterPhase / LIMITER_BOUNCE_PERIOD) % 2;
        this.rpm = cycle === 0 ? REDLINE_RPM : LIMITER_RPM;
      }
    } else {
      this.limiterPhase = 0;
      const target = Math.max(IDLE_RPM, raw);
      if (this.shiftBlendRemaining > 0) {
        // Just upshifted: ease the displayed RPM down to the new gear's
        // value over SHIFT_RPM_BLEND_SECONDS instead of teleporting, so the
        // drop reads like a real gearchange. (Only meaningful right after an
        // upshift, where target is well below the current RPM; normal
        // acceleration changes raw too gradually for this to lag.)
        this.rpm += (target - this.rpm) * Math.min(1, dt / SHIFT_RPM_BLEND_SECONDS);
      } else {
        this.rpm = target;
      }
    }
  }

  /**
   * Eases the front-wheel deflection toward the steer input (like a steering
   * rack, not an instant snap) and rotates the wheel meshes to match. This
   * is both what you see AND the steering input to applySteering — so the
   * wheels swing while parked, and the car turns in as they come over.
   * `steerInput` is -1/0/+1.
   */
  private updateWheelSteer(dt: number, steerInput: number): void {
    // Negated to match the heading convention (D / steer-right decreases
    // heading), so the wheels visibly point the way the car turns.
    const target = -steerInput * WHEEL_MAX_STEER_RAD;
    this.wheelSteer += (target - this.wheelSteer) * Math.min(1, WHEEL_STEER_SMOOTH_PER_SEC * dt);
    for (const wheel of this.frontWheels) wheel.rotation.y = this.wheelSteer;
  }

  /**
   * Turns the car from the front-wheel deflection using a kinematic bicycle
   * model, capped by tire grip:
   *
   *   desired yaw = (speed / wheelbase) * tan(wheel deflection)
   *   grip cap    = TIRE_GRIP / speed         (since lateral accel = speed * yaw)
   *
   * The geometry term means the car only turns while rolling and turns
   * harder the faster it goes for a given lock; the grip cap means the
   * contact patches can only bend the path so hard, so at speed the car
   * washes out into understeer rather than pivoting. Reverse falls out for
   * free: negative speed flips the yaw sign.
   */
  private applySteering(dt: number): void {
    if (this.wheelSteer === 0 || this.speed === 0) {
      this.lastYawRate = 0;
      this.lastLateralAccel = 0;
      this.lastGripLimited = false;
      return;
    }
    const desiredYaw = (this.speed / VEHICLE_WHEELBASE) * Math.tan(this.wheelSteer);
    const maxYaw = TIRE_GRIP / Math.max(Math.abs(this.speed), 1);
    const yawRate = Math.max(-maxYaw, Math.min(maxYaw, desiredYaw));
    this.heading += yawRate * dt;
    this.lastYawRate = yawRate;
    this.lastLateralAccel = Math.abs(this.speed * yawRate);
    this.lastGripLimited = Math.abs(desiredYaw) > maxYaw;
  }

  /** "R", "N", or the forward gear number — for the HUD. */
  get gearLabel(): string {
    if (this.gear === -1) return "R";
    if (this.gear === 0) return "N";
    return String(this.gear);
  }

  /** Uncapped RPM implied by the current gear/speed alone — the raw value this.rpm is clamped from, for debug telemetry. */
  get targetRpm(): number {
    return this.gear === 0 ? this.rpm : rpmForGear(this.gear, this.speed);
  }

  /** This gear's acceleration multiplier — 0 in Neutral, for debug telemetry. */
  get accelMultiplier(): number {
    return this.gear === 0 ? 0 : accelerationMultiplierForGear(this.gear);
  }

  /** Engine torque fraction (0..1) at the current drivetrain RPM — 0 in Neutral. Telemetry. */
  get engineTorque(): number {
    return this.gear === 0 ? 0 : engineTorqueFraction(rpmForGear(this.gear, this.speed));
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

  /** Whether steering was capped by tire grip (understeering) last frame. Telemetry. */
  get isGripLimited(): boolean {
    return this.lastGripLimited;
  }

  /** Whether the post-upshift torque cut is currently active. Telemetry. */
  get shiftTorqueCutActive(): boolean {
    return this.shiftTorqueCutRemaining > 0;
  }

  /** Milliseconds left in the post-upshift torque cut (0 when inactive). Telemetry. */
  get shiftTorqueCutRemainingMs(): number {
    return this.shiftTorqueCutRemaining * 1000;
  }

  /** Teleports the car to a new position/heading (e.g. spawning onto a track) and resets speed/gear/RPM. */
  respawn(position: Vec3, headingRad: number): void {
    this.position = { ...position };
    this.heading = headingRad;
    this.speed = 0;
    this.gear = 1;
    this.rpm = IDLE_RPM;
    this.limiterPhase = 0;
    this.downshiftSettleRemaining = 0;
    this.shiftBlendRemaining = 0;
    this.shiftTorqueCutRemaining = 0;
    this.wheelSteer = 0;
    for (const wheel of this.frontWheels) wheel.rotation.y = 0;
    this.syncObject3D();
  }

  private syncObject3D(): void {
    this.object3D.position.copy(toThreeVector3(this.position));
    // Our world's Y (forward) maps to Three's Z, and our heading convention
    // (0 = facing +Y, positive = turning toward +X) matches THREE's
    // rotation.y directly once that axis remap is applied — no sign flip.
    this.object3D.rotation.y = this.heading;
  }
}
