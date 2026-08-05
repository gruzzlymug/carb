import { ROAD_WIDTH } from "../util/constants.js";

export type SurfaceKind = "road" | "shoulder" | "offRoad";

/**
 * The grip/drag effect of the surface the car is currently on — multiplies
 * TIRE_GRIP (cornering) and FRICTION/BRAKE_FORCE (drag) in Player.update.
 * The multiplier values here are placeholders (see ENGINE_ROADMAP.md's
 * Tuning backlog); the classification mechanism itself is not.
 */
export interface SurfaceState {
  readonly kind: SurfaceKind;
  readonly gripMultiplier: number;
  readonly dragMultiplier: number;
}

export const ROAD_SURFACE: SurfaceState = { kind: "road", gripMultiplier: 1, dragMultiplier: 1 };
const SHOULDER_SURFACE: SurfaceState = { kind: "shoulder", gripMultiplier: 0.7, dragMultiplier: 1.3 };
const OFF_ROAD_SURFACE: SurfaceState = { kind: "offRoad", gripMultiplier: 0.45, dragMultiplier: 2.2 };

/** Meters beyond the paved edge that still count as "shoulder" before it's fully off-road. */
const SHOULDER_MARGIN_METERS = 2;

/** Classifies a surface from unsigned lateral distance (meters) from the track centerline. */
export function classifySurface(distanceFromCenterline: number): SurfaceState {
  const halfWidth = ROAD_WIDTH / 2;
  if (distanceFromCenterline <= halfWidth) return ROAD_SURFACE;
  if (distanceFromCenterline <= halfWidth + SHOULDER_MARGIN_METERS) return SHOULDER_SURFACE;
  return OFF_ROAD_SURFACE;
}
