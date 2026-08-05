import type { Vec3 } from "../math/vector3.js";
import type { TrackQuery } from "../world/trackQuery.js";

/** Live lap-progress state, read by the HUD/telemetry each frame. */
export interface LapState {
  lapCount: number; // fully completed laps
  currentLapTime: number; // seconds since the current lap started
  bestLapTime: number | null; // seconds; null until a lap has completed
  lastLapTime: number | null; // seconds; null until a lap has completed
  progress: number; // 0..1 fraction of the lap loop completed, for a future progress bar/minimap
}

/**
 * Tracks lap completion and timing by watching arc-length progress along one
 * loop of the track (the one the spawn point sits on), via TrackQuery — no
 * separate geometry or "am I near the line" heuristic of its own.
 *
 * Only progress on `loopIndex` counts: a figure-eight's second loop is a
 * different physical path, not a lap of this one, so time spent there simply
 * doesn't advance progress (existing lap timer keeps running; no reset, no
 * heuristic re-routing).
 *
 * Only forward crossings of the start/finish line complete a lap. Detected as
 * arcLength dropping by more than half the loop's length in a single step —
 * ordinary driving (forward or reverse) never moves arcLength anywhere near
 * that much in one step, so this only fires on an actual seam crossing, and
 * only in the forward direction (a backward crossing jumps arcLength UP by
 * about the loop length, which this check doesn't treat as a completion).
 */
export class LapTracker {
  private lapCount = 0;
  private currentLapTime = 0;
  private bestLapTime: number | null = null;
  private lastLapTime: number | null = null;
  private prevArcLength = 0;
  private readonly loopLength: number;

  constructor(private readonly trackQuery: TrackQuery, private readonly loopIndex = 0) {
    this.loopLength = trackQuery.loopLength(loopIndex);
  }

  /** Advances lap timing/progress by `dt` seconds at `position`. Call once per physics step. */
  update(dt: number, position: Vec3): void {
    this.currentLapTime += dt;

    const sample = this.trackQuery.nearestPoint(position);
    if (sample.loopIndex !== this.loopIndex) return;

    if (sample.arcLength < this.prevArcLength - this.loopLength / 2) {
      this.lapCount++;
      this.lastLapTime = this.currentLapTime;
      if (this.bestLapTime === null || this.currentLapTime < this.bestLapTime) {
        this.bestLapTime = this.currentLapTime;
      }
      this.currentLapTime = 0;
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
  }

  get state(): LapState {
    return {
      lapCount: this.lapCount,
      currentLapTime: this.currentLapTime,
      bestLapTime: this.bestLapTime,
      lastLapTime: this.lastLapTime,
      progress: Math.max(0, Math.min(1, this.prevArcLength / this.loopLength)),
    };
  }
}
