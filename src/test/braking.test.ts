import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BRAKE_FORCE, HANDBRAKE_FORCE, FRICTION, ENGINE_BRAKING, IDLE_RPM, REDLINE_RPM } from "../util/constants.js";
import { rpmForGear } from "../util/engineModel.js";
import { Player } from "../entities/player.js";
import { playerAtSpeed, step, controls, MPH } from "./helpers.js";

describe("braking", () => {
  it("brake decelerates at exactly BRAKE_FORCE while moving", () => {
    const player = playerAtSpeed(60);
    step(player, 1, controls({ brake: true }));
    assert.ok(
      Math.abs(player.longitudinalAccel + BRAKE_FORCE) < 1e-6,
      `expected longAccel ~ -${BRAKE_FORCE}, got ${player.longitudinalAccel}`
    );
  });

  it("handbrake decelerates harder than the regular brake", () => {
    const brakingPlayer = playerAtSpeed(60);
    step(brakingPlayer, 1, controls({ brake: true }));
    const handbrakingPlayer = playerAtSpeed(60);
    step(handbrakingPlayer, 1, controls({ handbrake: true }));
    assert.ok(
      Math.abs(handbrakingPlayer.longitudinalAccel) > Math.abs(brakingPlayer.longitudinalAccel),
      "handbrake should decelerate harder than the regular brake"
    );
    assert.ok(Math.abs(handbrakingPlayer.longitudinalAccel + HANDBRAKE_FORCE) < 1e-6);
  });

  it("handbrake stops at zero and never reverses", () => {
    const player = playerAtSpeed(20);
    // Enough steps to fully stop and then some, holding handbrake throughout.
    step(player, 400, controls({ handbrake: true }));
    assert.equal(player.speed, 0, "handbrake should stop exactly at zero, never past it");
  });

  it("coasting (no input) decelerates at FRICTION plus RPM-scaled engine braking", () => {
    const player = playerAtSpeed(60);
    const gearBefore = player.gear;
    const speedBefore = player.speed;
    step(player, 1, controls({}));
    const rpm = rpmForGear(gearBefore, speedBefore);
    const engineBrakingFraction = Math.max(0, Math.min(1, (rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM)));
    const expected = FRICTION + ENGINE_BRAKING * engineBrakingFraction;
    assert.ok(
      Math.abs(player.longitudinalAccel + expected) < 1e-6,
      `expected longAccel ~ -${expected}, got ${player.longitudinalAccel}`
    );
  });

  it("a lower gear coasts to a stronger deceleration at the same road speed (engine braking)", () => {
    const speed = 30 * MPH;

    const highGear = new Player();
    highGear.gear = 5;
    highGear.speed = speed;
    step(highGear, 1, controls({}));

    const lowGear = new Player();
    lowGear.gear = 2;
    lowGear.speed = speed;
    step(lowGear, 1, controls({}));

    assert.ok(
      Math.abs(lowGear.longitudinalAccel) > Math.abs(highGear.longitudinalAccel),
      `expected 2nd gear to decelerate harder than 5th at the same speed: got ${lowGear.longitudinalAccel} vs ${highGear.longitudinalAccel}`
    );
  });
});
