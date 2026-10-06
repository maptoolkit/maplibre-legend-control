# @maptoolkit/maplibre-legend-control

## 1.0.2

### Patch Changes

- a2055b7: Line swatches show the map's widths: strokes up to 30 px are drawn as wide as on the map (the row grows taller for them) instead of being capped at 16 px each, and wider ones are scaled down with one scale for all lines of a group, so a minor road stays narrower than a major one at every zoom.
- 43370f6: List rows keep their content height: a host that gave the list a fixed height (e.g. a flex layout) squeezed the rows and symbols with their names ran into the neighbouring rows; the list now scrolls instead.

## 1.0.1

### Patch Changes

- 793981b: The panel's ✕ no longer covers the first row's ⓘ: its box hugs the glyph and sits on the first heading's line, with a 24px hit area.
