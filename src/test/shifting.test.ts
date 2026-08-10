import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Player } from "../entities/player.js";
import { transmissionSettings } from "../util/transmissionSettings.js";
import { DEFAULT_CAR } from "../util/cars/index.js";
import { PHYSICS_DT, controls, step, playerAtSpeed } from "./helpers.js";

// transmissionSettings is shared, mutable module state (see util/transmissionSettings.ts) —
// reset it after every test in this file so mode changes don't leak between tests.
afterEach(() => {
  transmissionSettings.mode = "automatic";
});

describe("automatic transmission", () => {
  it("shifts up through the gears in order under sustained full throttle, never skipping or reversing", () => {
    transmissionSettings.mode = "automatic";
    const player = new Player();
    const gearsSeen: number[] = [player.gear];
    for (let i = 0; i < 30000; i++) {
      player.update(PHYSICS_DT, controls({ throttle: true }));
      if (player.gear !== gearsSeen[gearsSeen.length - 1]) gearsSeen.push(player.gear);
    }
    for (let i = 1; i < gearsSeen.length; i++) {
      assert.equal(gearsSeen[i], gearsSeen[i - 1] + 1, `gear sequence should climb by exactly 1: ${gearsSeen}`);
    }
    assert.equal(gearsSeen[gearsSeen.length - 1], 5, "should end in 5th gear");
  });

  it("never selects neutral or a gear outside 1-5 while driving forward", () => {
    transmissionSettings.mode = "automatic";
    const player = new Player();
    for (let i = 0; i < 30000; i++) {
      player.update(PHYSICS_DT, controls({ throttle: true }));
      assert.ok(player.gear >= 1 && player.gear <= 5, `gear ${player.gear} out of range`);
    }
  });

  it("never exceeds redline RPM while braking down through the gears (automaticMaxDownshiftRpm safety valve)", () => {
    const player = playerAtSpeed(80); // playerAtSpeed forces automatic mode
    for (let i = 0; i < 6000 && player.speed > 0; i++) {
      player.update(PHYSICS_DT, controls({ brake: true }));
      assert.ok(
        player.rpm <= DEFAULT_CAR.redlineRpm + 1e-6,
        `automatic transmission should never exceed redlineRpm, got ${player.rpm} in gear ${player.gear}`
      );
    }
  });
});

describe("manual transmission", () => {
  it("shifts one gear per cooldown window, R -> N -> 1 -> ... -> 5 when held", () => {
    transmissionSettings.mode = "manual";
    const player = new Player();
    assert.equal(player.gear, 1);

    // Player.update isn't itself edge-triggered on shiftDown/shiftUp (that happens
    // upstream, at the Input -> ControlState layer) — holding the control here
    // cascades one gear per MANUAL_SHIFT_COOLDOWN_MS window, which is exactly what
    // rate-limits a real held key to one shift per press in the full input pipeline.
    step(player, 40, controls({ shiftDown: true })); // enough for 2 cooldown windows: 1 -> N -> R
    assert.equal(player.gearLabel, "R");

    step(player, 400, controls({ shiftUp: true })); // enough for 6: R -> N -> 1 -> 2 -> 3 -> 4 -> 5
    assert.equal(player.gearLabel, "5");
  });

  it("upshift triggers the torque-cut window, which fully clears after DEFAULT_CAR.shiftTorqueCutMs", () => {
    transmissionSettings.mode = "manual";
    const player = new Player();
    step(player, 1, controls({ shiftUp: true })); // 1 -> 2
    assert.equal(player.gear, 2);
    assert.ok(player.shiftTorqueCutActive, "torque cut should be active immediately after an upshift");
    assert.ok(player.shiftTorqueCutRemainingMs > 0 && player.shiftTorqueCutRemainingMs <= DEFAULT_CAR.shiftTorqueCutMs);

    const stepsToClear = Math.ceil(DEFAULT_CAR.shiftTorqueCutMs / 1000 / PHYSICS_DT) + 2;
    step(player, stepsToClear, controls({}));
    assert.equal(player.shiftTorqueCutActive, false, "torque cut should have cleared by now");
    assert.equal(player.shiftTorqueCutRemainingMs, 0);
  });

  it("an aggressive downshift can briefly scream past the limiter, then settles back within it", () => {
    transmissionSettings.mode = "manual";
    const player = new Player();
    player.gear = 5;
    player.speed = 46; // ~103mph -- 4th gear's implied RPM here exceeds even limiterRpm

    step(player, 1, controls({ shiftDown: true })); // 5 -> 4
    assert.equal(player.gear, 4);
    assert.ok(
      player.rpm > DEFAULT_CAR.limiterRpm,
      `expected the post-downshift scream to exceed limiterRpm (${DEFAULT_CAR.limiterRpm}), got ${player.rpm}`
    );
    assert.ok(player.rpm <= DEFAULT_CAR.maxTransmissionRpm + 1e-6, "should still be capped at maxTransmissionRpm");

    // Coast through the settle window (downshiftSettleMs) plus margin.
    const settleSteps = Math.ceil(DEFAULT_CAR.downshiftSettleMs / 1000 / PHYSICS_DT) + 5;
    step(player, settleSteps, controls({}));

    // From here on, the scream window has closed -- RPM should never exceed
    // the ordinary limiter bounce ceiling again (redlineRpm/limiterRpm),
    // even though it may still be pinned at the top of that bounce.
    for (let i = 0; i < 60; i++) {
      player.update(PHYSICS_DT, controls({}));
      assert.ok(
        player.rpm <= DEFAULT_CAR.limiterRpm + 1e-6,
        `after the settle window, rpm should never exceed limiterRpm again, got ${player.rpm}`
      );
    }
  });
});
