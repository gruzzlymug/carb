import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifySurface, ROAD_SURFACE } from "../world/surfaceState.js";
import { ROAD_WIDTH, TIRE_GRIP, FRICTION } from "../util/constants.js";
import { Player } from "../entities/player.js";
import { PHYSICS_DT, controls } from "./helpers.js";

const HALF_WIDTH = ROAD_WIDTH / 2;

describe("classifySurface", () => {
  it("classifies within the paved half-width as road", () => {
    assert.equal(classifySurface(0).kind, "road");
    assert.equal(classifySurface(HALF_WIDTH).kind, "road");
  });

  it("classifies just beyond the paved edge as shoulder", () => {
    assert.equal(classifySurface(HALF_WIDTH + 1).kind, "shoulder");
  });

  it("classifies well beyond the paved edge as offRoad", () => {
    assert.equal(classifySurface(HALF_WIDTH + 100).kind, "offRoad");
  });

  it("road surface is a full-grip, full-drag no-op", () => {
    assert.equal(ROAD_SURFACE.gripMultiplier, 1);
    assert.equal(ROAD_SURFACE.dragMultiplier, 1);
  });
});

describe("Player surface-dependent physics", () => {
  it("omitting the surface argument behaves identically to explicit ROAD_SURFACE", () => {
    const withDefault = new Player();
    const withExplicitRoad = new Player();
    for (let i = 0; i < 200; i++) {
      withDefault.update(PHYSICS_DT, controls({ throttle: true, steerRight: true }));
      withExplicitRoad.update(PHYSICS_DT, controls({ throttle: true, steerRight: true }), ROAD_SURFACE);
    }
    assert.equal(withDefault.speed, withExplicitRoad.speed);
    assert.equal(withDefault.heading, withExplicitRoad.heading);
    assert.equal(withDefault.position.x, withExplicitRoad.position.x);
    assert.equal(withDefault.position.y, withExplicitRoad.position.y);
  });

  it("off-road cornering grip is reduced by exactly gripMultiplier", () => {
    const offRoad = classifySurface(HALF_WIDTH + 100);
    assert.ok(offRoad.gripMultiplier < 1, "test assumes off-road reduces grip");

    const player = new Player();
    // Reach speed and full lock while already off-road, so this step's longAccel
    // (coast friction, scaled by dragMultiplier) is consistent with the surface
    // used for the grip check below.
    for (let i = 0; i < 20000 && player.speed < 40 * 0.44704; i++) {
      player.update(PHYSICS_DT, controls({ throttle: true }), offRoad);
    }
    for (let i = 0; i < 60; i++) player.update(PHYSICS_DT, controls({ steerRight: true }), offRoad);

    const expectedGrip = TIRE_GRIP * offRoad.gripMultiplier;
    const expectedFriction = FRICTION * offRoad.dragMultiplier;
    // Clamped like the production friction-circle math: with these placeholder
    // multipliers, off-road coast friction alone already exceeds the reduced grip
    // budget, so available lateral grip legitimately floors at 0 while coasting
    // off-road (a real, if extreme, consequence of the placeholder numbers — see
    // ENGINE_ROADMAP.md's Tuning backlog).
    const expectedLateral = Math.sqrt(Math.max(0, expectedGrip * expectedGrip - expectedFriction * expectedFriction));
    assert.ok(
      Math.abs(player.lateralAccel - expectedLateral) < 0.05,
      `expected lateralAccel ~${expectedLateral.toFixed(2)}, got ${player.lateralAccel.toFixed(2)}`
    );
  });

  it("off-road coast drag decelerates faster than on-road", () => {
    const offRoad = classifySurface(HALF_WIDTH + 100);
    const onRoadPlayer = new Player();
    const offRoadPlayer = new Player();
    for (let i = 0; i < 20000 && onRoadPlayer.speed < 40 * 0.44704; i++) {
      onRoadPlayer.update(PHYSICS_DT, controls({ throttle: true }));
      offRoadPlayer.update(PHYSICS_DT, controls({ throttle: true }), offRoad);
    }
    onRoadPlayer.update(PHYSICS_DT, controls({}));
    offRoadPlayer.update(PHYSICS_DT, controls({}), offRoad);
    assert.ok(
      Math.abs(offRoadPlayer.longitudinalAccel) > Math.abs(onRoadPlayer.longitudinalAccel),
      "off-road coast drag should decelerate harder than on-road"
    );
  });
});
