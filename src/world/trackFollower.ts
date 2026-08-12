import type { Vec3 } from "../math/vector3.js";
import type { TrackQuery, TrackSurfaceSample } from "./trackQuery.js";

// Comfortably bigger than a physics-step's worth of movement or the
// steering controllers' own lookahead (MAX_LOOKAHEAD_M = 40 in
// steeringController.ts); if locate() lands further than this from the
// window it searched, the window itself can't be trusted — see locate()'s
// doc comment.
const JUMP_DISTANCE_METERS = 50;

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * An explicit cursor tracking one continuously-moving thing's position
 * along the track's spline — car, AI, lap progress — instead of every
 * caller re-deriving "where am I" from scratch each step via a raw
 * nearest-Euclidean-point search. That matters once a track loops close to
 * a different, arc-length-distant part of itself (e.g. the figure-eight's
 * pinch point): a plain nearest-point search can't tell "the same place I
 * was a moment ago" from "some other place that happens to sit nearby in
 * space," but a follower that remembers where it was can.
 *
 * Two operations, both explicit — no implicit "hint looks stale, silently
 * do something different" branching hidden inside a single do-everything
 * method:
 *  - locate(): the normal per-step call. Assumes continuous motion since
 *    the last locate()/attach() and searches only that vicinity, with one
 *    safety net (see below).
 *  - attach(): a deliberate reset for a KNOWN discontinuous jump (spawn,
 *    respawn, a track change) — always a full-track search, no window.
 *
 * locate()'s one safety net: if the windowed search's own result still
 * ends up implausibly far from the queried position, the window it searched
 * evidently didn't contain the right answer (the caller's position jumped
 * further than one step should — e.g. a dropped frame, or a bug upstream),
 * so it falls back to a full scan rather than confidently returning a bad
 * match. This is different from "hint distance-based fallback" living
 * inside the query itself: it's TrackFollower's own recovery policy, in
 * one place, and callers that KNOW they're jumping should still call
 * attach() rather than lean on it.
 */
export class TrackFollower {
  private location: TrackSurfaceSample | null = null;

  constructor(private readonly query: TrackQuery) {}

  /** The most recently resolved location, or null before the first locate()/attach(). */
  get current(): TrackSurfaceSample | null {
    return this.location;
  }

  /** Resolves `position` against the track, searching only the vicinity of the current location (or a full scan, on the first call). */
  locate(position: Vec3): TrackSurfaceSample {
    const hint = this.location ? { loopIndex: this.location.loopIndex, arcLength: this.location.arcLength } : undefined;
    let result = this.query.nearestPoint(position, hint);
    if (hint && distance(position, result.point) > JUMP_DISTANCE_METERS) {
      result = this.query.nearestPoint(position); // window couldn't explain this position — recover with a full scan
    }
    this.location = result;
    return result;
  }

  /** Forces a full-track search from `position`, discarding any current location. Use for a known discontinuous jump. */
  attach(position: Vec3): TrackSurfaceSample {
    this.location = null;
    return this.locate(position);
  }
}
