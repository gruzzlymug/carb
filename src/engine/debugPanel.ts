import GUI from "lil-gui";
import { CAMERA_TYPES, DEFAULT_CAMERA_TYPE, cameraSettings } from "./cameras/index.js";
import { TRACK_GENERATORS, DEFAULT_TRACK_TYPE } from "../world/trackDefinitions.js";
import { transmissionSettings } from "../util/transmissionSettings.js";
import type { ControlsOverlay } from "./controlsOverlay.js";
import type { Game } from "./game.js";

/**
 * Debug panel (lil-gui): lets you switch the active camera type and
 * live-tweak its shared height/tilt/yaw settings, switch between
 * tracks, switch transmission mode, toggle the controls overlay, mute
 * engine sound, and watch live speed/gear/RPM telemetry for tuning.
 * Kept generic so more debug controls can be added later.
 */
export function createDebugPanel(game: Game, controlsOverlay: ControlsOverlay): GUI {
  const gui = new GUI({ title: "Debug" });

  const telemetryFolder = gui.addFolder("Telemetry");
  telemetryFolder.add(game.telemetry, "speedKmh").name("Speed (km/h)").listen().disable();
  telemetryFolder.add(game.telemetry, "gear").name("Gear").listen().disable();
  telemetryFolder.add(game.telemetry, "rpm").name("RPM (display)").listen().disable();
  telemetryFolder.add(game.telemetry, "targetRpm").name("Drivetrain RPM").listen().disable();
  telemetryFolder.add(game.telemetry, "engineTorque").name("Engine Torque (0-1)").listen().disable();
  telemetryFolder.add(game.telemetry, "gearMultiplier").name("Gear Multiplier").listen().disable();
  telemetryFolder.add(game.telemetry, "longAccel").name("Accel (m/s²)").listen().disable();
  telemetryFolder.add(game.telemetry, "wheelSteerDeg").name("Wheel Steer (°)").listen().disable();
  telemetryFolder.add(game.telemetry, "yawRateDeg").name("Yaw Rate (°/s)").listen().disable();
  telemetryFolder.add(game.telemetry, "lateralAccel").name("Lateral Accel (m/s²)").listen().disable();
  telemetryFolder.add(game.telemetry, "turnRadius").name("Turn Radius (m)").listen().disable();
  telemetryFolder.add(game.telemetry, "cornerLimit").name("Corner Limit").listen().disable();
  telemetryFolder.add(game.telemetry, "shiftCutMs").name("Shift cut (ms)").listen().disable();
  telemetryFolder.open();

  const controlsFolder = gui.addFolder("Controls");
  controlsFolder
    .add(transmissionSettings, "mode", { Automatic: "automatic", Manual: "manual" })
    .name("Transmission");
  const displayState = { showOverlay: true, engineSound: true };
  controlsFolder
    .add(displayState, "showOverlay")
    .name("Show Controls")
    .onChange((visible: boolean) => controlsOverlay.setVisible(visible));
  controlsFolder
    .add(displayState, "engineSound")
    .name("Engine Sound")
    .onChange((enabled: boolean) => game.setEngineSoundEnabled(enabled));
  controlsFolder.open();

  const trackFolder = gui.addFolder("Track");
  const trackState = { type: DEFAULT_TRACK_TYPE };
  // Options as {label: key}: each generator's own .name is the label, so
  // the dropdown stays in sync with trackDefinitions.ts automatically.
  const trackOptions = Object.fromEntries(
    Object.entries(TRACK_GENERATORS).map(([key, generator]) => [generator().name, key])
  );
  trackFolder
    .add(trackState, "type", trackOptions)
    .name("Track")
    .onChange((type: string) => game.setTrackType(type));
  trackFolder.open();

  const cameraFolder = gui.addFolder("Camera");
  const cameraState = { type: DEFAULT_CAMERA_TYPE };
  cameraFolder
    .add(cameraState, "type", Object.keys(CAMERA_TYPES))
    .name("Type")
    .onChange((type: string) => game.setCameraType(type));

  cameraFolder.add(cameraSettings, "heightMeters", 2, 80, 1).name("Height (m)");
  cameraFolder.add(cameraSettings, "tiltRad", 0.1, 1.5, 0.01).name("Tilt (rad)");
  cameraFolder.add(cameraSettings, "yawRad", -Math.PI, Math.PI, 0.01).name("Yaw (rad)");
  cameraFolder.add(cameraSettings, "orthographicViewHeight", 4, 100, 1).name("Ortho view height");
  cameraFolder.add(cameraSettings, "perspectiveFovDeg", 10, 120, 1).name("Perspective FOV");
  cameraFolder.open();

  return gui;
}
