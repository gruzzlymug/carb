export type TransmissionMode = "automatic" | "manual";

/**
 * Live-tunable transmission mode, mirroring engine/cameras/cameraSettings.ts's
 * pattern: a plain mutable object the debug panel can bind directly to.
 * Automatic is the default — gear selection is handed to automaticGearFor
 * (see entities/player.ts); Manual puts Q/E gear shifting in the player's
 * hands.
 */
export const transmissionSettings = {
  mode: "automatic" as TransmissionMode,
};
