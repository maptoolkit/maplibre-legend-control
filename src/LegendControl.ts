import type { Map, IControl, ControlPosition } from "maplibre-gl";
import { buildLegendModel, featureIdentity, valueToString } from "./model";
import { createSwatch, createSymbolPreview, swatchVariantFor, type GetImage } from "./swatch";
import { LEGEND_METADATA_KEY, type LegendManifest, type LegendModel, type RenderedFeature } from "./types";

/**
 * Options for configuring the {@link LegendControl}.
 */
export type LegendControlOptions = {
  /**
   * Whether the panel starts hidden; the toggle button or `open()` shows it
   * and updates are deferred until then.
   * @defaultValue `false`
   */
  collapsed?: boolean;
  /**
   * Render a MapLibre control button that shows and hides the panel; in a map
   * corner the panel opens beside it. Hosts with their own trigger (a toolbar
   * button) set `false` and use `open()`/`close()`.
   * @defaultValue `true`
   */
  toggle?: boolean;
  /**
   * Language of the entry and group labels (`de`, `en`, …), looked up in the
   * style's legend manifest. Falls back to English, then to the humanized key.
   * @defaultValue the page language (`<html lang>`), else the browser language, else `en`
   */
  language?: string;
  /**
   * Only labels whose rendered box (icon and text) lies entirely inside the
   * visible map minus this fraction of the width/height on every side are
   * listed. `0` accepts every rendered label, however much the edge cuts it.
   * @defaultValue `0.05`
   */
  edgeBuffer?: number;
  /**
   * Restrict the legend to these groups (`road`, `water`, `nature`, `border`,
   * `building`, `relief`, `place`, `poi`). All groups when omitted.
   */
  groups?: string[];
  /**
   * Debounce between the map settling (`idle`) and the legend update, in ms.
   * @defaultValue `100`
   */
  updateDelay?: number;
  /**
   * Maximum height of the legend as a fraction of the map container's height;
   * the list scrolls beyond it. The width follows the content (no label is
   * clipped) up to the map's width.
   * @defaultValue `0.6`
   */
  maxHeightRatio?: number;
  /**
   * Panel background: `"auto"` takes the style's `background` layer colour at
   * the current zoom (so names and swatches sit on the same ground as on the
   * map), falling back to `hsl(90, 23%, 95%)` when the style has none; any CSS
   * colour string fixes the background instead. Text colours switch to light
   * on dark backgrounds.
   * @defaultValue `"auto"`
   */
  background?: "auto" | string;
};

/**
 * Default options for the {@link LegendControl}.
 */
export const defaultLegendControlOptions: LegendControlOptions = {
  collapsed: false,
  toggle: true,
  edgeBuffer: 0.05,
  updateDelay: 100,
  maxHeightRatio: 0.6,
  background: "auto",
};

/** Used when the style has no background layer (or its colour cannot be read). */
export const FALLBACK_BACKGROUND = "hsl(90, 23%, 95%)";

const CLASS = "maplibre-legend-control";

// `_locale`/`_getUIString` are undocumented on Map; cast here so `LegendControl.*`
// keys work with the same `new Map({ locale })` table as built-in controls.
function getMapLocale(map: Map): Record<string, string> {
  return (map as unknown as { _locale: Record<string, string> })._locale;
}

function getUIString(map: Map, key: string): string {
  return (map as unknown as { _getUIString(key: string): string })._getUIString(key);
}

function detectLanguage(): string {
  const doc = typeof document !== "undefined" ? document.documentElement.lang : "";
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  return (doc || nav || "en").slice(0, 2).toLowerCase();
}

/**
 * Provides a legend control that lists the map features currently visible in
 * the viewport, grouped and labelled from the style's `maptoolkit:legend`
 * metadata (written by `@maptoolkit/style-family`).
 *
 * Every rendered feature is read once the map is idle: main layers become
 * class entries (one swatch built from the layer and its casing/blur/texture
 * layers), standalone label layers become instance entries showing the most
 * prominent named feature per type in the map's own font.
 */
export class LegendControl implements IControl {
  options: LegendControlOptions;
  private _map?: Map;
  private _container?: HTMLElement;
  private _panel?: HTMLElement;
  private _toggleButton?: HTMLButtonElement;
  private _list?: HTMLElement;
  private _timer?: ReturnType<typeof setTimeout>;
  private _model?: LegendModel;
  private _dirty = true;
  private _onIdle = () => this._scheduleUpdate();
  private _onResize = () => this._fitToMap();

  /**
   * @param options - Options for configuring the legend control.
   */
  constructor(options?: LegendControlOptions) {
    this.options = Object.assign({}, defaultLegendControlOptions, options);
  }

  getDefaultPosition(): ControlPosition {
    // Not bottom-left: that corner is taken by the logo control, whose position
    // is fixed by the attribution requirement.
    return "top-right";
  }

  onAdd(map: Map) {
    this._map = map;

    const locale = getMapLocale(map);
    locale["LegendControl.Title"] ??= "Legend";
    locale["LegendControl.Empty"] ??= "Nothing to show in this view";
    locale["LegendControl.Toggle"] ??= "Show or hide the legend";

    // a transparent column: [toggle button] + panel (the card)
    this._container = document.createElement("div");
    this._container.classList.add("maplibregl-ctrl", CLASS);
    if (this.options.collapsed) this._container.classList.add(`${CLASS}-collapsed`);

    if (this.options.toggle !== false) {
      // a MapLibre control button — maplibregl-ctrl-group + .maplibregl-ctrl-icon give it the native look
      this._container.classList.add(`${CLASS}-with-toggle`);
      const group = document.createElement("div");
      group.classList.add("maplibregl-ctrl-group", `${CLASS}-toggle`);
      const button = document.createElement("button");
      button.type = "button";
      button.title = getUIString(map, "LegendControl.Toggle");
      button.setAttribute("aria-label", getUIString(map, "LegendControl.Toggle"));
      button.setAttribute("aria-expanded", String(!this.options.collapsed));
      const icon = document.createElement("span");
      icon.classList.add("maplibregl-ctrl-icon");
      icon.setAttribute("aria-hidden", "true");
      button.appendChild(icon);
      button.addEventListener("click", () => this.toggle());
      group.appendChild(button);
      this._container.appendChild(group);
      this._toggleButton = button;
    }

    // the card; no visible header — the title is its accessible name only
    this._panel = document.createElement("div");
    this._panel.classList.add(`${CLASS}-panel`);
    this._panel.setAttribute("role", "region");
    this._panel.setAttribute("aria-label", getUIString(map, "LegendControl.Title"));
    this._list = document.createElement("div");
    this._list.classList.add(`${CLASS}-list`);
    this._panel.appendChild(this._list);
    this._container.appendChild(this._panel);

    map.on("idle", this._onIdle);
    map.on("resize", this._onResize);
    this._fitToMap();
    this._scheduleUpdate();

    return this._container;
  }

  onRemove() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = undefined;
    this._map?.off("idle", this._onIdle);
    this._map?.off("resize", this._onResize);
    this._raise(false);
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._container = undefined;
    this._panel = undefined;
    this._toggleButton = undefined;
    this._list = undefined;
    this._map = undefined;
  }

  /** Show the panel (and catch up on a deferred update). */
  open() {
    this._container?.classList.remove(`${CLASS}-collapsed`);
    this._toggleButton?.setAttribute("aria-expanded", "true");
    this._raise(true);
    if (this._dirty) this.update();
  }

  /** Hide the panel; updates are deferred until it is shown again. */
  close() {
    this._container?.classList.add(`${CLASS}-collapsed`);
    this._toggleButton?.setAttribute("aria-expanded", "false");
    this._raise(false);
  }

  /** In a map corner the open panel overlays the neighbouring controls (like maplibre-style-control). */
  private _raise(open: boolean) {
    const corner = this._toggleButton ? this._container?.parentElement : undefined;
    if (corner && /\bmaplibregl-ctrl-(top|bottom)-/.test(corner.className)) corner.style.zIndex = open ? "99" : "";
  }

  toggle() {
    if (this._container?.classList.contains(`${CLASS}-collapsed`)) this.open();
    else this.close();
  }

  /** The model behind the current rendering (groups → entries), for tests and integrations. */
  getModel(): LegendModel | undefined {
    return this._model;
  }

  /**
   * Re-read the rendered features and redraw the list now. Called automatically
   * (debounced) whenever the map becomes idle; a collapsed panel defers the
   * work until it is opened.
   */
  update() {
    const map = this._map;
    if (!map || !this._list) return;
    if (this._container?.classList.contains(`${CLASS}-collapsed`)) {
      this._dirty = true;
      return;
    }
    const style = map.getStyle();
    const manifest = (style?.metadata as Record<string, unknown> | undefined)?.[LEGEND_METADATA_KEY] as LegendManifest | undefined;
    const layerOrder = new globalThis.Map<string, number>((style?.layers ?? []).map((l, i) => [l.id, i]));
    const canvas = map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const features = map.queryRenderedFeatures() as unknown as RenderedFeature[];

    let model = buildLegendModel({
      features,
      manifest,
      layerOrder,
      language: this.options.language ?? detectLanguage(),
      viewport: { width, height, project: (lngLat) => map.project(lngLat) },
      isFullyVisible: this._fullyVisibleTest(width, height),
    });
    if (this.options.groups) {
      const allowed = new Set(this.options.groups);
      model = { groups: model.groups.filter((g) => allowed.has(g.id)) };
    }
    this._model = model;
    this._dirty = false;
    this._render(model);
    this._fitToMap();
    this._applyBackground();
  }

  /**
   * Paint the panel in the map's background colour. The `background` layer's
   * colour is usually a zoom expression, so the value evaluated for the current
   * zoom is read from MapLibre's style layer (`map.style.getLayer(id).paint`,
   * not part of the public API — guarded, with the raw string or the fallback
   * colour when unavailable).
   */
  private _applyBackground() {
    const map = this._map;
    const container = this._container;
    if (!map || !container) return;
    const wanted = this.options.background ?? "auto";
    const color = (wanted === "auto" ? backgroundColorOf(map) : wanted) ?? FALLBACK_BACKGROUND;
    container.style.setProperty("--legend-control-bg-color", color);

    const dark = isDark(color);
    const set = (name: string, value: string) => (dark ? container.style.setProperty(name, value) : container.style.removeProperty(name));
    set("--legend-control-color-fg-strong", "rgba(255, 255, 255, 0.92)");
    set("--legend-control-color-fg-muted", "rgba(255, 255, 255, 0.7)");
    set("--legend-control-border-color", "rgba(255, 255, 255, 0.16)");
    set("--legend-control-scrollbar-thumb", "rgba(255, 255, 255, 0.3)");
    container.classList.toggle(`${CLASS}-dark`, dark);
  }

  /**
   * A label is fully visible when its rendered box touches none of the four
   * edge bands (`edgeBuffer` of the width/height each). `queryRenderedFeatures`
   * with a box returns every symbol whose placed icon+text box intersects it,
   * so querying the bands yields exactly the labels cut by the edge or the
   * buffer — no estimate of text extents needed.
   */
  private _fullyVisibleTest(width: number, height: number): ((feature: RenderedFeature) => boolean) | undefined {
    const map = this._map;
    const buffer = this.options.edgeBuffer ?? 0.05;
    if (!map || buffer <= 0 || width <= 0 || height <= 0) return undefined;
    const bx = Math.max(1, Math.round(width * buffer));
    const by = Math.max(1, Math.round(height * buffer));
    const bands: Array<[[number, number], [number, number]]> = [
      [
        [0, 0],
        [width, by],
      ], // top
      [
        [0, height - by],
        [width, height],
      ], // bottom
      [
        [0, 0],
        [bx, height],
      ], // left
      [
        [width - bx, 0],
        [width, height],
      ], // right
    ];
    const cut = new Set<string>();
    for (const band of bands) {
      for (const f of map.queryRenderedFeatures(band) as unknown as RenderedFeature[]) {
        if (f.layer.type === "symbol") cut.add(`${f.layer.id}|${featureIdentity(f)}`);
      }
    }
    return (feature) => !cut.has(`${feature.layer.id}|${featureIdentity(feature)}`);
  }

  /** Cap the panel at `maxHeightRatio` of the map's height and at the map's width; the list scrolls. */
  private _fitToMap() {
    const map = this._map;
    if (!map || !this._container || !this._panel || !this._list) return;
    const box = map.getContainer();
    const height = box?.clientHeight ?? 0;
    const width = box?.clientWidth ?? 0;
    if (height > 0) {
      const ratio = this.options.maxHeightRatio ?? 0.6;
      this._list.style.maxHeight = `${Math.max(48, Math.round(height * ratio))}px`;
    }
    if (width > 0) {
      // beside the toggle button in a left/right map corner the panel starts a button width further in
      const beside = Boolean(this._toggleButton) && /\bmaplibregl-ctrl-(top|bottom)-(left|right)\b/.test(this._container.parentElement?.className ?? "");
      this._panel.style.maxWidth = `${Math.max(160, width - (beside ? 60 : 20))}px`;
    }
  }

  private _scheduleUpdate() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = undefined;
      this.update();
    }, this.options.updateDelay ?? 100);
  }

  private _render(model: LegendModel) {
    const map = this._map;
    const list = this._list;
    if (!map || !list) return;
    const getImage: GetImage = (id) => {
      try {
        return map.getImage(id) as unknown as ReturnType<GetImage>;
      } catch {
        return undefined;
      }
    };

    list.replaceChildren();
    if (!model.groups.length) {
      const empty = document.createElement("p");
      empty.classList.add(`${CLASS}-empty`);
      empty.textContent = getUIString(map, "LegendControl.Empty");
      list.appendChild(empty);
      return;
    }

    for (const group of model.groups) {
      const section = document.createElement("section");
      section.classList.add(`${CLASS}-group`);
      section.dataset.group = group.id;

      const heading = document.createElement("h3");
      heading.classList.add(`${CLASS}-group-name`);
      heading.textContent = group.label;
      section.appendChild(heading);

      const ul = document.createElement("ul");
      ul.classList.add(`${CLASS}-entries`);
      for (const entry of group.entries) {
        const li = document.createElement("li");
        li.classList.add(`${CLASS}-entry`, `${CLASS}-entry-${entry.kind}`);
        li.dataset.key = entry.key;

        // left: what the map shows (swatch of the layer stack, or the symbol with its label); right: the explanation.
        // Every block is centred on the column's axis; text-justify only aligns the lines inside the block
        // (a peak keeps its elevation left-aligned under the name).
        const visual = document.createElement("span");
        visual.classList.add(`${CLASS}-visual`);
        visual.appendChild(
          entry.kind === "instance" ? createSymbolPreview(entry, getImage) : createSwatch(entry.swatch, getImage, swatchVariantFor(entry.key)),
        );
        li.appendChild(visual);

        const label = document.createElement("span");
        label.classList.add(`${CLASS}-label`);
        label.textContent = entry.label;
        li.appendChild(label);
        ul.appendChild(li);
      }
      section.appendChild(ul);
      list.appendChild(section);
    }
  }
}

/** The style's background colour evaluated for the current zoom, or `undefined`. */
export function backgroundColorOf(map: Map): string | undefined {
  const layer = map.getStyle()?.layers?.find((l) => l.type === "background");
  if (!layer) return undefined;
  try {
    const internal = (map as unknown as { style?: { getLayer?: (id: string) => { paint?: { get?: (name: string) => unknown } } | undefined } }).style;
    const evaluated = valueToString(internal?.getLayer?.(layer.id)?.paint?.get?.("background-color"));
    if (evaluated) return evaluated;
  } catch {
    // fall through to the raw value
  }
  const raw = (layer as { paint?: Record<string, unknown> }).paint?.["background-color"];
  return typeof raw === "string" ? raw : undefined;
}

/** Rough relative luminance test for `rgb(a)`/`hsl(a)`/hex colours; unknown formats count as light. */
export function isDark(color: string): boolean {
  let r: number | undefined, g: number | undefined, b: number | undefined;
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(color);
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color);
  const hsl = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i.exec(color);
  if (rgb) [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  else if (hex) {
    const h =
      hex[1].length < 6
        ? hex[1]
            .split("")
            .map((c) => c + c)
            .join("")
        : hex[1];
    [r, g, b] = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  } else if (hsl) return Number(hsl[3]) < 45;
  if (r === undefined || g === undefined || b === undefined) return false;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
}
