import * as THREE from "three";
import type { Vec3 } from "../../math/vector3.js";
import type { CameraController } from "./CameraController.js";
import { followPlayer } from "./cameraMath.js";
import { cameraSettings } from "./cameraSettings.js";

/**
 * A conventional perspective chase camera, using the same follow
 * offset (height/tilt/yaw) as OrthographicCameraController. Exists
 * mainly to prove the camera system is easy to extend — swapping
 * projections is a self-contained class, not a renderer-wide change.
 */
export class PerspectiveCameraController implements CameraController {
  readonly camera: THREE.PerspectiveCamera;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(cameraSettings.perspectiveFovDeg, 1, 0.1, 500);
  }

  update(playerPosition: Vec3): void {
    // Reapplied every frame so a debug-panel edit to perspectiveFovDeg
    // takes effect immediately without separate change-event wiring.
    if (this.camera.fov !== cameraSettings.perspectiveFovDeg) {
      this.camera.fov = cameraSettings.perspectiveFovDeg;
      this.camera.updateProjectionMatrix();
    }
    followPlayer(this.camera, playerPosition);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
