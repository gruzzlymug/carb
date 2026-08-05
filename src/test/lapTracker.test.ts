import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Vec3 } from "../math/vector3.js";
import { createOvalTrack, createFigureEightTrack } from "../world/trackDefinitions.js";
import { sampleTrack } from "../world/trackSpline.js";
import { buildTrackQuery } from "../world/trackQuery.js";
import { LapTracker } from "../gameplay/lapTracker.js";

const DT = 1 / 120;

describe("LapTracker — oval track", () => {
  const sampledLoop = sampleTrack(createOvalTrack()).loops[0];
  const query = buildTrackQuery({ loops: [sampledLoop] });
  const startPoint = sampledLoop.samples[0].center; // arcLength exactly 0
  const nearEndPoint = sampledLoop.samples[sampledLoop.samples.length - 1].center; // arcLength ~= totalLength

  it("starts at lap 0 with no best/last time", () => {
    const tracker = new LapTracker(query);
    assert.equal(tracker.state.lapCount, 0);
    assert.equal(tracker.state.bestLapTime, null);
    assert.equal(tracker.state.lastLapTime, null);
  });

  it("counts a completed lap when arc length wraps forward past the finish line", () => {
    const tracker = new LapTracker(query);
    tracker.update(DT, startPoint); // arcLength = 0
    tracker.update(1.0, nearEndPoint); // arcLength ~= totalLength (near the seam from the other side)
    tracker.update(DT, startPoint); // crosses forward past the seam, back to arcLength = 0
    assert.equal(tracker.state.lapCount, 1, "expected exactly one lap to complete on the forward crossing");
  });

  it("records lastLapTime and bestLapTime on completion, and resets currentLapTime", () => {
    const tracker = new LapTracker(query);
    tracker.update(0.001, startPoint);
    tracker.update(10, nearEndPoint); // 10s "into" the lap
    tracker.update(DT, startPoint); // cross forward -> lap completes
    const lap = tracker.state;
    assert.equal(lap.lapCount, 1);
    assert.ok(lap.lastLapTime !== null && lap.lastLapTime > 9);
    assert.equal(lap.bestLapTime, lap.lastLapTime);
    assert.ok(lap.currentLapTime < 1, "currentLapTime should have reset for the new lap");
  });

  it("a second, slower lap does not overwrite a faster bestLapTime", () => {
    const tracker = new LapTracker(query);
    tracker.update(0.001, startPoint);
    tracker.update(5, nearEndPoint); // fast lap: 5s
    tracker.update(DT, startPoint); // completes lap 1
    tracker.update(20, nearEndPoint); // slow lap: 20s
    tracker.update(DT, startPoint); // completes lap 2
    const lap = tracker.state;
    assert.equal(lap.lapCount, 2);
    assert.ok(lap.lastLapTime !== null && lap.lastLapTime > 19, "lastLapTime should reflect the most recent lap");
    assert.ok(lap.bestLapTime !== null && lap.bestLapTime < 6, "bestLapTime should still be the faster first lap");
  });

  it("reset() clears all lap state back to the start", () => {
    const tracker = new LapTracker(query);
    tracker.update(5, nearEndPoint);
    tracker.update(DT, startPoint); // complete a lap
    assert.equal(tracker.state.lapCount, 1);
    tracker.reset();
    assert.equal(tracker.state.lapCount, 0);
    assert.equal(tracker.state.currentLapTime, 0);
    assert.equal(tracker.state.bestLapTime, null);
    assert.equal(tracker.state.lastLapTime, null);
  });

  it("does not complete a lap from ordinary forward driving in small steps", () => {
    const tracker = new LapTracker(query);
    // Walk forward through the samples in order — consecutive samples are close
    // together (TRACK_SAMPLE_SPACING), so arcLength only ever changes a little
    // per update, never anywhere near half the loop length.
    for (const sample of sampledLoop.samples) {
      tracker.update(DT, sample.center);
    }
    assert.equal(tracker.state.lapCount, 0, "should not complete a lap just from walking forward without crossing the seam");
  });

  it("does not complete a lap on a backward crossing of the seam", () => {
    const tracker = new LapTracker(query);
    tracker.update(DT, startPoint); // arcLength = 0
    tracker.update(DT, nearEndPoint); // jump backward across the seam to arcLength ~= totalLength
    assert.equal(tracker.state.lapCount, 0, "a backward seam crossing should not count as a completed lap");
  });
});

describe("LapTracker — checkpoints/splits (default 3 sectors -> 2 checkpoints)", () => {
  const sampledLoop = sampleTrack(createOvalTrack()).loops[0];
  const query = buildTrackQuery({ loops: [sampledLoop] });
  const startPoint = sampledLoop.samples[0].center;
  const nearEndPoint = sampledLoop.samples[sampledLoop.samples.length - 1].center;
  const totalLength = sampledLoop.totalLength;

  /** First actual sampled point at or past a target arc length — guaranteed to trigger a >= threshold check, unlike "nearest" which can land just short. */
  function sampleAtOrPast(arcLength: number): Vec3 {
    const sample = sampledLoop.samples.find((s) => s.arcLength >= arcLength);
    if (!sample) throw new Error(`no sample at or past arcLength ${arcLength}`);
    return sample.center;
  }

  const checkpoint1Point = sampleAtOrPast(totalLength / 3);
  const checkpoint2Point = sampleAtOrPast((2 * totalLength) / 3);

  it("starts with all splits null", () => {
    const tracker = new LapTracker(query);
    tracker.update(DT, startPoint);
    assert.deepEqual(tracker.state.splits, [null, null]);
  });

  it("records a split when crossing each checkpoint forward, in order", () => {
    const tracker = new LapTracker(query);
    tracker.update(DT, startPoint);
    tracker.update(3, checkpoint1Point);
    const afterFirst = tracker.state.splits;
    assert.ok(afterFirst[0] !== null && afterFirst[0] > 2.9);
    assert.equal(afterFirst[1], null);

    tracker.update(3, checkpoint2Point);
    const afterSecond = tracker.state.splits;
    assert.ok(afterSecond[1] !== null && afterSecond[1] > (afterFirst[0] as number));
  });

  it("does not re-record a split once already reached", () => {
    const tracker = new LapTracker(query);
    tracker.update(DT, startPoint);
    tracker.update(3, checkpoint1Point);
    const first = tracker.state.splits[0];
    tracker.update(1, checkpoint1Point);
    assert.equal(tracker.state.splits[0], first);
  });

  it("resets splits to null when a new lap starts", () => {
    const tracker = new LapTracker(query);
    tracker.update(DT, startPoint);
    tracker.update(3, checkpoint1Point);
    tracker.update(3, checkpoint2Point);
    assert.ok(tracker.state.splits.every((s) => s !== null));
    tracker.update(3, nearEndPoint);
    tracker.update(DT, startPoint); // completes the lap
    assert.deepEqual(tracker.state.splits, [null, null]);
  });
});

describe("LapTracker — figure-eight (progress on the other loop doesn't affect this loop's lap)", () => {
  const query = buildTrackQuery(sampleTrack(createFigureEightTrack()));

  it("ignores position updates on a different loop", () => {
    const tracker = new LapTracker(query, 0);
    const before = tracker.state;
    tracker.update(1, { x: 45, y: 0, z: 0 }); // right circle's center — loop 1, not loop 0
    assert.equal(tracker.state.lapCount, before.lapCount);
    // currentLapTime still advances (the clock doesn't stop), only progress/wrap detection is skipped.
    assert.ok(tracker.state.currentLapTime > 0.9);
  });
});
