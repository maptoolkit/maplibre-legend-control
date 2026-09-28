import { valueToNumbers, valueToString } from "./model";
import { fontStackToCss } from "./fonts";
import type { SwatchLayer, TextStyle } from "./types";

/** What `map.getImage(id)` returns — typed loosely so no maplibre runtime import is needed. */
export type StyleImageLike = {
  data: { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
  pixelRatio: number;
  sdf: boolean;
  /**
   * 9-slice metadata of a stretchable sprite (a shield): `content` is the area
   * the text sits in, in image pixels — everything outside it is the frame that
   * keeps its size when the icon is fitted to a text.
   */
  content?: [number, number, number, number];
};
export type GetImage = (id: string) => StyleImageLike | undefined | null;

/** How the rows are rendered: `maxNameWidth` caps a name in the map font (px); see `LegendControlOptions.maxNameWidth`. */
export type RenderOptions = { maxNameWidth?: number };

const CLASS = "maplibre-legend-control";
const SWATCH_W = 64;
const SWATCH_H = 26;
const MAX_ICON = 24;
/** How far a feature reaches beyond a name set on it, in px — the stylesheet's `--legend-control-symbol-reach`. */
const SYMBOL_REACH = 10;

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100; // keep attributes free of float noise

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

/** Parse any CSS color the browser understands into RGBA 0..255 (alpha 0..1); `undefined` without canvas support. */
export function parseColor(color: string): [number, number, number, number] | undefined {
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
/** Line shape family — how the feature runs on the map. */
export type LineShapeFamily = "geometric" | "flat" | "medium" | "tight";

/**
 * Curves through the 64×26 swatch box, so a road reads as a road, by family:
 * `geometric` runs straight, level or climbing, or bends sharply at a pylon
 * (aerial lifts), `flat` bends
 * gently (major roads, railways, ferries, admin borders), `medium` is wavier
 * (minor roads, pistes, cycle routes, waterways) and `tight` winds (paths,
 * contours). One of them is picked per entry from {@link swatchVariantFor} —
 * different entries get different bends, an entry keeps its bend across
 * updates. All run edge to edge and stay within y = 8…18; with butt caps the
 * strokes end flush like a map cut-out.
 */
export const LINE_SHAPES: Readonly<Record<LineShapeFamily, readonly string[]>> = {
  geometric: [
    "M 2 13 H 62", // straight, level
    "M 2 17 L 62 9", // straight, climbing
    "M 2 17 L 30 9 L 62 15", // one sharp bend at a pylon
    "M 2 16 L 20 16 L 34 9 L 62 9", // a level run, then a climb
  ],
  flat: [
    "M 2 15 C 20 13, 44 12, 62 10",
    "M 2 10 C 20 12, 44 13, 62 15",
    "M 2 14 C 22 10, 42 11, 62 13",
    "M 2 11 C 22 15, 42 14, 62 12",
    "M 2 16 C 24 13, 40 12, 62 11",
    "M 2 9 C 24 12, 40 13, 62 14",
    "M 2 13 C 18 11, 38 15, 62 12",
    "M 2 12 C 18 15, 38 10, 62 13",
    "M 2 14 C 26 12, 46 10, 62 12",
    "M 2 11 C 26 13, 46 15, 62 13",
  ],
  medium: [
    "M 2 17 C 17.6 8, 34.4 18, 62 9",
    "M 2 9 C 20 18, 39.2 8, 62 17",
    "M 2 14 C 12.8 8, 24.8 8, 34.4 13 S 53.6 18, 62 12",
    "M 2 18 C 20 18, 34.4 8, 62 9",
    "M 2 8 C 12.8 18, 41.6 18, 62 17",
    "M 2 17 C 18 8, 46 8, 62 17",
    "M 2 9 C 18 18, 46 18, 62 9",
    "M 2 10 C 16 18, 30 9, 62 16",
    "M 2 16 C 16 9, 34 17, 62 10",
    "M 2 13 C 16 8, 28 17, 44 11 C 54 8, 58 14, 62 12",
  ],
  tight: [
    "M 2 12 C 10 8, 16 18, 24 13 C 32 8, 40 18, 48 13 C 54 9, 58 16, 62 12",
    "M 2 14 C 8 18, 12 8, 20 12 C 28 17, 34 8, 42 13 C 48 18, 56 9, 62 14",
    "M 2 10 C 8 16, 14 17, 20 11 C 26 8, 32 9, 38 15 C 44 18, 52 12, 62 9",
    "M 2 16 C 10 10, 14 8, 22 12 C 30 17, 36 18, 44 13 C 50 9, 56 8, 62 13",
    "M 2 9 C 10 14, 14 18, 22 15 C 30 11, 34 8, 42 10 C 50 13, 54 18, 62 16",
    "M 2 13 C 8 9, 14 8, 18 12 C 24 17, 30 18, 36 14 C 42 9, 50 8, 56 12 C 59 15, 60 16, 62 15",
    "M 2 15 C 6 9, 12 9, 18 14 C 24 18, 30 17, 36 11 C 42 8, 50 9, 56 14 C 58 16, 60 17, 62 16",
    "M 2 11 C 8 17, 16 16, 20 11 C 24 8, 30 8, 36 12 C 42 16, 48 17, 54 12 C 57 9, 60 9, 62 11",
    "M 2 17 C 8 12, 12 8, 20 10 C 28 12, 30 17, 38 17 C 46 17, 48 10, 56 9 C 59 9, 61 10, 62 11",
    "M 2 12 C 6 8, 12 8, 16 13 C 20 18, 26 18, 30 13 C 34 8, 40 8, 44 13 C 48 18, 54 18, 58 13 C 60 11, 61 10, 62 10",
  ],
};

/**
 * The shape family of a line layer, from its id: aerial lifts run geometrically,
 * major roads, railways, ferries and admin borders bend gently, paths, hiking
 * routes and contours wind. Everything else — minor roads, pistes, cycle
 * routes, waterways, protected-area borders and custom layers — is in between.
 */
export function lineShapeFamilyFor(layerId: string): LineShapeFamily {
  if (layerId.startsWith("road_aerialway")) return "geometric";
  if (/^road_(major|rail|ferry)/.test(layerId) || layerId.startsWith("border_admin")) return "flat";
  if (/^road_(path|hiking)/.test(layerId) || layerId.startsWith("relief_contour")) return "tight";
  return "medium";
}

/** Vertical extent of the curves above (all stay within y = 8…18). */
const PATH_EXTENT = 10;
/**
 * Strokes wider than this (incl. casing gaps and their blur) are scaled down
 * together, keeping their ratios: half the stroke lies above/below the curve,
 * so curve extent + widest stroke must fit the box height.
 */
const MAX_STROKE = SWATCH_H - PATH_EXTENT;
/** A blur wider than this stops reading as a soft edge and just washes the swatch out. */
const MAX_BLUR = 3;

type Stroke = { color: string; width: number; gap: number; opacity: number; blur: number; dash?: number[]; cap: string; join: string; role: string };

function strokeOf(layer: SwatchLayer): Stroke | undefined {
  if (layer.type !== "line") return undefined;
  const color = valueToString(layer.paint["line-color"]);
  if (!color) return undefined;
  const width = Math.max(0.5, num(layer.paint["line-width"], 1));
  const gap = Math.max(0, num(layer.paint["line-gap-width"], 0));
  return {
    color,
    // MapLibre draws a gap layer as two parallel strokes `gap` apart: the
    // outer extent is gap + 2·width, the gap itself is masked out when drawn
    // (see gapMask) so whatever lies below stays visible through it.
    width: gap > 0 ? gap + 2 * width : width,
    gap,
    opacity: clamp(num(layer.paint["line-opacity"], 1), 0, 1),
    blur: Math.max(0, num(layer.paint["line-blur"], 0)),
    // dash lengths are multiples of the line width
    dash: valueToNumbers(layer.paint["line-dasharray"])?.map((d) => d * width),
    cap: valueToString(layer.layout["line-cap"]) ?? "butt",
    join: valueToString(layer.layout["line-join"]) ?? "miter",
    role: layer.role,
  };
}

let maskSeq = 0;

/**
 * A gap stroke is two parallel strokes: the full-width path masked out along
 * the gap. The map shows what lies between them — a translucent road over the
 * hiking band beneath it — so the gap must not be painted in the casing colour.
 */
function gapMask(path: SVGElement, d: string, stroke: Stroke, scale: number, scaleX = 1, width = SWATCH_W): SVGElement {
  const id = `${CLASS}-gap-${++maskSeq}`;
  const mask = document.createElementNS(SVG_NS, "mask");
  mask.setAttribute("id", id);
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  mask.setAttribute("x", "0");
  mask.setAttribute("y", "0");
  mask.setAttribute("width", String(width));
  mask.setAttribute("height", String(SWATCH_H));
  const keep = document.createElementNS(SVG_NS, "rect");
  keep.setAttribute("width", String(width));
  keep.setAttribute("height", String(SWATCH_H));
  keep.setAttribute("fill", "white");
  const cut = document.createElementNS(SVG_NS, "path");
  cut.setAttribute("class", `${CLASS}-gap`);
  cut.setAttribute("d", d);
  cut.setAttribute("fill", "none");
  cut.setAttribute("stroke", "black");
  cut.setAttribute("stroke-width", String(stroke.gap * scale));
  cut.setAttribute("stroke-linecap", "butt");
  cut.setAttribute("stroke-linejoin", stroke.join);
  stretchX(cut, scaleX);
  mask.append(keep, cut);
  path.setAttribute("mask", `url(#${id})`);
  return mask;
}

/**
 * Stacked line strokes on a curve of the main layer's shape family (see
 * {@link LINE_SHAPES}): blur/casing below, the main stroke on top, dash arrays,
 * caps and blur from the evaluated layers; a casing's gap is masked out, not
 * painted. All strokes are scaled together when the widest would not fit, so
 * casing and main keep their ratio at every zoom.
 */
type LineSwatchOptions = {
  /** Wider than the standard box: the bend is stretched to this width, the strokes keep their width. */
  width?: number;
  /** A name is set along the line: the tighter families give way to a gentler bend, as the map labels only its softer curves. */
  readable?: boolean;
};
type LineSwatchParts = { box: HTMLElement; svg?: SVGSVGElement; d: string; scaleX: number; width: number };

function lineSwatchParts(layers: SwatchLayer[], variant = 0, options: LineSwatchOptions = {}): LineSwatchParts {
  const main = layers.find((l) => l.role === "main") ?? layers[0];
  let family = main ? lineShapeFamilyFor(main.id) : "medium";
  if (options.readable) family = family === "tight" ? "medium" : family === "geometric" ? "flat" : family;
  const box = el("span", `${CLASS}-swatch ${CLASS}-swatch-line ${CLASS}-swatch-line-${family}`);
  const shapes = LINE_SHAPES[family];
  const d = shapes[Math.abs(Math.trunc(variant)) % shapes.length];
  const width = Math.max(SWATCH_W, Math.ceil(options.width ?? SWATCH_W));
  const scaleX = width / SWATCH_W;
  const strokes = layers.map(strokeOf).filter((s): s is Stroke => Boolean(s));
  if (!strokes.length) return { box, d, scaleX, width };

  // A blurred stroke reaches its blur radius beyond its own width on each side
  // (a piste casing at z17 is 49 px wide with a 12 px blur), so stroke and blur
  // share the budget — otherwise the soft edge is cut off by the box. Below the
  // blur cap both scale together; above it the blur is fixed and only the
  // stroke has to fit what is left.
  const fit = (st: Stroke) => {
    const shared = MAX_STROKE / (st.width + 2 * st.blur);
    return st.blur * shared <= MAX_BLUR ? shared : (MAX_STROKE - 2 * MAX_BLUR) / st.width;
  };
  const scale = Math.min(1, ...strokes.map(fit));

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${SWATCH_H}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(SWATCH_H));
  svg.setAttribute("aria-hidden", "true");
  for (const stroke of strokes) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", `${CLASS}-stroke ${CLASS}-stroke-${stroke.role}`);
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", stroke.color);
    path.setAttribute("stroke-width", String(Math.max(0.75, stroke.width * scale)));
    // A swatch is a cut-out of the map: its curve ends are not real line ends,
    // so solid strokes end flush with butt caps regardless of the layer's
    // line-cap. Dashed strokes keep their cap, it shapes every dash (railway
    // hatch ticks, rounded ferry dashes).
    path.setAttribute("stroke-linecap", stroke.dash ? stroke.cap : "butt");
    path.setAttribute("stroke-linejoin", stroke.join);
    if (stroke.opacity < 1) path.setAttribute("stroke-opacity", String(stroke.opacity));
    if (stroke.dash) {
      const dash = stroke.dash.map((d) => round2(Math.max(0.5, d * scale)));
      path.setAttribute("stroke-dasharray", dash.join(" "));
      // start inside the gap so the first dash sits inset from the curve's end
      // instead of being cut by it (a railway's first hatch tick, a ferry's first dash)
      const [on, off = 0] = dash;
      path.setAttribute("stroke-dashoffset", String(round2(-(on + off / 2))));
    }
    if (stroke.blur > 0) path.style.filter = `blur(${Math.min(stroke.blur * scale, MAX_BLUR)}px)`;
    stretchX(path, scaleX);
    if (stroke.gap > 0) svg.appendChild(gapMask(path, d, stroke, scale, scaleX, width));
    svg.appendChild(path);
  }
  box.appendChild(svg);
  return { box, svg, d, scaleX, width };
}

/** Stretch a shape sideways only: the geometry follows, every stroke keeps its width. */
function stretchX(shape: SVGElement, scaleX: number): void {
  if (scaleX === 1) return;
  shape.setAttribute("transform", `scale(${round2(scaleX)} 1)`);
  shape.setAttribute("vector-effect", "non-scaling-stroke");
}

/**
 * A line row, with a label stacked into it (tag `attachesTo`) set on the line
 * itself — the contour's elevation on the contour: along the line where the
 * map places it so, else straight across its middle. The box grows with the
 * name plus the reach; without a label it is the plain bend.
 */
export function createLineSwatch(layers: SwatchLayer[], variant = 0, options: RenderOptions = {}): HTMLElement {
  const label = layers.find((l) => l.type === "symbol" && l.role === "label");
  const raw = label ? valueToString(label.layout["text-field"])?.trim() : undefined;
  if (!label || !raw) return lineSwatchParts(layers, variant).box;
  const text = textStyleFromLayer(label.layout, label.paint);
  const name = truncateName(raw, text, options.maxNameWidth);
  const parts = lineSwatchParts(layers, variant, { width: nameWidth(name, text) + 2 * SYMBOL_REACH, readable: true });
  if (text.alongLine) setNameAlongLine(parts, name, text);
  else setNameStraight(parts, name, text);
  if (parts.width > SWATCH_W) parts.box.style.width = `${parts.width}px`;
  return parts.box;
}

/** How a fill swatch is shaped — by what the layer depicts. */
export type FillShapeFamily = "organic" | "regular" | "geometric";

/**
 * Polygon shapes for fill swatches, per family, in the 64×26 box with a 2px
 * margin, ten per family. Like the line bends, one is picked per entry (see
 * {@link swatchVariantFor}). Organic: smooth, gently wavy outlines that still
 * tend to the rectangle (natural areas, waters). Regular: straight-edged
 * parcels with a clipped corner or a bend (landuse). Geometric: orthogonal
 * building footprints.
 */
export const FILL_SHAPES: Readonly<Record<FillShapeFamily, readonly string[]>> = {
  organic: [
    "M 6 4 C 22 2, 42 2, 58 4 C 62 9, 62 17, 58 22 C 42 24, 22 24, 6 22 C 2 17, 2 9, 6 4 Z",
    "M 4 8 C 8 3, 26 2, 40 4 C 50 2, 62 5, 61 12 C 62 19, 52 24, 40 22 C 28 24, 12 24, 5 21 C 2 18, 2 12, 4 8 Z",
    "M 8 3 C 22 4, 38 2, 54 3 C 62 6, 62 16, 58 22 C 46 24, 30 22, 14 24 C 6 23, 2 18, 3 12 C 3 7, 4 3, 8 3 Z",
    "M 5 6 C 12 3, 22 6, 32 4 C 44 2, 56 3, 60 7 C 62 13, 60 20, 54 23 C 42 24, 30 21, 18 23 C 10 24, 3 21, 3 15 C 3 11, 3 8, 5 6 Z",
    "M 7 4 C 18 2, 34 5, 48 3 C 58 2, 62 8, 61 14 C 62 19, 58 24, 50 23 C 36 24, 22 22, 10 23 C 4 23, 2 18, 3 13 C 2 8, 3 5, 7 4 Z",
    "M 5 5 C 16 3, 30 6, 44 3 C 54 2, 62 6, 61 12 C 60 18, 62 22, 52 23 C 38 24, 24 22, 12 24 C 5 24, 2 19, 3 13 C 3 9, 3 6, 5 5 Z",
    "M 9 3 C 26 2, 44 3, 58 2 C 62 8, 62 14, 60 20 C 56 24, 40 23, 26 24 C 14 24, 6 23, 3 20 C 2 14, 3 8, 9 3 Z",
    "M 4 6 C 12 2, 26 3, 36 5 C 48 7, 58 2, 61 8 C 62 14, 58 18, 59 22 C 46 24, 34 23, 22 24 C 12 24, 3 22, 3 17 C 2 12, 2 8, 4 6 Z",
    "M 6 3 C 20 3, 36 6, 52 3 C 60 2, 62 10, 61 16 C 60 21, 56 24, 46 23 C 32 22, 18 24, 8 23 C 3 22, 2 16, 4 11 C 4 7, 4 4, 6 3 Z",
    "M 3 9 C 6 3, 18 2, 30 3 C 42 4, 52 2, 60 5 C 62 11, 60 16, 61 21 C 52 24, 40 22, 28 23 C 16 24, 6 24, 3 19 C 2 15, 2 12, 3 9 Z",
  ],
  regular: [
    "M 2 3 H 58 L 62 24 H 6 Z",
    "M 2 2 H 54 L 62 10 V 24 H 2 Z",
    "M 5 2 H 62 L 58 24 H 2 Z",
    "M 2 6 L 22 2 H 62 V 20 L 42 24 H 2 Z",
    "M 2 2 H 46 L 62 9 V 24 H 10 L 2 17 Z",
    "M 2 2 H 62 V 18 L 50 24 H 2 Z",
    "M 8 2 H 62 V 24 H 2 V 8 Z",
    "M 2 2 H 44 L 62 4 V 24 H 2 Z",
    "M 2 4 L 62 2 V 22 L 2 24 Z",
    "M 2 2 H 62 V 14 L 40 24 H 2 Z",
  ],
  geometric: [
    "M 2 2 H 62 V 24 H 2 Z",
    "M 2 2 H 40 V 12 H 62 V 24 H 2 Z",
    "M 2 2 H 62 V 24 H 44 V 15 H 20 V 24 H 2 Z",
    "M 2 2 H 50 V 8 H 62 V 24 H 2 Z",
    "M 2 9 H 16 V 2 H 48 V 9 H 62 V 24 H 2 Z",
    "M 2 2 H 34 V 8 H 62 V 24 H 2 Z",
    "M 2 2 H 62 V 16 H 40 V 24 H 2 Z",
    "M 2 8 H 12 V 2 H 62 V 24 H 2 Z",
    "M 2 2 H 62 V 24 H 50 V 18 H 14 V 24 H 2 Z",
    "M 2 2 H 24 V 10 H 40 V 2 H 62 V 24 H 2 Z",
  ],
};

/**
 * The shape family of a fill layer, from its id: buildings are geometric,
 * natural areas and waters organic, landuse and everything else man-made
 * (pedestrian areas, …) regular.
 */
export function fillShapeFamilyFor(layerId: string): FillShapeFamily {
  if (layerId.startsWith("building")) return "geometric";
  if (layerId.startsWith("nature_natural") || layerId.startsWith("water")) return "organic";
  return "regular";
}

let fillSeq = 0;

function shapePath(d: string, className: string): SVGElement {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("class", className);
  path.setAttribute("d", d);
  return path;
}

/**
 * A polygon of the layer's shape family (see {@link FILL_SHAPES}), filled with
 * every fill of the stack in draw order — colour, opacity and sprite pattern —
 * so an opaque base below a half-transparent main reads as on the map;
 * `fill-outline-color` as a hairline and every crisp line layer of the stack
 * (casing, outline, band …) as an inner border with its colour, width, opacity
 * and dash pattern — an intermittent lake keeps its dashed shoreline. Shadow
 * and other blurred strokes lie below the fill as a soft halo along the edge,
 * as on the map.
 */
export function createFillSwatch(layer: SwatchLayer, getImage?: GetImage, supporting: SwatchLayer[] = [], variant = 0): HTMLElement {
  const family = fillShapeFamilyFor(layer.id);
  const shapes = FILL_SHAPES[family];
  const d = shapes[Math.abs(Math.trunc(variant)) % shapes.length];
  const box = el("span", `${CLASS}-swatch ${CLASS}-swatch-fill ${CLASS}-swatch-fill-${family}`);
  const outline = valueToString(layer.paint["fill-outline-color"]);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${SWATCH_W} ${SWATCH_H}`);
  svg.setAttribute("width", String(SWATCH_W));
  svg.setAttribute("height", String(SWATCH_H));
  svg.setAttribute("aria-hidden", "true");
  const defs = document.createElementNS(SVG_NS, "defs");
  svg.appendChild(defs);
  const id = `${CLASS}-fill-${++fillSeq}`;
  const clip = document.createElementNS(SVG_NS, "clipPath");
  clip.setAttribute("id", `${id}-clip`);
  clip.appendChild(shapePath(d, `${CLASS}-fill-clip`));
  defs.appendChild(clip);

  const strokes = supporting.map(strokeOf).filter((st): st is Stroke => Boolean(st));
  // Shadows and other blurred strokes go below the fill: the outer half shows
  // beside the shape as a soft, faded halo — never a crisp frame.
  const halos = strokes.filter((st) => st.role === "shadow" || st.blur > 0);
  for (const st of halos) {
    const path = shapePath(d, `${CLASS}-fill-halo ${CLASS}-fill-halo-${st.role}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", st.color);
    path.setAttribute("stroke-width", String(Math.min(st.width, 8)));
    if (st.opacity < 1) path.setAttribute("stroke-opacity", String(st.opacity));
    path.style.filter = `blur(${Math.min(Math.max(st.blur, 1), 4)}px)`;
    svg.appendChild(path);
  }

  // Every fill of the stack in draw order, each with its own pattern on top of
  // its own colour: a building's opaque base carries the half-transparent
  // footprint above it, exactly as the map stacks them.
  let patterns = 0;
  const fills = [layer, ...supporting.filter((l) => l.type === "fill" || l.type === "fill-extrusion")].sort((a, b) => a.order - b.order);
  for (const f of fills) {
    const extruded = f.type === "fill-extrusion";
    const fillColor = valueToString(f.paint[extruded ? "fill-extrusion-color" : "fill-color"]);
    const fillOpacity = clamp(num(f.paint[extruded ? "fill-extrusion-opacity" : "fill-opacity"], 1), 0, 1);
    if (fillColor) {
      const path = shapePath(d, `${CLASS}-fill ${CLASS}-fill-${f.role}`);
      path.setAttribute("fill", fillColor);
      if (fillOpacity < 1) path.setAttribute("fill-opacity", String(fillOpacity));
      svg.appendChild(path);
    }

    // sprite pattern, tiled at its CSS size
    const name = valueToString(f.paint["fill-pattern"]);
    const image = name && getImage ? getImage(name) : undefined;
    const canvas = image ? imageToCanvas(image) : undefined;
    if (!canvas) continue;
    const ratio = image!.pixelRatio || 1;
    const w = canvas.width / ratio;
    const h = canvas.height / ratio;
    const pattern = document.createElementNS(SVG_NS, "pattern");
    pattern.setAttribute("id", `${id}-pattern-${++patterns}`);
    pattern.setAttribute("patternUnits", "userSpaceOnUse");
    pattern.setAttribute("width", String(w));
    pattern.setAttribute("height", String(h));
    const img = document.createElementNS(SVG_NS, "image");
    img.setAttribute("href", canvas.toDataURL());
    img.setAttribute("width", String(w));
    img.setAttribute("height", String(h));
    pattern.appendChild(img);
    defs.appendChild(pattern);
    const p = shapePath(d, `${CLASS}-pattern`);
    p.setAttribute("fill", `url(#${id}-pattern-${patterns})`);
    if (fillOpacity < 1) p.setAttribute("fill-opacity", String(fillOpacity));
    svg.appendChild(p);
  }

  // hairline and crisp line layers as an inner border: a stroke of twice the
  // width clipped to the shape shows exactly the width, entirely inside
  if (outline) {
    const path = shapePath(d, `${CLASS}-fill-outline`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", outline);
    path.setAttribute("stroke-width", "2");
    path.setAttribute("clip-path", `url(#${id}-clip)`);
    svg.appendChild(path);
  }
  for (const border of strokes.filter((st) => !halos.includes(st))) {
    const width = Math.min(border.width, SWATCH_H / 3); // capped at a third of the height
    const path = shapePath(d, `${CLASS}-border ${CLASS}-border-${border.role}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", border.color);
    path.setAttribute("stroke-width", String(width * 2));
    path.setAttribute("stroke-linejoin", "miter");
    path.setAttribute("clip-path", `url(#${id}-clip)`);
    if (border.opacity < 1) path.setAttribute("stroke-opacity", String(border.opacity));
    if (border.dash) {
      const k = width / border.width; // dash lengths follow the (possibly capped) width
      path.setAttribute("stroke-dasharray", border.dash.map((v) => Math.round(Math.max(0.5, v * k) * 100) / 100).join(" "));
    }
    svg.appendChild(path);
  }
  box.appendChild(svg);
  return box;
}

/** Sprite icon, SDF icons recolored with icon-color (+ halo); falls back to a neutral dot without image/canvas. */
/** The layer's sprite icon as a canvas, recoloured like the map draws it (SDF colour + halo). */
function iconCanvasOf(layer: SwatchLayer, getImage?: GetImage): { canvas: HTMLCanvasElement; ratio: number; image: StyleImageLike } | undefined {
  const name = valueToString(layer.layout["icon-image"]);
  const image = name && getImage ? getImage(name) : undefined;
  const canvas = image
    ? imageToCanvas(image, {
        color: valueToString(layer.paint["icon-color"]),
        haloColor: valueToString(layer.paint["icon-halo-color"]),
        haloWidth: num(layer.paint["icon-halo-width"], 0),
      })
    : undefined;
  return canvas && image ? { canvas, ratio: image.pixelRatio || 1, image } : undefined;
}

export function createIconSwatch(layer: SwatchLayer, getImage?: GetImage): HTMLElement {
  const box = el("span", `${CLASS}-swatch ${CLASS}-swatch-icon`);
  const drawn = iconCanvasOf(layer, getImage);
  const canvas = drawn?.canvas;
  const image = drawn && { pixelRatio: drawn.ratio };
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
/**
 * Stable pseudo-random variant for an entry key (FNV-1a hash), so a legend row
 * keeps its line bend or polygon shape across updates while neighbouring rows
 * differ. The swatch builders reduce it modulo their family's number of shapes.
 */
export function swatchVariantFor(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Pick the swatch shape from the entry's main layer type and hand the stack to the matching builder. */
/**
 * Whether a symbol layer follows its line on the map: placed along the line
 * with map rotation (the default `auto` for a line placement). A shield sets
 * viewport alignment and stays upright.
 */
function followsLine(layout: Record<string, unknown>, kind: "text" | "icon"): boolean {
  const placement = valueToString(layout["symbol-placement"]) ?? "point";
  return placement !== "point" && (valueToString(layout[`${kind}-rotation-alignment`]) ?? "auto") !== "viewport";
}

/** The text style of a symbol layer from its evaluated layout and paint, the way the map draws the label. */
export function textStyleFromLayer(layout: Record<string, unknown>, paint: Record<string, unknown>): TextStyle {
  const fontStack = Array.isArray(layout["text-font"]) ? (layout["text-font"] as unknown[]).map(String) : [];
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const offset = valueToNumbers(layout["text-offset"]);
  // text-variable-anchor lists alternatives the collision pass chooses from; the first one is the preferred placement
  const variable = Array.isArray(layout["text-variable-anchor"]) ? valueToString((layout["text-variable-anchor"] as unknown[])[0]) : undefined;
  const placement = valueToString(layout["symbol-placement"]) ?? "point";
  const rotation = valueToString(layout["text-rotation-alignment"]) ?? "auto";
  return {
    alongLine: placement !== "point" && rotation !== "viewport",
    fontStack,
    size: n(layout["text-size"]),
    color: valueToString(paint["text-color"]),
    haloColor: valueToString(paint["text-halo-color"]),
    haloWidth: n(paint["text-halo-width"]),
    transform: valueToString(layout["text-transform"]),
    letterSpacing: n(layout["text-letter-spacing"]),
    anchor: valueToString(layout["text-anchor"]) ?? variable,
    offset: offset && offset.length >= 2 ? [offset[0], offset[1]] : undefined,
    justify: valueToString(layout["text-justify"]),
    maxWidth: n(layout["text-max-width"]),
    lineHeight: n(layout["text-line-height"]),
  };
}

let measure: CanvasRenderingContext2D | null | undefined;

/**
 * How wide a name is set in its map font: measured on a canvas (a rough
 * estimate where there is none), letter spacing added. Before the webfont has
 * loaded the fallback font is measured — the control renders again once the
 * fonts are in.
 */
export function nameWidth(name: string, text: TextStyle): number {
  const size = clamp(text.size ?? 14, 8, 22);
  const shown = text.transform === "uppercase" ? name.toUpperCase() : text.transform === "lowercase" ? name.toLowerCase() : name;
  if (measure === undefined) measure = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  let width: number | undefined;
  if (measure && typeof measure.measureText === "function") {
    const css = fontStackToCss(text.fontStack);
    measure.font = `${css?.fontStyle ?? "normal"} ${css?.fontWeight ?? "400"} ${size}px ${css?.fontFamily ?? "sans-serif"}`;
    width = measure.measureText(shown).width;
  }
  if (width === undefined || !Number.isFinite(width) || width <= 0) width = shown.length * size * 0.6;
  return width + (text.letterSpacing ?? 0) * size * Math.max(0, shown.length - 1);
}

/** A name shortened with an ellipsis until it measures no wider than `cap`; unchanged without a cap or when it fits. */
export function truncateName(name: string, text: TextStyle, cap?: number): string {
  if (!cap || !(cap > 0) || nameWidth(name, text) <= cap) return name;
  let shown = name;
  while (shown.length > 1) {
    shown = shown.slice(0, -1).trimEnd();
    if (nameWidth(`${shown}…`, text) <= cap) break;
  }
  return `${shown}…`;
}

/**
 * Cap a name in the map font (HTML): its box wraps at the map's `text-max-width`
 * and grows for a longer word up to the cap; a word longer than the cap is cut
 * with an ellipsis (the `-cut` class clips it). Without a cap the stylesheet's
 * `min-width: min-content` keeps every word whole.
 */
function capName(textEl: HTMLElement, name: string, text: TextStyle | undefined, cap: number | undefined): void {
  if (!cap || !(cap > 0)) return;
  const style = text ?? { fontStack: [] };
  const size = clamp(style.size ?? 14, 8, 22);
  const words = name.split(/\s+|(?<=[-/])/).filter(Boolean);
  const longest = Math.max(0, ...words.map((w) => nameWidth(w, style)));
  textEl.style.maxWidth = `${round2(Math.min((style.maxWidth ?? 10) * size, cap))}px`;
  textEl.style.minWidth = `${round2(Math.min(longest, cap))}px`;
  if (longest > cap) textEl.classList.add(`${CLASS}-symbol-text-cut`);
}

/**
 * The direction of a swatch path at its middle, in degrees (clockwise, screen
 * coordinates) — where a symbol placed along the line is turned to on the
 * map. Handles the commands the shapes use (M, H, V, L, C, S).
 */
export function pathMidTangent(d: string): number {
  const points: Array<[number, number]> = [];
  let cur: [number, number] = [0, 0];
  let lastCtrl: [number, number] | undefined;
  const cubic = (p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number]) => {
    for (let i = 1; i <= 16; i++) {
      const t = i / 16,
        u = 1 - t;
      points.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
    lastCtrl = p2;
    cur = p3;
  };
  const lineTo = (p: [number, number]) => {
    cur = p;
    points.push(p);
    lastCtrl = undefined;
  };
  for (const [, cmd, args] of d.matchAll(/([MHVLCS])([^MHVLCS]*)/g)) {
    const n = args
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (cmd === "M") lineTo([n[0], n[1]]);
    else if (cmd === "H") lineTo([n[0], cur[1]]);
    else if (cmd === "V") lineTo([cur[0], n[0]]);
    else if (cmd === "L") for (let i = 0; i + 1 < n.length; i += 2) lineTo([n[i], n[i + 1]]);
    else if (cmd === "C") for (let i = 0; i + 5 < n.length; i += 6) cubic(cur, [n[i], n[i + 1]], [n[i + 2], n[i + 3]], [n[i + 4], n[i + 5]]);
    else if (cmd === "S")
      for (let i = 0; i + 3 < n.length; i += 4) {
        const p1: [number, number] = lastCtrl ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
        cubic(cur, p1, [n[i], n[i + 1]], [n[i + 2], n[i + 3]]);
      }
  }
  if (points.length < 2) return 0;
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  const half = lengths.reduce((a, b) => a + b, 0) / 2;
  let run = 0;
  for (let i = 0; i < lengths.length; i++) {
    run += lengths[i];
    if (run >= half) return (Math.atan2(points[i + 1][1] - points[i][1], points[i + 1][0] - points[i][0]) * 180) / Math.PI;
  }
  return 0;
}

/** Font, size, colour, halo, spacing and case of a map label, on an SVG text element. Returns the size. */
function applySvgTextStyle(target: SVGElement, text: TextStyle): number {
  const css = fontStackToCss(text.fontStack);
  if (css) {
    target.style.fontFamily = css.fontFamily;
    target.style.fontWeight = css.fontWeight;
    target.style.fontStyle = css.fontStyle;
  }
  const size = clamp(text.size ?? 14, 8, 22);
  target.style.fontSize = `${size}px`;
  target.setAttribute("fill", text.color ?? "currentColor");
  if (text.transform && text.transform !== "none") target.style.textTransform = text.transform;
  if (text.letterSpacing) target.style.letterSpacing = `${text.letterSpacing}em`;
  if (text.haloColor && text.haloWidth) {
    // the halo is a stroke around the glyphs, painted below the fill (see the stylesheet's paint-order)
    target.setAttribute("stroke", text.haloColor);
    target.setAttribute("stroke-width", String(round2(2 * Math.min(text.haloWidth, 2.5))));
  }
  return size;
}

let guideSeq = 0;

/**
 * The name set along the swatch's line, as the map sets it: on an invisible
 * guide with the (stretched) shape, centred, glyphs turning with the bend,
 * `text-offset` as a shift off the line.
 */
function setNameAlongLine(parts: LineSwatchParts, name: string, text: TextStyle): void {
  if (!parts.svg) return;
  const id = `${CLASS}-guide-${++guideSeq}`;
  const guide = document.createElementNS(SVG_NS, "path");
  guide.setAttribute("id", id);
  guide.setAttribute("d", parts.d);
  guide.setAttribute("fill", "none");
  stretchX(guide, parts.scaleX);
  const textEl = document.createElementNS(SVG_NS, "text");
  textEl.setAttribute("class", `${CLASS}-text-on-path`);
  textEl.setAttribute("text-anchor", "middle");
  textEl.setAttribute("dominant-baseline", "central");
  const size = applySvgTextStyle(textEl, text);
  const [, oy = 0] = text.offset ?? [0, 0];
  if (oy) textEl.setAttribute("dy", String(round2(oy * size)));
  const along = document.createElementNS(SVG_NS, "textPath");
  along.setAttribute("href", `#${id}`);
  along.setAttribute("startOffset", "50%");
  along.textContent = name.replace(/\s*\n\s*/g, " "); // one line along the way
  textEl.appendChild(along);
  parts.svg.append(guide, textEl);
}

/** The name set straight across the swatch's middle, as the map sets a point-placed label: upright, centred, `text-offset` as a shift. */
function setNameStraight(parts: LineSwatchParts, name: string, text: TextStyle): void {
  if (!parts.svg) return;
  const textEl = document.createElementNS(SVG_NS, "text");
  textEl.setAttribute("class", `${CLASS}-text-on-path`);
  textEl.setAttribute("text-anchor", "middle");
  textEl.setAttribute("dominant-baseline", "central");
  const size = applySvgTextStyle(textEl, text);
  const [ox = 0, oy = 0] = text.offset ?? [0, 0];
  textEl.setAttribute("x", String(round2(parts.width / 2 + ox * size)));
  textEl.setAttribute("y", String(round2(SWATCH_H / 2 + oy * size)));
  textEl.textContent = name.replace(/\s*\n\s*/g, " ");
  parts.svg.appendChild(textEl);
}

/**
 * A symbol on the feature it sits on: the anchor entry's swatch under the
 * symbol — a shield on its route, a river name on its waterway. The swatch
 * stretches to a name wider than it (the shape only, every stroke keeps its
 * width) and reaches a little beyond it: a line runs on past both ends of the
 * name, a surface encloses it on every side. A name the map sets along its
 * line follows the bend here too, an arrow turns into the line's direction; a
 * shield stays upright, as on the map.
 */
export function createSymbolOnSwatch(
  entry: { name?: string; text?: TextStyle; icon?: SwatchLayer; anchor: { swatch: SwatchLayer[]; variant: number } },
  getImage?: GetImage,
  options: RenderOptions = {},
): HTMLElement {
  const box = el("span", `${CLASS}-symbol-on`);
  const main = entry.anchor.swatch.find((l) => l.role === "main") ?? entry.anchor.swatch[0];
  const isFill = main?.type === "fill" || main?.type === "fill-extrusion";
  // a surface encloses the name, a line runs on past its ends (see the stylesheet)
  box.classList.add(`${CLASS}-symbol-on-${isFill ? "fill" : "line"}`);

  if (main?.type === "line" && entry.name && entry.text?.alongLine && !entry.icon) {
    // set along the line inside the SVG, which sizes itself to the name plus the reach
    const name = truncateName(entry.name, entry.text, options.maxNameWidth);
    const parts = lineSwatchParts(entry.anchor.swatch, entry.anchor.variant, { width: nameWidth(name, entry.text) + 2 * SYMBOL_REACH, readable: true });
    setNameAlongLine(parts, name, entry.text);
    box.classList.add(`${CLASS}-symbol-on-path`);
    box.appendChild(parts.box);
    return box;
  }

  const base = createSwatch(entry.anchor.swatch, getImage, entry.anchor.variant);
  const svg = base.querySelector("svg");
  if (svg) {
    svg.setAttribute("preserveAspectRatio", "none");
    for (const shape of svg.querySelectorAll("path, rect, circle, ellipse")) shape.setAttribute("vector-effect", "non-scaling-stroke");
  }
  box.appendChild(base);
  const symbol = createSymbolPreview(entry, getImage, options);
  if (entry.icon && main?.type === "line" && followsLine(entry.icon.layout, "icon")) {
    // a one-way arrow points along its street
    const d = svg?.querySelector("path")?.getAttribute("d");
    const icon = symbol.querySelector<HTMLElement>(`.${CLASS}-symbol-icon`);
    if (d && icon) icon.style.transform = `rotate(${round2(pathMidTangent(d))}deg)`;
  }
  box.appendChild(symbol);
  return box;
}

export function createSwatch(layers: SwatchLayer[], getImage?: GetImage, variant = 0, options: RenderOptions = {}): HTMLElement {
  const main = layers.find((l) => l.role === "main") ?? layers[0];
  if (!main) return el("span", `${CLASS}-swatch ${CLASS}-swatch-empty`);
  switch (main.type) {
    case "line":
      return createLineSwatch(layers, variant, options);
    case "fill":
    case "fill-extrusion":
      return createFillSwatch(
        main,
        getImage,
        layers.filter((l) => l !== main),
        variant,
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
/**
 * `icon-text-fit`: the map stretches the icon around the text box and pads it
 * by `icon-text-fit-padding` ([top, right, bottom, left], scaled by
 * `icon-size`). A road or hiking shield is exactly that — a square that grows
 * with its number — so the icon becomes the text's stretched background
 * instead of a picture of its own. An asymmetric padding shifts the text
 * inside the shield, as on the map.
 */
function fitIconBehind(textEl: HTMLElement, icon: SwatchLayer, text?: TextStyle, getImage?: GetImage): boolean {
  const fit = valueToString(icon.layout["icon-text-fit"]);
  if (!fit || fit === "none") return false;
  // without a drawable canvas the caller falls back to the plain icon
  const drawn = iconCanvasOf(icon, getImage);
  if (!drawn) return false;

  const scale = num(icon.layout["icon-size"], 1);
  const [top = 0, right = 0, bottom = 0, left = 0] = (valueToNumbers(icon.layout["icon-text-fit-padding"]) ?? []).map((v) => v * scale);
  const content = drawn.image.content;
  const px = (v: number) => `${Math.round(v * 100) / 100}px`;

  textEl.classList.add(`${CLASS}-symbol-fitted`);
  if (content) {
    // A stretchable sprite: only the middle grows, the frame around `content`
    // keeps its size — exactly what border-image does. The frame is drawn
    // outside the padding, so the text keeps the room the style gives it.
    const { width, height } = drawn.image.data;
    const r = drawn.ratio || 1;
    const slice = [content[1], width - content[2], height - content[3], content[0]]; // top right bottom left, image px
    textEl.style.padding = fit === "height" ? `${px(top)} 0 ${px(bottom)}` : `${px(top)} ${px(right)} ${px(bottom)} ${px(left)}`;
    textEl.style.borderStyle = "solid";
    textEl.style.borderColor = "transparent";
    textEl.style.borderWidth = slice.map((v) => px((v * scale) / r)).join(" ");
    textEl.style.borderImageSource = `url(${drawn.canvas.toDataURL()})`;
    textEl.style.borderImageSlice = `${slice.join(" ")} fill`;
    textEl.style.borderImageWidth = slice.map((v) => px((v * scale) / r)).join(" ");
  } else {
    // A plain icon: stretch the whole image, and give a short ref some air of
    // its own — without a frame the shape would otherwise hug the glyphs.
    const em = clamp(num(text?.size, 14), 8, 22);
    const side = px(Math.max(right, left, em * 0.35));
    const [above, below] = [px(Math.max(top, em * 0.12)), px(Math.max(bottom, em * 0.12))];
    textEl.style.padding = fit === "height" ? `${above} 0 ${below}` : `${above} ${side} ${below}`;
    textEl.style.backgroundImage = `url(${drawn.canvas.toDataURL()})`;
  }
  // the box is exactly the text: no wrapping cap, no shrinking — otherwise the
  // icon would end up smaller than the name it carries
  textEl.style.width = "max-content";
  textEl.style.maxWidth = "none";
  textEl.style.opacity = String(clamp(num(icon.paint["icon-opacity"], 1), 0, 1));
  return true;
}

/**
 * The name, with a break opportunity after every slash. CSS breaks at spaces
 * and hyphens by itself; a slash is where a map name like "Wien/Vienna" wants
 * to break too, and `<wbr>` offers exactly that without changing the text.
 */
function setName(target: HTMLElement, name: string): void {
  const parts = name.split("/");
  target.textContent = "";
  parts.forEach((part, i) => {
    const last = i === parts.length - 1;
    target.append(last ? part : `${part}/`);
    if (!last) target.append(document.createElement("wbr"));
  });
}

export function createSymbolPreview(
  entry: { name?: string; text?: TextStyle; icon?: SwatchLayer },
  getImage?: GetImage,
  options: RenderOptions = {},
): HTMLElement {
  const box = el("span", `${CLASS}-symbol`);

  let textEl: HTMLElement | undefined;
  if (entry.name) {
    textEl = el("span", `${CLASS}-symbol-text`);
    setName(textEl, entry.name);
    if (entry.text) applyTextStyle(textEl, entry.text);
    capName(textEl, entry.name, entry.text, options.maxNameWidth);
  }
  // A shield: the icon is stretched behind the text, so it is not a picture of
  // its own. Where that cannot be drawn, the plain icon beside the text stands in.
  const fitted = Boolean(entry.icon && textEl) && fitIconBehind(textEl!, entry.icon!, entry.text, getImage);

  const placement = textPlacement(entry.text);
  box.classList.add(`${CLASS}-symbol-${entry.icon && entry.name && !fitted ? placement : "single"}`);

  let iconEl: HTMLElement | undefined;
  if (entry.icon && !fitted) {
    iconEl = createIconSwatch(entry.icon, getImage);
    iconEl.classList.add(`${CLASS}-symbol-icon`);
    box.appendChild(iconEl);
  }
  if (textEl) {
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
