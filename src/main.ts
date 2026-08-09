import { Game } from "./engine/game.js";
import { createDebugPanel } from "./engine/debugPanel.js";
import { ControlsOverlay } from "./engine/controlsOverlay.js";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error("Canvas element #game-canvas not found");
}

const game = new Game(canvas);
game.start();

const controlsOverlay = new ControlsOverlay(false); // off by default; toggle from the debug panel
createDebugPanel(game, controlsOverlay);
