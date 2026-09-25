import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  createFillSwatch,
  createLineSwatch,
  createSymbolPreview,
  fillShapeFamilyFor,
  FILL_SHAPES,
  lineVariantFor,
  LINE_VARIANTS,
  swatchVariantFor,
  textPlacement,
} from "../src/swatch";
import type { TextStyle } from "../src/types";

const cases: Array<[Partial<TextStyle> | undefined, ReturnType<typeof textPlacement>]> = [
  [{ anchor: "top", offset: [0, 0.8] }, "below"],
  [{ anchor: "bottom" }, "above"],
  [{ anchor: "left" }, "right"],
  [{ anchor: "right" }, "left"],
  [{ anchor: "top-left" }, "below"],
  [{ anchor: "center", offset: [0, 1] }, "below"],
  [{ anchor: "center", offset: [-1.2, 0] }, "left"],
  [{ anchor: "center" }, "overlay"],
  [undefined, "overlay"],
];

describe("textPlacement", () => {
  it.each(cases)("%j → %s", (text, expected) => {
    expect(textPlacement(text ? { fontStack: [], ...text } : undefined)).toBe(expected);
  });
});

describe("createSymbolPreview", () => {
  it("arranges icon and text by placement and keeps a text-only symbol plain", () => {
    const icon = { id: "poi", type: "symbol", role: "icon", order: 1, paint: {}, layout: { "icon-image": { name: "sdf:bench" } } };
    const both = createSymbolPreview({ name: "Bankerl", text: { fontStack: ["Rosario Bold"], size: 12, anchor: "top", offset: [0, 0.8] }, icon });
    expect(both.classList.contains("maplibre-legend-control-symbol-below")).toBe(true);
    expect(both.children).toHaveLength(2);
    expect((both.lastElementChild as HTMLElement).style.fontFamily).toContain("Rosario");

    const textOnly = createSymbolPreview({ name: "Tulln", text: { fontStack: ["Rosario Bold"], size: 14 } });
    expect(textOnly.classList.contains("maplibre-legend-control-symbol-single")).toBe(true);
    expect(textOnly.children).toHaveLength(1);
  });
});

describe("line variants", () => {
  it("assigns a stable variant per key within range", () => {
    expect(lineVariantFor("road:major_dark")).toBe(lineVariantFor("road:major_dark"));
    for (const k of ["road:major_dark", "road:minor", "road:path", "water:waterway", "border:admin_country"]) {
      const v = lineVariantFor(k);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(LINE_VARIANTS);
    }
    const distinct = new Set(["road:major_dark", "road:minor", "road:path", "water:waterway", "border:admin_country", "road:rail"].map(lineVariantFor));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("draws the chosen curve", () => {
    const layer = { id: "l", type: "line", role: "main", order: 0, paint: { "line-color": "rgba(0,0,0,1)", "line-width": 2 }, layout: {} };
    const a = createLineSwatch([layer], 0).querySelector("path")?.getAttribute("d");
    const b = createLineSwatch([layer], 1).querySelector("path")?.getAttribute("d");
    expect(a).not.toBe(b);
    expect(createLineSwatch([layer], LINE_VARIANTS).querySelector("path")?.getAttribute("d")).toBe(a); // wraps around
  });
});

describe("wide strokes", () => {
  const mk = (id: string, role: string, width: number, gap = 0) => ({
    id,
    type: "line",
    role,
    order: role === "casing" ? 0 : 1,
    paint: { "line-color": "rgba(0,0,0,1)", "line-width": width, ...(gap ? { "line-gap-width": gap } : {}) },
    layout: { "line-cap": "round" },
  });

  it("scales the stack so the widest stroke plus the curve fits the box, keeping ratios", () => {
    // z18 motorway: 24 px main, casing 2 px around a 24 px gap = 28 px
    const svg = createLineSwatch([mk("casing", "casing", 2, 24), mk("main", "main", 24)]);
    const widths = [...svg.querySelectorAll("path.maplibre-legend-control-stroke")].map((p) => Number(p.getAttribute("stroke-width")));
    expect(Math.max(...widths)).toBeCloseTo(16, 5); // 26 px box − 10 px curve extent
    expect(widths[1] / widths[0]).toBeCloseTo(24 / 28, 5);
  });

  it("keeps a casing's gap see-through instead of painting it in the casing colour", () => {
    const svg = createLineSwatch([mk("casing", "casing", 2, 24), mk("main", "main", 24)]);
    const casing = svg.querySelector("path.maplibre-legend-control-stroke-casing") as SVGPathElement;
    const ref = casing.getAttribute("mask")?.match(/^url\(#(.+)\)$/)?.[1];
    expect(ref).toBeTruthy();
    const cut = svg.querySelector(`mask[id="${ref}"] path`) as SVGPathElement;
    expect(cut.getAttribute("stroke")).toBe("black");
    expect(Number(cut.getAttribute("stroke-width"))).toBeCloseTo((24 * 16) / 28, 5); // the gap, scaled like the strokes
    expect(svg.querySelector("path.maplibre-legend-control-stroke-main")?.getAttribute("mask")).toBeNull();
  });

  it("leaves narrow stacks unscaled", () => {
    const svg = createLineSwatch([mk("main", "main", 3)]);
    expect(svg.querySelector("path")?.getAttribute("stroke-width")).toBe("3");
  });
});

describe("caps", () => {
  it("cuts solid strokes flush with butt caps but keeps the layer cap for dashes", () => {
    const solid = { id: "c", type: "line", role: "casing", order: 0, paint: { "line-color": "#000", "line-width": 4 }, layout: { "line-cap": "round" } };
    const dashed = {
      id: "h",
      type: "line",
      role: "hatching",
      order: 1,
      paint: { "line-color": "#000", "line-width": 6, "line-dasharray": [0.1, 8] },
      layout: { "line-cap": "butt" },
    };
    const svg = createLineSwatch([solid, dashed]);
    const [c, h] = [...svg.querySelectorAll("path")];
    expect(c.getAttribute("stroke-linecap")).toBe("butt");
    expect(h.getAttribute("stroke-linecap")).toBe("butt");
    expect(h.getAttribute("stroke-dasharray")).toBe("0.6 48");
    expect(h.getAttribute("stroke-dashoffset")).toBe("-24.6");
  });
});

describe("fill swatch borders", () => {
  it("draws line layers of the stack as a (dashed) border around the box", () => {
    const fill = {
      id: "water_intermittent",
      type: "fill",
      role: "main",
      order: 0,
      paint: { "fill-color": "rgba(170,200,230,1)", "fill-opacity": 0.8 },
      layout: {},
    };
    const casing = {
      id: "water_intermittent_casing",
      type: "line",
      role: "casing",
      order: 1,
      paint: { "line-color": "rgba(60,120,180,1)", "line-width": 2, "line-dasharray": { from: [3, 2], to: [3, 2] } },
      layout: { "line-cap": "butt" },
    };
    const box = createFillSwatch(fill, undefined, [casing]);
    const shape = box.querySelector("path.maplibre-legend-control-fill") as SVGPathElement;
    expect(shape.getAttribute("fill")).toBe("rgba(170,200,230,1)");
    expect(shape.getAttribute("fill-opacity")).toBe("0.8");
    const border = box.querySelector("path.maplibre-legend-control-border-casing") as SVGPathElement;
    expect(border).not.toBeNull();
    expect(border.getAttribute("d")).toBe(shape.getAttribute("d")); // along the shape's own edge
    expect(border.getAttribute("stroke")).toBe("rgba(60,120,180,1)");
    expect(border.getAttribute("stroke-width")).toBe("4"); // twice the width, clipped to the shape → 2 px inside
    expect(border.getAttribute("clip-path")).toMatch(/^url\(#.+-clip\)$/);
    expect(border.getAttribute("stroke-dasharray")).toBe("6 4"); // [3, 2] × width 2
  });

  it("has no border path without line layers", () => {
    const fill = { id: "f", type: "fill", role: "main", order: 0, paint: { "fill-color": "#abc" }, layout: {} };
    expect(createFillSwatch(fill).querySelector(".maplibre-legend-control-border")).toBeNull();
  });
});

describe("fill shapes", () => {
  const fill = (id: string) => ({ id, type: "fill", role: "main", order: 0, paint: { "fill-color": "#abc" }, layout: {} });

  it("picks the shape family from what the layer depicts", () => {
    expect(fillShapeFamilyFor("building_footprint")).toBe("geometric");
    expect(fillShapeFamilyFor("building_3d_multicolored")).toBe("geometric");
    expect(fillShapeFamilyFor("nature_natural")).toBe("organic");
    expect(fillShapeFamilyFor("water_area_inland")).toBe("organic");
    expect(fillShapeFamilyFor("water_intermittent")).toBe("organic");
    expect(fillShapeFamilyFor("nature_landuse")).toBe("regular");
    expect(fillShapeFamilyFor("nature_pedestrian")).toBe("regular");
  });

  it("draws the variant's polygon of that family and marks the box with it", () => {
    const shapes = FILL_SHAPES.geometric;
    for (const variant of [0, 1, shapes.length, shapes.length + 2]) {
      const box = createFillSwatch(fill("building_footprint"), undefined, [], variant);
      expect(box.classList.contains("maplibre-legend-control-swatch-fill-geometric")).toBe(true);
      expect(box.querySelector("path.maplibre-legend-control-fill")?.getAttribute("d")).toBe(shapes[variant % shapes.length]);
    }
    expect(createFillSwatch(fill("nature_natural"), undefined, [], 3).querySelector("path.maplibre-legend-control-fill")?.getAttribute("d")).toBe(
      FILL_SHAPES.organic[3],
    );
  });

  it("keeps every shape inside the box with its margin and every family distinct", () => {
    for (const shapes of Object.values(FILL_SHAPES)) {
      expect(new Set(shapes).size).toBe(shapes.length);
      for (const d of shapes) {
        expect(d.trim().endsWith("Z")).toBe(true);
        // every coordinate inside the 64×26 box minus the 2 px margin (H carries x only, V y only)
        for (const segment of d.matchAll(/([MLCHV])([^MLCHVZ]*)/g)) {
          const [, command, coords] = segment;
          const numbers = coords
            .trim()
            .split(/[\s,]+/)
            .filter(Boolean)
            .map(Number);
          numbers.forEach((n, i) => {
            const isX = command === "H" || (command !== "V" && i % 2 === 0);
            expect(n).toBeGreaterThanOrEqual(2);
            expect(n).toBeLessThanOrEqual(isX ? 62 : 24);
          });
        }
      }
    }
    expect(FILL_SHAPES.geometric.every((d) => !/[CLQ]/.test(d))).toBe(true); // orthogonal: only H/V edges
    expect(FILL_SHAPES.regular.every((d) => !/[CQ]/.test(d))).toBe(true); // straight edges
    expect(FILL_SHAPES.organic.every((d) => /C/.test(d))).toBe(true); // curves
  });

  it("uses one stable variant per key for lines and fills alike", () => {
    expect(swatchVariantFor("road:motorway")).toBe(swatchVariantFor("road:motorway"));
    expect(lineVariantFor("road:motorway")).toBe(swatchVariantFor("road:motorway") % LINE_VARIANTS);
  });
});

describe("fill patterns", () => {
  it("asks the map for the pattern image named by a cross-faded fill-pattern", () => {
    const fill = { id: "nature_natural", type: "fill", role: "main", order: 0, paint: { "fill-color": "#9c9" }, layout: {} };
    const texture = {
      id: "nature_natural_texture",
      type: "fill",
      role: "texture",
      order: 1,
      paint: { "fill-pattern": { from: { name: "nature:wood" }, to: { name: "nature:wood" } } },
      layout: {},
    };
    const getImage = vi.fn(() => undefined);
    createFillSwatch(fill, getImage, [texture]);
    expect(getImage).toHaveBeenCalledWith("nature:wood");
  });
});

describe("fill swatch shadows", () => {
  it("renders a blurred shadow stroke as a soft halo instead of a frame", () => {
    const fill = {
      id: "building_footprint",
      type: "fill",
      role: "main",
      order: 1,
      paint: { "fill-color": "rgba(230,230,230,1)", "fill-outline-color": "rgba(200,200,200,1)" },
      layout: {},
    };
    const shadow = {
      id: "building_shadow",
      type: "line",
      role: "shadow",
      order: 0,
      paint: { "line-color": "rgba(60,50,40,1)", "line-width": 12, "line-blur": 13, "line-opacity": 0.3 },
      layout: { "line-cap": "butt" },
    };
    const box = createFillSwatch(fill, undefined, [shadow]);
    expect(box.querySelector(".maplibre-legend-control-border")).toBeNull(); // no crisp border
    const outline = box.querySelector("path.maplibre-legend-control-fill-outline") as SVGPathElement; // the hairline stays, inside the shape
    expect(outline.getAttribute("stroke")).toBe("rgba(200,200,200,1)");
    expect(outline.getAttribute("clip-path")).toMatch(/^url\(#/);
    const halo = box.querySelector("path.maplibre-legend-control-fill-halo-shadow") as SVGPathElement;
    expect(halo.getAttribute("stroke")).toBe("rgba(60,50,40,1)");
    expect(halo.getAttribute("stroke-opacity")).toBe("0.3"); // as faint as the layer
    expect(halo.getAttribute("stroke-width")).toBe("8"); // width capped
    expect(halo.style.filter).toBe("blur(4px)"); // blur capped
    // below the fill: only the outer half shows beside the shape
    const shape = box.querySelector("path.maplibre-legend-control-fill") as SVGPathElement;
    expect(halo.compareDocumentPosition(shape) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
