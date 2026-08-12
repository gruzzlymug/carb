import * as THREE from "three";
import type { Vec3 } from "../../math/vector3.js";
import type { CameraController } from "./CameraController.js";
import type { SampledLoop } from "../../world/trackSpline.js";
import { toThreeVector3 } from "../../graphics/coordinates.js";

const MARGIN_METERS = 20; // padding around the track's bounding box
const HEIGHT_METERS = 200; // camera altitude; only needs to clear scenery, doesn't affect the orthographic frustum size

/**
 * Straight-down orthographic view sized to fit the *entire* track's
 * bounding box at once (computed from the active track's centerline
 * samples, see setTrackBounds) — deliberately doesn't follow the player
 * the way every other camera does; the point is to always see the whole
 * layout, not to track the car.
 */
export class TopDownCameraController implements CameraController {
  readonly camera: THREE.OrthographicCamera;
  private aspect = 1;
  private trackHalfWidth = 50;
  private trackHalfHeight = 50;
  private centerX = 0;
  private centerY = 0;

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    // Three space up=(0,0,1) is world +Y (forward) -- keeps the track's
    // "forward" direction toward the top of the screen, north-up map style.
    this.camera.up.set(0, 0, 1);
    this.applyFrustum();
    this.positionCamera();
  }

  /** Recomputes the fixed view to fit every loop's full extent. Call whenever the active track changes. */
  setTrackBounds(loops: readonly SampledLoop[]): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const loop of loops) {
      for (const sample of loop.samples) {
        minX = Math.min(minX, sample.center.x);
        maxX = Math.max(maxX, sample.center.x);
        minY = Math.min(minY, sample.center.y);
        maxY = Math.max(maxY, sample.center.y);
      }
    }
    if (!Number.isFinite(minX)) return; // no samples -- keep the previous bounds
    this.centerX = (minX + maxX) / 2;
    this.centerY = (minY + maxY) / 2;
    this.trackHalfWidth = (maxX - minX) / 2 + MARGIN_METERS;
    this.trackHalfHeight = (maxY - minY) / 2 + MARGIN_METERS;
    this.applyFrustum();
    this.positionCamera();
  }

  update(): void {
    // Intentionally ignores playerPosition -- fixed view of the whole track.
  }

  resize(width: number, height: number): void {
    this.aspect = width / height;
    this.applyFrustum();
  }

  /** Fits both the track's own extent and the canvas's aspect ratio, so nothing is ever cropped regardless of window shape (letterboxing the shorter axis instead). */
  private applyFrustum(): void {
    const halfWidth = Math.max(this.trackHalfWidth, this.trackHalfHeight * this.aspect);
    const halfHeight = Math.max(this.trackHalfHeight, this.trackHalfWidth / this.aspect);
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  private positionCamera(): void {
    const above: Vec3 = { x: this.centerX, y: this.centerY, z: HEIGHT_METERS };
    const center: Vec3 = { x: this.centerX, y: this.centerY, z: 0 };
    this.camera.position.copy(toThreeVector3(above));
    this.camera.lookAt(toThreeVector3(center));
  }
}
