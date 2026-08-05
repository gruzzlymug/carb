import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TIRE_GRIP, FRICTION, BRAKE_FORCE } from "../util/constants.js";
import { playerAtSpeed, step, controls } from "./helpers.js";

describe("friction-circle cornering grip", () => {
  it("coasting lateral grip matches sqrt(TIRE_GRIP^2 - FRICTION^2) at every speed", () => {
    const expected = Math.sqrt(TIRE_GRIP * TIRE_GRIP - FRICTION * FRICTION);
    for (const mph of [30, 60, 90, 120, 150]) {
      const player = playerAtSpeed(mph);
      step(player, 40, controls({ steerRight: true })); // let wheel steer reach full lock
      assert.ok(
        Math.abs(player.lateralAccel - expected) < 0.05,
        `at ${mph} mph expected lateralAccel ~${expected.toFixed(2)}, got ${player.lateralAccel.toFixed(2)}`
      );
      assert.equal(player.steeringLimit, "grip");
    }
  });

  it("full brake (exceeding TIRE_GRIP) zeroes cornering capacity entirely", () => {
    assert.ok(BRAKE_FORCE > TIRE_GRIP, "test assumes BRAKE_FORCE exceeds TIRE_GRIP");
    const player = playerAtSpeed(60);
    step(player, 40, controls({ brake: true, steerRight: true }));
    // Math.abs normalizes -0 -> 0: the clamp math can legitimately land on
    // negative zero when the cap is exactly 0, which is not a real distinction.
    assert.equal(Math.abs(player.yawRateDeg), 0, "full-lock steering under full brake should produce zero yaw");
    assert.equal(Math.abs(player.lateralAccel), 0);
  });

  it("no steering input produces no yaw regardless of speed", () => {
    for (const mph of [10, 60, 150]) {
      const player = playerAtSpeed(mph);
      step(player, 10, controls({}));
      assert.equal(player.yawRateDeg, 0);
    }
  });
});
