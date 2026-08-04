import { Input } from "./input.js";
import { Renderer } from "./renderer.js";
import { TrackView } from "./trackView.js";
import { Hud } from "./hud.js";
import { EngineSound } from "./engineSound.js";
import { CAMERA_TYPES, DEFAULT_CAMERA_TYPE, type CameraController } from "./cameras/index.js";
import { Player } from "../entities/player.js";
import { buildTrackWorld, type TrackWorld } from "../world/trackWorld.js";
import { DEFAULT_TRACK_TYPE } from "../world/trackDefinitions.js";

/** Delta time is clamped so a stalled tab doesn't cause a huge physics jump on resume. */
const MAX_DELTA_SECONDS = 1 / 15;

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
  accelMultiplier: number;
}

export class Game {
  /** Kept up to date each frame; the debug panel binds directly to this via lil-gui's .listen(). */
  readonly telemetry: Telemetry = { speedKmh: 0, gear: "1", rpm: 0, targetRpm: 0, accelMultiplier: 0 };

  private readonly input = new Input();
  private readonly renderer: Renderer;
  private readonly trackView: TrackView;
  private readonly player = new Player();
  private readonly hud = new Hud();
  private readonly engineSound = new EngineSound();
  private cameraController: CameraController;
  private lastTimestamp: number | null = null;
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

    const dt =
      this.lastTimestamp === null
        ? 0
        : Math.min((timestamp - this.lastTimestamp) / 1000, MAX_DELTA_SECONDS);
    this.lastTimestamp = timestamp;

    this.update(dt);
    this.renderer.render(this.cameraController.camera);

    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    if (this.input.wasPressed("r")) {
      this.player.respawn(this.spawn.position, this.spawn.headingRad);
    }
    this.player.update(dt, this.input);
    this.cameraController.update(this.player.position);
    this.hud.update(this.player.speed, this.player.gearLabel, this.player.rpm);
    this.engineSound.update(this.player.rpm, this.input.isHeld("w"));

    this.telemetry.speedKmh = Math.round(Math.abs(this.player.speed) * 3.6);
    this.telemetry.gear = this.player.gearLabel;
    this.telemetry.rpm = Math.round(this.player.rpm);
    this.telemetry.targetRpm = Math.round(this.player.targetRpm);
    this.telemetry.accelMultiplier = Math.round(this.player.accelMultiplier * 100) / 100;

    this.input.endFrame();
  }
}
