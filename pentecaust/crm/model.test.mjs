// crm/model.test.mjs — OFFLINE. In-memory fs, deterministic clock. Covers campaign CRUD, ICP/sequence
// normalisation + caps, lead dedupe + pipeline, stats. Soft-fail-never-throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCampaign, getCampaign, campaignsForOwner, setICP, setSequence, setStatus,
  addLead, moveLead, leadStats, STAGES,
} from './model.mjs';

// In-memory fs so nothing hits disk.
function memFs() {
  const m = new Map();
  return { fs: { read: (p) => (m.has(p) ? m.get(p) : null), write: (p, s) => m.set(p, s) }, file: 'mem://crm.json' };
}
const O = (extra) => ({ ...memFs(), now: 1000, ...extra });

test('createCampaign: requires a valid MELEK owner; seeds defaults', () => {
  const o = memFs();
  assert.equal(createCampaign({ owner: '0xBad!', name: 'x' }, o).ok, false);
  const r = createCampaign({ owner: '@alice', name: 'Q3 outbound', goal: 'book demos' }, o);
  assert.equal(r.ok, true);
  assert.equal(r.campaign.owner, 'alice');
  assert.equal(r.campaign.status, 'draft');
  assert.deepEqual(r.campaign.sequence, []);
  assert.equal(r.campaign.leads.length, 0);
});

test('getCampaign + campaignsForOwner (newest first)', () => {
  const o = memFs();
  const a = createCampaign({ owner: 'bob', name: 'first' }, { ...o, now: 1 }).campaign;
  const b = createCampaign({ owner: 'bob', name: 'second' }, { ...o, now: 2 }).campaign;
  createCampaign({ owner: 'carol', name: 'other' }, { ...o, now: 3 });
  assert.equal(getCampaign(a.id, o).name, 'first');
  const mine = campaignsForOwner('bob', o);
  assert.equal(mine.length, 2);
  assert.equal(mine[0].id, b.id, 'newest first');
});

test('setICP normalises arrays + caps; setSequence caps steps + normalises channel/delay', () => {
  const o = memFs();
  const c = createCampaign({ owner: 'alice', name: 'c' }, o).campaign;
  setICP(c.id, { titles: ['CTO', 'VP Eng'], keywords: ['hiring'], size: 'Series A', junk: 'x' }, o);
  const got = getCampaign(c.id, o);
  assert.deepEqual(got.icp.titles, ['CTO', 'VP Eng']);
  assert.equal(got.icp.size, 'Series A');
  assert.equal(got.icp.junk, undefined, 'unknown fields dropped');

  const many = Array.from({ length: 20 }, (_, i) => ({ channel: 'weird', delayDays: -5, subject: 's' + i, body: 'b' }));
  setSequence(c.id, many, o);
  const seq = getCampaign(c.id, o).sequence;
  assert.equal(seq.length, 12, 'capped at MAX_STEPS');
  assert.equal(seq[0].channel, 'email', 'bad channel → email');
  assert.equal(seq[0].delayDays, 0, 'negative delay clamped');
});

test('addLead dedupes on email; moveLead validates stage; stats count by stage', () => {
  const o = memFs();
  const c = createCampaign({ owner: 'alice', name: 'c' }, o).campaign;
  assert.equal(addLead(c.id, { name: 'Jane Roe', company: 'Acme', email: 'JANE@acme.com', signal: 'hiring 3 engineers' }, o).ok, true);
  assert.equal(addLead(c.id, { name: 'Jane R', email: 'jane@acme.com' }, o).ok, false, 'duplicate email rejected (case-insensitive)');
  assert.equal(addLead(c.id, { name: 'No Email', company: 'B' }, o).ok, true, 'lead without email still added');

  const lead = getCampaign(c.id, o).leads[0];
  assert.equal(lead.stage, 'new');
  assert.equal(moveLead(c.id, lead.id, 'bogus', o).ok, false);
  assert.equal(moveLead(c.id, lead.id, 'replied', o).ok, true);
  const st = leadStats(c.id, o);
  assert.equal(st.total, 2);
  assert.equal(st.byStage.replied, 1);
  assert.equal(st.byStage.new, 1);
});

test('setStatus guards the value; STAGES/terminal present', () => {
  const o = memFs();
  const c = createCampaign({ owner: 'alice', name: 'c' }, o).campaign;
  assert.equal(setStatus(c.id, 'nope', o).ok, false);
  assert.equal(setStatus(c.id, 'active', o).ok, true);
  assert.equal(getCampaign(c.id, o).status, 'active');
  assert.ok(STAGES.includes('unsubscribed'), 'suppression stage exists');
});

test('operations on a missing campaign soft-fail (never throw)', () => {
  const o = memFs();
  assert.equal(getCampaign('ghost', o), null);
  assert.equal(setICP('ghost', {}, o).ok, false);
  assert.equal(addLead('ghost', { email: 'x@y.com' }, o).ok, false);
  assert.equal(leadStats('ghost', o), null);
});
