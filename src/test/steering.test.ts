import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CAR } from "../util/cars/index.js";
import { ROAD_SURFACE } from "../world/surfaceState.js";
import { interpolateCurve } from "../math/curve.js";
import { playerAtSpeed, step, controls } from "./helpers.js";

const TIRE_GRIP = DEFAULT_CAR.chassis.tireGrip;

/** Speed-scaled grip bonus applied to the friction circle — see Player.applySteering. */
function gripBonusAt(speedMs: number): number {
  return interpolateCurve(Math.abs(speedMs), DEFAULT_CAR.chassis.gripBonusCurve);
}

describe("friction-circle cornering grip", () => {
  it("coasting lateral grip never exceeds sqrt((TIRE_GRIP+gripBonus)^2 - coastDecel^2) at every speed", () => {
    // Since the curvature-first steering model (see Player.applySteering),
    // full lock deliberately demands only curvatureHeadroom-times the grip
    // limit rather than a huge multiple of it (that's the fix for the
    // wheels-vs-car disconnect: the soft knee now has the top of the
    // wheel's range to shape, instead of saturating in the first few
    // degrees) -- so lateralAccel at full lock is close to, but need not
    // converge tightly to, the physical ceiling. What must always hold is
    // that it never exceeds that ceiling.
    for (const mph of [30, 60, 90, 120, 150]) {
      const player = playerAtSpeed(mph);
      step(player, 40, controls({ steerRight: true })); // let wheel steer reach full lock
      // Coasting excludes engine braking from the friction-circle budget
      // (see update()'s coastSteeringDecelOverride) — only base drag
      // (friction * dragMultiplier, a flat constant on the road surface)
      // counts here, unlike player.longitudinalAccel's telemetry (the true
      // physical decel, including engine braking).
      const coastDecel = DEFAULT_CAR.friction * ROAD_SURFACE.dragMultiplier;
      const grip = TIRE_GRIP + gripBonusAt(player.speed);
      const ceiling = Math.sqrt(Math.max(0, grip * grip - coastDecel * coastDecel));
      assert.ok(
        player.lateralAccel > 0 && player.lateralAccel <= ceiling + 1e-6,
        `at ${mph} mph expected 0 < lateralAccel <= ${ceiling.toFixed(2)}, got ${player.lateralAccel.toFixed(2)}`
      );
      assert.equal(player.steeringLimit, "grip");
    }
  });

  it("full lock's grip demand stays within a small, roughly constant multiple of the physical limit (curvatureHeadroom) at any speed", () => {
    // The regression guard for the diagnosed bug: gripUtilization at full
    // lock used to read 2.9x at 30mph, 13x at 60mph, 48x at 120mph --
    // effectively unbounded growth with speed. It should now hover near
    // chassis.curvatureHeadroom regardless of speed.
    const headroom = DEFAULT_CAR.chassis.curvatureHeadroom;
    for (const mph of [30, 60, 90, 120]) {
      const player = playerAtSpeed(mph);
      step(player, 40, controls({ steerRight: true }));
      assert.ok(
        player.gripUtilization > 0.9 && player.gripUtilization < headroom + 0.3,
        `at ${mph} mph expected gripUtilization near ${headroom}, got ${player.gripUtilization.toFixed(2)}`
      );
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
