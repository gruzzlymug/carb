import {
  IDLE_RPM,
  GEAR_RATIOS,
  REVERSE_GEAR_RATIO,
  FINAL_DRIVE,
  REFERENCE_GEAR_RATIO,
} from "./constants.js";

/** `gear` is -1 (reverse) or 1-5 (forward); never 0 (neutral has no ratio). */
function ratioForGear(gear: number): number {
  return gear === -1 ? REVERSE_GEAR_RATIO : GEAR_RATIOS[gear - 1];
}

/** RPM implied by this gear and road speed alone (uncapped — caller clamps to redline/limiter). */
export function rpmForGear(gear: number, speed: number): number {
  return IDLE_RPM + Math.abs(speed) * ratioForGear(gear) * FINAL_DRIVE;
}

/** Acceleration multiplier derived from gear ratio (numerically higher ratio = more torque multiplication). */
export function accelerationMultiplierForGear(gear: number): number {
  return ratioForGear(gear) / REFERENCE_GEAR_RATIO;
}
