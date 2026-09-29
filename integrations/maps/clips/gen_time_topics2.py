"""gen_time_topics2.py — writes the stone-tools and languages time-maps (seven clip jobs) and their per-item sources
(../data/stone-tools/citations.json, ../data/languages/citations.json). Re-run after editing a table.

Same rules as gen_time_topics.py: each point is a dated site, text or inscription from the cited literature; route lines
are one current model of spread, not tracks; every date is an estimate; debated, model-based and tradition items are
labelled on screen. Attested languages (inscriptions, tablets) are "record"; reconstructed homelands and dates are
"interpretation" (models), and competing models are both shown.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
NOTE = "Alpha · dates are scholarly estimates with uncertainty · one current model · debated items labelled"
TESTING = "We are testing these features and looking to develop them."


def mk(sub):
    d = os.path.join(HERE, "..", "data", sub); os.makedirs(d, exist_ok=True); return d


def pt(C, label, lat, lon, year, kind, caption, source, zoom=3.0, hold=4):
    C.setdefault(label, source)
    return {"label": label, "lat": lat, "lon": lon, "year": year, "kind": kind, "caption": caption, "source": source, "hold": hold, "zoom": zoom}


def route(label, colour, pts):
    return {"label": label, "colour": colour, "points": [{"label": p[0], "lat": p[1], "lon": p[2], "year": float(p[3])} for p in pts]}


def job(cid, title, subtitle, bbox, years, duration, stops, routes, tags, credit, mode, sources_path):
    stops = sorted(stops, key=lambda s: s["year"])
    to = 0 if mode.get("timeMode") == "ago" else 2100
    end = ("Dates are scholarly estimates with uncertainty; routes are one current model of spread, not tracks. "
           f"Debated and model-based items are labelled. Sources: {sources_path}.")
    return {"id": cid, "fps": 24, "palette": "night", "note": NOTE, "endNote": end, "testing": TESTING, **mode, "title": title,
            "subtitle": subtitle, "bbox": bbox, "years": years, "duration": duration,
            "cities": [{"name": s["label"], "lat": s["lat"], "lon": s["lon"], "from": s["year"], "to": to} for s in stops],
            "routes": routes, "stops": stops, "tags": ["time-mapped"] + tags, "credit": credit + " Base map: Natural Earth (public domain)."}


# ── STONE TOOLS (years ago, log) ───────────────────────────────────────────────────────────────────
S = {}
STONE = [
    pt(S, "Lomekwi 3 (debated)", 3.9, 35.75, -3300000, "debated", "Flaked stones older than Homo — status debated", "Harmand et al. 2015 Nature 521:310; Domínguez-Rodrigo & Alcalá 2016 J Afr Archaeol"),
    pt(S, "Gona: the Oldowan", 11.1, 40.3, -2600000, "record", "The oldest Oldowan choppers and flakes", "Semaw et al. 1997 Nature 385:333"),
    pt(S, "Kokiselei: the first handaxes", 4.0, 35.8, -1760000, "record", "The oldest Acheulean handaxes", "Lepre et al. 2011 Nature 477:82"),
    pt(S, "Attirampakkam, India", 13.2, 79.9, -1510000, "record", "Acheulean handaxes in India ~1.5 Ma", "Pappu et al. 2011 Science 331:1596"),
    pt(S, "The Movius line (debated idea)", 30.0, 90.0, -1000000, "debated", "The old idea that handaxes stop at a line across Asia — now contested", "Movius 1948; Lycett & Bae 2010 World Archaeol 42:521; Hou et al. 2000 Science 287:1622 (Bose)"),
    pt(S, "Boxgrove, Britain", 50.87, -0.7, -500000, "record", "Acheulean handaxes in Europe", "Roberts & Parfitt 1999 Boxgrove (English Heritage)"),
    pt(S, "Levallois / Middle Stone Age", 1.0, 36.0, -300000, "record", "Prepared-core flaking in Africa (Olorgesailie)", "Brooks et al. 2018 Science 360:90; Deino et al. 2018"),
    pt(S, "Mousterian (Neanderthals)", 44.95, 0.94, -160000, "record", "Neanderthal Levallois and scrapers", "Bordes 1961 Typologie du Paléolithique ancien et moyen"),
    pt(S, "Pinnacle Point: microliths & heat treatment", -34.2, 22.09, -71000, "record", "Heat-treated stone and tiny blades", "Brown et al. 2012 Nature 491:590"),
    pt(S, "Aurignacian", 48.4, 10.0, -42000, "record", "Blade industries of the first Europeans", "Higham et al. 2012 J Hum Evol 62:664"),
    pt(S, "Gravettian", 48.9, 16.6, -33000, "record", "Backed blades of the mammoth hunters (Dolní Věstonice)", "Svoboda 2007"),
    pt(S, "Solutrean pressure flaking", 46.3, 4.5, -22000, "record", "Laurel-leaf points by pressure flaking", "Smith 1966 Le Solutréen en France"),
    pt(S, "Clovis", 34.3, -103.3, -13000, "record", "Fluted Clovis points (Blackwater Draw)", "Waters & Stafford 2007 Science 315:1122"),
    pt(S, "Folsom", 36.8, -104.0, -12700, "record", "Fluted Folsom points with bison", "Meltzer 2006 Folsom"),
    pt(S, "Çatalhöyük obsidian", 37.67, 32.83, -9000, "record", "Obsidian from Cappadocia worked in the town", "Carter et al. 2006 J Archaeol Sci 33:893"),
    pt(S, "Melos obsidian at Franchthi", 37.42, 23.13, -13000, "record", "Obsidian carried by sea from Melos", "Renfrew & Aspinall 1990; Perlès 1987"),
    pt(S, "Alpine jadeite axes", 44.7, 7.1, -6500, "record", "Polished jade axes from Monte Viso traded across Europe", "Pétrequin et al. 2012 JADE"),
    pt(S, "Langdale axe factory", 54.45, -3.1, -5700, "record", "Greenstone axes traded all over Britain", "Bradley & Edmonds 1993 Interpreting the Axe Trade"),
    pt(S, "Egyptian quarrying: copper & dolerite", 24.09, 32.89, -4500, "record", "Copper chisels, saws with sand, dolerite pounders (Aswan)", "Stocks 2003 Experiments in Egyptian Archaeology; Klemm & Klemm 2008"),
    pt(S, "Inca stone-working", -13.51, -71.98, -570, "record", "Hammerstones and fitting of ashlar at Sacsayhuamán", "Protzen 1993 Inca Architecture and Construction at Ollantaytambo"),
]
STONE_ROUTES = [
    route("Handaxes out of Africa (one model)", "#c9a86a", [("East Africa", 4.0, 35.8, -1760000), ("Levant ('Ubeidiya)", 32.7, 35.6, -1400000), ("India", 13.2, 79.9, -1300000), ("Europe", 50.87, -0.7, -600000)]),
    route("Obsidian by sea", "#9a7bd8", [("Melos", 36.7, 24.4, -13500), ("Franchthi", 37.42, 23.13, -13000)]),
    route("Obsidian overland", "#b090e8", [("Cappadocia", 38.4, 34.6, -10000), ("Çatalhöyük", 37.67, 32.83, -9000), ("Levant", 32.5, 35.5, -8500)]),
    route("Alpine jade axes", "#70c0a0", [("Monte Viso", 44.7, 7.1, -6500), ("Brittany", 47.6, -3.0, -6300), ("Britain", 51.5, -1.0, -5800)]),
    route("Langdale axe trade", "#a0d060", [("Langdale", 54.45, -3.1, -5700), ("Yorkshire", 54.0, -1.0, -5500), ("Wessex", 51.2, -1.8, -5300)]),
]
S["routes (stone)"] = "Lepre 2011; Bar-Yosef & Goren-Inbar 1993 ('Ubeidiya); Renfrew & Aspinall 1990; Pétrequin 2012; Bradley & Edmonds 1993"

# ── LANGUAGES ───────────────────────────────────────────────────────────────────────────────────────
L = {}
FAM = [
    pt(L, "Indo-European: steppe model", 48.0, 45.0, -5500, "interpretation", "From the Pontic–Caspian steppe ~6,000–5,000 years ago (one model)", "Haak et al. 2015 Nature 522:207; Anthony 2007"),
    pt(L, "Indo-European: Anatolian / hybrid model", 40.0, 44.0, -8100, "interpretation", "Or ~8,000 years ago south of the Caucasus, with a steppe stage (competing model)", "Heggarty et al. 2023 Science 381:eabg0818; Bouckaert et al. 2012 Science 337:957"),
    pt(L, "Afroasiatic (origin debated)", 15.0, 38.0, -10000, "debated", "NE Africa or the Levant — origin and date debated", "Ehret 1995; Militarev 2002; Kitchen et al. 2009 Proc R Soc B 276:2703"),
    pt(L, "Sino-Tibetan", 36.0, 108.0, -5900, "interpretation", "Northern China, with millet farmers ~5,900 years ago (one model)", "Zhang et al. 2019 Nature 569:112; Sagart et al. 2019 PNAS 116:10317"),
    pt(L, "Austronesian: out of Taiwan", 23.7, 121.0, -5200, "interpretation", "Spread from Taiwan ~5,200 years ago", "Gray, Drummond & Greenhill 2009 Science 323:479"),
    pt(L, "Bantu", 6.0, 11.0, -5000, "interpretation", "From the Nigeria–Cameroon borderlands ~5,000 years ago", "Grollemund et al. 2015 PNAS 112:13296; Koile et al. 2022 PNAS 119:e2112853119"),
    pt(L, "Pama-Nyungan", -17.0, 139.0, -5700, "interpretation", "From the Gulf of Carpentaria ~5,700 years ago", "Bouckaert, Bowern & Atkinson 2018 Nat Ecol Evol 2:741"),
    pt(L, "Uto-Aztecan (homeland debated)", 33.0, -111.0, -5000, "debated", "Southwest US or Mesoamerica — debated", "Hill 2001 Am Anthropol 103:913; Merrill 2012 Am Antiq 77:203"),
    pt(L, "Dravidian", 17.0, 78.0, -4500, "interpretation", "~4,500 years ago in South/Central India (one model)", "Kolipakam et al. 2018 R Soc Open Sci 5:171504"),
    pt(L, "Uralic", 57.0, 52.0, -4500, "interpretation", "Upper Volga–Kama ~4,500 years ago (one model)", "Grünthal et al. 2022 Diachronica 39:490"),
    pt(L, "Turkic", 47.0, 104.0, -2100, "interpretation", "Mongolia ~2,100 years ago", "Savelyev & Robbeets 2020 J Lang Evol 5:39"),
    pt(L, "Na-Dene: Apachean to the Southwest", 36.0, -107.0, -600, "record", "Athabaskan speakers reach the Southwest ~AD 1400–1500", "Seymour 2012; Kari & Potter 2010"),
]
FAM_ROUTES = [
    route("Indo-European (steppe model)", "#ff7070", [("Pontic steppe", 48, 45, -5500), ("Central Europe", 50, 15, -4800), ("Anatolia", 39, 33, -4200), ("Urals", 52.6, 60.3, -4000), ("Punjab", 30.5, 75, -3500), ("Iran", 32, 53, -3200)]),
    route("Afroasiatic → Semitic", "#f0c46a", [("NE Africa", 15, 38, -10000), ("Levant", 33, 36, -5750), ("Mesopotamia", 33, 44, -4600), ("Arabia", 22, 45, -3000)]),
    route("Sino-Tibetan", "#ff90b0", [("Yellow River", 36, 108, -5900), ("Tibet", 31, 91, -4000), ("Burma", 21, 96, -3000)]),
    route("Austronesian", "#80d0e0", [("Taiwan", 23.7, 121, -5200), ("Philippines", 14, 121, -4000), ("Borneo", 1, 114, -3500), ("Bismarck Arch.", -4, 152, -3300), ("Fiji", -18, 178.4, -2900)]),
    route("Austronesian to Madagascar", "#60b0c0", [("Borneo", 1, 114, -2000), ("Sumatra", 0, 101, -1800), ("Madagascar", -19, 47, -1300)]),
    route("Bantu", "#c05040", [("Cameroon", 6, 11, -5000), ("Congo", -2, 18, -3500), ("Great Lakes", -2, 33, -3000), ("Zambia", -14, 28, -2000), ("South Africa", -26, 28, -1500)]),
    route("Uralic", "#a0a0ff", [("Volga–Kama", 57, 52, -4500), ("Finland", 62, 25, -3000), ("Carpathian Basin (Hungarian)", 47, 19, -1100)]),
    route("Turkic", "#c0e080", [("Mongolia", 47, 104, -2100), ("Central Asia", 42, 66, -1400), ("Anatolia", 39, 33, -950)]),
    route("Na-Dene", "#d0b0ff", [("Alaska", 64, -150, -3000), ("Yukon", 62, -135, -2000), ("Southwest", 36, -107, -600)]),
    route("Pama-Nyungan", "#e0a060", [("Gulf of Carpentaria", -17, 139, -5700), ("Central Australia", -24, 133, -4500), ("Southwest", -31, 117, -3500)]),
]
L["routes (families)"] = "Haak 2015; Heggarty 2023; Zhang 2019; Gray 2009; Grollemund 2015; Grünthal 2022; Savelyev & Robbeets 2020; Bouckaert 2018"

IE = [
    pt(L, "Anatolian / hybrid homeland (model)", 40.0, 44.0, -8100, "interpretation", "One model: ~8,100 years ago south of the Caucasus", "Heggarty et al. 2023 Science 381:eabg0818"),
    pt(L, "Steppe homeland (model)", 48.0, 45.0, -5500, "interpretation", "One model: Yamnaya-era steppe ~5,500 years ago", "Haak et al. 2015; Anthony 2007"),
    pt(L, "Tocharian (Afanasievo route, model)", 51.0, 86.0, -5000, "interpretation", "An early branch carried east to the Altai", "Anthony 2007; Narasimhan et al. 2019 Science 365:eaat7487"),
    pt(L, "Hittite names at Kanesh", 38.85, 35.63, -3900, "record", "The oldest attested Indo-European words (~1900 BC)", "Kloekhorst 2019 Kanišite Hittite (Brill)"),
    pt(L, "Mitanni Indo-Aryan", 36.8, 40.1, -3380, "record", "Mitra, Varuna, Indra named in a treaty (~1380 BC)", "Mitanni–Hittite treaty (CTH 51); Mayrhofer 1966"),
    pt(L, "Linear B Greek", 35.3, 25.16, -3400, "record", "Mycenaean Greek at Knossos (~1400 BC)", "Ventris & Chadwick 1953 JHS 73:84"),
    pt(L, "Rigveda (oral; date approximate)", 30.5, 75.0, -3400, "tradition", "Composed in the Punjab, written down much later", "Witzel 1995; Jamison & Brereton 2014"),
    pt(L, "Old Persian: Behistun", 34.39, 47.44, -2540, "record", "Darius's inscription (~520 BC)", "Schmitt 1991 The Bisitun Inscriptions"),
    pt(L, "Old Latin: Lapis Niger", 41.89, 12.48, -2570, "record", "Archaic Latin in the Forum (~6th c. BC)", "Coarelli 2007"),
    pt(L, "Gothic Bible", 45.0, 27.0, -1650, "record", "Wulfila's translation (4th c. AD)", "Wright 1954 Grammar of the Gothic Language"),
    pt(L, "Ogham Irish", 52.0, -9.5, -1650, "record", "Primitive Irish on standing stones (4th c. AD)", "McManus 1991 A Guide to Ogam"),
    pt(L, "Armenian alphabet", 40.18, 44.51, -1620, "record", "Mesrop Mashtots's alphabet (AD 405)", "Koriwn, Life of Mashtots"),
    pt(L, "Tocharian texts", 41.7, 82.9, -1400, "record", "Buddhist manuscripts in the Tarim Basin (6th–8th c. AD)", "Adams 2013 A Dictionary of Tocharian B"),
]
IE_ROUTES = [
    route("Corded Ware → Germanic, Balto-Slavic (steppe model)", "#ff7070", [("Pontic steppe", 48, 45, -5500), ("Poland", 52, 19, -4900), ("Baltic", 56, 24, -4500), ("Scandinavia", 58, 12, -4000)]),
    route("Yamnaya → Balkans → Greek, Italic, Celtic (steppe model)", "#ff9070", [("Pontic steppe", 48, 45, -5500), ("Danube", 45, 27, -5000), ("Greece", 37.73, 22.76, -4000), ("Alps", 47, 10, -4000), ("Italy", 42, 12.5, -3500), ("Gaul", 47, 3, -3000)]),
    route("Sintashta → Indo-Iranian", "#f0c46a", [("Pontic steppe", 48, 45, -5000), ("Sintashta", 52.6, 60.3, -4000), ("Bactria", 37, 67, -3800), ("Punjab", 30.5, 75, -3500), ("Iran", 32, 53, -3200)]),
    route("To the Altai and Tarim", "#d0b0ff", [("Pontic steppe", 48, 45, -5300), ("Altai", 51, 86, -5000), ("Tarim", 41.7, 82.9, -4000)]),
    route("Anatolian branch", "#e0a0e0", [("Caucasus (model)", 40, 44, -8100), ("Kanesh", 38.85, 35.63, -3900)]),
]
L["routes (Indo-European)"] = "Haak 2015; Anthony 2007; Heggarty 2023 — both homeland models shown"

SEM = [
    pt(L, "Proto-Semitic (model)", 33.0, 36.5, -3750, "interpretation", "Levant, ~3750 BC (Bayesian phylogeny, one model)", "Kitchen et al. 2009 Proc R Soc B 276:2703"),
    pt(L, "Egyptian: first writing (Abydos U-j)", 26.18, 31.92, -3250, "record", "The first Egyptian signs on labels", "Dreyer 1998 Umm el-Qaab I"),
    pt(L, "Akkadian", 32.5, 44.4, -2600, "record", "Semitic names in Sumerian texts; Sargon's inscriptions ~2350 BC", "Huehnergard 2011 A Grammar of Akkadian"),
    pt(L, "Eblaite", 35.8, 36.8, -2400, "record", "The Ebla archives", "Pettinato 1981 The Archives of Ebla"),
    pt(L, "Ugaritic", 35.6, 35.78, -1400, "record", "A cuneiform alphabet at Ugarit", "Pardee 2012 The Ugaritic Texts and the Origins of West-Semitic Literary Composition"),
    pt(L, "Phoenician: Ahiram", 34.12, 35.65, -1000, "record", "The Ahiram sarcophagus inscription at Byblos", "Rollston 2010 Writing and Literacy in the World of Ancient Israel"),
    pt(L, "Hebrew", 31.86, 34.92, -925, "record", "The Gezer calendar (language debated)", "Rollston 2010"),
    pt(L, "Old Aramaic: Tell Fekheriye", 36.85, 40.05, -850, "record", "Bilingual statue, Akkadian and Aramaic", "Abou-Assaf, Bordreuil & Millard 1982"),
    pt(L, "Old South Arabian", 15.5, 45.3, -800, "record", "Sabaean inscriptions", "Stein 2013; Nebes"),
    pt(L, "Libyco-Berber: Dougga", 36.42, 9.22, -138, "record", "Punic–Libyan bilingual (138 BC)", "Chabot 1940 Recueil des inscriptions libyques"),
    pt(L, "Coptic: the last stage of Egyptian", 25.7, 32.6, 300, "record", "Egyptian written in Greek letters", "Loprieno 1995 Ancient Egyptian"),
    pt(L, "Arabic: the Namara inscription", 32.9, 36.6, 328, "record", "Arabic in Nabataean script", "Macdonald 2000 Arabian Archaeol Epigr 11:28"),
    pt(L, "Ge'ez at Aksum", 14.13, 38.72, 340, "record", "Ezana's inscriptions", "Weninger 2011"),
    pt(L, "Arabic reaches Iberia", 37.88, -4.78, 711, "record", "The Umayyad conquest", "Kennedy 1996 Muslim Spain and Portugal"),
]
SEM_ROUTES = [
    route("Semitic spreads (one model)", "#f0c46a", [("Levant", 33, 36.5, -3750), ("Mesopotamia", 32.5, 44.4, -2600), ("Ebla", 35.8, 36.8, -2400), ("Yemen", 15.5, 45.3, -1000), ("Aksum", 14.13, 38.72, -500)]),
    route("Arabic with Islam", "#8fd07a", [("Hejaz", 24.5, 39.6, 630), ("Damascus", 33.5, 36.3, 640), ("Egypt", 30, 31.2, 642), ("Maghreb", 36, 10, 690), ("Iberia", 37.88, -4.78, 711)]),
]
L["routes (Semitic)"] = "Kitchen 2009 (Semitic phylogeny — one model); historical sources for the Arabic spread"

WR = [
    pt(L, "Proto-cuneiform, Uruk", 31.3, 45.6, -3300, "record", "Accounting tablets become writing", "Nissen, Damerow & Englund 1993 Archaic Bookkeeping"),
    pt(L, "Egyptian hieroglyphs, Abydos", 26.18, 31.92, -3250, "record", "Tomb U-j labels", "Dreyer 1998"),
    pt(L, "Indus script (undeciphered)", 27.33, 68.14, -2600, "record", "Seals from Mohenjo-daro — still undeciphered", "Parpola 1994 Deciphering the Indus Script"),
    pt(L, "Proto-Sinaitic", 29.03, 33.46, -1850, "record", "Alphabet made from hieroglyphs by Semitic workers at Serabit el-Khadim", "Goldwasser 2010 BAR 36:2; Darnell et al. 2005 (Wadi el-Hol)"),
    pt(L, "Linear A / Linear B", 35.3, 25.16, -1800, "record", "Linear A (undeciphered), then Linear B Greek", "Chadwick 1958 The Decipherment of Linear B"),
    pt(L, "Oracle bones, Anyang", 36.1, 114.3, -1250, "record", "The oldest Chinese writing", "Keightley 1978 Sources of Shang History"),
    pt(L, "Phoenician alphabet", 34.12, 35.65, -1050, "record", "The 22-letter alphabet (Ahiram)", "Rollston 2010"),
    pt(L, "Aramaic script", 36.85, 40.05, -850, "record", "Aramaic becomes the empire's script", "Naveh 1982 Early History of the Alphabet"),
    pt(L, "Greek alphabet: Dipylon", 37.98, 23.72, -740, "record", "Vowels added; the Dipylon jug", "Powell 1991 Homer and the Origin of the Greek Alphabet"),
    pt(L, "Zapotec (debated date)", 17.04, -96.77, -600, "debated", "San José Mogote / Monte Albán glyphs", "Marcus 1992 Mesoamerican Writing Systems"),
    pt(L, "Maya: San Bartolo", 17.2, -89.45, -300, "record", "Early Maya glyphs (~300 BC)", "Saturno, Stuart & Beltrán 2006 Science 311:1281"),
    pt(L, "Brahmi: Ashoka's edicts", 25.6, 85.1, -250, "record", "India's first widespread script", "Salomon 1998 Indian Epigraphy"),
]
WR_ROUTES = [
    route("The alphabet's journey", "#f0c46a", [("Serabit el-Khadim", 29.03, 33.46, -1850), ("Byblos", 34.12, 35.65, -1050), ("Athens", 37.98, 23.72, -740), ("Etruria", 42.4, 11.9, -700), ("Rome", 41.89, 12.48, -600)]),
    route("Aramaic → Brahmi (one model)", "#e8a060", [("Byblos", 34.12, 35.65, -1050), ("Syria", 36.85, 40.05, -850), ("Persia", 29.9, 52.9, -500), ("Taxila", 33.75, 72.8, -300), ("Pataliputra", 25.6, 85.1, -250)]),
]
L["routes (writing)"] = "Naveh 1982; Rollston 2010; Salomon 1998 (Aramaic origin of Brahmi is the majority view, debated)"

WORLD = [-180, -58, 180, 78]
SP_S = "integrations/maps/data/stone-tools/SOURCES.md"; SP_L = "integrations/maps/data/languages/SOURCES.md"
JOBS = [
    job("time-stone-tools", "Stone in the Hand: Tools Time-Mapped", "Lomekwi to the pyramids and the Inca · dates are estimates", WORLD, [-3400000, -500], 140, STONE, STONE_ROUTES,
        ["stone-tools", "technology", "deep-time"], "Harmand 2015; Semaw 1997; Lepre 2011; Pappu 2011; Brooks 2018; Brown 2012; Waters 2007; Pétrequin 2012; Stocks 2003; Protzen 1993.", {"timeMode": "ago", "timeScale": "log"}, SP_S),
    job("time-language-families", "Tongues of the World: Language Families", "how the big families spread · homelands are models; competing models shown", WORLD, [-10500, -400], 140, FAM, FAM_ROUTES,
        ["languages"], "Haak 2015; Heggarty 2023; Zhang 2019; Gray 2009; Grollemund 2015; Bouckaert 2018; Kolipakam 2018; Grünthal 2022.", {"timeMode": "ago", "timeScale": "log"}, SP_L),
    job("time-indo-european", "Indo-European: Branch by Branch", "attested texts are record · homelands and routes are models", [-15, 20, 100, 65], [-8500, -1300], 130, IE, IE_ROUTES,
        ["languages", "indo-european"], "Haak 2015; Anthony 2007; Heggarty 2023; Kloekhorst 2019; Ventris & Chadwick 1953.", {"timeMode": "ago"}, SP_L),
    job("time-semitic", "Semitic and Afroasiatic Tongues", "c. 3750 BC – AD 711 · inscriptions are record", [-12, 5, 65, 45], [-3900, 750], 110, SEM, SEM_ROUTES,
        ["languages", "semitic", "afroasiatic"], "Kitchen 2009; Huehnergard 2011; Rollston 2010; Pardee 2012; Macdonald 2000.", {}, SP_L),
    job("time-writing", "Writing Systems: Time-Mapped", "c. 3300 BC onward · where writing began and how the alphabet travelled", WORLD, [-3400, 0], 110, WR, WR_ROUTES,
        ["languages", "writing"], "Nissen 1993; Dreyer 1998; Parpola 1994; Goldwasser 2010; Keightley 1978; Naveh 1982; Saturno 2006; Salomon 1998.", {}, SP_L),
]
for j in JOBS:
    json.dump(j, open(os.path.join(HERE, f"{j['id']}.json"), "w"), indent=1, ensure_ascii=False)


def sources(d, title, items, groups):
    json.dump({"note": "one current model; dates approximate", "items": items}, open(os.path.join(d, "citations.json"), "w"), indent=1, ensure_ascii=False)
    out = [f"# {title} — sources (Alpha)\n", "Generated by `integrations/maps/clips/gen_time_topics2.py` (the per-item source table). Nothing is copied from a published map. "
           "Attested texts and dated sites are **record**; homelands, dates from phylogenies and route lines are **models**; competing models are both shown. "
           "Every date is an estimate with uncertainty.\n"]
    for g, rows in groups:
        out.append(f"## {g}\n")
        for s in rows:
            tag = {"debated": " — **debated**", "interpretation": " — **model**", "tradition": " — **tradition**"}.get(s["kind"], "")
            out.append(f"- **{s['label']}**{tag}: {s['source']}")
        out.append("")
    out.append("## Routes\n"); out += [f"- {k}: {v}" for k, v in items.items() if k.startswith("routes")]
    open(os.path.join(d, "SOURCES.md"), "w").write("\n".join(out) + "\n")


sources(mk("stone-tools"), "Stone tools", S, [("Stone tools", STONE)])
sources(mk("languages"), "Languages and writing", L, [("Language families", FAM), ("Indo-European", IE), ("Semitic and Afroasiatic", SEM), ("Writing systems", WR)])
print(len(JOBS), "jobs;", len(S) + len(L), "cited items")
