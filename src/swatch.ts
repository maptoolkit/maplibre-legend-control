import { valueToString } from "./model";
import { fontStackToCss } from "./fonts";
import type { SwatchLayer, TextStyle } from "./types";

/** What `map.getImage(id)` returns — typed loosely so no maplibre runtime import is needed. */
export type StyleImageLike = {
  data: { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
  pixelRatio: number;
  sdf: boolean;
};
export type GetImage = (id: string) => StyleImageLike | undefined | null;

const CLASS = "maplibre-legend-control";
const SWATCH_H = 18;
const MAX_ICON = 24;

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

/** Parse any CSS color the browser understands into RGBA 0..255 (alpha 0..1); `undefined` without canvas support. */
function parseColor(color: string): [number, number, number, number] | undefined {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(color);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
}

/** Draw a style image (plain or SDF, recolored) onto a canvas; `undefined` when the environment has no 2D canvas. */
function imageToCanvas(image: StyleImageLike, options: { color?: string; haloColor?: string; haloWidth?: number } = {}): HTMLCanvasElement | undefined {
  const { width, height, data } = image.data;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  const out = ctx.createImageData(width, height);

  if (!image.sdf) {
    out.data.set(data);
    ctx.putImageData(out, 0, 0);
    return canvas;
  }

  // Signed distance field: alpha encodes the distance, 0.75 is the glyph edge
  // (MapLibre's SDF convention). Fill inside with icon-color, optionally a halo
  // band of `haloWidth` (in icon pixels) outside the edge with the halo color.
  const fill = parseColor(options.color ?? "rgba(0,0,0,1)") ?? [0, 0, 0, 1];
  const halo = options.haloColor && options.haloWidth ? parseColor(options.haloColor) : undefined;
  const edge = 0.75;
  const feather = 1 / Math.max(8, Math.min(width, height)); // ≈ one texel of anti-aliasing
  // SDF buffer maps ~8 px of distance onto 0..1 alpha; a halo of w px widens the edge by w/8.
  const haloEdge = halo ? edge - Math.min(0.7, (options.haloWidth ?? 0) / 8) : edge;
  const smooth = (x: number, lo: number, hi: number) => (x <= lo ? 0 : x >= hi ? 1 : (x - lo) / (hi - lo));

  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3] / 255;
    const inside = smooth(a, edge - feather, edge + feather);
    const withHalo = halo ? smooth(a, haloEdge - feather, haloEdge + feather) : inside;
    const o = i * 4;
    if (inside > 0) {
      out.data[o] = fill[0];
      out.data[o + 1] = fill[1];
      out.data[o + 2] = fill[2];
      out.data[o + 3] = Math.round(255 * fill[3] * inside);
    } else if (halo && withHalo > 0) {
      out.data[o] = halo[0];
      out.data[o + 1] = halo[1];
      out.data[o + 2] = halo[2];
      out.data[o + 3] = Math.round(255 * halo[3] * withHalo);
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/** Stacked line strokes: casing/blur below, the main stroke on top, dash arrays as gradients. */
export function createLineSwatch(layers: SwatchLayer[]): HTMLElement {
  const box = el("span", `${CLASS}-swatch ${CLASS}-swatch-line`);
  for (const layer of layers) {
    if (layer.type !== "line") continue;
    const color = valueToString(layer.paint["line-color"]);
    if (!color) continue;
    const width = clamp(num(layer.paint["line-width"], 1), 1, SWATCH_H - 2);
    const gap = num(layer.paint["line-gap-width"], 0);
    const opacity = clamp(num(layer.paint["line-opacity"], 1), 0, 1);
    const blur = num(layer.paint["line-blur"], 0);
    const dash = layer.paint["line-dasharray"];

    const strokes = gap > 0 ? [-(gap + width) / 2, (gap + width) / 2] : [0]; // a gap splits the stroke into two parallel lines
    for (const offset of strokes) {
      const s = el("span", `${CLASS}-stroke ${CLASS}-stroke-${layer.role}`);
      s.style.height = `${width}px`;
      s.style.top = `${(SWATCH_H - width) / 2 + offset}px`;
      s.style.opacity = String(opacity);
      if (blur > 0) s.style.filter = `blur(${Math.min(blur, 4)}px)`;
      if (Array.isArray(dash) && dash.length >= 2 && dash.every((d) => typeof d === "number")) {
        const [on, off] = dash as number[];
        const onPx = Math.max(1, on * width);
        const period = Math.max(2, (on + off) * width);
        s.style.background = `repeating-linear-gradient(90deg, ${color} 0 ${onPx}px, transparent ${onPx}px ${period}px)`;
      } else {
        s.style.background = color;
      }
      box.appendChild(s);
    }
  }
  return box;
}

/** Filled box (with pattern when the sprite image is available), outline from fill-outline-color. */
export function createFillSwatch(layer: SwatchLayer, getImage?: GetImage, textures: SwatchLayer[] = []): HTMLElement {
  const box = el("span", `${CLASS}-swatch ${CLASS}-swatch-fill`);
  const isExtrusion = layer.type === "fill-extrusion";
  const color = valueToString(layer.paint[isExtrusion ? "fill-extrusion-color" : "fill-color"]);
  const opacity = clamp(num(layer.paint[isExtrusion ? "fill-extrusion-opacity" : "fill-opacity"], 1), 0, 1);
  const outline = valueToString(layer.paint["fill-outline-color"]);
  if (color) box.style.backgroundColor = color;
  box.style.opacity = String(opacity);
  if (outline) box.style.boxShadow = `inset 0 0 0 1px ${outline}`;

  for (const tex of [layer, ...textures]) {
    const pattern = valueToString(tex.paint["fill-pattern"]);
    const image = pattern && getImage ? getImage(pattern) : undefined;
    const canvas = image ? imageToCanvas(image) : undefined;
    if (canvas) {
      const ratio = image!.pixelRatio || 1;
      const p = el("span", `${CLASS}-pattern`);
      p.style.backgroundImage = `url(${canvas.toDataURL()})`;
      p.style.backgroundSize = `${canvas.width / ratio}px ${canvas.height / ratio}px`;
      p.style.opacity = String(clamp(num(tex.paint["fill-opacity"], 1), 0, 1));
      box.appendChild(p);
    }
  }
  return box;
}

/** Sprite icon, SDF icons recolored with icon-color (+ halo); falls back to a neutral dot without image/canvas. */
export function createIconSwatch(layer: SwatchLayer, getImage?: GetImage): HTMLElement {
  const box = el("span", `${CLASS}-swatch ${CLASS}-swatch-icon`);
  const name = valueToString(layer.layout["icon-image"]);
  const image = name && getImage ? getImage(name) : undefined;
  const canvas = image
    ? imageToCanvas(image, {
        color: valueToString(layer.paint["icon-color"]),
        haloColor: valueToString(layer.paint["icon-halo-color"]),
        haloWidth: num(layer.paint["icon-halo-width"], 0),
      })
    : undefined;
  if (canvas && image) {
    const ratio = image.pixelRatio || 1;
    const scale = num(layer.layout["icon-size"], 1);
    const w = (canvas.width / ratio) * scale;
    const h = (canvas.height / ratio) * scale;
    const k = Math.min(1, MAX_ICON / Math.max(w, h));
    canvas.style.width = `${w * k}px`;
    canvas.style.height = `${h * k}px`;
    canvas.style.opacity = String(clamp(num(layer.paint["icon-opacity"], 1), 0, 1));
    box.appendChild(canvas);
  } else {
    box.classList.add(`${CLASS}-swatch-icon-missing`);
  }
  return box;
}

/** Pick the swatch shape from the entry's main layer type and hand the stack to the matching builder. */
export function createSwatch(layers: SwatchLayer[], getImage?: GetImage): HTMLElement {
  const main = layers.find((l) => l.role === "main") ?? layers[0];
  if (!main) return el("span", `${CLASS}-swatch ${CLASS}-swatch-empty`);
  switch (main.type) {
    case "line":
      return createLineSwatch(layers);
    case "fill":
    case "fill-extrusion":
      return createFillSwatch(
        main,
        getImage,
        layers.filter((l) => l !== main && l.type === "fill" && l.paint["fill-pattern"]),
      );
    case "symbol":
      return createIconSwatch(main, getImage);
    default:
      return el("span", `${CLASS}-swatch ${CLASS}-swatch-empty`);
  }
}

/** Apply an evaluated text appearance (map font, colour, halo, transform) to a DOM element. */
export function applyTextStyle(target: HTMLElement, text: TextStyle, maxSize = 16): void {
  const css = fontStackToCss(text.fontStack);
  if (css) {
    target.style.fontFamily = css.fontFamily;
    target.style.fontWeight = css.fontWeight;
    target.style.fontStyle = css.fontStyle;
  }
  if (text.size) target.style.fontSize = `${clamp(text.size, 10, maxSize)}px`;
  if (text.color) target.style.color = text.color;
  if (text.transform && text.transform !== "none") target.style.textTransform = text.transform;
  if (text.letterSpacing) target.style.letterSpacing = `${text.letterSpacing}em`;
  if (text.haloColor && text.haloWidth) {
    const w = Math.min(text.haloWidth, 2);
    target.style.textShadow = `0 0 ${w}px ${text.haloColor}, 0 0 ${w}px ${text.haloColor}`;
  }
}
