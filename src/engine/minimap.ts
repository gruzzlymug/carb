import type { SampledLoop } from "../world/trackSpline.js";
import type { Vec3 } from "../math/vector3.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_SIZE = 150; // svg viewport, square, px
const PADDING = 12; // px around the track outline within the viewport
const MARKER_SIZE = 5; // px, half-width of the player-position triangle

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/**
 * Small top-down SVG overlay showing the current track's outline and the
 * player's live position/heading — not part of the 3D scene, purely a
 * display concern (same pattern as hud.ts's tach dial).
 *
 * World x/y (the ground plane; z is up and tracks are flat, see Vec3) maps
 * into the SVG viewport via a scale/offset fitted to the track's bounding
 * box once per track (setTrack). North-up: +world Y projects to "up" on
 * screen, which matches Player.heading's own convention (0 = facing +Y),
 * so the marker's rotation can use heading directly with no sign flip —
 * see playerView.ts's identical observation for the 3D car mesh.
 */
export class Minimap {
  private readonly element: HTMLDivElement;
  private readonly trackGroup: SVGGElement;
  private readonly marker: SVGPolygonElement;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  constructor() {
    this.element = document.createElement("div");
    // Bottom-left: the controls legend's spot, but that's off by default now
    // (see main.ts) so this is the natural home for an always-on overlay.
    this.element.style.cssText = `
      position: fixed;
      left: 12px;
      bottom: 12px;
      padding: 8px;
      background: rgba(0, 0, 0, 0.65);
      border-radius: 4px;
      pointer-events: none;
      z-index: 10;
    `;

    const svg = svgEl("svg", {
      viewBox: `0 0 ${VIEW_SIZE} ${VIEW_SIZE}`,
      width: String(VIEW_SIZE),
      height: String(VIEW_SIZE),
    });
    svg.style.cssText = "display: block;";

    this.trackGroup = svgEl("g", {});
    svg.appendChild(this.trackGroup);

    // Triangle pointing "up" (screen -y) at rotation 0 -- see class doc for why
    // that's heading 0 with no sign flip.
    this.marker = svgEl("polygon", {
      points: `0,${-MARKER_SIZE} ${MARKER_SIZE * 0.7},${MARKER_SIZE * 0.7} ${-MARKER_SIZE * 0.7},${MARKER_SIZE * 0.7}`,
      fill: "#e8e030",
    });
    svg.appendChild(this.marker);

    this.element.appendChild(svg);
    document.body.appendChild(this.element);
  }

  /** Rebuilds the static track outline to fit the viewport — call whenever the active track changes. */
  setTrack(loops: readonly SampledLoop[]): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const loop of loops) {
      for (const sample of loop.samples) {
        minX = Math.min(minX, sample.center.x);
        maxX = Math.max(maxX, sample.center.x);
        minY = Math.min(minY, sample.center.y);
        maxY = Math.max(maxY, sample.center.y);
      }
    }
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const available = VIEW_SIZE - PADDING * 2;
    // Uniform scale (not stretched per-axis) so the outline's shape stays true.
    this.scale = Math.min(available / width, available / height);
    this.offsetX = PADDING + (available - width * this.scale) / 2 - minX * this.scale;
    this.offsetY = PADDING + (available - height * this.scale) / 2 + maxY * this.scale;

    this.trackGroup.replaceChildren();
    for (const loop of loops) {
      const points = loop.samples.map((s) => this.project(s.center));
      if (loop.closed && points.length > 0) points.push(points[0]);
      this.trackGroup.appendChild(
        svgEl("polyline", {
          points: points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
          fill: "none",
          stroke: "rgba(255,255,255,0.55)",
          "stroke-width": "3",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        })
      );
    }
  }

  /** `position`/`headingRad` are the player's live interpolated pose (Player.renderPosition/renderHeading). */
  update(position: Vec3, headingRad: number): void {
    const p = this.project(position);
    const deg = (headingRad * 180) / Math.PI;
    this.marker.setAttribute("transform", `translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) rotate(${deg.toFixed(1)})`);
  }

  private project(point: Vec3): { x: number; y: number } {
    return { x: this.offsetX + point.x * this.scale, y: this.offsetY - point.y * this.scale };
  }
}
