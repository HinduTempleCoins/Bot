"""gen_time_topics3.py — five time-mapped clips that go with the deep-ancestry wiki articles:
domestication, Denisovans, colour genetics, temple elites & ritual killing, and virus spillover/spillback.
Same schema and conventions as gen_time_topics.py (points = dated sites/texts from the cited literature; routes =
one current model, not tracks; debated/model items labelled). Writes clips/time-*.json and
../data/time-topics3/citations.json. Re-run after editing a table.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "time-topics3")
os.makedirs(OUT, exist_ok=True)
NOTE = "Alpha · dates are scholarly estimates with uncertainty · one current model · debated items labelled"
END = ("Dates are scholarly estimates with uncertainty; routes are one current model, not tracks. Debated and "
       "model-based items are labelled. Sources: integrations/maps/data/time-topics3/citations.json and the wiki articles.")
TESTING = "We are testing these features and looking to develop them."
CITES = {}


def pt(label, lat, lon, year, kind, caption, source, zoom=3.0, hold=4):
    CITES.setdefault(label, source)
    return {"label": label, "lat": lat, "lon": lon, "year": year, "kind": kind, "caption": caption, "source": source, "hold": hold, "zoom": zoom}


def city(s, to):
    return {"name": s["label"], "lat": s["lat"], "lon": s["lon"], "from": s["year"], "to": to}


def route(label, colour, pts):
    return {"label": label, "colour": colour, "points": [{"label": p[0], "lat": p[1], "lon": p[2], "year": float(p[3])} for p in pts]}


# ── DOMESTICATION (calendar years) ─────────────────────────────────────────────────────────────────
DOM = [
    pt("Bonn-Oberkassel: the dog", 50.72, 7.17, -12200, "record", "Dog buried with people ~14,200 years ago — before farming", "Janssens et al. 2018; Bergström et al. 2022 Nature 607"),
    pt("Gilgal: seedless figs", 31.99, 35.45, -9400, "record", "Parthenocarpic figs planted from cuttings", "Kislev et al. 2006 Science 312:1372"),
    pt("Karacadağ: einkorn wheat", 37.75, 39.8, -8700, "record", "Domestic einkorn traces to these hills", "Heun et al. 1997 Science 278:1312"),
    pt("Zagros: goats and sheep", 34.5, 47.0, -8500, "record", "Herding of goat and sheep", "Zeder & Hesse 2000 Science 287:2254"),
    pt("Near East: cattle", 36.5, 38.5, -8500, "record", "Taurine cattle from a tiny aurochs herd", "Bollongino et al. 2012 MBE 29:2101"),
    pt("Balsas valley: squash, then maize", 18.3, -99.5, -7000, "record", "Maize bred from teosinte", "Piperno et al. 2009 PNAS 106:5019; Matsuoka et al. 2002 PNAS 99:6080"),
    pt("Yellow River: millet", 35.0, 113.0, -7000, "record", "Foxtail and broomcorn millet", "Lu et al. 2009 PNAS 106:7367"),
    pt("Shillourokambos: the cat", 34.66, 33.3, -7500, "record", "Cat buried with a person", "Vigne et al. 2004 Science 304:259"),
    pt("Andes: potato, llama", -15.8, -70.0, -6000, "record", "Potato, quinoa; llama and alpaca", "Spooner et al. 2005 PNAS 102:14694"),
    pt("Indus: zebu cattle", 29.4, 67.6, -6500, "record", "Humped zebu at Mehrgarh", "Meadow 1996; Chen et al. 2010 MBE 27:1"),
    pt("Yangtze: rice", 30.0, 120.0, -6000, "record", "Rice cultivation, fully domestic by ~5000 BC", "Fuller et al. 2009 Science 323:1607"),
    pt("Kuk Swamp: taro and banana", -5.78, 144.33, -5000, "record", "Early gardens in New Guinea", "Denham et al. 2003 Science 301:189"),
    pt("Tian Shan: the apple", 43.0, 77.0, -4000, "interpretation", "Malus sieversii — ancestor of the apple (spread along trade routes)", "Cornille et al. 2014 Trends Genet 30:57"),
    pt("Sahel: sorghum, pearl millet", 15.0, 0.0, -2500, "record", "African crops", "Fuller & Hildebrand 2013"),
    pt("Hayden site: sunflower", 36.0, -85.0, -2300, "record", "Domestic sunflower in eastern North America", "Smith 2006 PNAS 103:12223"),
    pt("Lower Volga–Don: the horse (DOM2)", 49.0, 44.0, -2200, "record", "Modern horse lineage spreads", "Librado et al. 2021 Nature 598:634"),
    pt("Thailand: the chicken", 16.0, 101.0, -1500, "record", "Red junglefowl → chicken", "Peters et al. 2022 PNAS 119:e2121978119"),
]
DOM_ROUTES = [
    route("Farming into Europe with Anatolian farmers", "#f0c46a", [("Anatolia", 38, 32, -6800), ("Greece", 40, 22, -6500), ("Danube", 45, 20, -5700), ("Rhine", 50, 8, -5300), ("Britain", 52, -1, -4000)]),
    route("Maize spreads north and south (model)", "#80d0e0", [("Balsas", 18.3, -99.5, -7000), ("Southwest US", 34, -109, -2100), ("Andes", -13, -72, -4000)]),
]

# ── DENISOVANS (years ago) ─────────────────────────────────────────────────────────────────────────
DEN = [
    pt("Flores: tools across the sea", -8.6, 121.1, -1000000, "record", "Hominins reach Flores across open water", "Brumm et al. 2010 Nature 464:748"),
    pt("Luzon: butchered rhino", 17.4, 121.4, -709000, "record", "Hominins on Luzon ~709,000 years ago", "Ingicco et al. 2018 Nature 557:233"),
    pt("Denisova Cave", 51.4, 84.68, -300000, "record", "Used by Denisovans and Neanderthals over ~300,000 years", "Jacobs et al. 2019 Nature 565:594"),
    pt("Baishiya Karst Cave (Xiahe jaw)", 35.45, 102.57, -160000, "record", "Denisovan jaw on the Tibetan Plateau", "Chen et al. 2019 Nature 569:409"),
    pt("Harbin cranium", 45.75, 126.65, -146000, "record", "A Denisovan face (proteins + mtDNA)", "Fu et al. 2025"),
    pt("Cobra Cave, Laos (tooth)", 20.2, 103.4, -150000, "debated", "Denisovan-like molar", "Demeter et al. 2022 Nat Commun 13:2557"),
    pt("Penghu, Taiwan (jaw)", 23.5, 119.6, -130000, "record", "Denisovan jaw from the sea floor", "Tsutaya et al. 2025 Science"),
    pt("Sulawesi: tools", -4.0, 120.0, -118000, "record", "Hominins on Sulawesi", "van den Bergh et al. 2016 Nature 529:208"),
    pt("Denisova 11: Neanderthal × Denisovan girl", 51.4, 84.68, -90000, "record", "First-generation hybrid", "Slon et al. 2018 Nature 561:113"),
    pt("Sahul: modern humans arrive", -12.5, 132.9, -50000, "record", "By ≥50,000 years ago (65,000 at Madjedbebe debated)", "O'Connell et al. 2018 PNAS 115:8482; Clarkson et al. 2017"),
    pt("Papua: highest Denisovan ancestry today", -6.0, 145.0, -46000, "record", "A few percent of the genome; several admixture pulses", "Jacobs et al. 2019 Cell 177:1010"),
    pt("Tibet: EPAS1 altitude gene", 29.65, 91.1, -40000, "record", "Denisovan version of EPAS1 helps at altitude", "Huerta-Sánchez et al. 2014 Nature 512:194"),
]
DEN_ROUTES = [
    route("Across the Wallace Line (model)", "#e8a060", [("Sunda", 0, 110, -60000), ("Sulawesi", -4, 120, -55000), ("Timor", -9, 125, -52000), ("Sahul", -12.5, 132.9, -50000)]),
]

# ── COLOUR GENETICS (years ago) ────────────────────────────────────────────────────────────────────
COL = [
    pt("Africa: ancient light and dark variants", 0.0, 30.0, -900000, "record", "Many pigmentation variants arose in Africa, some before Homo sapiens", "Crawford et al. 2017 Science 358:eaan8433"),
    pt("Neanderthal MC1R variant", 42.0, 3.0, -50000, "record", "Some Neanderthals: pale skin, possibly red hair", "Lalueza-Fox et al. 2007 Science 318:1453"),
    pt("Afontova Gora: first blonde variant", 56.0, 92.8, -17000, "record", "Earliest known KITLG blonde allele", "Mathieson et al. 2018 (ANE Afontova Gora 3)"),
    pt("Cheddar Man: dark skin, blue eyes", 51.28, -2.77, -10000, "record", "Western hunter-gatherer colouring", "Brace et al. 2019 Nat Ecol Evol 3:765"),
    pt("Blue-eye founder (HERC2)", 45.0, 30.0, -8000, "interpretation", "One ancestor, ~6,000–10,000 years ago", "Eiberg et al. 2008 Hum Genet 123:177"),
    pt("SLC24A5 light-skin allele spreads", 45.0, 20.0, -7000, "record", "Rises with Anatolian farmers and steppe herders under selection", "Mathieson et al. 2015 Nature 528:499"),
    pt("East Asia: OCA2 light skin (independent)", 35.0, 115.0, -10000, "interpretation", "A different route to lighter skin", "Edwards et al. 2010 PLoS Genet 6:e1000867"),
    pt("Solomon Islands: TYRP1 blondness", -9.4, 160.0, -3000, "record", "Blondness evolved again, separately", "Kenny et al. 2012 Science 336:554"),
    pt("Scotland & Ireland: red-hair peak", 56.5, -4.5, -1000, "record", "Highest MC1R red-hair frequencies today", "MC1R population surveys"),
]

# ── TEMPLE ELITES & RITUAL KILLING (calendar years) ────────────────────────────────────────────────
TEM = [
    pt("Göbekli Tepe", 37.22, 38.92, -9500, "record", "Earliest known monumental temple", "Dietrich et al. 2012 Documenta Praehistorica 39"),
    pt("Ur: royal death pits", 30.96, 46.1, -2600, "record", "Attendants killed and buried with rulers", "Baadsgaard et al. 2011 Antiquity 85:27"),
    pt("Newgrange: incest in the elite", 53.69, -6.48, -3200, "record", "NG10 — child of first-degree incest", "Cassidy et al. 2020 Nature 582:384"),
    pt("Amarna: Tutankhamun's parents siblings", 27.65, 30.9, -1330, "record", "Royal sibling marriage and its cost", "Hawass et al. 2010 JAMA 303:638"),
    pt("Anyang: Shang sacrifices", 36.12, 114.3, -1200, "record", "Thousands of sacrificial victims", "Shang oracle bones; Anyang excavations"),
    pt("Carthage: the Tophet (debated)", 36.84, 10.32, -700, "debated", "Child sacrifice or infant cemetery?", "Smith et al. 2011 Antiquity 85; Schwartz et al. 2010 PLoS ONE"),
    pt("Tollund Man", 56.15, 9.5, -400, "record", "Hanged, laid in the bog", "Glob 1965"),
    pt("Clonycavan & Old Croghan", 53.4, -7.3, -300, "interpretation", "Kings sacrificed on boundaries (Kelly)", "Kelly 2006 Kingship and Sacrifice"),
    pt("Alexandria: Ptolemaic sibling marriage", 31.2, 29.9, -275, "record", "Ptolemy II marries Arsinoe II", "Ptolemaic sources"),
    pt("Lindow Man: the triple death", 53.33, -2.27, 50, "record", "Struck, garrotted, throat cut", "Stead et al. 1986"),
    pt("Hawaii: nīʻaupiʻo chiefs", 19.6, -155.5, 1400, "record", "Highest rank from sibling unions", "Kamakau; Kirch 2010"),
    pt("Cusco: the Inca coya", -13.53, -71.97, 1470, "record", "Sapa Inca marries his sister", "Garcilaso de la Vega; Guaman Poma"),
    pt("Llullaillaco: capacocha children", -24.72, -68.54, 1500, "record", "Mountain-top child sacrifice", "Wilson et al. 2013 PNAS 110:13322"),
    pt("Tenochtitlan: tzompantli", 19.43, -99.13, 1486, "record", "Skull racks at the Templo Mayor", "INAH excavations 2015–"),
]

# ── VIRUS SPILLOVER & SPILLBACK (calendar years) ───────────────────────────────────────────────────
VIR = [
    pt("Uganda: West Nile virus identified", 3.0, 31.0, 1937, "record", "Birds → mosquitoes → people and horses (dead-end hosts)", "Smithburn et al. 1940"),
    pt("Malaysia: Nipah (bats → pigs → people)", 2.5, 101.8, 1998, "record", "Pig farms amplify a bat virus", "Chua et al. 2000 Science 288:1432"),
    pt("New York: West Nile reaches the Americas", 40.7, -73.9, 1999, "record", "Spread coast to coast via birds", "Lanciotti et al. 1999 Science 286:2333"),
    pt("Australia: Hendra (bats → horses)", -27.47, 153.03, 1994, "record", "Horses bridge a bat virus to people", "Murray et al. 1995 Science 268:94"),
    pt("Guangdong: SARS (bats → civets)", 23.1, 113.3, 2002, "record", "Civets in markets carry a bat virus", "Guan et al. 2003 Science 302:276"),
    pt("Arabia: MERS (camels)", 24.7, 46.7, 2012, "record", "Dromedary camels carry MERS", "Azhar et al. 2014 NEJM 370:2499"),
    pt("Wuhan: SARS-CoV-2", 30.6, 114.3, 2019, "record", "Closest relatives in horseshoe bats; intermediate unconfirmed", "Worobey et al. 2022 Science 377:951"),
    pt("Bronx Zoo: tigers infected by a keeper", 40.85, -73.88, 2020, "record", "Human → big cats", "McAloose et al. 2020 mBio 11:e02220-20"),
    pt("Denmark: mink spillback", 56.0, 9.5, 2020, "record", "Human → mink → human, with new mutations; ~17 million mink culled", "Oude Munnink et al. 2021 Science 371:172"),
    pt("North America: deer reservoir", 43.0, -84.0, 2021, "record", "White-tailed deer carry lineages lost in humans", "Pickering et al. 2022 Nat Microbiol 7:2011"),
    pt("Texas: H5N1 in dairy cattle", 35.2, -101.8, 2024, "record", "Bird flu jumps into cows", "USDA 2024; Caserta et al. 2024 Nature"),
]
VIR_ROUTES = [
    route("West Nile across the Americas (birds)", "#80d0e0", [("New York", 40.7, -73.9, 1999), ("Florida", 27.9, -82.5, 2001), ("Texas", 31, -97, 2002), ("California", 34, -118, 2004)]),
    route("Spillback: human → mink → human", "#ff8080", [("People", 55.7, 12.6, 2020.3), ("Mink farms", 56.0, 9.5, 2020.6), ("People (Cluster 5)", 57.0, 10.0, 2020.9)]),
]

COL_ROUTES = [
    route("SLC24A5 light-skin allele with farmers and herders (model)", "#f0c46a", [("Anatolia", 38, 32, -8500), ("Balkans", 43, 22, -7800), ("Central Europe", 49, 12, -7000), ("Britain", 52, -1, -5500)]),
]
TEM_ROUTES = [
    route("Bog offerings across northern Europe", "#a0d080", [("Jutland", 56.15, 9.5, -400), ("Ireland", 53.4, -7.3, -300), ("Netherlands", 52.9, 6.8, 0), ("England", 53.33, -2.27, 50)]),
]


def bc_to_ago(stops, routes, offset=2000):
    """Calendar year -> years before ~AD 2000, so pre-4000 BC topics can use the 'ago' axis."""
    st = [{**s, "year": int(s["year"]) - offset} for s in stops]
    rt = [{**r, "points": [{**p, "year": float(p["year"]) - offset} for p in r["points"]]} for r in routes]
    return st, rt


DOM_A, DOM_ROUTES_A = bc_to_ago(DOM, DOM_ROUTES)
TEM_A, TEM_ROUTES_A = bc_to_ago(TEM, TEM_ROUTES)

BASE = {"fps": 24, "palette": "night", "note": NOTE, "endNote": END, "testing": TESTING}
AGO = {"timeMode": "ago", "timeScale": "log"}
WORLD = [-180, -58, 180, 78]


def job(cid, title, subtitle, bbox, years, duration, stops, routes, tags, credit, to, mode):
    stops = sorted(stops, key=lambda s: s["year"])
    return {"id": cid, **BASE, **mode, "title": title, "subtitle": subtitle, "bbox": bbox, "years": years, "duration": duration,
            "cities": [city(s, to) for s in stops], "routes": routes, "stops": stops, "tags": ["time-mapped"] + tags,
            "credit": credit + " Base map: Natural Earth (public domain)."}


JOBS = [
    job("time-domestication", "Domestication: Time-Mapped", "plants and animals bred into food, ~12,000 BC onward · many independent centres", WORLD, [-14500, -3400], 130, DOM_A, DOM_ROUTES_A,
        ["domestication", "farming", "plants", "animals"], "Larson 2014; Heun 1997; Kislev 2006; Piperno 2009; Bergström 2022; Librado 2021; Peters 2022.", 0, {"timeMode": "ago"}),
    job("time-denisovans-sea", "Denisovans and the Sea Crossings", "fossils, water crossings and Denisovan DNA today · dates are estimates", [60, -45, 180, 60], [-1100000, -38000], 120, DEN, DEN_ROUTES,
        ["denisovan", "deep-time", "ancestry"], "Chen 2019; Jacobs 2019; Slon 2018; Ingicco 2018; Tsutaya 2025; Fu 2025; Huerta-Sánchez 2014.", 0, AGO),
    job("time-colour-genetics", "Skin, Hair and Eye Colour: Time-Mapped", "when and where the colour variants appear · several independent origins", WORLD, [-1000000, -800], 110, COL, COL_ROUTES,
        ["genetics", "pigmentation", "ancestry"], "Crawford 2017; Mathieson 2015/2018; Brace 2019; Eiberg 2008; Kenny 2012; Edwards 2010; Lalueza-Fox 2007.", 0, AGO),
    job("time-temple-elites", "Temple Elites and Ritual Killing: Time-Mapped", "royal inbreeding and sacrifice across the ancient world", WORLD, [-11800, -400], 130, TEM_A, TEM_ROUTES_A,
        ["temples", "elites", "inbreeding", "sacrifice"], "Cassidy 2020; Hawass 2010; Baadsgaard 2011; Wilson 2013; Kelly 2006; Glob 1965.", 0, {"timeMode": "ago"}),
    job("time-virus-spillover", "Viruses Between Species: Spillover and Spillback", "from bats, birds, camels and mink into people — and back", WORLD, [1930, 2025], 100, VIR, VIR_ROUTES,
        ["virology", "zoonosis", "genetics"], "Oude Munnink 2021; McAloose 2020; Pickering 2022; Chua 2000; Guan 2003; Azhar 2014; Worobey 2022.", 2026, {}),
]
if __name__ == "__main__":
    for j in JOBS:
        json.dump(j, open(os.path.join(HERE, f"{j['id']}.json"), "w"), indent=1, ensure_ascii=False)
    json.dump({"note": "one current model; dates approximate", "items": CITES}, open(os.path.join(OUT, "citations.json"), "w"), indent=1, ensure_ascii=False)
    print(len(JOBS), "jobs;", len(CITES), "cited items")
