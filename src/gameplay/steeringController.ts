import type { Vec3 } from "../math/vector3.js";
import { angleDelta, perpendicular } from "../math/vector3.js";
import type { CarConfig } from "../util/cars/index.js";
import type { RacingLine } from "../world/racingLine.js";
import { racingLinePointAt, racingLinePointAhead } from "../world/racingLine.js";
import { effectiveGrip, availableLateral } from "../util/vehicleDynamics.js";
import { ROAD_SURFACE } from "../world/surfaceState.js";

/** A car's instantaneous state, as far as a SteeringController needs it. */
export interface VehiclePose {
  position: Vec3;
  /** Radians, 0 = facing +Y (see entities/player.ts's heading convention). */
  heading: number;
  /** m/s, signed (negative = reversing). */
  speed: number;
  car: CarConfig;
}

/**
 * Turns a car's pose and the racing line into a continuous steer command.
 * Takes the RacingLine itself (plus the car's current centerlineS) rather
 * than precomputed scalar errors, so each controller owns its own
 * lookahead strategy (fixed, speed-scaled, multi-point, ...) instead of
 * AiDriver having to grow more lookahead logic every time a new controller
 * wants something different. A small interface, not a specific algorithm:
 * Pure Pursuit, Stanley, etc. are all valid implementations.
 */
export interface SteeringController {
  /**
   * @param pose Current vehicle state.
   * @param racingLine The track's precomputed racing line.
   * @param currentCenterlineS The car's current position, expressed as
   *   arc length along the CENTERLINE (matches RacingLinePoint.centerlineS
   *   — from TrackQuery.nearestPoint(pose.position).arcLength).
   * @returns steerAxis, -1..1, matching ControlState.steerAxis's sign
   *   convention (positive = right, same as steerRight).
   */
  computeSteerAxis(pose: VehiclePose, racingLine: RacingLine, currentCenterlineS: number): number;
}

/** Per-radian gain on heading error. */
const DEFAULT_HEADING_GAIN = 2.0;
/** Per-meter gain on lateral error. */
const DEFAULT_LATERAL_GAIN = 0.15;

/**
 * The Step 6 baseline controller: steerAxis is a straight weighted sum of
 * heading error and lateral error, BOTH measured against the racing line's
 * local tangent/position at the car's current centerlineS (no lookahead,
 * no anticipation). Kept as a reference point for Step 6b's comparison —
 * this is the controller that converges cleanly on a straight but produces
 * a catastrophic overshoot at the first corner, because it only reacts
 * once the car has already started departing from the line rather than
 * anticipating the corner. See PurePursuitSteeringController for the
 * anticipating alternative.
 *
 * Sign convention, calibrated empirically against Player (not derived on
 * paper — an earlier attempt got the lateral term backwards by reasoning
 * about "left"/"right" from the coordinate math instead of measuring it):
 * driving straight and holding steerRight=true (steerAxis effectively +1)
 * for half a second measurably INCREASES both lateralError and heading in
 * this engine's convention -- i.e. positive steerAxis pushes both terms
 * more positive. So correcting either a positive lateralError or a
 * positive headingError both require a NEGATIVE steerAxis contribution;
 * both terms are negated.
 */
export class ProportionalSteeringController implements SteeringController {
  constructor(
    private readonly headingGain = DEFAULT_HEADING_GAIN,
    private readonly lateralGain = DEFAULT_LATERAL_GAIN
  ) {}

  computeSteerAxis(pose: VehiclePose, racingLine: RacingLine, currentCenterlineS: number): number {
    const currentPoint = racingLinePointAt(racingLine, currentCenterlineS);

    const perp = perpendicular(currentPoint.tangent);
    const dx = pose.position.x - currentPoint.position.x;
    const dy = pose.position.y - currentPoint.position.y;
    const lateralError = dx * perp.x + dy * perp.y;

    const lineHeading = Math.atan2(currentPoint.tangent.x, currentPoint.tangent.y);
    const headingError = angleDelta(pose.heading, lineHeading);

    const raw = -this.headingGain * headingError - this.lateralGain * lateralError;
    return Math.max(-1, Math.min(1, raw));
  }
}

const MIN_LOOKAHEAD_M = 6;
const MAX_LOOKAHEAD_M = 40;
/** Lookahead distance grows by this many seconds' worth of travel — short at low speed, long at high speed. */
const LOOKAHEAD_TIME_S = 0.6;
/** Below this chord length to the lookahead target, curvature blows up numerically; floor it instead. */
const MIN_CHORD_LENGTH_M = 0.5;

/**
 * Step 6b: a Pure-Pursuit-style anticipating controller. Rather than
 * reacting to the car's current lateral/heading error (as
 * ProportionalSteeringController does), this aims at a single point
 * further down the racing line — near at low speed, far at high speed —
 * and asks "what curvature gets me from here to there," the classic Pure
 * Pursuit formula: curvature = 2*sin(alpha) / chordLength, where alpha is
 * the angle between the car's heading and the straight line to the
 * target. This is exactly the anticipation the proportional controller
 * lacked: since the racing line already IS the desired future trajectory,
 * aiming further ahead at speed uses that future information directly
 * instead of only responding after the car has drifted off it.
 *
 * The resulting curvature is converted to steerAxis via the car's own
 * geometric steering limit (tan(wheelMaxSteerRad) / wheelbase — the same
 * formula Player.applySteering uses for its geometricMaxCurvature ceiling,
 * see entities/player.ts), rather than an arbitrary gain constant: a
 * curvature equal to what the car can achieve at full lock maps to
 * steerAxis = ±1. This ties the controller's output scale to the actual
 * car's steering capability instead of a hand-tuned number, and is the
 * "tunable knob" here in place of separate heading/lateral gains — mainly
 * the lookahead time constant.
 *
 * Sign: alpha = angleDelta(heading, angleToTarget) is the same quantity
 * (and same empirically-verified sign) as the old bang-bang/Step-5
 * headingError computed toward a lookahead point — positive alpha needs a
 * negative steerAxis — so the final curvature-to-axis mapping is negated,
 * consistent with ProportionalSteeringController's calibration.
 *
 * Known limitation (measured, not yet addressed): once cross-track error
 * exceeds the lookahead distance, the target chord distance grows right
 * along with the error, so desiredCurvature (which divides by chord
 * length) SHRINKS exactly when more correction is needed — steering
 * command decayed from 0.35 to 0.02 while lateral error grew from -8m to
 * -340m in one measured run, never recovering. A fix was drafted (a
 * separate bounded cross-track recovery term) and then rolled back
 * pending further direction; this class is currently just the
 * alpha-clamped raw Pure Pursuit formula.
 */
export class PurePursuitSteeringController implements SteeringController {
  constructor(
    private readonly minLookahead = MIN_LOOKAHEAD_M,
    private readonly maxLookahead = MAX_LOOKAHEAD_M,
    private readonly lookaheadTimeSeconds = LOOKAHEAD_TIME_S
  ) {}

  computeSteerAxis(pose: VehiclePose, racingLine: RacingLine, currentCenterlineS: number): number {
    const lookaheadDistance = Math.max(
      this.minLookahead,
      Math.min(this.maxLookahead, Math.abs(pose.speed) * this.lookaheadTimeSeconds)
    );
    const target = racingLinePointAhead(racingLine, currentCenterlineS, lookaheadDistance);

    const dx = target.position.x - pose.position.x;
    const dy = target.position.y - pose.position.y;
    const chordLength = Math.max(MIN_CHORD_LENGTH_M, Math.hypot(dx, dy));
    const angleToTarget = Math.atan2(dx, dy);
    const alpha = angleDelta(pose.heading, angleToTarget);
    // sin(alpha) isn't monotonic past 90° -- it turns back toward 0, which
    // would collapse steering authority exactly when the car is badly off
    // the line (target well off to the side or behind) instead of
    // saturating at max lock. Clamping alpha keeps the formula monotonic
    // across its full useful range; this is a correctness fix for the
    // formula, not a tuning knob.
    const clampedAlpha = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, alpha));

    const desiredCurvature = (2 * Math.sin(clampedAlpha)) / chordLength;
    const geometricMaxCurvature = Math.tan(pose.car.chassis.wheelMaxSteerRad) / pose.car.chassis.wheelbase;
    const normalized = geometricMaxCurvature > 1e-9 ? desiredCurvature / geometricMaxCurvature : 0;

    return Math.max(-1, Math.min(1, -normalized));
  }
}

/** Per-meter gain inside the recovery term's atan() — see HybridPursuitSteeringController's doc comment. */
const DEFAULT_RECOVERY_GAIN = 0.3;

/**
 * Pure Pursuit's anticipation term (identical to PurePursuitSteeringController)
 * PLUS a separate, bounded cross-track recovery term, summed and clamped
 * once at the end — the fix drafted (then rolled back pending direction)
 * after diagnosing PurePursuitSteeringController's known failure mode:
 * raw Pure Pursuit's steering command SHRINKS as cross-track error grows
 * past the lookahead distance (measured: 0.35 -> 0.02 while lateral error
 * grew from -8m to -340m, never recovering), because the lookahead-target
 * chord length grows right along with the error, and desiredCurvature
 * divides by that chord length.
 *
 * Rather than patch that inside the Pure Pursuit formula (e.g. clamping
 * chordLength to the lookahead distance, which restores authority but
 * quietly changes what the formula means), this adds a SEPARATE term
 * driven purely by lateral error at the car's CURRENT point (not the
 * lookahead point — same reference ProportionalSteeringController uses):
 * recovery = -(2/pi)*atan(recoveryGain*lateralError). atan is
 * near-proportional for small errors, so it doesn't fight Pure Pursuit's
 * own fine cornering behavior when the car is already close to the line,
 * but SATURATES toward +-1 for large errors instead of decaying like the
 * raw Pure Pursuit term does — a 50m error can't demand more than max
 * lock, but it also never demands LESS correction than a 5m error, which
 * was the actual pathology.
 *
 * Both terms are computed unclamped, summed, and clamped to [-1,1] ONCE —
 * not clamped individually first — so recovery genuinely blends with Pure
 * Pursuit's anticipation (dominant when the car is on/near the line, since
 * atan(small)≈small keeps it a minor contribution there) rather than
 * overriding it outright.
 *
 * Sign: both terms share the same empirically-calibrated convention as
 * PurePursuitSteeringController/ProportionalSteeringController — positive
 * lateralError or positive alpha both need a negative steerAxis
 * contribution, so both terms are negated.
 */
export class HybridPursuitSteeringController implements SteeringController {
  constructor(
    private readonly minLookahead = MIN_LOOKAHEAD_M,
    private readonly maxLookahead = MAX_LOOKAHEAD_M,
    private readonly lookaheadTimeSeconds = LOOKAHEAD_TIME_S,
    private readonly recoveryGain = DEFAULT_RECOVERY_GAIN
  ) {}

  computeSteerAxis(pose: VehiclePose, racingLine: RacingLine, currentCenterlineS: number): number {
    const lookaheadDistance = Math.max(
      this.minLookahead,
      Math.min(this.maxLookahead, Math.abs(pose.speed) * this.lookaheadTimeSeconds)
    );
    const target = racingLinePointAhead(racingLine, currentCenterlineS, lookaheadDistance);

    const dx = target.position.x - pose.position.x;
    const dy = target.position.y - pose.position.y;
    const chordLength = Math.max(MIN_CHORD_LENGTH_M, Math.hypot(dx, dy));
    const angleToTarget = Math.atan2(dx, dy);
    const alpha = angleDelta(pose.heading, angleToTarget);
    const clampedAlpha = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, alpha));

    const desiredCurvature = (2 * Math.sin(clampedAlpha)) / chordLength;
    const geometricMaxCurvature = Math.tan(pose.car.chassis.wheelMaxSteerRad) / pose.car.chassis.wheelbase;
    const normalized = geometricMaxCurvature > 1e-9 ? desiredCurvature / geometricMaxCurvature : 0;
    const purePursuitTerm = -normalized;

    const currentPoint = racingLinePointAt(racingLine, currentCenterlineS);
    const perp = perpendicular(currentPoint.tangent);
    const lateralError = (pose.position.x - currentPoint.position.x) * perp.x + (pose.position.y - currentPoint.position.y) * perp.y;
    const recoveryTerm = -(2 / Math.PI) * Math.atan(this.recoveryGain * lateralError);

    return Math.max(-1, Math.min(1, purePursuitTerm + recoveryTerm));
  }
}

/** Per-(m/s of lateral velocity) gain on the damping term, before speed scaling. */
const DEFAULT_DAMPING_GAIN = 0.08;
/** Damping's speed multiplier is speed/this, clamped -- 1.0x at this reference speed. */
const DAMPING_REFERENCE_SPEED_MPS = 20;
const DAMPING_SPEED_SCALE_MIN = 0.5;
const DAMPING_SPEED_SCALE_MAX = 2.0;

/**
 * Signed velocity component perpendicular to the racing line's tangent at
 * `currentCenterlineS` — d(lateralError)/dt, physically, in the same sign
 * convention as lateralError (positive = left). Derived analytically from
 * speed + heading (velocity = speed*(sin(heading), cos(heading)), matching
 * Player's own position-update formula) rather than from a previous-frame
 * position difference, so SteeringController stays a pure function of the
 * current pose — no controller-side state to manage. This assumes zero
 * slip (heading == direction of travel), which HybridPursuitSteeringController's
 * measured traces confirm holds for AI driving (no handbrake, the only
 * thing that introduces slip in this game).
 */
function lateralVelocityAt(pose: VehiclePose, tangent: Vec3): number {
  const perp = perpendicular(tangent);
  const velocityX = pose.speed * Math.sin(pose.heading);
  const velocityY = pose.speed * Math.cos(pose.heading);
  return velocityX * perp.x + velocityY * perp.y;
}

function dampingSpeedScale(speed: number): number {
  return Math.max(DAMPING_SPEED_SCALE_MIN, Math.min(DAMPING_SPEED_SCALE_MAX, Math.abs(speed) / DAMPING_REFERENCE_SPEED_MPS));
}

/**
 * Step 1 of the damping prototype: bounded position recovery PLUS lateral-
 * velocity damping, with NO Pure Pursuit term — deliberately isolated so
 * the straight-line stability question ("does recovery become stable once
 * it can see the car's lateral motion, not just its position") can be
 * tested on its own, per the diagnostic that found HybridPursuitSteeringController's
 * plain recovery term oscillating on a straight, at 44-49 m/s, entirely by
 * itself: lateralError overshot from -0.83 to +4.80 while yawRate stayed
 * pinned at +17°/s well after position error had already started falling
 * back — a car with substantial lateral velocity but a controller that
 * only ever asked "where am I", never "how fast am I moving sideways".
 *
 * steerAxis = boundedPositionRecovery(lateralError) - dampingGain(speed) *
 * lateralVelocity. The two terms are structurally a standard PD
 * controller (P = bounded lateral error, D = lateral velocity), not
 * independently invented gains: same sign convention throughout (negated,
 * per the empirically-calibrated convention every controller in this file
 * shares), and the damping gain is speed-scaled (dampingSpeedScale) since
 * a given lateral velocity means a proportionally smaller trajectory
 * deviation at high speed than at low speed — NOT tuned precisely yet,
 * just given a reasonable speed-awareness before the first stability test.
 */
export class RecoveryDampedController implements SteeringController {
  constructor(
    private readonly recoveryGain = DEFAULT_RECOVERY_GAIN,
    private readonly dampingGain = DEFAULT_DAMPING_GAIN
  ) {}

  computeSteerAxis(pose: VehiclePose, racingLine: RacingLine, currentCenterlineS: number): number {
    const currentPoint = racingLinePointAt(racingLine, currentCenterlineS);
    const perp = perpendicular(currentPoint.tangent);
    const lateralError = (pose.position.x - currentPoint.position.x) * perp.x + (pose.position.y - currentPoint.position.y) * perp.y;
    const recoveryTerm = -(2 / Math.PI) * Math.atan(this.recoveryGain * lateralError);

    const lateralVelocity = lateralVelocityAt(pose, currentPoint.tangent);
    const dampingTerm = -this.dampingGain * dampingSpeedScale(pose.speed) * lateralVelocity;

    return Math.max(-1, Math.min(1, recoveryTerm + dampingTerm));
  }
}

/**
 * Step 2 of the damping prototype: HybridPursuitSteeringController's Pure
 * Pursuit anticipation term, added back on top of RecoveryDampedController's
 * now-damped recovery — the full controller, tested only after
 * RecoveryDampedController itself is confirmed stable on a straight (see
 * that class's doc comment for why the recovery term needed damping in
 * the first place).
 */
/**
 * The car's actual achievable curvature ceiling at a given speed — the same
 * grip-limited yaw-rate cap Player.applySteering computes internally
 * (hardMaxYaw = availableLateral(effectiveGrip(tireGrip,...))/speedDivisor,
 * then curvature = yawRate/speed), NOT the raw geometric wheel-angle limit
 * (tan(wheelMaxSteerRad)/wheelbase). The two diverge enormously at speed:
 * measured full-lock authority at 45 m/s is ~0.009 curvature, vs. a raw
 * geometric limit of 0.351 — a ~40x gap. This is the fix for the diagnosed
 * root cause of PurePursuitSteeringController/HybridPursuitSteeringController's
 * corner divergence: normalizing desiredCurvature against the raw geometric
 * limit made steerAxis chronically ~20-40x too weak at speed, even though
 * desiredCurvature itself was a reasonable estimate of what the line needed
 * — confirmed by tracing steerAxis maxing out around 0.28 while lateral
 * error grew past 70m, when full authority was actually needed.
 */
function achievableCurvatureAtSpeed(speed: number, car: CarConfig): number {
  const chassis = car.chassis;
  const geometricMaxCurvature = Math.tan(chassis.wheelMaxSteerRad) / chassis.wheelbase;
  const speedDivisor = Math.max(Math.abs(speed), 1);
  const hardMaxYaw = availableLateral(effectiveGrip(chassis.tireGrip, speed, car), ROAD_SURFACE, 0) / speedDivisor;
  const gripLimitedCurvature = hardMaxYaw / speedDivisor;
  return Math.min(geometricMaxCurvature, gripLimitedCurvature);
}

const MIN_FF_LOOKAHEAD_M = 4;
const MAX_FF_LOOKAHEAD_M = 25;
const FF_LOOKAHEAD_TIME_S = 0.4;
/** Per-radian gain on heading error, measured at the feed-forward lookahead point's tangent. */
const DEFAULT_HEADING_ERROR_GAIN = 0.6;
/** Per-meter gain inside the cross-track term's atan() — same bounded-recovery shape as DEFAULT_RECOVERY_GAIN, applied at the car's current point. */
const DEFAULT_CROSS_TRACK_GAIN = 0.25;

/**
 * steering = curvatureFeedForward + headingErrorFeedback + crossTrackFeedback,
 * summed and clamped once. Replaces Pure Pursuit's chord-geometry inference
 * of "how much to turn" with the racing line's own curvature, read directly
 * — the line already knows how much the road curves; there's no need to
 * rediscover it from a lookahead chord. The feed-forward term is normalized
 * against achievableCurvatureAtSpeed (the car's real grip-limited ceiling),
 * not the raw geometric wheel limit, which is what made the Pure Pursuit
 * variants chronically under-steer through corners at speed.
 *
 * headingErrorFeedback corrects heading relative to the line's tangent at
 * the SAME lookahead point the feed-forward term uses (an point-ahead
 * heading error, not the car's current-point heading error) — this is what
 * gives the controller anticipation of an upcoming turn-in, on top of the
 * curvature feed-forward. crossTrackFeedback is the same bounded atan
 * position-recovery term proven stable in isolation (see
 * RecoveryDampedController's doc comment for why it saturates instead of
 * decaying at large error), evaluated at the car's current point.
 *
 * Deliberately does NOT include lateral-velocity damping: in this kinematic
 * model, velocityHeading tracks heading almost exactly off the handbrake
 * (see entities/player.ts's blendVelocityHeading), so a derived "lateral
 * velocity" term is not an independent tire-slip state — it's just
 * speed*sin(heading - tangent), which shifts every frame as the racing
 * line's own tangent rotates under the car during a corner. Vehicle
 * characterization (steering-pulse and sustained-steering tests) confirmed
 * the plant itself settles cleanly and predictably; the corner divergence
 * traces back to the controller's curvature normalization, not missing
 * vehicle damping.
 *
 * Sign convention: matches every other controller in this file (positive
 * lateralError/headingError/curvature both correspond to a NEGATIVE
 * steerAxis contribution to correct them).
 */
export class CurvatureFeedForwardController implements SteeringController {
  constructor(
    private readonly minLookahead = MIN_FF_LOOKAHEAD_M,
    private readonly maxLookahead = MAX_FF_LOOKAHEAD_M,
    private readonly lookaheadTimeSeconds = FF_LOOKAHEAD_TIME_S,
    private readonly headingErrorGain = DEFAULT_HEADING_ERROR_GAIN,
    private readonly crossTrackGain = DEFAULT_CROSS_TRACK_GAIN
  ) {}

  computeSteerAxis(pose: VehiclePose, racingLine: RacingLine, currentCenterlineS: number): number {
    const lookaheadDistance = Math.max(
      this.minLookahead,
      Math.min(this.maxLookahead, Math.abs(pose.speed) * this.lookaheadTimeSeconds)
    );
    const aheadPoint = racingLinePointAhead(racingLine, currentCenterlineS, lookaheadDistance);

    const achievableCurvature = achievableCurvatureAtSpeed(pose.speed, pose.car);
    const feedForwardTerm = achievableCurvature > 1e-9 ? -(aheadPoint.curvature / achievableCurvature) : 0;

    const lineHeadingAhead = Math.atan2(aheadPoint.tangent.x, aheadPoint.tangent.y);
    const headingError = angleDelta(pose.heading, lineHeadingAhead);
    const headingErrorTerm = -this.headingErrorGain * headingError;

    const currentPoint = racingLinePointAt(racingLine, currentCenterlineS);
    const perp = perpendicular(currentPoint.tangent);
    const lateralError = (pose.position.x - currentPoint.position.x) * perp.x + (pose.position.y - currentPoint.position.y) * perp.y;
    const crossTrackTerm = -(2 / Math.PI) * Math.atan(this.crossTrackGain * lateralError);

    return Math.max(-1, Math.min(1, feedForwardTerm + headingErrorTerm + crossTrackTerm));
  }
}

export class HybridDampedPursuitController implements SteeringController {
  constructor(
    private readonly minLookahead = MIN_LOOKAHEAD_M,
    private readonly maxLookahead = MAX_LOOKAHEAD_M,
    private readonly lookaheadTimeSeconds = LOOKAHEAD_TIME_S,
    private readonly recoveryGain = DEFAULT_RECOVERY_GAIN,
    private readonly dampingGain = DEFAULT_DAMPING_GAIN
  ) {}

  computeSteerAxis(pose: VehiclePose, racingLine: RacingLine, currentCenterlineS: number): number {
    const lookaheadDistance = Math.max(
      this.minLookahead,
      Math.min(this.maxLookahead, Math.abs(pose.speed) * this.lookaheadTimeSeconds)
    );
    const target = racingLinePointAhead(racingLine, currentCenterlineS, lookaheadDistance);

    const dx = target.position.x - pose.position.x;
    const dy = target.position.y - pose.position.y;
    const chordLength = Math.max(MIN_CHORD_LENGTH_M, Math.hypot(dx, dy));
    const angleToTarget = Math.atan2(dx, dy);
    const alpha = angleDelta(pose.heading, angleToTarget);
    const clampedAlpha = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, alpha));

    const desiredCurvature = (2 * Math.sin(clampedAlpha)) / chordLength;
    const geometricMaxCurvature = Math.tan(pose.car.chassis.wheelMaxSteerRad) / pose.car.chassis.wheelbase;
    const normalized = geometricMaxCurvature > 1e-9 ? desiredCurvature / geometricMaxCurvature : 0;
    const purePursuitTerm = -normalized;

    const currentPoint = racingLinePointAt(racingLine, currentCenterlineS);
    const perp = perpendicular(currentPoint.tangent);
    const lateralError = (pose.position.x - currentPoint.position.x) * perp.x + (pose.position.y - currentPoint.position.y) * perp.y;
    const recoveryTerm = -(2 / Math.PI) * Math.atan(this.recoveryGain * lateralError);

    const lateralVelocity = lateralVelocityAt(pose, currentPoint.tangent);
    const dampingTerm = -this.dampingGain * dampingSpeedScale(pose.speed) * lateralVelocity;

    return Math.max(-1, Math.min(1, purePursuitTerm + recoveryTerm + dampingTerm));
  }
}
