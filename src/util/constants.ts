/** Centralized gameplay and rendering tuning values. */

// Simulation timing. Physics runs at a fixed timestep, decoupled from the
// (variable) render rate: each animation frame the loop accumulates real time
// and runs as many fixed PHYSICS_DT steps as have elapsed, then renders an
// interpolated pose (see engine/game.ts, Player.updateRenderPose). Fixed dt keeps
// the explicit integration (heading/position) consistent regardless of display
// FPS and is the stable base for future friction-circle / handbrake dynamics.
export const PHYSICS_HZ = 120; // physics updates per second
export const PHYSICS_DT = 1 / PHYSICS_HZ; // seconds per physics step
// A single render frame contributes at most this much real time to the physics
// accumulator, so a stalled/backgrounded tab catches up in a bounded number of
// steps (<= this / PHYSICS_DT) instead of spiraling.
export const MAX_FRAME_SECONDS = 0.1;

// Every characteristic of "which car" — performance, gearbox, shift
// behavior, chassis/steering feel (wheelbase, tire grip, handbrake, wheel
// steer), and engine sound — lives per-car in util/cars/ (see CarConfig),
// so the game can support more than one car/engine, and a car can be
// swapped, without touching physics/audio/HUD code. Only genuinely
// car-independent values (world/physics timing, track/road, camera) stay
// in this file.

// Track / road
// Widened from 10m and corner radii increased (see trackDefinitions.ts) so the
// tracks actually suit a ~152 mph / 1.6g car instead of capping corners at
// 42-60 mph — see ENGINE_ROADMAP.md's Tuning backlog for the prior numbers.
export const ROAD_WIDTH = 14; // meters
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
