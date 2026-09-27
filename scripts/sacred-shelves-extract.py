#!/usr/bin/env python3
"""sacred-shelves-extract.py — build the Hierophant's passage-level sacred-text shelves.

Reads the raw sources (each in its OWN native reference scheme) and writes one JSON object per
passage to OUT (JSON Lines):

  {id, ref, work, shelf, lang, text, tr?, tr_lang?, tr_src?, tr_label?, src, url, urn?, aliases, gloss?}

  id        URL-safe stable key (e.g. "tlg0012.tlg001:18.417-420", "hbo.Gen.6.4", "quran.55.15")
  ref       the human canonical reference ("Iliad 18.417–420", "Gen 6:4", "Qur'an 55:15")
  text      the ORIGINAL-language passage, verbatim from the source edition
  tr        an aligned translation where one exists (tr_lang says which language — TLA's is German)
  src       key into SOURCES (licence + attribution shown beside every cited passage)
  gloss     extra searchable words that are NOT displayed as a translation (ORACC lemma glosses)

Usage:  python3 sacred-shelves-extract.py RAW_DIR CORPUS_DIR OUT.jsonl
  RAW_DIR     the raw-source tree (Perseus/First1K/LXX/SBLGNT/morphhb/bibles/bilara/dcs/oracc/self/…)
  CORPUS_DIR  the normalised corpus tree (only TLA is read from here — its raw copy is the jsonl)

Licensing (public serving): non-commercial and unclear-licence sources are NOT read at all —
GRETIL (NC), ETCBC Peshitta OT (NC), UD Gothic-PROIEL (NC), hadith-json, daizhige, heimskringla.no,
the Latin Library dump, CrossWire Sahidic/Peshitta NT, and the Yusuf Ali / Shakir Qur'an renderings.
stdlib only; single-threaded.
"""
import json, os, re, sys, zipfile, glob, unicodedata
import xml.etree.ElementTree as ET

RAW, CORPUS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
TR_MAX = 1600          # translation characters kept per passage
TEXT_MAX = 1400        # split original prose units longer than this

SOURCES = {}           # filled as shelves register; written to OUT + '.sources.json'
def source(key, **kw):
    SOURCES[key] = kw
    return key

out = open(OUT, 'w', encoding='utf-8')
COUNT = {}
SEEN = set()
def emit(rec):
    rec = {k: v for k, v in rec.items() if v not in (None, '', [])}
    if not rec.get('text', '').strip():
        return
    if rec['id'] in SEEN:
        n = 2
        while f"{rec['id']}~{n}" in SEEN: n += 1
        rec['id'] = f"{rec['id']}~{n}"
    SEEN.add(rec['id'])
    if rec.get('tr') and len(rec['tr']) > TR_MAX:
        rec['tr'] = rec['tr'][:TR_MAX].rsplit(' ', 1)[0] + ' …'
    out.write(json.dumps(rec, ensure_ascii=False) + '\n')
    COUNT[rec['lang']] = COUNT.get(rec['lang'], 0) + 1

def ws(s):
    return re.sub(r'\s+', ' ', s or '').strip()

def split_long(text, limit=TEXT_MAX):
    """Split an over-long prose unit at sentence ends into ≤limit pieces (cited as 'part n')."""
    if len(text) <= limit: return [text]
    parts, cur = [], ''
    for s in re.split(r'(?<=[.;·:!?።])\s+', text):
        if cur and len(cur) + len(s) + 1 > limit:
            parts.append(cur); cur = s
        else:
            cur = (cur + ' ' + s).strip()
    if cur: parts.append(cur)
    return parts

# ───────────────────────── TEI / CTS (Perseus, First1K) ─────────────────────────
TEI = '{http://www.tei-c.org/ns/1.0}'
SKIP = {'note', 'bibl', 'head', 'teiHeader', 'del', 'figure', 'orig', 'sic', 'label', 'speaker', 'ref', 'app', 'rdg', 'argument'}
def local(tag): return tag.split('}', 1)[-1] if isinstance(tag, str) else ''

def tei_events(path):
    """Yield ('path', tuple) / ('anchor', kind, n) / ('text', s) / ('lend',) over the edition body."""
    try:
        root = ET.parse(path).getroot()
    except Exception as e:
        print('  ! parse', path, e, file=sys.stderr); return
    body = root.find(f'.//{TEI}body')
    if body is None: return
    ev = []
    def walk(el, p):
        tag = local(el.tag)
        if tag in SKIP:
            return
        newp = p
        if tag == 'div' and el.get('type') == 'textpart':
            if el.get('subtype') == 'card':
                ev.append(('anchor', 'card', el.get('n')))
            else:
                newp = p + (el.get('n') or '',)
                ev.append(('path', newp))
        if tag == 'l':
            ev.append(('anchor', 'l', el.get('n')))
        if tag == 'milestone':
            u = el.get('unit')
            if u in ('line', 'card', 'section', 'verse') and el.get('n'):
                ev.append(('anchor', u, el.get('n')))
        if tag == 'lb': ev.append(('text', ' '))
        if el.text: ev.append(('text', el.text))
        for c in el:
            walk(c, newp)
            if c.tail: ev.append(('text', c.tail))
        if tag == 'l': ev.append(('lend',))
        if tag == 'div' and el.get('type') == 'textpart' and el.get('subtype') != 'card':
            ev.append(('path', p))
        if tag in ('p', 'div', 'l'): ev.append(('text', ' '))
    walk(body, ())
    return ev

def lineno(n):
    m = re.match(r'\d+', n or '')
    return int(m.group()) if m else None

def tei_units(path, role):
    """role 'orig': units in the doc's citation scheme; role 'tr': translation segments by anchor.
    Returns (mode, [ {path, key, text} ]) — key is a line number (mode 'l'), a section string
    (mode 'section'), an anchor number (modes 'line'/'card'), or None (mode 'path')."""
    ev = tei_events(path) or []
    kinds = {e[1] for e in ev if e[0] == 'anchor'}
    if role == 'orig':
        # prose with Stephanus-style section milestones stays prose even when it quotes verse (<l>)
        mode = 'section' if 'section' in kinds else ('l' if 'l' in kinds else 'path')
    else:
        mode = 'line' if 'line' in kinds else ('card' if 'card' in kinds else ('section' if 'section' in kinds else 'path'))
    units, cur, p, key, in_l, lastl = [], None, (), None, False, 0
    def flush():
        nonlocal cur
        if cur and ws(cur['text']):
            cur['text'] = ws(cur['text']); units.append(cur)
        cur = None
    for e in ev:
        if e[0] == 'path':
            if e[1] != p:
                flush(); p = e[1]
                if mode == 'path': key = None
                if mode in ('line', 'card'): key = None
        elif e[0] == 'anchor':
            kind, n = e[1], e[2]
            if mode == 'l' and kind == 'l':
                flush(); in_l = True
                ln = lineno(n)
                lastl = ln if ln is not None else lastl + 1
                key = lastl
                cur = {'path': p, 'key': key, 'text': ''}
            elif mode == kind and mode != 'l':
                flush()
                key = lineno(n) if mode in ('line', 'card') else n
                cur = {'path': p, 'key': key, 'text': ''}
        elif e[0] == 'lend':
            if mode == 'l': flush(); in_l = False
        elif e[0] == 'text':
            if mode == 'l' and not in_l: continue
            if cur is None:
                if mode == 'l': continue
                cur = {'path': p, 'key': key, 'text': ''}
            cur['text'] += e[1]
    flush()
    if role == 'orig' and mode == 'l':
        # <l n="…"/> used as bare line markers (e.g. Corpus Hermeticum I) leave the verse lines empty —
        # when the lines hold under a third of the text, the prose divisions are the citation scheme
        total = sum(len(e[1].strip()) for e in ev if e[0] == 'text')
        if total and sum(len(u['text']) for u in units) < 0.33 * total:
            return tei_units_mode(ev, 'path')
    return mode, units

def tei_units_mode(ev, mode):
    units, cur, p = [], None, ()
    for e in ev:
        if e[0] == 'path' and e[1] != p:
            if cur and ws(cur['text']): cur['text'] = ws(cur['text']); units.append(cur)
            cur, p = None, e[1]
        elif e[0] == 'text':
            if cur is None: cur = {'path': p, 'key': None, 'text': ''}
            cur['text'] += e[1]
    if cur and ws(cur['text']): cur['text'] = ws(cur['text']); units.append(cur)
    return mode, units

def align_lookup(tr_mode, tr_units):
    """Index translation segments: by (path,key) and, for numeric anchors, sorted per path."""
    exact, ranges, bykey = {}, {}, {}
    for u in tr_units:
        exact.setdefault((u['path'], u['key']), []).append(u['text'])
        bykey.setdefault(u['key'], []).append(u['text'])
        if tr_mode in ('line', 'card') and u['key'] is not None:
            ranges.setdefault(u['path'], []).append((u['key'], u['text']))
    for p in ranges: ranges[p].sort(key=lambda x: x[0])
    return exact, ranges, bykey

def tr_for(al, tr_mode, path, lo, hi, key):
    exact, ranges, bykey = al
    if tr_mode in ('line', 'card'):
        lst = ranges.get(path)
        if not lst: return None, None
        segs, label_lo, label_hi = [], None, None
        for i, (a, t) in enumerate(lst):
            nxt = lst[i + 1][0] if i + 1 < len(lst) else 10 ** 9
            if a <= hi and nxt > lo:
                segs.append(t); label_lo = a if label_lo is None else label_lo; label_hi = nxt - 1
        if not segs: return None, None
        rng = f"{label_lo}" + (f"–{label_hi}" if label_hi and label_hi < 10 ** 8 and label_hi != label_lo else '')
        return ' '.join(segs), rng
    k = (path, key)
    if k in exact: return ' '.join(exact[k]), None
    if key is not None and key in bykey and len(bykey[key]) == 1: return bykey[key][0], None
    return None, None

def pick_file(d, prefixes):
    for pre in prefixes:
        fs = sorted(glob.glob(os.path.join(d, f'*.{pre}*.xml')))
        if fs: return fs[-1]
    return None

def cts_work(repo, group_work, title, shelf, lang, src_key, tr_src_key, url_base,
             orig_prefixes, tr_prefixes=('perseus-eng', '1st1K-eng'), drop_path=False, bib_style=False,
             tr_label_name='English'):
    g, w = group_work.split('.')
    d = os.path.join(RAW, repo, 'data', g, w)
    of = pick_file(d, orig_prefixes)
    if not of:
        print('  - missing', group_work, file=sys.stderr); return
    mode, units = tei_units(of, 'orig')
    ed = os.path.basename(of)[:-4]                    # e.g. tlg0012.tlg001.perseus-grc2
    # choose the translation that aligns best
    best = None
    for tf in sorted(glob.glob(os.path.join(d, '*.xml'))):
        b = os.path.basename(tf)
        if not any(p in b for p in tr_prefixes): continue
        tmode, tunits = tei_units(tf, 'tr')
        if not tunits: continue
        al = align_lookup(tmode, tunits)
        probe = units[:: max(1, len(units) // 60)]
        hits = sum(1 for u in probe if tr_for(al, tmode, u['path'], u['key'] if isinstance(u['key'], int) else 0,
                                                 u['key'] if isinstance(u['key'], int) else 0, u['key'])[0])
        if hits and (best is None or hits > best[0]):
            best = (hits, tmode, al, os.path.basename(tf)[:-4])
    urn_ns = 'greekLit' if g.startswith('tlg') else 'latinLit'
    sep = ':' if bib_style else '.'
    def mk(path, lo, hi, text, part=None):
        pth = () if drop_path else path
        if mode == 'l':
            span = f"{lo}" if lo == hi else f"{lo}–{hi}"
            cite = '.'.join(list(pth) + [span])
            idcite = '.'.join(list(pth) + [f"{lo}" if lo == hi else f"{lo}-{hi}"])
        elif mode == 'section':
            cite = '.'.join(list(pth) + [str(lo)]); idcite = cite
        else:
            cite = sep.join(pth) if bib_style and len(pth) == 2 else '.'.join(pth); idcite = '.'.join(pth)
        if part: cite += f" (part {part})"; idcite += f"~p{part}"
        tr = trl = None
        if best:
            _, tmode, al, ted = best
            key = lo if mode != 'l' else None
            tr, rng = tr_for(al, tmode, path, lo if isinstance(lo, int) else 0, hi if isinstance(hi, int) else 0, key)
            if tr:
                trl = f"{tr_label_name} (Perseus/OGL {ted.split('.')[-1]}" + (f", lines {rng}" if rng and tmode == 'line' else (f", card {rng}" if rng else '')) + ')'
        urn_psg = idcite.replace('–', '-').split('~')[0]
        urn = f"urn:cts:{urn_ns}:{ed}:{urn_psg}" if urn_psg else f"urn:cts:{urn_ns}:{ed}"
        aliases = [f"{title} {cite}"]
        bare = re.sub(r'\s*\([^)]*\)', '', title)          # "1 Enoch (Greek)" → "1 Enoch"
        if bare != title: aliases.append(f"{bare} {cite}")
        if ', ' in title: aliases.append(f"{title.split(', ', 1)[1]} {cite}")   # "Hesiod, Theogony" → "Theogony" 
        if mode == 'section' and re.match(r'^\d+[a-z]$', str(lo)):
            aliases.append(f"{title} {'.'.join(list(pth) + [str(lo)[:-1]])}")
        if mode == 'path' and pth and re.match(r'^\d+[a-z]$', pth[-1]) and not part:
            aliases.append(f"{title} {sep.join(list(pth[:-1]) + [pth[-1][:-1]])}")
        if mode == 'l' and lo != hi:
            aliases += [f"{title} {'.'.join(list(pth) + [str(n)])}" for n in range(lo, hi + 1)]
        emit({'id': f"{group_work}:{idcite}", 'ref': f"{title} {cite}".strip(), 'work': title, 'shelf': shelf,
              'lang': lang, 'text': text, 'tr': tr, 'tr_lang': 'en' if tr else None, 'tr_src': tr_src_key if tr else None,
              'tr_label': trl, 'src': src_key, 'urn': urn, 'url': url_base + urn + '/', 'aliases': aliases})
    if mode == 'l':
        # chunk ≤5 consecutive lines in a path, breaking at translation anchors so each chunk maps to one segment
        anchors = set()
        if best and best[1] in ('line', 'card'):
            for p, lst in best[2][1].items():
                for a, _ in lst: anchors.add((p, a))
        chunk = []
        def out_chunk():
            if chunk:
                mk(chunk[0]['path'], chunk[0]['key'], chunk[-1]['key'], ' / '.join(u['text'] for u in chunk))
        for u in units:
            if chunk and (u['path'] != chunk[0]['path'] or len(chunk) >= 5 or (u['path'], u['key']) in anchors
                          or u['key'] != chunk[-1]['key'] + 1):
                out_chunk(); chunk = []
            chunk.append(u)
        out_chunk()
    else:
        merged = {}
        order = []
        for u in units:        # merge fragments of the same unit (e.g. text split by a note)
            k = ((), u['key']) if drop_path else (u['path'], u['key'])
            if k not in merged: merged[k] = []; order.append(k)
            merged[k].append(u['text'])
        for k in order:
            text = ' '.join(merged[k])
            if bib_style: text = re.sub(r'^[\d¹²³⁴⁵⁶⁷⁸⁹⁰]+\s*', '', text)
            parts = split_long(text)
            for i, ptxt in enumerate(parts):
                mk(k[0], k[1], k[1], ptxt, part=(i + 1) if len(parts) > 1 else None)

def shelf_greek_latin():
    cc = 'https://creativecommons.org/licenses/by-sa/4.0/'
    source('perseus-grc', name='Perseus Digital Library — canonical-greekLit (Tufts University)', license='CC BY-SA 4.0', license_url=cc,
           home='https://github.com/PerseusDL/canonical-greekLit')
    source('perseus-lat', name='Perseus Digital Library — canonical-latinLit (Tufts University)', license='CC BY-SA 4.0', license_url=cc,
           home='https://github.com/PerseusDL/canonical-latinLit')
    source('first1k', name='Open Greek and Latin — First1KGreek (Leipzig / Harvard / Tufts)', license='CC BY-SA 4.0', license_url=cc,
           home='https://github.com/OpenGreekAndLatin/First1KGreek')
    source('perseus-eng', name='Perseus Digital Library — English translation (as released in canonical-greekLit / canonical-latinLit)', license='CC BY-SA 4.0', license_url=cc,
           home='https://www.perseus.tufts.edu/')
    source('first1k-eng', name='Open Greek and Latin — English translation (as released in First1KGreek)', license='CC BY-SA 4.0', license_url=cc,
           home='https://github.com/OpenGreekAndLatin/First1KGreek')
    scaife = 'https://scaife.perseus.org/reader/'
    P = ('perseus-grc', 'perseus-grc1')
    # Homer, Homeric Hymns, Hesiod
    cts_work('perseus-greek', 'tlg0012.tlg001', 'Iliad', 'greek', 'grc', 'perseus-grc', 'perseus-eng', scaife, P)
    cts_work('perseus-greek', 'tlg0012.tlg002', 'Odyssey', 'greek', 'grc', 'perseus-grc', 'perseus-eng', scaife, P)
    for i in range(1, 34):
        cts_work('perseus-greek', f'tlg0013.tlg{i:03d}', f'Homeric Hymn {i}', 'greek', 'grc', 'perseus-grc', 'perseus-eng', scaife, P)
    for w, t in (('tlg001', 'Theogony'), ('tlg002', 'Works and Days'), ('tlg003', 'Shield of Heracles')):
        cts_work('perseus-greek', f'tlg0020.{w}', f'Hesiod, {t}', 'greek', 'grc', 'perseus-grc', 'perseus-eng', scaife, P)
    # Plato — every dialogue Perseus carries, cited by Stephanus page
    idx = json.load(open(os.path.join(RAW, 'cts_index.json')))
    for repo, gw, author, title, eds in idx:
        if gw.startswith('tlg0059.') and repo == 'perseus-greek':
            cts_work('perseus-greek', gw, f'Plato, {title}', 'greek', 'grc', 'perseus-grc', 'perseus-eng', scaife, P, drop_path=True)
    # Orphica (fragments; the Orphic Hymns are not in either repository), Corpus Hermeticum, Greek Enoch
    cts_work('first1kgreek', 'tlg0579.tlg010', 'Orphica, Fragmenta', 'greek', 'grc', 'first1k', 'first1k-eng', scaife, ('1st1K-grc',))
    roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII']
    for i in range(1, 19):
        cts_work('first1kgreek', f'tlg1286.tlg{i:03d}', f'Corpus Hermeticum {roman[i]}', 'greek', 'grc', 'first1k', 'first1k-eng', scaife, ('1st1K-grc',))
    cts_work('first1kgreek', 'tlg1286.tlg020', 'Hermetica, Fragmenta', 'greek', 'grc', 'first1k', 'first1k-eng', scaife, ('1st1K-grc',))
    cts_work('first1kgreek', 'tlg1463.tlg001', '1 Enoch (Greek)', 'greek', 'grc', 'first1k', 'first1k-eng', scaife, ('1st1K-grc1', '1st1K-grc2'), bib_style=True)
    # companions most asked of the Hierophant
    cts_work('perseus-greek', 'tlg0007.tlg089', 'Plutarch, De Iside et Osiride', 'greek', 'grc', 'perseus-grc', 'perseus-eng', scaife, P)
    cts_work('first1kgreek', 'tlg2023.tlg006', 'Iamblichus, De Mysteriis', 'greek', 'grc', 'first1k', 'first1k-eng', scaife, ('1st1K-grc',))
    cts_work('first1kgreek', 'tlg0018.tlg001', 'Philo, De Opificio Mundi', 'greek', 'grc', 'first1k', 'first1k-eng', scaife, ('1st1K-grc',))
    cts_work('first1kgreek', 'tlg0018.tlg007', 'Philo, De Gigantibus', 'greek', 'grc', 'first1k', 'first1k-eng', scaife, ('1st1K-grc',))
    # Latin
    cts_work('perseus-latin', 'phi0959.phi006', 'Ovid, Metamorphoses', 'latin', 'la', 'perseus-lat', 'perseus-eng', scaife, ('perseus-lat',))
    cts_work('perseus-latin', 'phi1212.phi002', 'Apuleius, Metamorphoses', 'latin', 'la', 'perseus-lat', 'perseus-eng', scaife, ('perseus-lat',))
    cts_work('perseus-latin', 'phi1212.phi001', 'Apuleius, Apologia', 'latin', 'la', 'perseus-lat', 'perseus-eng', scaife, ('perseus-lat',))
    cts_work('perseus-latin', 'phi1212.phi003', 'Apuleius, Florida', 'latin', 'la', 'perseus-lat', 'perseus-eng', scaife, ('perseus-lat',))
    cts_work('first1kgreek', 'tlg1286.tlg019', 'Asclepius', 'latin', 'la', 'first1k', 'first1k-eng', scaife, ('1st1K-lat',))

# ───────────────────────── Bibles ─────────────────────────
# OSIS code, English name (scrollmapper headings), short citation form
BOOKS = [('Gen', 'Genesis', 'Gen'), ('Exod', 'Exodus', 'Exod'), ('Lev', 'Leviticus', 'Lev'), ('Num', 'Numbers', 'Num'),
 ('Deut', 'Deuteronomy', 'Deut'), ('Josh', 'Joshua', 'Josh'), ('Judg', 'Judges', 'Judg'), ('Ruth', 'Ruth', 'Ruth'),
 ('1Sam', 'I Samuel', '1 Sam'), ('2Sam', 'II Samuel', '2 Sam'), ('1Kgs', 'I Kings', '1 Kgs'), ('2Kgs', 'II Kings', '2 Kgs'),
 ('1Chr', 'I Chronicles', '1 Chr'), ('2Chr', 'II Chronicles', '2 Chr'), ('Ezra', 'Ezra', 'Ezra'), ('Neh', 'Nehemiah', 'Neh'),
 ('Tob', 'Tobit', 'Tob'), ('Jdt', 'Judith', 'Jdt'), ('Esth', 'Esther', 'Esth'), ('Job', 'Job', 'Job'), ('Ps', 'Psalms', 'Ps'),
 ('Prov', 'Proverbs', 'Prov'), ('Eccl', 'Ecclesiastes', 'Eccl'), ('Song', 'Song of Solomon', 'Song'), ('Wis', 'Wisdom', 'Wis'),
 ('Sir', 'Sirach', 'Sir'), ('Isa', 'Isaiah', 'Isa'), ('Jer', 'Jeremiah', 'Jer'), ('Lam', 'Lamentations', 'Lam'), ('Bar', 'Baruch', 'Bar'),
 ('Ezek', 'Ezekiel', 'Ezek'), ('Dan', 'Daniel', 'Dan'), ('Hos', 'Hosea', 'Hos'), ('Joel', 'Joel', 'Joel'), ('Amos', 'Amos', 'Amos'),
 ('Obad', 'Obadiah', 'Obad'), ('Jonah', 'Jonah', 'Jonah'), ('Mic', 'Micah', 'Mic'), ('Nah', 'Nahum', 'Nah'), ('Hab', 'Habakkuk', 'Hab'),
 ('Zeph', 'Zephaniah', 'Zeph'), ('Hag', 'Haggai', 'Hag'), ('Zech', 'Zechariah', 'Zech'), ('Mal', 'Malachi', 'Mal'),
 ('1Macc', 'I Maccabees', '1 Macc'), ('2Macc', 'II Maccabees', '2 Macc'),
 ('Matt', 'Matthew', 'Matt'), ('Mark', 'Mark', 'Mark'), ('Luke', 'Luke', 'Luke'), ('John', 'John', 'John'), ('Acts', 'Acts', 'Acts'),
 ('Rom', 'Romans', 'Rom'), ('1Cor', 'I Corinthians', '1 Cor'), ('2Cor', 'II Corinthians', '2 Cor'), ('Gal', 'Galatians', 'Gal'),
 ('Eph', 'Ephesians', 'Eph'), ('Phil', 'Philippians', 'Phil'), ('Col', 'Colossians', 'Col'), ('1Thess', 'I Thessalonians', '1 Thess'),
 ('2Thess', 'II Thessalonians', '2 Thess'), ('1Tim', 'I Timothy', '1 Tim'), ('2Tim', 'II Timothy', '2 Tim'), ('Titus', 'Titus', 'Titus'),
 ('Phlm', 'Philemon', 'Phlm'), ('Heb', 'Hebrews', 'Heb'), ('Jas', 'James', 'Jas'), ('1Pet', 'I Peter', '1 Pet'), ('2Pet', 'II Peter', '2 Pet'),
 ('1John', 'I John', '1 John'), ('2John', 'II John', '2 John'), ('3John', 'III John', '3 John'), ('Jude', 'Jude', 'Jude'),
 ('Rev', 'Revelation of John', 'Rev')]
BY_OSIS = {b[0]: b for b in BOOKS}
BY_NAME = {b[1]: b[0] for b in BOOKS}
LONG = {'Gen': 'Genesis', 'Exod': 'Exodus', 'Lev': 'Leviticus', 'Num': 'Numbers', 'Deut': 'Deuteronomy', 'Josh': 'Joshua',
        'Judg': 'Judges', '1Sam': '1 Samuel', '2Sam': '2 Samuel', '1Kgs': '1 Kings', '2Kgs': '2 Kings', '1Chr': '1 Chronicles',
        '2Chr': '2 Chronicles', 'Neh': 'Nehemiah', 'Tob': 'Tobit', 'Jdt': 'Judith', 'Esth': 'Esther', 'Ps': 'Psalms', 'Prov': 'Proverbs',
        'Eccl': 'Ecclesiastes', 'Song': 'Song of Songs', 'Wis': 'Wisdom', 'Sir': 'Sirach', 'Isa': 'Isaiah', 'Jer': 'Jeremiah',
        'Lam': 'Lamentations', 'Bar': 'Baruch', 'Ezek': 'Ezekiel', 'Dan': 'Daniel', 'Hos': 'Hosea', 'Obad': 'Obadiah', 'Mic': 'Micah',
        'Nah': 'Nahum', 'Hab': 'Habakkuk', 'Zeph': 'Zephaniah', 'Hag': 'Haggai', 'Zech': 'Zechariah', 'Mal': 'Malachi',
        '1Macc': '1 Maccabees', '2Macc': '2 Maccabees', 'Matt': 'Matthew', 'Rom': 'Romans', '1Cor': '1 Corinthians',
        '2Cor': '2 Corinthians', 'Gal': 'Galatians', 'Eph': 'Ephesians', 'Phil': 'Philippians', 'Col': 'Colossians',
        '1Thess': '1 Thessalonians', '2Thess': '2 Thessalonians', '1Tim': '1 Timothy', '2Tim': '2 Timothy', 'Phlm': 'Philemon',
        'Heb': 'Hebrews', 'Jas': 'James', '1Pet': '1 Peter', '2Pet': '2 Peter', '1John': '1 John', '2John': '2 John',
        '3John': '3 John', 'Rev': 'Revelation'}

def bib_aliases(osis, c, v):
    short = BY_OSIS[osis][2] if osis in BY_OSIS else osis
    out = {f"{short} {c}:{v}", f"{osis} {c}:{v}", f"{osis}.{c}.{v}"}
    if osis in LONG: out.add(f"{LONG[osis]} {c}:{v}")
    return sorted(out)

def read_scrollmapper(name):
    """{(osis, chapter, verse): text} from bibles/formats/txt/<name>.txt ('### Book' + '[c:v] text')."""
    d, book = {}, None
    p = os.path.join(RAW, 'bibles', 'formats', 'txt', f'{name}.txt')
    for line in open(p, encoding='utf-8'):
        line = line.rstrip('\n')
        if line.startswith('### '):
            book = BY_NAME.get(line[4:].strip()); continue
        m = re.match(r'\[(\d+):(\d+)\]\s*(.*)', line)
        if m and book:
            d[(book, int(m.group(1)), int(m.group(2)))] = m.group(3).strip()
    return d

def shelf_bibles():
    source('wlc', name='Westminster Leningrad Codex (via Open Scriptures Hebrew Bible)', license='Public domain (WLC text)', license_url='https://github.com/openscriptures/morphhb',
           home='https://github.com/openscriptures/morphhb')
    source('sblgnt', name='SBL Greek New Testament — Copyright © 2010 Society of Biblical Literature and Logos Bible Software', license='CC BY 4.0',
           license_url='https://creativecommons.org/licenses/by/4.0/', home='https://github.com/Faithlife/SBLGNT')
    source('lxx-swete', name='Septuagint, ed. H. B. Swete (1909–30), digitised by First1KGreek / nathans/lxx-swete', license='CC BY-SA 4.0',
           license_url='https://creativecommons.org/licenses/by-sa/4.0/', home='https://github.com/nathans/lxx-swete')
    source('vulgate', name='Clementine Vulgate (scrollmapper/bible_databases)', license='Public domain', license_url='https://github.com/scrollmapper/bible_databases',
           home='https://github.com/scrollmapper/bible_databases')
    source('bsb', name='Berean Standard Bible', license='Public domain (dedicated CC0 2023)', license_url='https://berean.bible/terms.htm', home='https://berean.bible/')
    source('drc', name='Douay-Rheims Bible, Challoner revision', license='Public domain', license_url='https://github.com/scrollmapper/bible_databases', home='https://github.com/scrollmapper/bible_databases')
    bsb, drc, vul = read_scrollmapper('BSB'), read_scrollmapper('DRC'), read_scrollmapper('VulgClementine')
    # WLC → KJV/BSB versification map
    vmap = {}
    try:
        vm = ET.parse(os.path.join(RAW, 'morphhb', 'wlc', 'VerseMap.xml')).getroot()
        for v in vm.iter():
            if local(v.tag) == 'verse' and v.get('wlc') and v.get('kjv'):
                a, b = v.get('wlc').split('.'), v.get('kjv').split('.')
                num = lambda x: int(re.match(r'\d+', x).group())
                ka = (a[0], num(a[1]), num(a[2]))
                if ka not in vmap: vmap[ka] = (b[0], num(b[1]), num(b[2]), v.get('type'))
    except Exception as e:
        print('  ! versemap', e, file=sys.stderr)
    # Hebrew Bible
    for f in sorted(glob.glob(os.path.join(RAW, 'morphhb', 'wlc', '*.xml'))):
        if f.endswith('VerseMap.xml'): continue
        root = ET.parse(f).getroot()
        for v in root.iter():
            if local(v.tag) != 'verse': continue
            osis, c, n = v.get('osisID').split('.')
            words = []
            for w in v.iter():
                t = local(w.tag)
                if t == 'w' and w.text: words.append(w.text.replace('/', ''))
                elif t == 'seg' and w.text and w.get('type') == 'x-maqqef' and words: words[-1] += w.text
                elif t == 'seg' and w.text and w.get('type') in ('x-sof-pasuq', 'x-pe', 'x-samekh'): words.append(w.text)
            text = re.sub(r'\s+([׃־])', r'\1', ' '.join(words)).replace('־ ', '־')
            c, n = int(c), int(n)
            k = vmap.get((osis, c, n))
            ek = (k[0], k[1], k[2]) if k else (osis, c, n)
            tr = bsb.get(ek)
            lbl = None
            if tr:
                lbl = 'English: Berean Standard Bible' + (f" {BY_OSIS[ek[0]][2]} {ek[1]}:{ek[2]} (English versification)" if k else '')
            short = BY_OSIS[osis][2]
            emit({'id': f"hbo.{osis}.{c}.{n}", 'ref': f"{short} {c}:{n}", 'work': f"Hebrew Bible — {LONG.get(osis, osis)}", 'shelf': 'hebrew',
                  'lang': 'hbo', 'text': text, 'tr': tr, 'tr_lang': 'en' if tr else None, 'tr_src': 'bsb' if tr else None, 'tr_label': lbl,
                  'src': 'wlc', 'url': f"https://www.sefaria.org/{LONG.get(osis, osis).replace(' ', '_')}.{c}.{n}?lang=he",
                  'aliases': bib_aliases(osis, c, n)})
    # Greek NT (SBLGNT)
    for f in sorted(glob.glob(os.path.join(RAW, 'sblgnt', 'data', 'sblgnt', 'text', '*.txt'))):
        for line in open(f, encoding='utf-8'):
            m = re.match(r'(\S+) (\d+):(\d+)\t(.*)', line.strip())
            if not m: continue
            osis, c, n, text = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4).strip()
            if osis not in BY_OSIS: continue
            tr = bsb.get((osis, c, n))
            short = BY_OSIS[osis][2]
            emit({'id': f"grc.{osis}.{c}.{n}", 'ref': f"{short} {c}:{n}", 'work': f"New Testament (SBLGNT) — {LONG.get(osis, osis)}",
                  'shelf': 'greek', 'lang': 'grc', 'text': text, 'tr': tr, 'tr_lang': 'en' if tr else None, 'tr_src': 'bsb' if tr else None,
                  'tr_label': 'English: Berean Standard Bible' if tr else None, 'src': 'sblgnt',
                  'url': f"https://sblgnt.com/", 'aliases': bib_aliases(osis, c, n)})
    # Septuagint (Swete): file per book, one word per line "book.chapter.verse word"
    LXX = {'Genesis': 'Gen', 'Exodus': 'Exod', 'Leviticus': 'Lev', 'Numeri': 'Num', 'Deuteronomium': 'Deut', 'Josue': 'Josh',
           'Judices': 'Judg', 'Ruth': 'Ruth', 'Regnorum_I': '1Sam', 'Regnorum_II': '2Sam', 'Regnorum_III': '1Kgs',
           'Regnorum_IV': '2Kgs', 'Paralipomenon_I': '1Chr', 'Paralipomenon_II': '2Chr', 'Esdras_A': '1Esd', 'Esdras_B': 'Ezra',
           'Esther': 'Esth', 'Judith': 'Jdt', 'Tobias': 'Tob', 'Machabaeorum_i': '1Macc', 'Machabaeorum_ii': '2Macc',
           'Machabaeorum_iii': '3Macc', 'Machabaeorum_iv': '4Macc', 'Psalmi': 'Ps', 'Odae': 'Odes', 'Proverbia': 'Prov',
           'Canticum': 'Song', 'Job': 'Job', 'Sapientia_Salomonis': 'Wis', 'Ecclesiasticus': 'Sir', 'Psalmi_Salomonis': 'PssSol',
           'Osee': 'Hos', 'Amos': 'Amos', 'Michaeas': 'Mic', 'Joel': 'Joel', 'Abdias': 'Obad', 'Jonas': 'Jonah', 'Nahum': 'Nah',
           'Habacuc': 'Hab', 'Sophonias': 'Zeph', 'Aggaeus': 'Hag', 'Zacharias': 'Zech', 'Malachias': 'Mal', 'Isaias': 'Isa',
           'Jeremias': 'Jer', 'Baruch': 'Bar', 'Threni_seu_Lamentationes': 'Lam', 'Epistula_Jeremiae': 'EpJer', 'Ezechiel': 'Ezek',
           'Susanna_translatio_Graeca': 'Sus', 'Susanna_Theodotionis_versio': 'SusTh', 'Daniel_translatio_Graeca': 'DanOG',
           'Daniel_Theodotionis_versio': 'Dan', 'Bel_et_Draco_translatio_Graeca': 'Bel', 'Bel_et_Draco_Theodotionis_versio': 'BelTh'}
    LXX_NAMES = {'1Esd': '1 Esdras', '3Macc': '3 Maccabees', '4Macc': '4 Maccabees', 'Odes': 'Odes', 'PssSol': 'Psalms of Solomon',
                 'EpJer': 'Epistle of Jeremiah', 'Sus': 'Susanna (Old Greek)', 'SusTh': 'Susanna (Theodotion)', 'DanOG': 'Daniel (Old Greek)',
                 'Bel': 'Bel and the Dragon (Old Greek)', 'BelTh': 'Bel and the Dragon (Theodotion)'}
    for f in sorted(glob.glob(os.path.join(RAW, 'lxx-swete', 'data', '*.txt'))):
        name = os.path.basename(f)[:-4].split('.', 1)[1]
        osis = LXX.get(name)
        if not osis: continue
        verses, order = {}, []
        for line in open(f, encoding='utf-8'):
            parts = line.rstrip('\n').split(' ', 1)
            if len(parts) != 2: continue
            ref = parts[0].split('.')
            if len(ref) != 3: continue
            k = (ref[1], ref[2])
            if k not in verses: verses[k] = []; order.append(k)
            verses[k].append(parts[1])
        for (c, n) in order:
            text = ' '.join(verses[(c, n)])
            short = BY_OSIS[osis][2] if osis in BY_OSIS else LXX_NAMES.get(osis, osis)
            tr = lbl = trsrc = None
            if c.isdigit() and n.isdigit():
                ci, ni = int(c), int(n)
                eo = 'Dan' if osis in ('Dan', 'DanOG') else osis
                # Psalms/deuterocanon follow Greek/Latin numbering → Douay-Rheims; protocanon → BSB
                if eo in ('Ps', 'Tob', 'Jdt', 'Wis', 'Sir', 'Bar', '1Macc', '2Macc') or eo not in BY_OSIS:
                    tr = drc.get((eo, ci, ni)); trsrc = 'drc'; lbl = 'English: Douay-Rheims (translated from the Vulgate; Greek/Latin numbering)'
                else:
                    tr = bsb.get((eo, ci, ni)); trsrc = 'bsb'; lbl = 'English: Berean Standard Bible (from the Hebrew; verse-number alignment)'
            aliases = [f"LXX {short} {c}:{n}", f"{short} {c}:{n}"]
            if osis in BY_OSIS: aliases += bib_aliases(osis, c, n)
            emit({'id': f"lxx.{osis}.{c}.{n}", 'ref': f"LXX {short} {c}:{n}", 'work': f"Septuagint (Swete) — {LONG.get(osis, LXX_NAMES.get(osis, osis))}",
                  'shelf': 'greek', 'lang': 'grc', 'text': text, 'tr': tr, 'tr_lang': 'en' if tr else None, 'tr_src': trsrc if tr else None,
                  'tr_label': lbl if tr else None, 'src': 'lxx-swete', 'url': 'https://github.com/nathans/lxx-swete', 'aliases': sorted(set(aliases))})
    # Vulgate + Douay-Rheims (same numbering)
    for (osis, c, n), text in vul.items():
        tr = drc.get((osis, c, n))
        short = BY_OSIS[osis][2]
        emit({'id': f"vul.{osis}.{c}.{n}", 'ref': f"Vulg. {short} {c}:{n}", 'work': f"Vulgate — {LONG.get(osis, osis)}", 'shelf': 'latin',
              'lang': 'la', 'text': text, 'tr': tr, 'tr_lang': 'en' if tr else None, 'tr_src': 'drc' if tr else None,
              'tr_label': 'English: Douay-Rheims (Challoner)' if tr else None, 'src': 'vulgate',
              'url': 'https://github.com/scrollmapper/bible_databases', 'aliases': [f"Vulg. {short} {c}:{n}", f"Vulgate {short} {c}:{n}"] + bib_aliases(osis, c, n)})

# ───────────────────────── Qur'an ─────────────────────────
def shelf_quran():
    source('tanzil', name='Tanzil Quran Text (Uthmani), Copyright © 2007-2021 Tanzil Project — tanzil.net (verbatim)', license='CC BY 3.0 (verbatim copies only)',
           license_url='https://creativecommons.org/licenses/by/3.0/', home='https://tanzil.net')
    source('pickthall', name='M. M. Pickthall, The Meaning of the Glorious Koran (1930), via Project Gutenberg #16955', license='Public domain (published 1930; US term expired 31 Dec 2025; author d. 1936)',
           license_url='https://www.gutenberg.org/ebooks/16955', home='https://www.gutenberg.org/ebooks/16955')
    pick, cur, collecting = {}, None, False
    for line in open(os.path.join(RAW, 'self', 'gutenberg', '16955.txt'), encoding='utf-8', errors='replace'):
        s = line.strip()
        m = re.match(r'^(\d{3})\.(\d{3})$', s)
        if m: cur = (int(m.group(1)), int(m.group(2))); collecting = False; continue
        if cur and s.startswith('P:'):
            pick[cur] = s[2:].strip(); collecting = True; continue
        if collecting:
            if not s or re.match(r'^[YSP]:', s): collecting = False
            else: pick[cur] += ' ' + s
    for line in open(os.path.join(RAW, 'self', 'tanzil', 'quran-uthmani.txt'), encoding='utf-8'):
        if line.startswith('#') or '|' not in line: continue
        su, ay, text = line.rstrip('\n').split('|', 2)
        su, ay = int(su), int(ay)
        tr = pick.get((su, ay))
        emit({'id': f"quran.{su}.{ay}", 'ref': f"Qur'an {su}:{ay}", 'work': "The Qur'an", 'shelf': 'arabic', 'lang': 'ar',
              'text': text, 'tr': tr, 'tr_lang': 'en' if tr else None, 'tr_src': 'pickthall' if tr else None,
              'tr_label': 'English: Pickthall (1930)' if tr else None, 'src': 'tanzil', 'url': f"https://tanzil.net/#{su}:{ay}",
              'aliases': [f"Qur'an {su}:{ay}", f"Quran {su}:{ay}", f"Koran {su}:{ay}", f"Q {su}:{ay}", f"Sura {su}:{ay}"]})

# ───────────────────────── Pali (SuttaCentral bilara) ─────────────────────────
def shelf_pali():
    source('bilara', name='SuttaCentral bilara-data — Mahāsaṅgīti Pali root text', license='CC0 1.0', license_url='https://creativecommons.org/publicdomain/zero/1.0/',
           home='https://github.com/suttacentral/bilara-data')
    source('sujato', name='SuttaCentral — English translation by Bhikkhu Sujato / Bhikkhu Brahmali', license='CC0 1.0',
           license_url='https://creativecommons.org/publicdomain/zero/1.0/', home='https://suttacentral.net')
    trs = {}
    for f in glob.glob(os.path.join(RAW, 'bilara', 'translation', 'en', '*', '**', '*.json'), recursive=True):
        uid = os.path.basename(f).split('_')[0]
        try: trs[uid] = (json.load(open(f, encoding='utf-8')), os.path.basename(f).split('-')[-1][:-5])
        except Exception: pass
    for f in sorted(glob.glob(os.path.join(RAW, 'bilara', 'root', 'pli', 'ms', '**', '*.json'), recursive=True)):
        uid = os.path.basename(f).split('_')[0]
        try: root = json.load(open(f, encoding='utf-8'))
        except Exception: continue
        tr, who = trs.get(uid, ({}, ''))
        groups, order = {}, []
        for seg, txt in root.items():
            if ':' not in seg: continue
            head, tail = seg.split(':', 1)
            g = head + ':' + (tail.rsplit('.', 1)[0] if '.' in tail else tail)
            if g not in groups: groups[g] = []; order.append(g)
            groups[g].append(seg)
        for g in order:
            segs = groups[g]
            strip = lambda x: re.sub(r'<[^>]+>', '', x or '')
            text = ws(strip(' '.join(root[s] for s in segs)))
            if not text: continue
            en = ws(strip(' '.join(tr.get(s, '') for s in segs)))
            first, last = segs[0].split(':', 1)[1], segs[-1].split(':', 1)[1]
            span = first if first == last else f"{first}–{last}"
            m = re.match(r'^([a-z-]+)(\d.*)$', uid)
            human = f"{m.group(1).upper()} {m.group(2)}" if m else uid
            ref = f"{human}:{span}"
            emit({'id': f"{uid}:{first}" + (f"-{last}" if first != last else ''), 'ref': ref, 'work': f"Pali Canon — {human}", 'shelf': 'pali', 'lang': 'pi',
                  'text': text, 'tr': en or None, 'tr_lang': 'en' if en else None, 'tr_src': 'sujato' if en else None,
                  'tr_label': f'English: SuttaCentral ({who})' if en else None, 'src': 'bilara',
                  'url': f"https://suttacentral.net/{uid}/en/{who or 'sujato'}#{segs[0]}",
                  'aliases': [ref, f"{human}:{first}", f"{uid}:{first}"] + ([human, uid] if g == order[0] else [])})

# ───────────────────────── Sanskrit (DCS) ─────────────────────────
def shelf_sanskrit():
    source('dcs', name='Digital Corpus of Sanskrit (DCS), Oliver Hellwig', license='CC BY 4.0', license_url='https://creativecommons.org/licenses/by/4.0/',
           home='https://github.com/OliverHellwig/sanskrit')
    base = os.path.join(RAW, 'dcs', 'dcs', 'data', 'conllu', 'files')
    for textdir in sorted(os.listdir(base)):
        d = os.path.join(base, textdir)
        if not os.path.isdir(d): continue
        for f in sorted(glob.glob(os.path.join(d, '*.conllu'))):
            chap = None; cite = None; n = 0
            try: lines = open(f, encoding='utf-8').read().split('\n')
            except Exception: continue
            sent = None
            for line in lines:
                if line.startswith('## chapter:'): cite = line.split(':', 1)[1].strip()
                elif line.startswith('# text = '): sent = line[9:].strip()
                elif line.startswith('# sent_id = ') and sent:
                    sid = line.split('=', 1)[1].strip()
                    n += 1
                    c = re.sub(r',\s*', '.', cite or '').replace(' ', '')
                    # "ṚV, 1, 1" → work abbreviation + "1.1"; sentence ordinal within the DCS chapter
                    m = re.match(r'^([^.]+)\.(.*)$', c)
                    abbr, loc = (m.group(1), m.group(2)) if m else (c, '')
                    ref = f"{textdir} {loc} (DCS s.{n})" if loc else f"{textdir} (DCS s.{n})"
                    emit({'id': f"dcs.{sid}", 'ref': ref, 'work': textdir, 'shelf': 'sanskrit', 'lang': 'sa', 'text': sent,
                          'src': 'dcs', 'url': 'https://github.com/OliverHellwig/sanskrit',
                          'aliases': ([f"{abbr} {loc}".strip(), f"{textdir} {loc}".strip(), f"dcs {sid}"]
                                      + ([f"RV {loc}", f"Rigveda {loc}"] if textdir == 'Ṛgveda' else [])) if n == 1 else [f"dcs {sid}"]})
                    sent = None

# ───────────────────────── Egyptian (TLA) ─────────────────────────
def shelf_egyptian():
    source('tla', name='Thesaurus Linguae Aegyptiae (BBAW / Sächsische Akademie der Wissenschaften), corpus release via Hugging Face',
           license='CC BY-SA 4.0', license_url='https://creativecommons.org/licenses/by-sa/4.0/', home='https://thesaurus-linguae-aegyptiae.de')
    sets = [('tla-Earlier_Egyptian_original-v18', 'ee18', 'Earlier Egyptian', 'thesaurus-linguae-aegyptiae/tla-Earlier_Egyptian_original-v18-premium'),
            ('tla-late_egyptian-v19', 'le19', 'Late Egyptian', 'thesaurus-linguae-aegyptiae/tla-late_egyptian-v19-premium'),
            ('tla-demotic-v18', 'dem18', 'Demotic', 'thesaurus-linguae-aegyptiae/tla-demotic-v18-premium')]
    for d, short, label, hf in sets:
        p = os.path.join(CORPUS, 'egyptian', d, 'data.jsonl')
        if not os.path.exists(p): continue
        for i, line in enumerate(open(p, encoding='utf-8')):
            r = json.loads(line)
            tl = ws(r.get('transliteration'))
            hg = ws(re.sub(r'<g>[^<]*</g>', '', r.get('hieroglyphs') or ''))
            text = tl if not hg else f"{hg}\n{tl}"
            de = ws(r.get('translation_de'))
            date = r.get('date') or []
            emit({'id': f"tla.{short}.{i}", 'ref': f"TLA {label} #{i}", 'work': f"Thesaurus Linguae Aegyptiae — {label}" + (f" ({date[0]} to {date[1]})" if len(date) == 2 else ''),
                  'shelf': 'egyptian', 'lang': 'egy', 'text': text, 'tr': de or None, 'tr_lang': 'de' if de else None,
                  'tr_src': 'tla' if de else None, 'tr_label': 'German (TLA translation)' if de else None, 'src': 'tla',
                  'url': f"https://huggingface.co/datasets/{hf}/viewer/default/train?row={i}",
                  'aliases': [f"TLA {short} {i}"]})

# ───────────────────────── Akkadian / Sumerian (ORACC) ─────────────────────────
def shelf_oracc():
    for f in sorted(glob.glob(os.path.join(RAW, 'oracc', '*.zip'))):
        try: z = zipfile.ZipFile(f)
        except Exception: continue
        for name in z.namelist():
            if '/corpusjson/' not in name or not name.endswith('.json'): continue
            try: d = json.loads(z.read(name))
            except Exception: continue
            proj = d.get('project', ''); tid = d.get('textid', '')
            lic = d.get('license', '') or 'ORACC open data'
            lurl = d.get('license-url', '') or 'http://oracc.org/doc/opendata/'
            skey = 'oracc:' + ('cc0' if 'CC0' in lic else ('ccbysa3' if 'Share' in lic or 'BY-SA' in lic.upper() else 'other'))
            if skey not in SOURCES:
                source(skey, name='ORACC — Open Richly Annotated Cuneiform Corpus (project data)', license=('CC0 1.0' if 'cc0' in skey else ('CC BY-SA 3.0' if 'bysa' in skey else lic[:80])),
                       license_url=lurl, home='http://oracc.org/doc/opendata/')
            lines, cur = [], None
            def walk(nodes):
                nonlocal cur
                for n in nodes:
                    if n.get('node') == 'd' and n.get('type') == 'line-start':
                        cur = {'label': n.get('label') or n.get('n') or '', 'forms': [], 'gloss': [], 'langs': {}}
                        lines.append(cur)
                    elif n.get('node') == 'l' and cur is not None:
                        fr = n.get('f', {})
                        cur['forms'].append(n.get('frag') or fr.get('form') or '')
                        lg = (fr.get('lang') or '')[:3]
                        cur['langs'][lg] = cur['langs'].get(lg, 0) + 1
                        for k in ('cf', 'gw', 'sense'):
                            if fr.get(k): cur['gloss'].append(fr[k])
                    if n.get('cdl'): walk(n['cdl'])
            walk(d.get('cdl', []))
            lines = [l for l in lines if sum(1 for x in l['forms'] if x.strip('x.[]# ')) >= 1]
            for i in range(0, len(lines), 3):
                grp = lines[i:i + 3]
                text = '\n'.join(' '.join(l['forms']) for l in grp)
                langs = {}
                for l in grp:
                    for k, v in l['langs'].items(): langs[k] = langs.get(k, 0) + v
                lang = 'sux' if langs.get('sux', 0) > langs.get('akk', 0) else 'akk'
                lo, hi = grp[0]['label'], grp[-1]['label']
                span = lo if lo == hi else f"{lo} – {hi}"
                gl = ' '.join(sorted(set(' '.join(' '.join(l['gloss']) for l in grp).split())))
                emit({'id': f"oracc.{proj.replace('/', '-')}.{tid}.{i // 3}", 'ref': f"{tid} {span}", 'work': f"ORACC {proj} {tid}",
                      'shelf': 'cuneiform', 'lang': lang, 'text': text, 'gloss': gl, 'src': skey,
                      'url': f"http://oracc.org/{proj}/{tid}", 'aliases': [f"{tid} {lo}", f"{proj} {tid} {lo}"]})

# ───────────────────────── Ge'ez 1 Enoch (Beta maṣāḥǝft) + Charles English ─────────────────────────
def shelf_geez():
    source('betamasaheft', name='Beta maṣāḥǝft (Universität Hamburg) — Maṣḥafa Henok, LIT1340EnochE', license='CC BY-SA 4.0',
           license_url='https://creativecommons.org/licenses/by-sa/4.0/', home='https://betamasaheft.eu/works/LIT1340EnochE')
    source('charles', name='R. H. Charles, The Book of Enoch (1917), via Wikisource', license='Public domain', license_url='https://en.wikisource.org/wiki/The_Book_of_Enoch_(Charles)',
           home='https://en.wikisource.org/wiki/The_Book_of_Enoch_(Charles)')
    # Charles: {chapter: {verse: text}}
    charles = {}
    try:
        data = json.load(open(os.path.join(RAW, 'self', 'wikisource', 'The_Book_of_Enoch_Charles_.json'), encoding='utf-8'))
        blob = '\n'.join(x if isinstance(x, str) else json.dumps(x, ensure_ascii=False) for x in (data if isinstance(data, list) else [data]))
        roman = {v: i for i, v in enumerate(['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'])}
        def rn(s):
            vals = {'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100}; t = 0
            for i, ch in enumerate(s):
                v = vals[ch]; t += -v if i + 1 < len(s) and vals[s[i + 1]] > v else v
            return t
        for m in re.finditer(r'CHAPTER ([IVXLC]+)\.(.*?)(?=CHAPTER [IVXLC]+\.|$)', blob, re.S):
            ch = rn(m.group(1)); body = m.group(2).replace('\\n', ' ')
            vs = {}
            for vm in re.finditer(r'(?:^|\s)(\d{1,3})\.\s(.*?)(?=\s\d{1,3}\.\s|$)', body, re.S):
                vs[int(vm.group(1))] = ws(vm.group(2))
            if vs: charles[ch] = vs
    except Exception as e:
        print('  ! charles', e, file=sys.stderr)
    f = glob.glob(os.path.join(RAW, 'self', 'betamasaheft-works', '*', 'LIT1340EnochE.xml'))
    if not f: return
    root = ET.parse(f[0]).getroot()
    for ch in root.iter(f'{TEI}div'):
        if ch.get('subtype') != 'chapter': continue
        c = ch.get('n')
        if not (c and c.isdigit()): continue
        ci = int(c)
        verses = [(l.get('n'), ws(''.join(l.itertext()))) for l in ch.iter(f'{TEI}l') if l.get('n')]
        if verses:
            for n, text in verses:
                tr = charles.get(ci, {}).get(int(n)) if n.isdigit() else None
                emit({'id': f"gez.enoch.{c}.{n}", 'ref': f"1 Enoch {c}:{n}", 'work': "1 Enoch (Ge'ez, Maṣḥafa Henok)", 'shelf': 'geez', 'lang': 'gez',
                      'text': text, 'tr': tr, 'tr_lang': 'en' if tr else None, 'tr_src': 'charles' if tr else None,
                      'tr_label': 'English: R. H. Charles (1917)' if tr else None, 'src': 'betamasaheft',
                      'url': 'https://betamasaheft.eu/works/LIT1340EnochE', 'aliases': [f"1 Enoch {c}:{n}", f"Enoch {c}:{n}", f"1En {c}:{n}"]})
        else:
            text = ws(' '.join(''.join(ab.itertext()) for ab in ch.iter(f'{TEI}ab')))
            if not text: continue
            sents = [s.strip() for s in re.split(r'(?<=።)', text) if s.strip()]
            vs = charles.get(ci, {})
            full = ' '.join(f"{k}. {v}" for k, v in sorted(vs.items()))
            for i in range(0, len(sents), 3):
                chunk = ' '.join(sents[i:i + 3])
                emit({'id': f"gez.enoch.{c}.s{i + 1}", 'ref': f"1 Enoch {c} (sent. {i + 1}–{min(i + 3, len(sents))})", 'work': "1 Enoch (Ge'ez, Maṣḥafa Henok)",
                      'shelf': 'geez', 'lang': 'gez', 'text': chunk, 'tr': full or None, 'tr_lang': 'en' if full else None,
                      'tr_src': 'charles' if full else None, 'tr_label': f'English: R. H. Charles (1917), whole chapter {c} (the Ge\'ez edition is not verse-divided here)' if full else None,
                      'src': 'betamasaheft', 'url': 'https://betamasaheft.eu/works/LIT1340EnochE',
                      'aliases': [f"1 Enoch {c}", f"Enoch {c}"] if i == 0 else []})

STEPS = [('greek+latin (CTS)', shelf_greek_latin), ('bibles', shelf_bibles), ('quran', shelf_quran), ('pali', shelf_pali),
         ('egyptian', shelf_egyptian), ('geez', shelf_geez), ('cuneiform', shelf_oracc), ('sanskrit', shelf_sanskrit)]
only = set(os.environ.get('ONLY', '').split(',')) - {''}
for name, fn in STEPS:
    if only and name.split()[0].split('+')[0] not in only: continue
    print('==', name, file=sys.stderr, flush=True)
    fn()
    print('   counts so far', COUNT, file=sys.stderr, flush=True)
out.close()
json.dump({'sources': SOURCES, 'counts': COUNT}, open(OUT + '.sources.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps(COUNT), file=sys.stderr)
