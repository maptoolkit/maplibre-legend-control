import { valueToNumbers, valueToString } from "./model";
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
const SWATCH_W = 56;
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

const SVG_NS = "http://www.w3.org/2000/svg";
/**
 * Gentle curves through the 56×18 swatch box, so a road reads as a road. One
 * of them is picked per entry (see {@link lineVariantFor}) — different entries
 * get different bends, an entry keeps its bend across updates.
 */
const LINE_PATHS = [
  "M 3 12.5 C 16 1.5, 30 17.5, 53 5.5",
  "M 3 5.5 C 18 16.5, 34 1.5, 53 12.5",
  "M 3 10 C 12 2, 22 2, 30 9 S 46 16, 53 7",
  "M 3 14 C 18 14, 30 3, 53 4",
  "M 3 4 C 12 16, 36 16, 53 12",
];
/** Strokes wider than this (incl. casing gaps) are scaled down together, keeping their ratios. */
const MAX_STROKE = SWATCH_H - 4;

type Stroke = { color: string; width: number; opacity: number; blur: number; dash?: number[]; cap: string; join: string; role: string };

function strokeOf(layer: SwatchLayer): Stroke | undefined {
  if (layer.type !== "line") return undefined;
  const color = valueToString(layer.paint["line-color"]);
  if (!color) return undefined;
  const width = Math.max(0.5, num(layer.paint["line-width"], 1));
  const gap = Math.max(0, num(layer.paint["line-gap-width"], 0));
  return {
    color,
    // MapLibre draws a gap layer as two parallel strokes `gap` apart; drawn
    // below the main stroke (which is `gap` wide) a single stroke of
    // gap + 2·width looks the same — the casing outline.
    width: gap > 0 ? gap + 2 * width : width,
    opacity: clamp(num(layer.paint["line-opacity"], 1), 0, 1),
    blur: Math.max(0, num(layer.paint["line-blur"], 0)),
    // dash lengths are multiples of the line width
    dash: valueToNumbers(layer.paint["line-dasharray"])?.map((d) => d * width),
    cap: valueToString(layer.layout["line-cap"]) ?? "butt",
    join: valueToString(layer.layout["line-join"]) ?? "miter",
    role: layer.role,
  };
}

/**
 * Stacked line strokes on a curved path: blur/casing below, the main stroke on
 * top, dash arrays, caps and blur from the evaluated layers. All strokes are
 * scaled together when the widest would not fit, so casing and main keep their
 * ratio at every zoom.
 */
export function createLineSwatch(layers: SwatchLayer[], variant = 0): HTMLElement {
  const box = el("span", `${CLASS}-swatch ${CLASS}-swatch-line`);
  const strokes = layers.map(strokeOf).filter((s): s is Stroke => Boolean(s));
  if (!strokes.length) return box;
  const d = LINE_PATHS[Math.abs(Math.trunc(variant)) % LINE_PATHS.length];

  const widest = Math.max(...strokes.map((s) => s.width));
  const scale = widest > MAX_STROKE ? MAX_STROKE / widest : 1;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${SWATCH_W} ${SWATCH_H}`);
  svg.setAttribute("width", String(SWATCH_W));
  svg.setAttribute("height", String(SWATCH_H));
  svg.setAttribute("aria-hidden", "true");
  for (const stroke of strokes) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", `${CLASS}-stroke ${CLASS}-stroke-${stroke.role}`);
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", stroke.color);
    path.setAttribute("stroke-width", String(Math.max(0.75, stroke.width * scale)));
    path.setAttribute("stroke-linecap", stroke.cap);
    path.setAttribute("stroke-linejoin", stroke.join);
    if (stroke.opacity < 1) path.setAttribute("stroke-opacity", String(stroke.opacity));
    if (stroke.dash) path.setAttribute("stroke-dasharray", stroke.dash.map((d) => Math.max(0.5, d * scale)).join(" "));
    if (stroke.blur > 0) path.style.filter = `blur(${Math.min(stroke.blur * scale, 3)}px)`;
    svg.appendChild(path);
  }
  box.appendChild(svg);
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

/** Number of line curve variants available to {@link createLineSwatch}. */
export const LINE_VARIANTS = LINE_PATHS.length;

/**
 * Stable pseudo-random curve variant for an entry key, so a legend row keeps
 * its bend across updates while neighbouring rows differ.
 */
export function lineVariantFor(key: string): number {
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) % LINE_PATHS.length;
}

/** Pick the swatch shape from the entry's main layer type and hand the stack to the matching builder. */
export function createSwatch(layers: SwatchLayer[], getImage?: GetImage, variant = 0): HTMLElement {
  const main = layers.find((l) => l.role === "main") ?? layers[0];
  if (!main) return el("span", `${CLASS}-swatch ${CLASS}-swatch-empty`);
  switch (main.type) {
    case "line":
      return createLineSwatch(layers, variant);
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

/** Apply an evaluated text appearance (map font, size, colour, halo, transform, wrapping) to a DOM element. */
export function applyTextStyle(target: HTMLElement, text: TextStyle, maxSize = 22): void {
  const css = fontStackToCss(text.fontStack);
  if (css) {
    target.style.fontFamily = css.fontFamily;
    target.style.fontWeight = css.fontWeight;
    target.style.fontStyle = css.fontStyle;
  }
  const size = clamp(text.size ?? 14, 8, maxSize);
  target.style.fontSize = `${size}px`;
  target.style.lineHeight = String(text.lineHeight ?? 1.2);
  target.style.maxWidth = `${text.maxWidth ?? 10}em`;
  if (text.color) target.style.color = text.color;
  if (text.transform && text.transform !== "none") target.style.textTransform = text.transform;
  if (text.letterSpacing) target.style.letterSpacing = `${text.letterSpacing}em`;
  if (text.justify) target.style.textAlign = text.justify === "auto" ? "center" : text.justify;
  if (text.haloColor && text.haloWidth) {
    // a halo is a stroke around the glyphs; several blurred shadows approximate it
    const w = Math.min(text.haloWidth, 2.5);
    const shadow = `0 0 ${w}px ${text.haloColor}`;
    target.style.textShadow = [shadow, shadow, shadow, shadow].join(", ");
  }
}

/**
 * Where the text sits relative to the icon, from `text-anchor` and `text-offset`
 * the way MapLibre places it: the anchor names the side of the text box that
 * touches the symbol's anchor point, so `top` puts the text below the icon.
 */
export function textPlacement(text: TextStyle | undefined): "below" | "above" | "right" | "left" | "overlay" {
  const anchor = text?.anchor ?? "center";
  const [ox, oy] = text?.offset ?? [0, 0];
  if (anchor.startsWith("top")) return "below";
  if (anchor.startsWith("bottom")) return "above";
  if (anchor === "left") return "right";
  if (anchor === "right") return "left";
  if (oy > 0.3) return "below";
  if (oy < -0.3) return "above";
  if (ox > 0.3) return "right";
  if (ox < -0.3) return "left";
  return "overlay";
}

/**
 * The map symbol of an instance entry as it appears on the map: the icon (if
 * any) and the name in the map font, arranged by anchor and offset. Used for
 * the left column, where the class entries show their swatch.
 */
export function createSymbolPreview(entry: { name?: string; text?: TextStyle; icon?: SwatchLayer }, getImage?: GetImage): HTMLElement {
  const box = el("span", `${CLASS}-symbol`);
  const placement = textPlacement(entry.text);
  box.classList.add(`${CLASS}-symbol-${entry.icon && entry.name ? placement : "single"}`);

  let iconEl: HTMLElement | undefined;
  if (entry.icon) {
    iconEl = createIconSwatch(entry.icon, getImage);
    iconEl.classList.add(`${CLASS}-symbol-icon`);
    box.appendChild(iconEl);
  }
  if (entry.name) {
    const textEl = el("span", `${CLASS}-symbol-text`);
    textEl.textContent = entry.name;
    if (entry.text) applyTextStyle(textEl, entry.text);
    if (iconEl && placement !== "overlay") {
      // offset is measured from the icon centre to the text box edge, in ems
      const [ox, oy] = entry.text?.offset ?? [0, 0];
      const em = clamp(entry.text?.size ?? 14, 8, 22);
      const along = placement === "below" || placement === "above" ? Math.abs(oy) : Math.abs(ox);
      const gap = Math.max(0, Math.min(8, along * em - MAX_ICON / 2));
      box.style.gap = `${gap}px`;
    }
    box.appendChild(textEl);
  }
  return box;
}
