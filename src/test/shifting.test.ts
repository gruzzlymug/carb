import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Player } from "../entities/player.js";
import { transmissionSettings } from "../util/transmissionSettings.js";
import { DEFAULT_CAR } from "../util/cars/index.js";
import { PHYSICS_DT, controls, step } from "./helpers.js";

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
});
