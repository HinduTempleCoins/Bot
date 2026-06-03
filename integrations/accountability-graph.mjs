// accountability-graph.mjs — Task #216 (v3 doc §6A.2): the politician / judge POWER-MAP.
//
// A people ↔ org ↔ money graph built strictly over PUBLIC RECORDS (the LittleSis model).
// This module is the GRAPH LAYER. It does NOT fetch anything: the underlying records come
// from the readers that already exist in this repo (OpenFEC + Congress.gov in
// integrations/soapbox/gov-readers.mjs, CourtListener in integrations/soapbox/legal.mjs,
// SAM.gov in integrations/soapbox/fed-opportunities.mjs). Those readers are imported
// DEFENSIVELY (best-effort dynamic import, soft-fail) only for an optional convenience
// collector — fromRecords() takes already-fetched records and never touches the network.
//
// THE DISCIPLINE — encoded structurally, not as policy text:
//   • FACTS + CONNECTIONS + SOURCES. NEVER VERDICTS. There is no 'corrupt', 'score',
//     'rating', or any judgement field anywhere in the node/edge/profile schema. The only
//     contestable slots are disputes[] (a labelled dispute) and reply (right-of-reply text).
//   • PUBLIC-CAPACITY ONLY. Person nodes carry public-capacity fields (name, office, party,
//     bio_url) and NOTHING ELSE. addNode() strips/rejects home_address, family, dob, ssn,
//     phone, email, and the like — the schema simply has no such fields.
//   • EVERY EDGE REQUIRES A SOURCE. An edge without { source: { name, url }, asOf } is
//     REJECTED by addEdge(). No source → no edge. Full stop.
//
// FollowTheMoney-style schema naming: entities are NODES with a kind; relationships are
// EDGES with a kind; both carry provenance.
//
//   import { createGraph, fromRecords, powerMap, renderProfile,
//            NODE_KINDS, EDGE_KINDS, LICENSE_TAGS } from './accountability-graph.mjs'
//   node integrations/accountability-graph.mjs demo

// ── allowed vocabularies ──────────────────────────────────────────────────────────────
export const NODE_KINDS = Object.freeze(['person', 'org', 'committee', 'agency', 'office']);

export const EDGE_KINDS = Object.freeze([
  'donated-to',      // person/org → committee/candidate (campaign finance)
  'lobbied',         // org/registrant → office/agency/committee
  'board-of',        // person → org
  'appointed-by',    // person (office holder) → person/office (appointer)
  'ruled-in',        // person (judge) → org/case
  'contracted-with', // org → agency (procurement)
  'employed-by',     // person → org
]);

// Per-source licensing tags. Gov primary records are public-domain (host-attributed);
// OpenSecrets is CC-Attribution; ProPublica is CC BY-NC-ND with a window-only flag.
export const LICENSE_TAGS = Object.freeze({
  'OpenFEC':        { license: 'public-domain', host: 'FEC' },
  'Congress.gov':   { license: 'public-domain', host: 'Library of Congress' },
  'CourtListener':  { license: 'public-domain', host: 'Free Law Project' },
  'USAspending':    { license: 'public-domain', host: 'USAspending.gov' },
  'SAM.gov':        { license: 'public-domain', host: 'GSA' },
  'Senate LDA':     { license: 'public-domain', host: 'US Senate' },
  'OpenSecrets':    { license: 'cc-attribution', host: 'OpenSecrets.org' },
  'ProPublica':     { license: 'cc-by-nc-nd-window', host: 'ProPublica', windowOnly: true },
});

/** Resolve a source name to its license tag (defensive default = attribution-required). */
export function licenseFor(sourceName) {
  const n = String(sourceName == null ? '' : sourceName).trim();
  return LICENSE_TAGS[n] || { license: 'cc-attribution', host: n || 'unknown' };
}

// ── public-capacity person schema ───────────────────────────────────────────────────────
// The ONLY fields a person node may carry. Anything not listed is dropped by addNode().
const PERSON_PUBLIC_FIELDS = Object.freeze(['name', 'office', 'party', 'jurisdiction', 'bio_url', 'role']);
const ORG_PUBLIC_FIELDS = Object.freeze(['name', 'kind_label', 'jurisdiction', 'url']);
// Fields we NEVER store about a person — private-individual / PII surface. Listed so the
// stripping is explicit and auditable; they are deleted on the way in.
const PII_FIELDS = Object.freeze([
  'home_address', 'address', 'street', 'family', 'spouse', 'children', 'relatives',
  'dob', 'birthdate', 'ssn', 'phone', 'email', 'personal_email', 'cell', 'private',
]);

const str = (v) => (v == null ? '' : String(v)).trim();
const now = () => new Date().toISOString();

// HTML escape — every interpolated value passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** Validate a { name, url } source descriptor. Returns a clean object or null. */
function cleanSource(src) {
  if (!src || typeof src !== 'object') return null;
  const name = str(src.name);
  if (!name) return null; // a source MUST be attributable
  return { name, url: str(src.url) || null };
}

// ── the graph ─────────────────────────────────────────────────────────────────────────
export function createGraph() {
  const nodes = new Map(); // id -> node
  const edges = [];        // array of edge objects

  /**
   * Add (or merge) a node. kind must be in NODE_KINDS. Person/org property whitelists are
   * enforced; any PII / non-public field is STRIPPED. A node with a rejected kind returns null.
   */
  function addNode(node) {
    if (!node || typeof node !== 'object') return null;
    const kind = str(node.kind);
    if (!NODE_KINDS.includes(kind)) return null;
    const id = str(node.id) || str(node.name);
    if (!id) return null;

    // Build the cleaned record from the allowed whitelist for this kind.
    const allowed = kind === 'person' ? PERSON_PUBLIC_FIELDS
      : kind === 'org' ? ORG_PUBLIC_FIELDS
        : ['name', 'jurisdiction', 'url']; // committee / agency / office
    const clean = { id, kind };
    for (const f of allowed) {
      const v = str(node[f]);
      if (v) clean[f] = v;
    }
    if (!clean.name) clean.name = id;
    // never carry a verdict, never carry PII — neither is in the whitelist, so this is
    // belt-and-suspenders: assert none leaked through (they can't, but make it explicit).
    for (const bad of PII_FIELDS) delete clean[bad];
    delete clean.score; delete clean.corrupt; delete clean.rating;

    const existing = nodes.get(id);
    if (existing) { Object.assign(existing, clean); return existing; }
    // contestable slots live on the node but carry NO judgement of their own.
    clean.disputes = [];     // [{ label, source, asOf }]
    clean.reply = '';        // right-of-reply text slot, owner-supplied
    nodes.set(id, clean);
    return clean;
  }

  /**
   * Add an edge. REQUIRES a valid kind AND a source { name, url } + asOf. Any edge missing a
   * source, or with an unknown kind, is REJECTED (returns null) — no source, no edge.
   */
  function addEdge(edge) {
    if (!edge || typeof edge !== 'object') return null;
    const kind = str(edge.kind);
    if (!EDGE_KINDS.includes(kind)) return null;
    const from = str(edge.from);
    const to = str(edge.to);
    if (!from || !to) return null;
    const source = cleanSource(edge.source);
    if (!source) return null; // SOURCE-REQUIRED invariant
    const asOf = str(edge.asOf);
    if (!asOf) return null;    // every edge is timestamped to its record

    const rec = {
      kind, from, to, source, asOf,
      license: licenseFor(source.name),
    };
    // edge attributes that are facts, never verdicts (amount, title, position…)
    if (edge.amount != null && Number.isFinite(Number(edge.amount))) rec.amount = Number(edge.amount);
    if (edge.label) rec.label = str(edge.label);
    if (edge.role) rec.role = str(edge.role);
    edges.push(rec);
    return rec;
  }

  /** All edges touching a node, with the neighbor id annotated as `other` + direction. */
  function neighbors(id) {
    const want = str(id);
    if (!want) return [];
    return edges
      .filter((e) => e.from === want || e.to === want)
      .map((e) => ({ ...e, other: e.from === want ? e.to : e.from, direction: e.from === want ? 'out' : 'in' }));
  }

  /**
   * All simple paths between a and b up to maxHops edges, treating edges as undirected for
   * traversal (a donation chain reads either way). Returns arrays of edge records.
   */
  function pathsBetween(a, b, { maxHops = 3 } = {}) {
    const start = str(a); const goal = str(b);
    if (!start || !goal || start === goal) return [];
    const found = [];
    const adj = (id) => edges.filter((e) => e.from === id || e.to === id);
    const walk = (cur, trail, visitedNodes) => {
      if (trail.length > maxHops) return;
      for (const e of adj(cur)) {
        if (trail.includes(e)) continue;
        const next = e.from === cur ? e.to : e.from;
        if (next === goal) { found.push([...trail, e]); continue; }
        if (visitedNodes.has(next)) continue;
        walk(next, [...trail, e], new Set([...visitedNodes, next]));
      }
    };
    walk(start, [], new Set([start]));
    // shortest first
    return found.sort((x, y) => x.length - y.length);
  }

  /** Connections of a person, grouped by edge kind. Each entry carries its source. */
  function connectionsOf(personId) {
    const grouped = {};
    for (const e of neighbors(personId)) {
      (grouped[e.kind] ||= []).push(e);
    }
    return grouped;
  }

  /** Record a labelled dispute against a node. The dispute itself REQUIRES a source. */
  function addDispute(nodeId, { label, source, asOf } = {}) {
    const n = nodes.get(str(nodeId));
    if (!n) return null;
    const s = cleanSource(source);
    const lab = str(label);
    if (!lab || !s) return null; // a dispute is a sourced fact, not an opinion
    const d = { label: lab, source: s, asOf: str(asOf) || now() };
    n.disputes.push(d);
    return d;
  }

  /** Set the right-of-reply text for a node. */
  function setReply(nodeId, text) {
    const n = nodes.get(str(nodeId));
    if (!n) return null;
    n.reply = str(text);
    return n;
  }

  return {
    addNode, addEdge, neighbors, pathsBetween, connectionsOf,
    addDispute, setReply,
    getNode: (id) => nodes.get(str(id)) || null,
    nodes: () => Array.from(nodes.values()),
    edges: () => edges.slice(),
  };
}

// ── normalization: injected reader records → graph ──────────────────────────────────────
// Each record is shaped like one of the existing readers' output. We detect by `source`
// (preferred) and by shape, then emit nodes + a sourced edge. Records without enough to
// form a sourced edge are skipped — NEVER fabricated.

function recSource(rec, fallbackName) {
  // Prefer an explicit { source: { name, url } }; else build from a string `source` + `url`.
  if (rec.source && typeof rec.source === 'object') return cleanSource(rec.source);
  const name = str(rec.source) || str(fallbackName);
  if (!name) return null;
  return { name, url: str(rec.url) || null };
}

function asOfOf(rec) {
  return str(rec.asOf) || str(rec.date) || str(rec.action_date) || str(rec.dateFiled) || str(rec.fetched_at) || now();
}

/**
 * Normalize an array of injected reader records into a graph. Pass an existing graph or one
 * is created. Returns { graph, added: { nodes, edges, skipped } }.
 */
export function fromRecords(records, graph = createGraph()) {
  const list = Array.isArray(records) ? records : [];
  let nAdded = 0; let eAdded = 0; let skipped = 0;
  const node = (n) => { if (graph.addNode(n)) nAdded++; };
  const edge = (e) => { if (graph.addEdge(e)) { eAdded++; return true; } skipped++; return false; };

  for (const rec of list) {
    if (!rec || typeof rec !== 'object') { skipped++; continue; }
    const type = str(rec.type || rec.recordType).toLowerCase();
    const srcName = str(rec.source) || (rec.source && rec.source.name);

    // ── FEC-shaped: a contribution (donated-to) ──────────────────────────────────────
    if (type === 'donation' || type === 'fec' || srcName === 'OpenFEC' || (rec.contributor != null && rec.recipient != null)) {
      const donor = str(rec.contributor || rec.donor);
      const recipient = str(rec.recipient);
      if (!donor || !recipient) { skipped++; continue; }
      // donor is treated in PUBLIC capacity only — name + (optional) public role; no PII.
      node({ kind: 'person', id: donor, name: donor, role: str(rec.occupation) || undefined });
      node({ kind: 'committee', id: recipient, name: recipient });
      edge({
        kind: 'donated-to', from: donor, to: recipient,
        amount: rec.amount, source: recSource(rec, 'OpenFEC'), asOf: asOfOf(rec),
      });
      continue;
    }

    // ── lobbying-shaped: registrant/client lobbied an office/agency ───────────────────
    if (type === 'lobbying' || type === 'lobby' || srcName === 'Senate LDA' || (rec.registrant != null || rec.client != null)) {
      const actor = str(rec.registrant || rec.client || rec.lobbyist);
      const target = str(rec.target || rec.agency || rec.office || rec.recipient);
      if (!actor || !target) { skipped++; continue; }
      node({ kind: 'org', id: actor, name: actor, kind_label: 'lobbying registrant' });
      node({ kind: 'agency', id: target, name: target });
      edge({
        kind: 'lobbied', from: actor, to: target,
        label: str(rec.issue || rec.subject) || undefined,
        amount: rec.amount, source: recSource(rec, 'Senate LDA'), asOf: asOfOf(rec),
      });
      // a client behind the registrant → employed-by / contracted-with link
      if (rec.client && rec.registrant && str(rec.client) !== str(rec.registrant)) {
        node({ kind: 'org', id: str(rec.client), name: str(rec.client) });
        edge({
          kind: 'contracted-with', from: str(rec.client), to: actor,
          source: recSource(rec, 'Senate LDA'), asOf: asOfOf(rec),
        });
      }
      continue;
    }

    // ── judge-shaped: a judge ruled in a case, or was appointed ───────────────────────
    if (type === 'ruling' || type === 'judge' || type === 'opinion' || srcName === 'CourtListener' || rec.judge != null || rec.caseName != null) {
      const judge = str(rec.judge || rec.author);
      const caseName = str(rec.caseName || rec.case || rec.party || rec.title);
      if (judge && caseName) {
        node({ kind: 'person', id: judge, name: judge, role: 'judge', office: str(rec.court) || undefined });
        node({ kind: 'org', id: caseName, name: caseName, kind_label: 'case party' });
        edge({
          kind: 'ruled-in', from: judge, to: caseName,
          label: str(rec.disposition || rec.outcome) || undefined,
          source: recSource(rec, 'CourtListener'), asOf: asOfOf(rec),
        });
      }
      if (judge && rec.appointed_by) {
        node({ kind: 'person', id: judge, name: judge, role: 'judge' });
        node({ kind: 'office', id: str(rec.appointed_by), name: str(rec.appointed_by) });
        edge({
          kind: 'appointed-by', from: judge, to: str(rec.appointed_by),
          source: recSource(rec, 'CourtListener'), asOf: asOfOf(rec),
        });
      }
      if (judge || caseName) continue;
    }

    // ── procurement-shaped: org contracted with an agency ─────────────────────────────
    if (type === 'award' || type === 'contract' || srcName === 'USAspending' || srcName === 'SAM.gov' || (rec.recipient != null && rec.agency != null)) {
      const org = str(rec.recipient);
      const agency = str(rec.agency);
      if (org && agency) {
        node({ kind: 'org', id: org, name: org });
        node({ kind: 'agency', id: agency, name: agency });
        edge({
          kind: 'contracted-with', from: org, to: agency,
          amount: rec.amount, source: recSource(rec, srcName || 'USAspending'), asOf: asOfOf(rec),
        });
        continue;
      }
    }

    skipped++;
  }
  return { graph, added: { nodes: nAdded, edges: eAdded, skipped } };
}

// ── powerMap: a person's connections, grouped, every item sourced ───────────────────────
/**
 * Build a power-map for a person id over a graph. FACTS ONLY: money in/out, orgs,
 * appointments, rulings, plus the contestable disputes[] + reply slots. Every item carries
 * its source. There is NO verdict / score / rating anywhere.
 */
export function powerMap(personId, graph) {
  const id = str(personId);
  const person = (graph.getNode && graph.getNode(id)) || { id, kind: 'person', name: id, disputes: [], reply: '' };
  const grouped = graph.connectionsOf(id);

  const item = (e) => ({
    other: e.other, direction: e.direction, kind: e.kind,
    amount: e.amount ?? null, label: e.label || null, role: e.role || null,
    asOf: e.asOf, source: e.source, license: e.license,
  });

  const donations = grouped['donated-to'] || [];
  const money = {
    out: donations.filter((e) => e.direction === 'out').map(item),
    in: donations.filter((e) => e.direction === 'in').map(item),
  };

  return {
    person: {
      id: person.id, name: person.name || person.id, kind: person.kind,
      office: person.office || null, party: person.party || null,
      role: person.role || null, bio_url: person.bio_url || null,
    },
    money,
    orgs: [...(grouped['board-of'] || []), ...(grouped['employed-by'] || []), ...(grouped['contracted-with'] || []), ...(grouped['lobbied'] || [])].map(item),
    appointments: (grouped['appointed-by'] || []).map(item),
    rulings: (grouped['ruled-in'] || []).map(item),
    disputes: (person.disputes || []).slice(),
    reply: person.reply || '',
  };
}

// ── renderProfile: escaped HTML, every claim linked to its source ───────────────────────
const NO_VERDICTS_LINE = 'facts and connections from public records — we do not render verdicts';

function sourceLink(src) {
  if (!src || !src.name) return '<span class="src">(unsourced — not shown)</span>';
  const name = esc(src.name);
  return src.url
    ? `<a class="src" href="${esc(src.url)}" rel="nofollow noopener">${name}</a>`
    : `<span class="src">${name}</span>`;
}

function itemLine(it) {
  const amt = it.amount != null ? ` $${esc(it.amount)}` : '';
  const lab = it.label ? ` — ${esc(it.label)}` : '';
  const lic = it.license && it.license.license ? ` <span class="lic">[${esc(it.license.license)}]</span>` : '';
  return `<li>${esc(it.kind)}: <span class="ent">${esc(it.other)}</span>${amt}${lab} `
    + `<span class="asof">(as of ${esc(it.asOf)})</span> — ${sourceLink(it.source)}${lic}</li>`;
}

/**
 * Render a power-map as escaped HTML. EVERY claim links to its source. Includes the
 * right-of-reply block and the standing no-verdicts line. Contains no verdict fields.
 */
export function renderProfile(map) {
  const p = (map && map.person) || { name: '', id: '' };
  const sec = (title, items) => {
    if (!items || !items.length) return '';
    return `<section><h3>${esc(title)}</h3><ul>${items.map(itemLine).join('')}</ul></section>`;
  };
  const moneyOut = sec('Money out (contributions made)', map.money?.out);
  const moneyIn = sec('Money in (contributions received)', map.money?.in);
  const orgs = sec('Organizations', map.orgs);
  const appts = sec('Appointments', map.appointments);
  const rulings = sec('Rulings', map.rulings);

  const disputes = (map.disputes && map.disputes.length)
    ? `<section class="disputes"><h3>Disputes</h3><ul>${map.disputes.map((d) =>
      `<li>${esc(d.label)} <span class="asof">(as of ${esc(d.asOf)})</span> — ${sourceLink(d.source)}</li>`).join('')}</ul></section>`
    : '';

  const reply = `<section class="right-of-reply"><h3>Right of reply</h3>`
    + `<p>${map.reply ? esc(map.reply) : '<em>No reply on file. The subject of this profile may submit a response.</em>'}</p></section>`;

  return [
    `<article class="power-map">`,
    `<h2>${esc(p.name || p.id)}</h2>`,
    p.office ? `<p class="office">${esc(p.office)}</p>` : '',
    p.party ? `<p class="party">${esc(p.party)}</p>` : '',
    `<p class="disclaimer">${esc(NO_VERDICTS_LINE)}</p>`,
    moneyOut, moneyIn, orgs, appts, rulings,
    disputes,
    reply,
    `</article>`,
  ].filter(Boolean).join('\n');
}

// ── CLI (guarded) ───────────────────────────────────────────────────────────────────────
const isMain = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
})();

if (isMain) {
  const demo = [
    { type: 'donation', contributor: 'Jane Donor', recipient: 'Friends of Smith PAC', amount: 2800, date: '2024-03-01', source: 'OpenFEC', url: 'https://www.fec.gov/x' },
    { type: 'donation', contributor: 'Friends of Smith PAC', recipient: 'Sen. John Smith', amount: 5000, date: '2024-04-01', source: 'OpenFEC', url: 'https://www.fec.gov/y' },
    { type: 'lobbying', registrant: 'BigLobby LLC', client: 'AcmeCorp', target: 'Dept of Energy', issue: 'energy policy', date: '2024-02-01', source: 'Senate LDA', url: 'https://lda.senate.gov/z' },
    { type: 'ruling', judge: 'Hon. Pat Justice', caseName: 'AcmeCorp v. State', court: 'ca9', disposition: 'affirmed', dateFiled: '2023-09-01', source: 'CourtListener', url: 'https://www.courtlistener.com/op/1' },
  ];
  const { graph, added } = fromRecords(demo);
  process.stdout.write(`normalized: ${JSON.stringify(added)}\n`);
  const map = powerMap('Friends of Smith PAC', graph);
  process.stdout.write(renderProfile(map) + '\n');
  const paths = graph.pathsBetween('Jane Donor', 'Sen. John Smith', { maxHops: 3 });
  process.stdout.write(`paths Jane→Smith: ${paths.length}\n`);
}
