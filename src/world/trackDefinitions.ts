import type { Vec3 } from "../math/vector3.js";

/** One continuous path: sparse authoring control points plus whether it loops. */
export interface TrackLoop {
  points: Vec3[];
  closed: boolean;
}

/**
 * A track's sparse authoring control points — exactly the shape an
 * external track-builder tool would export (one or more polylines,
 * each optionally looping). Most tracks are a single loop; a
 * figure-eight is two independent loops that happen to touch at a
 * point — modeling it as two loops (rather than one path that reverses
 * direction at the crossing) avoids a spline tangent instability right
 * at that seam. world/trackSpline.ts turns each loop into a smooth,
 * densely-sampled curve.
 */
export interface TrackDefinition {
  name: string;
  loops: TrackLoop[];
}

/** Points along a circular arc in the flat (z = 0) ground plane. */
function arcPoints(
  centerX: number,
  centerY: number,
  radius: number,
  startDeg: number,
  endDeg: number,
  samples: number
): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const angle = ((startDeg + (endDeg - startDeg) * t) * Math.PI) / 180;
    points.push({ x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle), z: 0 });
  }
  return points;
}

const CORNER_SAMPLES = 8;

/** A rectangle with rounded corners — a compact, technical-feeling loop. */
export function createRoundedRectangleTrack(): TrackDefinition {
  const halfWidth = 70;
  const halfHeight = 45;
  const cornerRadius = 22;
  const cx = halfWidth - cornerRadius;
  const cy = halfHeight - cornerRadius;

  const points: Vec3[] = [
    { x: halfWidth, y: -cy, z: 0 }, // bottom of right straight
    ...arcPoints(cx, cy, cornerRadius, 0, 90, CORNER_SAMPLES), // top-right corner
    { x: 0, y: halfHeight, z: 0 }, // midpoint of top straight
    ...arcPoints(-cx, cy, cornerRadius, 90, 180, CORNER_SAMPLES), // top-left corner
    { x: -halfWidth, y: 0, z: 0 }, // midpoint of left straight
    ...arcPoints(-cx, -cy, cornerRadius, 180, 270, CORNER_SAMPLES), // bottom-left corner
    { x: 0, y: -halfHeight, z: 0 }, // midpoint of bottom straight
    ...arcPoints(cx, -cy, cornerRadius, 270, 360, CORNER_SAMPLES).slice(0, -1), // bottom-right corner, drop dup of start
  ];

  return { name: "Rounded Rectangle", loops: [{ points, closed: true }] };
}

/** A stadium/oval: two long straights joined by semicircular ends — the "endless straight road" feel, looped. */
export function createOvalTrack(): TrackDefinition {
  const halfStraight = 90;
  const radius = 35;

  const points: Vec3[] = [
    { x: radius, y: -halfStraight, z: 0 }, // bottom of right straight
    { x: radius, y: 0, z: 0 }, // midpoint of right straight
    ...arcPoints(0, halfStraight, radius, 0, 180, CORNER_SAMPLES * 2), // top semicircle
    { x: -radius, y: 0, z: 0 }, // midpoint of left straight
    ...arcPoints(0, -halfStraight, radius, 180, 360, CORNER_SAMPLES * 2).slice(0, -1), // bottom semicircle
  ];

  return { name: "Oval", loops: [{ points, closed: true }] };
}

/**
 * Two loops crossing at a single point — a complementary,
 * self-intersecting shape. Each circle is its own independent closed
 * loop rather than one path that reverses direction at the crossing;
 * see the TrackDefinition doc comment for why that distinction matters.
 */
export function createFigureEightTrack(): TrackDefinition {
  const radius = 45;
  const samplesPerLoop = 20;

  // Both loops start and end at the shared origin (0, 0) — that's the
  // crossing point where the two road ribbons will overlap.
  const loopA = arcPoints(-radius, 0, radius, 0, 360, samplesPerLoop).slice(0, -1);
  const loopB = arcPoints(radius, 0, radius, 180, 540, samplesPerLoop).slice(0, -1);

  return {
    name: "Figure Eight",
    loops: [
      { points: loopA, closed: true },
      { points: loopB, closed: true },
    ],
  };
}

export const TRACK_GENERATORS: Record<string, () => TrackDefinition> = {
  roundedRectangle: createRoundedRectangleTrack,
  oval: createOvalTrack,
  figureEight: createFigureEightTrack,
};

export const DEFAULT_TRACK_TYPE = "roundedRectangle";
