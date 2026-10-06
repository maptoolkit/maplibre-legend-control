import type { Map, IControl, ControlPosition } from "maplibre-gl";
import { buildLegendModel, tagIn, featureIdentity, valueToString } from "./model";
import { legendLocaleFor } from "./locales";
import { createSwatch, createSymbolOnSwatch, createSymbolPreview, lineFitScale, type GetImage, type RenderOptions } from "./swatch";
import { LEGEND_METADATA_KEY, type LegendEntry, type LegendManifest, type LegendModel, type RenderedFeature } from "./types";

/**
 * What the legend needs of a `StyleControl` from `@maptoolkit/maplibre-style-control`
 * to live in its panel (`button: "style-control"`): its public `close()`. The
 * control's DOM is found through its container; the package is not a dependency.
 */
export type StyleControlLike = {
  close(): void;
};

/**
 * Options for configuring the {@link LegendControl}.
 */
export type LegendControlOptions = {
  /**
   * Whether the panel starts hidden; the button or `open()` shows it and
   * updates are deferred until then.
   * @defaultValue `true` with the control's own button, `false` with `toggle: false`
   * (the host opens the control by mounting it)
   */
  collapsed?: boolean;
  /**
   * Render a MapLibre control button that shows and hides the panel; in a map
   * corner the panel opens below or above it. Hosts with their own trigger (a toolbar
   * button) set `false` and use `open()`/`close()`.
   * @defaultValue `true`
   */
  toggle?: boolean;
  /**
   * What the toggle button shows: an icon of a legend row followed by the
   * word for "legend" in the control's language (`LegendControl.Label`), or
   * the icon alone. `"style-control"` puts no button in the corner: the
   * legend becomes a row at the foot of the style control's panel (pass that
   * control as `styleControl`, added to the map before the legend), and its
   * panel opens where the style panel was; a click on the style tile brings
   * the style panel back. Without a style control on the map it falls back to `"icon-text"`.
   * `"attribution"` sets the word for "legend", bold, in front of MapLibre's
   * attribution ("Legend | MapLibre | © …") while the bar is expanded; collapsed
   * to its ⓘ, the bar shows no word (an open panel stays open). The panel opens
   * above the bar. Without an attribution control on the map it falls back to
   * `"icon-text"`.
   * @defaultValue `"icon-text"`
   */
  button?: "icon-text" | "icon" | "style-control" | "attribution";
  /**
   * The style control whose panel hosts the legend with `button: "style-control"`.
   */
  styleControl?: StyleControlLike;
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
   * How wide a name in the map font may grow: the smaller of `px` and
   * `fraction` of the room the panel has (the map's width, less the panel's
   * offset from the far edge). A word longer than that is cut with an
   * ellipsis, a name set along a line is shortened to fit; the map's own
   * line wrapping applies below the cap. `false` lifts the cap.
   * @defaultValue `{ fraction: 0.5, px: 260 }`
   */
  maxNameWidth?: { fraction?: number; px?: number } | false;
  /**
   * Rows none of whose layers reaches this opacity are left out — a fill
   * fading in between zooms, a stroke at 0.02. The opacity of a layer is its
   * `*-opacity` times the alpha of its colour. `0` keeps every row.
   * @defaultValue `0.1`
   */
  minOpacity?: number;
  /**
   * Panel background: `"auto"` takes the style's `background` layer colour at
   * the current zoom (so names and swatches sit on the same ground as on the
   * map), falling back to `hsl(90, 23%, 95%)` when the style has none; any CSS
   * colour string fixes the background instead. Text colours switch to light
   * on dark backgrounds.
   * @defaultValue `"auto"`
   */
  background?: "auto" | string;
  /**
   * Where the map's typefaces are served as web fonts: a stylesheet URL that
   * is linked into the page once, so names appear in the font the map draws
   * them in (the browser fetches only the faces the legend uses). Left unset,
   * the URL comes from the style itself — `fonts.css` in its legend manifest,
   * which Maptoolkit styles carry. A string overrides it, `false` links
   * nothing (the page provides its own fonts).
   * @defaultValue from the style's legend manifest
   */
  fonts?: string | false;
};

/**
 * Default options for the {@link LegendControl}.
 */
export const defaultLegendControlOptions: LegendControlOptions = {
  toggle: true,
  button: "icon-text",
  edgeBuffer: 0.05,
  updateDelay: 100,
  maxHeightRatio: 0.6,
  maxNameWidth: { fraction: 0.5, px: 260 },
  minOpacity: 0.1,
  background: "auto",
};

/** Used when the style has no background layer (or its colour cannot be read). */
export const FALLBACK_BACKGROUND = "hsl(90, 23%, 95%)";

const CLASS = "maplibre-legend-control";
const CORNER = /\bmaplibregl-ctrl-(top|bottom)-(left|right|center)\b/;
/** maplibre-style-control's class names, the contract of `button: "style-control"` */
const STYLE = {
  container: "maplibre-style-control",
  open: "maplibre-style-control-active",
  panel: "maplibre-style-control-groups",
  tile: "maplibre-style-control-current",
};

/** MapLibre's AttributionControl: a <details> whose classes tell its state */
const ATTRIB = {
  control: "maplibregl-ctrl-attrib",
  compact: "maplibregl-compact",
  shown: "maplibregl-compact-show",
  empty: "maplibregl-attrib-empty",
};

/** The attribution control of this map, in one of the map's corners. */
function attributionOf(map: Map): HTMLElement | undefined {
  const all = map.getContainer()?.querySelectorAll<HTMLElement>(`.${ATTRIB.control}`) ?? [];
  return [...all].find((el) => CORNER.test(el.parentElement?.className ?? ""));
}

/** The style control's own elements the legend hooks into. */
type StyleHost = { control: StyleControlLike; container: HTMLElement; panel: HTMLElement; tile: HTMLElement };

function styleHostOf(control: StyleControlLike | undefined): StyleHost | undefined {
  // `_container` is private to StyleControl; read it without depending on the package
  const container = (control as unknown as { _container?: HTMLElement } | undefined)?._container;
  if (!control || !container?.isConnected || !container.classList.contains(STYLE.container)) return undefined;
  const panel = container.querySelector<HTMLElement>(`:scope > .${STYLE.panel}`);
  const tile = container.querySelector<HTMLElement>(`:scope > .${STYLE.tile}`);
  return panel && tile ? { control, container, panel, tile } : undefined;
}

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
/**
 * Link a stylesheet into the page once (the web fonts of the map's typefaces).
 * Never removed again: fonts stay useful to the page, and a re-added control
 * finds them in place.
 */
function linkStylesheet(href: string | false | undefined): void {
  if (!href || typeof document === "undefined") return;
  for (const link of document.head.querySelectorAll('link[rel="stylesheet"]')) if (link.getAttribute("href") === href) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

/** A small circled "i" at the row's top right that opens the entry's document in a new tab. */
function infoLink(href: string, title: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = `${CLASS}-info`;
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.title = title;
  a.setAttribute("aria-label", title);
  a.innerHTML =
    '<svg viewBox="0 0 14 14" aria-hidden="true" focusable="false">' +
    '<circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" stroke-width="1.1"/>' +
    '<circle cx="7" cy="4.3" r="0.95" fill="currentColor"/>' +
    '<path d="M5.7 6.4h1.9v4.1h-1.9z" fill="currentColor"/>' +
    "</svg>";
  return a;
}

/** An instance row's visual: the symbol on its feature's swatch when that feature is in view, else the symbol alone. */
function symbolOf(entry: LegendEntry, getImage?: GetImage, render: RenderOptions = {}): HTMLElement {
  const { anchor } = entry;
  return anchor
    ? createSymbolOnSwatch({ name: entry.name, text: entry.text, icon: entry.icon, anchor }, getImage, render)
    : createSymbolPreview(entry, getImage, render);
}

export class LegendControl implements IControl {
  options: LegendControlOptions;
  private _map?: Map;
  private _container?: HTMLElement;
  private _panel?: HTMLElement;
  private _toggleButton?: HTMLButtonElement;
  /** `button: "style-control"`: the style control hosting the legend, its row, the placeholder MapLibre places */
  private _host?: StyleHost;
  private _hostRow?: HTMLElement;
  private _anchor?: HTMLElement;
  private _hostObserver?: MutationObserver;
  /** `button: "attribution"`: MapLibre's attribution bar the button sits beside */
  private _attrib?: HTMLElement;
  private _attribObserver?: MutationObserver;
  private _list?: HTMLElement;
  private _timer?: ReturnType<typeof setTimeout>;
  private _model?: LegendModel;
  private _dirty = true;
  private _onIdle = () => this._scheduleUpdate();
  /** a name set along its line was measured in the fallback font until the webfont arrived */
  private _onFontsLoaded = () => this._scheduleUpdate();
  private _onResize = () => this._fitToMap();
  /** Escape closes a panel the control's own button opened and hands the focus back to the button. */
  private _onKeydown = (event: KeyboardEvent) => {
    const trigger = this._toggleButton ?? this._host?.tile;
    if (event.key !== "Escape" || !trigger || this._isCollapsed()) return;
    event.stopPropagation();
    this.close();
    trigger.focus();
  };
  /**
   * A click on the style tile while the legend is open brings the style panel
   * back: the legend closes first (capture phase), then the style control's
   * own handler finds its panel closed and opens it. With the style panel open
   * the tile closes it, as it always does.
   */
  private _onHostClick = (event: MouseEvent) => {
    if (this._isCollapsed() || !this._host || !(event.target instanceof Element) || !this._host.tile.contains(event.target)) return;
    this.close();
  };
  /** The style panel opening closes the legend: only one of the two panels is open. */
  private _onHostMutation = () => {
    if (this._host?.container.classList.contains(STYLE.open) && !this._isCollapsed()) this.close();
  };
  /** the current cap on a name's width in px (see `maxNameWidth`), undefined = none */
  private _nameCap?: number;

  /**
   * @param options - Options for configuring the legend control.
   */
  constructor(options?: LegendControlOptions) {
    this.options = Object.assign({}, defaultLegendControlOptions, options);
  }

  getDefaultPosition(): ControlPosition {
    // Bottom-left, above the Maptoolkit logo: MapLibre stacks a bottom corner
    // upwards, so a control added after the logo sits above it.
    return "bottom-left";
  }

  onAdd(map: Map) {
    this._map = map;

    // UI strings in the control's language; an entry the page set in the map's locale wins
    const locale = getMapLocale(map);
    for (const [key, text] of Object.entries(legendLocaleFor(this.options.language ?? detectLanguage()))) locale[key] ??= text;

    // a transparent column: [toggle button] + panel (the card)
    this._container = document.createElement("div");
    this._container.classList.add(CLASS);
    const collapsed = this.options.collapsed ?? this.options.toggle !== false;
    if (collapsed) this._container.classList.add(`${CLASS}-collapsed`);

    let hosted = false;
    if (this.options.toggle !== false && this.options.button === "style-control") {
      this._host = styleHostOf(this.options.styleControl);
      if (this._host) hosted = true;
      else console.warn('LegendControl: button "style-control" needs `styleControl`, added to the map before the legend — showing the legend button instead.');
    }

    let attributed = false;
    if (this.options.toggle !== false && this.options.button === "attribution") {
      this._attrib = attributionOf(map);
      if (this._attrib) attributed = true;
      else console.warn('LegendControl: button "attribution" needs MapLibre\'s attribution control on the map — showing the legend button instead.');
    }

    if (hosted) {
      this._attachToStyleControl(map, collapsed);
    } else if (attributed) {
      this._attachToAttribution(map, collapsed);
    } else if (this.options.toggle !== false) {
      this._container.classList.add("maplibregl-ctrl");
      // a MapLibre control button — maplibregl-ctrl-group + .maplibregl-ctrl-icon give it the native look
      this._container.classList.add(`${CLASS}-with-toggle`);
      const group = document.createElement("div");
      group.classList.add("maplibregl-ctrl-group", `${CLASS}-toggle`);
      const button = document.createElement("button");
      button.type = "button";
      button.title = getUIString(map, "LegendControl.Toggle");
      button.setAttribute("aria-label", getUIString(map, "LegendControl.Toggle"));
      button.setAttribute("aria-expanded", String(!collapsed));
      // Material Symbols "event_list", turned 180°: swatches left, lines right — a legend row
      const glyph = document.createElement("span");
      glyph.classList.add(`${CLASS}-toggle-glyph`);
      glyph.setAttribute("aria-hidden", "true");
      button.appendChild(glyph);
      if (this.options.button === "icon") {
        button.classList.add(`${CLASS}-toggle-icon`);
      } else {
        button.classList.add(`${CLASS}-toggle-icon-text`);
        button.appendChild(document.createTextNode(getUIString(map, "LegendControl.Label")));
      }
      button.addEventListener("click", () => this.toggle());
      this._container.addEventListener("keydown", this._onKeydown);
      group.appendChild(button);
      this._container.appendChild(group);
      this._toggleButton = button;
    } else {
      this._container.classList.add("maplibregl-ctrl");
    }

    // the card; no visible header — the title is its accessible name only
    this._panel = document.createElement("div");
    this._panel.classList.add(`${CLASS}-panel`);
    this._panel.setAttribute("role", "region");
    this._panel.setAttribute("aria-label", getUIString(map, "LegendControl.Title"));
    if (this._host) this._panel.tabIndex = -1; // takes the focus from the style panel's row
    if (this.options.toggle !== false) {
      // an ✕ at the top right; without the control's own trigger the host owns the open state
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.classList.add(`${CLASS}-close`);
      closeButton.title = getUIString(map, "LegendControl.Close");
      closeButton.setAttribute("aria-label", getUIString(map, "LegendControl.Close"));
      closeButton.addEventListener("click", () => {
        this.close();
        (this._toggleButton ?? this._host?.tile)?.focus();
      });
      this._panel.appendChild(closeButton);
    }
    this._list = document.createElement("div");
    this._list.classList.add(`${CLASS}-list`);
    this._panel.appendChild(this._list);
    this._container.appendChild(this._panel);

    map.on("idle", this._onIdle);
    map.on("resize", this._onResize);
    document.fonts?.addEventListener("loadingdone", this._onFontsLoaded);
    this._fitToMap();
    this._scheduleUpdate();

    // hosted: MapLibre places an empty stand-in in the corner, the legend lives in the style control
    return this._anchor ?? this._container;
  }

  /**
   * `button: "style-control"`: a row "icon · Legend · ›" below the styles,
   * behind a hairline, opens the legend where the style panel was; the legend
   * itself (the panel alone) moves into the style control's container.
   */
  private _attachToStyleControl(map: Map, collapsed: boolean) {
    const host = this._host!;
    const container = this._container!;
    container.classList.add(`${CLASS}-in-style-control`);

    const row = document.createElement("div");
    row.classList.add(`${CLASS}-style-row`);
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-expanded", String(!collapsed));
    for (const part of ["glyph", "label", "chevron"]) {
      const span = document.createElement("span");
      span.classList.add(`${CLASS}-style-row-${part}`);
      if (part === "label") span.textContent = getUIString(map, "LegendControl.Label");
      else span.setAttribute("aria-hidden", "true");
      button.appendChild(span);
    }
    button.addEventListener("click", () => {
      host.control.close();
      this.open();
      // the row just vanished with the style panel: the focus follows the legend
      this._panel?.focus({ preventScroll: true });
    });
    row.appendChild(button);
    host.panel.appendChild(row);
    this._hostRow = row;

    host.container.appendChild(container);
    host.container.addEventListener("click", this._onHostClick, true);
    // on the style control's container: Escape may come from the row or from the legend
    host.container.addEventListener("keydown", this._onKeydown);
    this._hostObserver = new MutationObserver(this._onHostMutation);
    this._hostObserver.observe(host.container, { attributes: true, attributeFilter: ["class"] });
    if (!collapsed) host.container.classList.add(`${CLASS}-host-open`);

    this._anchor = document.createElement("div");
    this._anchor.classList.add(`${CLASS}-anchor`);
    this._anchor.hidden = true;
  }

  /**
   * `button: "attribution"`: the word for "legend", bold and followed by a
   * separator, on the attribution's line — before it in a left corner, after it
   * (and so left of it) in a right one. The attribution's state is mirrored onto
   * the control (`data-attrib`): `strip` (a full bar), `joined` (the expanded
   * compact pill, which the word extends) or `collapsed` (the bar shrunk to its
   * ⓘ, or no attribution at all: no word, while an open panel stays open).
   */
  private _attachToAttribution(map: Map, collapsed: boolean) {
    const attrib = this._attrib!;
    const container = this._container!;
    container.classList.add("maplibregl-ctrl", `${CLASS}-with-toggle`, `${CLASS}-attrib`);
    const side = CORNER.exec(attrib.parentElement!.className)![2] === "left" ? "left" : "right";
    container.classList.add(`${CLASS}-attrib-${side}`);

    const button = document.createElement("button");
    button.type = "button";
    button.classList.add(`${CLASS}-toggle-attrib`);
    button.title = getUIString(map, "LegendControl.Toggle");
    button.setAttribute("aria-label", getUIString(map, "LegendControl.Toggle"));
    button.setAttribute("aria-expanded", String(!collapsed));
    button.textContent = getUIString(map, "LegendControl.Label");
    button.addEventListener("click", () => this.toggle());
    const separator = document.createElement("span");
    separator.classList.add(`${CLASS}-attrib-separator`);
    separator.setAttribute("aria-hidden", "true");
    separator.textContent = "|";
    container.append(button, separator);
    container.addEventListener("keydown", this._onKeydown);
    this._toggleButton = button;

    if (side === "left") attrib.before(container);
    else attrib.after(container);
    this._syncAttribution();
    this._attribObserver = new MutationObserver(() => this._syncAttribution());
    // classes: compact/expanded/empty; `open`: the ⓘ flips it after the classes; children: the text changes with the style
    this._attribObserver.observe(attrib, { attributes: true, attributeFilter: ["class", "open"], childList: true, subtree: true });

    this._anchor = document.createElement("div");
    this._anchor.classList.add(`${CLASS}-anchor`);
    this._anchor.hidden = true;
  }

  /** Mirror the attribution's state onto the control and keep the panel above the bar, 10px from the map's edge. */
  private _syncAttribution() {
    const attrib = this._attrib;
    const container = this._container;
    if (!attrib || !container) return;
    const classes = attrib.classList;
    const collapsedBar = classes.contains(ATTRIB.empty) || (classes.contains(ATTRIB.compact) && !classes.contains(ATTRIB.shown));
    const state = collapsedBar ? "collapsed" : classes.contains(ATTRIB.compact) ? "joined" : "strip";
    if (container.dataset.attrib !== state) container.dataset.attrib = state;
    // the bar gives up its spacing on the side the word joins it (the host class, set once, lets the stylesheet do that)
    if (!classes.contains(`${CLASS}-attrib-host`)) classes.add(`${CLASS}-attrib-host`);
    this._placeAttributionPanel();
    // the bar's new width is laid out only after the browser has finished toggling it
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => this._placeAttributionPanel());
  }

  private _placeAttributionPanel() {
    const panel = this._panel;
    const corner = this._corner();
    if (!this._attrib || !panel || !corner || !this._container) return;
    const cornerRect = corner.getBoundingClientRect();
    const box = this._container.getBoundingClientRect();
    if (cornerRect.width <= 0) return; // no layout yet; an empty control (bar collapsed) still has its place
    if (this._container.classList.contains(`${CLASS}-attrib-right`)) panel.style.right = `${Math.round(box.right - (cornerRect.right - 10))}px`;
    else panel.style.left = `${Math.round(cornerRect.left + 10 - box.left)}px`;
  }

  onRemove() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = undefined;
    this._map?.off("idle", this._onIdle);
    this._map?.off("resize", this._onResize);
    document.fonts?.removeEventListener("loadingdone", this._onFontsLoaded);
    this._raise(false);
    this._container?.removeEventListener("keydown", this._onKeydown);
    this._attribObserver?.disconnect();
    this._attrib?.classList.remove(`${CLASS}-attrib-host`);
    this._anchor?.remove();
    if (this._host) {
      this._hostObserver?.disconnect();
      this._host.container.removeEventListener("click", this._onHostClick, true);
      this._host.container.removeEventListener("keydown", this._onKeydown);
      this._host.container.classList.remove(`${CLASS}-host-open`);
      this._hostRow?.remove();
      this._anchor?.remove();
    }
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._host = undefined;
    this._attrib = undefined;
    this._attribObserver = undefined;
    this._hostRow = undefined;
    this._hostObserver = undefined;
    this._anchor = undefined;
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
    this._hostRow?.querySelector("button")?.setAttribute("aria-expanded", "true");
    this._host?.container.classList.add(`${CLASS}-host-open`);
    this._placeAttributionPanel();
    this._raise(true);
    if (this._dirty) this.update();
  }

  /** Hide the panel; updates are deferred until it is shown again. */
  close() {
    this._container?.classList.add(`${CLASS}-collapsed`);
    this._toggleButton?.setAttribute("aria-expanded", "false");
    this._hostRow?.querySelector("button")?.setAttribute("aria-expanded", "false");
    this._host?.container.classList.remove(`${CLASS}-host-open`);
    this._raise(false);
  }

  private _isCollapsed(): boolean {
    return this._container?.classList.contains(`${CLASS}-collapsed`) ?? true;
  }

  /** The map corner the control sits in: its own, or the style control's when hosted there. */
  private _corner(): HTMLElement | undefined {
    const corner = (this._host?.container ?? this._container)?.parentElement ?? undefined;
    return corner && CORNER.test(corner.className) ? corner : undefined;
  }

  /** In a map corner the open panel overlays the neighbouring controls (like maplibre-style-control). */
  private _raise(open: boolean) {
    if (!this._toggleButton && !this._host) return;
    // the style panel raises the same corner: leave it raised while that panel is open
    if (!open && this._host?.container.classList.contains(STYLE.open)) return;
    const corner = this._corner();
    if (corner) corner.style.zIndex = open ? "99" : "";
  }

  toggle() {
    if (this._isCollapsed()) this.open();
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
    linkStylesheet(this.options.fonts === undefined ? manifest?.fonts?.css : this.options.fonts);
    const layerOrder = new globalThis.Map<string, number>((style?.layers ?? []).map((l, i) => [l.id, i]));
    // The tags come from the style sheet MapLibre holds, not from the rendered
    // layers: a diff-based setStyle does not carry layer metadata over, so a
    // layer that exists in both styles would keep the previous style's tag.
    const sheet = (map as unknown as { style?: { stylesheet?: { layers?: Array<{ id: string; metadata?: Record<string, unknown> }> } } }).style?.stylesheet;
    const tags = sheet?.layers ? new globalThis.Map(sheet.layers.map((l) => [l.id, tagIn(l.metadata)])) : undefined;
    const canvas = map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const features = map.queryRenderedFeatures() as unknown as RenderedFeature[];

    let model = buildLegendModel({
      features,
      manifest,
      layerOrder,
      tags,
      minOpacity: this.options.minOpacity,
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
  /**
   * Size the panel to the map: the list scrolls beyond a share of the map's
   * height, the panel never grows past the map's edge — measured from the
   * panel's fixed edge (left, or right in a right-hand corner) to the far edge
   * of the map, so a panel mounted somewhere inside the map counts only the
   * room it actually has. The name cap follows that room; a resize that
   * changes it re-renders the rows (unless a render is what called here).
   */
  private _fitToMap(rerender = true) {
    const map = this._map;
    if (!map || !this._container || !this._panel || !this._list) return;
    this._placeAttributionPanel(); // the bar's width changes with the map's
    const box = map.getContainer();
    const height = box?.clientHeight ?? 0;
    const width = box?.clientWidth ?? 0;
    if (height > 0) {
      const ratio = this.options.maxHeightRatio ?? 0.6;
      this._list.style.maxHeight = `${Math.max(48, Math.round(height * ratio))}px`;
    }
    let available = width;
    if (width > 0) {
      const corner = CORNER.exec(this._corner()?.className ?? "")?.[2];
      // before the panel has a layout (or centred, where its edges move with its width): an estimate
      available = width - 20;
      const mapRect = box.getBoundingClientRect();
      const panelRect = this._panel.getBoundingClientRect();
      if (mapRect.width > 0 && panelRect.width > 0 && corner !== "center") {
        available = Math.round((corner === "right" ? panelRect.right - mapRect.left : mapRect.right - panelRect.left) - 10);
      }
      this._panel.style.maxWidth = `${Math.max(160, available)}px`;
    }
    const cap = this._nameCapFor(available);
    if (cap !== this._nameCap) {
      const rendered = this._nameCap !== undefined && this._list.childElementCount > 0;
      this._nameCap = cap;
      if (rendered && rerender) this._scheduleUpdate();
    }
  }

  /** The cap on a name's width: the smaller of the pixel cap and a share of the room the panel has. */
  private _nameCapFor(available: number): number | undefined {
    const option = this.options.maxNameWidth;
    if (option === false) return undefined;
    const px = option?.px ?? 260;
    const fraction = option?.fraction ?? 0.5;
    return available > 0 ? Math.round(Math.min(px, available * fraction)) : px;
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
    this._fitToMap(false); // the panel has a layout by now: measure the room, and the name cap with it
    const getImage: GetImage = (id) => {
      try {
        return map.getImage(id) as unknown as ReturnType<GetImage>;
      } catch {
        return undefined;
      }
    };
    const render = { maxNameWidth: this._nameCap };

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

      // one stroke scale for every line of the group: the widest decides, so the
      // lines keep their widths relative to each other, as on the map
      const lineScale = Math.min(1, ...group.entries.map((e) => lineFitScale(e.anchor?.swatch ?? e.swatch)));
      const groupRender = { ...render, lineScale };

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
        visual.appendChild(entry.kind === "instance" ? symbolOf(entry, getImage, groupRender) : createSwatch(entry.swatch, getImage, entry.variant, groupRender));
        li.appendChild(visual);

        const label = document.createElement("span");
        label.classList.add(`${CLASS}-label`);
        label.textContent = entry.label;
        if (entry.link) label.appendChild(infoLink(entry.link, getUIString(map, "LegendControl.Info")));
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
