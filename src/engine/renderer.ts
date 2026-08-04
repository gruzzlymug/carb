import * as THREE from "three";

/**
 * Thin wrapper around THREE.WebGLRenderer: owns the canvas renderer and
 * the persistent Scene. Unlike the old Canvas2D painter's-algorithm
 * renderer, this is retained-mode — callers (world/entities) add and
 * remove THREE.Object3D instances to `scene` as game state changes,
 * rather than resubmitting geometry every frame. The GPU handles depth
 * sorting (a real depth buffer) and backface culling (native, driven by
 * each mesh's winding order) — no hand-rolled equivalents needed here.
 */
export class Renderer {
  readonly scene = new THREE.Scene();
  private readonly webglRenderer: THREE.WebGLRenderer;

  constructor(canvas: HTMLCanvasElement) {
    this.webglRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.webglRenderer.setPixelRatio(window.devicePixelRatio || 1);
  }

  setSize(width: number, height: number): void {
    // updateStyle defaults to true: sets the canvas's CSS display size to
    // width/height, independent of the internal framebuffer resolution
    // (which setPixelRatio scales up for sharper rendering on high-DPI
    // displays) — without it the canvas would render at the raw,
    // DPI-multiplied pixel size and overflow the viewport.
    this.webglRenderer.setSize(width, height);
  }

  render(camera: THREE.Camera): void {
    this.webglRenderer.render(this.scene, camera);
  }
}
