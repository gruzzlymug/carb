import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createOvalTrack, createFigureEightTrack } from "../world/trackDefinitions.js";
import { sampleTrack } from "../world/trackSpline.js";
import { buildTrackQuery } from "../world/trackQuery.js";

// Must track createOvalTrack()'s/createFigureEightTrack()'s own parameters in
// trackDefinitions.ts — there's no way to derive these from the sampled output
// without just re-deriving the generator, so keep these in sync by hand.
const OVAL_RADIUS = 60;
const OVAL_HALF_STRAIGHT = 110;
const FIGURE_EIGHT_RADIUS = 65;

describe("TrackQuery — oval track", () => {
  const query = buildTrackQuery(sampleTrack(createOvalTrack()));

  it("reports ~0 lateral offset exactly on the straight's centerline", () => {
    const result = query.nearestPoint({ x: OVAL_RADIUS, y: 0, z: 0 });
    assert.ok(Math.abs(result.lateralOffset) < 0.01);
    assert.equal(result.onRoad, true);
  });

  it("reports signed lateral offset left/right of the straight, matching perpendicular()'s convention", () => {
    const left = query.nearestPoint({ x: OVAL_RADIUS - 3, y: 0, z: 0 });
    const right = query.nearestPoint({ x: OVAL_RADIUS + 3, y: 0, z: 0 });
    assert.ok(Math.abs(left.lateralOffset - 3) < 0.01, `expected ~+3, got ${left.lateralOffset}`);
    assert.ok(Math.abs(right.lateralOffset + 3) < 0.01, `expected ~-3, got ${right.lateralOffset}`);
  });

  it("reports curvature matching the arc's actual radius on the curved section", () => {
    const result = query.nearestPoint({ x: 0, y: OVAL_HALF_STRAIGHT + OVAL_RADIUS, z: 0 }); // top semicircle
    assert.ok(Math.abs(Math.abs(result.curvature) - 1 / OVAL_RADIUS) < 0.001);
  });

  it("reports onRoad: false far from the track", () => {
    const result = query.nearestPoint({ x: 1000, y: 1000, z: 0 });
    assert.equal(result.onRoad, false);
  });
});

describe("TrackQuery — figure-eight (two independent loops)", () => {
  const query = buildTrackQuery(sampleTrack(createFigureEightTrack()));

  it("resolves loopIndex independently for each loop", () => {
    const leftLoop = query.nearestPoint({ x: -FIGURE_EIGHT_RADIUS, y: 0, z: 0 }); // left circle's own center
    const rightLoop = query.nearestPoint({ x: FIGURE_EIGHT_RADIUS, y: 0, z: 0 }); // right circle's own center
    assert.equal(leftLoop.loopIndex, 0);
    assert.equal(rightLoop.loopIndex, 1);
  });
});
