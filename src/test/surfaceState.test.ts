import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifySurface, ROAD_SURFACE } from "../world/surfaceState.js";
import { ROAD_WIDTH } from "../util/constants.js";
import { DEFAULT_CAR } from "../util/cars/index.js";
import { Player } from "../entities/player.js";
import { PHYSICS_DT, controls } from "./helpers.js";

const TIRE_GRIP = DEFAULT_CAR.chassis.tireGrip;

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
    // 30 steps (0.25s) is enough for the wheel to reach ~99.9% lock
    // (WHEEL_STEER_SMOOTH_PER_SEC) while staying above the low-speed arcade
    // yaw assist's fade-out speed (LOW_SPEED_ASSIST_MAX_SPEED) despite heavy
    // off-road coast drag -- that assist intentionally bypasses the friction
    // circle at very low speed, which this test isn't exercising.
    for (let i = 0; i < 30; i++) player.update(PHYSICS_DT, controls({ steerRight: true }), offRoad);

    const expectedGrip = TIRE_GRIP * offRoad.gripMultiplier;
    // Use the actual measured coast decel (friction plus RPM-scaled engine
    // braking, see braking.test.ts) rather than recomputing just the friction
    // term — engine braking varies with gear/RPM, so hand-rolling it here would
    // drift from the real friction-circle budget the production code spends.
    const coastDecel = Math.abs(player.longitudinalAccel);
    const expectedLateral = Math.sqrt(Math.max(0, expectedGrip * expectedGrip - coastDecel * coastDecel));
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
