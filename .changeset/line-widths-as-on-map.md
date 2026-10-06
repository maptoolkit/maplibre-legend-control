---
"@maptoolkit/maplibre-legend-control": patch
---

Line swatches show the map's widths: strokes up to 30 px are drawn as wide as on the map (the row grows taller for them) instead of being capped at 16 px each, and wider ones are scaled down with one scale for all lines of a group, so a minor road stays narrower than a major one at every zoom.
