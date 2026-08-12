import type { Vec3 } from "../math/vector3.js";
import { perpendicular, angleDelta } from "../math/vector3.js";
import type { SampledLoop } from "./trackSpline.js";
import { curvatureAt } from "./trackSpline.js";
import { generateSpeedProfile } from "./speedProfile.js";
import type { SpeedProfile } from "./speedProfile.js";
import type { CarConfig } from "../util/cars/index.js";
import { ROAD_WIDTH } from "../util/constants.js";

/**
 * A precomputed, per-track racing line: the desired trajectory through the
 * loop, expressed as a dense set of points keyed by distance along the
 * CENTERLINE (not the line's own path length) — so a car's position (via
 * TrackQuery.nearestPoint's arcLength) indexes directly into `points` with
 * no separate lookup structure. Geometry only; see speedProfile.ts for the
 * paired SpeedProfile (kept separate so a speed profile can be regenerated
 * — different margins, surface conditions, AI difficulty — without
 * touching the line's geometry).
 */
export interface RacingLinePoint {
  /** Arc length along the CENTERLINE at this point — named centerlineS, not arcLength, specifically to avoid confusion with the line's own path length. */
  centerlineS: number;
  /** The line's actual world position (centerline + lateralOffset along the perpendicular). */
  position: Vec3;
  /** The line's own direction of travel here (differs from the centerline's near corners), normalized. */
  tangent: Vec3;
  /** The line's own curvature (1/turn-radius) — this is what the speed profile reads, not the centerline's. */
  curvature: number;
  /** Signed offset from centerline, meters (same sign convention as TrackSurfaceSample.lateralOffset: + = left). */
  lateralOffset: number;
}

export interface RacingLine {
  loopIndex: number;
  /** Sorted, evenly spaced by centerlineS. */
  points: RacingLinePoint[];
  totalLength: number;
}

function wrapLineIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/** Index into `racingLine.points` nearest a given centerlineS, wrapping for the closed loop -- shared by AiDriver and any SteeringController that needs to sample the line directly (see gameplay/steeringController.ts), so both use the same indexing math instead of each re-deriving it. */
export function racingLineIndexAt(racingLine: RacingLine, centerlineS: number): number {
  const n = racingLine.points.length;
  return wrapLineIndex(Math.round((centerlineS / racingLine.totalLength) * n), n);
}

/** The racing-line point nearest a given centerlineS. */
export function racingLinePointAt(racingLine: RacingLine, centerlineS: number): RacingLinePoint {
  return racingLine.points[racingLineIndexAt(racingLine, centerlineS)];
}

/** The racing-line point `distanceAhead` further along (by centerlineS) than `centerlineS`, wrapping around the closed loop. */
export function racingLinePointAhead(racingLine: RacingLine, centerlineS: number, distanceAhead: number): RacingLinePoint {
  return racingLinePointAt(racingLine, centerlineS + distanceAhead);
}

/** Keeps the line off the physical edge/kerb even at full lock. */
const EDGE_MARGIN_M = 0.6;
/** Mandatory cap on |Δoffset| per meter of distance between adjacent control points — enforced at candidate-generation time (not a soft penalty) so coordinate descent can't discover a physically absurd zigzag even if the evaluator is noisy. */
const MAX_OFFSET_SLOPE = 0.6;
/** Coordinate-descent step size schedule, coarse to fine. */
const OPTIMIZER_STEPS_M = [1.0, 0.5, 0.25, 0.1];
const MAX_SWEEPS_PER_STEP = 20;
const LAP_TIME_IMPROVEMENT_EPSILON_S = 1e-6;

interface ControlPoint {
  centerlineS: number;
  offset: number;
}

const MIN_CONTROL_POINT_SPACING_M = 6;
const MAX_CONTROL_POINT_SPACING_M = 40;
/**
 * A corner's control-point density bleeds this far (by arc length) into the
 * straight on either side of it — a corner's OWN curvature stops right at
 * its geometric extent, but a wide-entry/wide-exit racing line needs control
 * points on the approaching/departing straight too, not just inside the
 * curvature itself. Confirmed necessary: without this, an isolated corner
 * with long straights on both sides had only 1-2 real control points
 * spanning it (dense-enough interior spacing alone doesn't help if there's
 * nowhere for "entry"/"exit" points to exist), and every hand-tested
 * wide-entry/tight-apex/wide-exit pattern on those sparse points scored
 * WORSE than the current line — not because the shape is wrong, but because
 * 1-2 points 25m apart can't express it without kinking the curve tighter
 * instead of wider (measured: peak curvature got worse, not better).
 */
const CORNER_INFLUENCE_DILATION_M = 20;
/** desiredSpacing ~= this / dilatedCurvature, clamped to [MIN,MAX]_CONTROL_POINT_SPACING_M -- tuned so this track's tightest corner (curvature ~0.14) lands near the minimum spacing and its straights saturate at the maximum. */
const SPACING_CURVATURE_CONSTANT = 0.9;

/**
 * Builds a continuous "how far to the next control point" function from the
 * centerline's own curvature — dense control points where the road curves
 * or is about to/just did (see CORNER_INFLUENCE_DILATION_M), sparse on
 * straights. No fixed grid, no region list: purely a function of track
 * geometry, so an isolated corner automatically gets exactly the resolution
 * its actual curvature extent (plus entry/exit room) calls for, and a
 * chicane sequence's already-dense curvature naturally produces dense
 * points without any special-casing.
 */
function buildDesiredSpacingFn(loop: SampledLoop): (s: number) => number {
  const samples = loop.samples;
  const n = samples.length;
  const curvature = curvatureAt(loop);
  const absCurvature = curvature.map(Math.abs);

  const dilated = absCurvature.map((_, i) => {
    let maxNearby = 0;
    for (let j = 0; j < n; j++) {
      let d = Math.abs(samples[j].arcLength - samples[i].arcLength);
      d = Math.min(d, loop.totalLength - d); // wrap-aware distance
      if (d <= CORNER_INFLUENCE_DILATION_M) maxNearby = Math.max(maxNearby, absCurvature[j]);
    }
    return maxNearby;
  });

  return (s: number): number => {
    const wrapped = ((s % loop.totalLength) + loop.totalLength) % loop.totalLength;
    const idx = Math.round((wrapped / loop.totalLength) * n) % n;
    const spacing = SPACING_CURVATURE_CONSTANT / Math.max(dilated[idx], 1e-4);
    return Math.max(MIN_CONTROL_POINT_SPACING_M, Math.min(MAX_CONTROL_POINT_SPACING_M, spacing));
  };
}

/**
 * Places control points by marching along the centerline, each step sized
 * by the local desired spacing (buildDesiredSpacingFn) — an adaptive,
 * geometry-driven placement instead of a fixed grid. The final wrap-around
 * segment (last placed point back to centerlineS=0) is whatever's left
 * over from the march and can be irregular; if it's meaningfully larger
 * than what's locally desired there, one extra split point is inserted so
 * the seam doesn't quietly become the sparsest part of the track.
 */
function placeControlPoints(loop: SampledLoop): ControlPoint[] {
  const totalLength = loop.totalLength;
  const desiredSpacingAt = buildDesiredSpacingFn(loop);

  const points: ControlPoint[] = [{ centerlineS: 0, offset: 0 }];
  let s = 0;
  while (true) {
    const next = s + desiredSpacingAt(s);
    if (next >= totalLength) break;
    points.push({ centerlineS: next, offset: 0 });
    s = next;
  }

  const last = points[points.length - 1];
  const wrapSpan = totalLength - last.centerlineS;
  const desiredAtSeam = Math.min(desiredSpacingAt(last.centerlineS), desiredSpacingAt(0));
  if (wrapSpan > desiredAtSeam * 1.5) {
    const extra = Math.round(wrapSpan / desiredAtSeam) - 1;
    for (let k = 1; k <= extra; k++) {
      points.push({ centerlineS: last.centerlineS + (wrapSpan * k) / (extra + 1), offset: 0 });
    }
    points.sort((a, b) => a.centerlineS - b.centerlineS);
  }

  if (points.length < 4) {
    // Degenerate/tiny loop safety net -- not expected on any real track.
    return Array.from({ length: 4 }, (_, i) => ({ centerlineS: (i / 4) * totalLength, offset: 0 }));
  }
  return points;
}

/** Simple uniform placement, used only as stage 1 of a coarse-to-fine optimization (see generateRacingLine) -- a smaller, easier-to-search space that gives stage 2's denser adaptive layout a good starting shape instead of exploring the full (higher-dimensional) space from all-zero offsets. */
function placeUniformControlPoints(loop: SampledLoop, spacing: number): ControlPoint[] {
  const count = Math.max(4, Math.round(loop.totalLength / spacing));
  return Array.from({ length: count }, (_, i) => ({ centerlineS: (i / count) * loop.totalLength, offset: 0 }));
}

/** Distance walking forward from control point `i` to point `i+1` (wrapping), for whatever the current (possibly non-uniform) spacing is at that pair. */
function forwardDistance(controlPoints: ControlPoint[], i: number, totalLength: number): number {
  const n = controlPoints.length;
  let d = controlPoints[(i + 1) % n].centerlineS - controlPoints[i].centerlineS;
  if (d <= 0) d += totalLength;
  return d;
}

/**
 * Fritsch-Carlson-limited derivatives (d(offset)/d(centerlineS)) for a
 * closed, possibly NON-UNIFORMLY-spaced control-point sequence: starts from
 * a distance-weighted Catmull-Rom-style secant average, then clamps so the
 * resulting cubic Hermite spline can never overshoot the values at adjacent
 * control points. Two standard rules (generalized from the uniform-spacing
 * case to arbitrary spacing via per-segment slopes, i.e. secant/distance,
 * rather than raw secants):
 *
 *  1. Any point that's a local extremum (its two neighboring segment
 *     slopes have opposite sign, or either is exactly 0) gets derivative 0
 *     — forcing the curve to flatten at a turning point instead of curling
 *     past it.
 *  2. Within each segment, if the two endpoint derivatives' ratios to that
 *     segment's own slope (alpha, beta) satisfy alpha^2+beta^2 > 9, both
 *     are rescaled down to the alpha^2+beta^2 = 9 boundary (the
 *     Fritsch-Carlson circle-of-radius-3 condition).
 *
 * Kept deliberately Catmull-Rom-derived (not switched to some other spline
 * family) — monotone limiting is a modification of Catmull-Rom's tangents,
 * not a different spline. Measured necessary on this track: plain
 * (unclamped) Catmull-Rom let the curve swing past control-point values
 * between sharp offset changes, showing up as 3 points beyond the track's
 * edge limit and a near-doubled peak curvature (0.138 -> 0.257) at one
 * corner. Monotone limiting fixes that at the source, without abandoning
 * Catmull-Rom's underlying tangent construction.
 */
function monotoneDerivatives(controlPoints: ControlPoint[], distances: number[]): number[] {
  const n = controlPoints.length;
  const slopes = controlPoints.map((p, i) => (controlPoints[(i + 1) % n].offset - p.offset) / distances[i]);

  const derivatives = controlPoints.map((_, i) => {
    const prevSlope = slopes[(i - 1 + n) % n];
    const nextSlope = slopes[i];
    if (prevSlope === 0 || nextSlope === 0 || Math.sign(prevSlope) !== Math.sign(nextSlope)) {
      return 0;
    }
    const dPrev = distances[(i - 1 + n) % n];
    const dNext = distances[i];
    // Distance-weighted average of the two adjacent slopes -- reduces to
    // the plain average (the uniform-spacing formula this replaced) when
    // spacing happens to be uniform.
    return (prevSlope * dNext + nextSlope * dPrev) / (dPrev + dNext);
  });

  for (let i = 0; i < n; i++) {
    const iNext = (i + 1) % n;
    const slope = slopes[i];
    if (slope === 0) continue;
    const alpha = derivatives[i] / slope;
    const beta = derivatives[iNext] / slope;
    const sumSquares = alpha * alpha + beta * beta;
    if (sumSquares > 9) {
      const tau = 3 / Math.sqrt(sumSquares);
      derivatives[i] = tau * alpha * slope;
      derivatives[iNext] = tau * beta * slope;
    }
  }

  return derivatives;
}

/**
 * Monotone cubic-Hermite offset-vs-centerlineS interpolant through the
 * (possibly non-uniformly-spaced) control points. Wraps for the closed
 * loop. Looks up the bracketing control-point segment via binary search
 * (control points are sorted by centerlineS, but no longer evenly spaced,
 * so the old O(1) division-based lookup no longer applies), then converts
 * the per-point derivative (d(offset)/d(centerlineS)) into the per-segment
 * "tangent w.r.t. local Hermite parameter t" the basis functions need by
 * scaling by that segment's own length.
 */
function buildOffsetSpline(controlPoints: ControlPoint[], totalLength: number): (s: number) => number {
  const n = controlPoints.length;
  const distances = controlPoints.map((_, i) => forwardDistance(controlPoints, i, totalLength));
  const derivatives = monotoneDerivatives(controlPoints, distances);

  return (s: number): number => {
    const wrapped = ((s % totalLength) + totalLength) % totalLength;

    let i: number;
    if (wrapped < controlPoints[0].centerlineS) {
      i = n - 1; // in the wrap segment, before the first point
    } else {
      let lo = 0;
      let hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (controlPoints[mid].centerlineS <= wrapped) lo = mid;
        else hi = mid - 1;
      }
      i = lo;
    }

    const iNext = (i + 1) % n;
    const d = distances[i];
    const localS = wrapped >= controlPoints[i].centerlineS ? wrapped - controlPoints[i].centerlineS : wrapped + totalLength - controlPoints[i].centerlineS;
    const t = d > 1e-9 ? Math.max(0, Math.min(1, localS / d)) : 0;

    const p0 = controlPoints[i].offset;
    const p1 = controlPoints[iNext].offset;
    const m0 = derivatives[i] * d;
    const m1 = derivatives[iNext] * d;

    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    return h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
  };
}

function angleOfTangent(tangent: Vec3): number {
  return Math.atan2(tangent.x, tangent.y);
}

/**
 * Builds the dense RacingLine from a centerline loop and an offset spline:
 * applies the (interpolated) lateral offset to each existing centerline
 * sample along its perpendicular, then derives the offset line's own
 * tangent (central difference of position) and curvature (finite
 * difference of tangent angle over the line's own traveled distance, not
 * the centerline's) — same finite-difference shape trackSpline.ts's
 * curvatureAt uses, applied to this line's own geometry instead of the
 * centerline's.
 */
function buildDenseLine(loop: SampledLoop, offsetAt: (s: number) => number, loopIndex: number): RacingLine {
  const n = loop.samples.length;
  const positions: Vec3[] = loop.samples.map((sample) => {
    const offset = offsetAt(sample.arcLength);
    const perp = perpendicular(sample.tangent);
    return {
      x: sample.center.x + perp.x * offset,
      y: sample.center.y + perp.y * offset,
      z: sample.center.z,
    };
  });

  const neighborIndex = (i: number, dir: 1 | -1): number => {
    const j = i + dir;
    if (j >= 0 && j < n) return j;
    return loop.closed ? (j + n) % n : i;
  };

  const tangents: Vec3[] = positions.map((_, i) => {
    const prev = positions[neighborIndex(i, -1)];
    const next = positions[neighborIndex(i, 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return loop.samples[i].tangent;
    return { x: dx / len, y: dy / len, z: 0 };
  });

  const curvature: number[] = positions.map((_, i) => {
    const prevIndex = neighborIndex(i, -1);
    const nextIndex = neighborIndex(i, 1);
    if (prevIndex === nextIndex) return 0;
    const prev = positions[prevIndex];
    const curr = positions[i];
    const next = positions[nextIndex];
    const span = Math.hypot(curr.x - prev.x, curr.y - prev.y) + Math.hypot(next.x - curr.x, next.y - curr.y);
    if (span <= 1e-9) return 0;
    return angleDelta(angleOfTangent(tangents[prevIndex]), angleOfTangent(tangents[nextIndex])) / span;
  });

  const points: RacingLinePoint[] = loop.samples.map((sample, i) => ({
    centerlineS: sample.arcLength,
    position: positions[i],
    tangent: tangents[i],
    curvature: curvature[i],
    lateralOffset: offsetAt(sample.arcLength),
  }));

  return { loopIndex, points, totalLength: loop.totalLength };
}

/** Sum of distance/targetSpeed across the line — the objective's dominant term, and the number reported as "estimated lap time" in diagnostics. */
function estimateLapTime(line: RacingLine, profile: SpeedProfile): number {
  const n = line.points.length;
  let time = 0;
  for (let i = 0; i < n; i++) {
    const a = line.points[i].position;
    const b = line.points[(i + 1) % n].position;
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const speed = Math.max(profile.points[i].targetSpeed, 0.1); // avoid division by zero on a degenerate candidate
    time += distance / speed;
  }
  return time;
}

/**
 * Discretized ∫(dκ/ds)² ds over the line — penalizes curvature OSCILLATION
 * specifically (not curvature magnitude itself, which the speed profile
 * already prices in via lower cornering speed). A line can look smooth
 * spatially while still making the steering controller work constantly if
 * its curvature wiggles; this term exists to price that out of the
 * optimizer's objective directly, rather than relying on the monotone
 * spline alone to keep it under control.
 */
function computeCurvatureNoise(line: RacingLine): number {
  const points = line.points;
  const n = points.length;
  let noise = 0;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const a = points[i].position;
    const b = points[next].position;
    const ds = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1e-6);
    const dCurvature = points[next].curvature - points[i].curvature;
    noise += (dCurvature / ds) * (dCurvature / ds) * ds;
  }
  return noise;
}

/**
 * Soft cost that grows as the line's lateral offset approaches the hard
 * edge limit (ROAD_WIDTH/2 - EDGE_MARGIN_M), zero below SAFE_OFFSET_FRACTION
 * of that limit. The hard limit itself is still enforced exactly as before
 * (the per-candidate clamp in optimizeControlPoints, below, is unchanged) —
 * this is a separate, softer preference that trades a little lap time for
 * leaving real margin, specifically because the AI's own path-following
 * has measured error (the Circuit/Serpentine bang-bang baseline runs
 * ~1-2m off the line even when everything else is working correctly): a
 * line that plans to use the track down to the last few centimeters gives
 * that error nowhere to go. "Prefer a slightly slower but robust line" —
 * this is the mechanism for that preference, not a hard constraint change.
 */
function computeEdgeProximityPenalty(line: RacingLine, edgeLimit: number): number {
  const safeOffset = edgeLimit * SAFE_OFFSET_FRACTION;
  const points = line.points;
  const n = points.length;
  let penalty = 0;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const a = points[i].position;
    const b = points[next].position;
    const ds = Math.hypot(b.x - a.x, b.y - a.y);
    const excess = Math.max(0, Math.abs(points[i].lateralOffset) - safeOffset);
    penalty += excess * excess * ds;
  }
  return penalty;
}

/** Offset beyond which computeEdgeProximityPenalty starts charging, as a fraction of the hard edge limit. */
const SAFE_OFFSET_FRACTION = 0.85;

/** Penalty weights for the optimizer's combined score -- exposed as a parameter (not just module constants) so weight choices can be swept/compared, e.g. for the tuning pass this shape exists for. */
export interface RacingLineWeights {
  /** Weight on computeCurvatureNoise(), calibrated so it meaningfully competes with lap time (seconds) rather than being swamped by it. */
  curvatureNoise: number;
  /** Weight on computeEdgeProximityPenalty(). */
  edgeProximity: number;
}

/** Current defaults -- see the tuning-sweep diagnostic that picked these over the alternatives tried (20/1 through 60/3). */
export const DEFAULT_RACING_LINE_WEIGHTS: RacingLineWeights = { curvatureNoise: 40, edgeProximity: 2 };

/** Builds the candidate line/profile for a control-point set and scores it: lap time plus the curvature-noise and edge-proximity penalties above. Lower is better. This is what coordinate descent actually compares, below -- not lap time alone. */
function scoreControlPoints(
  loop: SampledLoop,
  controlPoints: ControlPoint[],
  car: CarConfig,
  edgeLimit: number,
  weights: RacingLineWeights
): number {
  const line = buildDenseLine(loop, buildOffsetSpline(controlPoints, loop.totalLength), 0);
  const profile = generateSpeedProfile(line, car);
  const lapTime = estimateLapTime(line, profile);
  const curvatureNoise = computeCurvatureNoise(line);
  const edgePenalty = computeEdgeProximityPenalty(line, edgeLimit);
  return lapTime + weights.curvatureNoise * curvatureNoise + weights.edgeProximity * edgePenalty;
}

/**
 * Score-guided coordinate descent over the control points' offsets: for
 * each point, try nudging it by ±(current step), keep whichever change
 * reduces the combined score (see scoreControlPoints — lap time plus
 * curvature-noise and edge-proximity penalties, not lap time alone), or
 * neither. Repeat until a full sweep makes no improvement, then shrink the
 * step and re-sweep. Deterministic and debuggable. Works over whatever
 * control-point layout it's handed (see placeControlPoints) — doesn't care
 * whether spacing is uniform.
 */
function optimizeControlPoints(loop: SampledLoop, car: CarConfig, weights: RacingLineWeights, initial: ControlPoint[]): ControlPoint[] {
  const controlPoints = initial.map((p) => ({ ...p }));
  const n = controlPoints.length;
  const totalLength = loop.totalLength;
  const edgeLimit = ROAD_WIDTH / 2 - EDGE_MARGIN_M;

  let bestScore = scoreControlPoints(loop, controlPoints, car, edgeLimit, weights);

  for (const step of OPTIMIZER_STEPS_M) {
    let improved = true;
    let sweeps = 0;
    while (improved && sweeps < MAX_SWEEPS_PER_STEP) {
      improved = false;
      sweeps++;
      for (let i = 0; i < n; i++) {
        const beforeIdx = (i - 1 + n) % n;
        const afterIdx = (i + 1) % n;
        const before = controlPoints[beforeIdx];
        const after = controlPoints[afterIdx];
        const maxSlopeDeltaBefore = MAX_OFFSET_SLOPE * forwardDistance(controlPoints, beforeIdx, totalLength);
        const maxSlopeDeltaAfter = MAX_OFFSET_SLOPE * forwardDistance(controlPoints, i, totalLength);
        const lower = Math.max(-edgeLimit, before.offset - maxSlopeDeltaBefore, after.offset - maxSlopeDeltaAfter);
        const upper = Math.min(edgeLimit, before.offset + maxSlopeDeltaBefore, after.offset + maxSlopeDeltaAfter);
        if (upper < lower) continue; // degenerate window at this spacing/slope -- leave this point alone this sweep

        const original = controlPoints[i].offset;
        const candidates = [original + step, original - step]
          .filter((c) => c >= lower - 1e-9 && c <= upper + 1e-9)
          .map((c) => Math.max(lower, Math.min(upper, c)));

        let bestCandidateOffset = original;
        let bestCandidateScore = bestScore;
        for (const candidate of candidates) {
          controlPoints[i].offset = candidate;
          const score = scoreControlPoints(loop, controlPoints, car, edgeLimit, weights);
          if (score < bestCandidateScore) {
            bestCandidateScore = score;
            bestCandidateOffset = candidate;
          }
        }
        controlPoints[i].offset = bestCandidateOffset;
        if (bestCandidateScore < bestScore - LAP_TIME_IMPROVEMENT_EPSILON_S) {
          bestScore = bestCandidateScore;
          improved = true;
        }
      }
    }
  }

  return controlPoints;
}

/** Segment bounds for the linked-corner joint-optimization prototype (s=260-390m on the Serpentine track's top complex, corners 3-6 — identified by the corner-by-corner speed diagnostic as a genuinely coupled sequence, not auto-detected; hardcoded for this specific experiment). */
const JOINT_SEGMENT_S_START = 260;
const JOINT_SEGMENT_S_END = 390;

/** True if every control point at `indices` satisfies the same edge/slope bounds the main pass enforces, checked against their CURRENT (possibly also-just-moved) neighbors — not pre-move snapshots, so adjacent joint moves within the same candidate are validated consistently. */
function segmentWithinBounds(controlPoints: ControlPoint[], totalLength: number, edgeLimit: number, indices: number[]): boolean {
  const n = controlPoints.length;
  for (const i of indices) {
    const offset = controlPoints[i].offset;
    if (Math.abs(offset) > edgeLimit + 1e-9) return false;
    const beforeIdx = (i - 1 + n) % n;
    const afterIdx = (i + 1) % n;
    const maxDeltaBefore = MAX_OFFSET_SLOPE * forwardDistance(controlPoints, beforeIdx, totalLength);
    const maxDeltaAfter = MAX_OFFSET_SLOPE * forwardDistance(controlPoints, i, totalLength);
    if (Math.abs(offset - controlPoints[beforeIdx].offset) > maxDeltaBefore + 1e-9) return false;
    if (Math.abs(offset - controlPoints[afterIdx].offset) > maxDeltaAfter + 1e-9) return false;
  }
  return true;
}

/**
 * Prototype: after the main per-point coordinate descent converges, run an
 * additional pass over just the control points inside [sStart, sEnd],
 * trying COORDINATED (multi-point) moves in addition to single-point ones.
 *
 * Motivation: greedy single-point coordinate descent can get stuck where
 * no INDIVIDUAL point's move improves the score, even though a COUPLED
 * move (give up a little offset at one apex so the next corner's entry is
 * better) would. Diagnosed exactly this pattern on the Serpentine track's
 * corner 5->6 transition: the line accelerates out of corner 5 only to
 * immediately brake hard again for corner 6 — two corners each locally
 * optimized in isolation, not optimized as a pair. (That specific case was
 * later confirmed to already be time-optimal via a separate constrained-
 * speed test — see the C3-C6 investigation — but the mechanism this
 * function provides remains useful for other coupled sequences.)
 *
 * Move types, all evaluated with the SAME scoreControlPoints (same
 * weights, same objective) the main pass uses — this changes the
 * optimizer's SEARCH within the given scope, not its objective:
 *  - single-point: identical to the main pass, re-run here in case the
 *    segment drifted since the main pass last touched it.
 *  - uniform shift: every point in the segment moves by the same delta.
 *  - pairwise trade: one point +delta, another -delta (offset
 *    redistributed between two points, net zero) — the direct mechanism
 *    for "sacrifice apex A's position for apex B's".
 * A candidate is applied speculatively, then validated against every
 * moved point's actual bounds in its POST-move state (segmentWithinBounds)
 * and reverted if invalid — not pre-checked against stale neighbor values,
 * so adjacent-point trades are validated correctly.
 */
function jointRefineSegment(
  loop: SampledLoop,
  car: CarConfig,
  controlPoints: ControlPoint[],
  weights: RacingLineWeights,
  edgeLimit: number,
  sStart: number,
  sEnd: number
): void {
  const totalLength = loop.totalLength;
  const segmentIndices = controlPoints
    .map((_, i) => i)
    .filter((i) => controlPoints[i].centerlineS >= sStart && controlPoints[i].centerlineS <= sEnd);
  if (segmentIndices.length < 2) return;

  let bestScore = scoreControlPoints(loop, controlPoints, car, edgeLimit, weights);

  const tryCandidate = (moved: Array<{ index: number; offset: number }>): boolean => {
    const originals = moved.map((m) => controlPoints[m.index].offset);
    moved.forEach((m) => (controlPoints[m.index].offset = m.offset));
    const indices = moved.map((m) => m.index);
    if (!segmentWithinBounds(controlPoints, totalLength, edgeLimit, indices)) {
      moved.forEach((m, k) => (controlPoints[m.index].offset = originals[k]));
      return false;
    }
    const score = scoreControlPoints(loop, controlPoints, car, edgeLimit, weights);
    if (score < bestScore - LAP_TIME_IMPROVEMENT_EPSILON_S) {
      bestScore = score;
      return true;
    }
    moved.forEach((m, k) => (controlPoints[m.index].offset = originals[k]));
    return false;
  };

  for (const step of OPTIMIZER_STEPS_M) {
    let improved = true;
    let sweeps = 0;
    while (improved && sweeps < MAX_SWEEPS_PER_STEP) {
      improved = false;
      sweeps++;

      for (const i of segmentIndices) {
        const original = controlPoints[i].offset;
        if (tryCandidate([{ index: i, offset: original + step }])) improved = true;
        else if (tryCandidate([{ index: i, offset: original - step }])) improved = true;
      }

      for (const delta of [step, -step]) {
        const moved = segmentIndices.map((i) => ({ index: i, offset: controlPoints[i].offset + delta }));
        if (tryCandidate(moved)) improved = true;
      }

      for (const a of segmentIndices) {
        for (const b of segmentIndices) {
          if (a === b) continue;
          const moved = [
            { index: a, offset: controlPoints[a].offset + step },
            { index: b, offset: controlPoints[b].offset - step },
          ];
          if (tryCandidate(moved)) improved = true;
        }
      }
    }
  }
}

/** Uniform spacing for generateRacingLine's stage-1 coarse pass -- deliberately the same value the old fixed grid used, since that layout was already validated to optimize well. */
const COARSE_STAGE_SPACING_M = 25;

/**
 * Generates the racing line for one loop, once (tracks are static/
 * deterministic — this is not recomputed per frame). Works for any loop;
 * calling it only for loop 0 is an application choice made where
 * TrackWorld is built, not a limitation of this function. `weights`
 * defaults to DEFAULT_RACING_LINE_WEIGHTS; exposed as a parameter so
 * diagnostics can sweep alternatives without touching this module.
 *
 * Two-stage, coarse-to-fine optimization:
 *  1. Optimize a simple uniform-spacing layout from scratch (all-zero
 *     offsets) — a small, well-behaved search space.
 *  2. Build the full adaptive-density layout (placeControlPoints — dense
 *     near curvature, sparse on straights, no fixed grid), seed each of
 *     ITS points by sampling stage 1's already-optimized shape, then
 *     re-optimize from that seed.
 *
 * Stage 1 isn't just a formality: tried going straight to the dense
 * adaptive layout from all-zero offsets, and measured a real regression
 * (~0.6s slower on the Serpentine track) versus the old uniform grid,
 * with a visibly messier offset profile — greedy per-point coordinate
 * descent got stuck in a worse local optimum in the larger, less
 * regular search space. Seeding stage 2 from stage 1's result instead of
 * zero means stage 2 only has to do local refinement — including,
 * crucially, finally being ABLE to express entry/exit shaping at
 * corners that previously had too few control points for it — rather
 * than rediscovering the whole line's shape from scratch.
 */
function generateRacingLineControlPoints(
  loop: SampledLoop,
  car: CarConfig,
  weights: RacingLineWeights,
  applyJointSegmentRefinement: boolean
): ControlPoint[] {
  const coarseInitial = placeUniformControlPoints(loop, COARSE_STAGE_SPACING_M);
  const coarseOptimized = optimizeControlPoints(loop, car, weights, coarseInitial);
  const coarseSpline = buildOffsetSpline(coarseOptimized, loop.totalLength);

  const dense = placeControlPoints(loop);
  const seeded = dense.map((p) => ({ centerlineS: p.centerlineS, offset: coarseSpline(p.centerlineS) }));
  const controlPoints = optimizeControlPoints(loop, car, weights, seeded);

  if (applyJointSegmentRefinement) {
    const edgeLimit = ROAD_WIDTH / 2 - EDGE_MARGIN_M;
    jointRefineSegment(loop, car, controlPoints, weights, edgeLimit, JOINT_SEGMENT_S_START, JOINT_SEGMENT_S_END);
  }
  return controlPoints;
}

export function generateRacingLine(
  loop: SampledLoop,
  car: CarConfig,
  weights: RacingLineWeights = DEFAULT_RACING_LINE_WEIGHTS,
  applyJointSegmentRefinement = false
): RacingLine {
  const controlPoints = generateRacingLineControlPoints(loop, car, weights, applyJointSegmentRefinement);
  return buildDenseLine(loop, buildOffsetSpline(controlPoints, loop.totalLength), 0);
}

