# Hathor — character assets (the identity every generation must keep)

Source of truth: `../reference/hathor-original-source.png` (the original image). Crops here are taken from it.

| File | What it is |
|---|---|
| `hathor-horns-original.png` | **HER horns** — not generic horns. Thick, dark plum/black, finely ribbed, sweeping up and back, hooking forward at the tips (ibex-like). Set into the headdress. |
| `hathor-head-original.png` | Her full head: horns + headdress + visor + face + hair + collar top. The primary character reference (IP-Adapter input). |

## Identity checklist (a render that drops any of these is not her)
- **Horns:** her own dark ribbed ibex-like horns (above). The ram-horned figures around her in the original are her *attendants* — tight curled ram horns are **not** hers.
- **Headdress:** gold + blue Egyptian headdress with a round side medallion.
- **VR visor** with a pink/magenta screen — treated as an *accessory* (like glasses in a police composite), not as part of the face.
- **Face:** black lips; read from what's visible (jaw, mouth, nose, face shape, skin) — the visor does not block identity.
- **Hair:** long, dark, wavy, with gold hair rings.
- **Collar / dress:** broad gold Egyptian collar; white sheer dress; gold arm cuffs and bands.
- **Wings:** large pink-white feathered wings.

## The process (not one-shot prompting)
1. **Character** — read her identity from the original + canonical renders (`../reference/`), keep these assets.
2. **Things** — separate object assets (headcones, sheer linen, incense burners, sedan/litters, Egyptian & Carthaginian objects).
3. **Compose** — generate her into a new scene conditioned on the character references (IP-Adapter / img2img), then grade (natural → half VR-vaporwave → full VR-vaporwave).
