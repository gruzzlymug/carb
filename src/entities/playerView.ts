import * as THREE from "three";
import type { Player } from "./player.js";
import { createCar, createWheel, WHEEL_OFFSETS, WHEEL_RADIUS } from "../graphics/procedural.js";
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
 * Each wheel is a small hierarchy, not a single object: a "steer pivot"
 * Group at the fixed mount point (added as a child of object3D, so it
 * translates/yaws with the car body for free), containing the actual wheel
 * Mesh, which spins independently — steering yaws the pivot, rolling spins
 * the mesh inside it, so the two rotations don't fight each other the way
 * they would stacked on one Object3D's Euler angles.
 */
export class PlayerView {
  readonly object3D = new THREE.Group();
  private readonly wheels: THREE.Mesh[] = []; // all 4, spun by road speed
  private readonly frontWheelPivots: THREE.Group[] = []; // steerable front wheels only (rears stay fixed)
  private rollAngle = 0; // radians, accumulated wheel rotation about the axle (local X)

  constructor() {
    this.object3D.add(createMeshObject(CAR_BODY_MESH));

    for (const offset of WHEEL_OFFSETS) {
      const pivot = new THREE.Group();
      pivot.position.copy(toThreeVector3(offset));
      const wheel = createMeshObject(WHEEL_MESH);
      pivot.add(wheel);
      this.object3D.add(pivot);
      this.wheels.push(wheel);
      // Front wheels sit ahead of the car's center (+Y forward); keep refs so
      // sync() can yaw their pivot with the steering. Rears stay fixed.
      if (offset.y > 0) this.frontWheelPivots.push(pivot);
    }
  }

  /**
   * Applies `player`'s current interpolated pose to the scene graph. Call
   * once per render frame, after `player.updateRenderPose(alpha)`.
   * `dt` (real seconds since the last render frame) drives the wheel roll —
   * a purely visual integration against the car's actual current speed, not
   * tied to the fixed physics step, since it only needs to look right.
   */
  sync(player: Player, dt: number): void {
    this.object3D.position.copy(toThreeVector3(player.renderPosition));
    // Our world's Y (forward) maps to Three's Z, and our heading convention
    // (0 = facing +Y, positive = turning toward +X) matches THREE's rotation.y
    // directly once that axis remap is applied — no sign flip.
    this.object3D.rotation.y = player.renderHeading;
    for (const pivot of this.frontWheelPivots) pivot.rotation.y = player.renderWheelSteer;

    // Rolling: angular speed = linear speed / radius. Positive rotation.x
    // moves the top of the wheel toward +Z (forward) in Three's frame here,
    // which is the correct sense for forward rolling given the axis remap
    // above and how the wheel mesh's cross-section is wound (see
    // graphics/procedural.ts's addCylinderX/addMagWheelFace).
    this.rollAngle = (this.rollAngle + (player.speed / WHEEL_RADIUS) * dt) % (Math.PI * 2);
    for (const wheel of this.wheels) wheel.rotation.x = this.rollAngle;
  }
}
