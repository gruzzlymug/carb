import type { Mesh, Face } from "./mesh.js";
import type { Vec3 } from "../math/vector3.js";
import { perpendicular } from "../math/vector3.js";
import type { SampledLoop } from "../world/trackSpline.js";
import { curvatureAt } from "../world/trackSpline.js";
import { ROAD_WIDTH, TRACK_GROUND_MARGIN } from "../util/constants.js";

function offsetPoint(center: Vec3, perp: Vec3, distance: number, z: number): Vec3 {
  return { x: center.x + perp.x * distance, y: center.y + perp.y * distance, z };
}

const SURFACE_COLOR = "#3a3a3a";
const EDGE_COLOR = "#e8e8e8";
const CENTER_COLOR = "#d8c840";
const HALF_WIDTH = ROAD_WIDTH / 2;
const STRIPE_WIDTH = 0.25;
const SURFACE_Z = 0;
// Lane markings sit just above the road surface (not coplanar) so the
// GPU depth buffer doesn't have to break an exact tie between them.
const MARKING_Z = 0.01;
const DASH_ARC_LENGTH = 4; // meters per dash on/off interval

// Kerbs: the classic red/white curbing along both edges of a corner, absent
// on straights. Placed just outside the road's own paved edge (from
// HALF_WIDTH out to HALF_WIDTH + KERB_WIDTH) rather than replacing the
// white edge stripe, so both remain visible side by side.
const KERB_COLOR_RED = "#c81e1e";
const KERB_COLOR_WHITE = "#f0f0f0";
const KERB_WIDTH = 0.5;
const KERB_BLOCK_ARC_LENGTH = 2; // meters per red/white block
// 1/meters; a corner tighter than a ~100m radius gets kerbs. Comfortably
// catches every named corner in trackDefinitions.ts (tightest ~38m, widest
// sweeper 95m) while staying off on straights (curvature ~0 there).
const KERB_CURVATURE_THRESHOLD = 0.01;

/**
 * True if `point` falls inside (an approximation of) any of `loops`'
 * road surfaces — within HALF_WIDTH of some sampled centerline point.
 * Samples are spaced far more densely (TRACK_SAMPLE_SPACING) than the
 * road is wide, so this is an accurate proxy for "is this point under
 * that other road's pavement" without needing real polygon geometry.
 */
function isInsideAnySurface(point: Vec3, loops: SampledLoop[]): boolean {
  const thresholdSq = HALF_WIDTH * HALF_WIDTH;
  for (const loop of loops) {
    for (const sample of loop.samples) {
      const dx = point.x - sample.center.x;
      const dy = point.y - sample.center.y;
      if (dx * dx + dy * dy < thresholdSq) return true;
    }
  }
  return false;
}

/**
 * Extrudes one loop's constant-width road ribbon (surface + edge
 * stripes + dashed center line) into shared vertex/face arrays. Each
 * sample's tangent gives the perpendicular ("left"/"right") direction
 * the road width is offset along at that point, so the ribbon follows
 * curves correctly.
 *
 * The surface is always drawn — overlapping same-colored surfaces from
 * crossing loops are visually seamless. Lane markings (edge stripes,
 * center dash) are each independently suppressed wherever they'd fall
 * inside another loop's surface, so a crossing reads as a clean union
 * boundary instead of showing every loop's full painted perimeter.
 */
function addRoadRibbon(vertices: Vec3[], faces: Face[], loop: SampledLoop, otherLoops: SampledLoop[]): void {
  const count = loop.samples.length;
  const segmentCount = loop.closed ? count : count - 1;

  for (let i = 0; i < segmentCount; i++) {
    const a = loop.samples[i];
    const b = loop.samples[(i + 1) % count];
    const perpA = perpendicular(a.tangent);
    const perpB = perpendicular(b.tangent);

    const leftA = offsetPoint(a.center, perpA, HALF_WIDTH, SURFACE_Z);
    const rightA = offsetPoint(a.center, perpA, -HALF_WIDTH, SURFACE_Z);
    const leftB = offsetPoint(b.center, perpB, HALF_WIDTH, SURFACE_Z);
    const rightB = offsetPoint(b.center, perpB, -HALF_WIDTH, SURFACE_Z);

    const surfaceBase = vertices.length;
    vertices.push(leftA, rightA, rightB, leftB);
    faces.push({ indices: [surfaceBase, surfaceBase + 1, surfaceBase + 2, surfaceBase + 3], color: SURFACE_COLOR });

    const leftOuterA = offsetPoint(a.center, perpA, HALF_WIDTH, MARKING_Z);
    const leftOuterB = offsetPoint(b.center, perpB, HALF_WIDTH, MARKING_Z);
    if (!isInsideAnySurface(leftOuterA, otherLoops) && !isInsideAnySurface(leftOuterB, otherLoops)) {
      const leftInnerA = offsetPoint(a.center, perpA, HALF_WIDTH - STRIPE_WIDTH, MARKING_Z);
      const leftInnerB = offsetPoint(b.center, perpB, HALF_WIDTH - STRIPE_WIDTH, MARKING_Z);
      const leftBase = vertices.length;
      vertices.push(leftOuterA, leftInnerA, leftInnerB, leftOuterB);
      faces.push({ indices: [leftBase, leftBase + 1, leftBase + 2, leftBase + 3], color: EDGE_COLOR });
    }

    const rightOuterA = offsetPoint(a.center, perpA, -HALF_WIDTH, MARKING_Z);
    const rightOuterB = offsetPoint(b.center, perpB, -HALF_WIDTH, MARKING_Z);
    if (!isInsideAnySurface(rightOuterA, otherLoops) && !isInsideAnySurface(rightOuterB, otherLoops)) {
      const rightInnerA = offsetPoint(a.center, perpA, -(HALF_WIDTH - STRIPE_WIDTH), MARKING_Z);
      const rightInnerB = offsetPoint(b.center, perpB, -(HALF_WIDTH - STRIPE_WIDTH), MARKING_Z);
      const rightBase = vertices.length;
      vertices.push(rightInnerA, rightOuterA, rightOuterB, rightInnerB);
      faces.push({ indices: [rightBase, rightBase + 1, rightBase + 2, rightBase + 3], color: EDGE_COLOR });
    }

    // Unlike the edge stripes (the union's outer boundary, suppressed
    // inside an overlap), the center dash is a lane guide and stays
    // visible straight through a crossing, same as a real intersection.
    const dashPhase = Math.floor(a.arcLength / DASH_ARC_LENGTH) % 2;
    if (dashPhase === 0) {
      const centerHalf = STRIPE_WIDTH / 2;
      const centerLeftA = offsetPoint(a.center, perpA, centerHalf, MARKING_Z);
      const centerRightA = offsetPoint(a.center, perpA, -centerHalf, MARKING_Z);
      const centerLeftB = offsetPoint(b.center, perpB, centerHalf, MARKING_Z);
      const centerRightB = offsetPoint(b.center, perpB, -centerHalf, MARKING_Z);
      const centerBase = vertices.length;
      vertices.push(centerLeftA, centerRightA, centerRightB, centerLeftB);
      faces.push({ indices: [centerBase, centerBase + 1, centerBase + 2, centerBase + 3], color: CENTER_COLOR });
    }
  }
}

/**
 * Extrudes red/white kerb blocks along both edges of one loop, but only
 * where the track curves tighter than KERB_CURVATURE_THRESHOLD — a segment
 * is included if either endpoint is in a corner, so the kerb's start/end
 * doesn't cut off mid-block right at the threshold. Blocks alternate color
 * by arc length (same technique as the dashed center line) and are
 * suppressed against other loops' surfaces at a crossing, same as the edge
 * stripes.
 */
function addKerbs(vertices: Vec3[], faces: Face[], loop: SampledLoop, otherLoops: SampledLoop[]): void {
  const curvature = curvatureAt(loop);
  const count = loop.samples.length;
  const segmentCount = loop.closed ? count : count - 1;

  for (let i = 0; i < segmentCount; i++) {
    const nextIndex = (i + 1) % count;
    if (Math.abs(curvature[i]) < KERB_CURVATURE_THRESHOLD && Math.abs(curvature[nextIndex]) < KERB_CURVATURE_THRESHOLD) {
      continue;
    }

    const a = loop.samples[i];
    const b = loop.samples[nextIndex];
    const perpA = perpendicular(a.tangent);
    const perpB = perpendicular(b.tangent);
    const color = Math.floor(a.arcLength / KERB_BLOCK_ARC_LENGTH) % 2 === 0 ? KERB_COLOR_RED : KERB_COLOR_WHITE;

    const leftInnerA = offsetPoint(a.center, perpA, HALF_WIDTH, MARKING_Z);
    const leftOuterA = offsetPoint(a.center, perpA, HALF_WIDTH + KERB_WIDTH, MARKING_Z);
    const leftInnerB = offsetPoint(b.center, perpB, HALF_WIDTH, MARKING_Z);
    const leftOuterB = offsetPoint(b.center, perpB, HALF_WIDTH + KERB_WIDTH, MARKING_Z);
    if (!isInsideAnySurface(leftOuterA, otherLoops) && !isInsideAnySurface(leftOuterB, otherLoops)) {
      const leftBase = vertices.length;
      vertices.push(leftOuterA, leftInnerA, leftInnerB, leftOuterB);
      faces.push({ indices: [leftBase, leftBase + 1, leftBase + 2, leftBase + 3], color });
    }

    const rightInnerA = offsetPoint(a.center, perpA, -HALF_WIDTH, MARKING_Z);
    const rightOuterA = offsetPoint(a.center, perpA, -(HALF_WIDTH + KERB_WIDTH), MARKING_Z);
    const rightInnerB = offsetPoint(b.center, perpB, -HALF_WIDTH, MARKING_Z);
    const rightOuterB = offsetPoint(b.center, perpB, -(HALF_WIDTH + KERB_WIDTH), MARKING_Z);
    if (!isInsideAnySurface(rightOuterA, otherLoops) && !isInsideAnySurface(rightOuterB, otherLoops)) {
      const rightBase = vertices.length;
      vertices.push(rightInnerA, rightOuterA, rightOuterB, rightInnerB);
      faces.push({ indices: [rightBase, rightBase + 1, rightBase + 2, rightBase + 3], color });
    }
  }
}

/**
 * Builds the combined road ribbon mesh for every loop in a track. Loops
 * are independent (see TrackDefinition's doc comment) — surfaces are
 * concatenated as-is (overlap is visually seamless), while each loop's
 * lane markings are suppressed against every *other* loop's surface so
 * crossings read as a clean union rather than showing every loop's
 * full painted perimeter.
 */
export function createRoadRibbonMesh(loops: SampledLoop[]): Mesh {
  const vertices: Vec3[] = [];
  const faces: Face[] = [];
  for (let i = 0; i < loops.length; i++) {
    const otherLoops = loops.filter((_, j) => j !== i);
    addRoadRibbon(vertices, faces, loops[i], otherLoops);
    addKerbs(vertices, faces, loops[i], otherLoops);
  }
  return { vertices, faces };
}

/** A single flat ground quad covering every loop's combined bounding box plus a margin. */
export function createGroundMesh(loops: SampledLoop[]): Mesh {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const loop of loops) {
    for (const sample of loop.samples) {
      minX = Math.min(minX, sample.center.x);
      maxX = Math.max(maxX, sample.center.x);
      minY = Math.min(minY, sample.center.y);
      maxY = Math.max(maxY, sample.center.y);
    }
  }

  const margin = TRACK_GROUND_MARGIN;
  const z = -0.05; // below the road surface (z=0) to avoid z-fighting
  const vertices: Vec3[] = [
    { x: minX - margin, y: minY - margin, z },
    { x: maxX + margin, y: minY - margin, z },
    { x: maxX + margin, y: maxY + margin, z },
    { x: minX - margin, y: maxY + margin, z },
  ];
  const faces: Face[] = [{ indices: [0, 1, 2, 3], color: "#3f7a3f" }];

  return { vertices, faces };
}
