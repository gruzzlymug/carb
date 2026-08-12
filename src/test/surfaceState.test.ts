import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifySurface, ROAD_SURFACE } from "../world/surfaceState.js";
import { ROAD_WIDTH } from "../util/constants.js";
import { DEFAULT_CAR } from "../util/cars/index.js";
import { Player } from "../entities/player.js";
import { interpolateCurve } from "../math/curve.js";
import { PHYSICS_DT, controls } from "./helpers.js";

const TIRE_GRIP = DEFAULT_CAR.chassis.tireGrip;

/** Speed-scaled grip bonus applied to the friction circle — see Player.applySteering. */
function gripBonusAt(speedMs: number): number {
  return interpolateCurve(Math.abs(speedMs), DEFAULT_CAR.chassis.gripBonusCurve);
}

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

  it("off-road cornering grip never exceeds the gripMultiplier-scaled ceiling", () => {
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
    // (WHEEL_STEER_SMOOTH_PER_SEC).
    for (let i = 0; i < 30; i++) player.update(PHYSICS_DT, controls({ steerRight: true }), offRoad);

    // Coasting excludes engine braking from the friction-circle budget (see
    // update()'s coastSteeringDecelOverride) -- only base drag (friction *
    // dragMultiplier) counts here, unlike player.longitudinalAccel's
    // telemetry (the true physical decel, including engine braking).
    const expectedGrip = (TIRE_GRIP + gripBonusAt(player.speed)) * offRoad.gripMultiplier;
    const coastDecel = DEFAULT_CAR.friction * offRoad.dragMultiplier;
    const ceiling = Math.sqrt(Math.max(0, expectedGrip * expectedGrip - coastDecel * coastDecel));
    // Not asserting near-equality to the ceiling: off-road, steeringGrip's
    // own (gripMultiplier-scaled) budget is small enough that coastDecel
    // alone can consume all of it, collapsing softSaturate's linear region
    // to zero width -- when that happens, yawRate eases toward the ceiling
    // more gradually (a real, intentional softer-degradation case), not the
    // near-full convergence typical when there's a healthy comfortable-grip
    // margin left. What must always hold is that it never exceeds the ceiling.
    assert.ok(
      player.lateralAccel > 0 && player.lateralAccel <= ceiling + 1e-6,
      `expected 0 < lateralAccel <= ${ceiling.toFixed(2)}, got ${player.lateralAccel.toFixed(2)}`
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
