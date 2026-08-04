import * as THREE from "three";
import type { TrackWorld } from "../world/trackWorld.js";
import { GasStation } from "../entities/gasStation.js";
import { createMeshObject } from "../graphics/toThreeGeometry.js";

/**
 * Builds and holds the Three.js objects for one TrackWorld. Tracks are
 * finite and static, so everything is built and added to the scene
 * once — no per-frame streaming, unlike the old endless-chunk system.
 * show() replaces the current track (used when the debug panel switches
 * track type), disposing the outgoing track's road/ground GPU geometry
 * — those are unique per track build, unlike the shared gas-station
 * geometry (reused across every instance, so left alone here).
 */
export class TrackView {
  private group: THREE.Group | null = null;
  private roadObject: THREE.Mesh | null = null;
  private groundObject: THREE.Mesh | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  show(world: TrackWorld): void {
    this.dispose();

    const group = new THREE.Group();
    this.groundObject = createMeshObject(world.groundMesh);
    this.roadObject = createMeshObject(world.roadMesh);
    group.add(this.groundObject, this.roadObject);

    for (const station of world.gasStations) {
      group.add(new GasStation(station.position, station.headingRad).object3D);
    }

    this.scene.add(group);
    this.group = group;
  }

  dispose(): void {
    if (!this.group) return;
    this.scene.remove(this.group);
    this.roadObject?.geometry.dispose();
    this.groundObject?.geometry.dispose();
    this.group = null;
    this.roadObject = null;
    this.groundObject = null;
  }
}
