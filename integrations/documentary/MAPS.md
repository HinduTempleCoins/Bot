# Maps for the documentary pipeline

Animated history-map clips (ticking year counter, changing borders, drawn routes) live on the CPU worker in
**`/opt/melek-gen/maps/out/`** with an index at **`/opt/melek-gen/maps/out/index.json`**:

```json
{ "updated": 1790000000, "clips": [ { "id": "alexander-campaign", "title": "Alexander's march", "subtitle": "…",
  "bbox": [12, 18, 80, 48], "fromYear": -336, "toYear": -280, "polities": ["Achaemenid Empire", "Macedonian Empire", …],
  "duration": 81.0, "file": "alexander-campaign.mp4", "file720": "alexander-campaign_720.mp4", "poster": "alexander-campaign.jpg",
  "licence": "CC BY 4.0 (territories, Cliopatria) + public domain (Natural Earth)", "credit": "Territories: Cliopatria …",
  "tags": ["alexander", "persia", …], "renderSeconds": 300 } ] }
```

Shot planner: match a shot's topic/era against `tags`, `polities` and `[fromYear, toYear]`; cut any sub-range (the
year counter is linear, so second *s* of the map section ≈ `fromYear + (toYear - fromYear) * (s - 2.5) / (duration - 6)` —
2.5 s title card at the start, 3.5 s credit card at the end). **CC BY 4.0: keep the credit** — show the clip's
`credit` on screen when the map is used, or in the film's end credits and description.

New maps on demand: write a job (see `integrations/maps/README.md`) and run `render_map.py` / `batch.py`. Public
gallery: `hathor.soapbox.community/maps` (media at `/maps/media/<file>`).
