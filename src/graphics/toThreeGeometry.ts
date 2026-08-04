import * as THREE from "three";
import type { Mesh } from "./mesh.js";
import { toThreeVector3 } from "./coordinates.js";

/**
 * Converts our immutable Mesh (arbitrary convex N-gon faces, one flat
 * color per face) into a non-indexed THREE.BufferGeometry with a color
 * per vertex. Faces are fan-triangulated (valid since every face our
 * procedural builders generate is convex); giving each resulting
 * triangle's vertices its face's color reproduces flat shading without
 * per-face materials. Vertex normals are computed (one flat normal per
 * triangle, since vertices aren't shared across triangles) so the mesh
 * is ready for lighting if that's added later, even though the current
 * unlit material doesn't use them.
 */
export function toThreeGeometry(mesh: Mesh): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();

  for (const face of mesh.faces) {
    color.set(face.color);
    // Fan triangulation from vertex 0. Indices i and i+1 are swapped
    // (rather than kept in face-authoring order) because toThreeVector3's
    // axis remap (our Z-up -> Three's Y-up, swapping Y and Z) is a
    // reflection: it flips handedness, which would otherwise silently
    // reverse every face's winding and break backface culling.
    for (let i = 1; i < face.indices.length - 1; i++) {
      const triangle = [face.indices[0], face.indices[i + 1], face.indices[i]];
      for (const index of triangle) {
        const v = toThreeVector3(mesh.vertices[index]);
        positions.push(v.x, v.y, v.z);
        colors.push(color.r, color.g, color.b);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Flat, unlit, per-vertex-colored material — matches the spec's "no
// textures, no lighting, no shadows" flat-shaded vector look. Safe to
// share across every mesh instance: all per-object color data lives in
// each geometry's vertex color attribute, not on the material.
const FLAT_VERTEX_COLOR_MATERIAL = new THREE.MeshBasicMaterial({ vertexColors: true });

// Our procedural meshes are immutable and heavily reused (e.g. one road
// segment mesh instanced 20+ times per chunk), so cache the converted
// BufferGeometry per Mesh reference rather than re-triangulating it on
// every instantiation. WeakMap so unreferenced meshes can still be GC'd.
const geometryCache = new WeakMap<Mesh, THREE.BufferGeometry>();

/**
 * Builds a renderable THREE.Mesh from one of our procedural Meshes.
 * Multiple calls with the same Mesh reference share one cached
 * BufferGeometry (and the shared material) — only their transform
 * differs, so this is cheap to call once per placed instance.
 */
export function createMeshObject(mesh: Mesh): THREE.Mesh {
  let geometry = geometryCache.get(mesh);
  if (!geometry) {
    geometry = toThreeGeometry(mesh);
    geometryCache.set(mesh, geometry);
  }
  return new THREE.Mesh(geometry, FLAT_VERTEX_COLOR_MATERIAL);
}
