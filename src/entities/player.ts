import * as THREE from "three";
import type { Vec3 } from "../math/vector3.js";
import type { Input } from "../engine/input.js";
import { createCar, createWheel, WHEEL_OFFSETS } from "../graphics/procedural.js";
import { createMeshObject } from "../graphics/toThreeGeometry.js";
import { toThreeVector3 } from "../graphics/coordinates.js";
import { transmissionSettings } from "../util/transmissionSettings.js";
import { rpmForGear, accelerationMultiplierForGear } from "../util/engineModel.js";
import {
  MAX_SPEED,
  MAX_REVERSE_SPEED,
  ACCELERATION,
  BRAKE_FORCE,
  HANDBRAKE_FORCE,
  FRICTION,
  STEERING_RATE,
  MIN_STEER_SPEED_FACTOR,
  IDLE_RPM,
  REDLINE_RPM,
  LIMITER_RPM,
  AUTOMATIC_UPSHIFT_RPM,
  AUTOMATIC_DOWNSHIFT_RPM,
} from "../util/constants.js";

const CAR_BODY_MESH = createCar();
const WHEEL_MESH = createWheel();

/** How rapidly RPM free-revs in Neutral (no road speed to derive it from). */
const NEUTRAL_REV_RATE_UP = 6000; // RPM/second, throttle held
const NEUTRAL_REV_RATE_DOWN = 4000; // RPM/second, throttle released
const NEUTRAL_REV_TARGET_FRACTION = 0.75; // of redline, when throttle held
const LIMITER_BOUNCE_PERIOD = 0.07; // seconds per REDLINE/LIMITER toggle, while pinned

/** Auto-selects a forward gear (1-5) by RPM thresholds — never chooses Neutral/Reverse. */
function automaticGearFor(currentGear: number, speed: number): number {
  let gear = Math.max(1, currentGear);
  while (gear < 5 && rpmForGear(gear, speed) > AUTOMATIC_UPSHIFT_RPM) gear++;
  while (gear > 1 && rpmForGear(gear, speed) < AUTOMATIC_DOWNSHIFT_RPM) gear--;
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
 * a downshift jumps it — which is what makes shifting audible; a
 * downshift that would send RPM past redline is rejected outright.
 * Brake is a plain brake in this mode; reverse is only reached via Q.
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

  readonly object3D = new THREE.Group();

  constructor() {
    this.object3D.add(createMeshObject(CAR_BODY_MESH));

    for (const offset of WHEEL_OFFSETS) {
      const wheel = createMeshObject(WHEEL_MESH);
      wheel.position.copy(toThreeVector3(offset));
      this.object3D.add(wheel);
    }
  }

  update(dt: number, input: Input): void {
    const throttle = input.isHeld("w");
    const steerLeft = input.isHeld("a");
    const steerRight = input.isHeld("d");
    const brake = input.isHeld("s");
    const handbrake = input.isHeld("space");
    const manual = transmissionSettings.mode === "manual";

    if (manual) {
      if (input.wasPressed("e")) this.shiftUp();
      if (input.wasPressed("q")) this.shiftDown();
    }

    const engaged = this.gear !== 0; // false only in Neutral
    const direction = this.gear === -1 ? -1 : 1;

    if (throttle && engaged) {
      const limiting = rpmForGear(this.gear, this.speed) > REDLINE_RPM;
      const accel = ACCELERATION * accelerationMultiplierForGear(this.gear) * (limiting ? 0.1 : 1);
      const cap = this.gear === -1 ? MAX_REVERSE_SPEED : MAX_SPEED;
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

    if (!manual) {
      this.gear = this.speed < -0.3 ? -1 : automaticGearFor(this.gear > 0 ? this.gear : 1, this.speed);
    }
    this.updateRpm(dt, throttle);

    const steerInput = (steerRight ? 1 : 0) - (steerLeft ? 1 : 0);
    if (steerInput !== 0 && this.speed !== 0) {
      const speedFactor =
        MIN_STEER_SPEED_FACTOR +
        (1 - MIN_STEER_SPEED_FACTOR) * (Math.abs(this.speed) / MAX_SPEED);
      // Steering direction flips in reverse, matching real-world driving.
      const reverseSign = this.speed < 0 ? -1 : 1;
      // Negated: given the camera's lookAt-derived orientation, increasing
      // heading (world +X-ward) reads as screen-LEFT, not screen-right —
      // so steerRight (D) must decrease heading to visually turn right.
      this.heading -= steerInput * reverseSign * STEERING_RATE * speedFactor * dt;
    }

    this.position.x += Math.sin(this.heading) * this.speed * dt;
    this.position.y += Math.cos(this.heading) * this.speed * dt;

    this.syncObject3D();
  }

  /** R -> N -> 1 -> 2 -> 3 -> 4 -> 5, no clutch, one step per call. */
  private shiftUp(): void {
    this.gear = Math.min(5, this.gear + 1);
  }

  /** 5 -> 4 -> ... -> 1 -> N -> R, no clutch. Rejects a downshift that would send RPM past redline. */
  private shiftDown(): void {
    const candidate = this.gear - 1;
    if (candidate < -1) return;
    if (candidate >= 1 && rpmForGear(candidate, this.speed) > REDLINE_RPM) return;
    this.gear = candidate;
  }

  private updateRpm(dt: number, throttleOn: boolean): void {
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
      // Pinned at redline: rapidly bounce against the limiter — the "time to shift" sound.
      this.limiterPhase += dt;
      const cycle = Math.floor(this.limiterPhase / LIMITER_BOUNCE_PERIOD) % 2;
      this.rpm = cycle === 0 ? REDLINE_RPM : LIMITER_RPM;
    } else {
      this.limiterPhase = 0;
      this.rpm = Math.max(IDLE_RPM, raw);
    }
  }

  /** "R", "N", or the forward gear number — for the HUD. */
  get gearLabel(): string {
    if (this.gear === -1) return "R";
    if (this.gear === 0) return "N";
    return String(this.gear);
  }

  /** Teleports the car to a new position/heading (e.g. spawning onto a track) and resets speed/gear/RPM. */
  respawn(position: Vec3, headingRad: number): void {
    this.position = { ...position };
    this.heading = headingRad;
    this.speed = 0;
    this.gear = 1;
    this.rpm = IDLE_RPM;
    this.limiterPhase = 0;
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
