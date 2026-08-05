import type { Vec3 } from "../math/vector3.js";
import { perpendicular } from "../math/vector3.js";
import type { Mesh } from "../graphics/mesh.js";
import { createRoadRibbonMesh, createGroundMesh } from "../graphics/trackMesh.js";
import { TRACK_GENERATORS, DEFAULT_TRACK_TYPE } from "./trackDefinitions.js";
import { sampleTrack, type SampledLoop } from "./trackSpline.js";
import { buildTrackQuery, type TrackQuery } from "./trackQuery.js";
import { ROAD_WIDTH, GAS_STATION_MIN_INTERVAL_METERS, GAS_STATION_MAX_INTERVAL_METERS } from "../util/constants.js";

export interface GasStationPlacement {
  position: Vec3;
  headingRad: number;
}

/** Everything needed to render, spawn into, and query one selected track. Built once, not streamed. */
export interface TrackWorld {
  roadMesh: Mesh;
  groundMesh: Mesh;
  gasStations: GasStationPlacement[];
  spawn: { position: Vec3; headingRad: number };
  query: TrackQuery;
}

function randomGasStationInterval(): number {
  const span = GAS_STATION_MAX_INTERVAL_METERS - GAS_STATION_MIN_INTERVAL_METERS;
  return GAS_STATION_MIN_INTERVAL_METERS + Math.random() * span;
}

/** Matches Player's heading convention: 0 = facing +Y, forward = (sin(heading), cos(heading)). */
function headingFromTangent(tangent: Vec3): number {
  return Math.atan2(tangent.x, tangent.y);
}

/** Places gas stations along one loop, spaced by arc length (starting fresh at that loop's own start). */
function placeGasStationsOnLoop(loop: SampledLoop): GasStationPlacement[] {
  const placements: GasStationPlacement[] = [];
  const roadsideOffset = ROAD_WIDTH / 2 + 8;
  let nextThreshold = randomGasStationInterval();

  for (const sample of loop.samples) {
    if (sample.arcLength < nextThreshold) continue;

    const side = Math.random() < 0.5 ? -1 : 1;
    const perp = perpendicular(sample.tangent);
    placements.push({
      position: {
        x: sample.center.x + perp.x * side * roadsideOffset,
        y: sample.center.y + perp.y * side * roadsideOffset,
        z: 0,
      },
      headingRad: headingFromTangent(sample.tangent),
    });
    nextThreshold += randomGasStationInterval();
  }

  return placements;
}

/** Builds all static data for one track: road/ground geometry, gas stations, and the player's spawn point. */
export function buildTrackWorld(trackType: string): TrackWorld {
  const generator = TRACK_GENERATORS[trackType] ?? TRACK_GENERATORS[DEFAULT_TRACK_TYPE];
  const track = generator();
  const sampled = sampleTrack(track);

  const roadMesh = createRoadRibbonMesh(sampled.loops);
  const groundMesh = createGroundMesh(sampled.loops);
  const gasStations = sampled.loops.flatMap(placeGasStationsOnLoop);
  const query = buildTrackQuery(sampled);

  const spawnSample = sampled.loops[0].samples[0];
  const spawn = {
    position: spawnSample.center,
    headingRad: headingFromTangent(spawnSample.tangent),
  };

  return { roadMesh, groundMesh, gasStations, spawn, query };
}
