export type TransmissionMode = "automatic" | "manual";

/**
 * Live-tunable transmission mode, mirroring engine/cameras/cameraSettings.ts's
 * pattern: a plain mutable object the debug panel can bind directly to.
 * Automatic is the default per spec — the game manages gear shifts by
 * speed; Manual hands Q/E gear shifting to the player.
 */
export const transmissionSettings = {
  mode: "automatic" as TransmissionMode,
};
