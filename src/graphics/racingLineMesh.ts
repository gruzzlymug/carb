import type { Mesh, Face } from "./mesh.js";
import type { Vec3 } from "../math/vector3.js";
import { perpendicular } from "../math/vector3.js";
import type { RacingLine } from "../world/racingLine.js";
import type { SpeedProfile } from "../world/speedProfile.js";

const RACING_LINE_WIDTH = 0.4; // meters -- a thin ribbon, distinct from the road surface, not a lane
const RACING_LINE_Z = 0.02; // above lane markings/kerbs so it doesn't z-fight
const FLAT_COLOR = "#ff00ff"; // used when no SpeedProfile is given (Gate A: geometry-only inspection)

function offsetPoint(center: Vec3, perp: Vec3, distance: number, z: number): Vec3 {
  return { x: center.x + perp.x * distance, y: center.y + perp.y * distance, z };
}

/** Red (slow) -> green (fast), linearly across [minSpeed, maxSpeed]. */
function speedToColor(speed: number, minSpeed: number, maxSpeed: number): string {
  const t = maxSpeed > minSpeed ? Math.max(0, Math.min(1, (speed - minSpeed) / (maxSpeed - minSpeed))) : 0.5;
  const r = Math.round(255 * (1 - t));
  const g = Math.round(255 * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}00`;
}

/**
 * Thin debug ribbon along a RacingLine, colored by a paired SpeedProfile
 * (red = slow/braking, green = fast) when given, or a flat color if not
 * (Gate A: inspect the line's geometry before the speed profile exists).
 * Mirrors trackMesh.ts's ribbon-building pattern (offset quads between
 * consecutive samples).
 */
export function createRacingLineMesh(line: RacingLine, speedProfile?: SpeedProfile): Mesh {
  const vertices: Vec3[] = [];
  const faces: Face[] = [];
  const halfWidth = RACING_LINE_WIDTH / 2;
  const n = line.points.length;

  const speeds = speedProfile?.points.map((p) => p.targetSpeed);
  const minSpeed = speeds && speeds.length > 0 ? Math.min(...speeds) : 0;
  const maxSpeed = speeds && speeds.length > 0 ? Math.max(...speeds) : 0;

  for (const point of line.points) {
    const perp = perpendicular(point.tangent);
    vertices.push(offsetPoint(point.position, perp, halfWidth, RACING_LINE_Z));
    vertices.push(offsetPoint(point.position, perp, -halfWidth, RACING_LINE_Z));
  }

  // RacingLine is always generated for a closed loop (see racingLine.ts).
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const leftA = i * 2;
    const rightA = i * 2 + 1;
    const leftB = next * 2;
    const rightB = next * 2 + 1;
    const color = speeds ? speedToColor(speeds[i], minSpeed, maxSpeed) : FLAT_COLOR;
    faces.push({ indices: [leftA, rightA, rightB, leftB], color });
  }

  return { vertices, faces };
}
