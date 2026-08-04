/** Centralized gameplay and rendering tuning values. */

// Vehicle physics
export const MAX_SPEED = 72; // meters/second; ~161 mph envelope — 5th redlines first (~67.8, ~152 mph), which is the real top speed
export const MAX_REVERSE_SPEED = 12; // meters/second
// Base acceleration. Effective pull = ACCELERATION * gear multiplier *
// redline taper * top-speed falloff (see entities/player.ts), so this is
// lower than it looks. Tuned so full-throttle 0->60 mph is ~3.6s,
// 0->100 mph ~7.6s, 0->130 mph ~14.6s — arcade-quick, not realistic.
export const ACCELERATION = 6; // meters/second^2
export const BRAKE_FORCE = 20; // meters/second^2
export const HANDBRAKE_FORCE = 35; // meters/second^2; stronger than BRAKE_FORCE, never reverses
export const FRICTION = 6; // meters/second^2, applied when coasting
export const STEERING_RATE = 2.2; // radians/second at full steering, scaled by speed
// At speed, steering rate is scaled down by up to this fraction so the car
// isn't twitchy at 130 mph: factor = 1 - STEER_HIGH_SPEED_FALLOFF * (|speed|/MAX_SPEED)^1.5.
export const STEER_HIGH_SPEED_FALLOFF = 0.35;
// Cosmetic front-wheel steering: the front wheels visually yaw toward the
// steer input, eased so it reads like a steering rack rather than snapping.
// Purely visual — it doesn't affect the car's heading physics.
export const WHEEL_MAX_STEER_RAD = 0.7; // front-wheel yaw at full lock (~40°) — exaggerated so it reads clearly
export const WHEEL_STEER_SMOOTH_PER_SEC = 16; // rate the wheels ease toward their target angle

// Engine/transmission RPM model. Not a real drivetrain simulation —
// just enough that speed and RPM are related through gear ratio the
// way a real car's are: RPM = idle + |speed| * ratio * RPM_SCALE,
// clamped to redline. Gear changes are instant at the physics level
// (an upshift makes RPM drop immediately, a downshift makes it jump),
// which is what makes manual shifting audible and meaningful — see
// entities/player.ts.
//
// Ratio and acceleration multiplier are deliberately two separate
// tables (rather than one derived from the other): the ratio controls
// RPM behavior — how fast it climbs and where each gear redlines —
// while the multiplier controls how hard that gear pulls. Tangling
// them together made the gearbox nearly impossible to tune, since
// changing one always changed the other.
export const IDLE_RPM = 900;
export const REDLINE_RPM = 7000;
export const LIMITER_RPM = 7200; // sustained bounce with REDLINE_RPM while pinned with no recent downshift
export const MAX_TRANSMISSION_RPM = 7600; // hard ceiling on displayed/audible RPM, even right after an aggressive downshift
export const RECOMMENDED_SHIFT_RPM = 6500; // HUD/audio shift cue, comfortably below the limiter

// Gears 1-5. Redline speeds at REDLINE_RPM: 1st 13.6, 2nd 20.9, 3rd 29.5,
// 4th 41.5, 5th 67.8 m/s (~30/47/66/93/152 mph). 5th is a long overdrive
// that carries the car to its ~152 mph top speed.
export const GEAR_RATIOS = [3.0, 1.95, 1.38, 0.98, 0.6];
export const GEAR_ACCEL_MULTIPLIERS = [1.5, 1.32, 1.14, 1.0, 0.88]; // gears 1-5; 4th/5th kept strong so they aren't dead gears
// Power tapers instead of hard-cutting as revs approach redline: at or
// above REDLINE_TAPER_FRACTION of REDLINE_RPM (6300), pull falls linearly
// to zero at redline, so the engine "runs out of breath" rather than
// slamming into a wall — and a gear still can't creep past its own redline.
export const REDLINE_TAPER_FRACTION = 0.9;
// Pull also fades toward top speed (cubic): near the cap, up to this
// fraction of power is shed, so the final few m/s feel like straining.
export const TOP_SPEED_FALLOFF = 0.65;
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
