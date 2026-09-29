"""gen_deep_time.py — writes the deep-time map data (../data/deep-time/: GeoJSON ranges, route CSVs, citations.json)
and the seven clip jobs (deep-*.json) from the tables below. Re-run after editing a table.

Time mode "ago": every year is -(years before present). Outlines are SCHEMATIC envelopes around the dated sites,
not surveyed ranges; route lines are one current model of dispersal, not tracks. Every item carries its source
(citations.json, SOURCES.md). Debated and model-based items are labelled on screen.
"""
import csv, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "deep-time")
os.makedirs(os.path.join(OUT, "ydna"), exist_ok=True); os.makedirs(os.path.join(OUT, "mtdna"), exist_ok=True)
REL = "../data/deep-time"
NOTE = "Alpha · ranges and dates are scholarly estimates with wide uncertainty · outlines schematic · one current model"
END = ("Ranges, routes and dates are scholarly estimates with uncertainty — one current model, not settled fact. "
       "Debated and model-based items are labelled. Full per-item sources: integrations/maps/data/deep-time/SOURCES.md.")
CITES = {}


def poly(name, frm, to, colour, ring, src):
    CITES[name] = src
    return {"type": "Feature", "properties": {"name": name, "fromYear": frm, "toYear": to, "colour": colour},
            "geometry": {"type": "Polygon", "coordinates": [[[lo, la] for la, lo in ring] + [[ring[0][1], ring[0][0]]]]}}


def site(name, lat, lon, frm, to=0, src=""):
    CITES[name] = src
    return {"name": name, "lat": lat, "lon": lon, "from": frm, "to": to}


# ── ranges (lat, lon rings; schematic) ─────────────────────────────────────────────────────────────
NEA_EARLY = [(43.5, -9), (44, 0), (47, 6), (50, 12), (46, 20), (41, 23), (38, 16), (37, -6)]
NEA_MAIN = [(36.5, -9.5), (43.5, -9.5), (48, -4), (52, 0), (53, 10), (52, 22), (50, 32), (46, 42), (43, 47), (38, 48),
            (33, 47), (31, 36), (33, 34), (36.5, 28), (38, 16), (37, 5)]
NEA_EAST = [(43, 47), (42, 56), (38, 66), (40, 71), (45, 70), (52, 80), (53, 87), (50, 88), (48, 80), (41, 60)]
NEA_LATE = [(36.5, -9.5), (43.5, -9.5), (48, -4), (51, 4), (50, 16), (46, 18), (44, 12), (41, 3), (37, -2)]
NEA_SRC = ("Arsuaga et al. 2014 Science 344:1358; Meyer et al. 2016 Nature 531:504; Prüfer et al. 2014 Nature 505:43; "
           "Mafessoni et al. 2020 PNAS 117:15132; Higham et al. 2014 Nature 512:306")
DEN_ALTAI = [(49.5, 81), (53, 81), (53, 88), (49.5, 88)]
DEN_EAST = [(52, 84), (50, 100), (48, 128), (42, 131), (34, 122), (22, 121), (18, 106), (19, 100), (28, 97), (34, 98), (40, 88), (47, 84)]
DEN_INFER = [(20, 94), (22, 110), (18, 122), (6, 127), (-2, 142), (-8, 151), (-12, 146), (-10, 132), (-9, 118), (-8, 105), (2, 97), (10, 97)]
DEN_SRC = ("Reich et al. 2010 Nature 468:1053; Meyer et al. 2012 Science 338:222; Slon et al. 2018 Nature 561:113; "
           "Douka et al. 2019 Nature 565:640; Chen et al. 2019 Nature 569:409; Zhang et al. 2020 Science 370:584; "
           "Jacobs et al. 2019 Cell 177:1010; Larena et al. 2021 Curr Biol 31:4219; Demeter et al. 2022 Nat Commun 13:2557")
SAP_AFR = [(35, -10), (33, 10), (32, 32), (22, 37), (12, 44), (11, 51), (-2, 41), (-12, 40), (-26, 33), (-35, 20), (-30, 15),
           (-12, 13), (4, 9), (5, -5), (10, -17), (21, -17), (28, -13)]
SAP_LEV = [(30, 34), (36, 35.5), (37, 40), (33, 44), (29, 36)]
SAP_SASIA = [(12, 43), (17, 55), (24, 58), (26, 64), (34, 70), (33, 78), (27, 91), (22, 99), (12, 99), (1, 104), (-6, 105),
             (-8, 118), (5, 119), (8, 80), (22, 60), (16, 42)]
SAP_SAHUL = [(-10.5, 131), (-11, 142), (-6, 147), (-2, 141), (-8, 150), (-18, 146), (-28, 153), (-38, 146), (-35, 117), (-22, 114), (-14, 126)]
SAP_EUR = [(36.5, -9.5), (44, -9), (54, -3), (60, 10), (65, 28), (64, 50), (56, 60), (46, 50), (41, 44), (37, 36), (38, 24), (37, 10)]
SAP_NASIA = [(40, 55), (58, 60), (68, 70), (72, 125), (68, 160), (62, 175), (43, 132), (30, 122), (25, 110), (30, 90), (40, 72)]
SAP_AMER = [(66, -168), (70, -140), (70, -90), (60, -65), (45, -55), (30, -80), (10, -60), (0, -35), (-35, -55), (-55, -68),
            (-45, -75), (-15, -77), (5, -80), (18, -106), (35, -121), (50, -128), (60, -150)]
SAP_SRC = ("Hublin et al. 2017 Nature 546:289; Richter et al. 2017 Nature 546:293; Vidal et al. 2022 Nature 601:579; "
           "Clarkson et al. 2017 Nature 547:306; O'Connell et al. 2018 PNAS 115:8482; Hublin et al. 2020 Nature 581:299; "
           "Fu et al. 2014 Nature 514:445; Bennett et al. 2021 Science 373:1528; Dillehay et al. 2015 PLOS ONE 10:e0141923")

NEANDERTHAL_SITES = [
    site("Sima de los Huesos (early lineage)", 42.35, -3.52, -430000, 0, "Arsuaga et al. 2014; Meyer et al. 2016 (nuclear DNA, early Neanderthal lineage)"),
    site("Krapina", 46.17, 15.87, -130000, 0, "Rink et al. 1995 J Archaeol Sci 22:365 (ESR ~130 ka)"),
    site("Denisova Cave (Neanderthals)", 51.40, 84.68, -190000, 0, "Jacobs et al. 2019 Nature 565:594; Prüfer et al. 2014 (Altai Neanderthal)"),
    site("Shanidar", 36.83, 44.22, -75000, 0, "Pomeroy et al. 2020 Antiquity 94:11 (Shanidar Z ~75 ka)"),
    site("Chagyrskaya", 51.44, 83.15, -59000, 0, "Mafessoni et al. 2020 PNAS 117:15132 (~60–80 ka)"),
    site("Vindija", 46.30, 16.08, -52000, 0, "Prüfer et al. 2017 Science 358:655"),
    site("La Ferrassie", 44.95, 0.94, -54000, 0, "Guérin et al. 2015 J Hum Evol 82:124"),
    site("Kebara", 32.56, 34.94, -60000, 0, "Valladas et al. 1987 Nature 330:159"),
    site("Neander Valley (Feldhofer)", 51.23, 6.95, -42000, 0, "Schmitz et al. 2002 PNAS 99:13342 (~40 ka)"),
    site("Gibraltar (Gorham's, Forbes')", 36.12, -5.34, -45000, 0, "Finlayson et al. 2006 Nature 443:850 (late dates, debated); Higham et al. 2014"),
]
DENISOVAN_SITES = [
    site("Denisova Cave", 51.40, 84.68, -200000, 0, "Douka et al. 2019 Nature 565:640 (Denisovans ~200–50 ka)"),
    site("Baishiya Karst Cave (Xiahe)", 35.45, 102.57, -160000, 0, "Chen et al. 2019 Nature 569:409 (≥160 ka); Zhang et al. 2020 Science 370:584; Xia et al. 2024 Nature 632:108"),
    site("Harbin cranium", 45.75, 126.6, -146000, 0, "Ji et al. 2021 The Innovation 2:100132; Fu et al. 2025 Science/Cell (Denisovan proteins/mtDNA)"),
    site("Cobra Cave, Laos (probable)", 20.2, 102.9, -164000, 0, "Demeter et al. 2022 Nat Commun 13:2557 (tooth 164–131 ka, probably Denisovan)"),
    site("Penghu mandible (date uncertain)", 23.5, 119.5, -130000, 0, "Tsutaya et al. 2025 Science 388:176 (Denisovan by ancient proteins)"),
]
SAPIENS_SITES = [
    site("Jebel Irhoud", 31.86, -8.87, -315000, 0, "Hublin et al. 2017; Richter et al. 2017 (~315 ± 34 ka)"),
    site("Florisbad", -28.77, 26.07, -259000, 0, "Grün et al. 1996 Nature 382:500"),
    site("Omo Kibish", 5.4, 35.9, -233000, 0, "Vidal et al. 2022 Nature 601:579 (Omo I ≥233 ka)"),
    site("Apidima (debated)", 36.66, 22.38, -210000, 0, "Harvati et al. 2019 Nature 571:500 (debated)"),
    site("Misliya (debated)", 32.72, 34.97, -185000, 0, "Hershkovitz et al. 2018 Science 359:456 (177–194 ka)"),
    site("Herto", 10.3, 40.5, -160000, 0, "White et al. 2003 Nature 423:742"),
    site("Pinnacle Point (MSA)", -34.2, 22.09, -164000, 0, "Marean et al. 2007 Nature 449:905"),
    site("Skhul & Qafzeh", 32.6, 35.0, -120000, 0, "Grün et al. 2005 J Hum Evol 49:316"),
    site("Blombos Cave (MSA)", -34.41, 21.22, -100000, 0, "Henshilwood et al. 2011 Science 334:219"),
    site("Madjedbebe (65 ka debated)", -12.5, 132.9, -65000, 0, "Clarkson et al. 2017 (65 ± 6 ka) vs O'Connell et al. 2018 (~50 ka)"),
    site("Bacho Kiro", 42.95, 25.43, -46000, 0, "Hublin et al. 2020 Nature 581:299"),
    site("Ust'-Ishim", 57.7, 71.2, -45000, 0, "Fu et al. 2014 Nature 514:445"),
    site("Tianyuan", 39.65, 115.9, -40000, 0, "Fu et al. 2013 PNAS 110:2223"),
    site("Yana RHS", 70.7, 135.4, -32000, 0, "Pitulko et al. 2004 Science 303:52; Sikora et al. 2019 Nature 570:182"),
    site("White Sands (debated)", 32.8, -106.3, -23000, 0, "Bennett et al. 2021; Pigati et al. 2023 Science 382:73 (debated)"),
    site("Monte Verde", -41.5, -73.2, -14500, 0, "Dillehay et al. 2015"),
    site("Lapita: Fiji / Tonga", -18.0, 178.4, -2900, 0, "Kirch 2017 On the Road of the Winds; Petchey et al."),
    site("Hawai'i", 20.0, -155.5, -900, 0, "Wilmshurst et al. 2011 PNAS 108:1815"),
    site("Rapa Nui", -27.1, -109.4, -800, 0, "Wilmshurst et al. 2011"),
    site("Aotearoa New Zealand", -41.3, 174.0, -750, 0, "Wilmshurst et al. 2011"),
]


def fc(feats):
    return {"type": "FeatureCollection", "features": feats}


def dump(name, obj):
    json.dump(obj, open(os.path.join(OUT, name), "w"), indent=1, ensure_ascii=False)


NEA = [poly("Early Neanderthal lineage", -430000, -250000, "#c98a4a", NEA_EARLY, NEA_SRC),
       poly("Neanderthals", -250000, -45000, "#c98a4a", NEA_MAIN, NEA_SRC),
       poly("Neanderthals (Central Asia & Altai, intermittent)", -190000, -45000, "#c98a4a", NEA_EAST, NEA_SRC),
       poly("Last Neanderthals", -45000, -39000, "#c98a4a", NEA_LATE, NEA_SRC)]
DEN = [poly("Denisovans (Altai)", -200000, -50000, "#6aa0d8", DEN_ALTAI, DEN_SRC),
       poly("Denisovans (fossil sites, schematic)", -165000, -32000, "#6aa0d8", DEN_EAST, DEN_SRC),
       poly("Denisovans (inferred from living people's DNA)", -60000, -30000, "#3f6f9c", DEN_INFER, DEN_SRC)]
SAP = [poly("Homo sapiens (Africa)", -315000, 0, "#7fbf6a", SAP_AFR, SAP_SRC),
       poly("Early sapiens in the Levant (debated exits)", -190000, -90000, "#a8d890", SAP_LEV, SAP_SRC),
       poly("Homo sapiens (South & Southeast Asia)", -60000, 0, "#7fbf6a", SAP_SASIA, SAP_SRC),
       poly("Homo sapiens (Sahul)", -50000, 0, "#7fbf6a", SAP_SAHUL, SAP_SRC),
       poly("Homo sapiens (Europe & Near East)", -46000, 0, "#7fbf6a", SAP_EUR, SAP_SRC),
       poly("Homo sapiens (North & East Asia)", -45000, 0, "#7fbf6a", SAP_NASIA, SAP_SRC),
       poly("Homo sapiens (the Americas)", -16000, 0, "#7fbf6a", SAP_AMER, SAP_SRC)]
CONTACT = [poly("Contact: Neanderthal × sapiens (model-based)", -60000, -44000, "#e0c050",
                [(29, 33), (38, 34), (40, 45), (34, 50), (29, 44)],
                "Fu et al. 2014 (~50–60 ka); Iasi et al. 2024 Science 386:eadq3010 (~47 ka, 50.5–43.5); Sümer et al. 2025 Nature 638:711"),
           poly("Contact: Denisovan × sapiens (model-based)", -55000, -30000, "#e0c050",
                [(10, 97), (18, 122), (-2, 142), (-10, 150), (-10, 118), (-2, 103)],
                "Jacobs et al. 2019 Cell 177:1010 (two Denisovan pulses into Papuans, one as late as ~30 ka); Larena et al. 2021")]
dump("neanderthal-range.geojson", fc(NEA)); dump("denisovan-range.geojson", fc(DEN)); dump("sapiens-range.geojson", fc(SAP))
dump("all-three.geojson", fc(NEA + DEN + SAP + CONTACT))

# ── routes: (label, colour, [(place, lat, lon, -years-ago)], source) ────────────────────────────────
Y = "YFull tree (ages rounded); Poznik et al. 2016 Nat Genet 48:593; Karmin et al. 2015 Genome Res 25:459; ISOGG 2019–2020"
MT = "PhyloTree Build 17 (van Oven & Kayser 2009); Behar et al. 2012 AJHG 90:675 (ages rounded, Soares et al. 2009 rate)"
SAPIENS_ROUTES = [
    ("Southern route out of Africa", "#f0c46a", [("Horn of Africa", 9, 42, -70000), ("Bab-el-Mandeb", 12.6, 43.3, -65000), ("South Arabia", 15, 50, -62000),
      ("Strait of Hormuz", 26.5, 56.3, -60000), ("Indus", 25, 67, -58000), ("South India", 12, 78, -56000), ("Bengal", 22, 90, -54000),
      ("Malay Peninsula", 5, 101, -52000), ("Sunda", -2, 110, -51000), ("Timor", -9, 125, -50500), ("Sahul", -12.5, 132.9, -50000)], SAP_SRC),
    ("Into Europe", "#e8a060", [("Levant", 32, 35.5, -55000), ("Anatolia", 39, 33, -50000), ("Bacho Kiro", 42.95, 25.43, -46000),
      ("Danube", 48, 16, -43000), ("France", 45, 1, -42000), ("Iberia", 40, -4, -40000)], SAP_SRC),
    ("Into North Asia", "#d0b0ff", [("Zagros", 34, 47, -55000), ("Central Asia", 40, 66, -50000), ("Ust'-Ishim", 57.7, 71.2, -45000),
      ("Tianyuan", 39.65, 115.9, -40000), ("Yana", 70.7, 135.4, -32000), ("Chukotka", 66, 175, -25000)], SAP_SRC),
    ("Into the Americas (≥16 ka)", "#80d0e0", [("Beringia", 64, -160, -18000), ("Pacific coast", 55, -132, -16500), ("California", 35, -120, -15500),
      ("Central America", 15, -90, -15000), ("Andes", -10, -77, -14800), ("Monte Verde", -41.5, -73.2, -14500)], SAP_SRC),
    ("Near Oceania to Lapita", "#ffb0c0", [("Taiwan", 23.7, 121, -5000), ("Philippines", 14, 121, -4000), ("Bismarck Arch.", -4, 152, -3300),
      ("Vanuatu", -16, 167, -3000), ("Fiji", -18, 178.4, -2900)], "Kirch 2017; Skoglund et al. 2016 Nature 538:510"),
]
YDNA_ROUTES = [
    ("A (A00 → A-M51)", "#9a7b5a", [("A00 · Cameroon", 6, 11, -235000), ("A0/A1 · Central Africa", 3, 18, -160000), ("A-M51 · Khoe-San", -22, 22, -40000)], Y),
    ("B (B2 · Mbuti, Biaka)", "#b08850", [("BT", 6, 30, -130000), ("B", 4, 33, -88000), ("B2 · rainforest", 2, 20, -60000), ("B2b · south", -20, 25, -40000)], Y),
    ("CT · the exit", "#f0c46a", [("CT · East Africa", 8, 38, -88000), ("Bab-el-Mandeb", 12.6, 43.3, -68000)], Y),
    ("C (C1b2 → Sahul)", "#70c0ff", [("CF · Arabia", 16, 48, -66000), ("C", 22, 72, -55000), ("C · Sunda", 0, 110, -50000), ("C1b2 · Sahul", -24, 134, -48000)], Y),
    ("C2 (Siberia, Mongolia)", "#5090d0", [("C", 22, 72, -53000), ("C2 · East Asia", 35, 110, -40000), ("C2 · Mongolia", 47, 105, -30000)], Y),
    ("D (Tibet, Japan, Andaman)", "#c080f0", [("DE · Arabia", 16, 46, -68000), ("D", 22, 78, -55000), ("D1 · Tibet", 31, 91, -35000), ("D1a2 · Japan", 36, 138, -20000)], Y),
    ("E (E-M96 back to Africa)", "#e07060", [("DE · Arabia", 16, 46, -68000), ("E · Horn", 9, 40, -55000), ("E-M35 · Nile", 24, 32, -25000), ("E-V13 · Balkans", 42, 22, -7000)], Y),
    ("E-M2 · Bantu expansion", "#c05040", [("E-M2 · West Africa", 8, -2, -40000), ("Cameroon", 6, 11, -5000), ("Great Lakes", -2, 33, -3000), ("South Africa", -26, 28, -1500)], Y),
    ("F", "#e0e070", [("F · Arabia", 16, 48, -66000), ("F · Zagros", 34, 47, -50000)], Y),
    ("G (G2a · farmers)", "#a0d060", [("G · Zagros", 34, 47, -48500), ("G · Caucasus", 42.5, 44, -26000), ("G2a · Anatolia", 37.5, 32.5, -10000), ("G2a · Alps (Ötzi)", 46.8, 10.8, -5300)], Y),
    ("H (South Asia)", "#d0a0a0", [("H · Iran", 32, 55, -48000), ("H1 · India", 22, 78, -40000)], Y),
    ("I (European hunter-gatherers)", "#60b0a0", [("IJ · Zagros", 34, 47, -47200), ("I · Anatolia", 39, 33, -43000), ("I2 · Balkans", 44, 20, -27500), ("I1 · Scandinavia", 60, 15, -4600)], Y),
    ("J (J1, J2)", "#e0a0e0", [("IJ · Zagros", 34, 47, -47200), ("J · Caucasus", 41, 45, -43000), ("J2 · Fertile Crescent", 36, 40, -31000), ("J1 · Arabia", 22, 45, -10000)], Y),
    ("K → LT → L, T", "#ffd090", [("K · Iran", 30, 58, -47200), ("LT · South Asia", 27, 68, -45400), ("L · Indus", 27, 68, -20000), ("T · Levant", 33, 36, -15000), ("T · Horn", 10, 45, -5000)], Y),
    ("S / M (K2b1 · New Guinea)", "#90e0c0", [("K2 · South Asia", 22, 85, -45400), ("K2b1 · Sunda", 0, 110, -44000), ("S / M · New Guinea", -5, 143, -42000)], Y),
    ("NO → N (Siberia, Uralic)", "#a0a0ff", [("NO · South China", 25, 105, -41900), ("N · South China", 28, 110, -36800), ("N · Siberia", 60, 100, -20000), ("N1a · Finland", 62, 25, -3000)], Y),
    ("O (East Asia, Austronesia)", "#ff90b0", [("NO · South China", 25, 105, -41900), ("O2 · Yangtze", 31, 112, -30000), ("O1a · Taiwan", 23.7, 121, -8000), ("Philippines", 14, 121, -4000)], Y),
    ("P → Q (Siberia)", "#80e0ff", [("P · South Asia", 25, 85, -44000), ("P1 · Central Asia", 42, 66, -31900), ("Q · Altai", 51, 86, -25000), ("Q · Chukotka", 66, 175, -18000)], Y),
    ("Q-M3 · the Americas", "#40c0f0", [("Q-M3 · Beringia", 64, -160, -17000), ("Pacific coast", 50, -127, -16000), ("Mesoamerica", 18, -97, -15000), ("Monte Verde", -41.5, -73.2, -14500)], Y),
    ("R1a (Corded Ware; Z93 → India)", "#ff7070", [("R · Central Asia", 42, 66, -31900), ("R1a · steppe", 48, 45, -22800), ("Z282 · Corded Ware", 52, 19, -4900), ("Z93 · Sintashta", 52.6, 60.3, -4100), ("Z93 · Swat", 34.8, 72.3, -3500)], Y),
    ("R1b (Yamnaya → Bell Beaker)", "#ff4040", [("R · Central Asia", 42, 66, -31900), ("R1b · Urals", 55, 58, -20400), ("M269 · Pontic steppe", 47, 40, -6400), ("L51 · Bell Beaker", 50, 8, -4600), ("Britain", 52, -1, -4400), ("Iberia", 40, -4, -4300)], Y),
]
MTDNA_ROUTES = [
    ("L0 (Khoe-San)", "#9a7b5a", [("mt-MRCA · East/South Africa", 0, 32, -190000), ("L0 · southern Africa", -22, 22, -150000), ("L0d/k", -30, 20, -100000)], MT),
    ("L1 (Central Africa)", "#b08850", [("L1–6", 0, 32, -150000), ("L1c · rainforest", 0, 18, -100000)], MT),
    ("L2 (West Africa)", "#c09a60", [("L2", 5, 35, -90000), ("L2 · West Africa", 12, -5, -60000)], MT),
    ("L3 → out of Africa", "#f0c46a", [("L3 · East Africa", 8, 38, -70000), ("Bab-el-Mandeb", 12.6, 43.3, -63000)], MT),
    ("L4, L5 (Tanzania)", "#a08070", [("L5", 5, 35, -120000), ("L4 · Hadza, Sandawe", -5, 35, -80000)], MT),
    ("L6 (Yemen, Ethiopia)", "#907060", [("L3'4'6", 8, 38, -80000), ("L6 · Yemen", 15, 44, -25000)], MT),
    ("M → C, D (Asia)", "#70c0ff", [("M · South Asia", 22, 78, -55000), ("M · Sunda", 0, 110, -50000), ("D · East Asia", 35, 110, -45000), ("C · Siberia", 55, 110, -30000), ("C, D · Chukotka", 66, 175, -18000)], MT),
    ("N → A (East Asia)", "#c080f0", [("N · Arabia", 20, 50, -60000), ("N · South Asia", 25, 70, -55000), ("A · East Asia", 38, 115, -30000), ("A · Chukotka", 66, 175, -18000)], MT),
    ("R → B (East Asia, Pacific)", "#ff90b0", [("R · Gulf", 27, 52, -58000), ("B · South China", 25, 110, -45000), ("B4a1a · Taiwan", 23.7, 121, -5000), ("Bismarck Arch.", -4, 152, -3300), ("Fiji", -18, 178.4, -2900)], MT),
    ("U (U5 · European hunter-gatherers)", "#60b0a0", [("R · Gulf", 27, 52, -56000), ("U · Levant", 33, 36, -50000), ("U5 · Europe", 48, 10, -35000)], MT),
    ("K (U8b · farmers)", "#a0d060", [("U8b · Near East", 36, 40, -30000), ("K · Anatolia", 38, 32, -12000), ("K · Europe", 46, 10, -7000)], MT),
    ("H (post-glacial Europe)", "#ff7070", [("HV · Near East", 36, 44, -25000), ("H · Iberian refuge", 42, -4, -18000), ("H · Europe", 50, 10, -12000)], MT),
    ("J and T (Neolithic)", "#ffd090", [("JT · Near East", 34, 44, -45000), ("J, T · Fertile Crescent", 36, 40, -20000), ("J, T · Europe", 45, 20, -8000)], MT),
    ("X (Near East → Europe)", "#d0d0d0", [("X · Near East", 36, 40, -30000), ("X2 · Caucasus", 42, 44, -20000), ("X2 · Europe", 45, 10, -10000)], MT),
    ("A2, B2, C1, D1, X2a · the Americas", "#40c0f0", [("Beringia", 64, -160, -18000), ("Pacific coast", 50, -127, -16000), ("Mesoamerica", 18, -97, -15000), ("Andes", -10, -77, -14700), ("Monte Verde", -41.5, -73.2, -14500)], MT),
]


def write_routes(sub, rows):
    out = []
    for label, col, pts, src in rows:
        slug = "".join(c if c.isalnum() else "-" for c in label.lower()).strip("-")
        while "--" in slug:
            slug = slug.replace("--", "-")
        path = os.path.join(sub, f"{slug}.csv")
        with open(os.path.join(OUT, path), "w", newline="") as f:
            w = csv.writer(f); w.writerow(["label", "lat", "lon", "year", "note"])
            for p, la, lo, y in pts:
                w.writerow([p, la, lo, y, f"{-y:,} years ago (approx.)"])
        CITES[label] = src
        out.append({"label": label, "colour": col, "path": f"{REL}/{path}"})
    return out


os.makedirs(os.path.join(OUT, "sapiens"), exist_ok=True)
SR = write_routes("sapiens", SAPIENS_ROUTES); YR = write_routes("ydna", YDNA_ROUTES); MR = write_routes("mtdna", MTDNA_ROUTES)
dump("citations.json", {"note": "one current model; ages are approximate and rounded; see SOURCES.md", "items": CITES})

WORLD = [-180, -58, 180, 74]
OLD = [-20, -40, 180, 74]
BASE = {"fps": 24, "palette": "night", "timeMode": "ago", "timeScale": "log", "note": NOTE, "endNote": END}
TAGS = ["deep-time"]


def stop(label, lat, lon, year, kind, caption, source, zoom=2.5):
    return {"label": label, "lat": lat, "lon": lon, "year": year, "kind": kind, "caption": caption, "source": source, "hold": 4, "zoom": zoom}


JOBS = {
    "deep-neanderthals": {
        "title": "Neanderthals", "subtitle": "about 430,000 – 40,000 years ago", "bbox": [-15, 25, 95, 60], "years": [-430000, -38000], "duration": 100,
        "territories": {"source": "geojson", "path": f"{REL}/neanderthal-range.geojson"}, "cities": NEANDERTHAL_SITES,
        "tags": TAGS + ["neanderthal"], "credit": "Sites: Arsuaga 2014, Meyer 2016, Prüfer 2014/2017, Mafessoni 2020, Pomeroy 2020, Higham 2014, Finlayson 2006. Base map: Natural Earth (public domain).",
        "stops": [stop("Sima de los Huesos", 42.35, -3.52, -430000, "record", "Early Neanderthal lineage by nuclear DNA", "Meyer et al. 2016"),
                  stop("Last Neanderthals", 44.95, 0.94, -41000, "record", "Most disappear ~41–39 ka", "Higham et al. 2014"),
                  stop("Gibraltar", 36.12, -5.34, -39500, "debated", "Later survival (~32–28 ka) claimed at Gorham's Cave", "Finlayson et al. 2006")]},
    "deep-denisovans": {
        "title": "Denisovans", "subtitle": "about 250,000 – 30,000 years ago · most of the range is inferred", "bbox": [70, -15, 160, 58], "years": [-250000, -30000], "duration": 90,
        "territories": {"source": "geojson", "path": f"{REL}/denisovan-range.geojson"}, "cities": DENISOVAN_SITES,
        "tags": TAGS + ["denisovan"], "credit": "Sites: Reich 2010, Douka 2019, Chen 2019, Zhang 2020, Demeter 2022, Fu 2025, Tsutaya 2025; inferred range: Jacobs 2019, Larena 2021. Base map: Natural Earth (PD).",
        "stops": [stop("Denisova Cave", 51.4, 84.68, -200000, "record", "Named from a finger bone's genome", "Reich et al. 2010; Douka et al. 2019"),
                  stop("Baishiya Karst Cave", 35.45, 102.57, -160000, "record", "Xiahe mandible, Tibetan Plateau", "Chen et al. 2019"),
                  stop("Island SE Asia & Sahul", -4, 138, -55000, "interpretation", "Inferred from DNA of living people — no fossils there", "Jacobs et al. 2019")]},
    "deep-sapiens": {
        "title": "Homo sapiens", "subtitle": "about 315,000 years ago to the settling of the Pacific", "bbox": WORLD, "years": [-320000, -700], "duration": 130,
        "territories": {"source": "geojson", "path": f"{REL}/sapiens-range.geojson"}, "cities": SAPIENS_SITES, "routes": SR,
        "tags": TAGS + ["sapiens"], "credit": "Sites: Hublin/Richter 2017, Vidal 2022, Hershkovitz 2018, Harvati 2019, Clarkson 2017, O'Connell 2018, Hublin 2020, Bennett 2021, Wilmshurst 2011. Base map: Natural Earth (PD).",
        "stops": [stop("Jebel Irhoud", 31.86, -8.87, -315000, "record", "Earliest dated Homo sapiens fossils", "Hublin et al. 2017", 3),
                  stop("Out of Africa", 12.6, 43.3, -65000, "interpretation", "Main dispersal ~70–50 ka, southern route (one model)", "see SOURCES.md", 3),
                  stop("Madjedbebe", -12.5, 132.9, -50000, "debated", "Sahul by ~50 ka; 65 ka is debated", "Clarkson 2017 / O'Connell 2018", 3),
                  stop("White Sands", 32.8, -106.3, -22000, "debated", "Footprints dated 23–21 ka", "Bennett et al. 2021", 3)]},
    "deep-all-three": {
        "title": "Neanderthals, Denisovans and Us", "subtitle": "about 430,000 – 30,000 years ago · contact zones are model-based", "bbox": [-20, -30, 160, 65], "years": [-430000, -30000], "duration": 120,
        "territories": {"source": "geojson", "path": f"{REL}/all-three.geojson"}, "routes": SR[:3],
        "cities": [c for c in NEANDERTHAL_SITES[:4] + DENISOVAN_SITES[:2] + SAPIENS_SITES[:3]],
        "tags": TAGS + ["neanderthal", "denisovan", "sapiens"], "credit": "Admixture: Green 2010, Reich 2010, Fu 2014, Jacobs 2019, Iasi 2024, Sümer 2025; Denny: Slon 2018. Base map: Natural Earth (PD).",
        "stops": [stop("Denisova 11 ('Denny')", 51.4, 84.68, -90000, "record", "Neanderthal mother, Denisovan father", "Slon et al. 2018", 3),
                  stop("Near East contact", 33, 40, -50000, "interpretation", "Neanderthal gene flow into sapiens ~50–60 ka (newer: ~47 ka)", "Fu 2014; Iasi 2024; Sümer 2025", 3),
                  stop("Sunda–Sahul contact", -4, 138, -45000, "interpretation", "Denisovan gene flow into Papuans, pulses to ~30 ka", "Jacobs et al. 2019", 3)]},
    "deep-ydna": {
        "title": "Y-DNA Haplogroup Journeys", "subtitle": "one current model · ages approximate (YFull, Poznik 2016, Karmin 2015)", "bbox": WORLD, "years": [-240000, -1500], "duration": 150,
        "routes": YR, "tags": TAGS + ["haplogroup", "ydna"], "credit": "Model: " + Y + ". Base map: Natural Earth (public domain)."},
    "deep-mtdna": {
        "title": "mtDNA Haplogroup Journeys", "subtitle": "one current model · ages approximate (PhyloTree 17, Behar 2012)", "bbox": WORLD, "years": [-200000, -2500], "duration": 140,
        "routes": MR, "tags": TAGS + ["haplogroup", "mtdna"], "credit": "Model: " + MT + ". Base map: Natural Earth (public domain)."},
    "deep-haplogroups": {
        "title": "The Haplogroup Journeys", "subtitle": "Y-DNA and mtDNA together · one current model", "bbox": WORLD, "years": [-240000, -1500], "duration": 120,
        "routes": [YR[i] for i in (0, 2, 3, 6, 15, 17, 18, 20)] + [MR[i] for i in (0, 3, 6, 7, 8, 11)],
        "tags": TAGS + ["haplogroup", "ydna", "mtdna"], "credit": "Model: YFull; Poznik 2016; Karmin 2015; ISOGG; PhyloTree 17; Behar 2012. Base map: Natural Earth (PD)."},
}
for cid, job in JOBS.items():
    j = {"id": cid, **BASE, **job}
    json.dump(j, open(os.path.join(HERE, f"{cid}.json"), "w"), indent=1, ensure_ascii=False)
print(len(JOBS), "jobs;", len(CITES), "cited items")
