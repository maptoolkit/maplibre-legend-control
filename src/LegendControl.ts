import type { Map, IControl, ControlPosition } from "maplibre-gl";
import { buildLegendModel } from "./model";
import { applyTextStyle, createIconSwatch, createSwatch, type GetImage } from "./swatch";
import { LEGEND_METADATA_KEY, type LegendManifest, type LegendModel, type RenderedFeature } from "./types";

/**
 * Options for configuring the {@link LegendControl}.
 */
export type LegendControlOptions = {
  /**
   * Whether the legend panel starts collapsed to its title.
   * @defaultValue `false`
   */
  collapsed?: boolean;
  /**
   * Language of the entry and group labels (`de`, `en`, …), looked up in the
   * style's legend manifest. Falls back to English, then to the humanized key.
   * @defaultValue the page language (`<html lang>`), else the browser language, else `en`
   */
  language?: string;
  /**
   * Named features whose anchor lies within this many pixels of the viewport
   * edge lose against features further inside when the legend picks the
   * representative of a type — their labels are usually cut off.
   * @defaultValue `24`
   */
  edgeMargin?: number;
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
};

/**
 * Default options for the {@link LegendControl}.
 */
export const defaultLegendControlOptions: LegendControlOptions = {
  collapsed: false,
  edgeMargin: 24,
  updateDelay: 100,
};

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
  private _header?: HTMLButtonElement;
  private _list?: HTMLElement;
  private _timer?: ReturnType<typeof setTimeout>;
  private _model?: LegendModel;
  private _dirty = true;
  private _onIdle = () => this._scheduleUpdate();

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

    this._container = document.createElement("div");
    this._container.classList.add("maplibregl-ctrl", "maplibregl-ctrl-group", CLASS);
    if (this.options.collapsed) this._container.classList.add(`${CLASS}-collapsed`);

    const header = document.createElement("button");
    header.type = "button";
    header.classList.add(`${CLASS}-header`);
    header.title = getUIString(map, "LegendControl.Toggle");
    header.setAttribute("aria-expanded", String(!this.options.collapsed));
    const title = document.createElement("span");
    title.classList.add(`${CLASS}-title`);
    title.textContent = getUIString(map, "LegendControl.Title");
    header.appendChild(title);
    header.addEventListener("click", () => this.toggle());
    this._container.appendChild(header);
    this._header = header;

    this._list = document.createElement("div");
    this._list.classList.add(`${CLASS}-list`);
    this._container.appendChild(this._list);

    map.on("idle", this._onIdle);
    this._scheduleUpdate();

    return this._container;
  }

  onRemove() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = undefined;
    this._map?.off("idle", this._onIdle);
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._container = undefined;
    this._list = undefined;
    this._header = undefined;
    this._map = undefined;
  }

  /** Expand the panel. */
  open() {
    this._container?.classList.remove(`${CLASS}-collapsed`);
    this._header?.setAttribute("aria-expanded", "true");
    if (this._dirty) this.update();
  }

  /** Collapse the panel to its title. */
  close() {
    this._container?.classList.add(`${CLASS}-collapsed`);
    this._header?.setAttribute("aria-expanded", "false");
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
    const features = map.queryRenderedFeatures() as unknown as RenderedFeature[];

    let model = buildLegendModel({
      features,
      manifest,
      layerOrder,
      language: this.options.language ?? detectLanguage(),
      viewport: {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        project: (lngLat) => map.project(lngLat),
      },
      edgeMargin: this.options.edgeMargin ?? 24,
    });
    if (this.options.groups) {
      const allowed = new Set(this.options.groups);
      model = { groups: model.groups.filter((g) => allowed.has(g.id)) };
    }
    this._model = model;
    this._dirty = false;
    this._render(model);
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

        li.appendChild(entry.kind === "instance" ? (entry.icon ? createIconSwatch(entry.icon, getImage) : blankSwatch()) : createSwatch(entry.swatch, getImage));

        const text = document.createElement("span");
        text.classList.add(`${CLASS}-text`);
        if (entry.kind === "instance") {
          const name = document.createElement("span");
          name.classList.add(`${CLASS}-name`);
          name.textContent = entry.name ?? "";
          if (entry.text) applyTextStyle(name, entry.text);
          text.appendChild(name);
          const type = document.createElement("span");
          type.classList.add(`${CLASS}-type`);
          type.textContent = entry.label;
          text.appendChild(type);
        } else {
          const label = document.createElement("span");
          label.classList.add(`${CLASS}-label`);
          label.textContent = entry.label;
          text.appendChild(label);
        }
        li.appendChild(text);
        ul.appendChild(li);
      }
      section.appendChild(ul);
      list.appendChild(section);
    }
  }
}

function blankSwatch(): HTMLElement {
  const s = document.createElement("span");
  s.classList.add(`${CLASS}-swatch`, `${CLASS}-swatch-empty`);
  return s;
}
