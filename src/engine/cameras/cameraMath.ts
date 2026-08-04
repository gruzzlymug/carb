import type * as THREE from "three";
import type { Vec3 } from "../../math/vector3.js";
import { toThreeVector3 } from "../../graphics/coordinates.js";
import { cameraSettings } from "./cameraSettings.js";

/**
 * Positions and orients `camera` to sit behind/above `playerPosition`
 * and look at it, using the shared height/tilt/yaw settings. Distance
 * behind the player is derived from height/tilt (distance = height /
 * tan(tilt)) rather than set independently, and lookAt handles aiming
 * — so any height/tilt combination is always framed correctly, with no
 * separate "keep this constant in sync with that one" bookkeeping.
 * Shared by every CameraController so they all follow identically.
 */
export function followPlayer(camera: THREE.Camera, playerPosition: Vec3): void {
  const { heightMeters, tiltRad, yawRad } = cameraSettings;
  const distanceBack = heightMeters / Math.tan(tiltRad);
  const backOffsetX = Math.sin(yawRad) * distanceBack;
  const backOffsetY = Math.cos(yawRad) * distanceBack;

  const worldOffset: Vec3 = {
    x: playerPosition.x - backOffsetX,
    y: playerPosition.y - backOffsetY,
    z: playerPosition.z + heightMeters,
  };
  camera.position.copy(toThreeVector3(worldOffset));
  camera.lookAt(toThreeVector3(playerPosition));
}
