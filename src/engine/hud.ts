import { IDLE_RPM, REDLINE_RPM, LIMITER_RPM } from "../util/constants.js";

const TACH_WIDTH_PX = 160;

/** Plain DOM overlay showing a speedometer, gear indicator, and tachometer — not part of the 3D scene. */
export class Hud {
  private readonly element: HTMLDivElement;
  private readonly speedEl: HTMLDivElement;
  private readonly gearEl: HTMLDivElement;
  private readonly tachTrack: HTMLDivElement;
  private readonly tachFill: HTMLDivElement;
  private readonly tachValueEl: HTMLDivElement;

  constructor() {
    this.element = document.createElement("div");
    this.element.style.cssText = `
      position: fixed;
      right: 12px;
      bottom: 12px;
      padding: 10px 16px;
      background: rgba(0, 0, 0, 0.65);
      color: #fff;
      font: 16px/1.4 monospace;
      text-align: right;
      border-radius: 4px;
      pointer-events: none;
      z-index: 10;
    `;

    this.speedEl = document.createElement("div");
    this.speedEl.style.cssText = "font-size: 28px; font-weight: bold;";

    this.gearEl = document.createElement("div");
    this.gearEl.style.cssText = "font-size: 14px; color: #8fc7e8;";

    this.tachTrack = document.createElement("div");
    this.tachTrack.style.cssText = `
      width: ${TACH_WIDTH_PX}px;
      height: 8px;
      margin-top: 6px;
      background: rgba(255, 255, 255, 0.15);
      border-radius: 4px;
      overflow: hidden;
    `;
    this.tachFill = document.createElement("div");
    this.tachFill.style.cssText = "height: 100%; width: 0%; background: #4caf50;";
    this.tachTrack.appendChild(this.tachFill);

    this.tachValueEl = document.createElement("div");
    this.tachValueEl.style.cssText = "font-size: 12px; color: #aaa; margin-top: 2px;";

    this.element.append(this.speedEl, this.gearEl, this.tachTrack, this.tachValueEl);
    document.body.appendChild(this.element);
  }

  /** `speed` in meters/second (may be negative when reversing); `rpm` in engine RPM. */
  update(speed: number, gearLabel: string, rpm: number): void {
    const kmh = Math.round(Math.abs(speed) * 3.6);
    this.speedEl.innerHTML = `${kmh} <span style="font-size: 14px; font-weight: normal;">km/h</span>`;
    this.gearEl.textContent = `Gear ${gearLabel}`;

    const fraction = Math.max(0, Math.min(1, (rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM)));
    this.tachFill.style.width = `${fraction * 100}%`;
    this.tachFill.style.background = fraction < 0.6 ? "#4caf50" : fraction < 0.85 ? "#e0c030" : "#d83a3a";
    this.tachValueEl.textContent = `${Math.round(rpm)} RPM${rpm >= LIMITER_RPM - 50 ? " — SHIFT!" : ""}`;
  }
}
