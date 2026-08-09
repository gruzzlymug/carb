import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CAR } from "../util/cars/index.js";
import { playerAtSpeed, step, controls } from "./helpers.js";

const TIRE_GRIP = DEFAULT_CAR.chassis.tireGrip;

describe("friction-circle cornering grip", () => {
  it("coasting lateral grip matches sqrt(TIRE_GRIP^2 - coastDecel^2) at every speed", () => {
    for (const mph of [30, 60, 90, 120, 150]) {
      const player = playerAtSpeed(mph);
      step(player, 40, controls({ steerRight: true })); // let wheel steer reach full lock
      // Coast decel (FRICTION plus RPM-scaled engine braking, see braking.test.ts) varies
      // by gear/speed — use the actual measured value from this same step rather than
      // recomputing it, so there's no pre/post-step timing mismatch to account for.
      const coastDecel = Math.abs(player.longitudinalAccel);
      const expected = Math.sqrt(Math.max(0, TIRE_GRIP * TIRE_GRIP - coastDecel * coastDecel));
      assert.ok(
        Math.abs(player.lateralAccel - expected) < 0.05,
        `at ${mph} mph expected lateralAccel ~${expected.toFixed(2)}, got ${player.lateralAccel.toFixed(2)}`
      );
      assert.equal(player.steeringLimit, "grip");
    }
  });

  it("full brake (exceeding TIRE_GRIP) zeroes cornering capacity entirely", () => {
    assert.ok(DEFAULT_CAR.brakeForce > TIRE_GRIP, "test assumes brakeForce exceeds TIRE_GRIP");
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
