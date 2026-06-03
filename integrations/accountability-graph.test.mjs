// accountability-graph.test.mjs — OFFLINE tests for the power-map graph layer. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGraph, fromRecords, powerMap, renderProfile,
  NODE_KINDS, EDGE_KINDS, LICENSE_TAGS, licenseFor,
} from './accountability-graph.mjs';

test('addEdge REJECTS a source-less edge (source-required invariant)', () => {
  const g = createGraph();
  g.addNode({ kind: 'person', id: 'A', name: 'A' });
  g.addNode({ kind: 'committee', id: 'B', name: 'B' });
  // no source → rejected
  assert.equal(g.addEdge({ kind: 'donated-to', from: 'A', to: 'B', asOf: '2024-01-01' }), null);
  // source with no name → rejected
  assert.equal(g.addEdge({ kind: 'donated-to', from: 'A', to: 'B', asOf: '2024-01-01', source: { url: 'x' } }), null);
  // no asOf → rejected
  assert.equal(g.addEdge({ kind: 'donated-to', from: 'A', to: 'B', source: { name: 'OpenFEC' } }), null);
  // unknown kind → rejected
  assert.equal(g.addEdge({ kind: 'bribed', from: 'A', to: 'B', asOf: '2024-01-01', source: { name: 'OpenFEC' } }), null);
  // valid → accepted
  const ok = g.addEdge({ kind: 'donated-to', from: 'A', to: 'B', asOf: '2024-01-01', source: { name: 'OpenFEC', url: 'https://fec.gov/x' } });
  assert.ok(ok);
  assert.equal(ok.source.name, 'OpenFEC');
  assert.equal(g.edges().length, 1, 'only the valid edge persisted');
});

test('addNode strips a home_address (and any PII / verdict) field', () => {
  const g = createGraph();
  const n = g.addNode({
    kind: 'person', id: 'Sen. Smith', name: 'Sen. Smith', office: 'US Senate',
    home_address: '123 Private Ln', family: 'spouse + 2 kids', dob: '1960-01-01',
    score: 99, corrupt: true, rating: 'F',
  });
  assert.ok(n);
  assert.equal(n.name, 'Sen. Smith');
  assert.equal(n.office, 'US Senate');
  assert.equal(n.home_address, undefined, 'home_address stripped');
  assert.equal(n.family, undefined, 'family stripped');
  assert.equal(n.dob, undefined, 'dob stripped');
  assert.equal(n.score, undefined, 'no verdict score');
  assert.equal(n.corrupt, undefined, 'no verdict flag');
  assert.equal(n.rating, undefined, 'no rating');
  // structural: contestable slots exist, no judgement slots
  assert.deepEqual(n.disputes, []);
  assert.equal(n.reply, '');
});

test('addNode rejects an unknown node kind', () => {
  const g = createGraph();
  assert.equal(g.addNode({ kind: 'alien', id: 'X' }), null);
  assert.ok(NODE_KINDS.includes('person') && NODE_KINDS.includes('office'));
});

test('fromRecords builds nodes/edges from canned FEC + lobbying records', () => {
  const records = [
    { type: 'donation', contributor: 'Jane Donor', recipient: 'Smith PAC', amount: 2800, date: '2024-03-01', source: 'OpenFEC', url: 'https://fec.gov/a' },
    { type: 'lobbying', registrant: 'BigLobby LLC', client: 'AcmeCorp', target: 'Dept of Energy', issue: 'energy', date: '2024-02-01', source: 'Senate LDA', url: 'https://lda.senate.gov/b' },
    { garbage: true }, // skipped, not fabricated
  ];
  const { graph, added } = fromRecords(records);
  assert.equal(added.skipped, 1);
  assert.ok(added.nodes >= 4); // Jane, Smith PAC, BigLobby, Dept of Energy, AcmeCorp
  assert.ok(added.edges >= 2); // donated-to + lobbied (+ contracted-with for client)
  const fecEdge = graph.edges().find((e) => e.kind === 'donated-to');
  assert.equal(fecEdge.from, 'Jane Donor');
  assert.equal(fecEdge.to, 'Smith PAC');
  assert.equal(fecEdge.amount, 2800);
  assert.equal(fecEdge.source.name, 'OpenFEC');
  const lobbyEdge = graph.edges().find((e) => e.kind === 'lobbied');
  assert.equal(lobbyEdge.from, 'BigLobby LLC');
  assert.equal(lobbyEdge.to, 'Dept of Energy');
});

test('pathsBetween finds a 2-hop donor→committee→candidate path', () => {
  const records = [
    { type: 'donation', contributor: 'Jane Donor', recipient: 'Smith PAC', amount: 2800, date: '2024-03-01', source: 'OpenFEC', url: 'https://fec.gov/a' },
    { type: 'donation', contributor: 'Smith PAC', recipient: 'Sen. John Smith', amount: 5000, date: '2024-04-01', source: 'OpenFEC', url: 'https://fec.gov/b' },
  ];
  const { graph } = fromRecords(records);
  const paths = graph.pathsBetween('Jane Donor', 'Sen. John Smith', { maxHops: 3 });
  assert.ok(paths.length >= 1, 'a path exists');
  assert.equal(paths[0].length, 2, 'shortest is 2 hops');
  assert.equal(paths[0][0].kind, 'donated-to');
  assert.equal(paths[0][1].to, 'Sen. John Smith');
});

test('powerMap groups connections + every item carries a source', () => {
  const records = [
    { type: 'donation', contributor: 'Jane Donor', recipient: 'Smith PAC', amount: 2800, date: '2024-03-01', source: 'OpenFEC', url: 'https://fec.gov/a' },
    { type: 'donation', contributor: 'Smith PAC', recipient: 'Sen. John Smith', amount: 5000, date: '2024-04-01', source: 'OpenFEC', url: 'https://fec.gov/b' },
    { type: 'ruling', judge: 'Smith PAC', caseName: 'Acme v. State', court: 'ca9', dateFiled: '2023-09-01', source: 'CourtListener', url: 'https://cl.com/1' },
  ];
  const { graph } = fromRecords(records);
  const map = powerMap('Smith PAC', graph);
  // money in (received from Jane) and money out (gave to Sen. Smith)
  assert.ok(map.money.in.length >= 1, 'has money in');
  assert.ok(map.money.out.length >= 1, 'has money out');
  const allItems = [...map.money.in, ...map.money.out, ...map.orgs, ...map.rulings, ...map.appointments];
  assert.ok(allItems.length >= 2);
  for (const it of allItems) {
    assert.ok(it.source && it.source.name, 'every item has a source');
  }
  // structural: no verdict fields anywhere on the map
  assert.equal(JSON.stringify(map).includes('"score"'), false);
  assert.equal(JSON.stringify(map).includes('"corrupt"'), false);
  assert.ok('disputes' in map && 'reply' in map);
});

test('renderProfile escapes a malicious org name + has right-of-reply + no-verdicts line + NO corrupt/score', () => {
  const g = createGraph();
  g.addNode({ kind: 'person', id: 'P1', name: 'Honest Pol' });
  g.addNode({ kind: 'committee', id: '<img src=x onerror=alert(1)>Evil PAC', name: '<img src=x onerror=alert(1)>Evil PAC' });
  g.addEdge({ kind: 'donated-to', from: 'P1', to: '<img src=x onerror=alert(1)>Evil PAC', amount: 100, asOf: '2024-01-01', source: { name: 'OpenFEC', url: 'https://fec.gov/x' } });
  g.addDispute('P1', { label: 'records contested by subject', source: { name: 'ProPublica', url: 'https://pp.org/d' }, asOf: '2024-05-01' });
  g.setReply('P1', 'I dispute these characterizations.');

  const html = renderProfile(powerMap('P1', g));
  assert.equal(html.includes('<img src=x onerror=alert(1)>'), false, 'raw script-y org name not present');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'org name HTML-escaped');
  assert.ok(html.includes('Right of reply'), 'has right-of-reply block');
  assert.ok(html.includes('I dispute these characterizations.'), 'reply text rendered');
  assert.ok(html.includes('facts and connections from public records — we do not render verdicts'), 'no-verdicts line present');
  assert.equal(html.toLowerCase().includes('corrupt'), false, 'no "corrupt" string');
  assert.equal(html.toLowerCase().includes('score'), false, 'no "score" string');
  // every claim links its source
  assert.ok(html.includes('href="https://fec.gov/x"'), 'donation claim links to source');
});

test('license tags applied per source', () => {
  assert.equal(LICENSE_TAGS['OpenFEC'].license, 'public-domain');
  assert.equal(LICENSE_TAGS['OpenSecrets'].license, 'cc-attribution');
  assert.equal(LICENSE_TAGS['ProPublica'].license, 'cc-by-nc-nd-window');
  assert.equal(LICENSE_TAGS['ProPublica'].windowOnly, true);
  assert.equal(licenseFor('totally-unknown-source').license, 'cc-attribution', 'defensive default = attribution');

  const g = createGraph();
  g.addNode({ kind: 'person', id: 'A', name: 'A' });
  g.addNode({ kind: 'committee', id: 'B', name: 'B' });
  const e = g.addEdge({ kind: 'donated-to', from: 'A', to: 'B', asOf: '2024-01-01', source: { name: 'OpenSecrets', url: 'https://os.org' } });
  assert.equal(e.license.license, 'cc-attribution', 'edge tagged with its source license');
});

test('addEdge accepts every declared EDGE_KIND with a source', () => {
  const g = createGraph();
  for (const kind of EDGE_KINDS) {
    const r = g.addEdge({ kind, from: 'X', to: 'Y', asOf: '2024-01-01', source: { name: 'OpenFEC', url: 'u' } });
    assert.ok(r, `kind ${kind} accepted`);
  }
  assert.equal(g.edges().length, EDGE_KINDS.length);
});
