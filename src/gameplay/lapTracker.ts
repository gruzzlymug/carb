import type { Vec3 } from "../math/vector3.js";
import type { TrackQuery } from "../world/trackQuery.js";
import { TrackFollower } from "../world/trackFollower.js";

/** Number of sectors the lap is split into — SECTOR_COUNT - 1 intermediate checkpoints, plus the finish line. */
const DEFAULT_SECTOR_COUNT = 3;

/** Live lap-progress state, read by the HUD/telemetry each frame. */
export interface LapState {
  lapCount: number; // fully completed laps
  currentLapTime: number; // seconds since the current lap started
  bestLapTime: number | null; // seconds; null until a lap has completed
  lastLapTime: number | null; // seconds; null until a lap has completed
  progress: number; // 0..1 fraction of the lap loop completed, for a future progress bar/minimap
  /** This lap's checkpoint split times so far (seconds since lap start), null = not yet reached. */
  splits: ReadonlyArray<number | null>;
}

/**
 * Tracks lap completion, timing, and intermediate checkpoint splits by
 * watching arc-length progress along one loop of the track (the one the
 * spawn point sits on), via an internal TrackFollower — no separate
 * geometry or "am I near the line/checkpoint" heuristic of its own.
 *
 * Only progress on `loopIndex` counts. Every track today is a single loop
 * (loopIndex 0), so this is currently always satisfied — it exists for a
 * future multi-loop track, where time spent off the tracked loop simply
 * wouldn't advance progress (existing lap timer keeps running; no reset, no
 * heuristic re-routing).
 *
 * Only forward crossings of the start/finish line complete a lap. Detected as
 * arcLength dropping by more than half the loop's length in a single step —
 * ordinary driving (forward or reverse) never moves arcLength anywhere near
 * that much in one step, so this only fires on an actual seam crossing, and
 * only in the forward direction (a backward crossing jumps arcLength UP by
 * about the loop length, which this check doesn't treat as a completion).
 *
 * Checkpoints are evenly-spaced arc-length thresholds between the start and
 * the finish line (`sectorCount - 1` of them), crossed the same way: forward
 * progress past a threshold records a split, once per lap. This pass is
 * informational splits only — it does not gate lap validity on having hit
 * every checkpoint (e.g. a reversed or short-cut lap still completes); that
 * would be a natural follow-up, not built here.
 */
export class LapTracker {
  private lapCount = 0;
  private currentLapTime = 0;
  private bestLapTime: number | null = null;
  private lastLapTime: number | null = null;
  private prevArcLength = 0;
  private readonly loopLength: number;
  private readonly checkpointArcLengths: number[];
  private readonly follower: TrackFollower;
  private splits: (number | null)[];

  constructor(
    trackQuery: TrackQuery,
    private readonly loopIndex = 0,
    sectorCount = DEFAULT_SECTOR_COUNT
  ) {
    this.loopLength = trackQuery.loopLength(loopIndex);
    this.checkpointArcLengths = Array.from(
      { length: Math.max(0, sectorCount - 1) },
      (_, i) => ((i + 1) / sectorCount) * this.loopLength
    );
    this.follower = new TrackFollower(trackQuery);
    this.splits = this.checkpointArcLengths.map(() => null);
  }

  /** Advances lap timing/progress by `dt` seconds at `position`. Call once per physics step. */
  update(dt: number, position: Vec3): void {
    this.currentLapTime += dt;

    const sample = this.follower.locate(position);
    if (sample.loopIndex !== this.loopIndex) return;

    // Checkpoints first, so a threshold sitting right at the finish line still
    // gets its split recorded before the wrap check below resets everything
    // for the new lap.
    for (let i = 0; i < this.checkpointArcLengths.length; i++) {
      if (this.splits[i] !== null) continue;
      const threshold = this.checkpointArcLengths[i];
      if (this.prevArcLength < threshold && sample.arcLength >= threshold) {
        this.splits[i] = this.currentLapTime;
      }
    }

    if (sample.arcLength < this.prevArcLength - this.loopLength / 2) {
      this.lapCount++;
      this.lastLapTime = this.currentLapTime;
      if (this.bestLapTime === null || this.currentLapTime < this.bestLapTime) {
        this.bestLapTime = this.currentLapTime;
      }
      this.currentLapTime = 0;
      this.splits = this.checkpointArcLengths.map(() => null);
    }
    this.prevArcLength = sample.arcLength;
  }

  /** Resets all lap state — e.g. on respawn or track change. */
  reset(): void {
    this.lapCount = 0;
    this.currentLapTime = 0;
    this.bestLapTime = null;
    this.lastLapTime = null;
    this.prevArcLength = 0;
    this.splits = this.checkpointArcLengths.map(() => null);
  }

  get state(): LapState {
    return {
      lapCount: this.lapCount,
      currentLapTime: this.currentLapTime,
      bestLapTime: this.bestLapTime,
      lastLapTime: this.lastLapTime,
      progress: Math.max(0, Math.min(1, this.prevArcLength / this.loopLength)),
      splits: this.splits,
    };
  }
}
