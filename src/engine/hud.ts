import type { LapState } from "../gameplay/lapTracker.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Analog tach dial geometry. A plain display/rendering choice, not vehicle
// physics — decoupled from the engine's own RPM values (which now come from
// the active car's CarConfig, see util/cars/) so the gauge can use clean,
// human-readable round numbers (0-9 x1000 RPM) regardless of exactly where
// redline sits.
const GAUGE_MAX_RPM = 9000;
const GAUGE_TICK_STEP_RPM = 1000;
const GAUGE_CENTER_X = 80;
const GAUGE_CENTER_Y = 84;
const GAUGE_RADIUS = 68;
const GAUGE_START_ANGLE_DEG = 180; // needle points left at 0 RPM
const GAUGE_END_ANGLE_DEG = 0; // needle points right at GAUGE_MAX_RPM
const GAUGE_ARC_SEGMENTS = 48; // polyline approximation of the arc; smooth enough at this radius

function polarPoint(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: GAUGE_CENTER_X + radius * Math.cos(rad), y: GAUGE_CENTER_Y - radius * Math.sin(rad) };
}

/** Angle (degrees, gauge convention) for a given RPM, clamped to the dial's range. */
function angleForRpm(rpm: number): number {
  const fraction = Math.max(0, Math.min(1, rpm / GAUGE_MAX_RPM));
  return GAUGE_START_ANGLE_DEG + (GAUGE_END_ANGLE_DEG - GAUGE_START_ANGLE_DEG) * fraction;
}

/** Polyline path approximating the dial's arc between two RPM values, at a given radius. */
function arcPath(fromRpm: number, toRpm: number, radius: number): string {
  const fromAngle = angleForRpm(fromRpm);
  const toAngle = angleForRpm(toRpm);
  const points: string[] = [];
  for (let i = 0; i <= GAUGE_ARC_SEGMENTS; i++) {
    const angle = fromAngle + (toAngle - fromAngle) * (i / GAUGE_ARC_SEGMENTS);
    const { x, y } = polarPoint(angle, radius);
    points.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return points.join(" ");
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** Formats seconds as M:SS.d (e.g. 83.4 -> "1:23.4"); "--:--.-" for an unset time. */
function formatLapTime(seconds: number | null): string {
  if (seconds === null) return "--:--.-";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

/** Plain DOM overlay showing a speedometer, gear indicator, and analog tachometer — not part of the 3D scene. */
export class Hud {
  private readonly element: HTMLDivElement;
  private readonly speedEl: HTMLDivElement;
  private readonly gearNumberEl: HTMLDivElement;
  private readonly needleEl: SVGLineElement;
  private readonly rpmValueEl: HTMLDivElement;
  private readonly lapEl: HTMLDivElement;
  private readonly redlineRpm: number;
  private readonly recommendedShiftRpm: number;

  /** `redlineRpm`/`recommendedShiftRpm` come from the active car's CarConfig (see util/cars/) — the dial's redline zone is baked in from these once, here, since it doesn't change after construction. */
  constructor(redlineRpm: number, recommendedShiftRpm: number) {
    this.redlineRpm = redlineRpm;
    this.recommendedShiftRpm = recommendedShiftRpm;
    this.element = document.createElement("div");
    // Fixed to the top-left corner: the one place nothing else in this game's
    // UI (debug panel top-right, controls legend bottom-left) ever renders,
    // so the core readouts a driver actually needs mid-corner are never
    // obscured by other overlays.
    this.element.style.cssText = `
      position: fixed;
      left: 12px;
      top: 12px;
      width: 180px;
      padding: 10px 12px 12px;
      background: rgba(0, 0, 0, 0.65);
      color: #fff;
      font: 16px/1.4 monospace;
      text-align: center;
      border-radius: 4px;
      pointer-events: none;
      z-index: 10;
    `;

    this.speedEl = document.createElement("div");
    this.speedEl.style.cssText = "font-size: 26px; font-weight: bold;";

    const gearBlock = document.createElement("div");
    gearBlock.style.cssText = "margin: 4px 0 2px;";
    const gearLabel = document.createElement("div");
    gearLabel.textContent = "GEAR";
    gearLabel.style.cssText = "font-size: 11px; letter-spacing: 2px; color: #8fc7e8;";
    this.gearNumberEl = document.createElement("div");
    this.gearNumberEl.style.cssText = "font-size: 56px; font-weight: bold; line-height: 1.05;";
    gearBlock.append(gearLabel, this.gearNumberEl);

    const { dial, needle } = this.buildDial();
    this.needleEl = needle;

    this.rpmValueEl = document.createElement("div");
    this.rpmValueEl.style.cssText = "font-size: 12px; color: #aaa; margin-top: 2px;";

    this.lapEl = document.createElement("div");
    this.lapEl.style.cssText =
      "font-size: 13px; color: #ddd; margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.15);";

    this.element.append(this.speedEl, gearBlock, dial, this.rpmValueEl, this.lapEl);
    document.body.appendChild(this.element);
  }

  /** Builds the static analog-tach SVG (dial face, redline zone, ticks, needle hub) once. */
  private buildDial(): { dial: SVGSVGElement; needle: SVGLineElement } {
    const dial = svgEl("svg", { viewBox: "0 0 160 92", width: "156", height: "90" });
    dial.style.cssText = "display: block; margin: 2px auto 0;";

    dial.appendChild(
      svgEl("path", {
        d: arcPath(0, GAUGE_MAX_RPM, GAUGE_RADIUS),
        fill: "none",
        stroke: "rgba(255,255,255,0.25)",
        "stroke-width": "6",
        "stroke-linecap": "round",
      })
    );
    dial.appendChild(
      svgEl("path", {
        d: arcPath(this.redlineRpm, GAUGE_MAX_RPM, GAUGE_RADIUS),
        fill: "none",
        stroke: "#d83a3a",
        "stroke-width": "6",
        "stroke-linecap": "round",
      })
    );

    for (let rpm = 0; rpm <= GAUGE_MAX_RPM; rpm += GAUGE_TICK_STEP_RPM) {
      const angle = angleForRpm(rpm);
      const inner = polarPoint(angle, GAUGE_RADIUS - 10);
      const outer = polarPoint(angle, GAUGE_RADIUS - 2);
      dial.appendChild(
        svgEl("line", {
          x1: inner.x.toFixed(2),
          y1: inner.y.toFixed(2),
          x2: outer.x.toFixed(2),
          y2: outer.y.toFixed(2),
          stroke: rpm >= this.redlineRpm ? "#d83a3a" : "rgba(255,255,255,0.6)",
          "stroke-width": "2",
        })
      );
    }

    const needle = svgEl("line", {
      x1: String(GAUGE_CENTER_X),
      y1: String(GAUGE_CENTER_Y),
      x2: String(GAUGE_CENTER_X - GAUGE_RADIUS + 14),
      y2: String(GAUGE_CENTER_Y),
      stroke: "#e8e030",
      "stroke-width": "3",
      "stroke-linecap": "round",
    });
    dial.appendChild(needle);
    dial.appendChild(
      svgEl("circle", { cx: String(GAUGE_CENTER_X), cy: String(GAUGE_CENTER_Y), r: "5", fill: "#e8e030" })
    );

    return { dial, needle };
  }

  /** `speed` in meters/second (may be negative when reversing); `rpm` in engine RPM. */
  update(speed: number, gearLabel: string, rpm: number): void {
    const kmh = Math.round(Math.abs(speed) * 3.6);
    this.speedEl.innerHTML = `${kmh} <span style="font-size: 13px; font-weight: normal;">km/h</span>`;
    this.gearNumberEl.textContent = gearLabel;

    const tip = polarPoint(angleForRpm(rpm), GAUGE_RADIUS - 14);
    this.needleEl.setAttribute("x2", tip.x.toFixed(2));
    this.needleEl.setAttribute("y2", tip.y.toFixed(2));

    this.rpmValueEl.textContent = `${Math.round(rpm)} RPM${rpm >= this.recommendedShiftRpm ? " — SHIFT!" : ""}`;
    this.rpmValueEl.style.color = rpm >= this.redlineRpm ? "#ff6b6b" : rpm >= this.recommendedShiftRpm ? "#e0c030" : "#aaa";
  }

  updateLap(lap: LapState): void {
    const lines = [
      `LAP ${lap.lapCount + 1} <span style="color:#8fc7e8;">${formatLapTime(lap.currentLapTime)}</span>`,
      `<div style="font-size: 11px; color: #999; margin-top: 2px;">BEST ${formatLapTime(lap.bestLapTime)}</div>`,
    ];
    if (lap.splits.length > 0) {
      const splitsText = lap.splits.map((split, i) => `S${i + 1} ${formatLapTime(split)}`).join("  ");
      lines.push(`<div style="font-size: 11px; color: #999; margin-top: 2px;">${splitsText}</div>`);
    }
    this.lapEl.innerHTML = lines.join("");
  }
}
