import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Player } from "../entities/player.js";
import { transmissionSettings } from "../util/transmissionSettings.js";
import { DEFAULT_CAR } from "../util/cars/index.js";
import { PHYSICS_DT, MPH, controls } from "./helpers.js";

// These tests need to climb through the gears to reach highway speeds —
// force automatic mode regardless of the app's own default.
transmissionSettings.mode = "automatic";

/** Steps full throttle from rest until `targetMph` is reached; returns elapsed seconds (Infinity if never reached). */
function timeToMph(targetMph: number, maxSteps = 40000): number {
  const player = new Player();
  const target = targetMph * MPH;
  for (let i = 0; i < maxSteps; i++) {
    player.update(PHYSICS_DT, controls({ throttle: true }));
    if (player.speed >= target) return (i + 1) * PHYSICS_DT;
  }
  return Infinity;
}

describe("acceleration", () => {
  // Baseline documented in ENGINE_ROADMAP.md's Tuning backlog (ACCELERATION = 8):
  // 0->60 ~2.9s, 0->100 ~5.8s. Generous tolerance — this guards against an
  // accidental regression (e.g. a sign error or unit slip), not a tuning target.
  it("reaches 60 mph in roughly the documented time", () => {
    const t = timeToMph(60);
    assert.ok(t > 2.0 && t < 4.0, `expected ~2.9s, got ${t.toFixed(2)}s`);
  });

  it("reaches 100 mph in roughly the documented time", () => {
    const t = timeToMph(100);
    assert.ok(t > 4.5 && t < 7.5, `expected ~5.8s, got ${t.toFixed(2)}s`);
  });

  it("never exceeds DEFAULT_CAR.maxSpeed even under sustained full throttle", () => {
    const player = new Player();
    for (let i = 0; i < 30000; i++) {
      player.update(PHYSICS_DT, controls({ throttle: true }));
      assert.ok(player.speed <= DEFAULT_CAR.maxSpeed + 1e-9, `speed ${player.speed} exceeded DEFAULT_CAR.maxSpeed ${DEFAULT_CAR.maxSpeed}`);
    }
  });

  it("approaches top speed (~152 mph) in top gear under sustained full throttle", () => {
    const player = new Player();
    for (let i = 0; i < 30000; i++) player.update(PHYSICS_DT, controls({ throttle: true }));
    const topMph = player.speed / MPH;
    assert.ok(topMph > 145 && topMph < 155, `expected ~152 mph, got ${topMph.toFixed(1)} mph`);
    assert.equal(player.gear, 5, "should have reached 5th gear at top speed");
  });
});
