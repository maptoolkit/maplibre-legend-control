import { Map, IControl, ControlPosition } from "maplibre-gl";

/**
 * Options for configuring the {@link LegendControl}.
 */
export type LegendControlOptions = {
  /**
   * Whether the legend panel starts collapsed to its toggle button.
   * @defaultValue `false`
   */
  collapsed?: boolean;
};

/**
 * Default options for the {@link LegendControl}.
 */
export const defaultLegendControlOptions: LegendControlOptions = {
  collapsed: false,
};

// `_locale`/`_getUIString` are undocumented on Map; cast here so `LegendControl.*`
// keys work with the same `new Map({ locale })` table as built-in controls.
function getMapLocale(map: Map): Record<string, string> {
  return (map as unknown as { _locale: Record<string, string> })._locale;
}

function getUIString(map: Map, key: string): string {
  return (map as unknown as { _getUIString(key: string): string })._getUIString(key);
}

/**
 * Provides a legend control that lists the map features currently visible in
 * the viewport, grouped and labelled from the style's `maptoolkit:legend`
 * metadata.
 */
export class LegendControl implements IControl {
  options: LegendControlOptions;
  private _map?: Map;
  private _container?: HTMLElement;
  private _list?: HTMLElement;

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

    this._container = document.createElement("div");
    this._container.classList.add("maplibregl-ctrl", "maplibregl-ctrl-group", "maplibre-legend-control");
    if (this.options.collapsed) this._container.classList.add("maplibre-legend-control-collapsed");

    const $title = document.createElement("h2");
    $title.classList.add("maplibre-legend-control-title");
    $title.textContent = getUIString(map, "LegendControl.Title");
    this._container.appendChild($title);

    this._list = document.createElement("ul");
    this._list.classList.add("maplibre-legend-control-list");
    this._container.appendChild(this._list);

    return this._container;
  }

  onRemove() {
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._list = undefined;
    this._map = undefined;
  }
}
