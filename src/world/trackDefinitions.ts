import type { Vec3 } from "../math/vector3.js";

/** One continuous path: sparse authoring control points plus whether it loops. */
export interface TrackLoop {
  points: Vec3[];
  closed: boolean;
}

/**
 * A track's sparse authoring control points — exactly the shape an
 * external track-builder tool would export (one or more polylines,
 * each optionally looping). Every track is a single loop.
 * world/trackSpline.ts turns each loop into a smooth, densely-sampled
 * curve. (TrackDefinition still models `loops` as an array for forward
 * compatibility with a future multi-loop track, but nothing produces
 * more than one today.)
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

/** Midpoint between two points, in the flat (z = 0) ground plane — used for straight-segment anchors. */
function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: 0 };
}

/**
 * A point on a circle's rim, i.e. arcPoints() with a single sample — for
 * one-off anchor points rather than a densely-sampled arc.
 */
function pointOnCircle(centerX: number, centerY: number, radius: number, angleDeg: number): Vec3 {
  const angle = (angleDeg * Math.PI) / 180;
  return { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle), z: 0 };
}

/**
 * A "flowing circuit": four distinctly different corners (fast sweeper,
 * medium, tight, and a tight-in/opening-out compound corner) connected by
 * straights, instead of one radius repeated four times.
 *
 * The sweeper/medium/tight corners use the same construction as the old
 * uniform rounded rectangle, just with independent radii per corner —
 * each corner circle is still inscribed so it reaches exactly the box
 * edge, which is what keeps every straight-to-arc transition tangent
 * (no kink) regardless of that corner's own radius.
 *
 * The fourth corner is a compound curve: two arcs of different radius,
 * turning the same direction, joined at the same angle on both circles.
 * arcPoints()'s tangent at angle θ is (−sinθ, cosθ) — independent of
 * radius — so two arcs sharing a join angle automatically share a
 * tangent there (no kink); the second arc's center is offset from the
 * first along the radius direction at that angle by (r1 − r2). That's
 * what makes the corner tighten on entry and open up on exit.
 */
export function createRoundedRectangleTrack(): TrackDefinition {
  const xMin = -160;
  const xMax = 160;
  const yMin = -100;
  const yMax = 140;

  const rSweeper = 95; // fast sweeper: ~87 mph grip-limited
  const rMedium = 65; // medium corner: ~72 mph
  const rTight = 45; // tight corner, not a hairpin: ~60 mph

  const sweeper = { x: xMax - rSweeper, y: yMax - rSweeper };
  const medium = { x: xMin + rMedium, y: yMax - rMedium };
  const tight = { x: xMin + rTight, y: yMin + rTight };

  // Compound "tight-in, opening-out" corner: entry arc (rIn) tangent-joins
  // exit arc (rOut) at joinDeg on both circles (see doc comment above).
  const rIn = 38;
  const rOut = 80;
  const joinDeg = 308; // entry sweeps 270 -> 308 (38 deg tight turn-in)
  const joinRad = (joinDeg * Math.PI) / 180;
  // c1.x is solved backwards from the constraint that the EXIT arc must
  // reach exactly x = xMax at its far end (angle 360), same tangency
  // guarantee the other three corners get for free from their box position.
  const compoundEntry = {
    x: xMax - rOut - (rIn - rOut) * Math.cos(joinRad),
    y: yMin + rIn,
  };
  const compoundExit = {
    x: compoundEntry.x + (rIn - rOut) * Math.cos(joinRad),
    y: compoundEntry.y + (rIn - rOut) * Math.sin(joinRad),
  };

  const tightExit = pointOnCircle(tight.x, tight.y, rTight, 270); // start of bottom straight
  const compoundEntryStart = pointOnCircle(compoundEntry.x, compoundEntry.y, rIn, 270);
  const compoundExitEnd = pointOnCircle(compoundExit.x, compoundExit.y, rOut, 360);
  const sweeperStart = pointOnCircle(sweeper.x, sweeper.y, rSweeper, 0);
  const sweeperEnd = pointOnCircle(sweeper.x, sweeper.y, rSweeper, 90);
  const mediumStart = pointOnCircle(medium.x, medium.y, rMedium, 90);
  const mediumEnd = pointOnCircle(medium.x, medium.y, rMedium, 180);
  const tightStart = pointOnCircle(tight.x, tight.y, rTight, 180);

  const points: Vec3[] = [
    tightExit, // start of bottom straight (also the tight corner's exit)
    midpoint(tightExit, compoundEntryStart), // bottom straight
    ...arcPoints(compoundEntry.x, compoundEntry.y, rIn, 270, joinDeg, 4), // opening corner: tight-in
    ...arcPoints(compoundExit.x, compoundExit.y, rOut, joinDeg, 360, 5), // opening corner: opening-out
    midpoint(compoundExitEnd, sweeperStart), // short right straight
    ...arcPoints(sweeper.x, sweeper.y, rSweeper, 0, 90, 10), // SWEEPER
    midpoint(sweeperEnd, mediumStart), // top straight
    ...arcPoints(medium.x, medium.y, rMedium, 90, 180, 8), // MEDIUM
    midpoint(mediumEnd, tightStart), // left straight (braking zone into the tight corner)
    ...arcPoints(tight.x, tight.y, rTight, 180, 270, 8).slice(0, -1), // TIGHT, drop dup of start
  ];

  return { name: "Circuit", loops: [{ points, closed: true }] };
}

/** A stadium/oval: two long straights joined by semicircular ends — the "endless straight road" feel, looped. */
export function createOvalTrack(): TrackDefinition {
  const halfStraight = 110;
  const radius = 60;

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
 * A figure-eight, authored as ONE continuous closed loop that pinches
 * through itself at a single shared point rather than as two separate
 * loops. Two lobes with different personalities: lobe A is a single
 * large circle (fast, flowing, minimal technical demand — the same role
 * the oval plays as its own track). Lobe B is a smaller rounded
 * rectangle with four DIFFERENT corner radii (same per-corner-radius
 * construction as createRoundedRectangleTrack, just without a compound
 * corner) — more corners, tighter radii, a genuinely different,
 * more technical lobe.
 *
 * Both lobes are authored so they pass through the shared origin with a
 * matching (vertical) tangent, and lobe B's own point order is reversed
 * before splicing so its direction of travel through the origin agrees
 * with lobe A's, rather than opposing it: gluing them together nose-to-
 * tail like that keeps the joined path's direction continuous at the
 * pinch (a real crossing, direction reversing there, produces a near-
 * cusp under Catmull-Rom — checked empirically at min radius ~2.6,
 * vs. ~37 for this nose-to-tail splice, which is in line with the
 * tightest corners on the other tracks).
 */
export function createFigureEightTrack(): TrackDefinition {
  const radiusA = 80; // fast sweeper lobe
  const samplesPerLoop = 20;

  // Lobe A starts and ends at the shared origin (0, 0) — that's the
  // pinch point where the two lobes touch.
  const loopA = arcPoints(-radiusA, 0, radiusA, 0, 360, samplesPerLoop).slice(0, -1);

  // Lobe B: a small rounded rectangle, xMin pinned to 0 so its left
  // straight runs right through the shared origin (same pinch point
  // lobe A passes through, at a matching vertical tangent there).
  const bXMin = 0;
  const bXMax = 150;
  const bYMin = -70;
  const bYMax = 70;
  const rTR = 55;
  const rTL = 45;
  const rBL = 40;
  const rBR = 50;

  const bTR = { x: bXMax - rTR, y: bYMax - rTR };
  const bTL = { x: bXMin + rTL, y: bYMax - rTL };
  const bBL = { x: bXMin + rBL, y: bYMin + rBL };
  const bBR = { x: bXMax - rBR, y: bYMin + rBR };

  const loopBPoints: Vec3[] = [
    pointOnCircle(bBR.x, bBR.y, rBR, 0), // bottom of right straight
    ...arcPoints(bTR.x, bTR.y, rTR, 0, 90, 8),
    midpoint(pointOnCircle(bTR.x, bTR.y, rTR, 90), pointOnCircle(bTL.x, bTL.y, rTL, 90)), // top straight
    ...arcPoints(bTL.x, bTL.y, rTL, 90, 180, 8),
    { x: 0, y: 0, z: 0 }, // left straight, through the origin (the pinch point)
    ...arcPoints(bBL.x, bBL.y, rBL, 180, 270, 8),
    midpoint(pointOnCircle(bBL.x, bBL.y, rBL, 270), pointOnCircle(bBR.x, bBR.y, rBR, 270)), // bottom straight
    ...arcPoints(bBR.x, bBR.y, rBR, 270, 360, 8).slice(0, -1),
  ];

  // Reverse lobe B's direction of travel, then rotate so it starts at
  // the shared origin — see doc comment above for why.
  const reversed = loopBPoints.slice().reverse();
  const originIndex = reversed.findIndex((p) => p.x === 0 && p.y === 0);
  const loopB = [...reversed.slice(originIndex), ...reversed.slice(0, originIndex)];

  return {
    name: "Figure Eight",
    loops: [{ points: [...loopA, ...loopB], closed: true }],
  };
}

/**
 * Lays a sine-wave lateral wiggle between two points on an otherwise
 * straight edge, for a serpentine "chicane weave" section — inspired by
 * the tight, technical S-curves on real go-kart tracks, unlike this
 * project's other tracks which use one flowing corner at a time.
 *
 * The wiggle's envelope (sin(pi*t)) tapers it to exactly 0 at both t=0 and
 * t=1 — not just the position but the DERIVATIVE too (since
 * d/dt[envelope*sin(2*pi*cycles*t)] at t=0/1 has both terms vanish: the
 * envelope itself at the endpoints, and sin(2*pi*cycles*t) at those same
 * points). That's what makes this safe to splice between two corners built
 * the normal (box-inscribed-circle) way: it reconnects at exactly the
 * given start/end points along exactly the edge's own straight-line
 * tangent, with no kink and no separate closure math required, unlike a
 * hand-built turn-by-turn path (which needs the turn angles and straight
 * lengths solved together to close the loop at all).
 */
function serpentineEdge(start: Vec3, end: Vec3, amplitude: number, cycles: number, samples: number): Vec3[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const tangent = { x: dx / length, y: dy / length };
  const perp = { x: -tangent.y, y: tangent.x };
  const points: Vec3[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const envelope = Math.sin(Math.PI * t);
    const wiggle = amplitude * envelope * Math.sin(2 * Math.PI * cycles * t);
    points.push({ x: start.x + dx * t + perp.x * wiggle, y: start.y + dy * t + perp.y * wiggle, z: 0 });
  }
  return points;
}

/**
 * A technical, go-kart-style circuit: the same box-inscribed-corner
 * construction as createRoundedRectangleTrack (four corners of different
 * radii, each touching the box edge so every straight-to-arc transition
 * stays tangent), but the top edge is a serpentine weave (see
 * serpentineEdge) instead of a plain straight — a real chicane section to
 * stress-test the racing line/AI against tight, technical S-curves rather
 * than only flowing single-radius corners.
 */
export function createSerpentineTrack(): TrackDefinition {
  const xMin = -150;
  const xMax = 150;
  const yMin = -95;
  const yMax = 95;

  const rBottomRight = 35; // tight
  const rTopRight = 75; // sweeper
  const rTopLeft = 40; // tight
  const rBottomLeft = 55; // medium

  const bottomRight = { x: xMax - rBottomRight, y: yMin + rBottomRight };
  const topRight = { x: xMax - rTopRight, y: yMax - rTopRight };
  const topLeft = { x: xMin + rTopLeft, y: yMax - rTopLeft };
  const bottomLeft = { x: xMin + rBottomLeft, y: yMin + rBottomLeft };

  const topEdgeStart = pointOnCircle(topRight.x, topRight.y, rTopRight, 90);
  const topEdgeEnd = pointOnCircle(topLeft.x, topLeft.y, rTopLeft, 90);

  const points: Vec3[] = [
    ...arcPoints(bottomRight.x, bottomRight.y, rBottomRight, 270, 360, CORNER_SAMPLES), // bottom-right corner
    pointOnCircle(topRight.x, topRight.y, rTopRight, 0), // right edge (straight)
    ...arcPoints(topRight.x, topRight.y, rTopRight, 0, 90, CORNER_SAMPLES + 4), // top-right sweeper
    ...serpentineEdge(topEdgeStart, topEdgeEnd, 20, 2.5, 60).slice(1, -1), // top edge: serpentine weave
    ...arcPoints(topLeft.x, topLeft.y, rTopLeft, 90, 180, CORNER_SAMPLES), // top-left corner
    pointOnCircle(bottomLeft.x, bottomLeft.y, rBottomLeft, 180), // left edge (straight)
    ...arcPoints(bottomLeft.x, bottomLeft.y, rBottomLeft, 180, 270, CORNER_SAMPLES).slice(0, -1), // bottom-left corner
  ];

  return { name: "Serpentine", loops: [{ points, closed: true }] };
}

export const TRACK_GENERATORS: Record<string, () => TrackDefinition> = {
  roundedRectangle: createRoundedRectangleTrack,
  oval: createOvalTrack,
  figureEight: createFigureEightTrack,
  serpentine: createSerpentineTrack,
};

export const DEFAULT_TRACK_TYPE = "roundedRectangle";
