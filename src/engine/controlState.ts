import type { Input } from "./input.js";

/**
 * One physics step's worth of vehicle control input, decoupled from the
 * keyboard/Input implementation. Vehicle simulation depends only on this
 * shape, not on Input or key names, so a gamepad, replay, or AI driver can
 * be swapped in later by writing a new function that produces this struct.
 */
export interface ControlState {
  readonly throttle: boolean;
  readonly brake: boolean;
  readonly steerLeft: boolean;
  readonly steerRight: boolean;
  /**
   * Optional continuous steer input, -1..1 (positive = right, matching
   * steerRight/steerLeft's sign convention), for controllers that can
   * produce one — currently just AiDriver's SteeringController (see
   * gameplay/steeringController.ts). Never set by readControlState:
   * keyboard input stays digital. When present, Player.update() uses it
   * instead of deriving steer input from steerLeft/steerRight.
   */
  readonly steerAxis?: number;
  readonly handbrake: boolean;
  readonly shiftUp: boolean;
  readonly shiftDown: boolean;
}

/** Snapshots the live keyboard Input into a ControlState for one physics step. */
export function readControlState(input: Input): ControlState {
  return {
    throttle: input.isHeld("w"),
    brake: input.isHeld("s"),
    steerLeft: input.isHeld("a"),
    steerRight: input.isHeld("d"),
    handbrake: input.isHeld("space"),
    shiftUp: input.wasPressed("e"),
    shiftDown: input.wasPressed("q"),
  };
}
