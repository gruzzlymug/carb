import type { Vec3 } from "../math/vector3.js";
import { perpendicular, dotVec3, angleDelta } from "../math/vector3.js";
import type { SampledTrack, SampledLoop } from "./trackSpline.js";
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

export interface TrackQuery {
  /** Finds the nearest point on any loop's centerline to a world-space position (z ignored). */
  nearestPoint(position: Vec3): TrackSurfaceSample;
  /** Total arc length (meters) of the given loop — the distance at which its arcLength wraps back to 0. */
  loopLength(loopIndex: number): number;
}

function angleOf(v: Vec3): number {
  return Math.atan2(v.x, v.y);
}

/** Finite-difference curvature at each sample from its neighbors' tangent angles over arc length. */
function withCurvature(loop: SampledLoop): QueryLoop {
  const { samples, totalLength, closed } = loop;
  const count = samples.length;

  const curvature = samples.map((_sample, i) => {
    const prevIndex = i > 0 ? i - 1 : closed ? count - 1 : i;
    const nextIndex = i < count - 1 ? i + 1 : closed ? 0 : i;
    if (prevIndex === nextIndex) return 0;

    const prev = samples[prevIndex];
    const next = samples[nextIndex];
    let arcSpan = next.arcLength - prev.arcLength;
    if (closed && nextIndex < prevIndex) arcSpan += totalLength; // wrapped around the seam
    if (arcSpan <= 0) return 0;

    return angleDelta(angleOf(prev.tangent), angleOf(next.tangent)) / arcSpan;
  });

  return {
    closed,
    totalLength,
    samples: samples.map((sample, i) => ({ ...sample, curvature: curvature[i] })),
  };
}

/**
 * Builds a query structure over an already-sampled track. Nearest-point lookup is a
 * brute-force scan over samples (spaced TRACK_SAMPLE_SPACING apart, ~dozens to low
 * hundreds per track) — simple and fast enough at one query per physics step; revisit
 * with a spatial index only if profiling shows otherwise.
 */
export function buildTrackQuery(track: SampledTrack): TrackQuery {
  const loops = track.loops.map(withCurvature);
  const halfWidth = ROAD_WIDTH / 2;

  function nearestPoint(position: Vec3): TrackSurfaceSample {
    let best: { loopIndex: number; sample: QuerySample; distSq: number } | null = null;

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

  return { nearestPoint, loopLength };
}
