import * as THREE from "three";
import type { Vec3 } from "../math/vector3.js";

/**
 * Our world uses Z as up (X = horizontal, Y = forward along the road,
 * Z = height); Three.js conventionally uses Y as up. This is the single
 * place that axis remap happens, so mesh geometry, entity positions,
 * and camera placement all stay consistent with each other.
 */
export function toThreeVector3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.z, v.y);
}
