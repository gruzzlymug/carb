import {
  IDLE_RPM,
  REDLINE_RPM,
  GEAR_RATIOS,
  GEAR_ACCEL_MULTIPLIERS,
  REVERSE_GEAR_RATIO,
  REVERSE_ACCEL_MULTIPLIER,
  RPM_SCALE,
  ENGINE_TORQUE_CURVE,
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
 * Gear torque multiplier — an explicit table, deliberately independent of
 * the gear ratio (see constants.ts). Ratio shapes RPM behavior; this shapes
 * how hard the gear multiplies engine torque.
 */
export function accelerationMultiplierForGear(gear: number): number {
  return gear === -1 ? REVERSE_ACCEL_MULTIPLIER : GEAR_ACCEL_MULTIPLIERS[gear - 1];
}

/**
 * Normalized engine torque (0..1) at the given RPM, linearly interpolated
 * from ENGINE_TORQUE_CURVE (keyed by RPM as a fraction of REDLINE_RPM).
 * Low off idle, peaks mid-range, and returns 0 at/above redline — that
 * zero is what keeps a gear from pulling past its own redline speed. This
 * is the engine's contribution to acceleration; the gear multiplies it.
 */
export function engineTorqueFraction(rpm: number): number {
  const t = rpm / REDLINE_RPM;
  const curve = ENGINE_TORQUE_CURVE;
  if (t <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [t1, v1] = curve[i];
    if (t <= t1) {
      const [t0, v0] = curve[i - 1];
      return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
    }
  }
  return curve[curve.length - 1][1]; // at/above redline -> the curve's final value (0)
}
