import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BRAKE_FORCE, HANDBRAKE_FORCE, FRICTION } from "../util/constants.js";
import { playerAtSpeed, step, controls } from "./helpers.js";

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

  it("coasting (no input) decelerates at exactly FRICTION", () => {
    const player = playerAtSpeed(60);
    step(player, 1, controls({}));
    assert.ok(
      Math.abs(player.longitudinalAccel + FRICTION) < 1e-6,
      `expected longAccel ~ -${FRICTION}, got ${player.longitudinalAccel}`
    );
  });
});
