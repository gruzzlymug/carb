import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Player } from "../entities/player.js";
import { buildTrackWorld } from "../world/trackWorld.js";
import type { TrackQuery } from "../world/trackQuery.js";
import { classifySurface } from "../world/surfaceState.js";
import { AiDriver } from "../gameplay/aiDriver.js";
import { LapTracker } from "../gameplay/lapTracker.js";
import { PHYSICS_DT } from "./helpers.js";

const MAX_STEPS = 120 * 60 * 3; // 3 minutes of simulated time — generous for a ~1km lap

/** Drives `player` with the AI for up to `maxSteps`, tracking laps and off-road time. */
function driveWithAi(player: Player, trackQuery: TrackQuery, maxSteps: number) {
  const ai = new AiDriver();
  const lapTracker = new LapTracker(trackQuery);
  let offRoadSteps = 0;
  let stalledSteps = 0;

  for (let i = 0; i < maxSteps; i++) {
    const controls = ai.computeControls(player, trackQuery);
    const surfaceSample = trackQuery.nearestPoint(player.position);
    const surface = classifySurface(surfaceSample.distance);
    player.update(PHYSICS_DT, controls, surface);
    lapTracker.update(PHYSICS_DT, player.position);

    if (!surfaceSample.onRoad) offRoadSteps++;
    if (Math.abs(player.speed) < 0.5) stalledSteps++;

    if (lapTracker.state.lapCount >= 1) {
      return { steps: i + 1, offRoadSteps, stalledSteps, lapTime: lapTracker.state.lastLapTime };
    }
  }

  return { steps: maxSteps, offRoadSteps, stalledSteps, lapTime: null };
}

describe("AiDriver — completes a full lap of the redesigned tracks", () => {
  it("completes at least one lap of the Circuit, mostly on-road, without stalling", () => {
    const world = buildTrackWorld("roundedRectangle");
    const player = new Player();
    player.respawn(world.spawn.position, world.spawn.headingRad);
    const result = driveWithAi(player, world.query, MAX_STEPS);

    assert.ok(result.lapTime !== null, `AI never completed a lap within ${MAX_STEPS} steps`);
    const offRoadFraction = result.offRoadSteps / result.steps;
    assert.ok(offRoadFraction < 0.05, `AI spent ${(offRoadFraction * 100).toFixed(1)}% of the lap off-road`);
    const stalledFraction = result.stalledSteps / result.steps;
    assert.ok(stalledFraction < 0.05, `AI was stalled (<0.5 m/s) for ${(stalledFraction * 100).toFixed(1)}% of the lap`);
  });

  it("completes at least one lap of the figure-eight's loop 0 (fast sweeper)", () => {
    const world = buildTrackWorld("figureEight");
    const player = new Player();
    player.respawn(world.spawn.position, world.spawn.headingRad);
    const result = driveWithAi(player, world.query, MAX_STEPS);

    assert.ok(result.lapTime !== null, `AI never completed a lap within ${MAX_STEPS} steps`);
    const offRoadFraction = result.offRoadSteps / result.steps;
    assert.ok(offRoadFraction < 0.05, `AI spent ${(offRoadFraction * 100).toFixed(1)}% of the lap off-road`);
  });
});
