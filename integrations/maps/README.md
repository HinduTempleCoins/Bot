# Animated history maps

Territories that change over time, a year counter that ticks, campaign routes that draw themselves, cities that
appear and vanish. CPU-only: `render_map.py` (shapely, pyproj, matplotlib, Pillow, ffmpeg). The **same job format**
renders our own clip set (`clips/*.json`) and anything a user brings through the Video Studio.

```
python render_map.py job.json --out clip.mp4 [--out720 clip_720.mp4] [--poster poster.jpg] --data DATA_DIR
python batch.py --clips clips --out OUT_DIR --data DATA_DIR [--only id1,id2]     # renders all, writes OUT_DIR/index.json
```
`DATA_DIR` holds `cliopatria_polities_only.geojson` and Natural Earth `ne_50m_land`, `ne_50m_lakes`,
`ne_50m_rivers_lake_centerlines` (GeoJSON). Licences: [LICENCES.md](LICENCES.md).

## Job format

Years are integers: **negative = BC** (`-334` → "334 BC"), positive = AD; there is no year 0. Route years may be
fractional so a march moves smoothly within a year (month *m* of year *Y* BC = `-Y + (m - 1) / 12`).

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | ≤ 120 characters (title card + corner) |
| `bbox` | yes | `[lonMin, latMin, lonMax, latMax]` in degrees |
| `years` | yes | `[from, to]`, from < to, −4000…2100 |
| `territories` | one of territories/routes | see below |
| `routes` | | `[{ label, path: "route.csv" \| points: [...], colour: "#rrggbb" }]` |
| `cities` | | `[{ name, lat, lon, from?, to? }]` — shown only between `from` and `to` |
| `size`, `fps`, `duration` | | default 1920×1080, 24 fps, 60 s (≤ 3840×2160, 12–60 fps, 5–600 s) |
| `subtitle`, `credit`, `palette` (`night`\|`parchment`), `projection` (`auto`\|`equirect`), `stepYears`, `tags` | | `stepYears` = how often territories may change (default span/150) |

**Territories**, three ways:
1. **Built-in (Cliopatria)** — `{ "source": "cliopatria", "names": ["Roman Empire", …], "match": ["Egypt"], "context": true }`:
   exact polity names and/or case-insensitive substrings; `context` draws every other polity in view faintly.
2. **Everything in view** — `{ "source": "cliopatria-bbox" }` (the whole-world overview uses this).
3. **Your own data** — `{ "source": "geojson", "path": "territories.geojson" }`: a FeatureCollection of Polygon /
   MultiPolygon features with `properties: { name, fromYear, toYear, colour? }` (a territory that changes shape is
   several features with the same name and consecutive year ranges). ≤ 5,000 features, ≤ 50 MB.

**Route CSV** — header `label,lat,lon,year[,note]`, ≥ 2 rows, years never going backwards, ≤ 5,000 rows.

Samples: [`samples/job.json`](samples/job.json), [`samples/territories.geojson`](samples/territories.geojson),
[`samples/route.csv`](samples/route.csv). Validation (`spec.mjs` in Node, `validate()` in Python) fails with a
clear message naming the field and row.

### JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Hathor history-map job",
  "type": "object",
  "required": ["title", "bbox", "years"],
  "anyOf": [{ "required": ["territories"] }, { "required": ["routes"] }],
  "properties": {
    "title": { "type": "string", "minLength": 1, "maxLength": 120 },
    "subtitle": { "type": "string" },
    "bbox": { "type": "array", "items": { "type": "number" }, "minItems": 4, "maxItems": 4 },
    "years": { "type": "array", "items": { "type": "integer", "minimum": -4000, "maximum": 2100 }, "minItems": 2, "maxItems": 2 },
    "size": { "type": "array", "items": { "type": "integer", "minimum": 240, "maximum": 3840 }, "minItems": 2, "maxItems": 2 },
    "fps": { "type": "integer", "minimum": 12, "maximum": 60 },
    "duration": { "type": "number", "minimum": 5, "maximum": 600 },
    "palette": { "enum": ["night", "parchment"] },
    "projection": { "enum": ["auto", "equirect"] },
    "stepYears": { "type": "integer", "minimum": 1 },
    "credit": { "type": "string" },
    "tags": { "type": "array", "items": { "type": "string" } },
    "territories": { "oneOf": [
      { "type": "object", "required": ["source"], "properties": { "source": { "const": "cliopatria" },
        "names": { "type": "array", "items": { "type": "string" } }, "match": { "type": "array", "items": { "type": "string" } }, "context": { "type": "boolean" } } },
      { "type": "object", "required": ["source"], "properties": { "source": { "const": "cliopatria-bbox" }, "minArea": { "type": "number" } } },
      { "type": "object", "required": ["source"], "properties": { "source": { "const": "geojson" }, "path": { "type": "string" }, "data": { "type": "object" } } }
    ] },
    "routes": { "type": "array", "items": { "type": "object", "properties": {
      "label": { "type": "string" }, "path": { "type": "string" }, "points": { "type": "array" },
      "colour": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" } } } },
    "cities": { "type": "array", "items": { "type": "object", "required": ["name", "lat", "lon"], "properties": {
      "name": { "type": "string" }, "lat": { "type": "number", "minimum": -90, "maximum": 90 }, "lon": { "type": "number", "minimum": -180, "maximum": 180 },
      "from": { "type": "integer" }, "to": { "type": "integer" } } } }
  }
}
```

## Our clip set

`clips/gen_clips.py` writes the jobs: Egypt, Kush & Nubia, Mesopotamia, the Persian empires, Alexander's march (with
route), Rome, Hannibal's war (with route), Phoenicians & Carthage, Byzantium, the Ottomans, China's dynasties,
India's empires, the caliphates, the Mongols, the Aztec & Inca, and the whole world 3000 BC → AD 1900.
Gaps in the data: Kerma, Napata and Meroë are one "Kingdom of Kush" polity (1000 BC – AD 346); there is no separate
Ur III entry. Every clip is **Alpha** — Hathor's first maps; later versions will be more accurate.
