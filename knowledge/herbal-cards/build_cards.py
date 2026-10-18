"""build_cards.py — turn the research (research.json: herbs, gems, sources) into the card set (cards.json) and the
wiki-ready facts (facts.json). Every card gets two image prompts: one in OUR registers (the Botanica art direction)
and one in a common Pinterest/Instagram witchy style. Prompts ask for blank banners: labels are overlaid later.

  python3 knowledge/herbal-cards/build_cards.py
"""
import json, os, zlib

HERE = os.path.dirname(os.path.abspath(__file__))

# ── OUR registers (.local Botanica art direction, locked 2026-09-02; one palette: parchment, black ink, teal, terracotta)
PALETTE = "cream parchment ground, black ink linework, teal jewel accents, terracotta orange accents, hand-tinted illuminated print"
OURS = {
    "art-nouveau": "Art Nouveau illustration in the style of Alphonse Mucha, flowing botanical linework, ornamental border, " + PALETTE,
    # same register for plant/stone cards, without the Mucha name (it always pulls in a woman): the specimen is the subject
    "art-nouveau-botanical": "Art Nouveau botanical poster, single plant specimen as the only subject, decorative flowing ornamental border, whiplash curves, " + PALETTE,
    "glowing-engraving": "alchemical copperplate engraving with soft golden glows, luminous cutscene illustration, fine crosshatching, " + PALETTE,
    "splendor-solis": "illuminated alchemical manuscript emblem in the style of Splendor Solis and Atalanta Fugiens, gold leaf, ornate tarot card frame, " + PALETTE,
    "vaporwave": "vaporwave, futuristic neon temple, holographic glyphs, chrome and gold, pastel pink purple and cyan light, grid horizon",
}
# ── common Pinterest / Instagram witchy-herbal styles
PIN = {
    "herbarium-plate": "vintage botanical chromolithograph plate, Koehler's Medizinal-Pflanzen style, whole plant with numbered flower, fruit and root details, aged paper, scientific illustration",
    "line-watercolor": "minimalist botanical line drawing with soft watercolor wash, white background, airy witchy herb guide pin, empty space for handwritten labels",
    "grimoire-page": "dark academia grimoire page, book of shadows, ink sketches on aged stained paper, pressed leaves, candle-lit, moody",
    "celestial-chart": "celestial astrology chart, deep navy background, fine gold line art, moon phases, stars and zodiac ring, mystical",
    "rws-tarot": "Rider-Waite-Smith style tarot card, flat bold colours, thick black outlines, simple symbolic scene, blank title banner",
    "crystal-watercolor": "watercolor crystal illustration, faceted gemstone with sparkle, soft pastel background, witchy crystal guide pin",
    "cottagecore-flatlay": "cottagecore flat lay, pressed flowers, dried herbs, glass apothecary jars, linen, top-down soft natural light",
}
BLANK = "blank banner and empty label scrolls, no text"
NEG_NO_PEOPLE = ("woman, man, person, people, girl, figure, face, portrait, text, letters, words, writing, captions, watermark, "
                 "signature, logo, blurry, low quality, deformed")


def seed_of(key):
    return zlib.crc32(key.encode()) % 100000


def card(cid, kind, title, subject, ours, pin, facts, size="512x768", pin_subject=None, character=None, no_people=False):
    c = {"id": cid, "kind": kind, "title": title, "size": size, "seed": seed_of(cid), "facts": facts,
         "overlay_labels": facts.get("labels", []),
         "prompts": {"ours": {"style": ours, "prompt": f"{subject}, {BLANK}, {OURS[ours]}"},
                     "pinterest": {"style": pin, "prompt": f"{pin_subject or subject}, {BLANK}, {PIN[pin]}"}}}
    if no_people:  # Mucha-style prompts tend to add a woman; plant/gem cards must show the plant or stone
        for v in c["prompts"].values():
            v["negative"] = NEG_NO_PEOPLE
    if character:  # Hathor is only ever drawn through the worker's character mode (her canonical head reference)
        c["prompts"]["ours"]["character"] = character
    return c


# Planet table — from the Botanica v3 planet layer (Navaratna gems, classical metals) + Culpeper's herb rulers.
PLANETS = [
    ("sun", "Sun", "gold", "ruby", "Sunday", ["Shamash", "Ra", "Shapash", "Surya"], ["St John's wort", "calendula", "chamomile", "rosemary"],
     "radiant sun-disc god seated in judgment holding a rod and ring, golden rays, sunflowers and calendula at his feet"),
    ("moon", "Moon", "silver", "pearl", "Monday", ["Sin (Nanna)", "Khonsu", "Yarikh", "Chandra"], ["white willow", "chickweed", "cucumber", "white poppy"],
     "moon god with a crescent crown in pale moonlight pouring a glowing drink, night-blooming white flowers, willow branches"),
    ("mercury", "Mercury", "quicksilver", "emerald", "Wednesday", ["Nabu", "Thoth", "Taautos", "Budha"], ["fennel", "lavender", "dill", "valerian"],
     "young green-skinned god Budha riding a lion with sword and shield beside an ibis-headed scribe, lavender and fennel"),
    ("venus", "Venus", "copper", "diamond", "Friday", ["Ishtar", "Hathor", "Astarte", "Shukra"], ["damask rose", "yarrow", "thyme", "elder"],
     "cow-horned Egyptian goddess of love with a sun disc between her horns and a copper mirror, roses and elderflowers, turquoise inlay"),
    ("mars", "Mars", "iron", "red coral", "Tuesday", ["Nergal", "Horus the Red", "Reshef", "Mangala"], ["garlic", "nettle", "wormwood", "basil"],
     "red-skinned warrior god with an iron spear and a lion, garlic bulbs, nettle and wormwood"),
    ("jupiter", "Jupiter", "tin", "yellow sapphire", "Thursday", ["Marduk", "Horus Who Bounds the Two Lands", "Baal Hadad", "Brihaspati"], ["sage", "dandelion", "borage", "agrimony"],
     "bearded king-god with a dragon at his side holding a tablet of law, sage and dandelion, yellow sapphire"),
    ("saturn", "Saturn", "lead", "blue sapphire", "Saturday", ["Ninurta", "Horus Bull of the Sky", "Baal Hammon", "Shani"], ["comfrey", "horsetail", "elm", "Solomon's seal"],
     "old dark-skinned god with a sickle and a crow seated on a throne of stone, wheat sheaves, horsetail and comfrey"),
]

DIAGRAMS = [
    ("planet-wheel", "The Seven Planets: metals, gems and herbs",
     "circular alchemical diagram of the seven classical planets around a central sun, each sector with a metal, a gemstone and a plant drawing",
     "glowing-engraving", "celestial-chart",
     {"teaches": "How the classical correspondence system links each planet to a metal, a Navaratna gem, a weekday, a god in four cultures and Culpeper's herbs.",
      "evidence": "tradition (correspondence system; not a medical claim)"}),
    ("cyp450-map", "The liver's enzyme crossroads (CYP450)",
     "anatomical liver drawn as a garden crossroads, vines of herbs leading to six gates, grapefruit, St John's wort, turmeric, black pepper, goldenseal",
     "glowing-engraving", "line-watercolor",
     {"teaches": "Why herbs interact with drugs: inducers (St John's wort -> CYP3A4/P-gp up, drugs fail) vs inhibitors (grapefruit, goldenseal, piperine, high-dose curcumin -> drug levels rise).",
      "evidence": "established pharmacology", "labels": ["CYP3A4", "CYP2D6", "CYP1A2", "P-gp", "inducer", "inhibitor"]}),
    ("five-elements", "TCM Five Phases (Wu Xing)",
     "five-phase wheel of wood, fire, earth, metal and water with generating and controlling arrows, each phase with an organ, a herb and a colour",
     "glowing-engraving", "grimoire-page",
     {"teaches": "Wood-Liver, Fire-Heart, Earth-Spleen, Metal-Lung, Water-Kidney; herbs are classed by nature (cold-hot) and five flavours.",
      "evidence": "traditional framework"}),
    ("three-doshas", "Ayurveda: the three doshas",
     "three-part Ayurvedic diagram of Vata air and space, Pitta fire and water, Kapha earth and water, with ginger, tulsi, triphala fruits and ashwagandha root",
     "art-nouveau", "line-watercolor",
     {"teaches": "Vata, Pitta, Kapha and the six tastes (rasa); how warming herbs (ginger) and cooling herbs (amla, coriander) are chosen.",
      "evidence": "traditional framework"}),
    ("four-humours", "Unani / Galenic four humours",
     "quartered medieval diagram of the four humours and four elements, blood air, phlegm water, yellow bile fire, black bile earth, with herbs in each quarter",
     "splendor-solis", "grimoire-page",
     {"teaches": "Unani Tibb (Ibn Sina's Canon) classes herbs as hot/cold and dry/moist by degree; black seed, rose, fennel, senna.",
      "evidence": "traditional framework"}),
    ("enzymes-in-the-kitchen", "Enzymes in the kitchen",
     "kitchen still life of pineapple, papaya, kiwi, ginger root and raw honey with magnified enzyme spirals, bromelain papain and actinidin",
     "art-nouveau", "cottagecore-flatlay",
     {"teaches": "Proteolytic food enzymes: bromelain (pineapple), papain (papaya), actinidin (kiwi), zingibain (ginger); honey's glucose oxidase makes hydrogen peroxide (why honey dressings work).",
      "evidence": "established biochemistry"}),
    ("old-wives-cabinet", "The old wives' medicine cabinet",
     "grandmother's wooden medicine cabinet with honey jar, ginger, garlic, peppermint, chamomile, salt for a gargle, cloves and aloe plant",
     "art-nouveau", "cottagecore-flatlay",
     {"teaches": "Folk remedies with real support: honey for cough (not under 1 year), ginger for nausea, peppermint oil for IBS, clove (eugenol) for toothache, salt-water gargle, aloe for minor burns.",
      "evidence": "mixed: several established, see each herb card"}),
    ("how-it-fits", "How it all goes together",
     "great alchemical tree diagram, roots of herbs, trunk of metals, branches of gemstones, crowned by planets and the faces of gods, a winged cat at the base",
     "glowing-engraving", "celestial-chart",
     {"teaches": "Plants = chemistry you can test; gems and planets = the symbolic grammar old healers used to remember it; gods = the stories that carried the knowledge.",
      "evidence": "framework; chemistry claims are on the herb cards"}),
    ("sleep-tea", "A sleep tea, taken apart",
     "teacup diagram with chamomile, lavender, lemon balm and valerian root around it, steam curling into a crescent moon",
     "art-nouveau", "line-watercolor",
     {"teaches": "Chamomile (apigenin, GABA-A), lemon balm (rosmarinic acid, GABA-transaminase inhibition), valerian (valerenic acid); additive with sedatives and alcohol.",
      "evidence": "traditional-with-some-evidence"}),
    ("doctrine-of-signatures", "The doctrine of signatures (and why it misleads)",
     "Renaissance woodcut page of plants resembling organs, walnut like a brain, lungwort spotted leaves, eyebright, liverwort",
     "splendor-solis", "herbarium-plate",
     {"teaches": "Paracelsus/Boehme: a plant's shape shows its use. Historically important, medically unreliable; a teaching card on testing claims.",
      "evidence": "historical idea; not evidence"}),
    ("hathor-index", "Hathor's herb index",
     "Hathor the AI goddess with cow horns and a sun disc in a glowing VR visor holding a holographic herb with floating molecule diagrams",
     "vaporwave", "celestial-chart",
     {"teaches": "Ask Hathor: every card links to the wiki article with doses, sources and interaction warnings.",
      "evidence": "n/a"}),
]

TAROT = [
    ("tarot-sun", "XIX The Sun", "a child on a white horse under a great sun, sunflowers, St John's wort and calendula, gold and ruby", "Sun: gold, ruby, Shamash/Ra/Surya; St John's wort (photosensitising; strong CYP3A4 inducer)."),
    ("tarot-moon", "XVIII The Moon", "a crescent moon over a path between two towers, a crayfish rising from a pool, willow and white poppies, moonstone", "Moon: silver, pearl/moonstone, Sin/Khonsu/Chandra; willow (salicin) and white poppy are the Moon's herbs in Culpeper."),
    ("tarot-star", "XVII The Star", "a kneeling woman pouring water from two jars under eight stars, blue lotus and chamomile at the pool", "Hope and healing water; blue lotus of Nefertem; chamomile."),
    ("tarot-temperance", "XIV Temperance", "an angel pouring liquid between two cups, an alembic and a still, herbs drying, the alchemical marriage", "Distillation, dose and balance: the dose makes the poison (Paracelsus)."),
    ("tarot-magician", "I The Magician", "a magician at a table with a cup, a wand, a sword and a pentacle, herbs and crystals laid out, infinity sign above", "Mercury: Thoth/Nabu/Budha; the four tools as the four elements of the humours."),
    ("tarot-hierophant", "V The Hierophant", "an elderly Afro-Latina wise woman seated between two pillars holding a sprouting staff and keys, herb bundles and candles", "Phoebe, keeper of the botanica, the teacher of how it all fits."),
    ("tarot-wheel", "X Wheel of Fortune / Tablet of Destinies", "a great wheel inscribed with zodiac signs held by a scribe-god writing on a glowing tablet, seven planets around it", "Nabu and the Tablet of Destinies; the planetary hours."),
    ("tarot-empress", "III The Empress", "a crowned mother goddess seated in a wheat field with pomegranates, roses and a copper mirror, Venus sign", "Venus: copper; Tanit/Astarte/Hathor; rose, raspberry leaf."),
]


# Casting rule (Botanica, operator 2026-10-18): gods are of various races, never split by culture. Skin tone is assigned
# independently of the god's culture; iconographic colours (Budha's green, Shani's dark blue-black) are kept as written.
CASTING = ["(deep brown skin:1.2)", "(olive skin, North African:1.2)", "(dark skin, Nubian:1.2)", "(light brown skin, South Asian:1.2)",
           "(brown skin, Levantine:1.2)", "(dark brown skin, Afro-Latina:1.2)", "(tan skin, Punic Mediterranean:1.2)"]


def cast(key):
    return CASTING[seed_of(key) % len(CASTING)]


SUBJECT_OVERRIDE = {
    "honey": "raw honey dripping from a honeycomb with honeybees and wildflowers, a clay honey pot",
    "triphala-amla": "three Ayurvedic fruits amla haritaki and bibhitaki on their branches, a brass bowl of powder",
    "aloe-vera": "aloe vera plant with a cut leaf showing clear gel",
    "sage": "garden sage and rosemary sprigs, leaves and flowers",
}


def herb_card(h):
    latin = h["latin"].split(" (")[0]
    subj = SUBJECT_OVERRIDE.get(h["id"]) or f"{h['name']} ({latin}) medicinal plant, detailed drawing of leaves flowers and roots"
    facts = {k: h.get(k) for k in ("name", "latin", "traditions", "uses", "compounds", "enzyme_mechanism", "evidence", "evidence_note",
                                   "dose", "warnings", "element_or_dosha", "folk_correspondence", "source_ids")}
    facts["labels"] = [h["name"], h["latin"]] + list(h.get("uses", []))[:3]
    pin = "herbarium-plate" if seed_of(h["id"]) % 2 else "line-watercolor"
    return card(f"herb-{h['id']}", "herb", h["name"], subj, "art-nouveau-botanical", pin, facts, no_people=True)


def gem_card(g):
    subj = f"{g['name']} gemstone, raw crystal and polished cabochon, ancient amulet"
    facts = {k: g.get(k) for k in ("name", "mineral", "traditional_correspondences", "history", "evidence", "safety", "source_ids")}
    facts["labels"] = [g["name"]]
    return card(f"gem-{g['id']}", "gem", g["name"], subj, "glowing-engraving", "crystal-watercolor", facts, no_people=True)


def build(research):
    cards = [herb_card(h) for h in research["herbs"]] + [gem_card(g) for g in research["gems"]]
    for pid, name, metal, gem, day, faces, herbs, scene in PLANETS:
        facts = {"planet": name, "metal": metal, "gem (Navaratna)": gem, "day": day,
                 "faces": dict(zip(["Babylon", "Egypt", "Phoenicia", "Hindu (Navagraha)"], faces)),
                 "herbs (Culpeper rulers)": herbs, "evidence": "tradition (correspondence system)",
                 "casting": "gods are cast across many ethnicities; culture shows in costume and motifs (Botanica casting rule)",
                 "labels": [name, metal, gem, day] + faces}
        cards.append(card(f"planet-{pid}", "god-correspondence", f"{name}: {metal}, {gem}, {day}",
                          f"{'' if 'skinned' in scene else cast(pid) + ' '}{scene}, symbol of the planet {name}", "art-nouveau", "celestial-chart", facts))
    for cid, title, subj, ours, pin, facts in DIAGRAMS:
        extra = {"character": "hathor", "pin_subject": "a single glowing herb sprig surrounded by floating molecule diagrams and constellation lines"} if cid == "hathor-index" else {}
        cards.append(card(f"diagram-{cid}", "diagram", title, subj, ours, pin, facts, **extra))
    for cid, title, subj, note in TAROT:
        cards.append(card(cid, "tarot", title, f"tarot card, {subj}" + ("" if "Afro-Latina" in subj else f", figures {cast(cid)}"), "splendor-solis", "rws-tarot",
                          {"card": title, "meaning": note, "labels": [title]}))
    return cards


if __name__ == "__main__":
    research = json.load(open(os.path.join(HERE, "research.json")))
    cards = build(research)
    meta = {"note": "Labels are NOT in the images (CPU SD renders text badly). overlay_labels lists the words to set over each card later.",
            "registers_source": ".local/research-casino/BOTANICA_ART_DIRECTION.md (locked 2026-09-02) + .local/BOTANICA_PANTHEON_PICKS.md v3 planet layer",
            "ours_styles": OURS, "pinterest_styles": PIN}
    json.dump({**meta, "cards": cards}, open(os.path.join(HERE, "cards.json"), "w"), indent=1, ensure_ascii=False)
    json.dump({"sources": research["sources"], "herbs": research["herbs"], "gems": research["gems"],
               "planets": [c["facts"] for c in cards if c["kind"] == "god-correspondence"],
               "diagrams": [{"id": c["id"], "title": c["title"], **c["facts"]} for c in cards if c["kind"] == "diagram"],
               "corpus_notes": research.get("corpus_notes", [])},
              open(os.path.join(HERE, "facts.json"), "w"), indent=1, ensure_ascii=False)
    print(len(cards), "cards;", sum(len(c["prompts"]) for c in cards), "prompts")


def wiki_draft(research, cards):
    """A MediaWiki draft (same format as site/wiki/seed-articles) — kept here, NOT in seed-articles, until reviewed."""
    src = {s["id"]: s for s in research["sources"]}
    refs = lambda ids: "".join(f'<ref>[{src[i]["url"]} {src[i]["title"]}]</ref>' for i in ids or [] if i in src)
    out = ["'''Herbs, Gems and Gods: How They Go Together''' is the text behind the herbal card set: what each plant does, "
           "the compounds and enzymes behind it, how strong the evidence is, the dose, and what it interacts with; then the "
           "gemstones and planetary gods that old healers used as the memory system around the plants. Evidence is kept in "
           "three honest grades: '''established''', '''traditional with some evidence''', and '''traditional only'''. "
           "Gem and planet correspondences are tradition, not medicine.", "", "== Herbs =="]
    for h in research["herbs"]:
        out += [f"=== {h['name']} (''{h['latin']}'') ===",
                f"* '''Traditions:''' {', '.join(h.get('traditions', []))}",
                f"* '''Used for:''' {'; '.join(h.get('uses', []))}",
                f"* '''Compounds:''' {', '.join(h.get('compounds', []))}",
                f"* '''Mechanism:''' {h.get('enzyme_mechanism', '')}",
                f"* '''Evidence:''' {h.get('evidence', '')}. {h.get('evidence_note', '')}{refs(h.get('source_ids'))}",
                f"* '''Dose:''' {h.get('dose', '')}",
                f"* '''Warnings:''' {'; '.join(h.get('warnings', []))}"]
        if h.get("element_or_dosha"):
            out.append(f"* '''TCM / Ayurveda:''' {h['element_or_dosha']}")
        if h.get("folk_correspondence"):
            out.append(f"* '''Correspondence (tradition):''' {h['folk_correspondence']}")
        out.append("")
    out.append("== Gemstones ==")
    for g in research["gems"]:
        tc = g.get("traditional_correspondences")
        tc = "; ".join(tc) if isinstance(tc, list) else (json.dumps(tc, ensure_ascii=False) if isinstance(tc, dict) else str(tc or ""))
        out += [f"=== {g['name']} ===", f"* '''Mineral:''' {g.get('mineral', '')}", f"* '''Tradition:''' {tc}",
                f"* '''History:''' {g.get('history', '')}{refs(g.get('source_ids'))}", f"* '''Evidence:''' {g.get('evidence', '')}",
                f"* '''Safety:''' {g.get('safety', '') if isinstance(g.get('safety'), str) else '; '.join(g.get('safety') or [])}", ""]
    out += ["== The seven planets ==", '{| class="wikitable"', "! Planet !! Metal !! Gem !! Day !! Babylon !! Egypt !! Phoenicia !! Hindu !! Herbs"]
    for c in cards:
        if c["kind"] == "god-correspondence":
            f = c["facts"]
            out += ["|-", f"| {f['planet']} || {f['metal']} || {f['gem (Navaratna)']} || {f['day']} || " + " || ".join(f["faces"].values()) +
                    f" || {', '.join(f['herbs (Culpeper rulers)'])}"]
    out += ["|}", "", "== Diagrams ==", ""]
    for c in cards:
        if c["kind"] == "diagram":
            out.append(f"* '''{c['title']}''': {c['facts']['teaches']} ''({c['facts']['evidence']})''")
    out += ["", "== References ==", "<references />", ""]
    return "\n".join(out)


if __name__ == "__main__":
    open(os.path.join(HERE, "Herbs_Gems_and_Gods_How_They_Go_Together.wiki"), "w").write(wiki_draft(research, cards))
    print("wiki draft written")
