import * as THREE from "three";
import type { Vec3 } from "../../math/vector3.js";
import type { CameraController } from "./CameraController.js";
import { followPlayer } from "./cameraMath.js";
import { cameraSettings } from "./cameraSettings.js";

/**
 * True isometric camera: no perspective foreshortening, so parallel
 * lines stay parallel and scale doesn't change with depth — the
 * classic Zaxxon/Battlezone-style vector-game look.
 */
export class OrthographicCameraController implements CameraController {
  readonly camera: THREE.OrthographicCamera;
  private aspect = 1;

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  }

  update(playerPosition: Vec3): void {
    // Fixed isometric yaw (cameraSettings.yawRad) rather than the car's own
    // heading — see ThirdPersonCameraController for a heading-following chase cam.
    // Reapplied every frame so a debug-panel edit to orthographicViewHeight
    // takes effect immediately without separate change-event wiring.
    this.applyFrustum();
    followPlayer(this.camera, playerPosition);
  }

  resize(width: number, height: number): void {
    this.aspect = width / height;
    this.applyFrustum();
  }

  private applyFrustum(): void {
    const halfHeight = cameraSettings.orthographicViewHeight / 2;
    const halfWidth = halfHeight * this.aspect;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }
}
