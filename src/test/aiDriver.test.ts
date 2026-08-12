import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Player } from "../entities/player.js";
import { buildTrackWorld } from "../world/trackWorld.js";
import type { TrackWorld } from "../world/trackWorld.js";
import { classifySurface } from "../world/surfaceState.js";
import { transmissionSettings } from "../util/transmissionSettings.js";
import { AiDriver, racingLineErrorAt } from "../gameplay/aiDriver.js";
import { ProportionalSteeringController, PurePursuitSteeringController } from "../gameplay/steeringController.js";
import type { SteeringController } from "../gameplay/steeringController.js";
import { LapTracker } from "../gameplay/lapTracker.js";
import { PHYSICS_DT } from "./helpers.js";

// AiDriver never shifts gears itself — it assumes automatic mode (see its own
// doc comment). Force it regardless of the app's own default, since these
// tests exist to validate the AI's driving logic, not that limitation.
transmissionSettings.mode = "automatic";

const MAX_STEPS = 120 * 60 * 3; // 3 minutes of simulated time — generous for a ~1km lap

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index];
}

/**
 * Drives `player` with `ai` for up to `maxSteps`, tracking laps, off-road
 * time, speed range, and lateral line error. Line error uses
 * racingLineErrorAt() — the same signed lateral error (against the racing
 * line's local tangent at the car's actual centerlineS) the controller
 * itself acts on, not a nearest-sample Euclidean distance: a car can sit
 * close to the line geometrically while being ahead/behind it
 * longitudinally, which a Euclidean nearest-point search doesn't
 * distinguish from an actual lateral deviation.
 */
function driveWithAi(ai: AiDriver, player: Player, world: TrackWorld, maxSteps: number) {
  const lapTracker = new LapTracker(world.query);
  let offRoadSteps = 0;
  let stalledSteps = 0;
  let minSpeed = Infinity;
  let maxSpeed = -Infinity;
  const lateralErrors: number[] = [];

  for (let i = 0; i < maxSteps; i++) {
    const controls = ai.computeControls(player, world.query, world.racingLine, world.speedProfile);
    const surfaceSample = world.query.nearestPoint(player.position);
    const surface = classifySurface(surfaceSample.distance);
    player.update(PHYSICS_DT, controls, surface);
    lapTracker.update(PHYSICS_DT, player.position);

    if (!surfaceSample.onRoad) offRoadSteps++;
    if (Math.abs(player.speed) < 0.5) stalledSteps++;
    minSpeed = Math.min(minSpeed, player.speed);
    maxSpeed = Math.max(maxSpeed, player.speed);
    if (surfaceSample.loopIndex === world.racingLine.loopIndex) {
      const { lateralError } = racingLineErrorAt(player.position, player.heading, surfaceSample, world.racingLine);
      lateralErrors.push(Math.abs(lateralError));
    }

    if (lapTracker.state.lapCount >= 1) {
      lateralErrors.sort((a, b) => a - b);
      return {
        steps: i + 1,
        offRoadSteps,
        stalledSteps,
        lapTime: lapTracker.state.lastLapTime,
        minSpeed,
        maxSpeed,
        meanLineError: lateralErrors.reduce((sum, e) => sum + e, 0) / lateralErrors.length,
        p95LineError: percentile(lateralErrors, 0.95),
        maxLineError: lateralErrors[lateralErrors.length - 1],
      };
    }
  }

  return {
    steps: maxSteps,
    offRoadSteps,
    stalledSteps,
    lapTime: null as number | null,
    minSpeed,
    maxSpeed,
    meanLineError: NaN,
    p95LineError: NaN,
    maxLineError: NaN,
  };
}

function logDiagnostics(label: string, result: ReturnType<typeof driveWithAi>): void {
  console.log(`${label}:`, {
    lapTime: result.lapTime?.toFixed(2),
    minSpeedKmh: (result.minSpeed * 3.6).toFixed(1),
    maxSpeedKmh: (result.maxSpeed * 3.6).toFixed(1),
    meanLineErrorM: result.meanLineError.toFixed(2),
    p95LineErrorM: result.p95LineError.toFixed(2),
    maxLineErrorM: result.maxLineError.toFixed(2),
    offRoadPct: ((result.offRoadSteps / result.steps) * 100).toFixed(1),
  });
}

// Figure-eight dropped from this comparison: the racing line only covers
// loop 0 (see racingLine.ts's scope note), so it's not a meaningful AI
// test right now — pending a track rework.
const TRACKS: ReadonlyArray<{ key: string; label: string }> = [{ key: "roundedRectangle", label: "Circuit" }];

describe("AiDriver — bang-bang steering (Step 5 baseline)", () => {
  for (const { key, label } of TRACKS) {
    it(`completes at least one lap of ${label}, mostly on-road, without stalling`, () => {
      const world = buildTrackWorld(key);
      const player = new Player();
      player.respawn(world.spawn.position, world.spawn.headingRad);
      const result = driveWithAi(new AiDriver(), player, world, MAX_STEPS);
      logDiagnostics(`${label} — bang-bang`, result);

      assert.ok(result.lapTime !== null, `AI never completed a lap within ${MAX_STEPS} steps`);
      const offRoadFraction = result.offRoadSteps / result.steps;
      assert.ok(offRoadFraction < 0.05, `AI spent ${(offRoadFraction * 100).toFixed(1)}% of the lap off-road`);
      const stalledFraction = result.stalledSteps / result.steps;
      assert.ok(stalledFraction < 0.05, `AI was stalled (<0.5 m/s) for ${(stalledFraction * 100).toFixed(1)}% of the lap`);
    });
  }
});

// Step 6 (reactive-only) and Step 6b (anticipating) continuous controllers,
// run through the identical harness above for a clean, controller-only
// comparison against the bang-bang baseline. Neither asserts off-road%/
// stall% yet -- ProportionalSteeringController is known (and expected) to
// run wide on corners since it has no anticipation; PurePursuitSteeringController
// is the untuned first attempt at fixing that. The concrete bar (approx.
// match bang-bang lap time, materially lower line error, 0% off-road) is
// something to read off the logged diagnostics and decide about, not
// something baked into a threshold here.
const CONTINUOUS_CONTROLLERS: ReadonlyArray<{ label: string; make: () => SteeringController }> = [
  { label: "proportional (reactive only)", make: () => new ProportionalSteeringController() },
  { label: "pure pursuit (speed-scaled lookahead)", make: () => new PurePursuitSteeringController() },
];

describe("AiDriver — continuous steering (Step 6 / 6b comparison)", () => {
  for (const { label: controllerLabel, make } of CONTINUOUS_CONTROLLERS) {
    for (const { key, label } of TRACKS) {
      // Diagnostic only, no pass/fail assertion: both controllers are
      // known, mid-experiment, to fail at the first corner right now
      // (documented in the Step 6b findings) -- this test exists to keep
      // the comparison numbers visible/regenerable, not to gate on a bar
      // neither controller is expected to clear yet.
      it(`${controllerLabel} on ${label} (diagnostic, not a pass/fail bar)`, () => {
        const world = buildTrackWorld(key);
        const player = new Player();
        player.respawn(world.spawn.position, world.spawn.headingRad);
        const result = driveWithAi(new AiDriver(make()), player, world, MAX_STEPS);
        logDiagnostics(`${label} — ${controllerLabel}`, result);
      });
    }
  }
});
