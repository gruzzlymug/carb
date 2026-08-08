import type { ControlState } from "../engine/controlState.js";
import { Player } from "../entities/player.js";
import { transmissionSettings } from "../util/transmissionSettings.js";
import { PHYSICS_DT } from "../util/constants.js";

export { PHYSICS_DT };
export const MPH = 0.44704; // meters/second per mph

/** Builds a ControlState with all inputs released except the given overrides. */
export function controls(overrides: Partial<ControlState> = {}): ControlState {
  return {
    throttle: false,
    brake: false,
    steerLeft: false,
    steerRight: false,
    handbrake: false,
    shiftUp: false,
    shiftDown: false,
    ...overrides,
  };
}

/** Runs `n` physics steps of `c` against `player`. */
export function step(player: Player, n: number, c: ControlState): void {
  for (let i = 0; i < n; i++) player.update(PHYSICS_DT, c);
}

/** A fresh Player accelerated in a straight line (full throttle) to at least `targetMph`. */
export function playerAtSpeed(targetMph: number, maxSteps = 30000): Player {
  // Needs to climb through the gears to reach highway speeds — force automatic
  // mode regardless of the app's own default, since that's an implementation
  // detail of "get up to speed," not something most callers care about.
  transmissionSettings.mode = "automatic";
  const player = new Player();
  const target = targetMph * MPH;
  for (let i = 0; i < maxSteps && player.speed < target; i++) {
    player.update(PHYSICS_DT, controls({ throttle: true }));
  }
  return player;
}
