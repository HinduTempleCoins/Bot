# Hathor's documentary maker (ALPHA)

Text → wordless documentary, on our own servers. The style is the slow, eerie "living among the ancients / how did they
build this" genre: recreated scenes with a slow camera, sparse on-screen cards, and an ambient soundtrack, with **no
narration** (narration and an on-camera Hathor come later). Every factual card says what kind of claim it is:
**historical record**, **tradition / scripture**, or **the Institute's interpretation**. Mythic scenes (gods at real
places, spirits, giants) are shown as belief, never asserted. Every film carries an ALPHA notice.

## Pieces

| file | runs on | what it does |
|---|---|---|
| `topics.mjs`, `topics-wave1.mjs` | anywhere | grounded fact sheets: `{ title, summary, peoples, facts:[{id, tag, source, text, card, visual}], outline:[{title, card, minutes, goal, facts}] }` |
| `plan.mjs` | anywhere | shot-plan prompt styles (`wonder`, `question`, `placeEra`, `mythic`), JSON parsing, automatic scoring, fact-sheet fallback plan |
| `run.mjs` | LLM host (keys) / here | CLI: `plan-test`, `shotplan`, `board` (+ older narration commands `prompt-test`, `script`, `outline`, `plan`) |
| `shots.mjs` | anywhere | keyword matching of scenes to parts, render prompts, sources, YouTube metadata |
| `index_assets.py` | worker | indexes every part we have → `assets.json` (remakes, characters, objects, landscapes, animation clips, stills, maps) |
| `render_wordless.py` | worker | `board.json` → `film.mp4` + `poster.jpg` + `film.json` (chapters, on-screen text, sources, recipe, missing parts) |
| `batch.mjs` | this Codespace | plans, boards, renders and publishes films back to back; styles chosen from feedback |
| `site/hathor/documentaries.mjs` | web | `/documentaries` (Studio): films, chapters, cards, sources, 👍/👎, comments, timestamped notes, `/documentaries/feedback.json` |

## Interface (for the Video Studio and other callers)

```
# 1. shot plan (on the host with LLM keys; free-first ladder in integrations/llm-router.mjs; GROQ_MODEL=openai/gpt-oss-120b works)
node integrations/documentary/run.mjs shotplan --topic <id> --style wonder|question|placeEra|mythic --minutes 10|30|60 --out plan.json
#    → { topic, title, summary, style, minutes, sequences:[…], scenes:[{sequence, visual, camera, seconds, card, kind, source}], score }

# 2. board: plan + parts index → shots with assets (reuse-only by default; --renders N allows N new CPU renders)
node integrations/documentary/run.mjs board --plan plan.json --index assets.json --out board.json [--renders 0]
#    → { …plan, shots:[{…scene, image, asset, assetType}], missing:[{sequence, visual}], sources:{record,tradition,interpretation}, credits:[…] }

# 3. render (worker)
nice -n 15 python render_wordless.py board.json --out DIR [--size 1280x720] [--fps 24]
#    → DIR/film.mp4, poster.jpg, film.json { id, title, seconds, chapters, onscreen, sources, credits, alpha, audio, missing, recipe }

# all of it, published:
DOC_LLM_HOST=… DOC_WORKER_HOST=… DOC_WEB_HOST=… node integrations/documentary/batch.mjs --topics kush-nile,tomb-life --minutes 10
DOC_…=… node integrations/documentary/batch.mjs --queue queue.json     # [{ "topic": "minoans", "minutes": 30, "style": "wonder" }]
```

Prompt tests: `run.mjs plan-test --out DIR` runs every style on two topics and writes `plan-results.json` and
`plan-side-by-side.md` (scores: duration fit, sourced factual cards, mythic cards phrased as belief, on-screen text
sparsity ≤ 25 words/min, visual/camera variety). First run (29 Sep 2026): `wonder` scored best and is the default.

## Rules the code enforces

- A factual card's kind comes from the fact sheet, not the model: if a card's source matches a fact with a different
  tag, the board corrects the kind and uses the fact's own wording; a card whose source matches no fact loses its label.
- Reuse first: no scene more than 4 times per film, none again within 12 shots; scenes nothing fits go to the film's
  `missing` list (shown on the film page) — that list is the next render queue.
- Audio is synthesized here (wind, drone, water) and released CC0; maps (Cliopatria, CC BY 4.0) carry their credit into
  the end card and `film.json`.
- Nothing is uploaded to YouTube: `shots.mjs#youtubeMeta` writes the title, description (with the ALPHA line, chapters and
  sources) and tags for the operator to publish.

## Cost

A 10-minute reuse-only film renders in about 4–5 minutes of worker CPU at `nice 15` (≈3.5 s per shot). 30 and 60
minutes scale linearly (≈15 and ≈30 minutes of CPU). Every new CPU image render adds ~3–4 minutes.
