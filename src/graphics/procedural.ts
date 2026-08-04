import type { Mesh, Face } from "./mesh.js";
import type { Vec3 } from "../math/vector3.js";

/**
 * Appends an axis-aligned box (as 6 quad faces) to shared vertex/face
 * arrays, centered at `center` with the given full width/depth/height.
 * Used as the basic building block for all procedural models.
 */
function addBox(
  vertices: Vec3[],
  faces: Face[],
  center: Vec3,
  size: { w: number; d: number; h: number },
  color: string
): void {
  const hw = size.w / 2;
  const hd = size.d / 2;
  const hh = size.h / 2;
  const base = vertices.length;

  // 8 corners: bottom face then top face, each in (x-, y-)->(x+, y-)->(x+, y+)->(x-, y+) order.
  vertices.push(
    { x: center.x - hw, y: center.y - hd, z: center.z - hh },
    { x: center.x + hw, y: center.y - hd, z: center.z - hh },
    { x: center.x + hw, y: center.y + hd, z: center.z - hh },
    { x: center.x - hw, y: center.y + hd, z: center.z - hh },
    { x: center.x - hw, y: center.y - hd, z: center.z + hh },
    { x: center.x + hw, y: center.y - hd, z: center.z + hh },
    { x: center.x + hw, y: center.y + hd, z: center.z + hh },
    { x: center.x - hw, y: center.y + hd, z: center.z + hh }
  );

  const b0 = base + 0;
  const b1 = base + 1;
  const b2 = base + 2;
  const b3 = base + 3;
  const t0 = base + 4;
  const t1 = base + 5;
  const t2 = base + 6;
  const t3 = base + 7;

  faces.push(
    { indices: [b0, b3, b2, b1], color }, // bottom (reversed so winding faces outward/-Z)
    { indices: [t0, t1, t2, t3], color }, // top
    { indices: [b0, b1, t1, t0], color }, // front (-y)
    { indices: [b2, b3, t3, t2], color }, // back (+y)
    { indices: [b1, b2, t2, t1], color }, // right (+x)
    { indices: [b3, b0, t0, t3], color }  // left (-x)
  );
}

/**
 * Appends a low-poly cylinder (as an N-gon ring of side quads plus two
 * N-gon end caps) to shared vertex/face arrays, with its axis along X
 * and centered at `center`. Used for round wheels.
 */
function addCylinderX(
  vertices: Vec3[],
  faces: Face[],
  center: Vec3,
  radius: number,
  width: number,
  segments: number,
  color: string
): void {
  const halfWidth = width / 2;
  const xLeft = center.x - halfWidth;
  const xRight = center.x + halfWidth;
  const base = vertices.length;

  // Two rings of `segments` points, one at each end of the cylinder.
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const y = center.y + radius * Math.cos(theta);
    const z = center.z + radius * Math.sin(theta);
    vertices.push({ x: xLeft, y, z }, { x: xRight, y, z });
  }
  const leftIndex = (i: number): number => base + (i % segments) * 2;
  const rightIndex = (i: number): number => base + (i % segments) * 2 + 1;

  // Left cap: outward normal -X, so wind in decreasing-angle order.
  const leftCap: number[] = [];
  for (let i = segments - 1; i >= 0; i--) leftCap.push(leftIndex(i));
  faces.push({ indices: leftCap, color });

  // Right cap: outward normal +X, so wind in increasing-angle order.
  const rightCap: number[] = [];
  for (let i = 0; i < segments; i++) rightCap.push(rightIndex(i));
  faces.push({ indices: rightCap, color });

  // Side quads, one per ring segment, wound for outward radial normals.
  for (let i = 0; i < segments; i++) {
    const next = i + 1;
    faces.push({
      indices: [leftIndex(i), leftIndex(next), rightIndex(next), rightIndex(i)],
      color,
    });
  }
}

/** Local-space wheel mount points on the car body, shared with the wheel radius/height. */
export const WHEEL_RADIUS = 0.35;
export const WHEEL_OFFSETS: Vec3[] = [
  { x: -1.0, y: 1.2, z: WHEEL_RADIUS },
  { x: 1.0, y: 1.2, z: WHEEL_RADIUS },
  { x: -1.0, y: -1.2, z: WHEEL_RADIUS },
  { x: 1.0, y: -1.2, z: WHEEL_RADIUS },
];

/** One cross-section of the car body hull, at a given position along its length. */
interface HullRing {
  y: number;
  halfWidth: number;
  zBottom: number;
  zTop: number;
}

/**
 * Builds a low-poly sports-car-style hull: a tapered body lofted through
 * a handful of cross-sections (rear bumper -> cabin -> hood -> nose),
 * approximating a curved silhouette with flat facets rather than a plain
 * box — a low nose, a windshield/rear-window slope, and a cabin roof.
 * Panel color is chosen per facet (body/roof/glass) via `panelColor`.
 */
function addHull(
  vertices: Vec3[],
  faces: Face[],
  rings: HullRing[],
  panelColor: (ringGapIndex: number, side: "top" | "bottom" | "left" | "right") => string
): void {
  const base = vertices.length;
  for (const ring of rings) {
    vertices.push(
      { x: -ring.halfWidth, y: ring.y, z: ring.zBottom }, // 0: bottom-left
      { x: ring.halfWidth, y: ring.y, z: ring.zBottom }, // 1: bottom-right
      { x: ring.halfWidth, y: ring.y, z: ring.zTop }, // 2: top-right
      { x: -ring.halfWidth, y: ring.y, z: ring.zTop } // 3: top-left
    );
  }
  const corner = (ring: number, which: number): number => base + ring * 4 + which;

  for (let i = 0; i < rings.length - 1; i++) {
    faces.push(
      { indices: [corner(i, 3), corner(i, 2), corner(i + 1, 2), corner(i + 1, 3)], color: panelColor(i, "top") },
      { indices: [corner(i, 0), corner(i + 1, 0), corner(i + 1, 1), corner(i, 1)], color: panelColor(i, "bottom") },
      { indices: [corner(i, 0), corner(i, 3), corner(i + 1, 3), corner(i + 1, 0)], color: panelColor(i, "left") },
      { indices: [corner(i, 1), corner(i + 1, 1), corner(i + 1, 2), corner(i, 2)], color: panelColor(i, "right") }
    );
  }

  const rear = 0;
  const nose = rings.length - 1;
  faces.push({ indices: [corner(rear, 0), corner(rear, 1), corner(rear, 2), corner(rear, 3)], color: panelColor(rear, "bottom") });
  faces.push({ indices: [corner(nose, 0), corner(nose, 3), corner(nose, 2), corner(nose, 1)], color: panelColor(nose - 1, "bottom") });
}

/**
 * Builds the car body — a tapered sports-car hull plus glass panels —
 * centered at the local origin, facing +Y (forward), resting on the
 * ground plane (z = 0). Wheels are separate objects (see createWheel)
 * so each can be positioned, and later animated, independently.
 */
export function createCar(): Mesh {
  const vertices: Vec3[] = [];
  const faces: Face[] = [];

  const bodyColor = "#c81e1e";
  const roofColor = "#8f1414";
  const glassColor = "#7fb8d8";

  const rings: HullRing[] = [
    { y: -1.7, halfWidth: 0.75, zBottom: 0.15, zTop: 0.5 }, // rear bumper
    { y: -0.6, halfWidth: 0.85, zBottom: 0.12, zTop: 1.05 }, // cabin back
    { y: 0.5, halfWidth: 0.85, zBottom: 0.12, zTop: 1.05 }, // cabin front
    { y: 1.1, halfWidth: 0.8, zBottom: 0.12, zTop: 0.55 }, // hood base
    { y: 1.6, halfWidth: 0.7, zBottom: 0.15, zTop: 0.45 }, // hood front
    { y: 1.9, halfWidth: 0.5, zBottom: 0.2, zTop: 0.35 }, // nose
  ];

  // Gap 0 (rear bumper -> cabin back) = rear window slope.
  // Gap 1 (cabin back -> cabin front) = roof, with glass side windows.
  // Gap 2 (cabin front -> hood base) = windshield slope.
  // Gaps 3-4 (hood -> nose) = plain bodywork.
  addHull(vertices, faces, rings, (gap, side) => {
    if ((gap === 0 || gap === 2) && side === "top") return glassColor;
    if (gap === 1 && side === "top") return roofColor;
    if (gap === 1 && (side === "left" || side === "right")) return glassColor;
    return bodyColor;
  });

  return { vertices, faces };
}

/**
 * Builds a single round wheel, centered at the local origin with its
 * axle along X, resting on the ground plane (bottom touches z = 0).
 * A shared instance is positioned once per mount point in WHEEL_OFFSETS.
 */
export function createWheel(): Mesh {
  const vertices: Vec3[] = [];
  const faces: Face[] = [];
  const tireColor = "#1a1a1a";
  const width = 0.32;
  const segments = 8;

  addCylinderX(vertices, faces, { x: 0, y: 0, z: 0 }, WHEEL_RADIUS, width, segments, tireColor);

  return { vertices, faces };
}

/**
 * Builds a gas station assembly: building, cashier stand, fuel pumps,
 * and a roadside sign. Centered at the local origin; the caller
 * positions and mirrors it to either side of the road.
 */
export function createGasStation(): Mesh {
  const vertices: Vec3[] = [];
  const faces: Face[] = [];

  const buildingColor = "#d8d0c0";
  const roofColor = "#8a3a3a";
  const cashierColor = "#c8c0b0";
  const pumpColor = "#3060a0";
  const signPoleColor = "#909090";
  const signBoardColor = "#e0d030";

  // Main building
  addBox(vertices, faces, { x: 0, y: 0, z: 1.5 }, { w: 6, d: 5, h: 3 }, buildingColor);
  // Flat roof cap
  addBox(vertices, faces, { x: 0, y: 0, z: 3.15 }, { w: 6.4, d: 5.4, h: 0.3 }, roofColor);

  // Cashier stand, in front of the building
  addBox(vertices, faces, { x: -3.5, y: -5, z: 0.6 }, { w: 1.5, d: 1.5, h: 1.2 }, cashierColor);

  // Fuel pumps in a row
  const pumpCount = 3;
  const pumpSpacing = 2.5;
  const pumpStartX = -((pumpCount - 1) * pumpSpacing) / 2;
  for (let i = 0; i < pumpCount; i++) {
    const px = pumpStartX + i * pumpSpacing;
    addBox(vertices, faces, { x: px, y: -8, z: 0.6 }, { w: 0.6, d: 0.6, h: 1.2 }, pumpColor);
  }

  // Roadside sign: pole + board
  addBox(vertices, faces, { x: 5, y: -6, z: 2 }, { w: 0.2, d: 0.2, h: 4 }, signPoleColor);
  addBox(vertices, faces, { x: 5, y: -6, z: 4.2 }, { w: 1.8, d: 0.3, h: 0.8 }, signBoardColor);

  return { vertices, faces };
}
