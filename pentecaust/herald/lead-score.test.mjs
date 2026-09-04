// pentecaust/herald/lead-score.test.mjs — offline node --test for the Herald lead-scoring engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreLead, scoreLeads, renderScore, handler, WEIGHTS, esc } from './lead-score.mjs';

const HOT_LEAD = {
  icp: { titles: ['ceo', 'founder'], industries: ['saas'], keywords: ['api', 'developer', 'devtools'], companySize: [10, 500] },
  lead: { title: 'Founder & CEO', industry: 'SaaS', keywords: ['developer', 'api', 'devtools'], companySize: 40 },
  signals: { funding: true, siteVisits: 3, demoRequest: true },
  engagement: { opens: 4, clicks: 2, replies: 1 },
};

test('perfect-fit hot lead scores high and tiers hot', () => {
  const r = scoreLead(HOT_LEAD);
  assert.equal(r.ok, true);
  assert.equal(r.tier, 'hot');
  assert.ok(r.score >= 70, `expected >=70, got ${r.score}`);
  assert.ok(r.score <= 100);
});

test('score is deterministic — same input, same output', () => {
  assert.equal(scoreLead(HOT_LEAD).score, scoreLead(HOT_LEAD).score);
});

test('empty input scores 0 and tiers cold, never throws', () => {
  const r = scoreLead({});
  assert.equal(r.score, 0);
  assert.equal(r.tier, 'cold');
  assert.equal(r.ok, true);
  assert.ok(r.breakdown.notes.length > 0);
});

test('completely undefined/garbage input soft-fails to 0', () => {
  assert.equal(scoreLead(undefined).score, 0);
  assert.equal(scoreLead(null).score, 0);
  assert.equal(scoreLead('nonsense').score, 0);
  assert.equal(scoreLead(42).score, 0);
});

test('ICP fit alone (no intent, no engagement) lands in cold/warm band', () => {
  const r = scoreLead({ icp: HOT_LEAD.icp, lead: HOT_LEAD.lead });
  // full ICP = 45 max → warm at most, never hot
  assert.notEqual(r.tier, 'hot');
  assert.ok(r.breakdown.icp.subtotal > 0);
  assert.equal(r.breakdown.intent.subtotal, 0);
  assert.equal(r.breakdown.engagement.subtotal, 0);
});

test('title mismatch removes title points', () => {
  const good = scoreLead({ icp: HOT_LEAD.icp, lead: HOT_LEAD.lead });
  const bad = scoreLead({ icp: HOT_LEAD.icp, lead: { ...HOT_LEAD.lead, title: 'Intern' } });
  assert.ok(good.breakdown.icp.title > bad.breakdown.icp.title);
  assert.equal(bad.breakdown.icp.title, 0);
});

test('company size band is enforced', () => {
  const inBand = scoreLead({ icp: HOT_LEAD.icp, lead: { ...HOT_LEAD.lead, companySize: 40 } });
  const outBand = scoreLead({ icp: HOT_LEAD.icp, lead: { ...HOT_LEAD.lead, companySize: 5000 } });
  assert.ok(inBand.breakdown.icp.size > 0);
  assert.equal(outBand.breakdown.icp.size, 0);
});

test('keyword overlap is proportional', () => {
  const full = scoreLead({ icp: { keywords: ['api', 'developer', 'devtools'] }, lead: { keywords: ['api', 'developer', 'devtools'] } });
  const partial = scoreLead({ icp: { keywords: ['api', 'developer', 'devtools'] }, lead: { keywords: ['api'] } });
  assert.ok(full.breakdown.icp.keywords > partial.breakdown.icp.keywords);
  assert.ok(partial.breakdown.icp.keywords > 0);
});

test('intent axis caps at its weight', () => {
  const r = scoreLead({ signals: { funding: true, jobChange: true, demoRequest: true, pricingView: true, competitorResearch: true, siteVisits: 20 } });
  assert.equal(r.breakdown.intent.subtotal, WEIGHTS.intent);
});

test('demoRequest is a strong single intent signal', () => {
  const r = scoreLead({ signals: { demoRequest: true } });
  assert.ok(r.breakdown.intent.subtotal >= 12);
});

test('engagement axis caps at its weight; meetings dominate', () => {
  const r = scoreLead({ engagement: { opens: 99, clicks: 99, replies: 99, meetings: 99 } });
  assert.equal(r.breakdown.engagement.subtotal, WEIGHTS.engagement);
  const meetOnly = scoreLead({ engagement: { meetings: 2 } });
  const openOnly = scoreLead({ engagement: { opens: 2 } });
  assert.ok(meetOnly.breakdown.engagement.subtotal > openOnly.breakdown.engagement.subtotal);
});

test('negative / non-numeric engagement counts are treated as 0', () => {
  const r = scoreLead({ engagement: { opens: -5, clicks: 'x', replies: null } });
  assert.equal(r.breakdown.engagement.subtotal, 0);
});

test('string boolean signals ("yes"/"true") are honored', () => {
  const r = scoreLead({ signals: { funding: 'yes', demoRequest: 'true' } });
  assert.ok(r.breakdown.intent.subtotal > 0);
});

test('weights sum to 100 and score never exceeds 100', () => {
  assert.equal(WEIGHTS.icp + WEIGHTS.intent + WEIGHTS.engagement, 100);
  const maxed = scoreLead({
    icp: HOT_LEAD.icp, lead: HOT_LEAD.lead,
    signals: { funding: true, jobChange: true, demoRequest: true, pricingView: true, competitorResearch: true, siteVisits: 20 },
    engagement: { opens: 99, clicks: 99, replies: 99, meetings: 99 },
  });
  assert.equal(maxed.score, 100);
});

test('multi-word ICP title matches when all tokens present', () => {
  const r = scoreLead({ icp: { titles: ['vp sales'] }, lead: { title: 'Senior VP of Sales' } });
  assert.ok(r.breakdown.icp.title > 0);
});

test('scoreLeads ranks hottest-first and is stable on ties', () => {
  const ranked = scoreLeads([
    { id: 'cold', lead: {} },
    HOT_LEAD,
    { id: 'warm', signals: { demoRequest: true, funding: true }, engagement: { replies: 1 } },
  ]);
  assert.equal(ranked.length, 3);
  assert.ok(ranked[0].score >= ranked[1].score);
  assert.ok(ranked[1].score >= ranked[2].score);
});

test('scoreLeads handles empty and non-array input', () => {
  assert.deepEqual(scoreLeads([]), []);
  assert.equal(scoreLeads(null).length, 0);
  assert.equal(scoreLeads('x').length, 0);
});

test('renderScore output is HTML-escaped', () => {
  const r = scoreLead({ lead: { title: '<script>x</script>' }, icp: { titles: ['<script>x</script>'] } });
  const html = renderScore(r);
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes('&lt;script&gt;') || !/<script>/.test(html));
});

test('esc escapes the five entities', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

// ---- handler tests (mock req/res, no network) ----
function mockReq({ method = 'POST', body = '', accept = 'application/json' } = {}) {
  const chunks = body ? [Buffer.from(body)] : [];
  return {
    method,
    headers: { accept },
    async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; },
  };
}
function mockRes() {
  return {
    statusCode: 0, headers: null, body: '',
    writeHead(code, h) { this.statusCode = code; this.headers = h; },
    end(s) { this.body = s || ''; },
  };
}

test('handler POST returns JSON score', async () => {
  const res = mockRes();
  await handler(mockReq({ body: JSON.stringify(HOT_LEAD) }), res);
  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tier, 'hot');
});

test('handler rejects non-POST with 405', async () => {
  const res = mockRes();
  await handler(mockReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
});

test('handler rejects invalid JSON with 400', async () => {
  const res = mockRes();
  await handler(mockReq({ body: '{not json' }), res);
  assert.equal(res.statusCode, 400);
});

test('handler serves HTML when Accept: text/html', async () => {
  const res = mockRes();
  await handler(mockReq({ body: JSON.stringify(HOT_LEAD), accept: 'text/html' }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(/text\/html/.test(res.headers['content-type']));
  assert.ok(res.body.includes('Lead score'));
});

test('handler with empty body scores a cold lead (never throws)', async () => {
  const res = mockRes();
  await handler(mockReq({ body: '' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).tier, 'cold');
});
