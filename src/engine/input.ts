/** Maps a logical control name to its physical key code (layout-independent). */
const KEY_CODES: Record<string, string> = {
  q: "KeyQ",
  w: "KeyW",
  e: "KeyE",
  a: "KeyA",
  s: "KeyS",
  d: "KeyD",
  r: "KeyR",
  space: "Space",
};

/**
 * Tracks keyboard state so game logic can poll it once per frame rather
 * than reacting to individual key events. Uses `event.code` (the
 * physical key position) rather than `event.key`, so controls stay on
 * the QWE/ASD physical block regardless of keyboard layout (Dvorak, etc).
 *
 * Supports both held state (throttle, steering) and edge-triggered
 * "just pressed this frame" state (manual gear shifts, reset) via
 * wasPressed — call endFrame() once per game loop tick to clear it.
 */
export class Input {
  private held = new Set<string>();
  private pressedThisFrame = new Set<string>();

  constructor() {
    // Capture phase: fires before the event reaches (and can be stopped
    // by) any focused UI widget — e.g. the debug panel's dropdowns —
    // so gameplay keys keep working after interacting with lil-gui.
    window.addEventListener(
      "keydown",
      (e) => {
        if (!this.held.has(e.code)) this.pressedThisFrame.add(e.code);
        this.held.add(e.code);
      },
      { capture: true }
    );
    window.addEventListener("keyup", (e) => this.held.delete(e.code), { capture: true });
    window.addEventListener("blur", () => {
      this.held.clear();
      this.pressedThisFrame.clear();
    });
  }

  /** `key` is a logical control name, e.g. "q", "w", "space" — mapped to its physical code. */
  isHeld(key: string): boolean {
    const code = KEY_CODES[key.toLowerCase()];
    return code !== undefined && this.held.has(code);
  }

  /** True on the single frame `key` transitioned from released to held. */
  wasPressed(key: string): boolean {
    const code = KEY_CODES[key.toLowerCase()];
    return code !== undefined && this.pressedThisFrame.has(code);
  }

  /** Clears just-pressed edge state; call once per frame after all input has been read. */
  endFrame(): void {
    this.pressedThisFrame.clear();
  }
}
