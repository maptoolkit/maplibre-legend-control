import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  createFillSwatch,
  createLineSwatch,
  createSymbolOnSwatch,
  createSymbolPreview,
  fillShapeFamilyFor,
  nameWidth,
  pathMidTangent,
  truncateName,
  FILL_SHAPES,
  lineShapeFamilyFor,
  LINE_SHAPES,
  swatchVariantFor,
  textPlacement,
} from "../src/swatch";

/** Coordinates of an SVG path, command-aware (H carries x only, V y only). */
function coordsOf(d: string): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [, command, coords] of d.matchAll(/([MLCSHV])([^MLCSHVZ]*)/g)) {
    const numbers = coords
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    numbers.forEach((n, i) => (command === "H" || (command !== "V" && i % 2 === 0) ? xs : ys).push(n));
  }
  return { xs, ys };
}
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

describe("line shapes", () => {
  const line = (id: string) => ({ id, type: "line", role: "main", order: 0, paint: { "line-color": "rgba(0,0,0,1)", "line-width": 2 }, layout: {} });

  it("picks the shape family from how the feature runs on the map", () => {
    expect(lineShapeFamilyFor("road_aerialway_chair_lift")).toBe("geometric");
    expect(lineShapeFamilyFor("road_major_dark")).toBe("flat");
    expect(lineShapeFamilyFor("road_rail_bridge")).toBe("flat");
    expect(lineShapeFamilyFor("road_ferry")).toBe("flat");
    expect(lineShapeFamilyFor("border_admin_country")).toBe("flat");
    expect(lineShapeFamilyFor("road_path_alpine")).toBe("tight");
    expect(lineShapeFamilyFor("road_hiking")).toBe("tight");
    expect(lineShapeFamilyFor("relief_contour_monochrome")).toBe("tight");
    // the middle is the default: minor roads, pistes, cycle routes, waterways, protected areas, custom layers
    expect(lineShapeFamilyFor("road_minor")).toBe("medium");
    expect(lineShapeFamilyFor("road_piste_alpine")).toBe("medium");
    expect(lineShapeFamilyFor("road_cycling_route")).toBe("medium");
    expect(lineShapeFamilyFor("water_waterway")).toBe("medium");
    expect(lineShapeFamilyFor("border_protected_area")).toBe("medium");
    expect(lineShapeFamilyFor("customer_pipeline")).toBe("medium");
  });

  it("draws the variant's curve of that family and marks the box with it", () => {
    const shapes = LINE_SHAPES.geometric;
    for (const variant of [0, 1, shapes.length, shapes.length + 2]) {
      const box = createLineSwatch([line("road_aerialway_gondola")], variant);
      expect(box.classList.contains("maplibre-legend-control-swatch-line-geometric")).toBe(true);
      expect(box.querySelector("path")?.getAttribute("d")).toBe(shapes[variant % shapes.length]); // wraps around
    }
    expect(
      createLineSwatch([line("road_path")], 3)
        .querySelector("path")
        ?.getAttribute("d"),
    ).toBe(LINE_SHAPES.tight[3]);
  });

  it("offers four geometric shapes, two of them straight, and ten of every other family", () => {
    expect(LINE_SHAPES.geometric).toHaveLength(4);
    expect(LINE_SHAPES.geometric.filter((d) => d.match(/[MLHV]/g)?.length === 2)).toHaveLength(2); // two straight runs, differently oriented
    for (const family of ["flat", "medium", "tight"] as const) expect(LINE_SHAPES[family]).toHaveLength(10);
    for (const shapes of Object.values(FILL_SHAPES)) expect(shapes).toHaveLength(10);
  });

  it("keeps every curve edge to edge inside the stroke band and every family distinct", () => {
    for (const [family, shapes] of Object.entries(LINE_SHAPES)) {
      expect(new Set(shapes).size).toBe(shapes.length);
      for (const d of shapes) {
        const { xs, ys } = coordsOf(d);
        expect(Math.min(...xs)).toBe(2); // edge to edge, so butt caps cut flush
        expect(Math.max(...xs)).toBe(62);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(8); // the band wide strokes are scaled to fit
        expect(Math.max(...ys)).toBeLessThanOrEqual(18);
        expect(/[CS]/.test(d)).toBe(family !== "geometric"); // geometric bends sharply, the rest curves
      }
    }
  });

  it("uses one stable variant per key for lines and fills alike", () => {
    expect(swatchVariantFor("road:motorway")).toBe(swatchVariantFor("road:motorway"));
    const distinct = new Set(["road:major_dark", "road:minor", "road:path", "water:waterway", "border:admin_country", "road:rail"].map(swatchVariantFor));
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe("wide strokes", () => {
  const mk = (id: string, role: string, width: number, gap = 0, blur = 0) => ({
    id,
    type: "line",
    role,
    order: role === "casing" ? 0 : 1,
    paint: { "line-color": "rgba(0,0,0,1)", "line-width": width, ...(gap ? { "line-gap-width": gap } : {}), ...(blur ? { "line-blur": blur } : {}) },
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

  it("makes room for the blur, so the soft edge is not cut off by the box", () => {
    // z17 alpine piste: 36 px main, casing 6 px around a 36 px gap with a 12 px blur
    const svg = createLineSwatch([mk("casing", "casing", 6, 36, 12), mk("main", "main", 36)]);
    const [casing, main] = [...svg.querySelectorAll("path.maplibre-legend-control-stroke")] as SVGPathElement[];
    const width = Number(casing.getAttribute("stroke-width"));
    const blur = Number(casing.style.filter.match(/blur\(([\d.]+)px\)/)![1]);
    expect(width + 2 * blur).toBeCloseTo(16, 5); // stroke and its soft edge together fit the 26 px box under the 10 px curve
    expect(Number(main.getAttribute("stroke-width")) / width).toBeCloseTo(36 / 48, 5); // ratios kept
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
        // every coordinate inside the 64×26 box minus the 2 px margin
        const { xs, ys } = coordsOf(d);
        expect(Math.min(...xs, ...ys)).toBeGreaterThanOrEqual(2);
        expect(Math.max(...xs)).toBeLessThanOrEqual(62);
        expect(Math.max(...ys)).toBeLessThanOrEqual(24);
      }
    }
    expect(FILL_SHAPES.geometric.every((d) => !/[CLQ]/.test(d))).toBe(true); // orthogonal: only H/V edges
    expect(FILL_SHAPES.regular.every((d) => !/[CQ]/.test(d))).toBe(true); // straight edges
    expect(FILL_SHAPES.organic.every((d) => /C/.test(d))).toBe(true); // curves
  });
});

describe("a symbol on its feature's swatch", () => {
  const road = { id: "road_hiking", type: "line", role: "main", order: 3, paint: { "line-color": "rgba(200,40,40,1)", "line-width": 3 }, layout: {} };
  const casing = {
    id: "road_path_casing",
    type: "line",
    role: "casing",
    order: 2,
    paint: { "line-color": "rgba(255,255,255,1)", "line-width": 5 },
    layout: {},
  };

  it("draws the feature's line under the symbol and lets it stretch without thickening the strokes", () => {
    const box = createSymbolOnSwatch({ name: "Nordalpenweg", text: { fontStack: ["Rosario Bold"], size: 12 }, anchor: { swatch: [casing, road], variant: 3 } });
    expect(box.classList.contains("maplibre-legend-control-symbol-on")).toBe(true);
    expect(box.classList.contains("maplibre-legend-control-symbol-on-line")).toBe(true); // runs on past the name's ends
    const [swatch, symbol] = [...box.children] as HTMLElement[];
    expect(swatch.classList.contains("maplibre-legend-control-swatch-line")).toBe(true);
    expect(symbol.classList.contains("maplibre-legend-control-symbol")).toBe(true); // the symbol comes last: it paints on top
    expect(symbol.textContent).toBe("Nordalpenweg");
    const svg = swatch.querySelector("svg")!;
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none"); // the shape follows a wide name…
    for (const path of svg.querySelectorAll("path")) expect(path.getAttribute("vector-effect")).toBe("non-scaling-stroke"); // …the strokes do not
    expect(svg.querySelectorAll("path.maplibre-legend-control-stroke")).toHaveLength(2); // casing and road, as in the feature's own row
  });

  it("marks a surface, which encloses the name on every side", () => {
    const lake = { id: "water_area_inland", type: "fill", role: "main", order: 1, paint: { "fill-color": "rgba(120,170,220,1)" }, layout: {} };
    const box = createSymbolOnSwatch({ name: "Neusiedler See", text: { fontStack: ["Rosario Italic"] }, anchor: { swatch: [lake], variant: 0 } });
    expect(box.classList.contains("maplibre-legend-control-symbol-on-fill")).toBe(true);
    expect(box.querySelector("svg")?.getAttribute("preserveAspectRatio")).toBe("none");
  });

  it("uses the same shape as the feature's row", () => {
    const own = createLineSwatch([casing, road], 3).querySelector("path")!.getAttribute("d");
    const under = createSymbolOnSwatch({ name: "01", text: { fontStack: ["Rosario Bold"] }, anchor: { swatch: [casing, road], variant: 3 } })
      .querySelector("path")!
      .getAttribute("d");
    expect(under).toBe(own);
  });
});

describe("a name along its line", () => {
  const river = { id: "water_waterway", type: "line", role: "main", order: 2, paint: { "line-color": "rgba(80,140,200,1)", "line-width": 2 }, layout: {} };
  const label = { fontStack: ["Rosario Italic"], size: 12, color: "rgba(40,90,150,1)", haloColor: "rgba(255,255,255,1)", haloWidth: 1, alongLine: true };

  it("sets a following name on a guide with the line's shape, centred, halo below the glyphs", () => {
    const box = createSymbolOnSwatch({ name: "Donau", text: label, anchor: { swatch: [river], variant: 1 } });
    expect(box.classList.contains("maplibre-legend-control-symbol-on-path")).toBe(true);
    expect(box.querySelector(".maplibre-legend-control-symbol-text")).toBeNull(); // no HTML text over the line
    const svg = box.querySelector("svg")!;
    expect(svg.getAttribute("preserveAspectRatio")).toBeNull(); // glyphs are never stretched
    const along = svg.querySelector("text > textPath")!;
    expect(along.textContent).toBe("Donau");
    expect(along.getAttribute("startOffset")).toBe("50%");
    const guide = svg.querySelector(along.getAttribute("href")!)!;
    expect(guide.getAttribute("d")).toBe(svg.querySelector("path.maplibre-legend-control-stroke")!.getAttribute("d")); // the very bend of the line
    const text = svg.querySelector("text") as SVGElement;
    expect(text.getAttribute("text-anchor")).toBe("middle");
    expect(text.getAttribute("dominant-baseline")).toBe("central");
    expect(text.style.fontFamily).toContain("Rosario");
    expect(text.style.fontStyle).toBe("italic");
    expect(text.getAttribute("fill")).toBe("rgba(40,90,150,1)");
    expect(text.getAttribute("stroke")).toBe("rgba(255,255,255,1)");
    expect(text.getAttribute("stroke-width")).toBe("2"); // the halo radius on both sides
  });

  it("widens the line to a long name plus the reach, stretching the bend but not the strokes", () => {
    const box = createSymbolOnSwatch({ name: "Große Tulln", text: label, anchor: { swatch: [river], variant: 1 } });
    const svg = box.querySelector("svg")!;
    const width = Number(svg.getAttribute("width"));
    expect(width).toBeGreaterThan(64);
    expect(width).toBe(Math.ceil(nameWidth("Große Tulln", label) + 20)); // 10 px reach on each side
    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${width} 26`);
    for (const path of svg.querySelectorAll("path")) {
      expect(path.getAttribute("transform")).toMatch(/^scale\(\d+(\.\d+)? 1\)$/); // sideways only…
      expect(path.getAttribute("vector-effect")).toBe("non-scaling-stroke"); // …and the strokes keep their width
    }
    // a short name leaves the standard box alone
    const short = createSymbolOnSwatch({ name: "Inn", text: label, anchor: { swatch: [river], variant: 1 } }).querySelector("svg")!;
    expect(short.getAttribute("width")).toBe("64");
    expect(short.querySelector("path")!.getAttribute("transform")).toBeNull();
  });

  it("gives a tight bend up for a gentler one, as the map labels only its softer curves", () => {
    const path = { ...river, id: "road_hiking" }; // tight family
    const box = createSymbolOnSwatch({ name: "Nordalpenweg", text: label, anchor: { swatch: [path], variant: 0 } });
    expect(box.querySelector(".maplibre-legend-control-swatch-line-medium")).not.toBeNull();
    // the feature's own row keeps its tight bend
    expect(createLineSwatch([path], 0).classList.contains("maplibre-legend-control-swatch-line-tight")).toBe(true);
  });

  it("shifts the name off the line by text-offset and keeps it on one line", () => {
    const above = createSymbolOnSwatch({ name: "Kamp\nFluss", text: { ...label, offset: [0, -0.8] }, anchor: { swatch: [river], variant: 1 } });
    const text = above.querySelector("text")!;
    expect(text.getAttribute("dy")).toBe("-9.6"); // −0.8 em at 12 px, perpendicular to the path
    expect(text.textContent).toBe("Kamp Fluss");
  });

  it("keeps a shield upright and a plain label straight over the line", () => {
    const shieldText = { ...label, alongLine: false }; // text-rotation-alignment viewport
    const icon = {
      id: "road_major_shield",
      type: "symbol",
      role: "shield",
      order: 5,
      paint: {},
      layout: { "icon-image": "sdf:square", "icon-text-fit": "both", "symbol-placement": "line" },
    };
    const shield = createSymbolOnSwatch({ name: "A22", text: shieldText, icon, anchor: { swatch: [river], variant: 1 } });
    expect(shield.querySelector("textPath")).toBeNull();
    expect(shield.querySelector(".maplibre-legend-control-symbol-text")?.textContent).toBe("A22");
    const point = createSymbolOnSwatch({ name: "Knoten Tulln", text: { ...label, alongLine: false }, anchor: { swatch: [river], variant: 1 } });
    expect(point.querySelector("textPath")).toBeNull();
  });

  it("turns an arrow into the direction of the line at its middle", () => {
    const arrow = {
      id: "road_minor_oneway_arrows",
      type: "symbol",
      role: "arrows",
      order: 6,
      paint: {},
      layout: { "icon-image": "sdf:arrow", "symbol-placement": "line" },
    };
    const street = { ...river, id: "road_minor" }; // medium family, variant 0: "M 2 17 C 17.6 8, 34.4 18, 62 9"
    const box = createSymbolOnSwatch({ icon: arrow, anchor: { swatch: [street], variant: 0 } });
    const iconEl = box.querySelector(".maplibre-legend-control-symbol-icon") as HTMLElement;
    const d = box.querySelector("path")!.getAttribute("d")!;
    expect(iconEl.style.transform).toBe(`rotate(${Math.round(pathMidTangent(d) * 100) / 100}deg)`);
    // a shield's icon keeps viewport alignment: not turned
    const upright = { ...arrow, layout: { ...arrow.layout, "icon-rotation-alignment": "viewport" } };
    expect(
      (createSymbolOnSwatch({ icon: upright, anchor: { swatch: [street], variant: 0 } }).querySelector(".maplibre-legend-control-symbol-icon") as HTMLElement)
        .style.transform,
    ).toBe("");
  });
});

describe("a label stacked into a line row", () => {
  const contour = {
    id: "relief_contour_monochrome",
    type: "line",
    role: "main",
    order: 1,
    paint: { "line-color": "rgba(150,110,80,1)", "line-width": 1 },
    layout: {},
  };
  const elevation = {
    id: "relief_contour_monochrome_label",
    type: "symbol",
    role: "label",
    order: 2,
    paint: { "text-color": "rgba(120,90,60,1)", "text-halo-color": "rgba(255,255,255,1)", "text-halo-width": 1 },
    layout: { "text-field": "1500", "text-font": ["Rosario Regular"], "text-size": 10, "text-letter-spacing": 0.1, "symbol-placement": "line" },
  };

  it("sets the elevation along the contour in the contour's own row — one line with its number", () => {
    const box = createLineSwatch([contour, elevation], 2);
    const svg = box.querySelector("svg")!;
    const along = svg.querySelector("text > textPath")!;
    expect(along.textContent).toBe("1500");
    const text = svg.querySelector("text") as SVGElement;
    expect(text.style.letterSpacing).toBe("0.1em");
    expect(text.getAttribute("fill")).toBe("rgba(120,90,60,1)");
    expect(svg.querySelectorAll("path.maplibre-legend-control-stroke")).toHaveLength(1); // the label adds no stroke
    expect(box.classList.contains("maplibre-legend-control-swatch-line-medium")).toBe(true); // a contour's tight bend, eased for the number
    expect(createLineSwatch([contour], 2).querySelector("text")).toBeNull(); // no label stacked: the plain bend
  });

  it("grows the row's box with a long name and sets a point-placed label straight", () => {
    const named = { ...elevation, layout: { "text-field": "Höhenlinie 1500 m", "text-font": ["Rosario Regular"], "text-size": 12 } }; // no line placement
    const box = createLineSwatch([contour, named], 2);
    const svg = box.querySelector("svg")!;
    const width = Number(svg.getAttribute("width"));
    expect(width).toBeGreaterThan(64);
    expect(box.style.width).toBe(`${width}px`); // the box follows the SVG, not the fixed swatch width
    const text = svg.querySelector("text")!;
    expect(text.querySelector("textPath")).toBeNull();
    expect(text.getAttribute("x")).toBe(String(Math.round((width / 2) * 100) / 100));
    expect(text.getAttribute("y")).toBe("13");
    expect(text.textContent).toBe("Höhenlinie 1500 m");
  });
});

describe("pathMidTangent", () => {
  it("reads the direction at half the length", () => {
    expect(pathMidTangent("M 2 13 H 62")).toBe(0);
    expect(pathMidTangent("M 2 17 L 62 9")).toBeCloseTo((Math.atan2(-8, 60) * 180) / Math.PI, 5);
    expect(pathMidTangent("M 2 16 L 20 16 L 34 9 L 62 9")).toBeCloseTo((Math.atan2(-7, 14) * 180) / Math.PI, 5); // the climb sits in the middle
    // an S-bend passes its inflection in the middle, nearly level: B'(0.5) = (57.6, 1.5) for this shape
    expect(Math.abs(pathMidTangent("M 2 17 C 17.6 8, 34.4 18, 62 9"))).toBeLessThan(3);
    // a plain arc is steepest in the middle
    expect(pathMidTangent("M 2 20 C 20 20, 44 6, 62 6")).toBeCloseTo((Math.atan2(-14 * 1.5, 60 * 0.75 + 24 * 0.75) * 180) / Math.PI, 0);
  });
});

describe("nameWidth", () => {
  it("estimates without a canvas and adds the letter spacing", () => {
    const plain = nameWidth("Donau", { fontStack: ["Rosario Regular"], size: 10 });
    expect(plain).toBeGreaterThan(0);
    expect(nameWidth("Donau", { fontStack: ["Rosario Regular"], size: 10, letterSpacing: 0.1 })).toBeCloseTo(plain + 0.1 * 10 * 4, 5);
    expect(nameWidth("Donau", { fontStack: ["Rosario Regular"], size: 10, transform: "uppercase" })).toBeGreaterThanOrEqual(plain); // measured as shown
  });
});

describe("the name cap", () => {
  const text = { fontStack: ["Rosario Bold"], size: 14, maxWidth: 10 };

  it("lets a word up to the cap widen the box and wraps the rest at the map's text-max-width", () => {
    const box = createSymbolPreview({ name: "Tulln an der Donau", text }, undefined, { maxNameWidth: 200 });
    const el = box.querySelector(".maplibre-legend-control-symbol-text") as HTMLElement;
    expect(el.style.maxWidth).toBe("140px"); // 10 em at 14 px, below the cap
    expect(parseFloat(el.style.minWidth)).toBeCloseTo(nameWidth("Donau", text), 1); // the longest word
    expect(el.classList.contains("maplibre-legend-control-symbol-text-cut")).toBe(false);
  });

  it("cuts a word longer than the cap with an ellipsis", () => {
    const box = createSymbolPreview({ name: "Niederösterreich", text }, undefined, { maxNameWidth: 60 });
    const el = box.querySelector(".maplibre-legend-control-symbol-text") as HTMLElement;
    expect(el.style.maxWidth).toBe("60px");
    expect(el.style.minWidth).toBe("60px");
    expect(el.classList.contains("maplibre-legend-control-symbol-text-cut")).toBe(true);
    // without a cap nothing is set inline: the stylesheet keeps every word whole
    const free = createSymbolPreview({ name: "Niederösterreich", text }).querySelector(".maplibre-legend-control-symbol-text") as HTMLElement;
    expect(free.style.minWidth).toBe("");
    expect(free.classList.contains("maplibre-legend-control-symbol-text-cut")).toBe(false);
  });

  it("shortens a name set along a line until it fits", () => {
    const river = { id: "water_waterway", type: "line", role: "main", order: 2, paint: { "line-color": "rgba(80,140,200,1)", "line-width": 2 }, layout: {} };
    const label = { fontStack: ["Rosario Italic"], size: 12, alongLine: true };
    const long = "Wiener Neustädter Kanal";
    expect(truncateName(long, label, 80).endsWith("…")).toBe(true);
    expect(nameWidth(truncateName(long, label, 80), label)).toBeLessThanOrEqual(80);
    expect(truncateName("Inn", label, 80)).toBe("Inn"); // fits: untouched
    expect(truncateName(long, label)).toBe(long); // no cap: untouched
    const box = createSymbolOnSwatch({ name: long, text: label, anchor: { swatch: [river], variant: 1 } }, undefined, { maxNameWidth: 80 });
    const shown = box.querySelector("textPath")!.textContent!;
    expect(shown.endsWith("…")).toBe(true);
    expect(Number(box.querySelector("svg")!.getAttribute("width"))).toBe(Math.ceil(nameWidth(shown, label) + 20));
  });
});

describe("names", () => {
  it("offers a break after every slash, without changing the text", () => {
    const box = createSymbolPreview({ name: "Wien/Vienna", text: { fontStack: ["Rosario Regular"] } });
    const text = box.querySelector(".maplibre-legend-control-symbol-text") as HTMLElement;
    expect(text.textContent).toBe("Wien/Vienna"); // the slash stays with the part before it
    expect(text.querySelectorAll("wbr")).toHaveLength(1);
    expect(text.innerHTML).toBe("Wien/<wbr>Vienna");
    // a name without a slash stays a plain text node
    const plain = createSymbolPreview({ name: "Niederösterreich", text: { fontStack: ["Rosario Regular"] } });
    expect(plain.querySelector("wbr")).toBeNull();
  });
});

describe("shields (icon-text-fit)", () => {
  const image = { data: { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(255) }, pixelRatio: 1, sdf: true };
  // jsdom has no 2D canvas; the recolouring itself is covered by the icon swatch tests
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: () => {},
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAA");
  });
  afterEach(() => vi.restoreAllMocks());
  const shield = {
    id: "road_major_shield",
    type: "symbol",
    role: "shield",
    order: 1,
    paint: { "icon-color": "rgba(20,60,140,1)" },
    layout: { "icon-image": "sdf:square", "icon-text-fit": "both", "icon-text-fit-padding": [2, 5, 4, 5] },
  };

  it("pads a shield that the style barely pads, so a short ref still gets air", () => {
    const tight = { ...shield, layout: { ...shield.layout, "icon-text-fit-padding": [0, 0, 0, 0] } };
    const box = createSymbolPreview({ name: "W", text: { fontStack: ["Rosario Bold"], size: 20 }, icon: tight }, () => image);
    const text = box.querySelector(".maplibre-legend-control-symbol-text") as HTMLElement;
    expect(text.style.padding).toBe("2.4px 7px"); // 12 % of the size top/bottom, 35 % at the sides
  });

  it("keeps a stretchable sprite's frame and grows only its middle", () => {
    // the shield sprite is 9-sliced: content [4,4,21,21] of 25×25, so a 4 px frame all round
    const sliced = { ...image, data: { ...image.data, width: 25, height: 25 }, content: [4, 4, 21, 21] as [number, number, number, number] };
    const box = createSymbolPreview({ name: "18-2", text: { fontStack: ["Rosario Bold"], size: 12 }, icon: shield }, () => sliced);
    const text = box.querySelector(".maplibre-legend-control-symbol-text") as HTMLElement;
    expect(text.style.borderImageSlice).toBe("4 4 4 4 fill"); // top right bottom left, in image pixels
    expect(text.style.borderWidth).toBe("4px"); // the frame keeps its size, only the middle stretches
    expect(text.style.padding).toBe("2px 5px 4px"); // the style's own fit padding, untouched by any floor
    expect(text.style.backgroundImage).toBe(""); // border-image carries it, not a stretched background
  });

  it("stretches the icon behind the text and pads it, instead of drawing a picture beside it", () => {
    const box = createSymbolPreview({ name: "A22", text: { fontStack: ["Rosario Bold"], size: 12 }, icon: shield }, () => image);
    const text = box.querySelector(".maplibre-legend-control-symbol-text") as HTMLElement;
    expect(box.querySelector(".maplibre-legend-control-symbol-icon")).toBeNull(); // no icon of its own
    expect(text.style.backgroundImage).toContain("data:image"); // the shield is the text's background
    expect(text.style.padding).toBe("2px 5px 4px"); // top right bottom left, the bottom one shifts the number up
    // the box is exactly the name, so the stretched icon can never come out smaller than it
    expect(text.style.width).toBe("max-content");
    expect(text.style.maxWidth).toBe("none");
    expect(text.classList.contains("maplibre-legend-control-symbol-fitted")).toBe(true);
  });

  it("keeps the plain icon where the layer does not fit it to the text", () => {
    const plain = { ...shield, layout: { "icon-image": "sdf:square" } };
    const box = createSymbolPreview({ name: "A22", text: { fontStack: ["Rosario Bold"], size: 12 }, icon: plain }, () => image);
    expect(box.querySelector(".maplibre-legend-control-symbol-icon")).not.toBeNull();
    expect((box.querySelector(".maplibre-legend-control-symbol-text") as HTMLElement).style.backgroundImage).toBe("");
  });
});

describe("fill stack", () => {
  it("draws every fill of the stack in draw order, so an opaque base carries a translucent main", () => {
    const base = { id: "building_base", type: "fill", role: "base", order: 0, paint: { "fill-color": "rgba(248,248,247,1)" }, layout: {} };
    const footprint = {
      id: "building_footprint",
      type: "fill",
      role: "main",
      order: 1,
      paint: { "fill-color": "rgba(238,236,231,0.5)", "fill-outline-color": "rgba(199,198,193,0.5)" },
      layout: {},
    };
    const box = createFillSwatch(footprint, undefined, [base]);
    const fills = [...box.querySelectorAll("path.maplibre-legend-control-fill")] as SVGPathElement[];
    expect(fills.map((p) => p.getAttribute("fill"))).toEqual(["rgba(248,248,247,1)", "rgba(238,236,231,0.5)"]); // base below the footprint
    expect(box.querySelector("path.maplibre-legend-control-fill-outline")).not.toBeNull();
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
