import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Map as MaplibreMap } from "maplibre-gl";
import { LegendControl } from "../src/LegendControl";
import { features, layerOrder, manifest, queryFixtures } from "./fixtures";

type MockMap = MaplibreMap & { _fire: (event: string) => void; _locale: Record<string, string> };

function createMockMap(options: { withFeatures?: boolean; background?: string | null } = {}): MockMap {
  const listeners: Record<string, Array<() => void>> = {};
  const locale: Record<string, string> = {};
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: 400 });
  Object.defineProperty(canvas, "clientHeight", { value: 300 });
  const mapContainer = document.createElement("div");
  Object.defineProperty(mapContainer, "clientWidth", { value: 400 });
  Object.defineProperty(mapContainer, "clientHeight", { value: 300 });
  const layers: Array<Record<string, unknown>> = [...layerOrder.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => ({ id, type: "line", source: "mtk" }));
  const background = options.background === null ? undefined : (options.background ?? "rgba(240,244,236,1)");
  if (background)
    layers.unshift({
      id: "background",
      type: "background",
      paint: { "background-color": ["interpolate", ["linear"], ["zoom"], 11, background, 14, background] },
    });
  return {
    on: (event: string, listener: () => void) => {
      (listeners[event] ??= []).push(listener);
    },
    off: (event: string, listener: () => void) => {
      listeners[event] = (listeners[event] ?? []).filter((l) => l !== listener);
    },
    getCanvas: () => canvas,
    getContainer: () => mapContainer,
    getStyle: () => ({ version: 8, sources: {}, layers, metadata: { "maptoolkit:legend": manifest } }),
    queryRenderedFeatures: (box?: [[number, number], [number, number]]) => (options.withFeatures === false ? [] : queryFixtures(features, box)),
    project: ([x, y]: [number, number]) => ({ x, y }),
    getImage: () => undefined,
    // MapLibre's internal style object: evaluated paint of a layer at the current zoom
    style: { getLayer: (id: string) => (id === "background" && background ? { paint: { get: () => ({ toString: () => background }) } } : undefined) },
    _locale: locale,
    _getUIString: (key: string) => {
      const value = locale[key];
      if (value == null) throw new Error(`Missing UI string '${key}'`);
      return value;
    },
    _fire: (event: string) => (listeners[event] ?? []).forEach((l) => l()),
  } as unknown as MockMap;
}

/** A stand-in for MapLibre's attribution control: <details class="maplibregl-ctrl maplibregl-ctrl-attrib"> in a map corner. */
function mountAttribution(map: MockMap, position: string, classes: string[]) {
  const mapContainer = map.getContainer();
  document.body.appendChild(mapContainer);
  const corner = document.createElement("div");
  corner.className = `maplibregl-ctrl-${position}`;
  mapContainer.appendChild(corner);
  const attrib = document.createElement("details");
  attrib.className = "maplibregl-ctrl maplibregl-ctrl-attrib";
  attrib.classList.add(...classes);
  attrib.setAttribute("open", "");
  const summary = document.createElement("summary");
  summary.className = "maplibregl-ctrl-attrib-button";
  const inner = document.createElement("div");
  inner.className = "maplibregl-ctrl-attrib-inner";
  inner.innerHTML = '<a href="https://maplibre.org/">MapLibre</a> | © OSM';
  attrib.append(summary, inner);
  corner.appendChild(attrib);
  return { corner, attrib, remove: () => mapContainer.remove() };
}

/** A stand-in for maplibre-style-control's DOM: container > tile + panel, in a map corner, with open()/close(). */
function mountStyleControl(map: MockMap) {
  const mapContainer = map.getContainer();
  document.body.appendChild(mapContainer);
  const corner = document.createElement("div");
  corner.className = "maplibregl-ctrl-bottom-left";
  mapContainer.appendChild(corner);
  const container = document.createElement("div");
  container.className = "maplibregl-ctrl maplibregl-ctrl-group maplibre-style-control";
  const tile = document.createElement("button");
  tile.className = "maplibre-style-control-current";
  const panel = document.createElement("div");
  panel.className = "maplibregl-ctrl-group maplibre-style-control-groups";
  container.append(tile, panel);
  corner.appendChild(container);
  const isOpen = () => container.classList.contains("maplibre-style-control-active");
  const control = {
    _container: container,
    open: () => {
      container.classList.add("maplibre-style-control-active");
      corner.style.zIndex = "99";
    },
    close: vi.fn(() => {
      container.classList.remove("maplibre-style-control-active");
      corner.style.zIndex = "";
    }),
  };
  tile.addEventListener("click", () => (isOpen() ? control.close() : control.open()));
  return { control, container, tile, panel, corner, isOpen, remove: () => mapContainer.remove() };
}

describe("LegendControl", () => {
  it("creates a container element on add", () => {
    const control = new LegendControl();
    const container = control.onAdd(createMockMap());

    expect(container).toBeInstanceOf(HTMLElement);
    expect(container.classList.contains("maplibregl-ctrl")).toBe(true);
    expect(container.classList.contains("maplibre-legend-control")).toBe(true);
    expect(container.querySelector(".maplibre-legend-control-panel")?.getAttribute("aria-label")).toBe("Legend"); // the title is the panel's accessible name only
    expect(container.querySelector(".maplibre-legend-control-header")).toBeNull(); // no header row
    expect(container.querySelector(".maplibre-legend-control-list")).not.toBeNull();
  });

  it("uses the map's locale table for the title", () => {
    const map = createMockMap();
    map._locale["LegendControl.Title"] = "Legende";
    const container = new LegendControl().onAdd(map);
    expect(container.querySelector(".maplibre-legend-control-panel")?.getAttribute("aria-label")).toBe("Legende");
  });

  it("renders a MapLibre control button that shows and hides the panel", () => {
    const map = createMockMap();
    map._locale["LegendControl.Toggle"] = "Legende ein-/ausblenden";
    const container = new LegendControl({ language: "de" }).onAdd(map);
    expect(container.classList.contains("maplibre-legend-control-with-toggle")).toBe(true);
    const button = container.querySelector(".maplibre-legend-control-toggle.maplibregl-ctrl-group button") as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBe("Legende ein-/ausblenden"); // the page's own locale entry wins
    // the default button is the legend icon and the word for "legend" in the control's language
    expect(button.textContent).toBe("Legende");
    expect(button.classList.contains("maplibre-legend-control-toggle-icon-text")).toBe(true);
    expect(button.firstElementChild?.classList.contains("maplibre-legend-control-toggle-glyph")).toBe(true);
    expect(button.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    // the panel starts closed with every button
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    button.click();
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    button.click();
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    // collapsed: false opens it at once
    expect(new LegendControl({ collapsed: false }).onAdd(createMockMap()).classList.contains("maplibre-legend-control-collapsed")).toBe(false);
  });

  it("shows the icon alone on request, and speaks the map maker's languages", () => {
    const icon = new LegendControl({ button: "icon" }).onAdd(createMockMap()).querySelector(".maplibre-legend-control-toggle button")!;
    expect(icon.classList.contains("maplibre-legend-control-toggle-icon")).toBe(true);
    expect(icon.querySelector(".maplibre-legend-control-toggle-glyph")).not.toBeNull();
    expect(icon.textContent).toBe("");
    expect(icon.getAttribute("aria-label")).toBe("Show or hide the legend"); // the icon still has a name
    // every language of the map maker has its own strings; an unknown one falls back to English
    for (const [language, label, info, close] of [
      ["fr", "Légende", "En savoir plus", "Fermer la légende"],
      ["ja", "凡例", "詳細", "凡例を閉じる"],
      ["ar", "مفتاح الخريطة", "المزيد", "إغلاق مفتاح الخريطة"],
      ["xx", "Legend", "More about this", "Close the legend"],
    ]) {
      const map = createMockMap();
      new LegendControl({ language }).onAdd(map);
      expect(map._locale["LegendControl.Label"]).toBe(label);
      expect(map._locale["LegendControl.Info"]).toBe(info);
      expect(map._locale["LegendControl.Close"]).toBe(close);
    }
  });

  it("keeps the button when the panel is hidden — only a control without a button hides entirely", () => {
    // the stylesheet is not loaded in jsdom, so check the rules it must contain
    const css = readFileSync(join(process.cwd(), "src/style.css"), "utf8");
    expect(css).toContain(".maplibre-legend-control.maplibre-legend-control-collapsed .maplibre-legend-control-panel {");
    expect(css).toContain(".maplibre-legend-control.maplibre-legend-control-collapsed:not(.maplibre-legend-control-with-toggle) {");
    expect(css).not.toMatch(/\.maplibre-legend-control\.maplibre-legend-control-collapsed \{/); // would hide the button too
    // names wrap at spaces and hyphens like on the map, never inside a word
    expect(css).not.toMatch(/overflow-wrap:\s*(anywhere|break-word)/);
    expect(css).not.toMatch(/word-break:\s*break-(all|word)/);
    expect(css).toMatch(/min-width:\s*min-content/); // a long word widens the column instead of spilling over it
  });

  it("closes on Escape and hands the focus back to its button", () => {
    const container = new LegendControl({ collapsed: false }).onAdd(createMockMap());
    document.body.appendChild(container);
    const button = container.querySelector(".maplibre-legend-control-toggle button") as HTMLButtonElement;
    const panel = container.querySelector(".maplibre-legend-control-panel") as HTMLElement;
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(false); // other keys pass
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
    container.remove();
    // without a button the host owns the open state: Escape leaves it alone
    const hosted = new LegendControl({ toggle: false }).onAdd(createMockMap());
    hosted.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(hosted.classList.contains("maplibre-legend-control-collapsed")).toBe(false);
  });

  it("styles the button like the Maptoolkit controls and lets the panel fade in a corner", () => {
    const css = readFileSync(join(process.cwd(), "src/style.css"), "utf8");
    // the hover lift sits inside a hover media query, so it never sticks on touch
    const outsideHoverQuery = css.replace(/@media \(hover: hover\) \{[\s\S]*?\n\}/g, "");
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.maplibre-legend-control \.maplibre-legend-control-toggle:hover \{/);
    expect(outsideHoverQuery).not.toMatch(/-toggle:hover \{\s*transform/);
    // in a corner the closed panel stays in the layout, hidden, so it can fade
    expect(css).toMatch(
      /-with-toggle\.maplibre-legend-control-collapsed\s*\.maplibre-legend-control-panel \{\s*display: block;\s*opacity: 0;\s*visibility: hidden;/,
    );
    // the button keeps its own colours: the panel's text colours follow the style's background
    expect(css).toMatch(/-toggle button \{[^}]*color: var\(--legend-control-toggle-color\);/);
    // without the word the attribution line shows nothing of the legend
    expect(css).toMatch(
      /\[data-attrib="collapsed"\] \.maplibre-legend-control-toggle-attrib,\s*\.maplibre-legend-control-attrib\[data-attrib="collapsed"\] \.maplibre-legend-control-attrib-separator \{\s*display: none;/,
    );
  });

  it("closes from an ✕ in the panel with every button, and hands the focus back", () => {
    const map = createMockMap();
    const container = new LegendControl({ language: "de", collapsed: false }).onAdd(map);
    document.body.appendChild(container);
    const close = container.querySelector(".maplibre-legend-control-panel > .maplibre-legend-control-close") as HTMLButtonElement;
    expect(close.getAttribute("aria-label")).toBe("Legende schließen");
    expect(close.title).toBe("Legende schließen");
    close.click();
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);
    expect(document.activeElement).toBe(container.querySelector(".maplibre-legend-control-toggle button"));
    container.remove();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {}); // the two hosted buttons fall back without a host here
    for (const button of ["icon", "attribution", "style-control"] as const) {
      expect(new LegendControl({ button }).onAdd(createMockMap()).querySelector(".maplibre-legend-control-close")).not.toBeNull();
    }
    warn.mockRestore();
    // the host owns the open state: no ✕
    expect(new LegendControl({ toggle: false }).onAdd(createMockMap()).querySelector(".maplibre-legend-control-close")).toBeNull();
  });

  it("starts open without its own button — the host opens it by mounting it", () => {
    expect(new LegendControl({ toggle: false }).onAdd(createMockMap()).classList.contains("maplibre-legend-control-collapsed")).toBe(false);
  });

  it("lives in the style control's panel with button: style-control", async () => {
    const map = createMockMap();
    const style = mountStyleControl(map);
    const legend = new LegendControl({ language: "de", button: "style-control", styleControl: style.control, updateDelay: 0 });
    const placed = legend.onAdd(map);
    // MapLibre gets a hidden stand-in; the legend itself sits in the style control, closed
    expect(placed.hidden).toBe(true);
    const container = style.container.querySelector(":scope > .maplibre-legend-control") as HTMLElement;
    expect(container.classList.contains("maplibre-legend-control-in-style-control")).toBe(true);
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);
    expect(container.querySelector(".maplibre-legend-control-toggle")).toBeNull(); // no button in the corner
    // a row at the foot of the style panel: icon, "Legende", chevron
    const row = style.panel.lastElementChild as HTMLElement;
    expect(row.classList.contains("maplibre-legend-control-style-row")).toBe(true);
    const rowButton = row.querySelector("button")!;
    expect(rowButton.textContent).toBe("Legende");
    expect([...rowButton.children].map((c) => c.className)).toEqual([
      "maplibre-legend-control-style-row-glyph",
      "maplibre-legend-control-style-row-label",
      "maplibre-legend-control-style-row-chevron",
    ]);

    // the row closes the style panel and opens the legend where it was; the tile stays lifted
    style.tile.click();
    expect(style.isOpen()).toBe(true);
    rowButton.click();
    expect(style.control.close).toHaveBeenCalled();
    expect(style.isOpen()).toBe(false);
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(false);
    expect(rowButton.getAttribute("aria-expanded")).toBe("true");
    expect(style.container.classList.contains("maplibre-legend-control-host-open")).toBe(true);
    expect(style.corner.style.zIndex).toBe("99");

    // a click on the tile brings the style panel back in the legend's place
    style.tile.click();
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);
    expect(style.isOpen()).toBe(true);
    expect(style.container.classList.contains("maplibre-legend-control-host-open")).toBe(false);
    expect(style.corner.style.zIndex).toBe("99");
    // with the style panel open the tile closes it, as before
    style.tile.click();
    expect(style.isOpen()).toBe(false);
    expect(style.corner.style.zIndex).toBe("");
    style.tile.click();
    expect(style.isOpen()).toBe(true);

    // the style panel opening by any means closes the legend, and keeps its corner raised
    rowButton.click();
    style.control.open();
    await new Promise((resolve) => setTimeout(resolve, 0)); // mutation observers run after the task
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);
    expect(style.corner.style.zIndex).toBe("99");

    // opening moves the focus from the vanished row into the legend; Escape closes it and hands the focus to the tile
    style.control.close();
    rowButton.focus();
    rowButton.click();
    const panel = container.querySelector(".maplibre-legend-control-panel") as HTMLElement;
    expect(document.activeElement).toBe(panel);
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);
    expect(document.activeElement).toBe(style.tile);
    // also when the focus stayed on the row (a page that moved it back)
    rowButton.click();
    rowButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);

    // removing the legend leaves the style control as it was
    rowButton.click();
    legend.onRemove();
    expect(style.panel.querySelector(".maplibre-legend-control-style-row")).toBeNull();
    expect(style.container.querySelector(".maplibre-legend-control")).toBeNull();
    expect(style.container.classList.contains("maplibre-legend-control-host-open")).toBe(false);
    style.tile.click();
    expect(style.isOpen()).toBe(true);
    style.remove();
  });

  it("falls back to its own button when there is no style control to live in", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const container = new LegendControl({ button: "style-control" }).onAdd(createMockMap());
    expect(warn).toHaveBeenCalledOnce();
    expect(container.querySelector(".maplibre-legend-control-toggle-icon-text")).not.toBeNull();
    // a style control not yet on the map (added after the legend) counts as missing
    const map = createMockMap();
    const style = mountStyleControl(map);
    style.container.remove();
    expect(
      new LegendControl({ button: "style-control", styleControl: style.control }).onAdd(map).querySelector(".maplibre-legend-control-toggle"),
    ).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    style.remove();
    warn.mockRestore();
  });

  it("sits on MapLibre's attribution line with button: attribution", async () => {
    const map = createMockMap();
    const bar = mountAttribution(map, "bottom-right", ["maplibregl-compact", "maplibregl-compact-show"]);
    const legend = new LegendControl({ language: "de", button: "attribution" });
    const placed = legend.onAdd(map);
    expect(placed.hidden).toBe(true); // MapLibre gets a stand-in
    // in a right corner right after the bar, so it floats left of it; closed
    const container = bar.attrib.nextElementSibling as HTMLElement;
    expect(container.classList.contains("maplibre-legend-control-attrib")).toBe(true);
    expect(container.classList.contains("maplibre-legend-control-attrib-right")).toBe(true);
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);
    // the bold word, then a separator the screen reader skips
    const button = container.querySelector(".maplibre-legend-control-toggle-attrib") as HTMLButtonElement;
    expect(button.textContent).toBe("Legende");
    expect(container.querySelector(".maplibre-legend-control-attrib-separator")?.getAttribute("aria-hidden")).toBe("true");

    // the bar's state is mirrored: expanded compact pill → joined, and the bar gives up its left edge
    expect(container.dataset.attrib).toBe("joined");
    expect(bar.attrib.classList.contains("maplibre-legend-control-attrib-host")).toBe(true);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    bar.attrib.classList.remove("maplibregl-compact-show"); // collapsed to the ⓘ, as after the first drag: no word
    await settle();
    expect(container.dataset.attrib).toBe("collapsed");
    bar.attrib.classList.remove("maplibregl-compact"); // compact: false on a wide map
    await settle();
    expect(container.dataset.attrib).toBe("strip");
    bar.attrib.classList.add("maplibregl-attrib-empty"); // no attribution: no word either
    await settle();
    expect(container.dataset.attrib).toBe("collapsed");

    // it toggles like the other buttons; Escape closes and keeps the focus on the word
    bar.attrib.classList.remove("maplibregl-attrib-empty");
    await settle();
    button.click();
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(bar.corner.style.zIndex).toBe("99");
    button.focus();
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);
    expect(document.activeElement).toBe(button);

    // removing the legend leaves the bar as it was
    bar.attrib.classList.add("maplibregl-compact", "maplibregl-compact-show");
    await settle();
    legend.onRemove();
    expect(bar.corner.querySelector(".maplibre-legend-control")).toBeNull();
    expect(bar.attrib.classList.contains("maplibre-legend-control-attrib-host")).toBe(false);
    bar.remove();
  });

  it("stands before the attribution in a left corner, and falls back to its own button without one", () => {
    const map = createMockMap();
    const bar = mountAttribution(map, "bottom-left", []);
    new LegendControl({ button: "attribution" }).onAdd(map);
    const container = bar.attrib.previousElementSibling as HTMLElement;
    expect(container.classList.contains("maplibre-legend-control-attrib-left")).toBe(true);
    expect(container.dataset.attrib).toBe("strip");
    bar.remove();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fallback = new LegendControl({ button: "attribution" }).onAdd(createMockMap());
    expect(warn).toHaveBeenCalledOnce();
    expect(fallback.querySelector(".maplibre-legend-control-toggle-icon-text")).not.toBeNull();
    warn.mockRestore();
  });

  it("has no button with toggle: false — the host provides the trigger", () => {
    const container = new LegendControl({ toggle: false, collapsed: true }).onAdd(createMockMap());
    expect(container.querySelector(".maplibre-legend-control-toggle")).toBeNull();
    expect(container.classList.contains("maplibre-legend-control-with-toggle")).toBe(false);
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);
  });

  it("renders groups and entries from the rendered features once the map is idle", () => {
    vi.useFakeTimers();
    const map = createMockMap();
    const control = new LegendControl({ collapsed: false, language: "de", updateDelay: 0 });
    const container = control.onAdd(map);
    map._fire("idle");
    vi.runAllTimers();

    const groups = [...container.querySelectorAll(".maplibre-legend-control-group")].map((g) => (g as HTMLElement).dataset.group);
    expect(groups).toEqual(["place", "road", "nature", "poi"]);
    const keys = [...container.querySelectorAll(".maplibre-legend-control-entry")].map((e) => (e as HTMLElement).dataset.key);
    expect(keys).toEqual([
      "place:town",
      "place:village",
      "road:major_dark",
      "road:minor_pedestrian",
      "road:minor",
      "road:cycling_infra_lane",
      "road:cycling_route",
      "road:hiking",
      "road:major_shield",
      "road:path",
      "nature:wood",
      "nature:farmland",
      "poi:fountain",
      "poi:peak",
    ]);

    // left column: the map label in the map font; right column: the type
    const town = container.querySelector('[data-key="place:town"]') as HTMLElement;
    const name = town.querySelector(".maplibre-legend-control-visual .maplibre-legend-control-symbol-text") as HTMLElement;
    expect(name.textContent).toBe("Tulln an der Donau");
    expect(name.style.fontFamily).toContain("Rosario");
    expect(name.style.fontWeight).toBe("700");
    expect(name.style.fontSize).toBe("14px");
    expect(town.querySelector(".maplibre-legend-control-symbol-icon")).toBeNull(); // no dot, no icon: the label is the symbol
    expect(town.querySelector(":scope > .maplibre-legend-control-label")?.textContent).toBe("Stadt");

    const motorway = container.querySelector('[data-key="road:major_dark"]') as HTMLElement;
    expect(motorway.querySelector(".maplibre-legend-control-label")?.textContent).toBe("Hauptstraße");
    const strokes = [...motorway.querySelectorAll("path.maplibre-legend-control-stroke")];
    expect(strokes).toHaveLength(3); // blur + casing + main (label is no stroke)
    expect(strokes.map((p) => p.getAttribute("stroke-width"))).toEqual(["5", "7", "5"]); // casing = gap 5 + 2 × 1
    expect(strokes[2].getAttribute("stroke-linecap")).toBe("butt"); // solid strokes end flush

    const minor = container.querySelector('[data-key="road:minor"] path.maplibre-legend-control-stroke-main') as SVGPathElement;
    expect(minor.getAttribute("stroke-dasharray")).toBe("10 15"); // [2, 3] × width 5
    expect(minor.getAttribute("stroke-dashoffset")).toBe("-17.5"); // first dash starts half a gap in
    expect(minor.getAttribute("stroke-linecap")).toBe("round"); // dashed strokes keep the layer's cap

    expect(control.getModel()?.groups).toHaveLength(4);
    vi.useRealTimers();
  });

  it("draws POI symbols as icon plus label like the map: text below an icon with text-anchor top", () => {
    vi.useFakeTimers();
    const map = createMockMap();
    const container = new LegendControl({ collapsed: false, language: "de", updateDelay: 0 }).onAdd(map);
    vi.runAllTimers();
    const fountain = container.querySelector('[data-key="poi:fountain"]') as HTMLElement;
    expect(fountain).not.toBeNull();
    const symbol = fountain.querySelector(".maplibre-legend-control-symbol") as HTMLElement;
    expect(symbol.classList.contains("maplibre-legend-control-symbol-single")).toBe(true); // icon only, no text
    expect(symbol.querySelector(".maplibre-legend-control-symbol-icon")).not.toBeNull();
    expect(fountain.querySelector(":scope > .maplibre-legend-control-label")?.textContent).toBe("Fountain");
    vi.useRealTimers();
  });

  it("reads the tags from the style sheet MapLibre holds, not from the rendered layers", () => {
    vi.useFakeTimers();
    const map = createMockMap();
    // the sheet after a diff-based style switch: the casing is hidden there, while the rendered features still carry the old tag
    (map as unknown as { style: Record<string, unknown> }).style.stylesheet = {
      layers: features
        .map((f) => f.layer.id)
        .filter((id, i, all) => all.indexOf(id) === i)
        .map((id) => ({
          id,
          metadata: id === "road_major_casing" ? { "maptoolkit:legend": { hidden: true } } : features.find((f) => f.layer.id === id)!.layer.metadata,
        })),
    };
    const container = new LegendControl({ collapsed: false, language: "de", updateDelay: 0 }).onAdd(map);
    vi.runAllTimers();
    const road = container.querySelector('[data-key="road:major_dark"]') as HTMLElement;
    expect(road.querySelector(".maplibre-legend-control-stroke-casing")).toBeNull(); // the sheet's tag won
    expect(road.querySelector(".maplibre-legend-control-stroke-main")).not.toBeNull();
    vi.useRealTimers();
  });

  it("never grows past the map's edge: the room is measured from the panel's own edge", () => {
    vi.useFakeTimers();
    const map = createMockMap();
    const control = new LegendControl({ collapsed: false, language: "de", updateDelay: 0 });
    const container = control.onAdd(map);
    vi.runAllTimers();
    const panel = container.querySelector(".maplibre-legend-control-panel") as HTMLElement;
    expect(panel.style.maxWidth).toBe("380px"); // no layout yet (jsdom): the estimate, map width − 20
    // the stylesheet opens the panel below the button in the top corners and above it in the bottom corners
    const css = readFileSync(join(process.cwd(), "src/style.css"), "utf8");
    expect(css).toMatch(/ctrl-top-left [^{]*-panel,\s*\.maplibregl-ctrl-top-right [^{]*-panel \{[^}]*top: calc\(var\(--legend-control-toggle-size\) \+ 10px\)/);
    expect(css).toMatch(
      /ctrl-bottom-left [^{]*-panel,\s*\.maplibregl-ctrl-bottom-right [^{]*-panel \{[^}]*bottom: calc\(var\(--legend-control-toggle-size\) \+ 10px\)/,
    );
    // mounted 62 px into a 400 px map, as the style editor's panel column does: the room ends at the map's right edge
    const rect = (left: number, width: number) =>
      ({ left, right: left + width, width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(map.getContainer(), "getBoundingClientRect").mockReturnValue(rect(0, 400));
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(rect(62, 300));
    (control as unknown as { _fitToMap: () => void })._fitToMap();
    expect(panel.style.maxWidth).toBe("328px"); // 400 − 62 − 10
    // in a right-hand corner the panel's right edge is the fixed one
    const corner = document.createElement("div");
    corner.className = "maplibregl-ctrl-top-right";
    corner.appendChild(container);
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(rect(90, 300)); // right edge at 390
    (control as unknown as { _fitToMap: () => void })._fitToMap();
    expect(panel.style.maxWidth).toBe("380px"); // 390 − 0 − 10
    vi.useRealTimers();
  });

  it("caps a name at the smaller of a share of the map and a pixel width", () => {
    vi.useFakeTimers();
    // the mock map is 400 px wide: 50 % = 200 px beats the 260 px default
    const wide = new LegendControl({ collapsed: false, language: "de", updateDelay: 0 }).onAdd(createMockMap());
    vi.runAllTimers();
    const town = wide.querySelector('[data-key="place:town"] .maplibre-legend-control-symbol-text') as HTMLElement;
    expect(town.style.maxWidth).toBe("140px"); // the map's own wrapping width, below the cap
    expect(town.classList.contains("maplibre-legend-control-symbol-text-cut")).toBe(false);
    // a tight cap cuts the longest word
    const tight = new LegendControl({ collapsed: false, language: "de", updateDelay: 0, maxNameWidth: { px: 30, fraction: 0.5 } }).onAdd(createMockMap());
    vi.runAllTimers();
    const cut = tight.querySelector('[data-key="place:town"] .maplibre-legend-control-symbol-text') as HTMLElement;
    expect(cut.style.minWidth).toBe("30px");
    expect(cut.classList.contains("maplibre-legend-control-symbol-text-cut")).toBe(true);
    // no cap at all
    const free = new LegendControl({ collapsed: false, language: "de", updateDelay: 0, maxNameWidth: false }).onAdd(createMockMap());
    vi.runAllTimers();
    expect((free.querySelector('[data-key="place:town"] .maplibre-legend-control-symbol-text') as HTMLElement).style.minWidth).toBe("");
    vi.useRealTimers();
  });

  it("offers an entry's document behind a circled i after the description", () => {
    vi.useFakeTimers();
    const map = createMockMap();
    const container = new LegendControl({ collapsed: false, language: "de", updateDelay: 0 }).onAdd(map);
    vi.runAllTimers();
    const road = container.querySelector('[data-key="road:major_dark"] > .maplibre-legend-control-label') as HTMLElement;
    const info = road.querySelector("a.maplibre-legend-control-info") as HTMLAnchorElement;
    expect(info).not.toBeNull();
    expect(info.href).toBe("https://example.org/roads.pdf");
    expect(info.target).toBe("_blank");
    expect(info.rel).toBe("noopener noreferrer");
    expect(info.getAttribute("aria-label")).toBe("Mehr dazu"); // the control's German strings, overridable via the map locale
    expect(info.querySelector("svg circle")).not.toBeNull();
    expect(road.textContent).toBe("Hauptstraße"); // the button adds no text
    expect(container.querySelector('[data-key="road:minor"] .maplibre-legend-control-info')).toBeNull(); // no link, no button
    vi.useRealTimers();
  });

  it("shows a shield on the road it belongs to when that road is in view", () => {
    vi.useFakeTimers();
    const map = createMockMap();
    const container = new LegendControl({ collapsed: false, language: "de", updateDelay: 0 }).onAdd(map);
    vi.runAllTimers();
    const shield = container.querySelector('[data-key="road:major_shield"]') as HTMLElement;
    expect(shield).not.toBeNull();
    const on = shield.querySelector(".maplibre-legend-control-symbol-on") as HTMLElement;
    expect(on).not.toBeNull();
    expect(on.querySelector(".maplibre-legend-control-swatch-line")).not.toBeNull(); // the motorway's stack
    expect(on.querySelector(".maplibre-legend-control-symbol-text")?.textContent).toBe("A22"); // the shield on it
    // the road reaches beyond the shield: the symbol sizes the box, the padding is the reach, the swatch fills it all
    const css = readFileSync(join(process.cwd(), "src/style.css"), "utf8");
    expect(css).toMatch(/symbol-on\s*\{[^}]*padding:\s*0 var\(--legend-control-symbol-reach\)/);
    expect(css).toMatch(/symbol-on-fill\s*\{[^}]*padding:\s*var\(--legend-control-symbol-reach-y\) var\(--legend-control-symbol-reach\)/);
    expect(css).toMatch(/symbol-on > \.maplibre-legend-control-swatch\s*\{[^}]*inset:\s*0/);
    // a place name has nothing to sit on: the symbol alone
    const place = container.querySelector('[data-key="place:town"] .maplibre-legend-control-visual') as HTMLElement;
    expect(place.querySelector(".maplibre-legend-control-symbol-on")).toBeNull();
    vi.useRealTimers();
  });

  it("caps the list at 60 % of the map height and the panel at the map width", () => {
    const container = new LegendControl().onAdd(createMockMap());
    const list = container.querySelector(".maplibre-legend-control-list") as HTMLElement;
    expect(list.style.maxHeight).toBe("180px"); // 0.6 × 300
    expect((container.querySelector(".maplibre-legend-control-panel") as HTMLElement).style.maxWidth).toBe("380px"); // map width − 20
  });

  it("centres every block on the column axis and keeps text-justify inside the block", () => {
    vi.useFakeTimers();
    const container = new LegendControl({ collapsed: false, language: "de", updateDelay: 0 }).onAdd(createMockMap());
    vi.runAllTimers();
    for (const visual of container.querySelectorAll(".maplibre-legend-control-visual")) {
      expect(visual.className).toBe("maplibre-legend-control-visual"); // no per-entry alignment class
    }
    const peakText = container.querySelector('[data-key="poi:peak"] .maplibre-legend-control-symbol-text') as HTMLElement;
    expect(peakText.style.textAlign).toBe("left"); // "Großglockner" / "3798 m" stay left-aligned to each other
    const townText = container.querySelector('[data-key="place:town"] .maplibre-legend-control-symbol-text') as HTMLElement;
    expect(townText.style.textAlign).toBe(""); // no justify on the layer → the stylesheet's centre
    vi.useRealTimers();
  });

  it("paints the panel in the style's background colour, light text on dark", () => {
    vi.useFakeTimers();
    const light = new LegendControl({ collapsed: false, updateDelay: 0 }).onAdd(createMockMap());
    vi.runAllTimers();
    expect(light.style.getPropertyValue("--legend-control-bg-color")).toBe("rgba(240,244,236,1)");
    expect(light.style.getPropertyValue("--legend-control-color-fg-strong")).toBe("");
    expect(light.classList.contains("maplibre-legend-control-dark")).toBe(false);

    const dark = new LegendControl({ collapsed: false, updateDelay: 0 }).onAdd(createMockMap({ background: "rgba(24,26,34,1)" }));
    vi.runAllTimers();
    expect(dark.style.getPropertyValue("--legend-control-bg-color")).toBe("rgba(24,26,34,1)");
    expect(dark.style.getPropertyValue("--legend-control-color-fg-strong")).not.toBe("");
    expect(dark.classList.contains("maplibre-legend-control-dark")).toBe(true);

    const none = new LegendControl({ collapsed: false, updateDelay: 0 }).onAdd(createMockMap({ background: null }));
    vi.runAllTimers();
    expect(none.style.getPropertyValue("--legend-control-bg-color")).toBe("hsl(90, 23%, 95%)");

    const fixed = new LegendControl({ collapsed: false, updateDelay: 0, background: "#123456" }).onAdd(createMockMap());
    vi.runAllTimers();
    expect(fixed.style.getPropertyValue("--legend-control-bg-color")).toBe("#123456");
    expect(fixed.classList.contains("maplibre-legend-control-dark")).toBe(true);
    vi.useRealTimers();
  });

  it("queries the four edge bands and leaves labels touching them out", () => {
    vi.useFakeTimers();
    const map = createMockMap();
    const spy = vi.spyOn(map, "queryRenderedFeatures");
    const control = new LegendControl({ collapsed: false, language: "de", updateDelay: 0 }).onAdd(map);
    vi.runAllTimers();
    // one full query + four band queries (top, bottom, left, right — 5 % of 400×300)
    expect(spy.mock.calls.map((c) => JSON.stringify(c[0] ?? null))).toEqual([
      "null",
      JSON.stringify([
        [0, 0],
        [400, 15],
      ]),
      JSON.stringify([
        [0, 285],
        [400, 300],
      ]),
      JSON.stringify([
        [0, 0],
        [20, 300],
      ]),
      JSON.stringify([
        [380, 0],
        [400, 300],
      ]),
    ]);
    const town = control.querySelector('[data-key="place:town"] .maplibre-legend-control-symbol-text');
    expect(town?.textContent).toBe("Tulln an der Donau"); // Randstadt at x = 5 sits in the left band

    const all = new LegendControl({ collapsed: false, language: "de", updateDelay: 0, edgeBuffer: 0 }).onAdd(createMockMap());
    vi.runAllTimers();
    expect(all.querySelector('[data-key="place:town"] .maplibre-legend-control-symbol-text')?.textContent).toBe("Randstadt"); // rank 5 beats 12 once the edge no longer matters
    vi.useRealTimers();
  });

  it("shows an empty state when nothing tagged is rendered", () => {
    vi.useFakeTimers();
    const map = createMockMap({ withFeatures: false });
    const container = new LegendControl({ collapsed: false, updateDelay: 0 }).onAdd(map);
    vi.runAllTimers();
    expect(container.querySelector(".maplibre-legend-control-empty")?.textContent).toBe("Nothing to show in this view");
    vi.useRealTimers();
  });

  it("defers updates while collapsed and catches up on open", () => {
    vi.useFakeTimers();
    const map = createMockMap();
    const control = new LegendControl({ collapsed: true, updateDelay: 0 });
    const container = control.onAdd(map);
    vi.runAllTimers();
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);
    expect(container.querySelectorAll(".maplibre-legend-control-entry")).toHaveLength(0);

    control.open();
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(false);
    expect(container.querySelectorAll(".maplibre-legend-control-entry").length).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it("links the style's web-font stylesheet into the page once", () => {
    vi.useFakeTimers();
    const href = "https://static.example.org/webfonts/webfonts.css"; // fonts.css of the fixture manifest
    const count = () => [...document.head.querySelectorAll('link[rel="stylesheet"]')].filter((l) => l.getAttribute("href") === href).length;
    const control = new LegendControl({ collapsed: false, updateDelay: 0 });
    control.onAdd(createMockMap());
    vi.runAllTimers();
    expect(count()).toBe(1); // exactly one link in the page, however many controls and updates came before
    control.update();
    new LegendControl({ collapsed: false, updateDelay: 0 }).onAdd(createMockMap());
    vi.runAllTimers();
    expect(count()).toBe(1);
    vi.useRealTimers();
  });

  it("takes the fonts option over the manifest, and links nothing with false", () => {
    vi.useFakeTimers();
    const own = "https://fonts.example.com/own.css";
    new LegendControl({ collapsed: false, updateDelay: 0, fonts: own }).onAdd(createMockMap());
    vi.runAllTimers();
    expect([...document.head.querySelectorAll("link")].some((l) => l.getAttribute("href") === own)).toBe(true);
    const links = document.head.querySelectorAll("link").length;
    new LegendControl({ collapsed: false, updateDelay: 0, fonts: false }).onAdd(createMockMap());
    vi.runAllTimers();
    expect(document.head.querySelectorAll("link").length).toBe(links);
    vi.useRealTimers();
  });

  it("restricts the legend to the configured groups", () => {
    vi.useFakeTimers();
    const container = new LegendControl({ collapsed: false, groups: ["place"], updateDelay: 0 }).onAdd(createMockMap());
    vi.runAllTimers();
    expect([...container.querySelectorAll(".maplibre-legend-control-group")].map((g) => (g as HTMLElement).dataset.group)).toEqual(["place"]);
    vi.useRealTimers();
  });

  it("removes the container and the idle listener on remove", () => {
    const map = createMockMap();
    const control = new LegendControl();
    const container = control.onAdd(map);
    document.body.appendChild(container);

    control.onRemove();

    expect(document.body.contains(container)).toBe(false);
    map._fire("idle"); // must not throw or schedule anything
  });

  it("defaults to the bottom-left position, above the logo", () => {
    expect(new LegendControl().getDefaultPosition()).toBe("bottom-left");
  });
});
