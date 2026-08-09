import type { CarConfig } from "./cars/carConfig.js";

/** `gear` is -1 (reverse) or 1-5 (forward); never 0 (neutral has no ratio). */
function ratioForGear(gear: number, car: CarConfig): number {
  return gear === -1 ? car.reverseGearRatio : car.gearRatios[gear - 1];
}

/** RPM implied by this gear and road speed alone (uncapped — caller clamps to redline/limiter). */
export function rpmForGear(gear: number, speed: number, car: CarConfig): number {
  return car.idleRpm + Math.abs(speed) * ratioForGear(gear, car) * car.rpmScale;
}

/**
 * Gear torque multiplier — an explicit table, deliberately independent of
 * the gear ratio (see CarConfig). Ratio shapes RPM behavior; this shapes
 * how hard the gear multiplies engine torque.
 */
export function accelerationMultiplierForGear(gear: number, car: CarConfig): number {
  return gear === -1 ? car.reverseAccelMultiplier : car.gearAccelMultipliers[gear - 1];
}

/**
 * Normalized engine torque (0..1) at the given RPM, linearly interpolated
 * from car.engineTorqueCurve (keyed by RPM as a fraction of redlineRpm).
 * Low off idle, peaks mid-range, and returns 0 at/above redline — that
 * zero is what keeps a gear from pulling past its own redline speed. This
 * is the engine's contribution to acceleration; the gear multiplies it.
 */
export function engineTorqueFraction(rpm: number, car: CarConfig): number {
  const t = rpm / car.redlineRpm;
  const curve = car.engineTorqueCurve;
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
