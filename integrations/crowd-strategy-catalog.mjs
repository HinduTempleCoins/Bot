// crowd-strategy-catalog.mjs — the DATA LAYER for the brain's CROWD-DYNAMICS & STRATEGY shelf: the open
// corpus, datasets, and tooling for understanding crowds, protests, nonviolent civil resistance, and
// strategy — framed for crowd SAFETY (crush/stampede), LEGAL-OBSERVER / know-your-rights, academic crowd
// science, pro-democracy civil-resistance research, and strategy as history/theory. Reference + the LoRA
// corpus ("might need to LoRA" — operator). A registry like hierophant-catalog/language-catalog; the
// public-domain texts (gutenberg:) are ingestable into the brain via the hierophant-ingest pattern.
//
//   { id, title, kind, category, what, source:{gutenberg?|url?}, license }
// kind: text | dataset | tool | model | manual.  Public-domain gutenberg ids are spot-check verified.

export const CATEGORIES = [
  { id: 'crowd-science', name: 'Crowd science & dynamics', blurb: 'How crowds move — density, flow, crush risk, evacuation (social-force & agent-based models).' },
  { id: 'crowd-psychology', name: 'Crowd psychology', blurb: 'Why crowds act — from Le Bon to the Elaborated Social Identity Model (crowds as intergroup encounters, not a "mad mob").' },
  { id: 'civil-resistance', name: 'Nonviolent civil resistance', blurb: 'The study & methods of nonviolent action (Sharp, Chenoweth) — pro-democracy, data-backed.' },
  { id: 'rights', name: 'Protest rights & legal observing', blurb: 'Know-your-rights and legal-observer practice — the defensive, civil-liberties frame.' },
  { id: 'strategy', name: 'Strategy (history & theory)', blurb: 'Classical strategy as history/theory — Sun Tzu, Machiavelli, Clausewitz, Boyd\'s OODA.' },
];

export const ITEMS = [
  // ── strategy classics (public domain, ingestable) ──
  { id: 'art-of-war-sunzi', title: 'The Art of War (Sun Tzu, Giles tr.)', kind: 'text', category: 'strategy',
    what: 'The foundational treatise on strategy, deception, terrain, and winning without fighting.', source: { gutenberg: 'https://www.gutenberg.org/ebooks/132' }, license: 'public-domain' },
  { id: 'the-prince', title: 'The Prince (Machiavelli)', kind: 'text', category: 'strategy',
    what: 'Power, statecraft, and the realist tradition.', source: { gutenberg: 'https://www.gutenberg.org/ebooks/1232' }, license: 'public-domain' },
  { id: 'the-crowd-lebon', title: 'The Crowd: A Study of the Popular Mind (Le Bon, 1895)', kind: 'text', category: 'crowd-psychology',
    what: 'The origin text of crowd psychology — now mainly a historical foil that ESIM critiques, but foundational.', source: { gutenberg: 'https://www.gutenberg.org/ebooks/445' }, license: 'public-domain' },

  // ── crowd psychology (modern, link/cite only — copyrighted) ──
  { id: 'esim', title: 'Elaborated Social Identity Model (Reicher, Stott)', kind: 'text', category: 'crowd-psychology',
    what: 'The modern model: crowd events are INTERGROUP encounters; shared identity forms and shifts with how groups (incl. police) interact. Replaces the "madding crowd" myth.', source: { url: 'https://www.open.edu/openlearn/health-sports-psychology/social-psychology-and-politics/content-section-3.2' }, license: 'cite-only (academic)' },
  { id: 'myth-madding-crowd', title: 'The Myth of the Madding Crowd (McPhail)', kind: 'text', category: 'crowd-psychology',
    what: 'Empirical demolition of the irrational-mob trope; crowds are structured and purposive.', source: {}, license: 'cite-only' },

  // ── civil resistance (data + the methods) ──
  { id: 'sharp-198', title: 'The 198 Methods of Nonviolent Action (Gene Sharp)', kind: 'text', category: 'civil-resistance',
    what: 'Sharp\'s canonical enumeration — protest/persuasion, noncooperation, intervention. Published FREE by the Albert Einstein Institution.', source: { url: 'https://www.aeinstein.org/nonviolentaction/198-methods-of-nonviolent-action/' }, license: 'free (AEI)' },
  { id: 'navco', title: 'NAVCO datasets (Chenoweth et al.)', kind: 'dataset', category: 'civil-resistance',
    what: 'Nonviolent & Violent Campaigns and Outcomes — 100,000+ coded observations of tactics; the data behind the "3.5% rule".', source: { url: 'https://www.chenoweth.org/datasets' }, license: 'academic (free)' },

  // ── crowd science: models & tools ──
  { id: 'social-force-model', title: 'Social Force Model (Helbing & Molnár)', kind: 'text', category: 'crowd-science',
    what: 'Pedestrians as particles under goal + repulsion forces — the basis of most crowd simulation. We implement a native JS version (crowd-sim).', source: { url: 'https://arxiv.org/abs/cond-mat/9805244' }, license: 'open (arXiv)' },
  { id: 'vadere', title: 'Vadere', kind: 'tool', category: 'crowd-science', what: 'Open-source crowd-simulation framework (multiple locomotion models).', source: { url: 'https://www.vadere.org/' }, license: 'LGPL' },
  { id: 'menge', title: 'Menge', kind: 'tool', category: 'crowd-science', what: 'Modular C++ pedestrian-crowd simulation.', source: { url: 'https://gamma.cs.unc.edu/Menge/' }, license: 'open' },
  { id: 'pedsim', title: 'PedSim (libpedsim)', kind: 'tool', category: 'crowd-science', what: 'Social-force crowd simulator (C++ library).', source: { url: 'https://github.com/chgloor/pedsim' }, license: 'open' },

  // ── crowd safety: vision (density, crush risk) — ties to the vision lobe ──
  { id: 'csrnet', title: 'CSRNet (crowd counting / density maps)', kind: 'model', category: 'crowd-science',
    what: 'Dilated-CNN density estimation; density maps (not just counts) flag crush/stampede risk. ShanghaiTech-trained; PyTorch/Keras reimplementations open — a convert-to-ONNX target for the vision lobe.', source: { url: 'https://github.com/CommissarMa/CSRNet-pytorch' }, license: 'open (reimpl.)' },

  // ── civil disturbance / crowd control doctrine (public-domain US gov manuals) ──
  { id: 'army-fm-civil-disturbance', title: 'US Army Civil Disturbance Operations (FM/ATP 3-39.33)', kind: 'manual', category: 'crowd-science',
    what: 'Doctrine on crowd dynamics & control from the authorities\' side — studied here to UNDERSTAND and anticipate it (legal-observer/defense frame). US Government work = public domain.', source: { url: 'https://armypubs.army.mil/' }, license: 'public-domain (US gov)' },
];

const norm = (s) => String(s || '').toLowerCase().trim();
export function category(id) { return CATEGORIES.find((c) => c.id === norm(id)) || null; }
export function byCategory(id) { const k = norm(id); return ITEMS.filter((x) => x.category === k); }
export function getItem(id) { return ITEMS.find((x) => x.id === norm(id)) || null; }
/** Public-domain texts that can be ingested into the brain (gutenberg sources). */
export function ingestableTexts() { return ITEMS.filter((x) => x.kind === 'text' && x.source && x.source.gutenberg); }
export function search(q) {
  const terms = norm(q).match(/[a-z0-9][a-z0-9'-]+/g) || [];
  if (!terms.length) return [];
  return ITEMS.map((x) => ({ x, score: terms.reduce((n, t) => n + ((norm(x.title + ' ' + x.what + ' ' + x.category)).includes(t) ? 1 : 0), 0) }))
    .filter((r) => r.score > 0).sort((a, b) => b.score - a.score).map((r) => r.x);
}
