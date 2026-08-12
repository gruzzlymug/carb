import * as THREE from "three";
import type { Vec3 } from "../../math/vector3.js";
import type { CameraController } from "./CameraController.js";
import { toThreeVector3 } from "../../graphics/coordinates.js";
import { cameraSettings } from "./cameraSettings.js";

const LOOK_AT_HEIGHT_METERS = 0.8; // aim slightly above the car's base, not flat at the ground

/**
 * Conventional third-person chase camera: sits directly behind the car
 * along its actual heading and rises/turns with it, reusing the same
 * shared debug-panel controls the other cameras use wherever the meaning
 * still fits:
 *   - heightMeters: camera altitude above the car (as elsewhere).
 *   - tiltRad: distance behind the car is derived from height/tilt exactly
 *     like cameraMath.ts's followPlayer (distance = height / tan(tilt)),
 *     so tilt still reads as "how steeply am I looking down" here too.
 *   - perspectiveFovDeg: field of view, same meaning as PerspectiveCameraController.
 * `yawRad` is deliberately NOT applied here — for the isometric/perspective
 * cameras it's a fixed world-space viewing angle (the point of that knob is
 * to NOT follow the car), a different concept from a chase camera's
 * always-directly-behind azimuth, so reusing it would just make the default
 * view point off to one side instead of behind the car.
 * Heading 0 = facing +Y, matching Player's own convention (see
 * playerView.ts), so "forward" here is (sin(heading), cos(heading)).
 */
export class ThirdPersonCameraController implements CameraController {
  readonly camera: THREE.PerspectiveCamera;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(cameraSettings.perspectiveFovDeg, 1, 0.1, 500);
  }

  update(playerPosition: Vec3, playerHeadingRad: number): void {
    // Reapplied every frame so a debug-panel edit takes effect immediately,
    // same pattern as PerspectiveCameraController.
    if (this.camera.fov !== cameraSettings.perspectiveFovDeg) {
      this.camera.fov = cameraSettings.perspectiveFovDeg;
      this.camera.updateProjectionMatrix();
    }

    const { heightMeters, tiltRad } = cameraSettings;
    const distanceBack = heightMeters / Math.tan(tiltRad);
    const forwardX = Math.sin(playerHeadingRad);
    const forwardY = Math.cos(playerHeadingRad);
    const cameraPos: Vec3 = {
      x: playerPosition.x - forwardX * distanceBack,
      y: playerPosition.y - forwardY * distanceBack,
      z: playerPosition.z + heightMeters,
    };
    const lookAt: Vec3 = { x: playerPosition.x, y: playerPosition.y, z: playerPosition.z + LOOK_AT_HEIGHT_METERS };
    this.camera.position.copy(toThreeVector3(cameraPos));
    this.camera.lookAt(toThreeVector3(lookAt));
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
