# Hathor media pipeline — auto post-images + product-ad videos

*Built 2026-09-22. Design + scaffold. Nothing here deploys, hosts, signs, or broadcasts — it builds
media and plans. Broadcasting stays behind the MELEK-Signer boundary (BRIEF.md §7: zero WIF in this
repo).*

Two deliverables, both offline-testable:

1. **Every Hathor post auto-gets a cover image** — `witness/hathor-post-image.mjs`
2. **Hathor produces short product-ad videos** — `integrations/hathor-product-ad.mjs`

Both reuse the GenAI modules already in the repo instead of adding backends.

---

## 1. Post cover images — `witness/hathor-post-image.mjs`

| fn | what it does |
|---|---|
| `derivePrompt(post)` | post `{title,tags,topic}` → an image prompt that **always leads with Hathor's canonical signature** (`HATHOR_SIGNATURE`: VR headset, horned Hathor-Mehit headdress, wesekh collar, gold cuffs, blue-black lips, white linen, wings — from `character/reference/README.md`) + a topic-fitted scene (`defi`/`witness`/`tutorial`/`library`/`tools`/`video`/`announce`). Pure. |
| `generatePostImage(post, deps)` | derive → `deps.generate({prompt,size})` → optional `deps.upload(bytes)→url`. Default generator = `integrations/genai-providers.generateImage` (free-first **cloudflare→gemini→pollinations**; pollinations is keyless, so it always resolves with no account/card). |
| `attachImageToPost(post, url)` | merge the URL into `json_metadata.image[]` — **Hive convention: first entry = cover/thumbnail**. Pure, de-dupes, keeps app/tags. |
| `ensurePostImage(post, deps)` | the automation hook: skip if a cover already exists, else generate+host+attach. Idempotent. **This is what makes "every announcement gets an image" automatic.** |

**Backend chosen:** `genai-providers` — because it is already the vetted, free-first, keyless-fallback
image path (see `deploy/hathor/RUNBOOK.md`). No new key, no new dependency. Pollinations covers the
zero-key case; Cloudflare/Gemini upgrade quality when their keys are present (JIT from the vault on the
box).

**Signer boundary:** the module returns image **bytes** + a `metadataPatch`. It never uploads by
itself — hosting is an injected `upload` dep (the on-box media host / IPFS pin, kept out of the repo).
With no `upload` it returns the bytes and a `data:` URL and reports `hosted:false`, so a caller never
silently thinks an on-chain image exists when it doesn't (Charter rule 3).

### Wiring into posting

Any code that builds a `['comment', {...}]` op (e.g. `witness/create-welcome-post.mjs`,
`witness/hathor-welcome-live.mjs`, `witness/hathor-steemd-answer.mjs`) gets a two-line change **before**
it hands the op to the signer:

```js
import { ensurePostImage } from './hathor-post-image.mjs';
// post = { title, body, tags, json_metadata }
const { post: withCover } = await ensurePostImage(post, { upload: hostMediaFn }); // hostMediaFn is on-box
// use withCover.json_metadata in the comment op → the signer broadcasts as usual (repo never signs)
```

`hostMediaFn` lives on the Witness host (media host / IPFS), not in this repo. The op still goes out
through MELEK-Signer with a scoped posting token; this repo holds no WIF and does no local signing.

**Image slots added to the gated draft:** `witness/hathor-tools-announcement.DRAFT.md` now carries a
COVER IMAGE SLOT block (derived prompt + reproduce command + a `![cover]` placeholder). It is the only
gated `*.DRAFT.md` in the repo today; `ensurePostImage()` covers every other/future post automatically
without per-draft edits.

---

## 2. Product-ad videos — `integrations/hathor-product-ad.mjs`

Reuses `integrations/hathor-video.mjs` `composeVideoPlan()` (the deterministic 4-beat director: arc,
scenes, captions, timings, music) and overlays product copy + Hathor-as-presenter visuals.

| fn | what it does |
|---|---|
| `listProducts()` / `getProduct(id)` | the ad catalog: MELEK, KulaSwap, PRANA, the People Tools, hathor.live/40hz, SoapBox, the Pool, MELEK Move — each with tagline, two benefits, CTA + URL, and a b-roll look. |
| `composeProductAd(id, opts)` | full renderable ad plan: hook/benefit/reveal/CTA scenes, captions, TTS voiceover lines, music. **Presenter beats (hook/reveal/call) put the VR-Hathor-Mehit figure on screen** (signature prepended); body beats show the product. |
| `renderSlideshowStills(id, opts, deps)` | the buildable-now render prep: renders **one GenAI still per scene** through the injected generator (default `genai-providers`). ffmpeg assembly is the on-box step. |
| `adScript(ad)` | a human-readable shotlist. |

### Two render paths — honest about compute

`composeProductAd(...).renderPaths` returns both, each flagged:

- **`slideshow` — BUILDABLE NOW, no GPU, cheap.** One GenAI still per scene (the image backend we
  already run) → Ken-Burns pan/zoom → burn captions → TTS voiceover → concat + music bed, all with
  **ffmpeg on a CPU box**. TTS = a local voice (piper/coqui) or a hosted TTS. This produces a real,
  postable vertical ad today with the infra we have.
- **`svd` — NEEDS A GPU / video model.** True per-frame motion via Stable Video Diffusion
  (`svd-img2video`, the existing `genai-comfyui-templates` workflow) on a woken RunPod GPU, **or** a
  hosted text/image-to-video service (Runway / Kling / Luma / Pika — already in `genai-directory`).
  Reuses `composeVideoPlan`'s render manifest verbatim.

**Honest bottom line:** real text-to-video needs a GPU or a paid/credited service. The
GenAI-stills + Ken-Burns + TTS slideshow is the cheap, buildable-now lane and is what to ship first;
upgrade individual ads to SVD/hosted video when a clip earns the compute.

### What generates the video

- **Stills:** `genai-providers` (keyless pollinations fallback) — free, now.
- **Motion (slideshow):** ffmpeg `zoompan` (Ken Burns) — free, now, CPU.
- **Voiceover:** TTS on the box (piper/coqui) or hosted — cheap, now.
- **Motion (rich):** SVD on GPU or a hosted video service — **not free, not now** without that compute.

### Wiring a finished clip

`renderSlideshowStills()` → stills on the box → ffmpeg assembles the mp4 → host it → then either:
- **hathor.live** (the `melek-hathor-live.service` "AI chat + video Studio") lists/plays it, or
- an **on-chain video post**: a `['comment', {...}]` with `json_metadata.video = <url>` +
  `tags:['video']` (the `engine/api/server.mjs` scottube convention) — built here, broadcast by
  MELEK-Signer. Repo builds the media; it never signs.

---

## Example ad scripts (generated by the scaffold)

Reproduce: `node integrations/hathor-product-ad.mjs melek --format=ad` /
`node integrations/hathor-product-ad.mjs kulaswap --format=short`

### MELEK — 20s vertical ad (3 scenes)

```
HOOK:  A blockchain that remembers what it is for.
CTA:   Join the chain → https://witness.melek.salon
MUSIC: driving, uplifting (120bpm)

[1] hook    6.7s · Hathor on-screen — "MELEK"
    VO: A blockchain that remembers what it is for.
[2] problem 6.7s · product b-roll — "✓ A witness you can talk to"
    VO: A witness you can talk to.
[3] call    6.7s · Hathor on-screen — "Join the chain →"
    VO: Join the chain.
```

### KulaSwap — 30s vertical short (5 scenes)

```
HOOK:  Swap the ecosystem tokens, straight from the pool.
CTA:   Swap now → https://kulaswap
MUSIC: driving, uplifting (120bpm)

[1] hook    6s · Hathor on-screen — "KulaSwap"
    VO: Swap the ecosystem tokens, straight from the pool.
[2] problem 6s · product b-roll — "✓ Live pool prices, no oracle guesswork"
    VO: Live pool prices, no oracle guesswork.
[3] reveal  6s · Hathor on-screen — "KulaSwap"
    VO: KulaSwap — swap the ecosystem tokens, straight from the pool.
[4] problem 6s · product b-roll — "✓ No custody — your keys, your coins"
    VO: No custody — your keys, your coins.
[5] call    6s · Hathor on-screen — "Swap now →"
    VO: Swap now.
```

*Copy is honest by construction — taglines/benefits come from the product catalog; edit the catalog
as products ship. No price/claim is fabricated (Charter rule 3).*

---

## Tests

- `witness/hathor-post-image.test.mjs` — 14 tests (prompt build, style match, attach/de-dupe,
  generate w/ + w/o upload, soft-fail, ensure skip/force). Offline, fake generator.
- `integrations/hathor-product-ad.test.mjs` — 11 tests (catalog, ad plan, presenter signature,
  benefit injection, contiguous captions, both render paths, stills render + soft-fail). Offline.

Run: `node --test witness/hathor-post-image.test.mjs integrations/hathor-product-ad.test.mjs`
