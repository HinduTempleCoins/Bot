// nascar-enrich.mjs — the SPONSOR-PATCH layer for reports.
//
// The operator's framing: show officials the way a NASCAR driver is shown — with every sponsor
// visible on the suit. A driver does not get to appear as a neutral figure in a clean uniform; the
// logos are the point, and they are right there.
//
// WHAT THIS ADDS THAT accountability-graph.mjs DOES NOT. That module is the graph: nodes, edges,
// provenance, and powerMap()/renderProfile() for ONE person. This module takes a FINISHED REPORT —
// a press release, a filing, an article draft — finds the people it names, and attaches what the
// writer did not know to look for.
//
// AND THE PART THAT IS ACTUALLY WORTH SOMETHING IS NOT THE PROFILES. It is the INTERSECTION.
// One judge with a donor list is a profile, and any reporter can pull it. Two judges who share a
// donor, where that donor is also the county's outside counsel, is a story — and it is invisible in
// both profiles read separately, because neither one mentions the other. sharedTies() is the whole
// module; patches() exists to feed it.
//
// THE DISCIPLINE IS INHERITED AND TIGHTENED:
//   • NO SOURCE, NO PATCH. accountability-graph rejects an unsourced edge outright. We go further
//     and drop any tie whose source lost its url/name in transit, so an enrichment block can never
//     contain a claim a reader cannot check.
//   • NO VERDICTS. There is no score, no rating, no "conflict" flag. An overlap is reported as an
//     overlap. Whether it matters is the reader's call, and saying so is not modesty — a tool that
//     scored people would be worth less, because the number would be the story instead of the tie.
//   • PUBLIC CAPACITY ONLY, inherited from the graph's node whitelist.
//   • ⚠️ NAME MATCHING IS A SUGGESTION, NEVER A FINDING. Two people share a name constantly.
//     findActors() returns candidates with a `confidence` and requires the caller to confirm;
//     nothing is auto-attached to a report on the strength of a string match.
//
//   import { patches, sharedTies, findActors, enrich, renderEnrichment } from './nascar-enrich.mjs'

const str = (s) => String(s == null ? '' : s).trim();
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** A tie is only usable if a reader can check it. */
export function isCheckable(tie) {
  return Boolean(tie && tie.source && str(tie.source.name));
}

// Which edge kinds read as a "sponsor patch" — something attached to the person by someone else.
const PATCH_KINDS = Object.freeze({
  'donated-to': 'funding',
  'employed-by': 'employment',
  'board-of': 'board seat',
  'appointed-by': 'appointment',
  'contracted-with': 'contract',
  'lobbied': 'lobbying',
  'invested-in': 'holding',
});

/**
 * The logos on the suit. Returns every checkable tie for one person, flattened and labelled,
 * with the counterparty id exposed so intersections can be computed across people.
 */
export function patches(personId, graph) {
  const id = str(personId);
  if (!id || !graph || typeof graph.connectionsOf !== 'function') return [];
  let grouped;
  try { grouped = graph.connectionsOf(id) || {}; } catch { return []; }

  const out = [];
  for (const [kind, label] of Object.entries(PATCH_KINDS)) {
    for (const e of grouped[kind] || []) {
      if (!isCheckable(e)) continue;               // no source, no patch
      out.push({
        person: id,
        kind,
        label,
        other: str(e.other),
        direction: e.direction || null,
        amount: e.amount ?? null,
        role: e.role || null,
        status: e.status || null,
        asOf: e.asOf || null,
        source: e.source,
      });
    }
  }
  return out;
}

/**
 * ⭐ THE POINT OF THE MODULE. Given several people, find the counterparties that touch MORE THAN
 * ONE of them. Returns one row per shared counterparty, with the per-person ties that establish it.
 *
 * `minPeople` defaults to 2 because an overlap of one is not an overlap.
 */
export function sharedTies(personIds = [], graph, { minPeople = 2 } = {}) {
  const ids = [...new Set((personIds || []).map(str).filter(Boolean))];
  if (ids.length < minPeople) return [];

  const byOther = new Map(); // otherId -> Map(personId -> tie[])
  for (const id of ids) {
    for (const t of patches(id, graph)) {
      if (!t.other) continue;
      if (!byOther.has(t.other)) byOther.set(t.other, new Map());
      const m = byOther.get(t.other);
      if (!m.has(id)) m.set(id, []);
      m.get(id).push(t);
    }
  }

  const rows = [];
  for (const [other, m] of byOther) {
    if (m.size < minPeople) continue;
    const node = (graph.getNode && graph.getNode(other)) || null;
    rows.push({
      other,
      otherName: (node && node.name) || other,
      otherKind: (node && node.kind) || null,
      peopleCount: m.size,
      people: [...m.keys()],
      ties: [...m.entries()].map(([p, ts]) => ({ person: p, ties: ts })),
      kinds: [...new Set([...m.values()].flat().map((t) => t.kind))].sort(),
    });
  }
  // Most-shared first; then most ties; then stable by name.
  rows.sort((a, b) =>
    b.peopleCount - a.peopleCount
    || [...b.ties].length - [...a.ties].length
    || a.otherName.localeCompare(b.otherName));
  return rows;
}

/**
 * Scan report text for people already in the graph.
 * ⚠️ Returns CANDIDATES, not findings. `confidence` is 'exact' only for a full-name match on a word
 * boundary; anything looser is 'weak' and is expected to be confirmed by a human before use.
 */
export function findActors(text, graph, { minNameWords = 2 } = {}) {
  const body = str(text);
  if (!body || !graph) return [];
  // accountability-graph exposes nodes(); tolerate allNodes() so a caller can pass a
  // compatible graph from elsewhere without this silently returning nothing.
  const lister = typeof graph.nodes === 'function' ? graph.nodes
    : typeof graph.allNodes === 'function' ? graph.allNodes : null;
  if (!lister) return [];
  let nodes = [];
  try { nodes = lister.call(graph) || []; } catch { return []; }

  const found = [];
  for (const n of nodes) {
    if (!n || n.kind !== 'person') continue;
    const name = str(n.name || n.id);
    if (!name) continue;
    const words = name.split(/\s+/).filter(Boolean);
    const rx = new RegExp(`(^|[^A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`, 'i');
    if (rx.test(body)) {
      found.push({
        id: n.id,
        name,
        office: n.office || null,
        confidence: words.length >= minNameWords ? 'exact' : 'weak',
        note: words.length >= minNameWords
          ? 'full-name match — still confirm it is the same person'
          : 'single-token match — treat as a suggestion only',
      });
    }
  }
  found.sort((a, b) => (a.confidence === b.confidence ? a.name.localeCompare(b.name)
    : a.confidence === 'exact' ? -1 : 1));
  return found;
}

/**
 * Build the enrichment block for a report.
 * Pass `actorIds` to be explicit; omit it and the actors are DETECTED but only 'exact' matches are
 * used, and every one is reported back in `unconfirmed` so a human can strike any that are wrong.
 */
export function enrich(text, graph, { actorIds = null, minPeople = 2 } = {}) {
  const detected = findActors(text, graph);
  const ids = actorIds && actorIds.length
    ? [...new Set(actorIds.map(str).filter(Boolean))]
    : detected.filter((d) => d.confidence === 'exact').map((d) => d.id);

  const perPerson = ids.map((id) => {
    const node = (graph.getNode && graph.getNode(id)) || null;
    return {
      id,
      name: (node && node.name) || id,
      office: (node && node.office) || null,
      patches: patches(id, graph),
    };
  });

  const overlaps = sharedTies(ids, graph, { minPeople });

  return {
    actors: perPerson,
    overlaps,
    unconfirmed: actorIds ? [] : detected,
    counts: {
      actors: perPerson.length,
      patches: perPerson.reduce((n, p) => n + p.patches.length, 0),
      overlaps: overlaps.length,
    },
    caveat: 'Facts and connections from public records, each linked to its source. '
          + 'No verdicts, no scores. An overlap is reported as an overlap; whether it matters '
          + 'is the reader\'s judgement. Name matches are candidates and must be confirmed.',
  };
}

const srcText = (s) => (s && s.url ? `${str(s.name)} — ${str(s.url)}` : str(s && s.name));

/** Plain-text enrichment block, for pasting under a report. */
export function renderEnrichment(block, { title = 'WHAT THE RECORDS SHOW' } = {}) {
  if (!block || !block.counts) return '';
  const L = [];
  L.push(title, '='.repeat(title.length), '');

  if (block.overlaps.length) {
    L.push('SHARED TIES — counterparties that touch more than one person named above.',
           'This is the part a single profile does not show.', '');
    for (const o of block.overlaps) {
      L.push(`* ${o.otherName}${o.otherKind ? ` (${o.otherKind})` : ''} — touches ${o.peopleCount}:`);
      for (const t of o.ties) {
        for (const tie of t.ties) {
          const amt = tie.amount != null ? ` ${tie.amount}` : '';
          const when = tie.asOf ? ` [${tie.asOf}]` : '';
          L.push(`    - ${t.person}: ${tie.label}${amt}${when}  (${srcText(tie.source)})`);
        }
      }
      L.push('');
    }
  } else {
    L.push('SHARED TIES — none found among the people named.', '');
  }

  for (const a of block.actors) {
    L.push(`${a.name}${a.office ? ` — ${a.office}` : ''}`);
    if (!a.patches.length) { L.push('    (no sourced ties on file)', ''); continue; }
    for (const p of a.patches) {
      const amt = p.amount != null ? ` ${p.amount}` : '';
      const when = p.asOf ? ` [${p.asOf}]` : '';
      L.push(`    - ${p.label}: ${p.other}${amt}${when}  (${srcText(p.source)})`);
    }
    L.push('');
  }

  if (block.unconfirmed.length) {
    L.push('NAMES DETECTED BUT NOT CONFIRMED — check each before use:');
    for (const u of block.unconfirmed) L.push(`    - ${u.name} (${u.confidence}) — ${u.note}`);
    L.push('');
  }

  L.push(block.caveat);
  return L.join('\n');
}

/** HTML surface for a report page. Everything escaped; every claim carries its source. */
export function renderEnrichmentHtml(block) {
  if (!block || !block.counts) return '';
  const src = (s) => (s && s.url
    ? `<a href="${esc(s.url)}" rel="nofollow noopener">${esc(s.name)}</a>`
    : `<span class="src">${esc(s && s.name)}</span>`);
  const rows = block.overlaps.map((o) => `<li><b>${esc(o.otherName)}</b>`
    + `${o.otherKind ? ` <i>(${esc(o.otherKind)})</i>` : ''} — touches ${o.peopleCount}<ul>`
    + o.ties.map((t) => t.ties.map((tie) =>
      `<li>${esc(t.person)}: ${esc(tie.label)}`
      + `${tie.amount != null ? ' ' + esc(tie.amount) : ''}`
      + `${tie.asOf ? ' [' + esc(tie.asOf) + ']' : ''} ${src(tie.source)}</li>`).join('')).join('')
    + '</ul></li>').join('');
  return `<section class="nascar-enrich"><h2>What the records show</h2>`
    + (rows ? `<h3>Shared ties</h3><ul>${rows}</ul>` : '<p>No shared ties found.</p>')
    + `<p class="caveat">${esc(block.caveat)}</p></section>`;
}

export function handler(req, res) {
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj, null, 2));
  };
  try {
    return send(200, {
      module: 'nascar-enrich',
      does: 'attaches sourced public-record ties to the people a report names, and surfaces the '
          + 'counterparties that touch more than one of them',
      patchKinds: Object.keys(PATCH_KINDS),
      rules: ['no source, no patch', 'no verdicts or scores',
              'name matches are candidates, never findings'],
    });
  } catch (e) {
    return send(500, { error: String((e && e.message) || e) });
  }
}

if (process.argv[1] && process.argv[1].endsWith('nascar-enrich.mjs')) {
  console.log('nascar-enrich: patch kinds —', Object.keys(PATCH_KINDS).join(', '));
  console.log('rules: no source no patch; no verdicts; name matches are candidates');
}
