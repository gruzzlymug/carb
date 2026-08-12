import * as THREE from "three";
import type { RacingLine } from "../world/racingLine.js";
import type { SpeedProfile } from "../world/speedProfile.js";
import { createRacingLineMesh } from "../graphics/racingLineMesh.js";
import { createMeshObject } from "../graphics/toThreeGeometry.js";

/**
 * Debug-only visualization of a track's precomputed RacingLine/SpeedProfile
 * — mirrors TrackView's build-once/dispose-on-replace pattern. Hidden by
 * default; toggled from the debug panel (see debugPanel.ts).
 */
export class RacingLineView {
  private object: THREE.Mesh | null = null;
  private visible = false;

  constructor(private readonly scene: THREE.Scene) {}

  show(line: RacingLine, speedProfile?: SpeedProfile): void {
    this.dispose();
    const mesh = createRacingLineMesh(line, speedProfile);
    this.object = createMeshObject(mesh);
    this.object.visible = this.visible;
    this.scene.add(this.object);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.object) this.object.visible = visible;
  }

  dispose(): void {
    if (!this.object) return;
    this.scene.remove(this.object);
    this.object.geometry.dispose();
    this.object = null;
  }
}
