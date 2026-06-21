// language-catalog.mjs — the DATA LAYER for Hathor's Language Center curriculum.
//
// Operator's vision: Hathor should be READY TO TEACH languages — "like learning a programming language,
// get all the libraries." A curated, BY-FAMILY catalog of LEGITIMATE teaching resources (grammars,
// courses, textbooks, dictionaries/lexicons, corpora, writing systems) — the verified seed list the
// Resource Center (our web scraper) fans out to and ingests into the Language Center corpus, and that
// Hathor teaches FROM, using the Jesuit "Ratio Studiorum" method.
//
// Pure data + lookups (no network, no keys, soft surface) — same shape as credentials/grants/hierophant
// catalogs, and REGISTRY-READY (each entry carries the fields the coming Resource-Center source registry
// needs: id, family, language, type, url). Resources were web-verified by research agents (2026-06-19).
//
//   import { FAMILIES, RESOURCES, byFamily, byLanguage, getResource, search, JESUIT_METHOD,
//            hierophantXref, familiesWithCounts, validateCatalog } from './language-catalog.mjs'
//   node integrations/language-catalog.mjs              # coverage report
//   node integrations/language-catalog.mjs kurdish      # one family

export const BRAND_GUARDRAIL =
  'Every resource is a legitimate, verified source — universities, the Internet Archive, established '
  + 'academic/NLP projects, recognized open references. Free and primary sources first; we link out to '
  + 'the source and teach by the Jesuit (Ratio Studiorum) method.';

// ── families (the by-family spine; ordered for presentation) ──────────────────────────────────────
export const FAMILIES = [
  { id: 'kurdish',       name: 'Kurdish',                       blurb: 'Kurmanji (Northern), Sorani (Central), and Zaza-Gorani — grammars, courses, dictionaries, corpora and both writing systems (Hawar-Latin, Sorani-Arabic). The operator\'s priority.' },
  { id: 'biblical',      name: 'Biblical & Phoenician',         blurb: 'The scripture languages — Koine Greek (the NT), Biblical Hebrew (the Tanakh), Aramaic, and Phoenician/Punic (the @punicwax lineage). Each ties to a Hierophant text.' },
  { id: 'ancient-near-east', name: 'Ancient Near East',         blurb: 'The deep layer — Egyptian hieroglyphs, Akkadian (the lingua franca of the Bronze Age), Sumerian, Ugaritic and Proto-Canaanite/Proto-Sinaitic (the birth of the alphabet). The languages of the oldest Hierophant texts.' },
  { id: 'indo-european', name: 'Ancient Indo-European',         blurb: 'Sanskrit & Vedic, Proto-Indo-European, Latin and Classical Greek, and the older layers — Avestan, Old Persian, Hittite. Taught by the Jesuit method.' },
  { id: 'african',       name: 'Cushitic & Berber (Afroasiatic)', blurb: 'Berber/Amazigh (Tifinagh) and Cushitic (Somali, Oromo, Afar, Beja) — the Afroasiatic family that links Berber + Cushitic + Egyptian, tying into the Hierophant\'s Egyptian material.' },
  { id: 'modern-world',  name: 'Modern world languages',        blurb: 'The living lingua francas Hathor speaks to the world in — Mandarin (Simplified Chinese), Korean, and Russian. Grammar, courses, dictionaries and corpora for real, current use.' },
];
const FAMILY_IDS = new Set(FAMILIES.map((f) => f.id));

// kind order for sorting within a family: foundational first.
const TYPE_RANK = { course: 0, textbook: 1, grammar: 2, method: 3, reader: 4, dictionary: 5, lexicon: 5, corpus: 6, 'writing-system': 7 };

function r(id, name, family, language, type, level, url, note, verified = true) {
  return { id, name, family, language, type, level, url, note, verified };
}

export const RESOURCES = [
  // ── Kurdish (agent-verified 2026-06-19) ──────────────────────────────────────────────────────────
  r('kurmanji-thackston-grammar', 'Kurmanji Kurdish: A Reference Grammar (Thackston)', 'kurdish', 'kurmanji', 'grammar', 'reference', 'https://archive.org/details/thackston-2006-kurmanji-grammar-readings', 'Harvard standard grammar + readings, free PDF'),
  r('sorani-thackston-grammar', 'Sorani Kurdish: A Reference Grammar (Thackston)', 'kurdish', 'sorani', 'grammar', 'reference', 'https://archive.org/details/thackston-2006-sorani-grammar-readings', 'Harvard standard grammar + readings, free PDF'),
  r('zazaki-grammar-sketch', 'Zazaki Grammar Sketch (Forum-Linguistik)', 'kurdish', 'zaza-gorani', 'grammar', 'reference', 'https://forum-linguistik.de/sites/www.forum-linguistik.de/files/uploads/Zazaki%20Grammar%20Sketch%20English%20(from%20Dictionary%202012).pdf', 'English grammar sketch: noun inflection, POS'),
  r('sorani-celcar-textbook', 'Sorani: An Elementary Textbook (CeLCAR, Indiana Univ.)', 'kurdish', 'sorani', 'textbook', 'beginner', 'https://celcar.indiana.edu/materials/textbooks.html', 'University textbook w/ audio/video'),
  r('iu-sorani-course', 'Indiana Univ. CEUS Sorani course sequence', 'kurdish', 'sorani', 'course', 'intermediate', 'https://academics.iu.edu/courses/bloomington/ceus-t-655-intermediate-sorani-kurdish-i.html', 'Accredited intro→advanced Sorani track'),
  r('kurmanji-beginners', 'Kurmanji Kurdish for Beginners', 'kurdish', 'kurmanji', 'textbook', 'beginner', 'https://www.scribd.com/doc/97642408/Kurmanji-Kurdish-For-The-Beginners', 'Open beginner course; alphabet→basics'),
  r('ferhenga-biruski', 'Ferhenga Birûskî (Chyet) Kurmanji–English', 'kurdish', 'kurmanji', 'dictionary', 'reference', 'https://www.tplondon.com/ferheng/', 'Seminal scholarly dict; Latin+Arabic, cognates'),
  r('wikiferheng', 'Wîkîferheng (Kurdish Wiktionary)', 'kurdish', 'kurdish-general', 'dictionary', 'reference', 'https://ku.wiktionary.org/', 'Crowdsourced; Kurmanji/Sorani/Zazaki cross-refs'),
  r('vejinlex', 'VejînLex', 'kurdish', 'kurdish-general', 'dictionary', 'reference', 'https://lex.vejin.net/en', 'Modern multi-dialect Kurdish online lexicon'),
  r('asosoft-corpus', 'AsoSoft Text Corpus', 'kurdish', 'sorani', 'corpus', 'reference', 'https://github.com/AsoSoft/AsoSoft-Text-Corpus', 'First large-scale Central Kurdish text corpus'),
  r('interdialect-corpus', 'Interdialect Parallel Corpus (Sorani-Kurmanji-English)', 'kurdish', 'kurdish-general', 'corpus', 'reference', 'https://github.com/KurdishBLARK/InterdialectCorpus', '12k+ aligned pairs; cross-dialect'),
  r('zazagorani-corpus', 'Zaza-Gorani Corpus (Ahmadi)', 'kurdish', 'zaza-gorani', 'corpus', 'reference', 'https://github.com/sinaahmadi/ZazaGoraniCorpus', '1.6M Zazaki + 194k Gorani tokens'),
  r('awesome-kurdish', 'awesome-kurdish (curated index)', 'kurdish', 'kurdish-general', 'corpus', 'reference', 'https://github.com/sinaahmadi/awesome-kurdish', 'Master index of all dialects\' corpora/dicts/tools'),
  r('klpt', 'KLPT — Kurdish Language Processing Toolkit', 'kurdish', 'kurdish-general', 'corpus', 'reference', 'https://github.com/sinaahmadi/klpt', 'Python: tokenize/stem/transliterate Sorani+Kurmanji'),
  r('omniglot-kurdish', 'Omniglot — Kurdish alphabets', 'kurdish', 'kurdish-general', 'writing-system', 'reference', 'https://www.omniglot.com/writing/kurdish.htm', 'Hawar-Latin, Sorani-Arabic, Cyrillic charts'),

  // ── Biblical & Phoenician (agent-verified) ───────────────────────────────────────────────────────
  r('mounce-greek', 'Bill Mounce — Basics of Biblical Greek', 'biblical', 'koine-greek', 'course', 'beginner', 'https://www.billmounce.com/greek', 'Standard NT-Greek textbook + free video lectures'),
  r('daily-dose-greek', 'Daily Dose of Greek', 'biblical', 'koine-greek', 'course', 'beginner', 'https://dailydoseofgreek.com/', 'Free 2-min daily NT screencasts'),
  r('daily-dose-hebrew', 'Daily Dose of Hebrew', 'biblical', 'biblical-hebrew', 'course', 'beginner', 'https://dailydoseofhebrew.com/', 'Free daily Hebrew (+Aramaic) screencasts'),
  r('sblgnt', 'SBL Greek New Testament (SBLGNT)', 'biblical', 'koine-greek', 'corpus', 'reference', 'https://sblgnt.com/download/', 'Free CC critical Greek NT, downloadable Unicode'),
  r('stepbible-data', 'STEPBible-Data (CC-BY tagged texts)', 'biblical', 'koine-greek', 'corpus', 'reference', 'https://github.com/STEPBible/STEPBible-Data', 'Open tagged Greek/Hebrew data; brain-ingestable'),
  r('step-bible', 'STEP Bible (Tyndale House, Cambridge)', 'biblical', 'koine-greek', 'reader', 'reference', 'https://www.stepbible.org/', 'Free interlinear NT/OT + lexicon/morphology', false),
  r('bdb-lexicon', 'Brown-Driver-Briggs Hebrew Lexicon (Blue Letter Bible)', 'biblical', 'biblical-hebrew', 'lexicon', 'reference', 'https://www.blueletterbible.org/resources/lexical/bdb.cfm', 'BDB online, Strong\'s-keyed; +Biblical Aramaic'),
  r('gesenius-grammar', 'Gesenius\' Hebrew Grammar (Cowley 1910)', 'biblical', 'biblical-hebrew', 'grammar', 'advanced', 'https://en.wikisource.org/wiki/Gesenius%27_Hebrew_Grammar', 'The definitive reference grammar, free'),
  r('oshb', 'Open Scriptures Hebrew Bible (OSHB)', 'biblical', 'biblical-hebrew', 'corpus', 'advanced', 'https://hb.openscriptures.org/', 'Open morphology-tagged Tanakh (WLC)'),
  r('pealim', 'Pealim — Hebrew verb/word tables', 'biblical', 'biblical-hebrew', 'reader', 'beginner', 'https://www.pealim.com/', 'Free 9,200-word conjugation/dictionary'),
  r('cal-aramaic', 'Comprehensive Aramaic Lexicon (HUC)', 'biblical', 'aramaic', 'lexicon', 'advanced', 'https://cal.huc.edu/', 'Searchable Aramaic dict + Biblical/Imperial corpora'),
  r('krahmalkov-phoenician', 'Krahmalkov — A Phoenician-Punic Grammar', 'biblical', 'phoenician-punic', 'grammar', 'advanced', 'https://archive.org/details/charles-r.-krahmalkov-a-phoenician-punic-grammar', 'Standard descriptive grammar (borrow)', false),
  r('cip-phoenician', 'Corpus Inscriptionum Phoenicarum (CSIC)', 'biblical', 'phoenician-punic', 'corpus', 'advanced', 'http://cip.cchs.csic.es/intro', 'The 10,000+ Phoenician-Punic inscriptions'),

  // ── Ancient Indo-European + Sanskrit (agent-verified) ────────────────────────────────────────────
  r('whitney-sanskrit-grammar', 'Whitney, Sanskrit Grammar', 'indo-european', 'sanskrit', 'grammar', 'advanced', 'https://en.wikisource.org/wiki/Sanskrit_Grammar_(Whitney)', 'Canonical grammar; Classical + Vedic'),
  r('monier-williams', 'Monier-Williams Dictionary (Cologne CDSL)', 'indo-european', 'sanskrit', 'dictionary', 'reference', 'https://www.sanskrit-lexicon.uni-koeln.de/', '~160k entries; 40+ merged dictionaries'),
  r('wikner-sanskrit', 'Wikner, A Practical Sanskrit Introductory', 'indo-european', 'sanskrit', 'course', 'beginner', 'https://archive.org/details/ApracticalSI', '15 free lessons to dictionary-reading level'),
  r('goldman-devavani', 'Goldman, Devavāṇīpraveśikā (Berkeley)', 'indo-european', 'sanskrit', 'textbook', 'beginner', 'https://southasia.berkeley.edu/devavanipravesika-introduction-sanskrit-language', 'Berkeley standard university intro'),
  r('learnsanskrit-org', 'learnsanskrit.org', 'indo-european', 'sanskrit', 'course', 'beginner', 'https://learnsanskrit.org/', 'Free modern grammar guide + web reader'),
  r('gretil', 'GRETIL (Göttingen e-text archive)', 'indo-european', 'sanskrit', 'corpus', 'reference', 'https://gretil.sub.uni-goettingen.de/gretil.html', 'Sanskrit/Pali/Prakrit plain-text archive'),
  r('sanskrit-library', 'The Sanskrit Library (Scharf)', 'indo-european', 'sanskrit', 'corpus', 'reference', 'https://sanskritlibrary.org/', 'Texts + manuscripts + integrated tools'),
  r('dcs', 'Digital Corpus of Sanskrit (DCS)', 'indo-european', 'sanskrit', 'corpus', 'advanced', 'http://www.sanskrit-linguistics.org/dcs/', 'Lemmatized, POS-tagged, sandhi-split; ~5.6M words'),
  r('macdonell-vedic', 'Macdonell, Vedic Grammar for Students', 'indo-european', 'vedic', 'grammar', 'advanced', 'https://archive.org/details/vedicgrammarfors00macduoft', 'Standard student grammar of the Vedic layer'),
  r('mallory-adams-pie', 'Mallory & Adams, Oxford Intro to PIE', 'indo-european', 'pie', 'textbook', 'intermediate', 'https://global.oup.com/academic/product/the-oxford-introduction-to-proto-indo-european-and-the-proto-indo-european-world-9780199296682', 'Standard intro to reconstruction + culture'),
  r('fortson-ie', 'Fortson, Indo-European Language and Culture', 'indo-european', 'pie', 'textbook', 'intermediate', 'https://www.wiley.com/en-us/Indo+European+Language+and+Culture%3A+An+Introduction%2C+2nd+Edition-p-9781405188968', 'Leading survey of all IE branches'),
  r('perseus', 'Perseus Digital Library (Tufts)', 'indo-european', 'classical-greek', 'corpus', 'reference', 'https://www.perseus.tufts.edu/hopper/', 'Greek+Latin texts w/ morph + LSJ/Lewis-Short'),
  r('logeion', 'Logeion (Univ. of Chicago)', 'indo-european', 'classical-greek', 'lexicon', 'reference', 'https://logeion.uchicago.edu/', 'Unified LSJ + ~20 Greek/Latin dictionaries'),
  r('smyth-greek', 'Smyth, Greek Grammar (Attic)', 'indo-european', 'classical-greek', 'grammar', 'advanced', 'https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.04.0007', 'Canonical reference grammar of Attic Greek'),
  r('athenaze', 'Athenaze (reading-method Greek)', 'indo-european', 'classical-greek', 'textbook', 'beginner', 'https://global.oup.com/academic/product/athenaze-9780199363209', 'Reading-method Attic via continuous narrative'),
  r('allen-greenough', 'Allen & Greenough, New Latin Grammar', 'indo-european', 'latin', 'grammar', 'reference', 'https://dcc.dickinson.edu/grammar/latin/preface', 'Standard reference grammar, free at Dickinson'),
  r('orberg-llpsi', 'Ørberg, Lingua Latina per se Illustrata', 'indo-european', 'latin', 'method', 'beginner', 'https://hackettpublishing.com/lingua-latina-per-se-illustrata-series', 'Full natural/immersion method, Latin-only'),
  r('titus', 'TITUS Thesaurus (Frankfurt)', 'indo-european', 'avestan', 'corpus', 'advanced', 'https://titus.uni-frankfurt.de/texte/texte2.htm', 'Avestan, Old Persian, Hittite text database'),
  r('kent-old-persian', 'Kent, Old Persian: Grammar, Texts, Lexicon', 'indo-european', 'old-persian', 'grammar', 'advanced', 'https://archive.org/details/oldpersiangramma00kent', 'Standard grammar + Achaemenid inscriptions'),

  // ── Ancient Near East — Egyptian / Akkadian / Sumerian / Canaanite (canonical sources) ───────────
  r('gardiner-egyptian', 'Gardiner, Egyptian Grammar (hieroglyphs)', 'ancient-near-east', 'egyptian', 'grammar', 'reference', 'https://archive.org/details/egyptiangrammar0000alan', 'The classic hieroglyphic grammar + sign list'),
  r('allen-middle-egyptian', 'Allen, Middle Egyptian (Cambridge)', 'ancient-near-east', 'egyptian', 'textbook', 'beginner', 'https://www.cambridge.org/highereducation/books/middle-egyptian/4F5C2B2C5A2F', 'The standard university intro to hieroglyphs'),
  r('jsesh', 'JSesh — hieroglyphic text editor', 'ancient-near-east', 'egyptian', 'writing-system', 'all', 'https://jsesh.qenherkhopeshef.org/', 'Free open hieroglyph editor (Manuel de Codage)'),
  r('tla-egyptian', 'Thesaurus Linguae Aegyptiae (TLA)', 'ancient-near-east', 'egyptian', 'corpus', 'reference', 'https://thesaurus-linguae-aegyptiae.de/', 'Annotated corpus + lexicon of Egyptian texts'),
  r('huehnergard-akkadian', 'Huehnergard, A Grammar of Akkadian', 'ancient-near-east', 'akkadian', 'grammar', 'advanced', 'https://www.eisenbrauns.org/books/titles/978-1-57506-922-7.html', 'Standard teaching grammar of Akkadian'),
  r('oracc', 'ORACC — Open Richly Annotated Cuneiform Corpus', 'ancient-near-east', 'akkadian', 'corpus', 'reference', 'http://oracc.museum.upenn.edu/', 'Annotated Akkadian/Sumerian corpus + glossaries'),
  r('epsd2', 'ePSD2 — electronic Pennsylvania Sumerian Dictionary', 'ancient-near-east', 'sumerian', 'dictionary', 'reference', 'http://oracc.museum.upenn.edu/epsd2/', 'The standard online Sumerian dictionary'),
  r('cdli', 'CDLI — Cuneiform Digital Library Initiative', 'ancient-near-east', 'akkadian', 'corpus', 'reference', 'https://cdli.mpiwg-berlin.mpg.de/', 'Catalogue + images of cuneiform tablets'),
  r('huehnergard-ugaritic', 'Huehnergard, An Introduction to Ugaritic', 'ancient-near-east', 'ugaritic', 'textbook', 'intermediate', 'https://www.bakerpublishinggroup.com/books/an-introduction-to-ugaritic/345970', 'Ugaritic — the closest cousin to Phoenician/Hebrew'),
  r('proto-sinaitic', 'Proto-Sinaitic / Proto-Canaanite (Goldwasser, the alphabet\'s birth)', 'ancient-near-east', 'proto-canaanite', 'reader', 'reference', 'https://www.biblicalarchaeology.org/daily/ancient-cultures/ancient-near-eastern-world/how-the-alphabet-was-born-from-hieroglyphs/', 'How the alphabet was born from hieroglyphs — Canaanite roots'),

  // ── Cushitic & Berber / Afroasiatic (agent-verified 2026-06-19) ──────────────────────────────────
  r('fsi-somali', 'FSI Somali Basic Course (Live Lingua)', 'african', 'somali', 'course', 'beginner', 'https://www.livelingua.com/courses/somali', 'Free public-domain US gov course, audio+text'),
  r('saeed-somali-grammar', 'Saeed — Somali Reference Grammar', 'african', 'somali', 'grammar', 'advanced', 'https://catalog.hathitrust.org/Record/101895330', 'Standard scholarly Somali reference grammar'),
  r('livelingua-oromo', 'Peace Corps / Live Lingua — Oromo course', 'african', 'oromo', 'course', 'beginner', 'https://www.livelingua.com/courses/oromo', 'Free Afaan Oromo lessons, audio included'),
  r('owens-oromo-grammar', 'Owens — A Grammar of Harar Oromo', 'african', 'oromo', 'grammar', 'advanced', 'https://archive.org/details/rosettaproject_hae_morsyn-1', 'Rigorous descriptive grammar of an Oromo dialect'),
  r('bliese-afar', 'Bliese — A Generative Grammar of Afar (SIL)', 'african', 'afar', 'grammar', 'advanced', 'https://www.sil.org/system/files/reapdata/96/88/83/96888390144449810754009642919732851555/15387.pdf', 'Open PDF; Lowland East Cushitic'),
  r('beja-learners-grammar', 'Wedekind et al — A Learner\'s Grammar of Beja', 'african', 'beja', 'textbook', 'beginner', 'https://www.koeppe.de/titel_a-learner-s-grammar-of-beja-east-sudan', 'Pedagogical grammar+texts; the philological Egypt bridge'),
  r('kawachi-sidaama', 'Kawachi — A Grammar of Sidaama', 'african', 'cushitic-general', 'grammar', 'advanced', 'https://www.acsu.buffalo.edu/~dryer/KawachiSidaama.pdf', 'Open dissertation; Highland East Cushitic'),
  r('ircam-amazigh', 'IRCAM — Royal Institute of Amazigh Culture', 'african', 'berber-amazigh', 'course', 'all', 'https://www.ircam.ma', 'Official Moroccan institute: textbooks, dicts, Tifinagh'),
  r('inalco-berber', 'INALCO — Licence Berbère/Tamazight', 'african', 'berber-amazigh', 'course', 'beginner', 'https://www.inalco.fr/', 'Paris university Berber degree; Kabyle/Chleuh/Touareg'),
  r('heath-tamashek', 'Heath — A Grammar of Tamashek (Tuareg of Mali)', 'african', 'tuareg', 'grammar', 'advanced', 'https://www.researchgate.net/publication/332709814_A_Grammar_of_Tamashek_Tuareg_of_Mali', 'Definitive Tuareg reference grammar'),
  r('lexilogos-berber', 'Lexilogos — Berber/Kabyle dictionaries hub', 'african', 'kabyle', 'dictionary', 'all', 'https://www.lexilogos.com/touareg_dictionnaire.htm', 'Aggregates standard Berber/Tuareg dictionaries'),
  r('afroasiatic-cambridge', 'Frajzyngier & Shay — The Afroasiatic Languages', 'african', 'afroasiatic', 'textbook', 'advanced', 'https://www.cambridge.org/gb/universitypress/subjects/languages-linguistics/african-and-caribbean-language-and-linguistics/afroasiatic-languages', 'Family overview: Egyptian+Semitic+Berber+Cushitic+Chadic'),
  r('glottolog-cushitic', 'Glottolog — Cushitic classification', 'african', 'cushitic-general', 'corpus', 'reference', 'https://glottolog.org/resource/languoid/id/cush1243', 'Authoritative classification + per-language bibliography'),

  // ── Modern world languages — Mandarin / Korean / Russian (canonical free sources) ────────────────
  r('chinese-grammar-wiki', 'Chinese Grammar Wiki (AllSet Learning)', 'modern-world', 'mandarin', 'grammar', 'all', 'https://resources.allsetlearning.com/chinese/grammar/', 'The standard free Mandarin grammar reference, by level'),
  r('hsk-official', 'HSK — official Chinese proficiency standard', 'modern-world', 'mandarin', 'course', 'all', 'https://www.chinesetest.cn/', 'The official HSK levels/curriculum (Simplified)'),
  r('mdbg', 'MDBG Chinese-English Dictionary', 'modern-world', 'mandarin', 'dictionary', 'reference', 'https://www.mdbg.net/chinese/dictionary', 'Free CC-CEDICT dictionary; Simplified+Traditional, pinyin'),
  r('fsi-chinese', 'FSI Standard Chinese (Live Lingua)', 'modern-world', 'mandarin', 'course', 'beginner', 'https://www.livelingua.com/courses/chinese', 'Free public-domain US gov Mandarin course, audio'),
  r('ttmik', 'Talk To Me In Korean', 'modern-world', 'korean', 'course', 'beginner', 'https://talktomeinkorean.com/', 'The most-used structured free Korean course'),
  r('howtostudykorean', 'How To Study Korean', 'modern-world', 'korean', 'grammar', 'all', 'https://www.howtostudykorean.com/', 'Free in-depth Korean grammar from zero→advanced'),
  r('sejong-korean', 'King Sejong Institute (online Korean)', 'modern-world', 'korean', 'course', 'beginner', 'https://www.iksi.or.kr/', 'Official Korean-government language program'),
  r('naver-korean-dict', 'Naver Korean Dictionary', 'modern-world', 'korean', 'dictionary', 'reference', 'https://en.dict.naver.com/', 'The standard Korean-English reference dictionary'),
  r('openrussian', 'OpenRussian', 'modern-world', 'russian', 'dictionary', 'reference', 'https://en.openrussian.org/', 'Free Russian dictionary w/ stress, audio, conjugations'),
  r('fsi-russian', 'FSI Russian (Live Lingua)', 'modern-world', 'russian', 'course', 'beginner', 'https://www.livelingua.com/courses/russian', 'Free public-domain US gov Russian course, audio'),
  r('master-russian', 'Master Russian', 'modern-world', 'russian', 'grammar', 'all', 'https://masterrussian.com/', 'Free Russian grammar, cases, vocabulary lessons'),
  r('tatoeba', 'Tatoeba — sentence corpus (all languages)', 'modern-world', 'multilingual', 'corpus', 'reference', 'https://tatoeba.org/', 'Open parallel example-sentence corpus, 400+ languages'),
];

// ── the Jesuit teaching method (operator: "Jesuit Method") — Hathor teaches BY this ───────────────
export const JESUIT_METHOD = {
  name: 'Ratio Studiorum (the Jesuit method)',
  source: 'https://www.educatemagis.org/wp-content/uploads/documents/2019/09/ratio-studiorum-1599.pdf',
  summary: 'The Jesuit blueprint (standardized 1599) for classical-language education: sequential mastery built around the prelection. Grammar → Humanities → Rhetoric, on the Trivium.',
  stages: ['grammar (three graded classes)', 'humanities (poetry + the literary authors)', 'rhetoric (eloquence + persuasion)'],
  exercises: ['prelection (the teacher opens the text first)', 'memory (recitation)', 'composition (write an imitation)', 'contest (emulation / friendly debate)'],
  prelection: 'The teacher reads a passage aloud, then unpacks it: construe the syntax, parse the forms, gloss vocabulary/idiom, give historical-cultural context, draw the moral or rhetorical lesson. The student never meets a text cold — it is opened FOR them, then they master it.',
  howHathorTeaches: [
    'Place the learner by stage (grammar → humanities → rhetoric) and never skip.',
    'For every text, PRELECT it — read, then construe/parse/gloss/contextualize/draw-the-lesson before the learner renders it.',
    'Close each session with the four exercises: recite, compose a short imitation, a friendly quiz/contest.',
    'Move from analysis toward active composition — the learner PRODUCES the language, not just decodes it.',
    'Spiral — re-surface earlier vocabulary and forms in each new prelection.',
  ],
  lineageNote: 'Jesuit missionaries (Heinrich Roth, Jean-François Pons) were among the first Europeans to document Sanskrit — the method and the Sanskrit corpus share a lineage.',
};

// ── Hierophant cross-links — "language and the gods go together" ──────────────────────────────────
// language → Hierophant text ids (from integrations/hierophant-catalog.mjs) the language unlocks.
export const HIEROPHANT_XREF = {
  'koine-greek': ['septuagint', 'nag-hammadi'],
  'biblical-hebrew': ['kjv-bible'],
  'aramaic': ['dead-sea-scrolls'],
  'phoenician-punic': ['cip-phoenician'],
  'sanskrit': ['rigveda', 'bhagavad-gita', 'upanishads'],
  'vedic': ['rigveda'],
  'egyptian': ['pyramid-texts', 'coffin-texts', 'egyptian-book-of-the-dead'],
  'akkadian': ['epic-of-gilgamesh', 'enuma-elish'],
  'sumerian': ['epic-of-gilgamesh'],
};

// ── accessors (pure) ──────────────────────────────────────────────────────────────────────────────
const norm = (s) => String(s || '').toLowerCase().trim();
export function family(id) { return FAMILIES.find((f) => f.id === norm(id)) || null; }
export function getResource(id) { return RESOURCES.find((x) => x.id === norm(id)) || null; }
export function byFamily(id) {
  const key = norm(id);
  if (!FAMILY_IDS.has(key)) return [];
  return RESOURCES.filter((x) => x.family === key)
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (TYPE_RANK[a.x.type] ?? 9) - (TYPE_RANK[b.x.type] ?? 9) || a.i - b.i)
    .map(({ x }) => x);
}
export function byLanguage(lang) { const k = norm(lang); return RESOURCES.filter((x) => x.language === k); }

// ── translation specialty: the FEW uncommon tongues Hathor handles herself ──────────────────────────
// Common MT engines (MyMemory etc.) cover the world's lingua-francas. For the UNCOMMON languages — Kurdish
// dialects, the scripture + ancient-Near-East tongues, the older Indo-European layers, Berber/Cushitic —
// they're weak or absent, so those route into Hathor's Language Center instead, grounded in this catalog.
// `modern-world` (Mandarin/Korean/Russian) is deliberately EXCLUDED: those are common, the cheap MT serves
// them. ISO-ish aliases let a UI lang code (ckb, kmr, grc, akk…) resolve to the catalog's language names.
const LANG_ALIASES = {
  ku: 'kurdish-general', kmr: 'kurmanji', ckb: 'sorani', zza: 'zaza-gorani', diq: 'zaza-gorani', hac: 'kurdish-general',
  grc: 'koine-greek', hbo: 'biblical-hebrew', arc: 'aramaic', phn: 'phoenician-punic', xpu: 'phoenician-punic',
  egy: 'egyptian', akk: 'akkadian', sux: 'sumerian', uga: 'ugaritic',
  sa: 'sanskrit', vsm: 'vedic', la: 'latin', ae: 'avestan', peo: 'old-persian', pgmc: 'pie',
  ber: 'berber-amazigh', tzm: 'tuareg', kab: 'kabyle', so: 'somali', om: 'oromo', aa: 'afar', byn: 'beja',
};
export const langAlias = (lang) => LANG_ALIASES[norm(lang)] || norm(lang);

/** Every language Hathor has catalog resources for (de-duped). */
export function specializedLanguages() { return [...new Set(RESOURCES.map((x) => x.language))]; }

/**
 * Is this language one of Hathor's specialized (uncommon, catalog-grounded) tongues — i.e. should it route
 * into her Language Center rather than the common MT? Accepts ISO codes or catalog names. Excludes the
 * common `modern-world` family even though it's cataloged (the cheap MT covers Mandarin/Korean/Russian).
 */
export function isSpecialized(lang) {
  const k = langAlias(lang);
  if (!k) return false;
  const hit = RESOURCES.find((x) => x.language === k);
  return !!hit && hit.family !== 'modern-world';
}

/** Hierophant text ids unlocked by a language (the gods this language reads). */
export function hierophantXref(language) { return HIEROPHANT_XREF[norm(language)] || []; }

/** Keyword search across name / language / type / note / family. */
export function search(q, { limit = 12 } = {}) {
  const terms = (norm(q).match(/[a-z0-9][a-z0-9'-]{1,}/g) || []);
  if (!terms.length) return [];
  return RESOURCES.map((x) => {
    const hay = `${x.name} ${x.language} ${x.family} ${x.type} ${x.note}`.toLowerCase();
    const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
    return { x, score };
  }).filter((r2) => r2.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r2) => r2.x);
}

export function familiesWithCounts() {
  return FAMILIES.map((f) => {
    const items = RESOURCES.filter((x) => x.family === f.id);
    return { ...f, total: items.length, languages: [...new Set(items.map((x) => x.language))].length };
  });
}

export function validateCatalog() {
  const errors = [];
  const ids = new Set();
  for (const x of RESOURCES) {
    if (!x.id || ids.has(x.id)) errors.push(`bad/dup id: ${x.id}`); else ids.add(x.id);
    if (!FAMILY_IDS.has(x.family)) errors.push(`${x.id}: unknown family ${x.family}`);
    if (!/^https?:\/\//.test(x.url || '')) errors.push(`${x.id}: bad url`);
  }
  return { ok: errors.length === 0, errors, families: FAMILIES.length, resources: RESOURCES.length };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('language-catalog.mjs')) {
  const arg = process.argv[2];
  if (arg && family(arg)) {
    const f = family(arg);
    console.log(`${f.name} — ${f.blurb}\n`);
    for (const x of byFamily(arg)) console.log(`  [${x.type.padEnd(13)}] ${x.name}${x.verified ? '' : ' (link unverified)'}  <${x.url}>`);
  } else {
    const v = validateCatalog();
    console.log(`Language catalog — ${v.resources} resources across ${v.families} families (valid: ${v.ok})`);
    if (!v.ok) v.errors.forEach((e) => console.log('  ! ' + e));
    console.log('');
    for (const f of familiesWithCounts()) console.log(`  ${f.id.padEnd(14)} ${String(f.total).padStart(2)} resources, ${f.languages} languages — ${f.name}`);
    console.log(`\nTeaching method: ${JESUIT_METHOD.name}`);
    console.log('Usage: node integrations/language-catalog.mjs [<family-id>]');
  }
}
