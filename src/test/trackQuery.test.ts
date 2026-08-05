import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createOvalTrack, createFigureEightTrack } from "../world/trackDefinitions.js";
import { sampleTrack } from "../world/trackSpline.js";
import { buildTrackQuery } from "../world/trackQuery.js";

describe("TrackQuery — oval track", () => {
  const query = buildTrackQuery(sampleTrack(createOvalTrack()));

  it("reports ~0 lateral offset exactly on the straight's centerline", () => {
    const result = query.nearestPoint({ x: 35, y: 0, z: 0 });
    assert.ok(Math.abs(result.lateralOffset) < 0.01);
    assert.equal(result.onRoad, true);
  });

  it("reports signed lateral offset left/right of the straight, matching perpendicular()'s convention", () => {
    const left = query.nearestPoint({ x: 32, y: 0, z: 0 });
    const right = query.nearestPoint({ x: 38, y: 0, z: 0 });
    assert.ok(Math.abs(left.lateralOffset - 3) < 0.01, `expected ~+3, got ${left.lateralOffset}`);
    assert.ok(Math.abs(right.lateralOffset + 3) < 0.01, `expected ~-3, got ${right.lateralOffset}`);
  });

  it("reports curvature matching the arc's actual radius (1/35) on the curved section", () => {
    const result = query.nearestPoint({ x: 0, y: 125, z: 0 }); // top semicircle, radius 35
    assert.ok(Math.abs(Math.abs(result.curvature) - 1 / 35) < 0.001);
  });

  it("reports onRoad: false far from the track", () => {
    const result = query.nearestPoint({ x: 1000, y: 1000, z: 0 });
    assert.equal(result.onRoad, false);
  });
});

describe("TrackQuery — figure-eight (two independent loops)", () => {
  const query = buildTrackQuery(sampleTrack(createFigureEightTrack()));

  it("resolves loopIndex independently for each loop", () => {
    const leftLoop = query.nearestPoint({ x: -45, y: 0, z: 0 }); // left circle's own center
    const rightLoop = query.nearestPoint({ x: 45, y: 0, z: 0 }); // right circle's own center
    assert.equal(leftLoop.loopIndex, 0);
    assert.equal(rightLoop.loopIndex, 1);
  });
});
