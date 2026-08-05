import type { Vec3 } from "../math/vector3.js";
import { angleDelta } from "../math/vector3.js";
import type { ControlState } from "../engine/controlState.js";
import type { TrackQuery } from "../world/trackQuery.js";
import type { Player } from "../entities/player.js";
import { TIRE_GRIP } from "../util/constants.js";

const STEER_LOOKAHEAD_METERS = 15; // short, fixed — just "which way does the road go next"
const STEER_DEADZONE_RAD = 0.03; // avoid twitchy left/right flapping when nearly aligned

// Braking has to look much further ahead than steering: stopping distance grows
// with speed, so a fixed lookahead is nowhere near enough warning at high speed
// (e.g. entering a 38m-radius corner at 96 mph needs >30m of braking zone, not the
// ~15-18m that's plenty for steering). Look `BRAKE_LOOKAHEAD_SECONDS` ahead at the
// car's own speed instead, sampling several points along the way so a tight corner
// just past the lookahead endpoint isn't missed.
const BRAKE_LOOKAHEAD_SECONDS = 2.5;
const BRAKE_LOOKAHEAD_MIN_METERS = 20;
const BRAKE_LOOKAHEAD_SAMPLES = 5;
const SPEED_MARGIN = 0.9; // brake a bit before the theoretical grip limit, not right at it
const BRAKE_HYSTERESIS = 1.05; // don't brake until meaningfully over target, avoids flapping

/**
 * Autopilot for the existing Player — produces one ControlState per physics
 * step from track geometry (via TrackQuery) and the car's own state, the
 * same contract the keyboard Input pipeline produces via readControlState
 * (see engine/controlState.ts). Swappable at that exact seam: Game picks
 * either this or readControlState(input) each step — not a parallel path.
 *
 * Steering and braking each approximate a "point on the track ahead" the
 * same cheap way: TrackQuery only supports "nearest point to a world
 * position," not "point at arc length N" — rather than add that, walk
 * forward from the current nearest track point along its own tangent by
 * some lookahead distance, then re-query nearestPoint() on that projection.
 * It snaps to the real curve near there, standing in for "N meters ahead"
 * well enough at these distances relative to corner radii.
 *
 * Steering uses one short, fixed lookahead (just needs "which way does the
 * road go next"). Braking uses several samples out to a SPEED-SCALED
 * lookahead — sqrt(TIRE_GRIP / curvature) at a single fixed distance isn't
 * enough warning once speed varies a lot (this project's car ranges from a
 * standstill to ~152 mph), so the horizon has to grow with speed the way
 * an actual braking point would. Samples belonging to a different loop
 * (relevant on the figure-eight, where two loops pass close together) are
 * ignored rather than letting a stray cross-loop sample distort the target.
 *
 * Relies on the existing automatic transmission (shiftUp/shiftDown always
 * false) and never uses the handbrake. If transmission mode is set to
 * Manual while this is driving, the car will never shift — known
 * limitation, not worked around here.
 */
export class AiDriver {
  computeControls(player: Player, trackQuery: TrackQuery): ControlState {
    const here = trackQuery.nearestPoint(player.position);

    const steerProjected: Vec3 = {
      x: here.point.x + here.tangent.x * STEER_LOOKAHEAD_METERS,
      y: here.point.y + here.tangent.y * STEER_LOOKAHEAD_METERS,
      z: 0,
    };
    const steerTarget = trackQuery.nearestPoint(steerProjected);

    const desiredHeading = Math.atan2(
      steerTarget.point.x - player.position.x,
      steerTarget.point.y - player.position.y
    );
    const headingError = angleDelta(player.heading, desiredHeading);
    const steerLeft = headingError > STEER_DEADZONE_RAD;
    const steerRight = headingError < -STEER_DEADZONE_RAD;

    const speedLimit = (curvature: number) => Math.sqrt(TIRE_GRIP / Math.max(Math.abs(curvature), 1e-4));
    let minSpeedLimit = speedLimit(here.curvature);
    const brakeLookaheadDistance = Math.max(BRAKE_LOOKAHEAD_MIN_METERS, Math.abs(player.speed) * BRAKE_LOOKAHEAD_SECONDS);
    for (let i = 1; i <= BRAKE_LOOKAHEAD_SAMPLES; i++) {
      const distance = (brakeLookaheadDistance * i) / BRAKE_LOOKAHEAD_SAMPLES;
      const projected: Vec3 = {
        x: here.point.x + here.tangent.x * distance,
        y: here.point.y + here.tangent.y * distance,
        z: 0,
      };
      const sample = trackQuery.nearestPoint(projected);
      if (sample.loopIndex !== here.loopIndex) continue;
      minSpeedLimit = Math.min(minSpeedLimit, speedLimit(sample.curvature));
    }

    const targetSpeed = minSpeedLimit * SPEED_MARGIN;
    const throttle = player.speed < targetSpeed;
    const brake = player.speed > targetSpeed * BRAKE_HYSTERESIS;

    return { throttle, brake, steerLeft, steerRight, handbrake: false, shiftUp: false, shiftDown: false };
  }
}
