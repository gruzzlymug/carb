import { interpolateCurve } from "../math/curve.js";
import type { SurfaceState } from "../world/surfaceState.js";
import { rpmForGear, accelerationMultiplierForGear, engineTorqueFraction } from "./engineModel.js";
import type { CarConfig } from "./cars/index.js";

/**
 * Shared grip/braking definitions used by both Player's per-frame steering
 * (entities/player.ts) and the AI's racing-line/speed-profile planner
 * (world/racingLine.ts, world/speedProfile.ts) — kept in one place so
 * retuning the car's physics can't let the two drift apart, the way the
 * AI's old plain sqrt(tireGrip/curvature) drifted from Player's
 * steeringGrip/curvatureHeadroom/gripBonusCurve model.
 */

/** tireGrip/steeringGrip plus the speed-scaled downforce bonus (gripBonusCurve) -- before any surface multiplier or longitudinal-accel budget. */
export function effectiveGrip(baseGrip: number, speed: number, car: CarConfig): number {
  return baseGrip + interpolateCurve(Math.abs(speed), car.chassis.gripBonusCurve);
}

/** sqrt(max(0, grip^2 - longAccel^2)) at the given surface -- the friction-circle budget left for cornering after longitudinal accel spends some of it. */
export function availableLateral(grip: number, surface: SurfaceState, longAccel: number): number {
  const g = grip * surface.gripMultiplier;
  return Math.sqrt(Math.max(0, g * g - longAccel * longAccel));
}

/**
 * Theoretical sustainable-cornering speed ceiling for the given curvature
 * (1/turn-radius) at zero longitudinal accel: lateralAccel = speed^2 *
 * curvature = effectiveGrip(speed). Since effectiveGrip depends on speed
 * (gripBonusCurve) and speed depends on effectiveGrip, this is a small
 * fixed-point problem -- start from the grip-at-zero-speed estimate and
 * iterate a handful of times (gripBonusCurve is smooth/monotonic, converges
 * fast). Uses tireGrip (the hard physical cap), not steeringGrip.
 *
 * This is a physical ceiling, not "the speed the AI should drive at" --
 * margin/conservatism belongs in the speed-profile/tuning layer, not here.
 */
export function maxCornerSpeed(curvature: number, car: CarConfig, surfaceGripMultiplier = 1): number {
  const absCurvature = Math.abs(curvature);
  if (absCurvature < 1e-9) return car.maxSpeed;
  let speed = Math.sqrt((car.chassis.tireGrip * surfaceGripMultiplier) / absCurvature);
  for (let i = 0; i < 6; i++) {
    const grip = effectiveGrip(car.chassis.tireGrip, speed, car) * surfaceGripMultiplier;
    speed = Math.sqrt(grip / absCurvature);
  }
  return speed;
}

/**
 * Best-case longitudinal acceleration available at this speed, in whichever
 * gear (1-5) actually maximizes it -- reuses the real torque chain
 * (accelerationMultiplierForGear x engineTorqueFraction x car.acceleration,
 * with the same top-speed drag falloff Player's throttle branch applies),
 * not a flat constant. An idealized-driver assumption (always in the best
 * gear), matching what a speed profile is for.
 */
export function maxAcceleration(speed: number, car: CarConfig): number {
  const speedRatio = Math.min(Math.abs(speed) / car.maxSpeed, 1);
  const dragFalloff = 1 - Math.pow(speedRatio, 3) * car.topSpeedFalloff;
  let bestTorque = 0;
  for (let gear = 1; gear <= 5; gear++) {
    const rpm = rpmForGear(gear, speed, car);
    const torque = accelerationMultiplierForGear(gear, car) * engineTorqueFraction(rpm, car);
    bestTorque = Math.max(bestTorque, torque);
  }
  return car.acceleration * bestTorque * dragFalloff;
}

/**
 * Best-case longitudinal deceleration available at this speed, given
 * concurrent lateral demand (mid-corner trail-braking isn't free -- braking
 * and cornering share one friction circle). Two ceilings apply, not one:
 * the tire/grip budget (effectiveGrip combined with lateralAccel in
 * quadrature, same shape as availableLateral) AND the car's own brake
 * system (car.brakeForce) -- more grip doesn't let a car brake harder than
 * its brakes can generate.
 */
export function maxBraking(speed: number, car: CarConfig, concurrentLateralAccel = 0): number {
  const grip = effectiveGrip(car.chassis.tireGrip, speed, car);
  const gripCircleTerm = Math.sqrt(Math.max(0, grip * grip - concurrentLateralAccel * concurrentLateralAccel));
  return Math.min(car.brakeForce, gripCircleTerm);
}
