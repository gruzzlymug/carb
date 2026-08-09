/**
 * Piecewise-linear interpolation over an x-keyed table (pairs must be sorted
 * ascending by x). Clamps flat below the first key and above the last —
 * matches util/engineModel.ts's engineTorqueFraction pattern, generalized so
 * other RPM/speed/etc-keyed curves (engine sound timbre, steering ratio)
 * don't each reimplement the same lookup.
 */
export function interpolateCurve(x: number, curve: ReadonlyArray<readonly [number, number]>): number {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (x <= x1) {
      const [x0, y0] = curve[i - 1];
      return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
    }
  }
  return curve[curve.length - 1][1];
}
