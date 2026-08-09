import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CAR } from "../util/cars/index.js";
import { playerAtSpeed, step, controls } from "./helpers.js";

describe("handbrake rear-grip rotation (slip/drift state)", () => {
  it("never drifts during ordinary cornering that never touches the handbrake", () => {
    // Regression guard for a real bug caught during development: a naive
    // continuous blend-toward-heading has a nonzero steady-state lag whenever
    // heading is continuously rotating, even starting from equality. This must
    // stay exactly 0 at every speed, not just "small".
    for (const mph of [30, 60, 90, 120]) {
      const player = playerAtSpeed(mph);
      step(player, 120, controls({ steerRight: true })); // 1s of sustained full-lock cornering
      assert.equal(player.driftAngleDeg, 0);
      assert.equal(player.isDrifting, false);
    }
  });

  it("handbrake + steering produces a real, growing slide", () => {
    const player = playerAtSpeed(40);
    step(player, 60, controls({ handbrake: true, steerRight: true })); // 0.5s
    assert.ok(Math.abs(player.driftAngleDeg) > 15, `expected a real slide, got ${player.driftAngleDeg.toFixed(1)}deg`);
    assert.equal(player.isDrifting, true);
  });

  it("releasing the handbrake recovers the slide back to exactly zero", () => {
    const player = playerAtSpeed(40);
    step(player, 60, controls({ handbrake: true, steerRight: true }));
    assert.ok(Math.abs(player.driftAngleDeg) > 15, "should be sliding before release");
    step(player, 60, controls({ steerRight: true })); // handbrake released, keep steering
    assert.equal(player.driftAngleDeg, 0, "slide should have fully caught up by now");
    assert.equal(player.isDrifting, false);
  });

  it("handbrake + full lock at high speed stays bounded at HANDBRAKE_MAX_YAW_RATE", () => {
    const player = playerAtSpeed(150);
    step(player, 20, controls({ handbrake: true, steerRight: true }));
    const yawRateRad = (player.yawRateDeg * Math.PI) / 180;
    assert.ok(Math.abs(yawRateRad) <= DEFAULT_CAR.chassis.handbrakeMaxYawRate + 1e-6, "yaw rate should not exceed the stability cap");
    assert.ok(Math.abs(yawRateRad) > DEFAULT_CAR.chassis.handbrakeMaxYawRate - 0.05, "should be pinned at the cap, not far under it");
  });

  it("handbrake with no steering input just decelerates in a straight line", () => {
    const player = playerAtSpeed(60);
    step(player, 60, controls({ handbrake: true }));
    assert.equal(player.yawRateDeg, 0);
    assert.equal(player.driftAngleDeg, 0);
  });
});
