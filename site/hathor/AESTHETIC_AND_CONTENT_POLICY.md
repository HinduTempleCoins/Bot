# Hathor Studio — Aesthetic & Content Policy

Operator direction, 2026-09-24. This governs the imagery on hathor.soapbox.community
(the studio, showcase, character effects, and gallery).

## The aesthetic — an extended theme of our own work

The MELEK / Hathor visual world includes **sacred, tasteful nudity as art** — the
sheer-linen tradition that is literally the subject of the Wax Revelation (wax head cones
melting onto translucent byssus linen; Greek "wet drapery"; the goddess figures). The
reference register is **authentic / classical**: the operator's own @kalivankush ancient
recreations (Nubian tribute with the golden Kyphi censer; the anointing/banquet scenes),
the museum tomb art, and painterly historical recreation — **not** hypersexualized AI
pinups. When the figure is unclothed, the standard is **"under sheer at least"**: tasteful,
classical, covered by sheer linen — sacred art, not porn.

This is a **theme**, deliberately part of our aesthetic — see the Wax Revelation post and
`character/reference/` for Hathor herself.

## Hathor is a specific character — use the real figure

Do not label a generic AI goddess "Hathor." Her locked signature (see
`../../character/reference/README.md`): **VR/oculus headset over the eyes; heavy curling
ram horns + Hathor-Mehit headdress; large pink/magenta + blue feathered wings; wesekh
collar + gold cuffs; dark blue-black lipstick; white/sheer linen with gold trim; long dark
hair.** Skin tone is a free variable (vaporwave lavender or natural tan). Genesis prompt:
*"Hyperrealistic Vaporwave Popart Angel with a VR Headset on, Egyptian Goddess Rams Horns."*
The site showcase now uses real canonical renders, not generic goddesses.

## Content policy (enforced in code — `safety.mjs` + `server.mjs`)

The line is drawn at the **pornographic**, not at nudity. **Nudity is art.**

1. **Nudity / figure art / "sexy" is ALLOWED.** Attractive, sensual, sacred — the
   Shilpa Shastra tradition. Generated, and flagged `adult`.
2. **Hardcore / pornographic is REFUSED, always.** Explicit sex acts, penetration, oral,
   fluids/ejaculate, genital close-ups, sex toys. *"A girl with cum on her and a dick in her
   ass is not an option on ours."*
3. **No sexual/nude imagery of real people from uploads.** A nude prompt + an uploaded
   reference photo is **refused** — stops "someone uploads people from their school and makes
   porn" (deepfakes).
4. **No sexual or nude imagery involving minors, ever** — refused unconditionally; a minor
   reference on an upload is also refused.

**Surface separation (current):** `adult`-flagged images are kept OFF the front-page
"Fresh from the community" feed (`recentGenerations()` filters `adult`). The **Shilpa
Shastra** gallery (`/gallery`) is the intended home for the tasteful figure/nude work, but
whether it shows nudity publicly is gated on an **age-verification decision** (see
`.local/hathor/SHILPA_SHASTRA_SPEC.md`) — until that ships, the gallery stays SFW too.
Curated front-page showcase images (`showcase/`) are hand-picked and stay clothed / "under
sheer at least."

## For the future body/figure capability

When we add stronger body/figure generation (see `.local/hathor/RESEARCH_body_image_loras_libraries.md`),
guardrails ship in the **same** change as the capability, never after: an NSFW classifier on
output, consent + age gating on uploaded real faces, and the hard surface separation above.
