import * as THREE from "three";
import type { Vec3 } from "../math/vector3.js";
import { createGasStation } from "../graphics/procedural.js";
import { createMeshObject } from "../graphics/toThreeGeometry.js";
import { toThreeVector3 } from "../graphics/coordinates.js";

const GAS_STATION_MESH = createGasStation();

/** A static roadside gas station assembly: positioned and oriented once, never updated. */
export class GasStation {
  readonly object3D: THREE.Object3D;

  constructor(position: Vec3, headingRad = 0) {
    this.object3D = createMeshObject(GAS_STATION_MESH);
    this.object3D.position.copy(toThreeVector3(position));
    this.object3D.rotation.y = headingRad;
  }
}
