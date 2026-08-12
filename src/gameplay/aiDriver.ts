import { angleDelta, perpendicular } from "../math/vector3.js";
import type { Vec3 } from "../math/vector3.js";
import type { ControlState } from "../engine/controlState.js";
import type { TrackQuery, TrackSurfaceSample } from "../world/trackQuery.js";
import type { Player } from "../entities/player.js";
import type { RacingLine } from "../world/racingLine.js";
import { racingLineIndexAt } from "../world/racingLine.js";
import type { SpeedProfile } from "../world/speedProfile.js";
import { maxCornerSpeed } from "../util/vehicleDynamics.js";
import type { SteeringController, VehiclePose } from "./steeringController.js";

const STEER_LOOKAHEAD_METERS = 15; // short, fixed — just "which way does the road go next" (bang-bang mode only)
const STEER_DEADZONE_RAD = 0.03; // avoid twitchy left/right flapping when nearly aligned (bang-bang mode only)
const SPEED_MARGIN = 0.9; // brake a bit before the theoretical grip limit, not right at it
const BRAKE_HYSTERESIS = 1.05; // don't brake until meaningfully over target, avoids flapping

export interface RacingLineErrorSample {
  currentIndex: number;
  lookaheadIndex: number;
  /** Signed distance (meters) from `position` to the line's local tangent at currentIndex, positive = left (perpendicular()'s convention). */
  lateralError: number;
  /**
   * Signed angle (radians) from `heading` to the heading of steerTarget
   * (the lookahead point), positive = left. Used by bang-bang steering
   * (unchanged since Step 5) — NOT used by the continuous controller (see
   * headingErrorToLine): this is anchored to a point 15m ahead, a
   * different reference than lateralError's (currentIndex), so summing
   * them as independent linear terms isn't well-posed — confirmed by an
   * early Step 6 attempt where the two terms fought and roughly canceled.
   */
  headingError: number;
  /**
   * Signed angle (radians) from `heading` to the racing line's own tangent
   * AT currentIndex — the same reference point lateralError uses, so the
   * two combine consistently (this is the standard "local heading + cross-
   * track error" pairing, e.g. what Stanley-style controllers use). This
   * is what the continuous controller (steeringController.ts) reads.
   */
  headingErrorToLine: number;
}

/**
 * Local lateral/heading error against the racing line at a car's actual
 * position — the SAME computation AiDriver's steering (both bang-bang and
 * continuous) uses internally, exported so diagnostics/tests measure the
 * real controller-relevant error (signed, at the correct centerlineS) and
 * not a different proxy like nearest-sample Euclidean distance, which
 * conflates lateral and longitudinal offset.
 */
export function racingLineErrorAt(
  position: Vec3,
  heading: number,
  here: TrackSurfaceSample,
  racingLine: RacingLine
): RacingLineErrorSample {
  const currentIndex = racingLineIndexAt(racingLine, here.arcLength);
  const lookaheadIndex = racingLineIndexAt(racingLine, here.arcLength + STEER_LOOKAHEAD_METERS);

  const currentPoint = racingLine.points[currentIndex];
  const steerTarget = racingLine.points[lookaheadIndex];

  const perp = perpendicular(currentPoint.tangent);
  const dx = position.x - currentPoint.position.x;
  const dy = position.y - currentPoint.position.y;
  const lateralError = dx * perp.x + dy * perp.y;

  const desiredHeading = Math.atan2(steerTarget.position.x - position.x, steerTarget.position.y - position.y);
  const headingError = angleDelta(heading, desiredHeading);

  const lineHeading = Math.atan2(currentPoint.tangent.x, currentPoint.tangent.y);
  const headingErrorToLine = angleDelta(heading, lineHeading);

  return { currentIndex, lookaheadIndex, lateralError, headingError, headingErrorToLine };
}

/**
 * Autopilot for the existing Player — produces one ControlState per physics
 * step from a precomputed RacingLine/SpeedProfile (see world/racingLine.ts,
 * world/speedProfile.ts) and the car's own state, the same contract the
 * keyboard Input pipeline produces via readControlState (see
 * engine/controlState.ts). Swappable at that exact seam: Game picks either
 * this or readControlState(input) each step — not a parallel path.
 *
 * Steering has two modes, selected by whether a SteeringController is
 * passed to the constructor:
 *  - No controller (default): the original boolean bang-bang
 *    (steerLeft/steerRight past a deadzone), unchanged since Step 5. This
 *    is the reference baseline (~1m max lateral error, 0% off-road on
 *    both tracks) any continuous controller needs to match or beat.
 *  - With a controller: continuous steerAxis via ControlState.steerAxis.
 *    AiDriver hands the controller the car's pose, the RacingLine itself,
 *    and the car's current centerlineS — NOT precomputed scalar errors —
 *    so each controller can implement its own lookahead/anticipation
 *    strategy without AiDriver growing more lookahead logic per
 *    controller. See steeringController.ts for the interface and the two
 *    implementations tried so far (ProportionalSteeringController, purely
 *    reactive — overshoots badly at corners since it never anticipates
 *    them; PurePursuitSteeringController, which fixes that by aiming at a
 *    speed-scaled lookahead point instead).
 * Kept as a constructor switch specifically so different steering modes
 * can be run side-by-side through identical test/diagnostic harnesses as
 * clean controller-only comparisons — nothing about the line, speed
 * profile, throttle/brake, or bang-bang's own lookahead differs between
 * modes.
 *
 * RacingLine/SpeedProfile only cover loopIndex 0 (see racingLine.ts's
 * scope note); if the car is ever found on a different loop (e.g. the
 * figure-eight's second loop), falls back to a minimal "aim along the
 * current tangent, corner-speed-limit from curvature alone" heuristic,
 * always bang-bang — not addressed by the racing-line work, same
 * limitation noted there.
 */
export class AiDriver {
  constructor(private readonly steeringController?: SteeringController) {}

  computeControls(player: Player, trackQuery: TrackQuery, racingLine: RacingLine, speedProfile: SpeedProfile): ControlState {
    const here = trackQuery.nearestPoint(player.position);

    if (here.loopIndex !== racingLine.loopIndex) {
      return this.fallbackControls(player, here);
    }

    let steerLeft = false;
    let steerRight = false;
    let steerAxis: number | undefined;
    if (this.steeringController) {
      const pose: VehiclePose = { position: player.position, heading: player.heading, speed: player.speed, car: player.car };
      steerAxis = this.steeringController.computeSteerAxis(pose, racingLine, here.arcLength);
    } else {
      const { headingError } = racingLineErrorAt(player.position, player.heading, here, racingLine);
      steerLeft = headingError > STEER_DEADZONE_RAD;
      steerRight = headingError < -STEER_DEADZONE_RAD;
    }

    const currentIndex = racingLineIndexAt(racingLine, here.arcLength);

    const targetSpeed = speedProfile.points[currentIndex].targetSpeed * SPEED_MARGIN;
    const throttle = player.speed < targetSpeed;
    const brake = player.speed > targetSpeed * BRAKE_HYSTERESIS;

    return { throttle, brake, steerLeft, steerRight, steerAxis, handbrake: false, shiftUp: false, shiftDown: false };
  }

  /** Minimal degraded behavior off the racing line's loop — see class doc comment. Always bang-bang, regardless of steeringController. */
  private fallbackControls(player: Player, here: TrackSurfaceSample): ControlState {
    const desiredHeading = Math.atan2(here.tangent.x, here.tangent.y);
    const headingError = angleDelta(player.heading, desiredHeading);
    const steerLeft = headingError > STEER_DEADZONE_RAD;
    const steerRight = headingError < -STEER_DEADZONE_RAD;

    const targetSpeed = maxCornerSpeed(here.curvature, player.car) * SPEED_MARGIN;
    const throttle = player.speed < targetSpeed;
    const brake = player.speed > targetSpeed * BRAKE_HYSTERESIS;

    return { throttle, brake, steerLeft, steerRight, handbrake: false, shiftUp: false, shiftDown: false };
  }
}
