import type { CarConfig } from "../util/cars/index.js";
import { maxCornerSpeed, maxAcceleration, maxBraking } from "../util/vehicleDynamics.js";
import type { RacingLine } from "./racingLine.js";

/**
 * The speed the car should be carrying at a given point on a RacingLine.
 * Kept separate from RacingLine's geometry (see racingLine.ts) — this is
 * effectively an evaluator/annotation over the line, not part of the line
 * itself, and different SpeedProfiles (margins, surface, AI difficulty)
 * can exist for the same geometric line.
 */
export interface SpeedProfilePoint {
  /** Same centerlineS grid as the RacingLine this profile was computed from. */
  centerlineS: number;
  /** m/s. */
  targetSpeed: number;
}

export interface SpeedProfile {
  loopIndex: number;
  points: SpeedProfilePoint[];
}

const CONVERGENCE_THRESHOLD_MPS = 0.1;
const MAX_CONVERGENCE_ROUNDS = 10;

/**
 * Two-pass speed profile over a closed racing line: forward pass bounds
 * speed by how fast the car can accelerate out of the previous point,
 * backward pass bounds it by how fast the car can brake into the next one,
 * both capped by the per-point cornering speed ceiling (maxCornerSpeed).
 *
 * The loop is closed and periodic (the value carried across the seam
 * should stabilize), so there's no valid fixed starting speed to assume —
 * instead this runs both passes repeatedly, each round starting from the
 * previous round's wrap-around result, until speed[0]'s round-over-round
 * change (NOT its difference from speed[N-1] — those are two distinct
 * points a few meters apart with no reason to match) drops below
 * CONVERGENCE_THRESHOLD_MPS, or logs a warning if MAX_CONVERGENCE_ROUNDS is
 * hit first — non-convergence is a real signal something about the
 * line/car is degenerate, not something to silently paper over.
 */
export function generateSpeedProfile(line: RacingLine, car: CarConfig): SpeedProfile {
  const points = line.points;
  const n = points.length;
  if (n === 0) {
    return { loopIndex: line.loopIndex, points: [] };
  }

  const distances: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = points[i].position;
    const b = points[(i + 1) % n].position;
    distances[i] = Math.hypot(b.x - a.x, b.y - a.y);
  }

  const cap: number[] = points.map((p) => maxCornerSpeed(p.curvature, car));
  const speed: number[] = cap.slice();

  let converged = false;
  for (let round = 0; round < MAX_CONVERGENCE_ROUNDS; round++) {
    const speed0BeforeRound = speed[0];

    // Forward pass (acceleration-limited): speed[prev] is this round's value
    // once i > 0, and the previous round's wrap-around value for i === 0.
    for (let i = 0; i < n; i++) {
      const prev = (i - 1 + n) % n;
      const maxFromAccel = Math.sqrt(speed[prev] * speed[prev] + 2 * maxAcceleration(speed[prev], car) * distances[prev]);
      speed[i] = Math.min(cap[i], maxFromAccel);
    }

    // Backward pass (braking-limited): swept around the loop TWICE (2n
    // iterations, wrapping index), not once. A single n-length sweep has a
    // real ordering bug at the seam: the first point it processes is i =
    // n-1, which needs speed[0] to compute its braking constraint -- but
    // speed[0] is the LAST point this same sweep touches, so that first
    // lookup always reads a stale, not-yet-braked value. Confirmed by
    // instrumenting the Serpentine track (whose start/finish sits right at
    // the entry of a tight corner): the single-sweep version converged
    // (stably, not just slowly) to a WRONG fixed point where a ~40m
    // braking zone right before the corner was never braked at all, and
    // the AI carried full speed into the corner and drove off. Sweeping
    // twice lets the second wrap read the first wrap's already-correct
    // speed[0], which is enough for the constraint to propagate properly
    // in a single round (confirmed: whole-array delta drops to 0 by the
    // very next round, vs. stabilizing on the wrong answer immediately
    // with a single sweep). The concurrent-lateral-demand term passed to
    // maxBraking always uses speed[next], the value THIS sweep just
    // resolved at that index -- never a stale value from another pass,
    // round, or (now) the other half of this same double sweep.
    for (let k = 2 * n - 1; k >= 0; k--) {
      const i = k % n;
      const next = (i + 1) % n;
      const lateralAccel = speed[next] * speed[next] * Math.abs(points[i].curvature);
      const maxFromBrake = Math.sqrt(speed[next] * speed[next] + 2 * maxBraking(speed[next], car, lateralAccel) * distances[i]);
      speed[i] = Math.min(speed[i], maxFromBrake);
    }

    if (Math.abs(speed[0] - speed0BeforeRound) < CONVERGENCE_THRESHOLD_MPS) {
      converged = true;
      break;
    }
  }

  if (!converged) {
    console.warn(
      `generateSpeedProfile: closed-loop speed profile did not converge within ${MAX_CONVERGENCE_ROUNDS} rounds (loop ${line.loopIndex})`
    );
  }

  return {
    loopIndex: line.loopIndex,
    points: points.map((p, i) => ({ centerlineS: p.centerlineS, targetSpeed: speed[i] })),
  };
}
