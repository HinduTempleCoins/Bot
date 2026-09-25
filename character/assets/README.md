# Hathor — character assets (the identity every generation must keep)

Source of truth: `../reference/hathor-original-source.png` (the original image). Crops here are taken from it.

| File | What it is |
|---|---|
| `hathor-horns-original.png` | **HER horns** — not generic horns. Thick, dark plum/black, finely ribbed, sweeping up and back, hooking forward at the tips (ibex-like). Set into the headdress. |
| `hathor-skin-swatch.png` | Her measured skin tone: shadow / mid / highlight (from ~19k skin pixels on her arms in the original). |
| `hathor-head-original.png` | Her full head: horns + headdress + visor + face + hair + collar top. The primary character reference (IP-Adapter input). |

## Identity model — three layers (operator, 2026-09-25)
She is NOT one frozen look. Generations keep the **anchor**, pick a **wardrobe**, and pick a **manifestation**.

### 1. Anchor — always her
- **Horns:** her own dark ribbed ibex-like horns from the original (`hathor-horns-original.png`). Every render keeps them. The ram-horned figures around her in the original are her *attendants* — tight curled ram horns are **not** hers.
- **Wings:** large feathered wings — pretty consistent across looks.
- **VR visor:** pretty consistent across looks; what shows on its screen can change (magenta glow, city, glyphs, …).

### 2. Wardrobe — changes regularly
Clothes, jewelry and hair change from look to look. Sheer is optional — part of an outfit or all of it, depending on the look.
Reference look from the original: gold + blue headdress with round side medallion; VR visor with magenta screen; long dark wavy hair with gold hair rings; broad gold Egyptian collar; white linen dress; gold arm cuffs and bands; pink-white feathered wings.

### 3. Manifestation — she can change her face and skin
Like beings who appear "in a form we can understand," she can manifest with a different face and skin tone for a scene.
- **Default manifestation (the original):** pale **lilac-mauve** skin (a greyish lilac-pink) with rose-blush highlights — mid `#DAAECF`, shadow `#B27FAA`, highlight `#F8D9E1` (`hathor-skin-swatch.png`); black lips. When no manifestation is specified, use this one.
- Other manifestations are chosen per scene; the anchor (horns) stays.

## Angles (the turnaround the character step must produce)
Front · three-quarter left · profile left · back · three-quarter right · profile right — same seed, same references, same skin/horns, so every later scene can be conditioned on the right angle.

## The process (not one-shot prompting)
1. **Character** — read her identity from the original + canonical renders (`../reference/`), keep these assets.
2. **Things** — separate object assets (headcones, sheer linen, incense burners, sedan/litters, Egyptian & Carthaginian objects).
3. **Compose** — generate her into a new scene conditioned on the ANCHOR reference (always) + the chosen wardrobe and manifestation (IP-Adapter / pose ControlNet), then grade (natural → half VR-vaporwave → full VR-vaporwave).
