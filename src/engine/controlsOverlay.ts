const CONTROLS: Array<[string, string]> = [
  ["W", "Accelerate"],
  ["S", "Brake / Reverse"],
  ["A", "Steer Left"],
  ["D", "Steer Right"],
  ["Space", "Handbrake"],
  ["Q / E", "Shift Down / Up (Manual)"],
  ["R", "Reset"],
];

/**
 * A plain DOM overlay listing the current controls — not part of the 3D
 * scene, purely a display concern. Off by default (toggled from the debug
 * panel); positioned above the always-on minimap (see minimap.ts) in the
 * same bottom-left corner so the two stack instead of overlapping if both
 * happen to be visible.
 */
export class ControlsOverlay {
  private readonly element: HTMLDivElement;

  constructor(visible = true) {
    this.element = document.createElement("div");
    this.element.style.cssText = `
      position: fixed;
      left: 12px;
      bottom: 190px;
      padding: 10px 14px;
      background: rgba(0, 0, 0, 0.65);
      color: #fff;
      font: 13px/1.6 monospace;
      border-radius: 4px;
      pointer-events: none;
      z-index: 10;
    `;
    this.element.innerHTML = [
      '<div style="font-weight:bold;margin-bottom:4px;">Controls</div>',
      ...CONTROLS.map(
        ([key, action]) => `<div><span style="color:#8fc7e8;">${key}</span> — ${action}</div>`
      ),
    ].join("");
    document.body.appendChild(this.element);
    this.setVisible(visible);
  }

  setVisible(visible: boolean): void {
    this.element.style.display = visible ? "block" : "none";
  }
}
