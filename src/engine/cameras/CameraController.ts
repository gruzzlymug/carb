import type * as THREE from "three";
import type { Vec3 } from "../../math/vector3.js";

/**
 * A pluggable camera strategy: owns a THREE.Camera and knows how to
 * follow the player. New camera types (chase, top-down, free-fly, ...)
 * just implement this and register in cameras/index.ts.
 */
export interface CameraController {
  readonly camera: THREE.Camera;
  /** Called once per frame with the player's current world position. */
  update(playerPosition: Vec3): void;
  /** Called on creation and whenever the canvas resizes. */
  resize(width: number, height: number): void;
}
