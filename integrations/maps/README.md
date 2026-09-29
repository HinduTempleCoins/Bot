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

**Route stops** (`stops`, optional) — the march pauses at each stop: the camera eases in to a sharp close-up map of
the place (re-rendered, not a blurry zoom), cross-fades into the stop's pictures or clips with a place + date card
(its kind — *historical record*, *tradition*, *debated*, *interpretation* — and its source), then pulls back and the
year counter carries on. `--segments DIR` also writes one clip per stop.

| Stop field | Required | Meaning |
|---|---|---|
| `label`, `lat`, `lon`, `year` | yes | place, position, and when (within `years`; fractions = months as above); stops in time order |
| `date` | | the card's date text (default: the formatted year), e.g. `"2 August 216 BC"` |
| `hold` | | seconds on the stop's pictures, 2..180 (default 12) |
| `media` | | ≤ 12 items: `"remake:<scene>/<file>"`, `"library:<set>/<file>"`, `"anim:<id>/clip.mp4"`, `"parallax:<name>.mp4"` (our galleries by name), an `https://` image/mp4, or `{ "src", "credit", "caption" }` |
| `caption`, `kind`, `source`, `zoom` (1.2..12, default 3), `chapter` | | card text and grouping |

Remote pictures are cached once on the render host (`maps/stops/cache/`, polite retries); `render_map.py job.json
--prefetch --out /dev/null` fetches them ahead of a render. Sample: [`samples/job-stops.json`](samples/job-stops.json).

**Films** — `route_film.py clips/<id>.json --data data --maps-out out --docs-out <docs_out>` renders the stops film,
lays our CC0 ambient bed under the 720p cut, writes the documentary (`film.mp4`, `poster.jpg`, `film.json` with
chapters, cards, grouped sources, every picture credit, the Alpha + testing notice and the missing-assets list) and
adds the clip + its per-stop segments to `out/index.json`. Our films: `clips/gen_route_films.py` writes
*Hannibal: Across the Map* and *The Phoenician Colonies & Carthage*.

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
      "from": { "type": "integer" }, "to": { "type": "integer" } } } },
    "stops": { "type": "array", "maxItems": 60, "items": { "type": "object", "required": ["label", "lat", "lon", "year"], "properties": {
      "label": { "type": "string", "maxLength": 80 }, "lat": { "type": "number", "minimum": -90, "maximum": 90 }, "lon": { "type": "number", "minimum": -180, "maximum": 180 },
      "year": { "type": "number" }, "date": { "type": "string", "maxLength": 60 }, "hold": { "type": "number", "minimum": 2, "maximum": 180 },
      "media": { "type": "array", "maxItems": 12, "items": { "oneOf": [ { "type": "string" },
        { "type": "object", "required": ["src"], "properties": { "src": { "type": "string" }, "credit": { "type": "string" }, "caption": { "type": "string" } } } ] } },
      "caption": { "type": "string", "maxLength": 300 }, "kind": { "enum": ["record", "tradition", "debated", "interpretation", "none"] },
      "source": { "type": "string" }, "zoom": { "type": "number", "minimum": 1.2, "maximum": 12 }, "chapter": { "type": "string" } } } }
  }
}
```

## Our clip set

`clips/gen_clips.py` writes the jobs: Egypt, Kush & Nubia, Mesopotamia, the Persian empires, Alexander's march (with
route), Rome, Hannibal's war (with route), Phoenicians & Carthage, Byzantium, the Ottomans, China's dynasties,
India's empires, the caliphates, the Mongols, the Aztec & Inca, and the whole world 3000 BC → AD 1900.
Gaps in the data: Kerma, Napata and Meroë are one "Kingdom of Kush" polity (1000 BC – AD 346); there is no separate
Ur III entry. Every clip is **Alpha** — Hathor's first maps; later versions will be more accurate.
