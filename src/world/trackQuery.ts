import type { Vec3 } from "../math/vector3.js";
import { perpendicular, dotVec3 } from "../math/vector3.js";
import type { SampledTrack, SampledLoop } from "./trackSpline.js";
import { curvatureAt } from "./trackSpline.js";
import { ROAD_WIDTH } from "../util/constants.js";

/** One loop's samples, augmented with signed curvature (precomputed once, not per-query). */
interface QuerySample {
  center: Vec3;
  tangent: Vec3;
  arcLength: number;
  curvature: number; // 1/meters; positive = turning left, matches perpendicular()'s "left"
}

interface QueryLoop {
  samples: QuerySample[];
  totalLength: number;
  closed: boolean;
}

/**
 * Where along the track a caller has reason to believe it already is —
 * pass this into nearestPoint() to restrict the search to that vicinity
 * instead of scanning the whole track. Low-level plumbing: most callers
 * that track something moving continuously (the player car, an AI's
 * racing-line progress, lap arc length) should go through TrackFollower
 * (world/trackFollower.ts) rather than building/threading this by hand —
 * it owns the "is this hint still trustworthy" policy in one place.
 */
export interface TrackLocationHint {
  loopIndex: number;
  arcLength: number;
}

/** The track's geometry at the point on the centerline nearest to a query position. */
export interface TrackSurfaceSample {
  /** Nearest centerline point. */
  point: Vec3;
  /** Normalized tangent at that point, in the flat ground plane. */
  tangent: Vec3;
  /** Which loop the nearest point belongs to. */
  loopIndex: number;
  /** Cumulative distance from that loop's start to the nearest point. */
  arcLength: number;
  /** Signed distance from centerline: positive = left of tangent, negative = right. */
  lateralOffset: number;
  /** Unsigned distance from centerline, meters. */
  distance: number;
  /** Signed curvature (1/turn-radius) at the nearest point; positive = turning left. */
  curvature: number;
  /** True if the query position falls within the paved road width. */
  onRoad: boolean;
}

/** Point/tangent/curvature at an arbitrary arc length along a loop's centerline. */
export interface TrackPointSample {
  point: Vec3;
  /** Normalized tangent, in the flat ground plane. */
  tangent: Vec3;
  curvature: number;
}

export interface TrackQuery {
  /**
   * Finds the nearest point on the track's centerline to a world-space
   * position (z ignored).
   *  - No hint: scans every loop's every sample. Correct but
   *    direction-blind — if the track passes close to a different,
   *    arc-length-distant part of itself, this can snap to the wrong one.
   *    Fine for one-shot lookups (placement, tests); wrong for anything
   *    tracking continuous motion.
   *  - With `hint`: scans ONLY hint.loopIndex, restricted to samples
   *    within the fixed arc-length window around hint.arcLength — no
   *    fallback, no "is this still plausible" check. A deliberately dumb,
   *    predictable primitive: TrackFollower (world/trackFollower.ts) is
   *    where the policy for "is my hint still good, or do I need a fresh
   *    fix" lives; call through that instead of hand-rolling a hint here.
   */
  nearestPoint(position: Vec3, hint?: TrackLocationHint): TrackSurfaceSample;
  /** Total arc length (meters) of the given loop — the distance at which its arcLength wraps back to 0. */
  loopLength(loopIndex: number): number;
  /**
   * Point/tangent/curvature at a given arc length along a loop, wrapping for
   * closed loops (clamped to [0, length] for open ones), interpolated
   * between the two nearest samples. Replaces the old "project a point
   * along the tangent, then re-query nearestPoint on the projection"
   * workaround with a direct lookup into the same sample data
   * nearestPoint() already scans.
   */
  sampleAtArcLength(loopIndex: number, arcLength: number): TrackPointSample;
}

function normalizeVec2(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-9) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: 0 };
}

function withCurvature(loop: SampledLoop): QueryLoop {
  const curvature = curvatureAt(loop);
  return {
    closed: loop.closed,
    totalLength: loop.totalLength,
    samples: loop.samples.map((sample, i) => ({ ...sample, curvature: curvature[i] })),
  };
}

/**
 * Builds a query structure over an already-sampled track. Nearest-point lookup is a
 * brute-force scan over samples (spaced TRACK_SAMPLE_SPACING apart, ~dozens to low
 * hundreds per track) — simple and fast enough at one query per physics step; revisit
 * with a spatial index only if profiling shows otherwise.
 */
// Comfortably bigger than a physics-step's worth of movement or the
// steering controllers' own lookahead (MAX_LOOKAHEAD_M = 40 in
// steeringController.ts), but far smaller than the arc-length gap between
// a track's own separate close passes (e.g. ~490m at the figure-eight's
// pinch) — wide enough to always contain "the same place I was a moment
// ago", narrow enough to never reach the OTHER place that happens to sit
// nearby in space.
const HINT_WINDOW_METERS = 60;

type BestMatch = { loopIndex: number; sample: QuerySample; distSq: number };

function arcLengthDistance(a: number, b: number, totalLength: number, closed: boolean): number {
  const d = Math.abs(a - b);
  return closed ? Math.min(d, totalLength - d) : d;
}

export function buildTrackQuery(track: SampledTrack): TrackQuery {
  const loops = track.loops.map(withCurvature);
  const halfWidth = ROAD_WIDTH / 2;

  function scanAllLoops(position: Vec3): BestMatch | null {
    let best: BestMatch | null = null;
    for (let loopIndex = 0; loopIndex < loops.length; loopIndex++) {
      for (const sample of loops[loopIndex].samples) {
        const dx = position.x - sample.center.x;
        const dy = position.y - sample.center.y;
        const distSq = dx * dx + dy * dy;
        if (best === null || distSq < best.distSq) {
          best = { loopIndex, sample, distSq };
        }
      }
    }
    return best;
  }

  /** Nearest sample on hint.loopIndex, restricted to an arc-length window around hint.arcLength. */
  function scanNearHint(position: Vec3, hint: TrackLocationHint): BestMatch | null {
    const loop = loops[hint.loopIndex];
    if (!loop) return null;

    let best: BestMatch | null = null;
    for (const sample of loop.samples) {
      if (arcLengthDistance(sample.arcLength, hint.arcLength, loop.totalLength, loop.closed) > HINT_WINDOW_METERS) {
        continue;
      }
      const dx = position.x - sample.center.x;
      const dy = position.y - sample.center.y;
      const distSq = dx * dx + dy * dy;
      if (best === null || distSq < best.distSq) {
        best = { loopIndex: hint.loopIndex, sample, distSq };
      }
    }
    return best;
  }

  function nearestPoint(position: Vec3, hint?: TrackLocationHint): TrackSurfaceSample {
    const best = hint ? scanNearHint(position, hint) : scanAllLoops(position);

    if (best === null) {
      throw new Error("TrackQuery.nearestPoint: track has no samples");
    }

    const { loopIndex, sample } = best;
    const delta: Vec3 = { x: position.x - sample.center.x, y: position.y - sample.center.y, z: 0 };
    const lateralOffset = dotVec3(delta, perpendicular(sample.tangent));

    return {
      point: sample.center,
      tangent: sample.tangent,
      loopIndex,
      arcLength: sample.arcLength,
      lateralOffset,
      distance: Math.abs(lateralOffset),
      curvature: sample.curvature,
      onRoad: Math.abs(lateralOffset) <= halfWidth,
    };
  }

  function loopLength(loopIndex: number): number {
    const loop = loops[loopIndex];
    if (!loop) throw new Error(`TrackQuery.loopLength: no loop at index ${loopIndex}`);
    return loop.totalLength;
  }

  function sampleAtArcLength(loopIndex: number, arcLength: number): TrackPointSample {
    const loop = loops[loopIndex];
    if (!loop) throw new Error(`TrackQuery.sampleAtArcLength: no loop at index ${loopIndex}`);
    const samples = loop.samples;
    if (samples.length === 0) {
      throw new Error("TrackQuery.sampleAtArcLength: loop has no samples");
    }
    if (samples.length === 1) {
      const only = samples[0];
      return { point: only.center, tangent: only.tangent, curvature: only.curvature };
    }

    const s = loop.closed
      ? ((arcLength % loop.totalLength) + loop.totalLength) % loop.totalLength
      : Math.max(0, Math.min(loop.totalLength, arcLength));

    // Binary search for the last sample with arcLength <= s.
    let lo = 0;
    let hi = samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (samples[mid].arcLength <= s) lo = mid;
      else hi = mid - 1;
    }

    const i0 = lo;
    const wraps = loop.closed && i0 === samples.length - 1;
    const i1 = wraps ? 0 : Math.min(i0 + 1, samples.length - 1);
    const sample0 = samples[i0];
    const sample1 = samples[i1];

    const segmentLength = wraps ? loop.totalLength - sample0.arcLength : sample1.arcLength - sample0.arcLength;
    const t = segmentLength > 1e-9 ? Math.max(0, Math.min(1, (s - sample0.arcLength) / segmentLength)) : 0;

    const point: Vec3 = {
      x: sample0.center.x + (sample1.center.x - sample0.center.x) * t,
      y: sample0.center.y + (sample1.center.y - sample0.center.y) * t,
      z: sample0.center.z + (sample1.center.z - sample0.center.z) * t,
    };
    const tangent = normalizeVec2({
      x: sample0.tangent.x + (sample1.tangent.x - sample0.tangent.x) * t,
      y: sample0.tangent.y + (sample1.tangent.y - sample0.tangent.y) * t,
      z: 0,
    });
    const curvature = sample0.curvature + (sample1.curvature - sample0.curvature) * t;

    return { point, tangent, curvature };
  }

  return { nearestPoint, loopLength, sampleAtArcLength };
}
