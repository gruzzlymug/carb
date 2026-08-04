/** Centralized gameplay and rendering tuning values. */

// Vehicle physics
export const MAX_SPEED = 72; // meters/second; ~161 mph envelope — 5th redlines first (~67.8, ~152 mph), which is the real top speed
export const MAX_REVERSE_SPEED = 12; // meters/second
// Base acceleration. Effective pull = ACCELERATION * gear torque multiplier
// * engine torque at the current RPM (ENGINE_TORQUE_CURVE) * drag falloff —
// see entities/player.ts. The torque curve averages well below 1, so this
// is higher than the raw feel. Tuned so full-throttle 0->60 mph is ~2.9s,
// 0->100 ~5.8s, 0->130 ~8.2s, 0->150 ~12.6s — arcade-quick, not realistic.
export const ACCELERATION = 8; // meters/second^2
export const BRAKE_FORCE = 20; // meters/second^2
export const HANDBRAKE_FORCE = 35; // meters/second^2; stronger than BRAKE_FORCE, never reverses
export const FRICTION = 6; // meters/second^2, applied when coasting
// Steering is a kinematic bicycle model (see entities/player.ts): the front
// wheels deflect toward the input, and that deflection + road speed set a
// desired yaw rate, which tire grip then caps. So the car turns only when
// moving, turns in as the wheels swing over, and washes out (understeers)
// at speed instead of pivoting on the spot.
export const VEHICLE_WHEELBASE = 2.4; // meters, front axle to rear axle (matches the wheel offsets)
// Peak lateral acceleration the tires' contact patches can sustain — the
// "how much grip the ground gives" term. Caps cornering: turn radius can't
// drop below speed^2 / TIRE_GRIP, which is what limits high-speed turning.
// Lower it to model a slippery surface; raise it for more stick.
export const TIRE_GRIP = 16; // meters/second^2 (~1.6g)
// Front-wheel steering deflection: the wheels yaw toward the input, eased so
// it reads like a steering rack rather than snapping. This is both the
// visible wheel angle AND the steering input to the bicycle model above.
export const WHEEL_MAX_STEER_RAD = 0.7; // front-wheel yaw at full lock (~40°)
export const WHEEL_STEER_SMOOTH_PER_SEC = 16; // rate the wheels ease toward their target angle

// Engine/transmission RPM model. Not a real drivetrain simulation —
// just enough that speed and RPM are related through gear ratio the
// way a real car's are: RPM = idle + |speed| * ratio * RPM_SCALE,
// clamped to redline. Gear changes are instant at the physics level
// (an upshift makes RPM drop immediately, a downshift makes it jump),
// which is what makes manual shifting audible and meaningful — see
// entities/player.ts.
//
// Acceleration flows through a simple torque chain (no real drivetrain
// sim): ENGINE_TORQUE_CURVE gives the engine's output at the current RPM,
// GEAR_ACCEL_MULTIPLIERS multiplies it by the gear's torque, and a drag
// term (TOP_SPEED_FALLOFF) trims the top end. Gear ratio and torque
// multiplier are kept as separate tables (rather than one derived from the
// other): the ratio controls RPM behavior — how fast it climbs and where
// each gear redlines — while the multiplier and curve control how hard the
// gear pulls. Tangling them made the gearbox nearly impossible to tune,
// since changing one always changed the other.
export const IDLE_RPM = 900;
export const REDLINE_RPM = 7000;
export const LIMITER_RPM = 7200; // sustained bounce with REDLINE_RPM while pinned with no recent downshift
export const MAX_TRANSMISSION_RPM = 7600; // hard ceiling on displayed/audible RPM, even right after an aggressive downshift
export const RECOMMENDED_SHIFT_RPM = 6500; // HUD/audio shift cue, comfortably below the limiter

// Gears 1-5. Redline speeds at REDLINE_RPM: 1st 13.6, 2nd 20.9, 3rd 29.5,
// 4th 41.5, 5th 67.8 m/s (~30/47/66/93/152 mph). 5th is a long overdrive
// that carries the car to its ~152 mph top speed.
export const GEAR_RATIOS = [3.0, 1.95, 1.38, 0.98, 0.6];
// Gear torque multipliers (gears 1-5) — the "how hard this gear pulls" half
// of the model, deliberately its own table rather than derived from the
// ratio. 4th/5th kept strong so they aren't dead gears.
export const GEAR_ACCEL_MULTIPLIERS = [1.5, 1.32, 1.14, 1.0, 0.88];
// Engine torque curve: normalized output torque (0..1) at a given RPM,
// keyed by RPM as a fraction of REDLINE_RPM. Interpolated in engineModel.ts
// (engineTorqueFraction). It's the "how much the engine is making right
// now" half of the model — low off idle, fat through the mid-range power
// band, and falling to zero at redline. That zero is what still caps a
// gear at its own redline speed, and it's why each upshift drops the revs
// back into the fat part of the curve: the surge -> drop -> surge feel.
export const ENGINE_TORQUE_CURVE: ReadonlyArray<readonly [number, number]> = [
  [0.1, 0.55], // just off idle: enough to launch, not peak
  [0.35, 0.88],
  [0.6, 1.0], // peak torque, mid-range
  [0.8, 0.92],
  [0.92, 0.72],
  [1.0, 0.0], // redline: no torque left
];
// A light aerodynamic-drag proxy: pull fades toward the speed cap (cubic),
// up to this fraction, so high speed feels like pushing against air. Kept
// gentle since the torque curve already tapers hard near redline — this is
// only meaningful in a long overdrive 5th where the revs sit mid-band.
export const TOP_SPEED_FALLOFF = 0.35;
export const REVERSE_GEAR_RATIO = 3.5;
export const REVERSE_ACCEL_MULTIPLIER = 1.5;
export const RPM_SCALE = 150; // gameplay tuning factor, not a real final-drive ratio

// Automatic shift thresholds. Throttle-aware (see player.ts): flat out the
// box holds each gear to AUTOMATIC_UPSHIFT_RPM; lifting off upshifts early
// at AUTOMATIC_COAST_UPSHIFT_RPM to settle into a taller gear; braking
// downshifts more eagerly at AUTOMATIC_BRAKE_DOWNSHIFT_RPM. The wide gap
// between up- and down-shift RPMs is deliberate hysteresis — it stops the
// box hunting between two gears.
export const AUTOMATIC_UPSHIFT_RPM = 6600; // full throttle
export const AUTOMATIC_COAST_UPSHIFT_RPM = 5000; // partial / no throttle
export const AUTOMATIC_DOWNSHIFT_RPM = 3000; // coasting / cruising
export const AUTOMATIC_BRAKE_DOWNSHIFT_RPM = 3500; // under braking, drop gears sooner
// Kickdown: under throttle, if the current gear has fallen below the useful
// part of the power band (RPM < AUTOMATIC_KICKDOWN_RPM), the box drops a gear
// when doing so gives meaningfully more torque — the "floor it in 5th at
// 110 mph and it grabs a lower gear" behavior a plain RPM selector misses.
export const AUTOMATIC_KICKDOWN_RPM = 4000; // only consider kickdown below this RPM
export const AUTOMATIC_KICKDOWN_MIN_GAIN = 0.12; // require >12% more torque to bother
// Safety valve: the automatic never downshifts into a gear that would spin
// past this RPM. (Manual keeps its theatrical over-redline downshift.)
export const AUTOMATIC_MAX_DOWNSHIFT_RPM = 6800;
// Manual shifts are snappy; the automatic gets a slightly longer settle so
// it doesn't machine-gun through gears while stepping one at a time.
export const MANUAL_SHIFT_COOLDOWN_MS = 90;
export const AUTOMATIC_SHIFT_COOLDOWN_MS = 120;
// How long a downshift is allowed to show RPM above redline (up to
// MAX_TRANSMISSION_RPM) before falling back to the normal limiter
// bounce — an aggressive downshift briefly "screams," then settles.
export const DOWNSHIFT_SETTLE_MS = 120;
// An upshift eases the displayed RPM down to the new gear's value over this
// window instead of teleporting, so the drop reads (and later sounds) like
// a real gearchange rather than an instant jump.
export const SHIFT_RPM_BLEND_MS = 90;
// Upshift torque interruption: for this brief window after an upshift, drive
// torque is cut to SHIFT_TORQUE_CUT_FACTOR of normal, so a shift reads as
// "scream -> shift -> tiny thump -> power back" instead of an instant jump
// in acceleration (1->2 is otherwise a ~88% step). Physical event, not a
// lingering multiplier — steady-state pull after the window is unchanged.
// Downshifts get NO cut (their surge is intended). Keep this short: 55 ms is
// ~3-4 frames at 60 FPS; longer just makes the car feel sluggish.
export const SHIFT_TORQUE_CUT_MS = 55;
export const SHIFT_TORQUE_CUT_FACTOR = 0.15; // torque multiplier during the cut (lower = more severe)

// Track / road
export const ROAD_WIDTH = 10; // meters
export const TRACK_SAMPLE_SPACING = 3; // meters between spline samples along the track
export const GAS_STATION_MIN_INTERVAL_METERS = 120;
export const GAS_STATION_MAX_INTERVAL_METERS = 220;
export const TRACK_GROUND_MARGIN = 40; // extra ground beyond the track's bounding box, meters

// Camera defaults. These are the initial values for engine/cameras/
// cameraSettings.ts, a mutable copy the debug panel edits live — camera
// distance-back is derived from height/tilt (not set independently),
// since cameras aim via THREE.Camera.lookAt rather than a fixed matrix,
// so any height/tilt combination is automatically framed correctly.
// Yaw 45 deg + tilt ~35.26 deg is the classic "true isometric" pairing:
// it puts the ground axes at exactly 30 degrees from the screen's bottom
// edge, giving the shallow diagonal look of Zaxxon-style isometric games.
export const CAMERA_HEIGHT_DEFAULT = 22; // meters above the ground
export const CAMERA_TILT_RAD_DEFAULT = Math.atan(Math.SQRT1_2); // downward tilt angle; ~35.26 deg
export const CAMERA_YAW_RAD_DEFAULT = -Math.PI / 4; // fixed yaw; negative so forward reads up-right
export const CAMERA_VIEW_HEIGHT_DEFAULT = 24; // orthographic frustum height, world units
export const CAMERA_FOV_DEFAULT = 50; // perspective camera field of view, degrees
