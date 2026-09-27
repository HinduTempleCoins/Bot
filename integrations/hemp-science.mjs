// hemp-science.mjs — the WEB SURFACE for the MELEK Hemp & Cannabinoid Science section.
//
// WHAT THIS IS. The renderer for knowledge/hemp-science/. The registry there owns the data; this file
// owns the HTML and nothing else. It is mounted by site/hemp/server.mjs under /science, and it also
// exports a standalone handler(req, res) so the offline tests can drive every route through a mock
// req/res without binding a port.
//
//   /science                        section index — the eleven shelves, the posture, the boundary
//   /science/<shelf>                one shelf — its pages with summaries
//   /science/<shelf>/<page>         one page — facts table, sections, tables, citations
//   /science/check                  the interaction checker, interactive (GET ?taking=…)
//   /science/matrix.json            the CYP interaction matrix the index derives from cyp450.ENZYMES
//   /science/search                 a local term-frequency search over the section
//
// ── DISCIPLINE ───────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated value, without exception. No template reaches the browser with a raw
//   value in it. SOFT-FAIL, NEVER THROW: a missing shelf renders a 404 body, a broken section renders
//   the sections around it, and the handler's catch is a floor rather than a design. NO NETWORK, no
//   filesystem reads at request time, no side effects on import — the whole section is frozen data
//   already in memory. Education and harm reduction, not medical/legal advice: the posture block and
//   the "absence is not safety" statement are rendered on the page, above the fold, not in a footer.
//
//   UNVERIFIED CITATIONS ARE MARKED, ALWAYS. A record we could not resolve to an identifier is still
//   worth publishing; passing it off as verified is not. citeText() in the registry appends the
//   marker and this file renders it visibly rather than quietly dropping the record.

import * as sci from '../knowledge/hemp-science/index.mjs';
import { check, coverage, clinicianExport, LAST_REVIEWED } from './interactions.mjs';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8101').replace(/\/$/, '');
const HATHOR = (process.env.HATHOR_SITE || 'https://hathor.live').replace(/\/$/, '');
const LIBRARY = (process.env.WIKI_SITE || 'https://library.soapbox.community').replace(/\/$/, '');

/** esc — every value interpolated into HTML goes through this. */
export const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const slug = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');

// ── the standing blocks ───────────────────────────────────────────────────────────────────────────

/**
 * postureBlock — the section's editorial position, rendered. It is on the index and on every page,
 * in the same words in the same place, so that it is recognised rather than re-read. The boundary
 * sentence is here and not in a footer because the reader who needs it is the one who stops reading
 * at the first table.
 */
export function postureBlock() {
  const s = sci.SECTION || {};
  return `<div class=card>
  <h2>What this section is, and what it is not</h2>
  <p class=muted>${esc(s.posture || '')}</p>
  <p class=muted><b>The boundary.</b> ${esc(s.boundary || '')}</p>
</div>`;
}

/** absenceBlock — the one sentence a reader of an interaction table is most likely to get wrong. */
export function absenceBlock() {
  return `<blockquote><b>Absence is not safety.</b> A substance or a pair that is not in this section
  was <em>not checked</em> and is not thereby safe. This is a curated mechanism reference built from
  primary literature and regulatory reference works — not a comprehensive interaction database, and
  not a substitute for a clinician or a pharmacist.</blockquote>`;
}

/**
 * crossLinks — the rest of the library, named. The oilahuasca and herbs shelves are the sibling
 * corpora: this section is the cannabinoid and enzyme half of the same materia medica, and a reader
 * on a CYP page is usually one click from needing the other half.
 */
export function crossLinks() {
  return `<div class=card>
  <h2>The rest of the library</h2>
  <div class=grid>
    <a class=sec href="${esc(HATHOR)}/interactions"><span class=t>Interaction checker (full dataset)</span>
      <span class=d>The whole mechanism engine — MAOIs, serotonergic drugs, the CYP axis, P-gp, tyramine, and now the endocannabinoid enzymes and CB1/CB2 from this section.</span></a>
    <a class=sec href="${esc(LIBRARY)}/healer/oilahuasca"><span class=t>Oilahuasca &amp; allylbenzene metabolism</span>
      <span class=d>The CYP-mediated allylbenzene shelf: the same phase-1 enzymes read from the other direction, with the MAOI and 2C-series pharmacology attached.</span></a>
    <a class=sec href="${esc(LIBRARY)}/healer/herbs"><span class=t>Herbs &amp; the temple pharmacopoeia</span>
      <span class=d>The botanical shelves this section's monographs were drawn from — kava potentiators, the Van Kush pharmacopoeia, ethnobotany.</span></a>
    <a class=sec href="${esc(LIBRARY)}/healer/psychedelics"><span class=t>Psychedelics &amp; harm reduction</span>
      <span class=d>Dose ranges, testing, set and setting, aftercare and emergency guidance, with the same sourcing discipline.</span></a>
  </div>
</div>`;
}

// ── citation rendering ────────────────────────────────────────────────────────────────────────────

/**
 * citeItem — one reference. The identifier is a link when we hold one. An unresolved record renders
 * with a visible [identifier unverified] marker: the author/year/title IS the handle, and a reader
 * who wants to find it can, which is the whole point of publishing the record rather than dropping it.
 */
function citeItem(shelfId, key) {
  const c = sci.cite(shelfId, key);
  if (!c) return '';
  const url = sci.citeUrl(c);
  const handle = c.doi ? `doi:${c.doi}` : c.pmid ? `PMID ${c.pmid}` : (c.url ? 'link' : '');
  const bits = [c.authors, c.year ? `(${c.year})` : '', c.title, c.journal].filter(Boolean).map(esc);
  const unverified = c.verified === false
    ? ' <b title="No identifier was resolved for this record. The author, year and title are the handle. Nothing here was guessed.">[identifier unverified]</b>'
    : '';
  const link = url && handle ? ` <a href="${esc(url)}" rel="nofollow noopener">${esc(handle)}</a>` : '';
  return `<li id="ref-${esc(shelfId)}-${esc(key)}">${bits.join(' ')}.${link}${unverified}</li>`;
}

/** citeList — the references block for a page, de-duplicated, in first-use order. */
export function citeList(shelfId, keys) {
  const seen = [];
  for (const k of keys || []) if (k && !seen.includes(k)) seen.push(k);
  const items = seen.map((k) => citeItem(shelfId, k)).filter(Boolean);
  if (!items.length) return '';
  const unver = seen.filter((k) => { const c = sci.cite(shelfId, k); return c && c.verified === false; }).length;
  return `<div class=card id=references><h2>References</h2><ol>${items.join('')}</ol>
  <p class=muted>${esc(items.length)} reference${items.length === 1 ? '' : 's'}${unver
    ? `, of which ${esc(unver)} carry no resolved identifier and are marked as such. A DOI is only recorded here when it was resolved against Crossref and the returned title matched the one printed. None was guessed.`
    : '. Every identifier here was resolved against Crossref and the returned title checked against the one printed.'}</p></div>`;
}

// ── section rendering ─────────────────────────────────────────────────────────────────────────────

const EVIDENCE_LABEL = Object.freeze({
  human: 'human data', 'in vitro': 'in vitro', animal: 'animal', historical: 'historical / ethnographic',
  'industry practice': 'industry practice, not published data', regulatory: 'regulatory reference', theory: 'theoretical',
});

function tableHTML(t) {
  if (!t || !Array.isArray(t.rows) || !t.rows.length) return '';
  const cols = Array.isArray(t.cols) ? t.cols : [];
  const head = cols.length ? `<thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>` : '';
  const body = t.rows.map((r) => `<tr>${(Array.isArray(r) ? r : [r]).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

/** sectionHTML — one page section. Wrapped by the caller so one bad section cannot take the page down. */
export function sectionHTML(shelfId, sec, i) {
  if (!sec) return '';
  const id = `s${i + 1}-${slug(sec.h || '')}`.slice(0, 80);
  const flags = [];
  if (sec.contested) flags.push('<span class="badge mj">contested</span>');
  if (sec.evidence) flags.push(`<span class=badge>${esc(EVIDENCE_LABEL[sec.evidence] || sec.evidence)}</span>`);
  const paras = String(sec.body || '').split(/\n\n+/).filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const bullets = Array.isArray(sec.bullets) && sec.bullets.length
    ? `<ul>${sec.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '';
  // A contested section ALWAYS renders its caveat. The registry test enforces that one exists; this
  // renders it inline rather than in a footnote, because a caveat a reader has to go looking for is
  // a caveat that was not really made.
  const caveat = sec.caveat
    ? `<blockquote><b>${sec.contested ? 'Contested — ' : ''}caveat.</b> ${esc(sec.caveat)}</blockquote>` : '';
  const cites = Array.isArray(sec.cites) && sec.cites.length
    ? `<p class=muted>Sources: ${sec.cites.map((k) => {
      const c = sci.cite(shelfId, k);
      if (!c) return esc(k);
      const label = `${c.authors ? String(c.authors).split(/,|\band\b/)[0].trim() : k}${c.year ? ` ${c.year}` : ''}`;
      return `<a href="#ref-${esc(shelfId)}-${esc(k)}">${esc(label)}</a>${c.verified === false ? '*' : ''}`;
    }).join(' · ')}</p>` : '';
  return `<section class=card id="${esc(id)}">
  <h2>${esc(sec.h || '')} ${flags.join(' ')}</h2>
  ${paras}${bullets}${tableHTML(sec.table)}${caveat}${cites}
</section>`;
}

function factsHTML(facts) {
  const rows = Object.entries(facts || {});
  if (!rows.length) return '';
  return `<div class=card><h2>At a glance</h2><table><tbody>${rows
    .map(([k, v]) => `<tr><th style="width:38%">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>`;
}

function seeAlsoHTML(list) {
  const items = (Array.isArray(list) ? list : []).map((ref) => {
    const [sh, sl] = String(ref).split('/');
    const p = sci.page(sh, sl);
    return p ? `<li><a href="/science/${esc(sh)}/${esc(sl)}">${esc(p.title)}</a> <span class=muted>— ${esc(p.shelfTitle)}</span></li>` : '';
  }).filter(Boolean);
  if (!items.length) return '';
  return `<div class=card><h2>See also</h2><ul>${items.join('')}</ul></div>`;
}

// ── views ─────────────────────────────────────────────────────────────────────────────────────────

/** indexView — the section index. Every shelf, with its page count and its blurb. */
export function indexView() {
  try {
    const st = sci.stats();
    const cards = sci.SHELVES.map((s) => `<a class=sec href="/science/${esc(s.id)}">
      <span class=t>${esc(s.title || s.id)}</span>
      <span class=d>${esc(s.blurb || '')}</span>
      <span class=d>${esc((s.pages || []).length)} page${(s.pages || []).length === 1 ? '' : 's'}${s.updated ? ` · updated ${esc(s.updated)}` : ''}</span>
    </a>`).join('');
    return `<h1>${esc(sci.SECTION.title)}</h1>
<p class=muted>${esc(sci.SECTION.blurb)}</p>
<div class=idx>
  <div><div class=v>${esc(st.shelves)}</div><div class=l>shelves</div></div>
  <div><div class=v>${esc(st.pages)}</div><div class=l>pages</div></div>
  <div><div class=v>${esc(st.sections)}</div><div class=l>sections</div></div>
  <div><div class=v>${esc(st.cites)}</div><div class=l>citations</div></div>
  <div><div class=v>${esc(st.cites - st.unverifiedCites)}</div><div class=l>with a resolved identifier</div></div>
  <div><div class=v>${esc(st.words.toLocaleString('en-US'))}</div><div class=l>words</div></div>
</div>
${postureBlock()}
<form class=hsearch method=get action="/science/search"><div class=row>
  <input class=q name=q placeholder="Search the section — an enzyme, a terpene, a drug name…" autocomplete=off aria-label="Search hemp science">
  <button type=submit>Search</button>
</div></form>
<div class=card><h2>Tools</h2><div class=grid>
  <a class=sec href="/science/check"><span class=t>Interaction checker</span><span class=d>Name what you are taking. The engine reports documented interactions with the mechanism named — and states plainly what it did not check.</span></a>
  <a class=sec href="/science/matrix.json"><span class=t>CYP interaction matrix (JSON)</span><span class=d>The machine-readable substrate/inhibitor/inducer table, generated from the CYP450 shelf so the data and the pages cannot disagree.</span></a>
</div></div>
<h2>The shelves</h2>
<div class=grid>${cards}</div>
${absenceBlock()}
${crossLinks()}`;
  } catch { return '<h1>Hemp &amp; Cannabinoid Science</h1><p class=empty>The section did not load.</p>'; }
}

/** shelfView — one shelf's page list. Returns '' when the shelf id is unknown (caller renders 404). */
export function shelfView(shelfId) {
  const s = sci.shelf(shelfId);
  if (!s) return '';
  const pages = (s.pages || []).map((p) => `<div class=rec>
    <div class=nm><a href="/science/${esc(s.id)}/${esc(p.slug)}">${esc(p.title)}</a></div>
    <div class=meta>${esc(p.summary || '')}</div>
    <div class=meta>${esc((p.sections || []).length)} sections${p.kind ? ` · ${esc(p.kind)}` : ''}</div>
  </div>`).join('');
  const unver = Object.values(s.cites || {}).filter((c) => c && c.verified === false).length;
  const nCites = Object.keys(s.cites || {}).length;
  return `<p class=muted><a href="/science">${esc(sci.SECTION.title)}</a> / ${esc(s.title)}</p>
<h1>${esc(s.title)}</h1>
<p class=muted>${esc(s.blurb || '')}</p>
<p class=muted>${esc((s.pages || []).length)} pages · ${esc(nCites)} citations${unver ? ` (${esc(unver)} without a resolved identifier, marked on the page)` : ''}${s.updated ? ` · updated ${esc(s.updated)}` : ''}</p>
${postureBlock()}
<div class=card><h2>Pages</h2>${pages || '<div class=empty>No pages on this shelf yet.</div>'}</div>
${absenceBlock()}`;
}

/** pageView — one wiki page. Returns '' when the page is unknown (caller renders 404). */
export function pageView(shelfId, pageSlug) {
  const p = sci.page(shelfId, pageSlug);
  if (!p) return '';
  const secs = (p.sections || []).map((sec, i) => {
    try { return sectionHTML(p.shelfId, sec, i); } catch { return ''; }
  }).join('');
  const keys = [];
  for (const sec of p.sections || []) for (const k of sec.cites || []) if (!keys.includes(k)) keys.push(k);
  for (const k of p.cites || []) if (!keys.includes(k)) keys.push(k);
  const toc = (p.sections || []).length > 3
    ? `<div class=card><h2>On this page</h2><ul>${(p.sections || []).map((sec, i) =>
      `<li><a href="#s${i + 1}-${esc(slug(sec.h || ''))}">${esc(sec.h || '')}</a></li>`).join('')}</ul></div>` : '';
  return `<p class=muted><a href="/science">${esc(sci.SECTION.title)}</a> / <a href="/science/${esc(p.shelfId)}">${esc(p.shelfTitle)}</a> / ${esc(p.title)}</p>
<h1>${esc(p.title)}</h1>
<p class=muted>${esc(p.summary || '')}</p>
${factsHTML(p.facts)}
${toc}
${secs}
${seeAlsoHTML(p.seeAlso)}
${citeList(p.shelfId, keys)}
${absenceBlock()}
<div class=card><h2>Posture</h2><p class=muted>${esc(sci.SECTION.posture)}</p>
<p class=muted><b>The boundary.</b> ${esc(sci.SECTION.boundary)}</p></div>`;
}

/** searchView — the local term-frequency search. Deterministic, offline, no embeddings. */
export function searchView(q) {
  const query = String(q == null ? '' : q);
  const hits = query.trim() ? sci.search(query, { limit: 40 }) : [];
  const body = hits.length
    ? hits.map((h) => `<div class=rec>
        <div class=nm><a href="/science/${esc(h.shelfId)}/${esc(h.slug)}">${esc(h.title)}</a>
          <span class=badge>${esc(h.shelfId)}</span></div>
        <div class=meta>${esc(h.summary || '')}</div>
        <div class=meta>matched ${esc(h.matched.length)} of ${esc(h.of)} terms</div>
      </div>`).join('')
    : `<div class=empty>${query.trim() ? 'No page in this section matched that.' : 'Type a term above — an enzyme, a terpene, a cannabinoid, a drug name.'}</div>`;
  return `<p class=muted><a href="/science">${esc(sci.SECTION.title)}</a> / Search</p>
<h1>Search the section</h1>
<form class=hsearch method=get action="/science/search"><div class=row>
  <input class=q name=q value="${esc(query)}" placeholder="an enzyme, a terpene, a drug name…" autocomplete=off aria-label="Search hemp science">
  <button type=submit>Search</button>
</div></form>
<div class=card>${body}</div>
${absenceBlock()}`;
}

// ── the interaction checker, as an interactive page ────────────────────────────────────────────────

const SEV_CLASS = Object.freeze({ critical: 'mj', major: 'mj', moderate: 'ch', monitor: '', info: '' });
const SEV_LABEL = Object.freeze({ critical: 'Critical', major: 'Major', moderate: 'Moderate', monitor: 'Worth knowing', info: 'Note' });

/**
 * findingHTML — one finding from check(). The field names are the engine's own: `headline`, `what`,
 * `substrateNote`, `inhibitorNote`, `participantNotes`, `watchFor`, `participants`.
 *
 * The participant list is in the HEADING, not a footnote, because two findings can share a mechanism
 * name and differ only in who is involved (CBD→clobazam and kava→clobazam are both "CYP2C19
 * inhibition"), and a reader looking at two identically-titled cards cannot tell which is which.
 */
function findingHTML(f, names) {
  if (!f) return '';
  const who = (Array.isArray(f.participants) ? f.participants : [])
    .map((id) => (names && names[id]) || id);
  return `<div class=card>
  <h2>${esc(f.mechanism || 'Finding')}${who.length ? ` — ${esc(who.join(' + '))}` : ''}
    <span class="badge ${esc(SEV_CLASS[f.severity] || '')}">${esc(SEV_LABEL[f.severity] || f.severity || '')}</span></h2>
  ${f.headline ? `<p><b>${esc(f.headline)}</b></p>` : ''}
  ${f.what ? `<p>${esc(f.what)}</p>` : ''}
  ${f.inhibitorNote ? `<p><b>The inhibitor.</b> ${esc(f.inhibitorNote)}</p>` : ''}
  ${f.substrateNote ? `<p><b>The substrate.</b> ${esc(f.substrateNote)}</p>` : ''}
  ${f.nti ? '<p><b>Narrow therapeutic index.</b> A small shift in exposure is a clinically meaningful shift for this substrate.</p>' : ''}
  ${f.watchFor ? `<p><b>What to watch for.</b> ${esc(f.watchFor)}</p>` : ''}
  ${(() => {
    // participantNotes overlaps inhibitorNote/substrateNote on the two-party findings. Showing the
    // same paragraph twice reads as a rendering bug, so only the notes not already above are listed.
    const shown = new Set([f.inhibitorNote, f.substrateNote].filter(Boolean));
    const extra = (Array.isArray(f.participantNotes) ? f.participantNotes : []).filter((n) => n && !shown.has(n));
    return extra.length ? `<ul>${extra.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  })()}
  ${Array.isArray(f.cites) && f.cites.length ? `<p class=muted>${esc(f.cites.length)} citation${f.cites.length === 1 ? '' : 's'} — the full record, with every reference, is at <a href="${esc(HATHOR)}/interactions" rel=noopener>the interaction reference</a>.</p>` : ''}
</div>`;
}

/**
 * checkView — the interactive checker. A REFERENCE page is an article about substances; this output
 * is a record about a person, so it carries the stronger sentence and is served noindex by the caller.
 */
export function checkView(taking) {
  const raw = String(taking == null ? '' : taking);
  const form = `<form class=hsearch method=get action="/science/check"><div class=row>
  <input class=q name=taking value="${esc(raw)}" placeholder="CBD, clobazam, grapefruit, kava…" autocomplete=off aria-label="What are you taking">
  <button type=submit>Check</button>
</div><p class=muted>Comma-separated. Prescription drugs, supplements, plant preparations, foods and seasonings — the last three are exactly what does not come up in a clinic visit.</p></form>`;

  if (!raw.trim()) {
    let cov = null;
    try { cov = coverage(); } catch { /* soft-fail */ }
    return `<p class=muted><a href="/science">${esc(sci.SECTION.title)}</a> / Interaction checker</p>
<h1>Interaction checker</h1>
<p class=muted>Mechanism-based, not a list of pairs: the engine models what a substance does to the enzymes and
transporters that clear everything else, which is why it can say something useful about combinations nobody
has typed into a database.</p>
${form}
${absenceBlock()}
${cov ? `<div class=card><h2>What a clean result means</h2><p>${esc(cov.statement || '')}</p>
<p class=muted>${esc(cov.substancesInDataset)} substances, ${esc(cov.mechanismsInDataset)} mechanisms, ${esc(cov.citationsInDataset)} citations. Last reviewed ${esc(LAST_REVIEWED)}.</p></div>` : ''}
${crossLinks()}`;
  }

  let r = null;
  try { r = check(raw); } catch { r = null; }
  if (!r) {
    return `<h1>Interaction checker</h1>${form}<div class=empty>The checker did not run. Nothing was checked — treat that as no information, not as a clean result.</div>${absenceBlock()}`;
  }
  const names = Object.create(null);
  for (const x of r.recognised || []) names[x.id] = x.name;
  const rec = (r.recognised || []).map((x) => `<li>${esc(x.name)} <span class=muted>(${esc(x.kind)})</span></li>`).join('');
  const unrec = (r.unrecognised || []).map((x) => `<li>${esc(x)} — <b>not in this dataset, not checked</b></li>`).join('');
  let exportText = '';
  try { exportText = clinicianExport(raw).text || ''; } catch { /* soft-fail */ }

  return `<p class=muted><a href="/science">${esc(sci.SECTION.title)}</a> / <a href="/science/check">Interaction checker</a> / Result</p>
<h1>What you told us you are taking</h1>
${form}
<div class=card><h2>Read back</h2><ul>${rec}${unrec}</ul>
  <p class=muted><b>This is not a screen of anything you are taking.</b> It knows nothing about your dose, your
  timing, your other medicines, your genotype, your kidneys or your liver — all of which decide whether any of
  it applies to you. Take it to a doctor or a pharmacist.</p></div>
${(r.findings || []).length
    ? `<h2>${esc(r.findings.length)} documented interaction${r.findings.length === 1 ? '' : 's'}${r.worst ? ` · worst: ${esc(SEV_LABEL[r.worst] || r.worst)}` : ''}</h2>${r.findings.map((f) => findingHTML(f, names)).join('')}`
    : `<div class=card><h2>Nothing documented in this dataset</h2><p><b>That is not a finding of safety.</b> It means
       no documented interaction <em>in this dataset</em>, which models a handful of the mechanisms that exist.
       Read the coverage statement below before you take it as reassurance.</p></div>`}
${(r.substanceWarnings || []).length
    ? `<h2>Toxicity notes for what you named</h2>${r.substanceWarnings.map((w) => `<div class=card><h2>${esc(w.name)}</h2><p>${esc(w.toxicity)}</p></div>`).join('')}`
    : ''}
${exportText ? `<div class=card><h2>Take this to a clinician</h2>
  <p class=muted>A doctor cannot check interactions against something they do not know you are taking. This is the
  plain-text version of what you entered, laid out so it can be read quickly.</p>
  <pre style="white-space:pre-wrap;border:1px solid var(--line2);border-radius:8px;padding:12px;background:#0b0f14;font-size:12px;overflow-x:auto">${esc(exportText)}</pre></div>` : ''}
${r.coverage ? `<div class=card><h2>What was and was not checked</h2><p>${esc(r.coverage.statement || '')}</p>
  ${r.coverage.unrecognisedMeans ? `<p class=muted>${esc(r.coverage.unrecognisedMeans)}</p>` : ''}</div>` : ''}
${absenceBlock()}
<p class=muted>The full mechanism reference, with every citation and a page per mechanism, is at
<a href="${esc(HATHOR)}/interactions" rel=noopener>the interaction reference</a>.</p>`;
}

// ── the JSON artifact ─────────────────────────────────────────────────────────────────────────────

/** matrixJson — the CYP interaction matrix, served at /science/matrix.json. */
export function matrixJson() {
  try { return sci.matrix(); } catch { return { schema: 'melek-hemp-science/cyp-interaction-matrix/1', enzymes: [], absenceIsNotSafety: true }; }
}

/** sciencePaths — every routable path under /science, for the host site's sitemap. */
export function sciencePaths() {
  try { return sci.paths().filter((p) => !p.endsWith('.json')); } catch { return ['/science']; }
}

// ── the render seam the host site uses ────────────────────────────────────────────────────────────

/**
 * render(pathname, searchParams) — resolve a /science path to { title, body, canonical, robots } so the
 * host site can wrap it in its own chrome, or null when the path is not ours. Returns a 404 descriptor
 * (`notFound: true`) for an unknown shelf or page rather than throwing.
 */
export function render(pathname, searchParams) {
  // Normalise a trailing slash, but NEVER default an empty or root path into the section: '/' must
  // stay the host site's own home page, and a renderer that claims it would swallow the whole site.
  const raw = String(pathname == null ? '' : pathname);
  const path = raw.length > 1 ? raw.replace(/\/+$/, '') || '/' : raw;
  if (path !== '/science' && !path.startsWith('/science/')) return null;
  const sp = searchParams || new URLSearchParams();
  // The section name is the suffix, so the index itself must not repeat it.
  const SUFFIX = 'Hemp & Cannabinoid Science';
  const T = (t) => (String(t) === SUFFIX ? SUFFIX : `${t} — ${SUFFIX}`);

  try {
    if (path === '/science') {
      return { title: T(sci.SECTION.title), body: indexView(), canonical: `${BASE_URL}/science`, robots: 'index,follow', description: sci.SECTION.blurb };
    }
    if (path === '/science/search') {
      const q = sp.get('q') || '';
      return { title: T('Search'), body: searchView(q), canonical: `${BASE_URL}/science/search`, robots: q ? 'noindex,follow' : 'index,follow' };
    }
    if (path === '/science/check') {
      const taking = sp.get('taking') || sp.get('q') || '';
      return {
        title: T('Interaction checker'), body: checkView(taking), canonical: `${BASE_URL}/science/check`,
        // A per-query record is thin, duplicated content and is nobody's search result. The empty form indexes.
        robots: taking.trim() ? 'noindex,nofollow' : 'index,follow',
        description: 'Mechanism-based interaction checker: cannabinoids, the CYP axis, the endocannabinoid enzymes, sedative botanicals. Educational, not medical advice.',
      };
    }
    const parts = path.slice('/science/'.length).split('/').filter(Boolean);
    if (parts.length === 1) {
      const body = shelfView(parts[0]);
      if (!body) return { notFound: true, title: T('Not found'), body: notFoundView(parts[0], ''), canonical: `${BASE_URL}/science`, robots: 'noindex,follow' };
      const s = sci.shelf(parts[0]);
      return { title: T(s.title), body, canonical: `${BASE_URL}/science/${s.id}`, robots: 'index,follow', description: s.blurb };
    }
    if (parts.length === 2) {
      const body = pageView(parts[0], parts[1]);
      if (!body) return { notFound: true, title: T('Not found'), body: notFoundView(parts[0], parts[1]), canonical: `${BASE_URL}/science`, robots: 'noindex,follow' };
      const p = sci.page(parts[0], parts[1]);
      return { title: T(p.title), body, canonical: `${BASE_URL}/science/${p.shelfId}/${p.slug}`, robots: 'index,follow', description: p.summary };
    }
    return { notFound: true, title: T('Not found'), body: notFoundView(parts[0] || '', parts[1] || ''), canonical: `${BASE_URL}/science`, robots: 'noindex,follow' };
  } catch {
    // Soft-fail: a broken page renders the index rather than a stack trace.
    return { title: T(sci.SECTION.title), body: indexView(), canonical: `${BASE_URL}/science`, robots: 'noindex,follow' };
  }
}

function notFoundView(shelfId, pageSlug) {
  const s = sci.shelf(shelfId);
  const near = pageSlug && s ? sci.search(String(pageSlug).replace(/-/g, ' '), { limit: 8 }) : [];
  return `<p class=muted><a href="/science">${esc(sci.SECTION.title)}</a> / Not found</p>
<h1>No such page</h1>
<p class=muted>${esc(shelfId ? `Nothing at /science/${shelfId}${pageSlug ? `/${pageSlug}` : ''}.` : 'Nothing at that path.')}</p>
${near.length ? `<div class=card><h2>Did you mean</h2><ul>${near.map((h) => `<li><a href="/science/${esc(h.shelfId)}/${esc(h.slug)}">${esc(h.title)}</a></li>`).join('')}</ul></div>` : ''}
<div class=card><h2>The shelves</h2><ul>${sci.SHELVES.map((x) => `<li><a href="/science/${esc(x.id)}">${esc(x.title)}</a></li>`).join('')}</ul></div>`;
}

// ── standalone handler — used by the offline tests and by `node integrations/hemp-science.mjs` ─────

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  .wrap{max-width:920px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:17px;margin:0 0 10px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec .t{font-weight:700;font-size:16px;display:block} .sec .d{color:var(--mut);font-size:13px;margin-top:4px;display:block}
  .rec{padding:12px 0;border-bottom:1px solid var(--line)} .rec:last-child{border-bottom:0}
  .rec .nm{font-weight:600} .rec .meta{color:var(--mut);font-size:13px;margin-top:2px}
  .badge{font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 7px;margin-left:6px}
  .badge.mj{background:#f8514933;color:var(--down)} .badge.ch{background:#d2992233;color:var(--gold)}
  table{width:100%;border-collapse:collapse} td,th{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left;font-size:14px;vertical-align:top}
  blockquote{border-left:3px solid var(--line2);margin:10px 0;padding:2px 0 2px 12px;color:var(--mut);font-size:13px}
  .idx{display:flex;gap:18px;flex-wrap:wrap;margin:10px 0} .idx .v{font-size:22px;font-weight:800} .idx .l{color:var(--mut);font-size:12px}
  input.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;flex:1 1 220px}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center} .empty{color:var(--mut);padding:14px 0}
</style>`;

/** shell — minimal chrome for the standalone handler. The hemp site wraps render() in its own instead. */
export function shell(v) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(v.title || 'Hemp & Cannabinoid Science')}</title>
<meta name=description content="${esc(v.description || sci.SECTION.blurb)}">
<meta name=robots content="${esc(v.robots || 'index,follow')}">
<link rel=canonical href="${esc(v.canonical || `${BASE_URL}/science`)}">${STYLE}</head><body>
<main class=wrap>${v.body || ''}</main></body></html>`;
}

/** handler(req, res) — exported so offline tests drive routes through a mock req/res, no port bound. */
export function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/science/matrix.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' });
      return res.end(JSON.stringify(matrixJson()));
    }
    const v = render(path, url.searchParams);
    if (!v) { res.writeHead(302, { location: '/science' }); return res.end(); }
    res.writeHead(v.notFound ? 404 : 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
    return res.end(shell(v));
  } catch (e) {
    // Never throw out of a handler. A 500 body is a fact; an unhandled rejection is an outage.
    res.writeHead(500, { 'content-type': 'text/plain' });
    return res.end(`error: ${e && e.message ? e.message : 'unknown'}`);
  }
}

export default { render, handler, indexView, shelfView, pageView, checkView, searchView, matrixJson, sciencePaths, esc };

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && /hemp-science\.mjs$/.test(process.argv[1])) {
  const arg = process.argv[2] || 'paths';
  if (arg === 'paths') { for (const p of sciencePaths()) console.log(p); }
  else if (arg === 'stats') { console.log(JSON.stringify(sci.stats(), null, 2)); }
  else { const v = render(arg, new URLSearchParams(process.argv[3] || '')); console.log(v ? shell(v) : 'not a /science path'); }
}
