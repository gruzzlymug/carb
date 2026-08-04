import type { Vec3 } from "../math/vector3.js";

/** A single flat-shaded polygon, referencing vertices by index into a Mesh. */
export interface Face {
  indices: number[];
  color: string;
}

/**
 * Immutable procedural geometry: a set of vertices in local model space
 * plus the faces (polygons) that connect them. No UVs, no normals —
 * shading is a flat color per face.
 */
export interface Mesh {
  vertices: Vec3[];
  faces: Face[];
}
