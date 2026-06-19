// server.mjs — Politics.SoapBox.Community. The politics vertical as a standalone, zero-dependency HTTP
// service in the SoapBox house style (mirrors site/law/server.mjs and site/hemp/server.mjs). It fronts
// the already-built, keyless civic readers and binds them into ONE cross-linked surface — the operator's
// core goal: CONNECT POLITICS TO LAW. Where a person is a judge, we link straight to their opinions on
// Law.SoapBox; where a politician has campaign finance, we link the money page. Read-only, server-
// rendered, no keys, no custody.
//
//   PORT=8103 BASE_URL=https://politics.soapbox.community node site/politics/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /              portal home — section cards + a "find your representatives" box + cross-site links
//   /reps          find your representatives / members of Congress (congress-legislators)
//   /elections     elections & civic info (elections-civic / elections-info / election-clock)
//   /lobbying      federal lobbying disclosures (lobbying-lda)
//   /money         campaign finance (fec) — present only if fec.mjs is wired
//   /accountability politician / judge power-map (accountability-graph + legal-knowledge-graph)
//   /health        liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── CRITICAL CROSS-LINKING (operator's core goal: connect Politics ↔ Law) ─────────────────────────
//   relatedOn(entity) emits cross-site links from an entity's metadata so the web is navigable across
//   sites: a JUDGE links to their opinions on Law.SoapBox (law.soapbox.community/judges?q=<name>); a
//   POLITICIAN with finance links to /money?q=<name>. The cross-site bases are env-overridable
//   (LAW_SITE etc.) so the links travel between staging and prod unchanged.
//
// ── DISCIPLINE (inherited from the readers + Law/Hemp.SoapBox) ─────────────────────────────────────
//   FACTS, NOT VERDICTS. We state the public record — who holds office, who filed a disclosure, what was
//   reported — and link the OFFICIAL source. We render NO score, rating, or "corrupt" judgment about any
//   person. Right of reply: every person listed can correct their own record via the source of record.
//   We NEVER fabricate — when a reader returns nothing, the page soft-fails to an honest empty state and
//   points at the official source. noindex,follow on query pages. esc() on every interpolated value.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import * as congress from '../../integrations/soapbox/congress-legislators.mjs';
import * as civic from '../../integrations/soapbox/elections-civic.mjs';
import * as electionsInfo from '../../integrations/soapbox/elections-info.mjs';
import * as clock from '../../integrations/soapbox/election-clock.mjs';
import * as lobbying from '../../integrations/soapbox/lobbying-lda.mjs';
import * as fec from '../../integrations/soapbox/fec.mjs';
import * as accountability from '../../integrations/accountability-graph.mjs';
import * as dossier from '../../integrations/dossier.mjs';

const PORT = +(process.env.PORT || 8103);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const LAW = process.env.LAW_SITE || 'https://law.soapbox.community';
const SEARCH = process.env.SEARCH_SITE || 'https://search.soapbox.community';
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';
const HEMP = process.env.HEMP_SITE || 'https://hemp.soapbox.community';

// fec.mjs is optional — only mount /money + its links when it actually exports a search.
const HAS_FEC = !!(fec && typeof fec.candidateSearch === 'function');

// ── shared house-style helpers (same dark theme as Law/Hemp/Stocks/Search) ─────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const q = (s) => encodeURIComponent(String(s == null ? '' : s));

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:920px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:17px;margin:0 0 10px} h3{font-size:15px;margin:0 0 6px}
  .muted{color:var(--mut)} .up{color:var(--up)} .down{color:var(--down)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  form.polsearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q,select.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px}
  input.q{flex:1 1 320px;min-width:220px;max-width:520px} input.q:focus,select.q:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  .tabs{display:inline-flex;border:1px solid var(--line2);border-radius:20px;overflow:hidden;margin:0 0 12px}
  .tabs a{padding:7px 16px;color:var(--mut);font-weight:600;font-size:14px} .tabs a.on{background:var(--blue);color:#06101f}
  .rec{padding:12px 0;border-bottom:1px solid var(--line)} .rec:last-child{border-bottom:0}
  .rec .nm{font-weight:600;font-size:15px} .rec .meta{color:var(--mut);font-size:13px;margin-top:2px}
  .rec .xlink{font-size:13px;margin-top:4px} .badge{font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 7px;margin-left:6px}
  .badge.judge{background:#d2992233;color:var(--gold)} .badge.sen{background:#3fb95033;color:var(--up)} .badge.house{background:#1f6feb33;color:var(--blue)}
  blockquote{border-left:3px solid var(--line2);margin:8px 0;padding:2px 0 2px 12px;color:var(--mut);font-size:13px}
  table{width:100%;border-collapse:collapse} td,th{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left;font-size:14px}
  code{background:#0b0f14;border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:12px}
  .empty{color:var(--mut);padding:14px 0}
  .xrel{margin-top:5px;font-size:13px} .xrel a{margin-right:12px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

// Facts-not-verdicts footer — load-bearing discipline, on EVERY page. Names the official-sources-only
// posture, the right-of-reply path for any person listed, and the not-advice line.
const FOOTER = `<footer>
  <b>Facts, not verdicts.</b> Politics.SoapBox states the public record — who holds office, who filed a
  disclosure, what campaign money was reported — and links the <b>official source</b> on every record.
  We render <b>no score, no rating</b>, and no "corrupt / clean" judgment about any person. <b>Right of
  reply:</b> any person listed may correct their own record through the source of record (the Clerk /
  Secretary of the Senate / FEC / the relevant agency) — we surface, we do not adjudicate. We never
  fabricate: when a source returns nothing, we say so and point you to the official source. Informational
  only — not legal, electoral, or financial advice.
  <div style="margin-top:8px"><a href="/">Politics</a> · <a href="${esc(LAW)}">Law</a> · <a href="${esc(DATA)}">Data</a> · <a href="${esc(SEARCH)}">Search</a> · <a href="${esc(WIKI)}">Library</a> · <a href="${esc(HEMP)}">Hemp</a></div>
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'Politics.SoapBox — your members of Congress, elections & civic info, lobbying disclosures, campaign finance, and a sourced politician/judge power-map. Facts, not verdicts. Keyless, official-source, cross-linked to Law.SoapBox.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const moneyTab = HAS_FEC ? `<a href="/money">Money</a>` : '';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
<meta name=robots content="${esc(robots)}">
<link rel=canonical href="${esc(canonical)}">${STYLE}</head><body>
<header class=topbar><a class=brand href="/">🏛 SoapBox <span>politics</span></a>
  <div class=topbar-r><a href="/reps">Reps</a><a href="/elections">Elections</a><a href="/lobbying">Lobbying</a>${moneyTab}<a href="/accountability">Accountability</a><a href="/dossiers">Files</a><a href="${esc(LAW)}">Law</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

function searchForm(action, { value = '', placeholder = 'Search…', label = 'Search', extra = '', name = 'q' } = {}) {
  return `<form class=polsearch method=get action="${esc(action)}"><div class=row>
    <input class=q name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete=off aria-label="${esc(label)}">
    ${extra}<button type=submit>${esc(label)}</button>
  </div></form>`;
}

// ── relatedOn(entity) — THE cross-site web ────────────────────────────────────────────────────────
// Emit cross-site links from an entity's metadata so Politics ↔ Law (and Politics ↔ money) is navigable.
// entity: { name, role?, kind?, office?, party?, chamber?, hasFinance?, candidateId? }
//   - a JUDGE → their opinions on Law.SoapBox  (law.soapbox.community/judges?q=<name>)
//   - a politician with finance → /money?q=<name>
// Returns an escaped <div class=xrel>…</div> (or '' when there's nothing to relate).
export function relatedOn(entity = {}) {
  const name = String(entity.name == null ? '' : entity.name).trim();
  if (!name) return '';
  const links = [];

  // is this person a judge? (role/kind/office signals)
  const role = String(entity.role || entity.kind || '').toLowerCase();
  const office = String(entity.office || '').toLowerCase();
  const isJudge = entity.isJudge === true
    || role.includes('judge') || role.includes('justice')
    || office.includes('court') || office.includes('judge') || office.includes('justice');
  if (isJudge) {
    links.push(`<a href="${esc(LAW)}/judges?q=${q(name)}" rel="nofollow noopener">opinions on Law.SoapBox →</a>`);
  }

  // does this politician have campaign finance? link the money page (only when /money is mounted).
  if (HAS_FEC && (entity.hasFinance === true || entity.candidateId || entity.party || entity.chamber || entity.office)) {
    links.push(`<a href="/money?q=${q(name)}">campaign finance →</a>`);
  }

  return links.length ? `<div class=xrel>${links.join('')}</div>` : '';
}

// ── home ──────────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const sections = [
    ['/reps', 'Your representatives', 'Look up your members of Congress — chamber, state, district, party — from the open congress-legislators dataset.'],
    ['/elections', 'Elections &amp; civic info', 'The next general election, registration deadlines, and how to find your local election office and what is on your ballot.'],
    ['/lobbying', 'Lobbying disclosures', 'Federal lobbying filings as disclosed under the Lobbying Disclosure Act — registrant, client, issues, reported $$.'],
    ...(HAS_FEC ? [['/money', 'Campaign finance', 'FEC candidate finance — receipts, disbursements, cash on hand — as a public record. No "raised too much" framing.']] : []),
    ['/accountability', 'Accountability map', 'A sourced power-map of politicians and judges — money, orgs, appointments, rulings — every claim linked, no verdicts.'],
    ['/dossiers', 'Accountability files', 'Curated, source-anchored profiles — holdings & companies owned/sold, charges & dispositions, statements to investigators, calls to resign. Every claim linked; no verdicts.'],
  ];
  const body = `<h1>SoapBox Politics <span class=muted style="font-size:14px">· the public civic record</span></h1>
    <p class=muted>Who represents you, when you vote, who lobbies, where the money is, and how it all connects —
      keyless, official-source, and cross-linked to <a href="${esc(LAW)}">Law.SoapBox</a> so a judge here links straight to their
      opinions there. Start by finding your representatives:</p>
    ${searchForm('/reps', {
      placeholder: 'Member name, e.g. “Warren” — or a 2-letter state like CA…',
      label: 'Find reps', extra: '<input class=q name=state placeholder="State (e.g. CA)" aria-label="State" style="flex:0 0 130px;max-width:130px">',
    })}
    <p class=muted style="font-size:13px;margin-top:-6px">Search a name, or enter a two-letter state code to list its congressional delegation.</p>
    <div class=grid style="margin-top:18px">
      ${sections.map(([href, t, d]) => `<a class=sec href="${esc(href)}"><div class=t>${t}</div><div class=d>${d}</div></a>`).join('')}
    </div>
    <div class=card style="margin-top:18px"><h2>How this connects to the law</h2>
      <p class=muted style="font-size:14px">Politics and law are one web. On the accountability map and the reps directory, where a
      person is a <b>judge</b> we link straight to a search of their opinions on <a href="${esc(LAW)}">Law.SoapBox</a>; where a politician
      has campaign finance we link the money page. The connective tissue is the <code>relatedOn()</code> helper, which reads an entity's
      public metadata and emits the cross-site links — so the record stays navigable across every SoapBox site.</p></div>`;
  return page('SoapBox Politics — Congress, elections, lobbying, money, accountability', body, { canonical: `${BASE_URL}/` });
}

// ── /reps — members of Congress (congress-legislators) ────────────────────────────────────────────
// A 2-letter token (or the `state` field) lists a delegation; anything else is a name search. Both soft-
// fail to an honest empty state. Every member row carries relatedOn() cross-site links.
function memberRow(m) {
  const chamberBadge = m.chamber === 'Senate' ? '<span class="badge sen">Senate</span>'
    : m.chamber === 'House' ? '<span class="badge house">House</span>' : (m.chamber ? `<span class=badge>${esc(m.chamber)}</span>` : '');
  const meta = [m.state ? (m.district ? `${m.state}-${m.district}` : m.state) : '', m.party, m.bioguide ? `Bioguide ${m.bioguide}` : '']
    .filter(Boolean).map(esc).join(' · ');
  const bioguideLink = m.bioguide
    ? `<a href="https://bioguide.congress.gov/search/bio/${q(m.bioguide)}" rel="nofollow noopener">official Bioguide profile →</a>`
    : '';
  // a member is a politician with (potential) campaign finance → relatedOn emits the money cross-link.
  const rel = relatedOn({ name: m.name, office: m.chamber, party: m.party, chamber: m.chamber, hasFinance: true });
  return `<div class=rec>
    <div class=nm>${esc(m.name || 'Member')}${chamberBadge}</div>
    <div class=meta>${meta}</div>
    ${bioguideLink ? `<div class=xlink>${bioguideLink}</div>` : ''}
    ${rel}
  </div>`;
}

export async function repsView(query, state) {
  const term = String(query == null ? '' : query).trim();
  const st = String(state == null ? '' : state).trim().toUpperCase();
  const extra = `<input class=q name=state value="${esc(st)}" placeholder="State (e.g. CA)" aria-label="State" style="flex:0 0 130px;max-width:130px">`;
  const form = searchForm('/reps', { value: term, placeholder: 'Member name, e.g. “Warren”…', label: 'Find reps', extra });

  let results = '';
  // a 2-letter term with no explicit state → treat the term itself as a state code.
  const stateCode = st || (/^[A-Za-z]{2}$/.test(term) ? term.toUpperCase() : '');
  if (stateCode && (!term || /^[A-Za-z]{2}$/.test(term))) {
    const rows = await congress.currentLegislators({ state: stateCode }).catch(() => []);
    results = rows.length
      ? `<div class=card><h2>${rows.length} member${rows.length === 1 ? '' : 's'} from ${esc(stateCode)}</h2>${rows.map(memberRow).join('')}</div>`
      : `<div class=card><h2>Members from ${esc(stateCode)}</h2><p class=empty>No members found for “${esc(stateCode)}”. The open
          congress-legislators dataset is the source of record — <a href="https://github.com/unitedstates/congress-legislators" rel="nofollow noopener">browse it there →</a></p></div>`;
  } else if (term) {
    const rows = await congress.findByName(term).catch(() => []);
    results = rows.length
      ? `<div class=card><h2>${rows.length} member${rows.length === 1 ? '' : 's'} for “${esc(term)}”</h2>${rows.map(memberRow).join('')}</div>`
      : `<div class=card><h2>Members for “${esc(term)}”</h2><p class=empty>No members found. Try a last name, or a two-letter state code like
          <code>CA</code> to list a whole delegation.</p></div>`;
  }
  return `<h1>Your representatives</h1>
    <p class=muted>Current members of Congress from the open <b>@unitedstates/congress-legislators</b> dataset (CC0) — chamber, state,
      district, and party. Facts only; never a rating. Where a member is a judge, or has campaign finance, the row cross-links the
      record on the other SoapBox sites.</p>
    ${form}${results}`;
}

// ── /elections — elections & civic info ───────────────────────────────────────────────────────────
// Calendar math (election-clock) is pure & always renders. The Google Civic surface (elections-info /
// elections-civic) is keyed and soft-skips to the local-election-office pointer when no key is set.
export async function electionsView(address) {
  const addr = String(address == null ? '' : address).trim();
  const form = searchForm('/elections', { value: addr, placeholder: 'Your address (for what’s on your ballot)…', label: 'Look up', name: 'address' });

  // pure calendar — next general election + (estimated) registration deadline. Always renders.
  const next = clock.nextGeneralElection() || null;
  const clockCard = next
    ? `<div class=card><h2>Next general election</h2>
        <p><b>${esc(next.date)}</b> — ${next.presidential ? 'PRESIDENTIAL' : 'midterm'} year ${esc(next.year)} · <b>${esc(next.daysUntil)}</b> days out.</p>
        <p class=muted style="font-size:13px">Pure calendar math (federal general elections fall the Tuesday after the first Monday in November of even years).
          Registration deadlines vary by state and are estimates here — confirm with your official source below.</p></div>`
    : `<div class=card><h2>Next general election</h2><p class=empty>Could not compute the next election date.</p></div>`;

  // the honest "go to your local election office" pointer is ALWAYS shown (it IS official guidance).
  const ptr = civic.localElectionOfficePointer();
  const officeCard = `<div class=card><h2>Find your local election office</h2>
    <div class=rec><div class=nm><a href="${esc(ptr.sourceUrl)}" rel="nofollow noopener">${esc(ptr.source)}</a></div>
      <div class=meta>${esc(ptr.note)}</div></div>
    <p class=muted style="font-size:12px;margin-top:8px">Actionable voting info — where/when/how to vote — comes from election officials. We point you there; we never invent it.</p></div>`;

  // optional ballot lookup (keyed; soft-skips to the pointer when no key / no data / expired).
  let ballotCard = '';
  if (addr) {
    const info = await electionsInfo.voterInfo({ address: addr }).catch(() => null);
    ballotCard = (info && (info.election || info.administration))
      ? `<div class=card><h2>Voting information for your address</h2>${electionsInfo.renderPage(info)}</div>`
      : `<div class=card><h2>Voting information for “${esc(addr)}”</h2>
          <p class=empty>No voter information is available for that address right now${electionsInfo.hasKey() ? '' : ' (the Google Civic key is not configured here)'} —
          use your local election office above, which is the authoritative source.</p>
          <p class=muted style="font-size:12px">${esc(electionsInfo.deferNote())}</p></div>`;
  }

  return `<h1>Elections &amp; civic info</h1>
    <p class=muted>When the next election is, and how to find your local election office and what is on your ballot. The calendar is
      computed; the actionable voting info comes from election officials — we link them and never fabricate where/when/how to vote.</p>
    ${clockCard}
    ${form}${ballotCard}
    ${officeCard}`;
}

// ── /lobbying — federal lobbying disclosures (lobbying-lda) ────────────────────────────────────────
export async function lobbyingView(query) {
  const term = String(query == null ? '' : query).trim();
  const form = searchForm('/lobbying', { value: term, placeholder: 'Registrant, client, or issue — e.g. “Boeing”…', label: 'Search filings' });

  let results = '';
  if (term) {
    const rows = await lobbying.searchFilings({ q: term, limit: 25 }).catch(() => []);
    results = rows.length
      ? `<div class=card><h2>${rows.length} filing${rows.length === 1 ? '' : 's'} for “${esc(term)}”</h2>${rows.map(filingRow).join('')}</div>`
      : `<div class=card><h2>Filings for “${esc(term)}”</h2><p class=empty>No lobbying disclosures found${term ? '' : ' — enter a registrant, client, or issue'}.
          The Senate Lobbying Disclosure Act database is the source of record — <a href="https://lda.senate.gov/filings/public/filing/search/" rel="nofollow noopener">search it there →</a></p></div>`;
  }
  return `<h1>Lobbying disclosures</h1>
    <p class=muted>Federal lobbying filings <b>as disclosed</b> under the Lobbying Disclosure Act — the registrant (lobbying firm), the
      client who hired them, the issues, and the reported amount. Facts as filed; never a judgment. Filers correct their own record
      via amended filings (right of reply).</p>
    ${form}${results}`;
}

function filingRow(f) {
  const money = f.income != null ? `$${esc((+f.income).toLocaleString())}` : (f.expenses != null ? `$${esc((+f.expenses).toLocaleString())}` : '—');
  const meta = [f.year, f.period, f.type].filter(Boolean).map(esc).join(' · ');
  return `<div class=rec>
    <div class=nm>${f.documentUrl ? `<a href="${esc(f.documentUrl)}" rel="nofollow noopener">${esc(f.registrant || 'Filing')}</a>` : esc(f.registrant || 'Filing')}</div>
    <div class=meta>${meta}${f.client ? ` · client: ${esc(f.client)}` : ''} · reported ${money}</div>
    ${(f.issues && f.issues.length) ? `<div class=meta>Issues: ${esc(f.issues.join(', '))}</div>` : ''}
    ${f.documentUrl ? `<div class=xlink><a href="${esc(f.documentUrl)}" rel="nofollow noopener">read the filing →</a></div>` : ''}
  </div>`;
}

// ── /money — campaign finance (fec) — only when fec.mjs is wired ───────────────────────────────────
function candidateRow(c) {
  const meta = [c.party, c.office, c.state ? (c.district ? `${c.state}-${c.district}` : c.state) : '', c.incumbentChallenge]
    .filter(Boolean).map(esc).join(' · ');
  const moneyLink = `<a href="/money?id=${q(c.candidateId)}">finance detail →</a>`;
  const fecLink = c.candidateId ? `<a href="https://www.fec.gov/data/candidate/${q(c.candidateId)}/" rel="nofollow noopener">on FEC.gov →</a>` : '';
  return `<div class=rec>
    <div class=nm>${esc(c.name || 'Candidate')}${c.candidateId ? `<span class=badge>${esc(c.candidateId)}</span>` : ''}</div>
    <div class=meta>${meta}</div>
    <div class=xlink>${moneyLink}${fecLink ? ` · ${fecLink}` : ''}</div>
  </div>`;
}

export async function moneyView(query, candidateId) {
  const term = String(query == null ? '' : query).trim();

  // detail view (?id=…) — one candidate + totals + committees.
  if (candidateId) {
    const id = String(candidateId).trim();
    const [c, totals, committees] = await Promise.all([
      fec.candidate(id).catch(() => null),
      fec.candidateTotals(id).catch(() => []),
      fec.committeesForCandidate(id).catch(() => []),
    ]);
    if (!c) {
      return `<h1>Campaign finance</h1>
        <p class=muted><a href="/money">← candidate search</a></p>
        <div class=card><p class=empty>No FEC candidate on record for <code>${esc(id)}</code>.
          <a href="https://www.fec.gov/data/candidate/${q(id)}/" rel="nofollow noopener">Look it up on FEC.gov →</a></p></div>`;
    }
    return `<h1>${esc(c.name || 'Candidate')} <span class=muted style="font-size:14px">· campaign finance</span></h1>
      <p class=muted><a href="/money">← candidate search</a></p>
      <div class=card>${fec.renderPage({ candidate: c, totals, committees })}</div>`;
  }

  // search view.
  const form = searchForm('/money', { value: term, placeholder: 'Candidate name, e.g. “Warren”…', label: 'Search candidates' });
  let results = '';
  if (term) {
    const rows = await fec.candidateSearch({ q: term, limit: 20 }).catch(() => []);
    results = rows.length
      ? `<div class=card><h2>${rows.length} candidate${rows.length === 1 ? '' : 's'} for “${esc(term)}”</h2>${rows.map(candidateRow).join('')}</div>`
      : `<div class=card><h2>Candidates for “${esc(term)}”</h2><p class=empty>No FEC candidates found.
          <a href="https://www.fec.gov/data/candidates/?q=${q(term)}" rel="nofollow noopener">Search FEC.gov →</a></p></div>`;
  }
  return `<h1>Campaign finance</h1>
    <p class=muted>FEC candidate finance — receipts, disbursements, cash on hand — as the public record reports it. Facts only:
      no "raised too much / too little" framing. Candidates correct their own record via amended FEC filings (right of reply).</p>
    ${form}${results}`;
}

// ── /accountability — politician / judge power-map (accountability-graph) ──────────────────────────
// fromRecords() ingests injected reader records into a sourced graph; powerMap()/renderProfile() draw a
// person's connections. Where a connection is a judge, relatedOn() cross-links Law.SoapBox; where a
// politician has finance, it cross-links /money. With no records injected the page renders an honest
// empty state and explains the method — we never fabricate connections.
export function accountabilityView(query, records = null) {
  const term = String(query == null ? '' : query).trim();
  const form = searchForm('/accountability', { value: term, placeholder: 'Person name, e.g. a member of Congress or a judge…', label: 'Build map' });

  let results = '';
  if (term) {
    const { graph } = accountability.fromRecords(Array.isArray(records) ? records : []);
    const node = graph.getNode(term);
    const map = accountability.powerMap(term, graph);
    const hasAny = node || (map.money.in.length + map.money.out.length + map.orgs.length + map.appointments.length + map.rulings.length) > 0;
    if (hasAny) {
      // the person's own cross-site links (is THEY a judge? do they have finance?).
      const personRel = relatedOn({
        name: map.person.name, role: map.person.role, office: map.person.office,
        party: map.person.party, hasFinance: !!(map.person.party || map.person.office),
        isJudge: map.rulings.length > 0,
      });
      // cross-links for any judge that appears in the rulings (their opinions live on Law.SoapBox).
      const judgeCross = map.rulings.length
        ? `<div class=card><h2>Connected to the law</h2>
            <p class=muted style="font-size:13px">This person has rulings on record — their opinions are on Law.SoapBox:</p>
            ${relatedOn({ name: map.person.name, isJudge: true })}</div>`
        : '';
      results = `<div class=card><h2>Power-map: ${esc(map.person.name)}</h2>${personRel}${accountability.renderProfile(map)}</div>${judgeCross}`;
    } else {
      results = `<div class=card><h2>Power-map: “${esc(term)}”</h2>
        <p class=empty>No sourced connections are loaded for that person yet. This map is built <b>only</b> from records that carry an
        official source — we never fabricate a connection. As the keyless readers (FEC, Senate LDA, CourtListener) feed sourced records
        in, money / orgs / appointments / rulings appear here, each linked to its source.</p>
        ${relatedOn({ name: term, hasFinance: true })}</div>`;
    }
  }
  return `<h1>Accountability map</h1>
    <p class=muted>A sourced power-map of politicians and judges — money in/out, organizations, appointments, and rulings. <b>Every claim
      links its source; there is no score, rating, or verdict.</b> Where a person is a judge, we link their opinions on
      <a href="${esc(LAW)}">Law.SoapBox</a>; where a politician has campaign finance, we link the money page. Every profile carries a
      right-of-reply slot.</p>
    ${form}${results}`;
}

// ── /dossiers + /dossier — the curated watchdog files (knowledge/accountability/*.json) ───────────
// These are hand-curated, source-anchored profiles in the same FACTS+SOURCES, no-verdicts discipline
// as the live accountability map — but persistent and richer (holdings/companies owned & sold, charges
// + dispositions, statements to investigators, calls to resign, impeachments). Each links every claim.
export async function dossiersIndexView() {
  let list = [];
  try { list = await dossier.listDossiers(); } catch { list = []; }
  const cards = list.length
    ? list.map((d) => `<a class=card style="display:block;text-decoration:none" href="/dossier?who=${q(d.slug)}">
        <h2 style="margin:.2em 0">${esc(d.name)}</h2>
        <p class=muted style="font-size:13px;margin:.2em 0">${esc(d.office || '')}${d.party ? ` · ${esc(d.party)}` : ''}
        ${d.verified ? '· <span style="color:#7c7">sources confirmed</span>' : '· <span style="color:#caa">draft</span>'}</p></a>`).join('')
    : `<div class=card><p class=empty>No dossiers on file yet.</p></div>`;
  return `<h1>Accountability files</h1>
    <p class=muted>Curated, source-anchored profiles — money, holdings &amp; companies (owned / sold), charges and their
      dispositions, statements to investigators, documented calls to resign, impeachments. <b>Every claim links its source;
      there is no score, rating, or verdict.</b> Each profile carries a right-of-reply slot for its subject.</p>
    ${cards}`;
}

export async function dossierView(slug) {
  let body = '';
  try { body = await dossier.renderDossierPage(slug); } catch { body = ''; }
  if (!body) body = `<div class=card><p class=empty>No dossier on file for that name yet.</p></div>`;
  const rel = relatedOn({ name: String(slug || '').replace(/-/g, ' '), hasFinance: true });
  return `<h1>Accountability file</h1>
    <p class=muted><a href="/dossiers">← all files</a> · facts and connections from public records — we render no verdicts.</p>
    ${body}${rel}`;
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}

const SITEMAP_PATHS = ['/', '/reps', '/elections', '/lobbying', ...(HAS_FEC ? ['/money'] : []), '/accountability', '/dossiers'];

// The request handler — exported so offline tests drive routes through a mock req/res (no port bound).
export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt(BASE_URL));
    }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({
        path: u, lastmod: today, changefreq: u === '/' ? 'daily' : 'weekly', priority: u === '/' ? '1.0' : '0.7',
      }));
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (path === '/sitemap-index.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10)));
    }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: 'SoapBox Politics', baseUrl: BASE_URL,
        summary: 'Members of Congress, elections & civic info, lobbying disclosures, campaign finance, and a sourced politician/judge accountability map — official-source US civic data, cross-linked to Law.SoapBox.',
        links: [
          { label: 'Your representatives', path: '/reps' },
          { label: 'Elections & civic info', path: '/elections' },
          { label: 'Lobbying disclosures', path: '/lobbying' },
          ...(HAS_FEC ? [{ label: 'Campaign finance', path: '/money' }] : []),
          { label: 'Accountability map', path: '/accountability' },
          { label: 'Accountability files', path: '/dossiers' },
        ],
      }));
    }

    const sp = url.searchParams;
    if (path === '/') return sendHtml(res, homePage());

    if (path === '/reps') {
      return sendHtml(res, page('Your representatives — SoapBox Politics', await repsView(sp.get('q') || '', sp.get('state') || ''),
        { canonical: `${BASE_URL}/reps`, robots: (sp.get('q') || sp.get('state')) ? 'noindex,follow' : 'index,follow' }));
    }
    if (path === '/elections') {
      return sendHtml(res, page('Elections & civic info — SoapBox Politics', await electionsView(sp.get('address') || ''),
        { canonical: `${BASE_URL}/elections`, robots: sp.get('address') ? 'noindex,follow' : 'index,follow' }));
    }
    if (path === '/lobbying') {
      return sendHtml(res, page('Lobbying disclosures — SoapBox Politics', await lobbyingView(sp.get('q') || ''),
        { canonical: `${BASE_URL}/lobbying`, robots: sp.get('q') ? 'noindex,follow' : 'index,follow' }));
    }
    if (path === '/money') {
      if (!HAS_FEC) { res.writeHead(302, { location: '/' }); return res.end(); }
      return sendHtml(res, page('Campaign finance — SoapBox Politics', await moneyView(sp.get('q') || '', sp.get('id') || ''),
        { canonical: `${BASE_URL}/money`, robots: (sp.get('q') || sp.get('id')) ? 'noindex,follow' : 'index,follow' }));
    }
    if (path === '/accountability') {
      return sendHtml(res, page('Accountability map — SoapBox Politics', accountabilityView(sp.get('q') || ''),
        { canonical: `${BASE_URL}/accountability`, robots: sp.get('q') ? 'noindex,follow' : 'index,follow' }));
    }
    if (path === '/dossiers') {
      return sendHtml(res, page('Accountability files — SoapBox Politics', await dossiersIndexView(),
        { canonical: `${BASE_URL}/dossiers` }));
    }
    if (path === '/dossier') {
      const who = sp.get('who') || '';
      return sendHtml(res, page(`Accountability file — SoapBox Politics`, await dossierView(who),
        { canonical: `${BASE_URL}/dossier?who=${q(who)}`, robots: who ? 'index,follow' : 'noindex,follow' }));
    }

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Exported for tests / extension wiring.
export { HAS_FEC };

// Only bind the port when run directly (`node site/politics/server.mjs`), not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith('server.mjs') && /site\/politics\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Politics on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
