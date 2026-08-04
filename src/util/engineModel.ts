import {
  IDLE_RPM,
  GEAR_RATIOS,
  GEAR_ACCEL_MULTIPLIERS,
  REVERSE_GEAR_RATIO,
  REVERSE_ACCEL_MULTIPLIER,
  RPM_SCALE,
} from "./constants.js";

/** `gear` is -1 (reverse) or 1-5 (forward); never 0 (neutral has no ratio). */
function ratioForGear(gear: number): number {
  return gear === -1 ? REVERSE_GEAR_RATIO : GEAR_RATIOS[gear - 1];
}

/** RPM implied by this gear and road speed alone (uncapped — caller clamps to redline/limiter). */
export function rpmForGear(gear: number, speed: number): number {
  return IDLE_RPM + Math.abs(speed) * ratioForGear(gear) * RPM_SCALE;
}

/**
 * Acceleration multiplier for this gear — an explicit table, deliberately
 * independent of the gear ratio (see constants.ts). Ratio shapes RPM
 * behavior; this shapes how hard the gear actually pulls.
 */
export function accelerationMultiplierForGear(gear: number): number {
  return gear === -1 ? REVERSE_ACCEL_MULTIPLIER : GEAR_ACCEL_MULTIPLIERS[gear - 1];
}
