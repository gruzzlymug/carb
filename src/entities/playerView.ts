import * as THREE from "three";
import type { Player } from "./player.js";
import { createCar, createWheel, WHEEL_OFFSETS } from "../graphics/procedural.js";
import { createMeshObject } from "../graphics/toThreeGeometry.js";
import { toThreeVector3 } from "../graphics/coordinates.js";

const CAR_BODY_MESH = createCar();
const WHEEL_MESH = createWheel();

/**
 * Three.js presentation for a Player's vehicle state — owns the meshes and
 * reads the vehicle's interpolated pose (renderPosition/renderHeading/
 * renderWheelSteer, refreshed once per render frame by
 * `Player.updateRenderPose`) to draw it. No physics or vehicle state of its
 * own; `Player` never touches this or any other scene graph, so it can be
 * constructed and driven headless independent of rendering.
 *
 * Wheels are separate objects (their own mesh, their own Object3D) but are
 * added as children of object3D at fixed local offsets, so the scene graph
 * handles rotating/translating them with the car body for free — no manual
 * per-wheel offset rotation needed.
 */
export class PlayerView {
  readonly object3D = new THREE.Group();
  private readonly frontWheels: THREE.Mesh[] = []; // steerable front wheels (rear wheels stay fixed)

  constructor() {
    this.object3D.add(createMeshObject(CAR_BODY_MESH));

    for (const offset of WHEEL_OFFSETS) {
      const wheel = createMeshObject(WHEEL_MESH);
      wheel.position.copy(toThreeVector3(offset));
      this.object3D.add(wheel);
      // Front wheels sit ahead of the car's center (+Y forward); keep refs so
      // sync() can yaw them with the steering. Rears stay fixed.
      if (offset.y > 0) this.frontWheels.push(wheel);
    }
  }

  /** Applies `player`'s current interpolated pose to the scene graph. Call once per render frame, after `player.updateRenderPose(alpha)`. */
  sync(player: Player): void {
    this.object3D.position.copy(toThreeVector3(player.renderPosition));
    // Our world's Y (forward) maps to Three's Z, and our heading convention
    // (0 = facing +Y, positive = turning toward +X) matches THREE's rotation.y
    // directly once that axis remap is applied — no sign flip.
    this.object3D.rotation.y = player.renderHeading;
    for (const wheel of this.frontWheels) wheel.rotation.y = player.renderWheelSteer;
  }
}
