"""drawn_glyphs.py - hand-drawn sign tables for ancient scripts that are NOT in Unicode.
Each sign = stroke paths in a 0..100 box (y down), traced from the published tables named in `source`.
Rendered 512x512 black strokes on transparent, stroke 6% of box, 12% padding (same look as glyph_library.py).
"""
import json, os, sys
from svgpathtools import parse_path
import cairosvg

PX, PAD, STROKE, DOT = 512, 0.12, 0.06 * 512, 17


def circ(cx, cy, r):
    return f"M{cx-r} {cy} A{r} {r} 0 1 0 {cx+r} {cy} A{r} {r} 0 1 0 {cx-r} {cy} Z"


def ell(cx, cy, rx, ry):
    return f"M{cx-rx} {cy} A{rx} {ry} 0 1 0 {cx+rx} {cy} A{rx} {ry} 0 1 0 {cx-rx} {cy} Z"


def G(id, name, translit, meaning, source, paths, dots=(), note=""):
    return dict(id=id, name=name, translit=translit, meaning=meaning, source=source, paths=paths, dots=list(dots), note=note)


# ---------------------------------------------------------------- PHRYGIAN
S_OC = "Obrador-Cursach, Lexicon of the Phrygian Inscriptions (2018) p.34, as tabulated in Wikipedia 'Phrygian alphabet' (letter images from Wikimedia Commons)"
S_OR = "Oreshko, 'The rare letters of the Phrygian alphabet revisited', in Steele & Boyes (eds), Writing Around the Ancient Mediterranean (Oxbow 2022) 145-166; numbering after Brixhe & Lejeune, CIPPh (1984) 280"
S_OMNI = "Omniglot, 'Phrygian alphabet' chart"
PHRYGIAN = [
    G("a", "Alpha (a)", "a", "/a/, /a:/", S_OC, ["M15 100 L50 0 L85 100", "M29 60 L85 100"], note="Slanting cross-bar running to the foot of the right leg (Commons PhrygianAlphaL2R)."),
    G("b", "Beta (b)", "b", "/b/", S_OC, ["M20 0 L20 100", "M20 0 L52 0 Q78 0 78 25 Q78 50 52 50 L20 50", "M20 50 L56 50 Q84 50 84 75 Q84 100 56 100 L20 100"]),
    G("b_8", "Beta, 8-shaped variant (b)", "b", "/b/", S_OC, [circ(50, 26, 24), circ(50, 74, 24)], note="Wikipedia lists 'B, 8'. Oreshko (letter no.24) and Obrador-Cursach 2020 treat the eastern rare form as a graphic variant of b."),
    G("g", "Gamma (g)", "g", "/g/", S_OC, ["M30 100 L30 0 L72 0"]),
    G("d", "Delta (d)", "d", "/d/", S_OC, ["M50 0 L10 100 L90 100 Z"]),
    G("d_pointed", "Delta, pointed-D variant (d)", "d", "/d/", S_OMNI, ["M25 0 L25 100 L80 50 Z"], note="Omniglot shows d as a pointed D (vertical + two diagonals); Wikipedia gives Delta and a second, Lambda-like, form."),
    G("e", "Epsilon (e)", "e", "/e/, /e:/", S_OC, ["M25 0 L25 100", "M25 3 L75 15", "M25 33 L75 45", "M25 63 L75 75"], note="Archaic epsilon with oblique bars; stem runs below the lowest bar."),
    G("e_4bar", "Epsilon, four-bar variant (e)", "e", "/e/, /e:/", S_OC, ["M25 0 L25 100", "M25 0 L75 12", "M25 29 L75 41", "M25 58 L75 70", "M25 87 L75 99"], note="Commons PhrygianEpsL2Rvariant."),
    G("v", "Digamma (v)", "v", "/w/", S_OC, ["M30 100 L30 0 L75 0", "M30 45 L68 45"]),
    G("i", "Iota (i)", "i", "/i/, /i:/", S_OC, ["M50 0 L50 100"]),
    G("k", "Kappa (k)", "k", "/k/", S_OC, ["M30 0 L30 100", "M75 0 L30 55", "M44 43 L78 100"], note="Obrador-Cursach also counts psi-like forms as k; Oreshko rejects this (see no20)."),
    G("l", "Lambda (l)", "l", "/l/", S_OC, ["M30 100 L30 0 L75 38"], note="Vertical with a drooping arm from the top (Commons PhrygianLabdaR2L, mirrored)."),
    G("m", "Mu (m)", "m", "/m/", S_OC, ["M20 100 L20 0 L50 40 L80 0 L80 60"], note="First leg long, last leg short (Commons PhrygianMu_R2L, mirrored)."),
    G("n", "Nu (n)", "n", "/n/", S_OC, ["M20 100 L20 0 L80 55 L80 0"], note="First leg long, last leg short (Commons PhrygianNu_R2L, mirrored)."),
    G("o", "Omicron (o)", "o", "/o/, /o:/", S_OC, [circ(50, 50, 45)]),
    G("p", "Pi (p)", "p", "/p/", S_OC, ["M25 100 L25 0 L75 0 L75 35"], note="Short right leg (Commons PhrygianPiR2L, mirrored)."),
    G("r", "Rho (r)", "r", "/r/", S_OC, ["M25 100 L25 0 L52 0 Q78 0 78 25 Q78 50 52 50 L25 50"]),
    G("s", "Sigma (s)", "s", "/s/", S_OC, ["M85 0 L15 25 L85 50 L15 75 L85 100"], note="Multi-stroke sigma (Commons PhrygianSigmaL2R)."),
    G("s_multibar", "Sigma, slim six-bar variant (s)", "s", "/s/", S_OC + "; " + S_OR, ["M70 0 L30 17 L70 33 L30 50 L70 67 L30 83 L70 100"], note="Commons PhrygianSigmaL2Rvariant1; Oreshko notes the 'slim six-bar s' as an early (7th c. BC) form."),
    G("s_rounded", "Sigma, rounded variant (s)", "s", "/s/", S_OC, ["M80 0 Q20 0 20 25 Q20 50 62 50 Q20 50 20 75 Q20 100 80 100"], note="Commons PhrygianSigmaL2Rvariant2."),
    G("t", "Tau (t)", "t", "/t/", S_OC, ["M10 0 L90 0", "M50 0 L50 100"]),
    G("u", "Upsilon (u)", "u", "/u/, /u:/", S_OC, ["M30 0 L30 100", "M30 55 L78 5"], note="Stem with a single branch ('twig-shaped')."),
    G("y", "Phrygian y (no.18)", "y", "/j/", S_OC + "; " + S_OR, ["M75 25 L50 0 L50 100 L25 75"], note="The one letter distinguishing the Phrygian from the Greek alphabet (Oreshko). Wikipedia also lists an X-shaped form."),
    G("y_x", "Phrygian y, X-shaped variant", "y", "/j/", S_OC, ["M15 0 L85 100", "M85 0 L15 100"]),
    G("z_arrow", "Arrow letter (no.19)", "z (ts/dz)", "affricate", S_OC + "; " + S_OR, ["M50 100 L50 0", "M18 35 L50 0 L82 35"],
      note="DISPUTED value: Wikipedia/Obrador-Cursach transcribe z (/z/, /zd/?); Brixhe 1982 an affricate; Oreshko 2022 /ts/ (A-ts-es for Ates) and voiced /dz/ (Si-dz-idos), continued by New Phrygian zeta."),
    G("no20", "Crow's-foot letter (no.20)", "?", "sibilant (disputed)", S_OR, ["M50 100 L50 0", "M15 12 L50 55 L85 12"],
      note="DISPUTED: Young /ps/ or /kh/; Lejeune 1978 /ks/ (commonly adopted); Obrador-Cursach 2020 a graphic variant of k; Oreshko 2022 a sibilant (geminate ss). ~6 real attestations (W-01b, B-07, G-115, G-145, G-224c, G-339)."),
    G("no23", "Rare letter no.23 (T with two hangers)", "?", "unknown", S_OR, ["M8 0 L92 0", "M50 0 L50 100", "M25 0 L25 45", "M75 0 L75 45"],
      note="Only four graffiti (G-112, P-106, NW-120, G-275); status uncertain - possibly a variant of no.20/sibilant before consonants (Oreshko). Wikipedia lists a similar sampi-like form under z."),
]

# ---------------------------------------------------------------- PROTO-SINAITIC
S_PA = "Pandey, 'Revisiting the Encoding of Proto-Sinaitic in Unicode', Unicode L2/19-299 (2019) pp.8-9 (names after Albright 1969, Colless 2014)"
S_WPS = "Wikipedia 'Proto-Sinaitic script', Table of symbols (Simons 2011 fig.2; Colless 2010 fig.5; Albright 1966)"
PS = S_PA + "; " + S_WPS
PROTO_SINAITIC = [
    G("alp", "ʾalp", "ʾ", "ox head (F1)", PS, ["M32 30 L68 30 L61 84 Q50 96 39 84 Z", "M32 30 Q18 22 14 0", "M68 30 Q82 22 86 0"], dots=[(44, 52)], note="Ox head with horns; Pandey lists six stance variants incl. left/right-facing (Sinai 349)."),
    G("bayt", "bayt", "b", "house (O1; Wadi el-Hol O4)", PS, ["M40 100 L10 100 L10 10 L90 10 L90 100 L62 100"], note="House plan open along one side (O1 pr)."),
    G("bayt_closed", "bayt, closed square", "b", "house", S_PA, ["M15 15 L85 15 L85 85 L15 85 Z"]),
    G("gaml", "gaml", "g", "throw-stick (T14)", PS, ["M8 8 L22 78 L95 84"]),
    G("dalt", "dalt", "d", "door (O31)", PS, ["M20 0 L20 100", "M20 12 L72 12 L72 88 L20 88", "M20 50 L72 50"], note="Value d per Colless; Albright read the fish sign as dag 'fish' = d (see samk_dag)."),
    G("he_fence", "ḥe", "ḥ", "fence", S_PA, ["M0 22 L100 22", "M0 78 L100 78", "M25 22 L25 78", "M50 22 L50 78", "M75 22 L75 78"], note="Pandey pairs this with dalt; alternative to ḥaṣir for ḥ."),
    G("hillul", "hô / hillul", "h", "man calling / jubilating (A28)", PS, [circ(50, 12, 11), "M50 23 L50 64", "M18 10 L24 36 L76 36 L82 10", "M50 64 L30 96", "M50 64 L70 96"],
      note="Albright 'ho, man calling'; Colless 'hll, jubilate'. At Wadi el-Hol possibly also a logogram."),
    G("waw", "wāw", "w", "hook, peg", PS, [circ(50, 16, 14), "M50 30 L50 100"], note="No clear hieroglyphic prototype (Colless: possibly created outside Egypt)."),
    G("dayp", "ḏayp / zayn", "ḏ / z", "eyebrow (D13) or weapon", PS, ["M4 40 Q50 28 96 38", "M4 64 Q50 52 96 62"], note="DISPUTED: Colless ḏayp 'eyebrow' (ḏ); others zayn 'weapon' (z). ḏ merged into z by Phoenician."),
    G("ziq", "ziq", "z", "fetter", S_PA, ["M22 0 L78 0 L22 100 L78 100 Z"], note="No strong hieroglyphic match (Colless)."),
    G("hasir", "ḥaṣir", "ḥ", "mansion / courtyard (O6)", PS, ["M22 0 L78 0 L78 100 L22 100 Z", "M22 50 L78 50"]),
    G("hayt", "ḫayt", "ḫ", "thread, twisted flax (V28)", PS, [circ(50, 13, 12), circ(50, 43, 12), "M41 54 L62 100", "M59 54 L38 100"], note="ḫ merged into ḥ by Phoenician."),
    G("tab", "ṭab", "ṭ", "good (F35 heart-and-windpipe)", PS, ["M0 50 L62 50", "M20 34 L20 66", circ(80, 50, 17)], note="Canaanites later replaced it with a wheel-like ṭayt (⊕)."),
    G("zil", "ẓil", "ẓ", "shade", S_PA, ["M22 42 Q50 -8 78 42 Z", "M50 42 L50 100"]),
    G("yad", "yad", "y", "hand / arm (D36)", PS, ["M4 4 L18 60 L60 60", "M60 60 L96 34", "M60 60 L96 86"]),
    G("kap", "kap", "k", "palm (D46)", PS, ["M15 0 L15 60 Q15 100 50 100 Q85 100 85 60 L85 0", "M38 0 L38 76", "M62 0 L62 76"]),
    G("lamd", "lamd", "l", "goad / crook (V1 or S39)", PS, ["M35 100 L35 32 Q35 0 60 0 Q85 0 85 24 Q85 46 64 46"], note="Pandey lists eight stance variants (hook left/right, horizontal)."),
    G("maym", "maym", "m", "water (N35)", PS, ["M0 62 L14 38 L28 62 L42 38 L56 62 L70 38 L84 62 L98 38"]),
    G("nahs", "naḥš", "n", "snake (I10)", PS, ["M4 22 Q24 0 34 26 Q44 52 60 42 Q76 32 96 58"]),
    G("samk_dag", "samk / dag (fish)", "s / d", "fish", PS, ["M5 25 L36 50 L5 75 Z", "M36 50 Q66 18 96 50 Q66 82 36 50"],
      note="DISPUTED: Pandey 'samk, fish (?)' = s; Albright/Simons dag 'fish' = d (K5/K7)."),
    G("ayn", "ʿayn", "ʿ", "eye (D4)", PS, ["M4 50 Q50 10 96 50 Q50 90 4 50 Z"], dots=[(50, 50)]),
    G("pit", "piʾt", "p", "corner (O38)", PS, ["M20 0 L20 92 L78 92 L78 66"], note="Albright piʾt 'corner'; Colless prefers pu/pay 'mouth' (D21) for p."),
    G("pu", "pu / pay", "p (or ʿ)", "mouth (D21)", PS, ["M4 55 Q50 12 96 55 Q50 76 4 55 Z"], note="DISPUTED: Pandey 'pu mouth p / ʿayn eye'; the pupil-less lens may be an eye (ʿ)."),
    G("sad", "ṣad", "ṣ", "plant (M22/M16)", PS, ["M14 8 Q28 46 50 56 Q72 46 86 8", "M50 56 L50 100"]),
    G("qop", "qop / ṣirar", "q (or ṣ)", "monkey? / bag", PS, [circ(28, 50, 18), ell(70, 50, 24, 17)], note="DISPUTED: Albright qup 'monkey' (q); Pandey also ṣirar 'bag' (ṣ)."),
    G("qaw", "qaw", "q", "cord, line (V24)", PS, ["M50 0 L50 100", circ(50, 46, 13)], note="Colless's reading for q."),
    G("ras", "raʾš", "r", "head (D1/D19)", PS, ["M34 100 L34 74 Q12 56 18 30 Q28 2 58 4 Q82 6 88 32 L96 50 L84 55 L84 70 L62 76 L58 100"], note="Profile head; Pandey lists seven forms."),
    G("shamsh", "šamš", "š", "sun (N6B) / (Wilson-Wright: Sinai 357)", PS, ["M15 92 Q15 32 50 32 Q85 32 85 92 Z", "M28 40 L12 8", "M72 40 L88 8"], note="Value š; Sinai 357 form."),
    G("tad", "ṯad / ṯann", "ṯ", "breast / composite bow", PS, ["M5 18 Q5 92 30 92 Q50 92 50 52 Q50 92 70 92 Q95 92 95 18"], note="ṯ merged into š by Phoenician."),
    G("taw", "taw", "t", "owner's mark (Z9?)", PS, ["M50 0 L50 100", "M0 50 L100 50"]),
    G("taw_x", "taw, X form", "t", "owner's mark", S_PA, ["M8 8 L92 92", "M92 8 L8 92"]),
    G("ginab", "ġinab", "ġ", "grape", S_PA, ["M28 96 Q6 56 44 34 Q86 12 76 52 Q64 84 28 96 Z", "M44 34 L36 6"], note="Uncertain; listed by Pandey after Colless. ġ merged into ʿ by Phoenician."),
]

# ---------------------------------------------------------------- PROTO-CANAANITE
S_PC = "Wikipedia 'Proto-Canaanite alphabet', Table of symbols (Commons Proto-canaanite*.svg forms)"
PROTO_CANAANITE = [
    G("alp", "ʾalp", "ʾ", "ox", S_PC, ["M92 2 Q30 26 5 55 Q36 86 92 98", "M60 8 L62 92"], note="Ox head turned on its side, on the way to Phoenician aleph."),
    G("bayt", "bayt", "b", "house", S_PC, ["M5 5 Q60 0 100 30", "M5 5 Q20 72 56 100 L90 22"]),
    G("gaml", "gaml", "g", "throw-stick", S_PC, ["M25 100 L25 0 L72 0"]),
    G("dalt", "dalt / dilt", "d", "door / fish", S_PC, ["M5 0 L95 0 L50 100 Z"]),
    G("he", "haw", "h", "man calling?", S_PC, ["M22 0 L80 0 L80 100 L22 100", "M22 50 L80 50"]),
    G("waw", "waw", "w", "hook", S_PC, ["M18 0 L50 52 L82 0", "M50 52 L47 100"]),
    G("zayin", "zayn / ziqq", "z", "weapon / fetter", S_PC, ["M15 0 L85 0", "M15 100 L85 100", "M50 0 L50 100"]),
    G("het", "ḥayṭ", "ḥ", "fence?", S_PC, ["M22 0 L78 0 L78 100 L22 100 Z", "M22 50 L78 50"]),
    G("tet", "ṭayt", "ṭ", "wheel", S_PC, [ell(50, 50, 48, 38), "M2 50 L98 50", "M50 12 L50 88"]),
    G("yod", "yad", "y", "hand", S_PC, ["M30 0 Q58 18 62 36 L60 84 Q62 96 76 100", "M36 56 L62 56"]),
    G("kap", "kapp", "k", "palm", S_PC, ["M14 0 L10 95 L100 95", "M10 95 L84 12"]),
    G("lamd", "lamd", "l", "goad", S_PC, ["M62 0 Q10 18 12 64 Q14 100 50 100 Q86 100 86 70 Q86 44 60 44 Q44 46 44 62"]),
    G("maym", "maym", "m", "water", S_PC, ["M70 0 L35 25 L70 50 L35 75 L60 100"]),
    G("nun", "naḥš", "n", "snake", S_PC, ["M15 0 L30 85 L84 35 L86 100"]),
    G("samek", "samk", "s", "support", S_PC, ["M47 5 L100 100", "M0 35 L96 0", "M17 60 L100 25", "M26 85 L82 64"]),
    G("ayin", "ʿayin", "ʿ", "eye", S_PC, [circ(50, 50, 45)]),
    G("pe", "pe", "p", "mouth", S_PC, ["M95 0 L10 8 L72 100"]),
    G("qop", "qup", "q", "monkey (or cord)", S_PC, [circ(58, 26, 24), "M48 48 L30 100"]),
    G("res", "raʾš", "r", "head", S_PC, ["M60 100 L56 72 Q94 58 94 32 Q86 2 52 2 Q30 6 20 26 L10 46 L26 54 L16 74 L42 84 L46 100", "M20 30 L40 30"], note="Profile head facing left."),
    G("sl", "ś? (lateral)", "ś / ɬ", "?", S_PC, ["M18 42 Q50 34 82 42 L84 52 Q80 80 50 100 Q20 80 16 52 Z", "M35 40 L35 18", "M25 0 L35 18 L45 0", "M64 40 L64 18", "M54 0 L64 18 L74 0"], dots=[(40, 60), (60, 60)],
      note="Uncertain sign given /ɬ/ with no reconstructed name in the Wikipedia table."),
    G("shin", "šin?", "š / ṯ", "tooth?", S_PC, ["M5 0 L90 18 L5 50 L95 72 L10 100"], note="Value /θ/~/ʃ/ per table; name uncertain."),
    G("taw", "taw", "t", "mark", S_PC, ["M50 0 L50 100", "M0 50 L100 50"]),
]

# ---------------------------------------------------------------- NORTHEASTERN IBERIAN (dual signary)
S_IB = "Dual northeastern Iberian signary after Ferrer i Jané 2005 (Palaeohispanica 5), Wikimedia Commons 'Un signari ibèric nord-oriental dual.jpg' via Wikipedia 'Northeastern Iberian script'; cross-checked with Omniglot 'Iberian'"
def IB(id, tr, kind, paths, dots=(), note=""):
    return G(id, f"Iberian {tr}", tr, kind, S_IB, paths, dots, note)
DUAL = "Dual system (Maluquer 1968; Ferrer i Jané 2005): the simple sign is voiced, the sign with the extra stroke is voiceless; used mainly 4th-3rd c. BC."
IBERIAN = [
    IB("a", "a", "vowel", ["M25 100 L25 0 L52 0 Q78 0 78 25 Q78 50 52 50 L25 50"]),
    IB("e", "e", "vowel", ["M25 8 L25 100", "M25 40 L75 8", "M25 68 L75 36", "M25 96 L75 64"]),
    IB("i", "i", "vowel", ["M30 100 L30 0 L62 40 L80 18"], note="Approximate stroke of the side element; Omniglot shows several variants."),
    IB("o", "o", "vowel", ["M20 0 L20 100", "M80 0 L80 100", "M20 35 L80 65"]),
    IB("u", "u", "vowel", ["M50 100 L50 0", "M15 40 L50 4 L85 40"]),
    IB("ga", "ga", "syllabic (voiced)", ["M15 100 L50 0 L85 100", "M32 52 L52 100"], note=DUAL),
    IB("ka", "ka", "syllabic (voiceless)", ["M15 100 L50 0 L85 100", "M30 58 L50 92 L70 58"], note=DUAL),
    IB("ge", "ge", "syllabic (voiced)", ["M70 0 Q15 10 15 50 Q15 90 70 100"], note=DUAL),
    IB("ke", "ke", "syllabic (voiceless)", ["M70 0 Q15 10 15 50 Q15 90 70 100", "M52 3 L52 97"], note=DUAL),
    IB("gi", "gi", "syllabic (voiced)", ["M72 30 L50 0 L50 100 L28 70"], note=DUAL),
    IB("ki", "ki", "syllabic (voiceless)", ["M72 30 L50 0 L50 100 L28 70", "M28 26 L72 58"], note=DUAL),
    IB("go", "go", "syllabic (voiced)", ["M20 0 L80 0 L20 100 L80 100 Z"], note=DUAL),
    IB("ko", "ko", "syllabic (voiceless)", ["M20 0 L80 0 L20 100 L80 100 Z", "M50 0 L50 100"], note=DUAL),
    IB("gu_ku", "gu/ku", "syllabic", [circ(50, 50, 45)], dots=[(50, 50)], note="No voiced/voiceless pair attested for this sign."),
    IB("ba", "ba", "syllabic", ["M50 0 L50 100"]),
    IB("be", "be", "syllabic", [circ(50, 72, 26), "M50 46 L50 8", "M34 50 L18 14", "M66 50 L82 14"]),
    IB("bi", "bi", "syllabic", ["M30 100 L30 30 Q30 0 55 0 Q80 0 80 25 Q80 46 60 46 Q46 46 48 30"]),
    IB("bo", "bo", "syllabic", ["M50 0 L50 100", "M10 27 L90 73", "M90 27 L10 73"]),
    IB("bu", "bu", "syllabic", ["M22 0 L78 0 L78 100 L22 100 Z", "M22 50 L78 50"], dots=[(50, 25), (50, 75)]),
    IB("da", "da", "syllabic (voiced)", ["M20 0 L80 100", "M80 0 L20 100"], note=DUAL),
    IB("ta", "ta", "syllabic (voiceless)", ["M20 0 L80 100", "M80 0 L20 100", "M50 0 L50 100"], note=DUAL),
    IB("de", "de", "syllabic (voiced)", [circ(50, 50, 45), "M50 5 L50 95"], note=DUAL),
    IB("te", "te", "syllabic (voiceless)", [circ(50, 50, 45), "M50 5 L50 95", "M5 50 L95 50"], note=DUAL),
    IB("di", "di", "syllabic (voiced)", ["M15 0 L15 40 L85 40 L85 0", "M50 0 L50 100"], note=DUAL),
    IB("ti", "ti", "syllabic (voiceless)", ["M8 0 L8 40 L92 40 L92 0", "M36 0 L36 40", "M64 0 L64 40", "M50 40 L50 100"], note=DUAL),
    IB("do", "do", "syllabic (voiced)", ["M15 0 L15 100 L85 100 L85 0", "M50 0 L50 100"], note=DUAL),
    IB("to", "to", "syllabic (voiceless)", ["M8 0 L8 100 L92 100 L92 0", "M36 0 L36 100", "M64 0 L64 100"], note=DUAL),
    IB("du", "du", "syllabic (voiced)", ["M50 0 L15 100 L85 100 Z"], note=DUAL),
    IB("tu", "tu", "syllabic (voiceless)", ["M50 0 L15 100 L85 100 Z", "M50 0 L50 100"], note=DUAL),
    IB("s", "s", "sibilant", ["M44 0 L60 14 L40 30 L60 48 L40 66 L60 84 L46 100"]),
    IB("s_acute", "ś", "sibilant", ["M15 100 L15 0 L50 60 L85 0 L85 100"]),
    IB("r", "r", "rhotic", ["M62 0 L62 100", "M62 0 Q12 0 12 50 Q12 100 62 100"]),
    IB("r_acute", "ŕ", "rhotic", [circ(50, 30, 22), "M50 8 L50 100"]),
    IB("l", "l", "lateral", ["M32 100 L32 0 L70 40"]),
    IB("m", "m", "nasal", ["M50 100 L50 0", "M16 4 L50 40 L84 4"]),
    IB("n", "n", "nasal", ["M25 100 L25 0 L56 45 L86 0"]),
    IB("m_acute", "ḿ", "nasal", ["M15 0 L50 100 L85 0"], note="Exact value of ḿ uncertain (a nasal)."),
]

# ---------------------------------------------------------------- ARCHAIC GREEK EPICHORIC (forms not in Unicode)
S_GR = "Jeffery, The Local Scripts of Archaic Greece (1961), as summarised in Wikipedia 'Archaic Greek alphabets' (Glyph shapes; Commons Greek_*.svg glyphs)"
def GR(id, name, tr, where, paths, dots=(), note=""):
    return G(id, name, tr, where, S_GR, paths, dots, note)
GREEK = [
    GR("beta_thera_1", "Beta, Theran form", "b", "Thera", ["M20 0 L20 100", "M20 0 L80 0 L80 16", "M20 30 L80 100"]),
    GR("beta_thera_2", "Beta, Theran rounded form", "b", "Thera", ["M72 8 Q58 0 44 4 Q30 14 30 50 L30 76 Q30 100 55 100 Q80 100 80 76 Q80 52 55 52 Q40 52 30 62"]),
    GR("beta_argos", "Beta, Argive form", "b", "Argos", ["M72 0 L32 10 L32 100 L72 86"]),
    GR("beta_melos", "Beta, Melian form", "b", "Melos", ["M5 0 L35 100 L65 0 L95 92"]),
    GR("beta_gortyn", "Beta, Gortynian form", "b", "Gortyn (Crete)", ["M28 100 L28 25 Q28 0 52 0 Q76 0 76 20 Q76 40 56 36"]),
    GR("beta_corinth", "Beta, Corinthian form", "b", "Corinth", ["M0 100 L45 100 L45 0 L95 0 L95 22"]),
    GR("beta_megara", "Beta, Megarian/Byzantine form", "b", "Megara, Byzantium", ["M45 100 L45 0 L100 0 L100 20", "M0 30 L45 70"]),
    GR("delta_pointed_d", "Delta, pointed-D form", "d", "red (western) alphabets, Euboea", ["M25 0 L25 100 L80 80 Z"]),
    GR("epsilon_archaic", "Epsilon, archaic oblique-armed", "e", "early, general", ["M25 0 L25 100", "M25 0 L75 12", "M25 28 L75 40", "M25 56 L75 68"], note="Arms diagonal, stem descending below the lowest arm."),
    GR("epsilon_sicyon", "Sicyonian e-letter (X-shaped)", "e / ɛː", "Sicyon", ["M15 0 L85 0 L15 100 L85 100 Z"], note="Used at Sicyon for short e and open ɛː where Corinth used a B-shaped sign."),
    GR("eta_tack", "Thespian tack-eta", "e (raised)", "Thespiae (Boeotia), 424 BC", ["M28 0 L28 100", "M28 50 L78 50"], note="Short e before a vowel; one document (Jeffery 1961 pp.89,95)."),
    GR("digamma_oblique", "Digamma, oblique", "w", "early, general", ["M28 100 L28 0 L76 16", "M28 42 L76 58"]),
    GR("digamma_angular", "Digamma, angular (C-like)", "w", "later local", ["M80 0 L20 0 L20 100 L80 100"]),
    GR("digamma_crete", "Digamma, Cretan Y-derived", "w", "early Crete", ["M20 20 L20 100", "M75 0 L20 45 L65 80"], note="Resembles its model, Y-shaped Phoenician waw."),
    GR("digamma_crete_bent", "Digamma, Cretan bent-stem", "w", "early Crete", ["M5 100 L40 0 L90 100", "M68 55 L100 10"]),
    GR("gamma_pointed", "Gamma, pointed-C form", "g", "Euboea, mainland, West", ["M75 0 L20 50 L75 100"]),
    GR("iota_crooked_4", "Crooked iota, four strokes", "i", "early; kept where san replaced sigma", ["M30 0 L70 25 L32 50 L70 75 L30 100"]),
    GR("iota_crooked_3", "Crooked iota, three strokes", "i", "early", ["M70 0 L34 34 L70 66 L30 100"]),
    GR("lambda_gamma", "Lambda, Gamma-shaped", "l", "Euboea, Attica, Boeotia", ["M30 100 L30 0 L76 46"]),
    GR("mu_archaic", "Mu, archaic long-left-leg", "m", "early; kept where san used", ["M8 100 L30 0 L55 42 L76 4 L92 38"]),
    GR("pi_archaic", "Pi, short right leg", "p", "archaic, general", ["M22 100 L22 0 L80 0 L80 36"]),
    GR("pi_rounded", "Pi, rounded top", "p", "archaic", ["M25 100 L25 30 Q25 0 50 0 Q75 0 75 30 L75 42"]),
    GR("rho_tailed", "Rho, tailed (R-shaped)", "r", "red alphabets, Euboea", ["M25 100 L25 0 L52 0 Q78 0 78 25 Q78 50 52 50 L25 50", "M46 50 L72 78"]),
    GR("sigma_3stroke", "Sigma, three-stroke (S-like)", "s", "Attic, Euboean, several red alphabets", ["M75 0 L28 38 L75 70 L25 100"]),
    GR("tsan_mantinea", "Mantinean tsan (И-like)", "ts?", "Mantinea (Arcadocypriot)", ["M5 0 L35 100 L65 0 L95 92"], note="Probably [ts] from Proto-Greek *kʷ (Woodard 2006). Same shape as the Pamphylian digamma (U+0376 Ͷ) but a different letter."),
    GR("theta_crossed", "Theta, crossed", "th", "archaic, general", [circ(50, 50, 45), "M18 18 L82 82", "M82 18 L18 82"]),
    GR("upsilon_twig", "Upsilon, twig-shaped", "u", "many local scripts", ["M28 0 L28 100", "M28 55 L76 5"]),
    GR("upsilon_v", "Upsilon, V-shaped", "u", "many local scripts", ["M15 0 L50 100 L85 0"]),
    GR("psi_v", "Psi/Chi, branches from the bottom (V-shaped)", "ps / kh", "blue (ps) / red (kh) alphabets", ["M10 0 L50 100 L90 0", "M50 0 L50 100"]),
    GR("chi_arrow", "Psi/Chi, arrow form", "ps / kh", "local", ["M50 0 L50 100", "M15 64 L50 100 L85 64"]),
    GR("xi_archaic", "Xi, with vertical stem", "ks", "archaic", ["M12 0 L88 0", "M24 50 L76 50", "M12 100 L88 100", "M50 0 L50 100"]),
    GR("zeta_archaic", "Zeta, straight-stemmed (I-shaped)", "z(d)", "all archaic local alphabets", ["M15 0 L85 0", "M15 100 L85 100", "M50 0 L50 100"]),
]

SCRIPTS = [
    ("phrygian", "Phrygian (Old Phrygian alphabet)", "Indo-European carved scripts", PHRYGIAN,
     "Old Phrygian, 8th-4th c. BC; 19 standard letters (Obrador-Cursach) plus variants and the rare letters nos.19/20/23. Drawn dextroverse; sinistroverse texts mirror the letters."),
    ("proto_sinaitic", "Proto-Sinaitic (Early Alphabetic)", "Semitic & Canaanite", PROTO_SINAITIC,
     "Serabit el-Khadim and Wadi el-Hol, c.1900-1500 BC. Pictographic acrophonic signs; stance varies with writing direction. Values follow Albright/Colless as tabulated by Pandey 2019; several are disputed."),
    ("proto_canaanite", "Proto-Canaanite (Old Canaanite)", "Semitic & Canaanite", PROTO_CANAANITE,
     "Later, more linear Early Alphabetic forms from Canaan (c.13th-11th c. BC) before the Phoenician standard."),
    ("iberian", "Northeastern Iberian (Levantine) semi-syllabary", "Mediterranean (other)", IBERIAN,
     "Paleohispanic semi-syllabary for the (non-Indo-European) Iberian language, 4th-1st c. BC; dual signary distinguishing voiced/voiceless stops."),
    ("greek_epichoric", "Archaic Greek epichoric letter forms (not in Unicode)", "Indo-European carved scripts", GREEK,
     "Local archaic Greek letter shapes that Unicode Greek does not encode as distinct characters (digamma, qoppa, san, sampi, heta and Pamphylian digamma are already in Unicode)."),
]


def render(g, out_dir, sid):
    pts_x, pts_y = [], []
    for d in g["paths"]:
        x0, x1, y0, y1 = parse_path(d).bbox()
        pts_x += [x0, x1]; pts_y += [y0, y1]
    for (x, y) in g["dots"]:
        pts_x.append(x); pts_y.append(y)
    xmin, xmax, ymin, ymax = min(pts_x), max(pts_x), min(pts_y), max(pts_y)
    ext = max(xmax - xmin, ymax - ymin, 1e-6)
    s = (PX * (1 - 2 * PAD) - STROKE) / ext
    tx = PX / 2 - s * (xmin + xmax) / 2
    ty = PX / 2 - s * (ymin + ymax) / 2
    sw = STROKE / s
    body = "".join(f'<path d="{d}"/>' for d in g["paths"])
    dots = "".join(f'<circle cx="{x}" cy="{y}" r="{DOT / s:.3f}" fill="#000" stroke="none"/>' for x, y in g["dots"])
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{PX}" height="{PX}" viewBox="0 0 {PX} {PX}">'
           f'<g transform="translate({tx:.3f} {ty:.3f}) scale({s:.5f})" fill="none" stroke="#000" '
           f'stroke-width="{sw:.4f}" stroke-linecap="round" stroke-linejoin="round">{body}{dots}</g></svg>')
    open(os.path.join(out_dir, g["id"] + ".svg"), "w").write(svg)
    cairosvg.svg2png(bytestring=svg.encode(), write_to=os.path.join(out_dir, g["id"] + ".png"), output_width=PX, output_height=PX)


def build(out):
    index = []
    for sid, name, group, glyphs, note in SCRIPTS:
        sd = os.path.join(out, sid); os.makedirs(sd, exist_ok=True)
        ids = [g["id"] for g in glyphs]; assert len(ids) == len(set(ids)), sid
        cat_g = []
        for g in glyphs:
            render(g, sd, sid)
            e = {"cp": "-", "char": "", "name": g["name"], "translit": g["translit"], "meaning": g["meaning"],
                 "source": g["source"], "file": f"{sid}/{g['id']}.png"}
            if g["note"]:
                e["note"] = g["note"]
            cat_g.append(e)
        cat = {"id": sid, "name": name, "group": group, "note": note, "font": "drawn from published sign tables",
               "count": len(cat_g), "glyphs": cat_g}
        json.dump(cat, open(os.path.join(sd, "catalog.json"), "w"), ensure_ascii=False, indent=0)
        index.append({k: cat[k] for k in ("id", "name", "group", "note", "font", "count")})
        print(f"{sid}: {len(cat_g)}")
    json.dump({"scripts": index}, open(os.path.join(out, "index.json"), "w"), ensure_ascii=False, indent=1)
    sheet(out)


def sheet(out, cell=150, cols=10):
    from PIL import Image, ImageDraw, ImageFont
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13)
        hfont = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
    except Exception:
        font = hfont = ImageFont.load_default()
    rows = []
    for sid, name, *_ in SCRIPTS:
        cat = json.load(open(os.path.join(out, sid, "catalog.json")))
        rows.append(("H", f"{name}  ({cat['count']})"))
        gl = cat["glyphs"]
        for i in range(0, len(gl), cols):
            rows.append(("G", gl[i:i + cols]))
    H = sum(34 if k == "H" else cell + 22 for k, _ in rows)
    im = Image.new("RGB", (cols * cell, H + 10), "white"); d = ImageDraw.Draw(im); y = 5
    for k, v in rows:
        if k == "H":
            d.text((8, y + 8), v, fill=(120, 30, 30), font=hfont); y += 34; continue
        for j, g in enumerate(v):
            gi = Image.open(os.path.join(out, g["file"])).convert("RGBA").resize((cell - 20, cell - 20), Image.LANCZOS)
            x = j * cell
            d.rectangle([x + 4, y, x + cell - 4, y + cell - 4], outline=(220, 220, 220))
            im.paste(gi, (x + 10, y + 6), gi)
            lab = g["file"].split("/")[1][:-4] + " · " + g["translit"]
            d.text((x + 8, y + cell - 2), lab[:22], fill=(60, 60, 60), font=font)
        y += cell + 22
    im.save(os.path.join(out, "sheet.png"), optimize=True)


if __name__ == "__main__":
    build(sys.argv[1])
