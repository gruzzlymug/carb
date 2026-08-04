import { Input } from "./input.js";
import { Renderer } from "./renderer.js";
import { TrackView } from "./trackView.js";
import { Hud } from "./hud.js";
import { EngineSound } from "./engineSound.js";
import { CAMERA_TYPES, DEFAULT_CAMERA_TYPE, type CameraController } from "./cameras/index.js";
import { Player } from "../entities/player.js";
import { buildTrackWorld, type TrackWorld } from "../world/trackWorld.js";
import { DEFAULT_TRACK_TYPE } from "../world/trackDefinitions.js";
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
  turnRadius: number; // current turn radius, meters (0 when straight)
  cornerLimit: string; // "grip" / "steering" / "none" — what's limiting cornering
  shiftCutMs: number; // ms remaining in the post-upshift torque cut (0 when inactive)
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
    turnRadius: 0,
    cornerLimit: "none",
    shiftCutMs: 0,
  };

  private readonly input = new Input();
  private readonly renderer: Renderer;
  private readonly trackView: TrackView;
  private readonly player = new Player();
  private readonly hud = new Hud();
  private readonly engineSound = new EngineSound();
  private cameraController: CameraController;
  private lastTimestamp: number | null = null;
  private accumulator = 0; // unspent real time carried between frames, fed to fixed-step physics
  private running = false;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private spawn: TrackWorld["spawn"] = { position: { x: 0, y: 0, z: 0 }, headingRad: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.trackView = new TrackView(this.renderer.scene);
    this.renderer.scene.add(this.player.object3D);

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
    this.player.syncVisuals(alpha);
    this.cameraController.update(this.player.renderPosition);
    this.presentFrame();
    this.renderer.render(this.cameraController.camera);

    requestAnimationFrame(this.tick);
  };

  /** One fixed physics step. Edge-triggered input is consumed here (endFrame) so a press maps to exactly one step even when a render frame runs several. */
  private stepPhysics(dt: number): void {
    if (this.input.wasPressed("r")) {
      this.player.respawn(this.spawn.position, this.spawn.headingRad);
    }
    this.player.update(dt, this.input);
    this.input.endFrame();
  }

  /** Per-render-frame presentation: HUD, engine audio, and debug telemetry (read the latest physics state; no interpolation needed for readouts). */
  private presentFrame(): void {
    this.hud.update(this.player.speed, this.player.gearLabel, this.player.rpm);
    this.engineSound.update(this.player.rpm, this.input.isHeld("w"));

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
    this.telemetry.turnRadius = Math.round(this.player.turnRadiusM);
    this.telemetry.cornerLimit = this.player.steeringLimit;
    this.telemetry.shiftCutMs = Math.round(this.player.shiftTorqueCutRemainingMs);
  }
}
