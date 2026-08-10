import * as THREE from "three";
import type { Vec3 } from "../math/vector3.js";
import { angleDelta } from "../math/vector3.js";
import type { TrackDefinition, TrackLoop } from "./trackDefinitions.js";
import { TRACK_SAMPLE_SPACING } from "../util/constants.js";

/** A point sampled along a loop's spline, evenly spaced by arc length. */
export interface TrackSample {
  center: Vec3;
  tangent: Vec3; // normalized, in the flat (z = 0) ground plane
  arcLength: number; // cumulative distance from this loop's start
}

export interface SampledLoop {
  samples: TrackSample[];
  totalLength: number;
  closed: boolean;
}

export interface SampledTrack {
  loops: SampledLoop[];
}

/**
 * Converts one loop's sparse control points into a smooth, densely and
 * evenly arc-length-spaced set of samples (position + tangent) using a
 * Catmull-Rom spline. THREE.CatmullRomCurve3 is used purely as vector
 * math here — control points stay in our own (x, y-forward, z-up)
 * coordinate space; the axis remap to Three's Y-up convention only
 * happens later, at render time (see graphics/coordinates.ts).
 */
function sampleLoop(loop: TrackLoop): SampledLoop {
  const curvePoints = loop.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const curve = new THREE.CatmullRomCurve3(curvePoints, loop.closed);

  const curveLength = curve.getLength();
  const sampleCount = Math.max(8, Math.round(curveLength / TRACK_SAMPLE_SPACING));
  // For a closed loop, u = 1 is the same point as u = 0 — excluded so it
  // isn't duplicated. For an open path it's a distinct endpoint, kept.
  const pointCount = loop.closed ? sampleCount : sampleCount + 1;

  const samples: TrackSample[] = [];
  for (let i = 0; i < pointCount; i++) {
    const u = i / sampleCount;
    const point = curve.getPointAt(u);
    const tangent = curve.getTangentAt(u);
    samples.push({
      center: { x: point.x, y: point.y, z: point.z },
      tangent: { x: tangent.x, y: tangent.y, z: 0 }, // tracks are flat; ignore any z component
      arcLength: u * curveLength,
    });
  }

  return { samples, totalLength: curveLength, closed: loop.closed };
}

/** Samples every loop in a track independently (see TrackDefinition's doc comment on why loops are separate). */
export function sampleTrack(track: TrackDefinition): SampledTrack {
  return { loops: track.loops.map(sampleLoop) };
}

function angleOf(v: Vec3): number {
  return Math.atan2(v.x, v.y);
}

/**
 * Finite-difference curvature (1/turn-radius, signed positive = turning
 * left) at each sample of a loop, from its neighbors' tangent angles over
 * arc length. Shared by trackQuery.ts (steering/AI queries) and
 * graphics/trackMesh.ts (kerb placement) so both agree on "how sharp is
 * this corner" from the same math.
 */
export function curvatureAt(loop: SampledLoop): number[] {
  const { samples, totalLength, closed } = loop;
  const count = samples.length;

  return samples.map((_sample, i) => {
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
}
