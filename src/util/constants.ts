/** Centralized gameplay and rendering tuning values. */

// Vehicle physics
export const MAX_SPEED = 40; // meters/second
export const MAX_REVERSE_SPEED = 12; // meters/second
export const ACCELERATION = 12; // meters/second^2
export const BRAKE_FORCE = 20; // meters/second^2
export const HANDBRAKE_FORCE = 35; // meters/second^2; stronger than BRAKE_FORCE, never reverses
export const FRICTION = 6; // meters/second^2, applied when coasting
export const STEERING_RATE = 2.2; // radians/second at full steering, scaled by speed
export const MIN_STEER_SPEED_FACTOR = 0.15; // steering effectiveness floor at low speed

// Engine/transmission RPM model. Not a real drivetrain simulation —
// just enough that speed and RPM are related through gear ratio the
// way a real car's are: RPM = idle + |speed| * ratio * finalDrive,
// clamped to redline. Gear changes are instant at the physics level
// (an upshift makes RPM drop immediately, a downshift makes it jump),
// which is what makes manual shifting audible and meaningful — see
// entities/player.ts.
export const IDLE_RPM = 900;
export const REDLINE_RPM = 7000;
export const LIMITER_RPM = 7200; // bounces with REDLINE_RPM while pinned at redline
export const GEAR_RATIOS = [3.2, 2.1, 1.5, 1.15, 0.9]; // gears 1-5
export const REVERSE_GEAR_RATIO = 3.5;
export const FINAL_DRIVE = 150; // tuned so each gear redlines around a sensible speed
export const REFERENCE_GEAR_RATIO = GEAR_RATIOS[2]; // 3rd gear; acceleration multiplier ~1.0x here
export const AUTOMATIC_UPSHIFT_RPM = 6000;
export const AUTOMATIC_DOWNSHIFT_RPM = 2200;

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
