import type { CameraController } from "./CameraController.js";
import { OrthographicCameraController } from "./OrthographicCameraController.js";
import { PerspectiveCameraController } from "./PerspectiveCameraController.js";
import { TopDownCameraController } from "./TopDownCameraController.js";
import { ThirdPersonCameraController } from "./ThirdPersonCameraController.js";

export type { CameraController };
export { cameraSettings } from "./cameraSettings.js";

/**
 * Registry of available camera types, keyed by a stable name the debug
 * panel (and anything else) can use to switch cameras at runtime. Add a
 * new camera by implementing CameraController and registering it here.
 */
export const CAMERA_TYPES: Record<string, () => CameraController> = {
  orthographic: () => new OrthographicCameraController(),
  perspective: () => new PerspectiveCameraController(),
  topDown: () => new TopDownCameraController(),
  thirdPerson: () => new ThirdPersonCameraController(),
};

export const DEFAULT_CAMERA_TYPE = "topDown";
