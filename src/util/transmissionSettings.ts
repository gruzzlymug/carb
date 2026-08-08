export type TransmissionMode = "automatic" | "manual";

/**
 * Live-tunable transmission mode, mirroring engine/cameras/cameraSettings.ts's
 * pattern: a plain mutable object the debug panel can bind directly to.
 * Manual is the default — Q/E gear shifting is in the player's hands;
 * Automatic hands gear selection to automaticGearFor (see entities/player.ts).
 */
export const transmissionSettings = {
  mode: "manual" as TransmissionMode,
};
