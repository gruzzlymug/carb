import { Input } from "./input.js";
import { readControlState } from "./controlState.js";
import { Renderer } from "./renderer.js";
import { TrackView } from "./trackView.js";
import { Hud } from "./hud.js";
import { Minimap } from "./minimap.js";
import { EngineSound } from "./sound/engineSound.js";
import { CAMERA_TYPES, DEFAULT_CAMERA_TYPE, type CameraController } from "./cameras/index.js";
import { Player } from "../entities/player.js";
import { PlayerView } from "../entities/playerView.js";
import { buildTrackWorld, type TrackWorld } from "../world/trackWorld.js";
import type { TrackQuery } from "../world/trackQuery.js";
import { classifySurface } from "../world/surfaceState.js";
import { DEFAULT_TRACK_TYPE } from "../world/trackDefinitions.js";
import { LapTracker } from "../gameplay/lapTracker.js";
import { AiDriver } from "../gameplay/aiDriver.js";
import { PHYSICS_DT, MAX_FRAME_SECONDS } from "../util/constants.js";

/**
 * Owns the top-level game loop: input -> physics -> rendering, driven
 * by requestAnimationFrame with delta time. Rendering itself is
 * retained-mode (Three.js scene graph) — the current track is built
 * once (see TrackView) and this loop just keeps the player and active
 * camera in sync with simulation state each frame.
 */
/** Live read-only telemetry for the debug panel, refreshed every frame. */
export interface Telemetry {
  speedKmh: number;
  gear: string;
  rpm: number;
  targetRpm: number;
  engineTorque: number; // 0..1 from the torque curve at the current drivetrain RPM
  gearMultiplier: number; // gear torque multiplier
  longAccel: number; // longitudinal acceleration, m/s^2 (negative under braking)
  wheelSteerDeg: number; // front-wheel deflection, degrees
  yawRateDeg: number; // deg/s
  lateralAccel: number; // m/s^2
  desiredYawDeg: number; // deg/s, from steering geometry alone, before grip softening/assist/reverse cap
  gripUtilization: number; // fraction of the physical yaw ceiling demanded (0..1+, briefly >1 mid-input)
  turnRadius: number; // current turn radius, meters (0 when straight)
  cornerLimit: string; // "grip" / "steering" / "none" — what's limiting cornering
  shiftCutMs: number; // ms remaining in the post-upshift torque cut (0 when inactive)
  driftAngleDeg: number; // angle between nose direction and direction of travel; 0 unless mid-slide
  isDrifting: boolean; // whether driftAngleDeg is large enough to read as an actual slide
  lateralOffsetM: number; // signed distance from the nearest centerline; + = left, - = right
  trackCurvature: number; // signed curvature (1/m) of the track at the nearest point
  onRoad: boolean; // whether the car's position falls within the paved road width
  surfaceKind: string; // "road" / "shoulder" / "offRoad" — what's actually driving physics grip/drag right now
  lapCount: number; // fully completed laps
  currentLapTime: number; // seconds since the current lap started
  bestLapTime: number | null; // seconds; null until a lap has completed
  lastLapTime: number | null; // seconds; null until a lap has completed
}

export class Game {
  /** Kept up to date each frame; the debug panel binds directly to this via lil-gui's .listen(). */
  readonly telemetry: Telemetry = {
    speedKmh: 0,
    gear: "1",
    rpm: 0,
    targetRpm: 0,
    engineTorque: 0,
    gearMultiplier: 0,
    longAccel: 0,
    wheelSteerDeg: 0,
    yawRateDeg: 0,
    lateralAccel: 0,
    desiredYawDeg: 0,
    gripUtilization: 0,
    turnRadius: 0,
    cornerLimit: "none",
    shiftCutMs: 0,
    driftAngleDeg: 0,
    isDrifting: false,
    lateralOffsetM: 0,
    trackCurvature: 0,
    onRoad: true,
    surfaceKind: "road",
    lapCount: 0,
    currentLapTime: 0,
    bestLapTime: null,
    lastLapTime: null,
  };

  private readonly input = new Input();
  private readonly renderer: Renderer;
  private readonly trackView: TrackView;
  private readonly player = new Player();
  private readonly playerView = new PlayerView();
  private readonly hud = new Hud(this.player.car.redlineRpm, this.player.car.recommendedShiftRpm);
  private readonly minimap = new Minimap();
  private readonly engineSound = new EngineSound(this.player.car);
  private readonly aiDriver = new AiDriver();
  private aiDriverEnabled = false;
  private cameraController: CameraController;
  private lastTimestamp: number | null = null;
  private accumulator = 0; // unspent real time carried between frames, fed to fixed-step physics
  private running = false;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private lastThrottle = false; // this frame's control state, read by presentFrame (engine audio only, no gameplay effect)
  private spawn: TrackWorld["spawn"] = { position: { x: 0, y: 0, z: 0 }, headingRad: 0 };
  /** Always assigned in the constructor via setTrackType before the loop starts. */
  private trackQuery!: TrackQuery;
  /** Always assigned in the constructor via setTrackType before the loop starts. */
  private lapTracker!: LapTracker;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.trackView = new TrackView(this.renderer.scene);
    this.renderer.scene.add(this.playerView.object3D);

    this.cameraController = CAMERA_TYPES[DEFAULT_CAMERA_TYPE]();
    window.addEventListener("resize", this.handleResize);
    this.handleResize();

    this.setTrackType(DEFAULT_TRACK_TYPE);
  }

  start(): void {
    this.running = true;
    requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
  }

  /** Mutes/unmutes the engine sound, e.g. from the debug panel. */
  setEngineSoundEnabled(enabled: boolean): void {
    this.engineSound.setEnabled(enabled);
  }

  /** Switches between keyboard input and the autopilot driving the same car, e.g. from the debug panel. */
  setAiDriverEnabled(enabled: boolean): void {
    this.aiDriverEnabled = enabled;
  }

  /** Swaps the active camera controller, e.g. from the debug panel. */
  setCameraType(type: string): void {
    const factory = CAMERA_TYPES[type];
    if (!factory) return;
    this.cameraController = factory();
    this.cameraController.resize(this.canvasWidth, this.canvasHeight);
  }

  /** Rebuilds the track and respawns the player at its start, e.g. from the debug panel. */
  setTrackType(type: string): void {
    const world = buildTrackWorld(type);
    this.trackView.show(world);
    this.spawn = world.spawn;
    this.trackQuery = world.query;
    this.lapTracker = new LapTracker(this.trackQuery);
    this.minimap.setTrack(world.loops);
    this.player.respawn(this.spawn.position, this.spawn.headingRad);
  }

  private readonly handleResize = (): void => {
    this.canvasWidth = window.innerWidth;
    this.canvasHeight = window.innerHeight;
    this.renderer.setSize(this.canvasWidth, this.canvasHeight);
    this.cameraController.resize(this.canvasWidth, this.canvasHeight);
  };

  private readonly tick = (timestamp: number): void => {
    if (!this.running) return;

    const frameDt =
      this.lastTimestamp === null
        ? 0
        : Math.min((timestamp - this.lastTimestamp) / 1000, MAX_FRAME_SECONDS);
    this.lastTimestamp = timestamp;

    // Fixed-step physics: run as many PHYSICS_DT steps as real time has elapsed,
    // decoupled from render cadence.
    this.accumulator += frameDt;
    while (this.accumulator >= PHYSICS_DT) {
      this.stepPhysics(PHYSICS_DT);
      this.accumulator -= PHYSICS_DT;
    }

    // Render the pose interpolated between the last two physics states, so
    // motion is smooth even when the render rate differs from the physics rate.
    const alpha = this.accumulator / PHYSICS_DT;
    this.player.updateRenderPose(alpha);
    this.playerView.sync(this.player);
    this.cameraController.update(this.player.renderPosition);
    this.presentFrame();
    this.renderer.render(this.cameraController.camera);

    requestAnimationFrame(this.tick);
  };

  /** One fixed physics step. Edge-triggered input is consumed here (endFrame) so a press maps to exactly one step even when a render frame runs several. */
  private stepPhysics(dt: number): void {
    if (this.input.wasPressed("r")) {
      this.player.respawn(this.spawn.position, this.spawn.headingRad);
      this.lapTracker.reset();
    }
    const controls = this.aiDriverEnabled
      ? this.aiDriver.computeControls(this.player, this.trackQuery)
      : readControlState(this.input);
    const surface = classifySurface(this.trackQuery.nearestPoint(this.player.position).distance);
    this.lastThrottle = controls.throttle;
    this.player.update(dt, controls, surface);
    this.lapTracker.update(dt, this.player.position);
    this.input.endFrame();
  }

  /** Per-render-frame presentation: HUD, engine audio, and debug telemetry (read the latest physics state; no interpolation needed for readouts). */
  private presentFrame(): void {
    this.hud.update(this.player.speed, this.player.gearLabel, this.player.rpm);
    this.engineSound.update(this.player.rpm, this.lastThrottle, this.player.gear);
    this.minimap.update(this.player.renderPosition, this.player.renderHeading);

    this.telemetry.speedKmh = Math.round(Math.abs(this.player.speed) * 3.6);
    this.telemetry.gear = this.player.gearLabel;
    this.telemetry.rpm = Math.round(this.player.rpm);
    this.telemetry.targetRpm = Math.round(this.player.targetRpm);
    this.telemetry.engineTorque = Math.round(this.player.engineTorque * 100) / 100;
    this.telemetry.gearMultiplier = Math.round(this.player.accelMultiplier * 100) / 100;
    this.telemetry.longAccel = Math.round(this.player.longitudinalAccel * 100) / 100;
    this.telemetry.wheelSteerDeg = Math.round(this.player.wheelSteerDeg);
    this.telemetry.yawRateDeg = Math.round(this.player.yawRateDeg);
    this.telemetry.lateralAccel = Math.round(this.player.lateralAccel * 100) / 100;
    this.telemetry.desiredYawDeg = Math.round(this.player.desiredYawDeg);
    this.telemetry.gripUtilization = Math.round(this.player.gripUtilization * 100) / 100;
    this.telemetry.turnRadius = Math.round(this.player.turnRadiusM);
    this.telemetry.cornerLimit = this.player.steeringLimit;
    this.telemetry.shiftCutMs = Math.round(this.player.shiftTorqueCutRemainingMs);
    this.telemetry.driftAngleDeg = Math.round(this.player.driftAngleDeg * 10) / 10;
    this.telemetry.isDrifting = this.player.isDrifting;

    const surface = this.trackQuery.nearestPoint(this.player.position);
    this.telemetry.lateralOffsetM = Math.round(surface.lateralOffset * 100) / 100;
    this.telemetry.trackCurvature = Math.round(surface.curvature * 1000) / 1000;
    this.telemetry.onRoad = surface.onRoad;
    this.telemetry.surfaceKind = classifySurface(surface.distance).kind;

    const lap = this.lapTracker.state;
    this.telemetry.lapCount = lap.lapCount;
    this.telemetry.currentLapTime = Math.round(lap.currentLapTime * 10) / 10;
    this.telemetry.bestLapTime = lap.bestLapTime === null ? null : Math.round(lap.bestLapTime * 10) / 10;
    this.telemetry.lastLapTime = lap.lastLapTime === null ? null : Math.round(lap.lastLapTime * 10) / 10;
    this.hud.updateLap(lap);
  }
}
