# Herb, gem and god posts: what the shareable formats look like (research before building)

Research date: 2026-10-18. Research only. Nothing in this file was rendered, published or posted.
Companion file: `TOPIC_RESEARCH.md` (the content: folk remedies, homeopathy, holistic, Eastern medicine,
enzymes, correspondences). Facts for the cards themselves: `facts.json` / `research.json` in this folder.

## How this was researched (what was actually looked at)

- **51 real Pinterest pins were opened.** For each one I took the page's `og:image`, `og:title`, size and
  source link with curl, downloaded the image, and **looked at every image** on contact sheets. The full list
  of URLs is in §11, and each pin is named by its short id (for example `chamomile1`) in the sections below.
  Pinterest only serves 736 px wide previews, so the sizes given are preview sizes and the aspect ratio is the
  useful number.
- **Public-domain reference plates were taken from Wikimedia Commons and viewed:** Köhler's Medizinal-Pflanzen
  plate 091 (chamomile), Splendor Solis (BL Harley 3469) ff. 10 and 33v, and the Rider-Waite-Smith Fool.
  **Four Herbal Tarot (Tierra/Cantin) sample cards were viewed** from aeclectic.net.
- **Platform specs** come from Pinterest's own product-specs page (fetched) and from Instagram size guides.
  The Instagram guides are third-party; Meta's own page was not fetched.
- **Fonts:** every font named here was checked against the live Google Fonts metadata API, and the licence
  file of each core font was checked in the `google/fonts` GitHub repo (HTTP 200).
- **Our 29 renders** on the render host (output folder `herbal-cards/out/`; host details are in `.local/`) were copied to the scratchpad and
  viewed on contact sheets and on a 64 px grid overlay (§10).
- **Art styles (27 of them)** were researched by a sub-agent and are summarised in Part B. Its source marks
  are kept: [F] = page opened, [S] = search result only.

---

# PART A: FORMATS

## 1. Platform canvases (the numbers)

| Use | Canvas | Ratio | Source / note |
|---|---|---|---|
| Pinterest standard pin | **1000 × 1500** | 2:3 | Pinterest's own spec: "We recommend using a 2:3 aspect ratio, or 1000 x 1500 pixels … Pins with an aspect ratio greater than 2:3 might get cut off in people's feeds." Title up to 100 characters, of which only the "first 40 characters may show". Descriptions are not shown in the home feed. PNG/JPEG, 20 MB. [F] https://help.pinterest.com/en/business/article/pinterest-product-specs |
| Pinterest long pin (charts) | 1000 × 2100 max | 1:2.1 | Third-party: the tallest ratio before the feed crops it. [S] https://postfa.st/sizes/pinterest/pin . Real long chart pins seen: `sabbat2` 736×1738, `herbsmag2` 736×1431 |
| Instagram feed portrait | **1080 × 1350** | 4:5 | The standard per every guide [S] (https://www.inro.social/blog/instagram-post-size , https://socialbu.com/blog/instagram-post-aspect-ratio). The profile grid now crops to 3:4 (1080×1440), so keep key content centred and clear of the side ~68 px. The real Herbal Academy IG recipe card (`sleeptea3`) is 512×640 = 4:5 |
| Instagram carousel | 1080 × 1350 per slide, up to 20 | 4:5 | Use it for "10 herbs for X" and for correspondence teaching sequences |
| Story / Reel / Idea pin | 1080 × 1920 | 9:16 | Keep text out of the top 250 px and bottom 340 px (platform UI) |
| Tarot card (physical) | 2.75 × 4.75 in = 825 × 1425 px at 300 dpi | 1:1.727 | The Herbal Tarot card size [F] https://learntarot.com/hbdesc.htm . For a post, set the card at 834×1440 centred on a 1000×1500 pin |

**Decision:** design every format **once at 1000 × 1500 (master)**, with a 4:5 **IG crop-safe zone** marked
inside it (the central 1000 × 1250, y = 125 to 1375), and re-flow the layout for IG rather than letterboxing it.
Our renders are 512 × 768, which is exactly 2:3, so a 2× upscale gives 1024 × 1536, which drops straight into
the master.

## 2. The recurring post types, as seen on real pins

For each type below: what I saw, the structure, the type, the palette, and what separates a strong post from
a weak one.

### 2.1 Single-herb "magical & medicinal properties" sheet. The hero format
- **Best example seen: `chamomile1`** (The Hour of Witchery, 736×1104, 2:3).
  - **Layout:** creator name in small script at the top. Herb title in big caps serif (CHAMOMILE). Latin name
    in parentheses (both *Matricaria chamomilla* and *Chamaemelum nobile*). The handle `@thehourofwitchery`
    is set directly under it as a watermark.
  - **Drawing:** a watercolour plant sits at the upper right, about 35% of the width.
  - **Blocks under small-caps headings:** CHARACTERISTICS (botanical family, parts used, edible, **pet safety**),
    CRYSTAL PAIRINGS, ASSOCIATIONS (element, planet, zodiac, gender, chakra, deities, flowers, herbal allies),
    MAGICAL PROPERTIES (10 bullets), HISTORY (a 9-line paragraph), and AFFIRMATION.
  - **Text volume:** about 250 words.
  - **Labelling:** the drawing is marked "(traditional uses)", which is a light folklore label.
  - **Typefaces:** a thin classical serif for display, a book serif for body text, and a script for the
    creator line.
  - **Palette:** white/cream ground, dark-brown ink, the plant's own colours.
- **Weak versions:**
  - `rosemary2`: a photo strip plus centred condensed caps and 9 vague uses ("helps with sleep and
    nightmares", "hair growth"). No Latin name, no caution, no source.
  - `rosemary3`: 562×290 landscape, purple script on blue. Unreadable in the feed, and the wrong ratio.
- **Strong versions have:** a Latin name; a real drawing; a scannable hierarchy of 5 to 7 headed blocks; one
  practical safety line (chamomile1 has pet safety); and a handle watermark.
  **Weak versions lack:** hierarchy, Latin name, cautions, and the right ratio.
- **Medicinal detail on witchy sheets is thin.** None of the witchy single-herb sheets I opened gave a dose. The
  herbalist-brand posts carry more method: Herbal Academy's `wildcherry` monograph is a 1897 herbarium-sheet
  drawing used as the cover, and the actual monograph is behind the link.
  **This is our gap to fill:** dose plus interaction, which nobody in the witchy space shows.

### 2.2 Herb grid / "N herbs for X" / big list
- **Examples:**
  - `terravara30`: a gradient title band, "30 WITCH HERBS & THEIR MAGICAL PROPERTIES", in heavy geometric
    sans, over a candle-and-crystal flat-lay photo, with the URL in a bottom band. It is a click-bait cover;
    the content is on the site.
  - `herbsmag2`: white bullets on black, about 30 herbs at 2 to 6 words each.
  - `herbsmagical`: a dotted-leader list ("Pennyroyal Herb ----- Peace at home"). Note: pennyroyal is
    hepatotoxic and is listed here with no caution.
  - `herbchart`: a 5×3 table of intentions (Success & Money, Healing, Protection …), each a column of herbs.
  - `kitchenwitch`: an Etsy "9 printable pages" mockup, a grid of small ink drawings each with 1 to 8 words.
  - `womb`: a numbered 1 to 4 list in a big bold sans, with black boho line-figures, cream ground, and the
    handle at the bottom right. Its claims ("raspberry leaf … strengthen the uterus and prepare it for
    childbirth") carry **no caution**.
- **Structure:**
  - Title band: 15 to 20% of the height.
  - A grid of 4, 6, 9 or 10 cells (2 columns × N rows on 2:3).
  - Each cell: drawing, name, and 1 to 3 keywords.
  - Footer: handle/URL.
  - Long lists go to 1:2 pins or carousels.
- **Strong vs weak:**
  - Strong: a grid with a small drawing per herb (kitchenwitch). Drawings make it save-worthy.
  - Weak: a wall of text, no images, and dangerous herbs listed with no caution (pennyroyal, raspberry leaf in
    pregnancy, "fennel … increase milk production").

### 2.3 Correspondence chart (planet / day / metal / herb / gem / deity)
- **Examples:**
  - `daysweek`: spells8.com. A parchment ground, a script title, "Days of the Week", and a table of Day
    (Planet) | Colour | Element | Intentions & Powers. A row of 7 planet glyphs, and a 4-line how-to-use
    footer.
  - `planetdays`: Atelier du Coeur, 2013. A coloured-row table of Day | Planetary Ruler | Colour | Essential
    Oils/Incense | Tinctures, with an honest footnote: "This is by no means a comprehensive table … there are
    many, many more … Research your own".
  - `corresp`: a mockup of two parchment pages, "Days of the Week" and "Tree Correspondence Chart".
  - `moonplanet`: Style24Designs on Etsy. A parchment "THE MOON" page that **mixes real astronomy** (crust
    60 km, core 750 km radius, mantle, composition O 60%, Si 16.5% …, distance 384,400 km, period 27.3 days)
    with the magic lists: Herbs, Minerals/Crystals, Day (Monday), Colour, Metal (Silver).
    **This is the closest existing analogue to our "science + tradition" approach.**
- **Structure:**
  - A title in script or Cinzel-like caps.
  - Rows = planets or days, columns = correspondences.
  - Planet glyph row.
  - Footer: how to use, plus a disclaimer.
- **Palette:** parchment with brown ink, or flat saturated row colours. Our palette (parchment, black ink,
  teal, terracotta) is the parchment family.
- **Strong vs weak:** strong ones carry glyphs, 4 to 6 columns at most, and a source or disclaimer line. Weak
  ones cram 10+ columns into small type (`sabbat1`, witchywords: unreadable at 390 px).
- **Sources disagree, and they say so.** `metals2` gives Mercury = **platinum** and Pluto = iron, which is a
  modern invention; the classical metal is quicksilver. `planetgems` gives Western crystals that differ from
  the Navaratna. Every chart needs a "tradition: X" tag. Ours follows the Navaratna plus the classical
  alchemical metals, per the pantheon picks v3.

### 2.4 Crystal guide
- **Examples:**
  - `hematite` and `rhodonite`: Moonlight Gems AZ, both 736×1104, 2:3, and identical templates.
    - A huge black condensed-sans title.
    - A **real cut-out photo of the stone**, centred, about 30% of the height.
    - "METAPHYSICAL PROPERTIES:" in pink letter-spaced caps, then a 2-column list of 6 one-word bullets.
    - A dashed rule.
    - "ASSOCIATIONS:" block: Chakra, Zodiac, Planet, Element.
    - An affirmation in large quote marks, then a logo and the shop name at the bottom.
    - About 40 words in total.
  - `chakra7`: a 7-column chakra × stone grid of photo cut-outs.
  - `planetgems`: a 3×3 grid of stone photos under a title band.
- **Structure:** title, stone, properties, associations, affirmation, brand.
- **What they lack:**
  - Any mineralogy. None gives the formula, Mohs hardness, or "safe in water?".
  - Any "tradition-only" label.
  - **Our facts.json has exactly these** (for example, lapis: "not for gem waters … releases hydrogen sulfide in
    acid"). Safety in water is the practical caution crystal people actually need: elixirs are popular and some
    stones are soluble, toxic or dyed.

### 2.5 Witch's-cabinet / apothecary label
- **Examples:**
  - `apothmed` (Etsy, "105 illustrated apothecary labels 3"×1.55""): tall labels with an engraved herb drawing
    and the herb name in a Victorian banner.
  - `apoth45`: blank ornate frames on coffee-stained parchment.
  - Graphics Fairy's DIY version [F] (https://thegraphicsfairy.com/diy-herb-apothecary-jars/): **three rows:
    common name / Latin name / date dried**. A script font "from an 1877 lettering book" and a lace frame "from
    an 1890 label catalog", coffee-stained.
- **Demand signal:** Pinterest's 2026 Hobbies Trend Report, "Kitchen Witch" section: "herbal apothecary" searches
  **up 595%** (report dated 25 Aug 2026, tied to *Practical Magic 2*). [F]
  https://newsroom.pinterest.com/news/2026-pinterest-hobbies-trend-report/
- **Structure:** a frame, the name, the Latin name, one info line. As a post: a sheet of 6 to 12 labels, or one
  label shown big over a jar mockup.
- **Our opening:** labels that carry **dose plus "do not combine with"** (see §6.5), not just the name.

### 2.6 Tarot-style card
- **Herbal Tarot** (Michael Tierra, art by Candis Cantin). I viewed 4 sample cards [F]
  https://www.aeclectic.net/tarot/cards/herbal/ : I The Magician (Astragalus), XII Suspended Person (Kelp),
  XX Judgment (Goldenseal), XXI The World (Comfrey).
  - **The herb name sits in script at the top, inside the image.**
  - The image is full-bleed inside a **thin coloured keyline frame** in a different colour per card, with a white
    outer border.
  - **A bottom title band** in a white box: Roman numeral plus title in a bold serif.
  - A tiny monogram sits in the bottom corner.
  - The herb is drawn whole, **roots included** (comfrey, goldenseal).
  - The layout is confirmed by learntarot: "The familiar name of the herb is written at the top of each card
    and the tarot name at the bottom", card 2.75×4.75 in. [F] https://learntarot.com/hbdesc.htm
- **Rider-Waite-Smith Fool** (Commons, PD) [F] https://commons.wikimedia.org/wiki/File:RWS_Tarot_00_Fool.jpg :
  - The numeral "0" is small in a top band.
  - A heavy black outline.
  - The bottom band has "THE FOOL." in spaced caps.
  - Flat colour.
- **Terra Botanical Tarot** (`terra`): a black-and-white ink deck with a plant ally per card, numeral plus title
  in a bottom band, and a black frame. It shows that pure line art works.
- **Tarot structure (what everyone uses):**
  - Outer border 3 to 4% of the width.
  - An inner keyline.
  - Numeral band at the top, OR the name in script inside the top of the image.
  - The image: 75 to 80% of the height.
  - Title band at the bottom: 8 to 10% of the height.
  - A keywords line is optional and is usually on the companion post, not on the card.

### 2.7 Splendor Solis / alchemical plate
Viewed: Harley 3469 ff. 10 and 33v (PD) [F]
https://commons.wikimedia.org/wiki/File:Harley_3469,_f.10.jpg ,
https://commons.wikimedia.org/wiki/File:Harley_3469,_f.33v.jpg
- **The frame:**
  - A wide **gold-ground border** (about 9 to 10% of the width each side), strewn with naturalistic flowers
    (iris, pansy, rose, cornflower), birds and insects. This is the Ghent-Bruges strewn border.
  - f.10 sets the picture under an **architectural round arch**, with a small cartouche at the top ("Particularia").
- **Labelling:** f.10 has a **red scroll caption with a Latin motto** under the picture ("Via Universalis
  particularibus inclusa").
- **Base:** f.10 has a grey grisaille **predella panel** under the picture with narrative scenes in miniature.
- **Image:** f.33v is a pure picture panel (the sun with a face rising over a dark city) in the floral border,
  with no text.
- **Structure for us:**
  - The floral border is OUR herbs: paint the herbs of that planet into the border. This is the
    "how they go together" carrier.
  - Arch-topped picture: the god or planet scene.
  - Motto scroll: one line.
  - Predella: a 3-panel strip of uses or a preparation sequence.

### 2.8 Moon-phase / sabbat wheel
- **Moon examples:**
  - `moonphases` (Etsy): a dark ornate frame on parchment and a vertical column of 9 moon discs, each with a
    blackletter-ish phase name, a caps keyword ("SET INTENTIONS") and a one-line gloss.
  - `moonmonthly`: a monthly moon worksheet (names, colours, element, deities, crystals, trees) with
    watercolour flowers.
- **Sabbat examples:**
  - `sabbat2` (via Tumblr, 736×1738): a long pin of 8 tiles, each with the sabbat name in a big serif, the
    subtitle and date in spaced caps, and Colours / Herbs / Stones lines in letter-spaced small type on
    brown-parchment tiles.
  - `wheelyear`: a full **ring chart**: 8 sabbat segments with seasonal colours, inner rings for zodiac, moons,
    directions and elements, and a yin-yang at the centre.
- **Wheel structure:** a centre emblem, then 3 to 5 concentric rings (from inside out: element, sign, herb,
  name), with labels set along the arc. This is the format to borrow for our **seven-planet wheel** (planet,
  metal, gem, herb, four god-faces).

### 2.9 Recipe / tea-blend card
- **Best example: `sleeptea3`** (Herbal Academy, Instagram origin, 4:5).
  - A sage-green ground with a **wreath border of ink-and-wash chamomile, lavender, rose and lemon balm** on
    all four sides.
  - Centred title: "Soothing" in script plus "SLEEP TEA" in a light serif in caps.
  - "INGREDIENTS" in small caps, then 4 lines **with roles in parentheses**: 1 cup chamomile (base herb), ½ cup
    lemon balm (supporting herb), ¼ cup rose (synergist), 1 Tbsp lavender (synergist).
  - A round brand seal at the bottom right.
  - About 30 words.
- **Weak example: `teacard`.** Cyan small-caps text on a photo of a mug, with no caution, although it contains
  raspberry leaf. The photo-plus-title-overlay pins (`sleeptea`, `lovetea`) are blog covers, not cards.
- **Structure:** border wreath of the actual ingredients, title, ingredients with parts and roles, method in
  1 to 2 lines, caution line, brand.
- **Our version adds:** the *why* (the active compound per herb, e.g. apigenin for GABA-A) and the caution
  ("additive with sedatives and alcohol"). Both are already in `diagram-sleep-tea` in facts.json.

### 2.10 Book of Shadows / grimoire / monograph page
- **Examples:**
  - `monotmpl` (RosedeMarie on Etsy): a blank monograph template with fields Botanical name / Common name(s) /
    Family / Native region / Geographic distribution / Growing conditions, and a drawing box at the top right.
  - Etsy herb journal listing 1035781141 [S]: blank fields for 7 correspondences plus medicinal and magical
    uses, in A4 and Letter. The page itself returned 403 to fetch.
  - `herbmanuscript`: a Penn Libraries medieval herbal leaf with a hand-lettered name over a stylised plant.
    It is a common "aesthetic" repost.
- **Structure:** a parchment page, a drawing box (often top right), fields as ruled lines, a handwritten-look
  font. Printables are sold at Letter/A4; posts show them as mockups.

### 2.11 Meme / quote / text post
- **Examples:**
  - `witchwoods`: the classic meme. A white caption band in plain sans ("*goes for a nature walk* / 5 mins
    later:") over a film still with a subtitle ("I be the witch of the wood." from *The Witch*, 2015).
  - `essoil`: script-title quote-card-style list on a pastel watercolour gradient.
- **For us:**
  - Use quote cards in OUR frame: one line in a big serif, the herb or deity drawing small, the handle.
  - Use emblem mottos in the Atalanta Fugiens style.
  - Don't fake screenshots. The art-style agent flags that fake Tumblr/Notes screenshots read as fabricated.

## 3. The text these posts carry, and how honest they are

**Fields seen, by frequency across the herb and crystal pins opened:**
- Name (all).
- Magical properties / intentions, as keyword bullets (all witchy ones).
- Associations: element, planet, zodiac, chakra (most).
- Latin name (about half; chamomile1, dandelion, Graphics Fairy labels).
- Deities (chamomile1, moonmonthly).
- Gender (chamomile1, rosemary3).
- Affirmation (chamomile1, hematite, rhodonite).
- History paragraph (chamomile1, moonplanet).
- Handle/URL watermark (almost all branded ones).
- **Rarely:** parts used, edibility, pet safety (chamomile1 only).
- **Never seen on a witchy pin:** dose, preparation strength, drug interactions, pregnancy caution, or a
  source citation.

**Folklore vs evidence labelling:**
- The best creator labels lightly, "(traditional uses)" (chamomile1).
- spells8 and Atelier du Coeur add "research your own" footers.
- Most mix magical keywords with medicinal claims in one bullet list with no distinction:
  - rosemary2: "aids in concentration … hair growth".
  - womb: uterine tonic claims.
- Crystal pins present metaphysics with no tradition label at all.

**What people expect:**
- On a pin: 30 to 250 words, scannable in 3 seconds, the detail in a caption or on the linked page.
- A herb sheet with about 8 to 12 lines of correspondences, plus 5 to 10 property bullets, is the norm.

**Our rule (follows from this):** every post carries **two visibly separate voices**.
- **"TRADITION"**: correspondences, planet, god, magical use. Set in the display/script face, with a
  small ☽ or ✶ marker.
- **"WHAT THE CHEMISTRY SAYS"**: compound, mechanism, dose, interaction. Set in the plain text face, with an
  evidence badge: `established` / `some evidence` / `tradition-only` (the facts.json `evidence` field already
  uses these).
- **Plus one caution line** on every herb, gem-elixir and recipe post.

This is our differentiator: the market is all tradition with no dose or interaction detail, and it labels
nothing. Harm-reduction detail (dose, interactions) is in scope per CLAUDE.md, so we print it, briefly, on the
face of the post.

## 4. "How they go together": teaching formats seen

| Format | Real example | What it does well | Use for |
|---|---|---|---|
| Row table (planets × fields) | `daysweek`, `planetdays` | Instantly scannable, 4–6 columns | 7 planets × (day, metal, gem, herb, god-faces) |
| Ring / wheel chart | `wheelyear`; Rosalee de la Forêt's *Taste of Herbs Flavor Wheel* (`energetics`: taste → energetics → herbs in concentric rings) | Shows cycles and nesting; very saveable | Seven-planet wheel; TCM five-phase wheel; Ayurveda 6-taste wheel |
| Planet-glyph diagram with axes | `guinard` (Patrice Guinard, planets in a cross layout with colours) | Pairs/opposites | Planet pairs (Sun–Moon, Venus–Mars …) |
| Metals with symbols | `metals`: 7 metals, each with 4–6 historical alchemical symbols and a one-line gloss | Teaches the glyph grammar | "Why ☿ is quicksilver" post |
| Chakra stack | `chakraplanet`, `chakra7` | Vertical body map | Body-map format → TCM organ clock / zodiac man version |
| Science + tradition page | `moonplanet` | Mixes measured facts with lore on one page | **Our template**: every planet/gem page gets a real-science strip |
| Splendor Solis border | Harley 3469 | Herbs in the border, myth in the centre | Planet plates: the planet's herbs and stone in the border, the god in the arch |

**The wheel spec for us** (it fits the facts.json `diagram-planet-wheel`):
- 1000 × 1500 pin. The wheel has a 920 px diameter, centred at (500, 640).
- Centre (r ≤ 120): the operator's chosen centre motif (Hathor/MELEK mark) or the Sun.
- **Ring 1** (r 120–220): 7 planet glyphs.
- **Ring 2** (r 220–300): day and metal.
- **Ring 3** (r 300–380): Navaratna gem, with a small stone drawing.
- **Ring 4** (r 380–460): Culpeper herbs, with tiny line drawings.
- **Below the wheel** (y 1120–1440): a 7-column strip of the four god-faces per planet, in district accent
  colours.
- Header y 0–100: "The Seven Planets", in Cinzel.

## 5. Tarot / Splendor Solis anatomy (measured from the viewed cards and plates)

| Element | Herbal Tarot | RWS | Splendor Solis | Our spec |
|---|---|---|---|---|
| Outer border | white, about 4% | white, about 3% | gold floral, 9–10% | parchment, 4% (tarot) or 9% floral (plate) |
| Inner frame | coloured keyline, 1–2% | black, heavy | arch / architectural | teal keyline 6 px plus a terracotta hairline 2 px |
| Numeral | in the bottom band, before the title | top band, small | none (cartouche) | top: Roman numeral in Cinzel, 48 px |
| Name | herb name in script, top inside the image | none | motto scroll under the image | herb name in Pinyon Script, inside the top of the image |
| Title band | bottom, white box, bold serif | bottom, spaced caps | grisaille predella | bottom band: tarot title in Cinzel caps |
| Keywords | none on the card | none | none | keep them OFF the card; put 3 keywords in the companion carousel slide / caption |

---

# PART B: ART STYLES

This part summarises the sub-agent research. The full text (about 6,000 words, 27 styles, each with URLs and a
Stable-Diffusion prompt fragment) is in the scratchpad draft and is reproduced in the appendix at the end of
this file.

## 6. Our four registers mapped onto each format

Registers (from `.local/research-casino/BOTANICA_ART_DIRECTION.md`):
- **R1 Art Nouveau**: the living world.
- **R2 Engraving with glows**: cutscenes.
- **R3 Vaporwave**: digital divine only (Hathor).
- **R4 Tarot / Splendor Solis**: myth, the past, the mystical.

All on one palette: parchment, black ink, teal, terracotta.

| Format | Our register | Common Pinterest style to also ship | Why |
|---|---|---|---|
| Single-herb sheet | **R1** (Mucha botanical poster) | Köhler herbarium plate; loose line-watercolour (chamomile1 is watercolour on white) | Herbs are the living world. The herbarium plate reads as "scientific", which suits our dose/chemistry voice |
| Herb grid / N herbs for X | R1 (small Nouveau roundels) | Ink line drawings on cream (kitchenwitch); boho line art | Small cells need clean line drawings, not full posters |
| Correspondence chart / planet wheel | **R4** (almanac/Splendor gold-and-ink) | Celestial navy-and-gold; parchment table (daysweek) | It is the old symbolic grammar, so it belongs to the past/mystical register |
| Crystal guide | R1 frame + **real stone photo or watercolour stone** | Watercolour crystal on white; Moonlight-Gems template | The stone has to look real. Mineralogy facts sit in the Nouveau frame |
| Apothecary label | R1 label layer (Victorian ornament is the same era) | Victorian apothecary/coffee-stained label | 1890s labels and Mucha are contemporaries |
| Tarot-style card | **R4** | RWS flat-colour card | It is the deck itself (playable tarot) |
| Splendor-Solis planet plate | **R4 canonical** | none (this is our own signature) | Myth and planetary metals |
| Moon / sabbat wheel | R4 | Celestial navy-and-gold; parchment tiles (sabbat2) | Cyclical and mystical |
| Recipe / tea card | R1 (ingredient wreath border) | Cottagecore wreath card (sleeptea3); flat-lay photo | Kitchen = home = R1 |
| Book of Shadows page | R4 (manuscript) | Dark academia grimoire | Memory and the past |
| God / deity card | R1 for living organic gods (Phoebe and the district patrons as Nouveau portraits); R4 for myth-telling posts; **R3 only for Hathor and the automation spirits** | Celestial (the Mercury pinterest render) | Per the locked art direction: no neon on organic gods |
| Enzyme / CYP450 "why it works" diagram | R2 (engraving with glow = the cutscene "reveal") or a clean diagram | Minimal infographic (flat icons) | The reveal moment; the glow marks the active molecule |
| Meme / quote | R4 emblem-motto card | Text-post / film-still meme | One line, big type |

**District overlays, used as accents on the same palette** (from the art-style research):
- Egyptian: register-band charts, tomb-painting palette, lapis and gold.
- Phoenician: ivory, Tyrian purple, glass.
- Babylonian: Ishtar-Gate lapis glaze on black, rosette bands. The "dark" version of R4.
- Hindu: Pichwai / Kalamkari bordered rows, saffron and marigold.

**Bridges** for the medicine systems:
- Unani: Persian/Mughal miniature with a hashiya border.
- TCM: Bencao Gangmu woodcut.
- Kampo: Honzō Zufu / ukiyo-e.

## 7. Fonts (all verified live on Google Fonts; licences checked)

Licences: OFL files confirmed in `github.com/google/fonts/main/ofl/<family>/OFL.txt` for Cinzel, Cormorant
Garamond, IM Fell English, Caveat, Pinyon Script, Tiro Devanagari Sanskrit, Federo and Marcellus. Special Elite
is Apache 2.0 (`apache/specialelite/LICENSE.txt`). All are free for commercial use.

| Role | R1 Art Nouveau | R4 Tarot / Splendor / almanac | Common Pinterest | Notes |
|---|---|---|---|---|
| Display title | **Federo** (Nouveau geometric) or **Marcellus SC** | **Cinzel** / **Cinzel Decorative** (roman caps, numerals) | **Playfair Display** / Abril Fatface; **League Spartan** / Montserrat ExtraBold (the hematite/terravara heavy-sans look) | Display only at ≥ 64 px |
| Latin name / subtitle | **Cormorant Garamond Italic** | **IM Fell English Italic** | Cormorant Garamond Italic | Latin is always italic |
| Body / lists | **Cormorant Garamond** 500 / **EB Garamond** | **IM Fell English** (old-print texture) | Lato / Josefin Sans | Body ≥ 30 px at 1000 wide (it is read on phones at about 1/3 scale) |
| Script accent (herb name, "Soothing") | **Pinyon Script** | **Pinyon Script** | Dancing Script / Sacramento / Caveat (handwritten-label look) | One script word or line per post, never body text |
| Typewriter / label | Special Elite / Courier Prime | Special Elite | Special Elite | The "lab note" and dose-line voice |
| Manuscript / blackletter | — | UnifrakturMaguntia / Grenze Gotisch / Texturina (titles only); Uncial Antiqua | MedievalSharp | Babylon-night and grimoire titles only |
| Vaporwave (Hathor only) | — | — | Orbitron / Audiowide / VT323 / Monoton | R3 fence |
| Glyphs | Noto Sans Symbols (☉☽☿♀♂♃♄) | same | same | Planet glyphs as text, not drawn |
| District scripts (multilingual caption) | **Noto Sans Egyptian Hieroglyphs**, **Noto Sans Phoenician**, **Noto Sans Cuneiform**, **Tiro Devanagari Sanskrit** (or Noto Serif Devanagari); bridges: **Amiri** (Arabic/Unani), **Noto Serif SC** (TCM), **Shippori Mincho** (Kampo) | | | Blackwell-style name in several languages, per the art-style research |

**Text limits that come out of the examples:**
- Title ≤ 18 characters per line, at 2 lines maximum.
- Bullets ≤ 32 characters.
- ≤ 10 bullets in total.
- Total words: about 120 to 250 for a sheet, about 30 to 60 for a card or crystal guide.
- The Pinterest pin *title* field (not on the image) ≤ 40 characters visible.

## 8. Layout specs per format (pixels on a 1000 × 1500 master unless stated)

Common to all:
- **Safe margin 60 px.**
- Handle/watermark band at the bottom: y 1440–1490, in Cormorant SC 24 px, centred (e.g. `hathor.live · MELEK`;
  the operator chooses the exact handle).
- The **evidence badge** is a pill, 160×40, top right of the medicinal block. Its colours:
  - teal = established
  - terracotta = some evidence
  - ink outline = tradition-only
- IG 4:5 re-flow: keep everything in y 125–1375, or re-layout at 1080×1350 with the same proportions.
- Our 512×768 renders are upscaled 2× to 1024×1536 and cropped to the drawing box. **Mask their pseudo-text**
  (see §10): it sits in the top ~11% and the bottom ~16% of each render.

### 8.1 Single-herb sheet ("The Herb Card"), R1, 1000 × 1500
| Region | Box (x, y, w, h) | Content | Font / size | Limit |
|---|---|---|---|---|
| Title band | 60, 50, 880, 150 | Common name | Federo 96 px, caps | ≤ 14 characters |
| Latin line | 60, 200, 880, 50 | Latin binomial (+ family) | Cormorant Garamond Italic 36 | ≤ 45 characters |
| Drawing box | 60, 270, 520, 780 (2:3) | upscaled render, cropped to the clean window | — | — |
| Tradition column | 610, 270, 330, 780 | ☽ TRADITION: planet, element/dosha, god-faces, gem pairing, 4 magical keywords | Cinzel 26 headings / Cormorant 28 | ≤ 10 lines |
| Chemistry block | 60, 1070, 880, 250 | WHAT THE CHEMISTRY SAYS: 3 uses, key compound, mechanism (1 line), dose (1 line) + evidence badge | Cormorant 30 / Special Elite 26 for dose | ≤ 6 lines |
| Caution bar | 60, 1330, 880, 90 | ⚠ interactions + who should avoid | Cormorant Bold 28 on terracotta 15% tint | ≤ 2 lines |
| Watermark | 60, 1440, 880, 50 | handle · source tag ("NCCIH · EMA · Culpeper") | Cormorant SC 22 | — |

**Filled example: Chamomile** (from facts.json `chamomile` + the planets table):
- **Title:** CHAMOMILE.
- **Latin:** *Matricaria chamomilla* · Asteraceae.
- **Tradition:**
  - ☉ Sun. Culpeper's entry: "the Egyptians dedicated it to the Sun".
  - Faces: Ra · Shamash · Shapash · Surya.
  - Gem: ruby (Sun, Navaratna).
  - Ayurveda: cooling, calms Pitta/Vata.
  - Unani: *babuna*, hot and dry in the 1st degree.
  - Keywords: calm · sleep · soothing · sun-herb.
- **Chemistry:** apigenin weakly binds the GABA-A benzodiazepine site; bisabolol and chamazulene are
  anti-inflammatory. Uses: mild anxiety, indigestion/colic, mouth/skin rinse. Dose: tea 2–4 g flower heads in
  150 mL, covered 5–10 min, 3–4×/day; extract 500 mg 1–3×/day. Badge: **some evidence**.
- **Caution:** ragweed/daisy allergy; additive with sedatives and alcohol; warfarin and CYP3A4 drugs: monitor.

> **Correction found while filling this in:** the facts.json herb entry says chamomile is "Moon (Culpeper,
> 'Camomile... under the dominion of the Moon')". I checked Culpeper's text on Gutenberg #49513. His CAMOMILE
> entry has **no "Government" line**. The "dominion of the Moon" line belongs to the next entry,
> WATER-CALTROPS. His only planetary note on camomile is "Nechessor saith, the Egyptians dedicated it to the
> Sun". So the planets table (chamomile under the Sun) is right and the herb entry's Moon attribution is wrong.
> It should be fixed before any card prints it. (The lavender quote "under the government of Mercury" does
> appear in the text.)

### 8.2 Crystal guide ("The Stone Card"), R1 frame, 1000 × 1500
| Region | Box | Content | Font |
|---|---|---|---|
| Title | 60, 50, 880, 140 | Stone name | Federo 100 caps (or League Spartan 110 for the common Pinterest version) |
| Stone art | 250, 200, 500, 420 | Watercolour or photo stone, centred | — |
| Mineral line | 60, 640, 880, 90 | formula / group · Mohs · origin | Cormorant Italic 30, 2 lines |
| Tradition | 60, 750, 880, 300 | ☽ TRADITION: 2-column keywords (6) + Planet / Culture / God lines | Cinzel 28 heading, Cormorant 30 |
| History | 60, 1060, 880, 200 | 3-line story | Cormorant 28 |
| Water-safety bar | 60, 1280, 880, 130 | ✓ / ✗ safe in water, safe to handle, dyed/fake warning | Cormorant Bold 28 on tint |
| Watermark | 60, 1440, 880, 50 | | |

**Filled example: Lapis Lazuli**
- **Mineral line:** "A rock: lazurite + calcite + pyrite · Mohs 5–5.5 · Sar-i Sang, Badakhshan."
- **Tradition:**
  - Inanna/Ishtar's lapis rod and line (Inanna's Descent).
  - Egypt: the gods' hair of lapis; Tutankhamun's mask.
  - Modern: throat and third-eye chakras.
  - Label: *tradition-only*.
- **History:** traded 2,500+ km to the Royal Tombs of Ur, c. 2600 BCE; ground into ultramarine.
- **Water bar:** "✗ NOT for gem water: calcite dissolves in acid, pyrite oxidises, lazurite releases H₂S. Often
  dyed; colour can rub off."

### 8.3 God / planet plate (Splendor Solis), R4, 1000 × 1500
| Region | Box | Content |
|---|---|---|
| Floral border | outer 90 px each side (gold ground, teal/terracotta tints) | The planet's herbs and gem painted in the border (for Mercury: fennel, lavender, dill, valerian + emerald) |
| Cartouche | 350, 20, 300, 70 | Planet glyph ☿ + "MERCURIUS" in Cinzel 40 |
| Arch picture | 90, 90, 820, 1010 (round-arched top) | The god scene: our render goes here |
| Motto scroll | 140, 1110, 720, 80 | One line, Cinzel Decorative 30 in red ink, e.g. "Wednesday · Quicksilver · Emerald" |
| Predella | 90, 1200, 820, 220 | Four panels, 205 px each: the four god-faces, each with its name in its own script |
| Watermark | inside the bottom border | |

**Filled example: Mercury**
- **Arch:** green-skinned Budha on his lion (render `planet-mercury__ours`).
- **Motto:** WEDNESDAY · QUICKSILVER · EMERALD.
- **Predella:**
  - **Nabu** (Babylon). The cuneiform spelling still needs checking by someone who reads cuneiform before
    print; don't guess the signs.
  - **Thoth** (Egypt).
  - **Taautos** (Phoenicia).
  - **Budha** (Hindu): बुध in Tiro Devanagari.
- **Border herbs:** Culpeper's Mercury herbs. All four were checked in the Gutenberg text:
  - Lavender: "Mercury owns the herb".
  - Dill: "Mercury has the dominion of this plant".
  - Fennel: "an herb of Mercury, and under Virgo".
  - Garden Valerian: "under the influence of Mercury".
- **Caption tag:** "tradition (correspondence system)".

### 8.4 Tarot card, R4, card 834 × 1440 centred on a 1000 × 1500 pin (83 px side, 30 px top/bottom background)
Card-local coordinates:
| Region | Box | Content | Font |
|---|---|---|---|
| Outer border | 34 px parchment | | |
| Keyline | 6 px teal + 2 px terracotta hairline, inset 34 px | | |
| Numeral band | 42, 42, 750, 80 | Roman numeral | Cinzel 52 |
| Image | 42, 122, 750, 1110 | Render (2:3 crop fits 740×1110) | herb name in Pinyon Script 64 inside the top of the image (Herbal Tarot convention) |
| Title band | 42, 1240, 750, 150 | "THE MAGICIAN" | Cinzel 56 caps, spaced |
| Corner mark | 760, 1360 | ☿ glyph 32 px | Noto Sans Symbols |

**Filled example:** I · THE MAGICIAN, with Astragalus as the herb name (the Herbal Tarot's own pairing, Tierra
list). For our deck, take the herb from facts.json `astragalus`. The background of the pin stays parchment (R4)
or Babylon-night lapis-on-black for the dark variants.

### 8.5 Apothecary label sheet, R1 label layer, 1000 × 1500 (2 × 3 labels, 420 × 420 each)
- **Per-label rows:**
  - Common name (Federo 40).
  - Latin name (Cormorant Italic 26).
  - Ruler glyph + element.
  - **Dose line** (Special Elite 22).
  - **"Do not combine:"** line (Special Elite 22, terracotta).
  - Filled-on date line.
- **Filled example (Valerian):**
  - Name: VALERIAN · *Valeriana officinalis*.
  - Ruler: ☿ (Culpeper: "under the influence of Mercury").
  - Dose: "300–600 mg extract or 2–3 g root as tea, 30 min–2 h before bed".
  - "Do not combine: alcohol, benzos, opioids, sleep meds · not under 12".

### 8.6 Herb grid "6 herbs for sleep", R1, 1000 × 1500 (or a 10-slide IG carousel)
- Title band 60–230: "6 Herbs for Sleep" in Federo 84, with a Pinyon script subtitle.
- **Grid:** 2 × 3 cells of 430 × 370 at x 60/510, y 250/630/1010.
  - Each cell: a 200 px roundel drawing at the top.
  - Then the name (Cinzel 32) and 1 line of compound/effect (Cormorant 24).
  - Then the evidence badge.
- Bottom bar 1390–1430: "All are additive with alcohol and sedatives."
- **Herbs from facts.json:** chamomile, lavender, valerian, plus lemon balm, passionflower and hops (the extension
  candidates in TOPIC_RESEARCH; NCCIH passionflower sheet: https://www.nccih.nih.gov/health/passionflower).

### 8.7 Seven-planet wheel (teaching format), R4: see §4 for the ring radii.

### 8.8 Recipe / tea card, R1, 1080 × 1350 (IG-native, after sleeptea3)
- **Border:** an ingredient wreath, 110 px all round.
- **Title:** Pinyon Script 70 "Soothing", plus Cinzel 64 "SLEEP TEA", at y 170–360.
- **"INGREDIENTS"** in Cinzel 28 spaced, then 4 lines in Cormorant 34: amount, herb, and (role · active
  compound).
- **Method:** 2 lines.
- **Caution bar** at y 1150–1220: "Additive with sedatives & alcohol; ragweed allergy → skip chamomile."
- **Seal** at the bottom right.
- Content from facts.json `diagram-sleep-tea`.

### 8.9 Correspondence table, R4, 1000 × 1500
- **Header:** 60–190.
- **Table:** 7 rows × 110 px at y 220–990.
  - Columns: glyph 80, planet/day 170, metal 130, gem 140, herbs 230, faces 130 (a list link to the plate).
  - Fonts: Cinzel 28 header, Cormorant 26 cells.
- **Science strip** at y 1010–1300: one real fact per planet, the moonplanet trick.
- **Disclaimer** at y 1320–1400: "Correspondences differ between traditions: this table follows the classical
  metals and the Navaratna gems."

### 8.10 Quote / emblem card, R4, 1080 × 1350
- Emblem roundel 500 px at the top centre.
- Motto in Cinzel Decorative 52, 2–3 lines.
- Gloss in Cormorant Italic 30, 2 lines.
- The handle.

## 9. Formats to make, in priority order (by evidence of demand and gap)
1. **Single-herb sheet (8.1)**: the dominant saveable format. Our dose/interaction block is a real
   differentiator.
2. **Crystal guide (8.2)**: very formulaic market; our mineralogy plus water-safety line is unique.
3. **Apothecary label sheet (8.5)**: "herbal apothecary" +595% on Pinterest (2026).
4. **Planet plate (8.3) + seven-planet wheel (8.7) + correspondence table (8.9)**: the "how it goes together"
   set and our visual signature.
5. **Recipe card (8.8)**, **herb grid (8.6)**, **tarot (8.4)**, **quote (8.10)**.

## 10. Reuse verdict on the 29 existing renders (render host `herbal-cards/out/`, all 512 × 768)

All 29 were copied to the scratchpad and viewed. **Every render contains pseudo-text** (garbled "titles" and
"captions"):
- in the top band, about y 0–85 of 768;
- in the bottom panel, about y 640–768;
- the Mercury render also has a fake glyph at y 30–130.

So **every one must be cropped to its clean window (about y 85–640) or masked by our type bands.** The 8.1
layout already places the title band and the chemistry block over those zones when the render is used
full-height in a frame, but **cropping is safer**.

**Is the plant correct?** I checked each one against what the plant actually looks like. For chamomile I
compared against the Köhler plate 091 I viewed.

| Render | Style | Botanically right? | Verdict | Best format |
|---|---|---|---|---|
| herb-echinacea__ours | Nouveau botanical | **Yes**: purple coneflower, correct | **USE** | 8.1 drawing box, tarot image |
| herb-echinacea__pinterest | line-watercolour | **Yes** | **USE** | common-style herb sheet, grid roundel |
| herb-lavender__ours | Nouveau botanical | **Yes** | **USE** | 8.1, grid roundel (sleep) |
| herb-lavender__pinterest | herbarium plate | **Yes** | **USE** | herbarium-style sheet, label |
| herb-feverfew__ours | Nouveau botanical | Plausible (small daisies, divided leaves) | USE | 8.1 |
| herb-feverfew__pinterest | line-watercolour | Plausible | USE (minor) | grid |
| herb-peppermint__ours | Nouveau botanical | Plausible mint leaves; side ornaments | USE | 8.1 |
| herb-peppermint__pinterest | herbarium plate | Plausible (toothed opposite leaves) | USE | herbarium sheet |
| herb-garlic__ours | Nouveau botanical | Reads as allium buds/heads | USE (stylised) | 8.1, label |
| herb-chamomile__ours | Nouveau botanical | Flowers right, **leaves wrong** (grass-like; real chamomile is finely feathery, per Köhler 091) | USE WITH CAUTION (flower crop only) | tarot/roundel crop of the flowers |
| herb-elderberry__ours | Nouveau botanical | White umbels OK, habit stylised | USE (decorative) | Splendor border element, grid |
| herb-mercury (planet-mercury__ours) | Art Nouveau | Green Budha on a lion: right iconography for Budha. Fake glyph at the top | **USE** (crop y 130–640) | 8.3 arch picture, god card |
| planet-mercury__pinterest | celestial | Winged green god on a lion, navy/gold, fake medallion | USE (common-style celestial) | celestial god card |
| herb-honey__pinterest | line-watercolour | Honey jar + sunflowers; **garbled label in the centre** | USE only if the label is masked with our own label | recipe card |
| herb-turmeric__ours | Nouveau botanical | Frame lovely; the plant is generic (no rhizome) | FRAME ONLY | reuse the border as a frame |
| herb-turmeric__pinterest | line-watercolour | Broad lanceolate leaves: plausible leaf, no rhizome | WEAK | grid at most |
| herb-garlic__pinterest | herbarium | Generic buds | WEAK | — |
| herb-elderberry__pinterest | herbarium | Leaves wrong (not pinnate) | REJECT | — |
| herb-chamomile__pinterest | herbarium | **Wrong**: yellow toothed-leaf plant (arnica-like) | REJECT | — |
| herb-cranberry__ours | Nouveau | **Wrong**: upright sprig with pink flowers; cranberry is a low trailing vine with red berries | REJECT | — |
| herb-ginger__ours | Nouveau | Ornamental leaf, not ginger | REJECT (frame idea only) | — |
| herb-ginger__pinterest | line-watercolour | Orange spiky plant: **wrong** | REJECT | — |
| herb-honey__ours | Nouveau | Orange flowers in a pot: wrong subject | REJECT | — |
| herb-st-johns-wort__ours | Nouveau | Generic leaves, no yellow 5-petal flowers | REJECT | — |
| herb-st-johns-wort__pinterest | line-watercolour | Generic | REJECT | — |
| herb-valerian__ours | Nouveau | Generic lanceolate leaves (valerian has pinnate leaves + pink-white umbels) | REJECT (frame usable) | — |
| herb-valerian__pinterest | line-watercolour | Generic | REJECT | — |
| herb-willow-bark__ours | Nouveau | Plume/grass, not willow | REJECT (frame usable) | — |
| herb-willow-bark__pinterest | herbarium | Fern-like, not willow | REJECT | — |

**Count:**
- **13 usable**: 4 strong (echinacea ×2, lavender ×2) and 9 usable with crops or stylisation.
- **2 frame-only** (turmeric ours, plus the valerian/willow frames).
- **14 rejected** for wrong botany.

Herbarium-style accuracy problems match the general Stable Diffusion weakness on specific species. For the
herb sheets, **public-domain Köhler plates (Commons, PD) are the accurate fallback**: plate 091 is chamomile.
Use them in the herbarium style, and keep our renders for the decorative and Nouveau registers.

## 11. Sources (all opened unless marked [S])

**Pinterest pins (image + metadata downloaded and viewed; the creator source is in brackets):**
- herbchart https://www.pinterest.com/pin/herb-use-chart-magical-and-herbal-witchcraft--68746869796/
- hematite https://in.pinterest.com/pin/hematite-crystal-properties-meaning-chakra-zodiac-planet-element--578360777193102251/ (moonlightgemsaz.com)
- rhodonite https://www.pinterest.com/pin/rhodonite-crystal-properties-meaning-chakra-zodiac-planet-element-in-2024--767160117807152446/
- kitchenwitch https://www.pinterest.com/pin/herbs-spices-magical-uses-kitchen-witchery-green-witch--798263102711211003/ (etsy 915917705)
- terravara30 https://www.pinterest.com/pin/30-witch-herbs-their-magical-properties-in-2022--995154848882543127/
- chakra7 https://uk.pinterest.com/pin/crystals-and-stones-for-7-chakras-free-printable-reference-charts-and-posters-video-in-2023--1015632153453028741/
- herbsmagical https://www.pinterest.com/pin/herbs-and-their-magical-properties--3307399718537644/
- essoil https://www.pinterest.com/pin/essential-oil-magical-properties-chart-and-magical-uses--654781233352818515/
- chamomile1 https://es.pinterest.com/pin/280208408062556249/ (thehourofwitchery.com)
- rosemary8 https://in.pinterest.com/pin/rosemary-magical-properties-8-ways-to-use-it-in-witchcraft--310255861839666992/ (otherworldlyoracle.com)
- rosemary2 https://fi.pinterest.com/pin/141793088262067919/
- herbsmag2 https://se.pinterest.com/pin/10273905395601110/
- rosemary3 https://www.pinterest.com/pin/370702613050761554/
- sleeptea https://dk.pinterest.com/pin/686376799494533922/ (feathersinthewoods.com)
- moonmonthly https://www.pinterest.com/pin/witch-monthly-moon-charts-of-magic-correspondences--1098737640315431610/ (journalswithdragons.com)
- moonphases https://in.pinterest.com/pin/544020830007161567/
- moonplanet https://www.pinterest.com/pin/planetary-magickal-correspondences-witchcraft-printable-etsy--732820170610670159/ (etsy 700727975, Style24Designs)
- planetdays https://www.pinterest.com/pin/575827502339643393/ (atelierducoeurenergy.wordpress.com)
- daysweek https://ar.pinterest.com/pin/683562049723446255/ (spells8.com)
- corresp https://nz.pinterest.com/pin/magickal-correspondences-useful-printable-charts-tables-pdf-in-2023--600597300330276820/
- terra https://www.pinterest.com/pin/terra-botanical-tarot-deck-plant-ally-deck-78-cards-hand--446349013077984945/ (etsy 833646084)
- sabbat1 https://www.pinterest.com/pin/348114246169043386/ (witchywords.blogspot.com)
- sabbat2 https://es.pinterest.com/pin/608197124688342977/ (pentaclesandstuff.tumblr.com)
- wheelyear https://www.pinterest.com/pin/here-is-a-great-chart-of-the-wheel-of-the-year-it-includes-the-8-sabbats-the-solstices-and-equinox-the-astrologica--309552174362520676/
- apoth45 https://www.pinterest.com/pin/45-wicca-vintage-apothecary-labels-kitchen-witch-printable--869968852992253656/
- apothmed https://www.pinterest.com/pin/vintage-apothecary-witchcraft-labels-printable-medicinal-herbs-spice-botanical-jars-labels-witch-kitchen-wicca-digital-download-etsy--6333255721982668/
- witchwoods https://www.pinterest.com/pin/i-be-the-witch-of-the-woods--736408976596834819/
- energetics https://cl.pinterest.com/pin/102738435243801558/ (Rosalee de la Forêt, Taste of Herbs flavor wheel)
- actions https://www.pinterest.com/pin/539657967842881747/
- metals https://kr.pinterest.com/pin/430797520624619003/
- metals2 https://in.pinterest.com/pin/590323463643026019/
- guinard https://ar.pinterest.com/pin/64809682127718624/ (cura.free.fr)
- chakraplanet https://ca.pinterest.com/pin/68735986867/
- planetcharts https://www.pinterest.com/pin/311874342916831676/
- planetgems https://www.pinterest.com/pin/planetary-gemstones-and-crystals--990580880515127996/
- lovetea https://www.pinterest.com/pin/279363983115609648/
- immunetea https://www.pinterest.com/pin/477592735469626920/
- teablend https://www.pinterest.com/pin/make-your-own-herbal-tea-blends--559150109994695846/
- wildcherry https://www.pinterest.com/pin/149604018852480317/ (theherbalacademy.com)
- monotmpl https://uk.pinterest.com/pin/herbal-monograph-template--879539002205724444/
- herbmanuscript https://www.pinterest.com/pin/herbal-manuscript-a-visual-guide-to-medicinal-plants--891220213736133637/ (Penn Libraries)
- womb https://se.pinterest.com/pin/11540542793235319/
- dandelion https://mx.pinterest.com/pin/387380005456761319/
- sleeptea3 https://www.pinterest.com/pin/soothing-sleep-tea-recipe-with-chamomile-and-lavender--46724914875102192/ (Herbal Academy, Instagram)
- teacard https://www.pinterest.com/pin/272256739959078944/
- calpreg https://www.pinterest.com/pin/calendula-during-pregnancy-uses-and-safety--327636941641923568/

**Reference plates and cards:**
- Köhler plate 091 https://commons.wikimedia.org/wiki/File:Matricaria_recutita_-_K%C3%B6hler%E2%80%93s_Medizinal-Pflanzen-091.jpg (PD)
- Splendor Solis f.10 https://commons.wikimedia.org/wiki/File:Harley_3469,_f.10.jpg ; f.33v https://commons.wikimedia.org/wiki/File:Harley_3469,_f.33v.jpg (PD)
- RWS Fool https://commons.wikimedia.org/wiki/File:RWS_Tarot_00_Fool.jpg (PD)
- Herbal Tarot https://www.aeclectic.net/tarot/cards/herbal/ and https://learntarot.com/hbdesc.htm

**Specs and trends:**
- https://help.pinterest.com/en/business/article/pinterest-product-specs
- https://newsroom.pinterest.com/news/2026-pinterest-hobbies-trend-report/
- [S] https://postfa.st/sizes/pinterest/pin , https://www.inro.social/blog/instagram-post-size , https://socialbu.com/blog/instagram-post-aspect-ratio
- Graphics Fairy labels https://thegraphicsfairy.com/diy-herb-apothecary-jars/
- Culpeper text check: https://www.gutenberg.org/cache/epub/49513/pg49513.txt (CAMOMILE and WATER-CALTROPS entries; Lavender "under the government of Mercury")
- Fonts: https://fonts.google.com/metadata/fonts (live check) ; licences under https://github.com/google/fonts

---

# APPENDIX: Art-style survey (sub-agent research, verbatim)

# Art styles for herb / gemstone / god correspondence posts (Pinterest + Instagram)

Research only, 2026-10-18. Mapped against the locked Botanica art direction
(`.local/research-casino/BOTANICA_ART_DIRECTION.md`) and the four districts in `.local/BOTANICA_PANTHEON_PICKS.md`.

**Our system, restated:** one palette (parchment cream/beige/warm brown, black ink, teal/cyan, autumn
terracotta). Four registers: **R1 Art Nouveau** = the living organic world. **R2 Alchemical engraving with glows** =
story and cutscene moments. **R3 Vaporwave** = digital divine only (Hathor and the automation spirits). **R4 Tarot / Splendor Solis**
= myth, the deep past, the mystical. Four districts: **Egyptian** (Black Land: Nile green, gold, lapis), **Phoenician**
(Harbor: Tyrian purple, sea blue, cedar, bronze), **Babylonian** (dark occult-noir: Ishtar blue glaze over black, gold),
**Hindu** (Sacred Grounds: saffron, marigold, temple stone, peacock teal).

**How sources are marked:** **[F]** = I fetched the page and read it. **[S]** = the URL came from search results and I did not
open it. Some fetches failed (BHL 403, Met 429, Fanlore 403, a Public Domain Review 404). Those pages are marked [S] or left out.
Visual details I describe from general art-historical knowledge, and that no fetched source confirmed, are flagged "(general knowledge)".

**Public-domain note:** works made before about 1900 are public domain as works. Rights in particular *photographs*
of them vary. The Met's Open Access images and Wellcome's PDM/CC-BY images are safe. Check each Wellcome record, because
the 1497 zodiac-man record (M0017909) is marked in copyright. Use originals to study style. For posts, generate new art
or use images marked open access.

---

## A. Botanical and herbal plate traditions

### 1. Köhler's Medizinal-Pflanzen (chromolithograph medical plates, 1887–1898)
- **Looks like:** one plant fills a tall portrait plate. Stem, leaves and flower appear life-size or close to it, with numbered dissection details
  (flower section, seed, fruit cross-section) scattered in the white space around the habit. Colours are clear, flat-but-modelled
  chromolithograph. The ground is white or cream with no border, only a plate number and a Latin binomial in small serif at the foot.
  All plates are chromolithographs. Vol. 1 has 84 plates, vol. 2 has 110, and the supplement (1898) adds 80. Artists were W. O. Müller, C. F. Schmidt and K. Gunther. [F]
- **Suits:** a single-herb sheet ("Yarrow: Achillea millefolium"). It also suits a pharmacology/dose sheet with numbered callouts
  that turn the dissection numbers into labels for active parts, and the hero image of a carousel.
- **Public-domain originals:** yes, all of them. They are on BHL (bibliography 623) and Wikimedia Commons, cleaned and plate by plate.
- **References:** https://en.wikipedia.org/wiki/K%C3%B6hler%27s_Medicinal_Plants [F];
  https://www.biodiversitylibrary.org/bibliography/623 [S, 403 on fetch];
  Commons yarrow plate 70: https://species-id.net/openmedia/File:Achillea_millefolium_(K%C3%B6hler%E2%80%99s_Medizinal-Pflanzen_Bd.1_1887,_BHL-303704,_Tafel_70)_clean.png [S]
- **Our register:** **R1-adjacent**. It is the scientific base layer of the living world. Put it on parchment instead of white and add a thin
  Nouveau whiplash frame, and it becomes R1.
- **Best topic/district:** Western / European herbalism and pharmacology (no district). It is also the neutral "lab shelf" look for the
  harm-reduction library.
- **Prompt fragment:** `antique chromolithograph botanical plate, Köhler's Medizinal-Pflanzen style, scientific illustration, numbered dissection details, life-size plant habit, cream paper, fine stipple, muted naturalistic colour, Latin caption`

### 2. Curtis's Botanical Magazine (hand-coloured engraving, from 1787)
- **Looks like:** an octavo plate, so it is smaller and more intimate than Köhler. A single flowering stem sits elegantly off-centre. The copper-engraved line is
  hand-coloured in watercolour, and there are "exploded" part details. A plate number sits top right. Walter Hood Fitch's era (1827–77) is the
  peak, with bold, confident line and lush colour. In the early volumes up to 30 people coloured the plates by hand. [F]
- **Suits:** single-flower sheets (rose, lotus, poppy, iris), "flower of the month" posts and birth-flower posts.
- **Public-domain originals:** yes, on BHL and Commons, about 140+ years of plates.
- **References:** https://en.wikipedia.org/wiki/Curtis%27s_Botanical_Magazine [F]
- **Our register:** R1-adjacent, like Köhler. It is softer and more "garden" than "pharmacy."
- **Best topic/district:** ornamental and sacred flowers, and birth flowers. It works for Egyptian lotus and Hindu marigold/lotus when
  re-framed in district motifs.
- **Prompt fragment:** `hand-coloured copper engraving, Curtis's Botanical Magazine plate, Walter Hood Fitch style, single flowering stem, watercolour wash over fine line, plate number, aged paper`

### 3. Elizabeth Blackwell, *A Curious Herbal* (1737–39)
- **Looks like:** full-page engravings that Blackwell drew, engraved and hand-coloured herself. They were drawn from life at Chelsea Physic Garden.
  The plants are flatter and more decorative than in Curtis, with slightly naive and charming colour. Each plant's name is
  given in **six languages** (Latin, Greek, Italian, Spanish, Dutch, German). [F] The six-language caption is a ready-made design device.
- **Suits:** **multi-tradition correspondence cards.** Swap her six European languages for our four districts and English
  (e.g. lotus: English / Egyptian *sšn* / Phoenician / Akkadian / Sanskrit *padma*). It also suits kitchen-herb recipe cards and
  "herb of the day" posts.
- **Public-domain originals:** yes (Internet Archive / Missouri Botanical Garden scan; NLM; BL images).
- **References:** https://www.themarginalian.org/2020/01/29/elizabeth-blackwell-curious-herbal/ [F];
  https://archive.org/details/mobot31753002620844 [S]; https://digitalgallery.nlm.nih.gov/gallery/fireandfreedom/browse/item/1022/a [S]
- **Our register:** R1. Its warmth and hand-tinted feel match the "illuminated print" palette very closely.
- **Best topic/district:** cross-district correspondences and the kitchen-witch / culinary-herb series.
- **Prompt fragment:** `18th-century hand-coloured herbal engraving, Elizabeth Blackwell Curious Herbal style, decorative flat botanical, soft hand-tinted watercolour, engraved plate number, multilingual plant name caption`

### 4. Medieval herbal manuscripts: Vienna Dioscurides, Tractatus de herbis, Carrara Herbal
- **Vienna Dioscurides (c. 512–515, Constantinople):** 383 surviving full-page plant paintings (of 435). Some are
  naturalistic and copied from classical models, and some are more abstract. Its dedication portrait of Anicia Juliana sits inside an **eight-point rope
  star with grisaille putti in the corners** [F], an excellent template for a frame or medallion. The plants float on bare parchment
  with Greek captions.
- **Tractatus de herbis (Egerton 747, c. 1300, Salerno/Naples):** schematic "diagram" plants. They can be identified but are
  stylised, with an alphabetical text of about 524 entries on simples from plant, animal and **mineral** sources. [S] That makes it
  a medieval precedent for putting herbs and stones in one book. The look is flat colour, symmetrical roots and leaves, and red/blue initials.
- **Carrara Herbal (Egerton 2020, Padua, c. 1390–1404):** an Italian vernacular version of Serapion the Younger (Ibn Sarābī),
  made for Francesco II Carrara. It is known for strikingly naturalistic plant paintings, early for its time (general knowledge). [S]
- **Common look:** vellum/parchment ground, plants floating with roots shown, gold or coloured initial, a rubricated (red-ink) title,
  sometimes a small animal or human figure using the plant (mandrake). Illuminated borders: vine scroll, ivy leaf, gold dots.
- **Suits:** single-herb "grimoire page" posts, mandrake/nightshade lore, "medieval uses of X" carousels, illuminated-initial quote cards.
- **Public-domain originals:** yes. BL digitised manuscripts (Egerton 747 and 2020), Austrian National Library (Cod. med. gr. 1).
- **References:** https://en.wikipedia.org/wiki/Vienna_Dioscurides [F]; https://dec.hsls.pitt.edu/s/blast-from-the-past/item/1770 [S];
  https://searcharchives.bl.uk/catalog/032-001982947 [S]
- **Our register:** **R4** (the past and mystical: manuscript as memory). A Dioscurides-style rope star with a plant inside makes a strong card face.
- **Best topic/district:** classical Greco-Roman/European materia medica. Phoebe (a Greek Titaness, older than the districts) fits the
  Dioscurides look. The Carrara/Serapion line also bridges toward Unani.
- **Prompt fragment:** `medieval illuminated herbal manuscript page, Tractatus de herbis style, stylised plant with visible roots on vellum, rubricated title, gold-leaf initial, ivy-scroll border, tempera, aged parchment`

---

## B. Alchemical and occult print traditions

### 5. Splendor Solis (BL Harley 3469, Germany, 1582)
- **Looks like:** 22 full-page miniatures and dozens of gold calligraphic initials. [S, BL / medievalists summary] They belong to the circle of
  Dürer, Holbein and Cranach. [F] Each miniature is a framed **arched panel set in an architectural/ornamental surround**. Below it is a deep
  border of flowers, birds, putti and genre scenes, all in jewel-bright tempera and gold. The central images are a king in a flask, a black sun setting over a
  marsh, a red sun rising over a city, a winged figure offering a red robe, and alchemists digging for gold
  (general knowledge + PDR product listings).
- **Suits:** **the Tarot card face** (our R4 template), "stage of the work" posts (nigredo → rubedo), planet/metal correspondences
  (Sun/gold, Moon/silver), and mythic-origin stories of a god.
- **Public-domain originals:** yes. They are in the BL and Wellcome copies, the 1920 English edition is on Archive.org/HathiTrust, and PDR sells prints of them.
- **References:** https://www.medievalists.net/2012/08/harley-ms-3469-splendor-solis-or-splendour-of-the-sun-a-german-alchemical-manuscript/ [F];
  https://publicdomainreview.org/product/dark-sun-from-splendor-solis/ [S]; https://imagesonline.bl.uk/asset/6767 [S]
- **Our register:** **R4, the canonical source.**
- **Best topic/district:** planetary metals and gems (the Navaratna table), the alchemy/healing venues. With district motif swaps
  (lamassu, lotus columns, cedar), it works for every district. For Babylon, darken the ground.
- **Prompt fragment:** `Splendor Solis alchemical miniature, German Renaissance illumination 1582, arched panel framed by architectural border, jewel-tone tempera and gold leaf, allegorical king and sun, flowered margin with birds, tarot card proportions`

### 6. Atalanta Fugiens (Michael Maier, 1617; engravings by Matthäus Merian)
- **Looks like:** 50 emblems. Each has a copper engraving by Merian, an epigram in Latin and German, a three-voice fugue
  and a prose discourse. [F] The plates are circular or oval vignettes inside a rectangular frame with a motto above, done in dense,
  crisp black-line engraving with landscape depth. Wet nurse Earth suckling a child, the wolf devouring the king, and the hermaphrodite are typical
  (general knowledge).
- **Suits:** **one-image-one-motto posts** (the emblem format is already a quote card: motto, image, epigram), myth-of-the-week
  carousels. Monochrome black on parchment fits our ink palette, and a teal or terracotta glow added on top makes it **R2**.
- **Public-domain originals:** yes (Commons, the Science History Institute, an interactive Brandeis/MIT digital edition) (general knowledge).
- **References:** https://en.wikipedia.org/wiki/Atalanta_Fugiens [F]
- **Our register:** **R2 (with glow) and R4.** Engraving warmed with light is our cutscene look, and the emblem frame is myth.
- **Best topic/district:** any. Merian line is the general "story moment" grammar. For Babylon, use reverse/white-line-on-black.
- **Prompt fragment:** `17th-century copper engraving emblem, Matthäus Merian, Atalanta Fugiens, circular vignette in rectangular frame, Latin motto banner, dense cross-hatching, black ink on parchment, soft golden glow highlights`

### 7. Mutus Liber (La Rochelle, 1677)
- **Looks like:** a wordless book of plates in sequence (the "Silent Book"). [F] It shows alchemist couples at the furnace, angels with
  ladders, and vessels, in clean outline engraving with little hatching (general knowledge).
- **Suits:** **step-by-step process carousels** (preparation, extraction, tincture-making, a ritual sequence) told
  mostly in pictures. It is the precedent for a "silent" swipe-through how-to.
- **Public-domain originals:** yes (1677 and 1702 editions on Commons) (general knowledge).
- **References:** https://en.wikipedia.org/wiki/Mutus_Liber [F]
- **Our register:** R2/R4. Use it for the "how" sequence inside the myth world.
- **Best topic/district:** preparation and recipe sequences, such as the Hindu rasa-shastra (alchemy) venue, or Ninkasi's brewing in Babylon.
- **Prompt fragment:** `Mutus Liber alchemical plate, 1677 outline engraving, wordless sequential panel, alchemist and soror mystica at athanor, angels and ladder, sparse hatching, parchment, numbered step`

### 8. Astrological almanac woodcuts / Zodiac Man
- **Looks like:** a standing nude male figure with the 12 signs placed on the body parts they rule (Aries on the head, Pisces on the feet).
  Rays or lines link the signs to medallions around the edge. Woodcuts use thick black line with flat or hand-applied colour, and
  manuscript versions are in blue, red, crimson and gold leaf (Wellcome MS 349). [S] It is common in 16th-century almanacs (Slovacius, Breslau 1580). [S]
- **Suits:** **body-correspondence charts** ("which herbs for which sign," Ayurvedic marma / chakra charts as a parallel),
  planetary-hours charts, and almanac-style "this month's moon" posts.
- **Public-domain originals:** yes (Wellcome; the 1580 Slovacius woodcut via World History Encyclopedia). Check each record's rights.
- **References:** https://www.worldhistory.org/image/14577/zodiac-man/ [S]; https://identity.wellcomecollection.org/works/zpzcrfyw [S]
  (1497, marked in copyright); https://www.cabinet.ox.ac.uk/node/6752 [S]
- **Our register:** R4 (mystical) and the Babylon star-chart motif. Babylon invented the zodiac, so this is its natural home.
- **Best topic/district:** **Babylon** (star charts, omens), plus the Hindu Navagraha body map as a twin chart.
- **Prompt fragment:** `16th-century astrological almanac woodcut, zodiac man figure with signs on body parts, bold black woodcut line, hand-coloured red and blue, radiating lines to roundels, blackletter caption`

### 9. Rider–Waite–Smith tarot (Pamela Colman Smith, 1909)
- **Looks like:** heavy, even black outline, flat colour fills (yellow sky, red, blue, green), stage-like scenes full of
  symbols, a thick white border, a Roman numeral top centre and a title in a box at the bottom. Minor Arcana are illustrated scenes. [F]
  It is public domain in the US (since 1966) and the UK. Avoid U.S. Games' 1971 recolouring and card-back. [F]
- **Suits:** **tarot-card posts** ("The Empress and her herbs," a card-of-the-day with a correspondence strip) and pairing a gem and herb with each Major.
- **Public-domain originals:** yes, the 1909 first printing scans.
- **References:** https://en.wikipedia.org/wiki/Rider%E2%80%93Waite_Tarot [F]
- **Our register:** R4. Use it for **layout grammar** (border, numeral, title box), not for its art. Our card art is Splendor Solis.
  Combining the two (Splendor Solis painting inside an RWS frame) is probably the most legible card for Pinterest.
- **Best topic/district:** any. Tarot-correspondence posts are one of the largest witchy Pinterest genres.
- **Prompt fragment:** `Rider-Waite-Smith tarot card, Pamela Colman Smith style, bold even black outline, flat colour fills, white card border, Roman numeral at top, title box at bottom, symbolic stage-set composition`

---

## C. The four districts' source styles

### 10. Egyptian papyrus and tomb painting (Black Land)
- **Looks like:** figures arranged in horizontal **registers** (bands) on ground lines. The body is composite, with the head in profile, the eye
  frontal, the shoulders frontal and the legs in profile. Fills are flat mineral colour (ochre, red, Egyptian blue, malachite green, black, white) inside a crisp
  outline. Hieroglyph columns run between figures. Border: a **khekher frieze** on top and a coloured block "ladder" border (general
  knowledge). Nebamun's garden pool (BM) shows a top-down pool full of fish and ducks, surrounded by date palms and sycamores in profile, with the sycamore
  goddess. [F] Book of the Dead papyri are the same look on papyrus, with vignettes over text.
- **Suits:** **herb/plant correspondence bands** (one register per plant: lotus, papyrus, blue lily, mandrake, which all appear in tomb
  art), god-and-offering cards, "Egyptian garden" carousels, and the Hathor *lore* (not her digital self).
- **Public-domain originals:** yes. The Met's Nina de Garis Davies facsimiles (Open Access, commercial use OK on many records) are the best
  clean study source. The British Museum holds the Nebamun fragments.
- **References:** https://en.wikipedia.org/wiki/Tomb_of_Nebamun [F]; https://www.metmuseum.org/art/collection/search/544562 [S, OA];
  https://www.metmuseum.org/art/collection/search/557843 (ceiling pattern, good for borders) [S]
- **Our register:** R4 when it shows the deep past and gods. Flat Egyptian line **inside a Nouveau frame** suits Black Land daily life (R1).
- **Best topic/district:** **Egyptian / Black Land**: lotus, blue water lily, papyrus, kyphi incense, lapis, carnelian, turquoise.
- **Prompt fragment:** `ancient Egyptian tomb painting, New Kingdom Theban style, composite profile figures, flat mineral pigments ochre and Egyptian blue and malachite green, horizontal registers with ground lines, hieroglyph columns, khekher frieze border, papyrus texture`

### 11. Phoenician ivories, coins and glass (Harbor). Not on the original list, added because it fills the gap for the Phoenician district
- **Looks like:** openwork ivory furniture plaques, Egyptianising in motif (sphinxes, pharaonic crowns, palmettes, the "woman at the
  window"), with **coloured glass inlay** and gold. Bands of frames nest inside one another around a face. [S, Met record]
  Add Tyrian-purple dye, murex shells, cedar, and the Phoenician alphabet as a decorative band.
- **Suits:** gem and glass posts (Phoenicians spread glassmaking), murex/purple-dye posts, Astarte/Baalat cards, alphabet/letter
  correspondence (Taautos the scribe), and merchant/trade-route maps of where herbs came from.
- **Public-domain originals:** yes (Met open access ivories; Nimrud ivories at the BM).
- **References:** https://www.metmuseum.org/art/collection/search/324938 [S]; https://www.worldhistory.org/image/2871 [S]
- **Our register:** R4 (myth/past). Ivory cream plus glass teal maps straight onto our parchment-and-teal palette.
- **Best topic/district:** **Phoenician / Harbor**: frankincense, cedar, purple, glass, coral, amber trade.
- **Prompt fragment:** `Phoenician carved ivory plaque, openwork relief, Egyptianizing palmettes and sphinx, nested frame bands, coloured glass inlay, gold leaf, Tyrian purple accents, cedar and murex motifs`

### 12. Babylonian / Assyrian relief and Ishtar Gate glazed brick (Babylon)
- **Ishtar Gate:** vivid blue glazed brick in imitation of lapis, with striding animals in gold-brown glaze. Bands and rosettes are black/white/gold.
  The lions are white-bodied with yellow manes, on blue with an orange lower border. Animals: **mušḫuššu dragon** (Marduk), **aurochs**
  (Adad), **lion** (Ishtar). [F] Pieces are in the Pergamon, Istanbul, the Met, the Louvre, the Oriental Institute and others. [F]
- **Assyrian palace relief (Nimrud, 865–860 BCE):** low relief carved in gypsum. Winged apkallu genies with a **pine cone and bucket**,
  dipping the cone (*mullilu*) in an anointing liquid; [S] a stylised sacred tree; dense cuneiform bands across the figures; tight beards and curls in rows.
- **Suits:** **rosette-border correspondence charts** (the rosette band is a ready-made header and footer), god cards (Marduk,
  Nabu, Shamash, Nisaba), "demons and the plants that ward them" (Pazuzu charms, the occult-noir tone), and star/omen charts.
  A relief-carved stone texture makes a good **dark background** for gemstone posts: lapis, carnelian, banded agate.
- **Public-domain originals:** yes (Met and BM open-access photos of reliefs and lions).
- **References:** https://en.wikipedia.org/wiki/Ishtar_Gate [F]; https://metmuseum.org/art/collection/search/322613 [S];
  https://www.worldhistory.org/type/3/1354/a/ [S]
- **Our register:** R4. **Darker** per the district brief: Ishtar blue glowing out of black, gold lamassu. The glazed blue is our teal pushed to
  lapis. With a glow it doubles as the Babylon **R2 cutscene** look.
- **Best topic/district:** **Babylon**: lapis lazuli, date palm, cedar, tamarisk, barley/beer (Ninkasi), exorcism herbs.
- **Prompt fragment:** `Ishtar Gate glazed brick relief, lapis-blue glaze, striding gold lion and mušḫuššu dragon, white and gold rosette border bands, Neo-Babylonian, dark night background, low-relief cuneiform panel, mysterious glow`

### 13. Persian / Mughal miniature and Arabic De Materia Medica copies (Unani bridge)
- **Arabic Dioscurides (Baghdad, 1224):** physicians and pharmacists in architectural settings with arches, cauldrons and patients. Opaque
  watercolour and gold, flat bright colour, and a Naskh text block above and below. Example: "Preparing Medicine from Honey," Met
  57.51.21, Open Access, commercial reuse allowed. [S]
- **Mughal flower studies (Ustad Mansur, c. 1620):** single flowers (the Kashmir red tulip) painted with naturalist precision on a plain ground,
  set in **gold-sprinkled and floral-arabesque borders (hashiya)**. Jahangir commissioned 100+ flower paintings. [S]
- **Suits:** **Unani / Islamic-medicine posts**, rose/saffron/opium-poppy sheets, "the apothecary at work" recipe scenes, and gem
  posts (Mughal jewel culture: emeralds, spinels). The hashiya border is a premium frame for any single-herb sheet.
- **Public-domain originals:** yes (Met OA, BL, V&A, Freer).
- **References:** https://www.metmuseum.org/art/collection/search/451400 [S]; https://www.metmuseum.org/toah/works-of-art/57.51.21 [S];
  https://en.wikipedia.org/wiki/Ustad_Mansur [S]
- **Our register:** sits between R1 and R4. The flower study is living-world (R1 colour discipline), and the pharmacy scene is past (R4).
- **Best topic/district:** **Unani / Persian medicine**. It also bridges toward the Hindu district (Mughal India) and Babylon (Baghdad sits on
  Mesopotamian ground).
- **Prompt fragment:** `Persian Mughal miniature painting, Ustad Mansur flower study, opaque watercolour and gold, single naturalistic bloom on plain ground, gold-sprinkled hashiya border with floral arabesques, Nastaliq calligraphy panel`

### 14. Indian Pichwai, Kalamkari and temple art (Sacred Grounds)
- **Pichwai (Nathdwara, from about the 17th century):** large cloth "back-hangings" made for the Shrinathji temple. Motifs are lotus ponds (*kamal talai*)
  filling the whole field, cows with bells and saffron handprints, blue Krishna, peacocks, and gopis in rows. Natural mineral
  pigments and gold leaf give a jewel palette with dense repetition and symmetry. [S]
- **Kalamkari (Srikalahasti):** freehand "pen-work" drawn with a bamboo *kalam*, using natural dyes and mordants: madder red, indigo, myrobalan
  black, pomegranate yellow. The panels are narrative (epics, deities, Tree of Life) and arranged in bordered registers. [S] (Machilipatnam is
  the block-printed variant.) The black outline and earthy red map closely onto **our black ink and terracotta**.
- **Temple art (general):** stone-carved niches with toranas (arches), mandapa pillars, marigold garlands, oil lamps.
- **Suits:** **Ayurvedic herb sheets** (tulsi, neem, ashwagandha, turmeric), Navaratna/Navagraha gem charts (nine deities in a
  3×3 temple-niche grid), deity cards, and festival posts. Kalamkari's bordered registers make natural **multi-row
  correspondence charts**.
- **Public-domain originals:** older pieces are in museums (V&A, Met, Calico Museum) and are PD as works. Living artists (Memeraki listings)
  are **copyrighted contemporary work**, fine for study only.
- **References:** https://en.vikaspedia.in/viewcontent/education/art-culture/pichwai-paintings?lgn=en [S];
  https://kalakshetra.in/craft-centre/kalamkari/ [S]; https://www.memeraki.com/blogs/news/kalamkari-craftsmanship-with-bamboo-pens [S]
- **Our register:** Kalamkari is R4 (myth narrative). The Pichwai lotus-and-cow field is R1 (living, abundant) on our palette.
- **Best topic/district:** **Hindu / Sacred Grounds**: Ayurveda, Navaratna, rasa-shastra.
- **Prompt fragment:** `Srikalahasti kalamkari hand-painted textile, bamboo kalam pen line, natural madder red and indigo and myrobalan black dyes, narrative registers with ornamental borders`
  · `Nathdwara pichwai painting, lotus pond kamal talai, cows with saffron handprints, mineral pigments and gold leaf, symmetrical devotional composition`

### 15. Japanese ukiyo-e kachō-e and Honzō Zufu (East Asian bridge)
- **Honzō Zufu (Iwasaki Tsunemasa / Kan'en, 1830–44, 92 vols., about 2,000 plants):** woodblock prints, hand-coloured in places, showing
  each plant's **full life cycle**. [F, Guimet] Its classification follows the Bencao Gangmu. [S] The look is clean outline, soft flat
  colour, a vertical scroll-like layout and Japanese/Chinese annotations.
- **Hokusai "Large Flowers" (c. 1833–34):** horizontal ōban nishiki-e. One big flower and one small creature (iris and grasshopper,
  morning glory and tree frog, bellflower and dragonfly). Graphic flat colour, bold line, Prussian blue grounds. [S]
- **Suits:** minimalist single-herb posts, seasonal posts, "plant and its creature" pairings, and the strongest **aesthetic
  crossover** with Pinterest Japandi minimalism.
- **Public-domain originals:** yes (AIC, MFA, Brooklyn are all open access, plus Kew/Guimet copies of the Honzō Zufu).
- **References:** https://www.guimet.fr/en/our-collections/treasures-historic-library/honzo-zufu-japanese-flora [F];
  https://www.artic.edu/artworks/25129/bell-flower-and-dragonfly-from-an-untitled-series-of-large-flowers [S];
  https://www.brooklynmuseum.org/objects/51874 [S]
- **Our register:** not one of our four. It is a **common Pinterest style, outside our registers**. It can be adapted to R1 because the woodblock
  outline and flat tint are close to our "hand-tinted print" palette.
- **Best topic/district:** Kampō / Japanese herbalism, and seasonal flower posts. None of our districts.
- **Prompt fragment:** `Edo-period ukiyo-e kachō-e woodblock print, Hokusai Large Flowers style, bold outline, flat colour with Prussian blue, single flower with insect, washi paper texture, vertical kanji cartouche`

### 16. Chinese materia medica woodcuts (Bencao Gangmu, Li Shizhen, 1578 / printed 1593–96)
- **Looks like:** small monochrome **woodblock** illustrations (more than 1,100 in two volumes). [S] A plant appears in schematic outline, often with roots, sometimes
  in a little landscape with a harvester or animals (asafoetida with a hunter). [S] The block shows a framed rectangle, a vertical
  character label and solid black-and-white line with no shading.
- **Suits:** **TCM herb sheets** (ginseng, goji, ginger, licorice), five-element correspondence charts (wood, fire, earth, metal, water ↔ organ ↔
  herb ↔ colour), and black-on-parchment minimal posts.
- **Public-domain originals:** yes (Source Library scans; the National Library of China; the Wellcome holds Chinese herbals, though I could not confirm that it holds the BCGM).
- **References:** https://sourcelibrary.org/collections/chinese-natural-history [S]; https://mowcaparchives.org/mwc/inct/detl/11 [S]
- **Our register:** outside our registers (common Pinterest/TCM style). Its black ink on parchment matches our base palette.
- **Best topic/district:** **TCM**. None of our districts.
- **Prompt fragment:** `Ming dynasty woodblock print, Bencao Gangmu materia medica illustration, schematic herb with roots, crisp black outline no shading, framed panel, vertical Chinese character label, rice paper`

---

## D. 19th–20th century decorative styles

### 17. Art Nouveau / Alphonse Mucha (1890s–1900s)
- **Looks like:** a central figure in front of a **halo-like decorative arch or roundel** behind the head (used in all his later theatre posters). [F]
  Hair curls in arabesques that fill the frame. [F] Lines are flowing whiplash curves, the *Gismonda* poster used **pastel** colour, [F] and
  there are Byzantine mosaic touches and ornate hand-drawn lettering panels. *Documents décoratifs* (1902), with 72 plates, shows how plant forms
  turn into ornament. [F] Frames are vertical poster panels with botanical borders and lettering in a top or bottom cartouche.
- **Suits:** **god/goddess-with-her-herbs cards**, seasonal plant-spirit portraits, zodiac-sign posts (Mucha's *Zodiac* is iconic),
  and full-bleed vertical pins (2:3 is Mucha's native proportion).
- **Public-domain originals:** yes. Mucha died in 1939, so his work is PD in life+70 countries (EU/UK since 2010), and pre-1929 US publications are PD.
- **References:** https://en.wikipedia.org/wiki/Alphonse_Mucha [F]
- **Our register:** **R1, canonical** (Phoebe, Ceres, the farm).
- **Best topic/district:** the living world in any district. Restyle the halo with district motifs: lotus disc (Egypt), rosette
  (Babylon), murex/cedar (Phoenicia), marigold mandala (Hindu).
- **Prompt fragment:** `Art Nouveau poster, Alphonse Mucha style, flowing whiplash linework, ornate circular halo behind head, arabesque hair, botanical border panels, hand-lettered cartouche, muted pastel and parchment, black ink outline`

### 18. Victorian apothecary labels (c. 1850–1910)
- **Looks like:** small rectangular or oval labels with a double-rule or scalloped border, mixed typefaces (Didone, Clarendon, Tuscan,
  copperplate script), a Latin drug name, a druggist's name and address, a "POISON" warning in red, and colour coding for internal versus
  external use. [S] Chromolithographic catalogues offered decorative labels, often with Art Nouveau or Arts-and-Crafts influence. [S]
- **Suits:** **dose/interaction "label" cards** for the harm-reduction library ("POISON / NOT FOR INTERNAL USE," a contraindication
  line), tincture/recipe cards, "apothecary jar" shelf graphics, and printable sticker sheets (big on Etsy). Pinterest's 2026 report has
  "herbal apothecary" searches up 595% (Kitchen Witch trend). [S]
- **Public-domain originals:** yes (Smithsonian's Bristol-Myers Squibb label collection: 200+ European labels).
- **References:** https://si.edu/es/spotlight/bristol-myers-squibb-european-apothecary/prescription-labels [S];
  https://alembicrarebooks.com/blogs/alembic-rare-books-blog/chromolithographic-paradise-a-19th-century-pharmaceutical-catalogue [S];
  https://lbbonline.com/news/Find-Your-Joy-with-Pinterests-2026-Hobbies-Trend-Report [S]
- **Our register:** R1 (living, practical world). Its typography is the "label layer" that can sit on top of any register.
- **Best topic/district:** the harm-reduction and dose shelves, the kitchen witch series. No specific district.
- **Prompt fragment:** `Victorian apothecary bottle label, ornate double-rule border, mixed Didone and Tuscan typefaces, Latin drug name, red POISON warning, aged paper, letterpress print`

### 19. Linocut / block print (contemporary)
- **Looks like:** bold carved black shapes and gouge-mark texture, one or two flat colours, slightly imperfect registration and big negative
  space. It is very popular on Etsy for herb and moon-phase prints.
- **Suits:** simple single-herb or crystal icons, moon-phase charts, logo-like "seal" posts and merch.
- **Public-domain originals:** the style is old (woodcut). Contemporary linocuts are copyrighted.
- **References:** search-only, general. Etsy/Pinterest "herb linocut print" (not fetched).
- **Our register:** common Pinterest style, outside our registers. It is the closest modern cousin of the Bencao/almanac woodcut, so a
  terracotta-on-parchment linocut sits comfortably next to R4.
- **Best topic/district:** merch, icons, the Babylon star-chart roundels.
- **Prompt fragment:** `hand-carved linocut block print, bold black shapes, visible gouge marks, two-colour terracotta and black on cream paper, slight misregistration`

---

## E. Contemporary Pinterest/Instagram aesthetics (outside our registers unless noted)

### 20. Loose watercolour botanical
- **Looks like:** wet-on-wet blooms with soft edges, a little fine ink line, a white or cream background and a handwritten script label. It is the
  default "herb of the week" pin.
- **Suits:** soft single-herb posts, recipe cards, tea blends.
- **PD originals:** n/a (modern). **References:** search-only. **Register:** outside ours, close to R1 in mood.
- **Prompt fragment:** `loose watercolour botanical illustration, wet-on-wet soft edges, delicate ink accents, cream paper, handwritten script label`

### 21. Dark academia
- **Looks like:** dim library light, leather, brass, old books, candle smoke, sepia and oxblood, specimen jars and magnifying glasses,
  serif typography. It overlaps with the "Victorian naturalist's desk."
- **Suits:** "poison garden" posts (belladonna, foxglove), history-of-medicine carousels, Babylon-at-night mood.
- **References:** search-only (no trend source returned in my search). **Register:** outside ours. Its mood matches **Babylon**.
- **Prompt fragment:** `dark academia, candlelit antique library, sepia and oxblood palette, leather-bound books, brass instruments, specimen jars, chiaroscuro`

### 22. Cottagecore / kitchen witch
- **Looks like:** linen, dried herb bundles, amber bottles, tiny labelled jars, soft daylight, gingham and wildflowers. Pinterest's 2026 "Kitchen
  Witch" trend (amber bottles, labelled jars, infusions, spice blending). [S]
- **Suits:** recipe cards, tea-blend posts, the "herbal apothecary" shelf.
- **Register:** outside ours. Mood-adjacent to R1 / Black Land daylight farm.
- **Prompt fragment:** `cottagecore kitchen witch, rustic wooden table, dried herb bundles, amber glass apothecary bottles with handwritten labels, soft natural window light, linen`

### 23. Celestial navy-and-gold
- **Looks like:** deep navy or midnight ground with gold foil-effect line art (moons, stars, sun faces, constellations), thin geometric
  frames and serif-caps typography. A staple Etsy style for tarot and astrology.
- **Suits:** moon-phase and planetary correspondence charts, birth-stone and zodiac posts, Navagraha posts.
- **Register:** outside ours as a palette, though structurally close to R4. **Swap navy for Ishtar lapis over black** and it becomes the Babylon
  night sky: a fair adaptation that keeps the district accent.
- **Prompt fragment:** `celestial gold foil line art on deep navy, crescent moons and stars, sun face, constellation lines, thin geometric frame, elegant serif capitals`

### 24. Vaporwave
- **Looks like:** pink-to-purple and cyan gradients, a perspective **neon grid horizon**, a digital sunset, **classical marble busts**, Windows-95
  GUI windows, glitch text and Japanese text accents. The look consolidated around 2012 out of Tumblr/SoundCloud music culture. [S]
- **Suits:** **Hathor only** (the AI witness posts), automation-spirit posts, "the chain/witness explained" posts. A marble bust of
  Hathor (cow-horned sun-disc headdress) on a grid horizon reads instantly.
- **References:** https://design-styles.enlighten-media.net/pages/vaporwave/ [S]; https://trends.daisyui.com/trend/vaporwave/ [S]
- **Our register:** **R3, canonical.** Keep it fenced. Never use it for an organic herb, stone or god.
- **Best topic/district:** digital divine, across all districts (Hathor is Egyptian by name but digital by nature).
- **Prompt fragment:** `vaporwave aesthetic, neon cyan and magenta gradient sunset, perspective wireframe grid horizon, marble statue bust, holographic chrome, retro Windows 95 interface window, glitch scanlines`

### 25. Minimal line art
- **Looks like:** a single continuous fine black line, lots of white or cream space, a small serif or sans label, maybe one pastel shape behind.
- **Suits:** crystal guides (outline crystals with a one-line meaning each), herb glossaries, carousel "index" slides, story covers.
- **Register:** outside ours. It is close to our ink layer, and a thin teal accent line keeps it on-palette.
- **Prompt fragment:** `minimal single continuous line drawing, fine black ink, generous negative space, cream background, small serif label, one muted terracotta accent shape`

### 26. Flat-lay photography
- **Looks like:** a top-down photo of herbs, crystals, candles, tarot cards and a mortar and pestle on linen, slate or wood. Text overlay in a corner
  block. It is the dominant real-product witch-content format.
- **Suits:** crystal guides with real stones, ritual kits, recipe ingredient shots. It needs real photography, not generation, if it is
  presented as a product shot.
- **Register:** outside ours. It could be shot on parchment with teal and terracotta props to stay on-palette.
- **Prompt fragment:** (if illustrated) `overhead flat-lay composition, herbs crystals and tarot cards arranged on aged parchment, soft diffuse light, terracotta and teal props`

### 27. Meme / text-post styles (Tumblr text post, Notes-app, quote cards)
- **Looks like:** the Tumblr text post meme (from 2014) is a screenshot of stacked user posts, often paired with an unrelated image. [S] On Instagram
  it is 1–3 lines of text on a plain background, a fake Notes-app page, an iMessage mock-up, or a quote card. [S] Avoid fake
  screenshots with invented usernames or note counts. They read as fabricated, and the repo's Artifact/publishing rules are strict on
  impersonation. **Use original quote-card designs instead.**
- **Suits:** high-share, low-effort engagement posts: a one-line herb fact, a Rule 1 line, "your sign's herb is…", hooks for carousels.
- **References:** https://geekchamp.com/?p=750044 [S]; https://androidexperto.com/?p=509359 [S]; https://fanlore.org/wiki/Text_Post_Meme [S, 403]
- **Register:** outside ours. A quote card in our palette (parchment, a black serif line, a terracotta rule, a teal glyph) is the on-brand version,
  and an Atalanta-style **emblem motto** is the R4 version of a quote card.
- **Prompt fragment:** n/a (typographic, not generated). Build as a template.

---

## Practical recommendations (brief)

1. **Card stack per post type.** *Single herb sheet:* Köhler/Blackwell plate (R1) + Nouveau frame + Victorian label strip
   for dose/interaction. *Correspondence chart:* district-native register bands (Egyptian registers, Kalamkari rows,
   Ishtar rosette bands) with one row per herb/gem/planet. *God card:* Splendor Solis painting in an RWS frame (R4).
   *Crystal guide:* minimal line art or Bencao-style woodcut icons on parchment, or a dark relief background for Babylon. *Recipe/process:* Mutus Liber
   wordless sequence.
2. **Blackwell's six-language caption becomes our district caption**: English plus Egyptian / Phoenician / Akkadian / Sanskrit names.
   This device is unique to us and fits the palette.
3. **Fence vaporwave to Hathor.** It is the only register with a hard content rule.
4. Out-of-register Pinterest styles (watercolour, cottagecore, navy-gold, flat-lay, Japanese, TCM) can be used **as reach
   experiments** only if they are restyled onto the palette. Otherwise they break the "style tells you which world you're in" system.

---

## Summary matrix

| # | Style | Suits format | Our register | Topic / district |
|---|---|---|---|---|
| 1 | Köhler's Medizinal-Pflanzen | single herb sheet, dose callouts | R1-adjacent (scientific base) | Western pharmacology / harm-reduction shelf |
| 2 | Curtis's Botanical Magazine | single flower, birth flower | R1-adjacent | sacred/ornamental flowers; lotus, marigold |
| 3 | Blackwell *Curious Herbal* | multilingual correspondence card, recipe | R1 | cross-district names; kitchen herbs |
| 4 | Medieval herbals (Dioscurides, Tractatus, Carrara) | grimoire page, herb lore, illuminated quote | R4 | Greco-Roman/European; Phoebe; bridges to Unani |
| 5 | Splendor Solis | tarot card face, planet/metal chart, myth | **R4 canonical** | planetary metals & gems; all districts |
| 6 | Atalanta Fugiens (Merian) | emblem/motto quote card, myth story | R2 (with glow) / R4 | any; cutscene grammar |
| 7 | Mutus Liber | wordless step-by-step carousel | R2 / R4 | preparation sequences; rasa-shastra, brewing |
| 8 | Almanac woodcut / Zodiac Man | body-correspondence & zodiac chart | R4 | **Babylon** (zodiac origin); Navagraha twin |
| 9 | Rider–Waite–Smith | tarot card layout | R4 (frame grammar) | any; tarot-correspondence posts |
| 10 | Egyptian tomb painting / papyrus | register-band chart, god + offering card | R4 (past) / R1 in Nouveau frame | **Egyptian / Black Land** |
| 11 | Phoenician ivory & glass | gem/glass post, alphabet, trade map | R4 | **Phoenician / Harbor** |
| 12 | Ishtar Gate / Assyrian relief | rosette-band chart, god card, dark gem bg | R4 (dark) / R2 with glow | **Babylon** |
| 13 | Persian/Mughal miniature, Arabic Dioscurides | single flower in hashiya, pharmacy scene | R1/R4 bridge | **Unani**; bridges Hindu & Babylon |
| 14 | Pichwai / Kalamkari / temple | Ayurveda herb sheet, Navaratna 3×3 grid, deity card | R1 (Pichwai) / R4 (Kalamkari) | **Hindu / Sacred Grounds / Ayurveda** |
| 15 | Ukiyo-e kachō-e / Honzō Zufu | minimal herb, seasonal, plant+creature | outside (adaptable to R1) | Kampō / Japanese |
| 16 | Bencao Gangmu woodcut | TCM herb sheet, five-element chart | outside (ink-palette match) | **TCM** |
| 17 | Art Nouveau / Mucha | god-with-herbs portrait, zodiac pin | **R1 canonical** | living world, all districts |
| 18 | Victorian apothecary label | dose/interaction label, tincture card, stickers | R1 (label layer) | harm-reduction, kitchen witch |
| 19 | Linocut / block print | icon, moon chart, merch | outside (near R4) | merch; Babylon roundels |
| 20 | Loose watercolour | soft herb post, tea blend | outside | general herbs |
| 21 | Dark academia | poison garden, history carousel | outside (mood = Babylon) | Babylon night, poisons |
| 22 | Cottagecore / kitchen witch | recipe, tea blend, apothecary shelf | outside (mood ≈ R1) | kitchen herbs; Black Land daylight |
| 23 | Celestial navy-and-gold | moon/planet/zodiac chart, birthstone | outside (adapt as Babylon lapis-on-black) | astrology; Navagraha |
| 24 | Vaporwave | Hathor / AI-witness posts | **R3 canonical, fenced** | digital divine only |
| 25 | Minimal line art | crystal guide, glossary, carousel index | outside (ink layer) | crystals, glossaries |
| 26 | Flat-lay photo | crystal kit, ritual kit, ingredients | outside | product/real-stone shots |
| 27 | Text-post / Notes-app / quote card | one-line hook, engagement | outside; emblem-motto = R4 version | Rule 1 lines, herb facts |
