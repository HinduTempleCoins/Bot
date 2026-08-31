// pentecaust/herald/launch-campaign.mjs — the OPERATOR LAUNCHER: turns Herald from built-and-idle into a
// running, revenue-shaped campaign. Where seed-operator.mjs populates the CRM/planner shells, THIS wires the
// two revenue paths end-to-end and reports, per path, exactly what is LIVE now vs. the single env flip that
// turns money on. Idempotent (re-running overwrites by id/code). No keys, no network at build time, offline.
//
//   node pentecaust/herald/launch-campaign.mjs
//
// ── Path B — Crypto Ad Network (revenue on the NEXT click; the highest-leverage flip) ────────────────────
//   Registers the flagship crypto affiliate offers onto the shipped /go/{code} click rail via
//   ad-network.firstDollarCampaign(). Each offer's destination is tagged with our env-named affiliate id
//   (integrations/affiliate.mjs → trackedLink). While the id env is UNSET the link is a plain, honest,
//   FTC-disclosed link (tracked:false) — it serves and routes, it just earns $0. The moment the operator
//   drops the Impact publisher id into one env var, every click on our live pages pays a commission. That
//   is the one flip. Ranking is never bought — these are segregated, labeled, sponsored units.
//
// ── Path A — Opt-in email nurture (the compounding funnel; sends gated on ESP key + REAL opt-ins) ─────────
//   Stages the owned campaign sender: an opt-in list, a 3-step welcome/nurture sequence ("Your Voice Is
//   Worth Something"), a drip journey, and a broadcast campaign. NO subscribers are fabricated — real
//   opt-ins arrive via /api/subscribe (public form) and the chat lead-capture bridge. Sending stays a soft
//   no-op until (a) a Resend/Postmark key is set AND (b) a real double-opted-in list exists. Email only.
//
// Persists to data/herald-adnetwork.json, data/qr-scans.json (the /go rail), data/herald-sender.json.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdNetwork } from './ad-network.mjs';
import { createCampaignSender } from './campaign-sender.mjs';
import { NETWORKS, networkConfigured } from '../../integrations/affiliate.mjs';

const DATA = join(process.cwd(), 'data');
const AD_FILE = join(DATA, 'herald-adnetwork.json');
const loadJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const saveJson = (p, o) => { try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2)); } catch { /* soft */ } };

// ── Path B inventory: the flagship crypto affiliate offers, all on the Impact network ────────────────────
// targetUrl is the PUBLIC offer page (safe to hardcode); only the tracking param is env-gated. publisherId
// is the surface we serve the unit on (our own melek.salon). clarity/relevance feed honest ranking signals.
export const OFFERS = [
  { code: 'coinbase', network: 'impact', targetUrl: 'https://www.coinbase.com/', publisherId: 'melek',
    headline: 'Start with Coinbase', body: 'Buy your first crypto on a trusted US exchange.', bidCpc: 0.40, clarity: 5, relevance: 4, label: 'Coinbase — buy crypto' },
  { code: 'ledger', network: 'impact', targetUrl: 'https://shop.ledger.com/', publisherId: 'melek',
    headline: 'Secure it on a Ledger', body: 'Self-custody hardware wallet — hold your own keys.', bidCpc: 0.35, clarity: 5, relevance: 4, label: 'Ledger — hardware wallet' },
  { code: 'koinly', network: 'impact', targetUrl: 'https://koinly.io/', publisherId: 'melek',
    headline: 'Crypto taxes, sorted', body: 'Import your wallets, get a compliant tax report.', bidCpc: 0.30, clarity: 5, relevance: 4, label: 'Koinly — crypto taxes' },
  { code: 'kraken', network: 'impact', targetUrl: 'https://www.kraken.com/', publisherId: 'melek',
    headline: 'Trade on Kraken', body: 'Spot + staking on a veteran exchange.', bidCpc: 0.35, clarity: 5, relevance: 4, label: 'Kraken — trade + stake' },
];

// ── Path A content: the opt-in welcome/nurture sequence (real copy) ──────────────────────────────────────
export const LIST = { id: 'melek-launch', name: 'MELEK Launch — opt-in' };

// Honest, plain copy. {{name}} is interpolated per-subscriber; the CAN-SPAM unsubscribe footer + a
// List-Unsubscribe header are appended by the sender at render time — do not add one here.
export const TEMPLATES = [
  { id: 'melek-welcome', name: 'Welcome — Your Voice Is Worth Something',
    subject: 'Your voice is worth something on MELEK',
    html: '<p>Hi {{name}},</p><p>Welcome to MELEK — a no-fee social blockchain where you earn tokens for the'
      + ' posts, comments and votes you already make. On MELEK, <b>your voice is worth something</b>.</p>'
      + '<p><a href="https://melek.salon/signup">Claim your free account</a> — it takes a minute, no card, no crypto to start.</p>'
      + '<p>— Hathor, the MELEK Witness</p>' },
  { id: 'melek-value', name: 'How earning works',
    subject: 'How posting on MELEK actually pays',
    html: '<p>Hi {{name}},</p><p>Two-minute version: you post, readers vote, and the chain pays authors and'
      + ' curators from a daily reward pool. No middleman takes a cut. The more real your contribution, the'
      + ' more it earns.</p><p><a href="https://witness.melek.salon">See how the Witness School explains it</a>,'
      + ' or <a href="https://melek.salon/signup">start your account</a>.</p><p>— Hathor</p>' },
  { id: 'melek-cta', name: 'Claim + explore',
    subject: 'One step left — claim your MELEK account',
    html: '<p>Hi {{name}},</p><p>If you have been meaning to try it: <a href="https://melek.salon/signup">claim'
      + ' your MELEK account</a> and make your first post today. While you are here, the ecosystem also runs'
      + ' <a href="https://coupons.soapbox.community">live coupons</a> and <a href="https://travel.soapbox.community">travel deals</a>'
      + ' you can use right now.</p><p>Your voice is worth something.</p><p>— Hathor</p>' },
];

// Subject A/B variants for step 0 (send-optimizer UCB bandit picks the winner over time).
const WELCOME_VARIANTS = ['Your voice is worth something on MELEK', 'Welcome to MELEK — start earning for your posts'];

export const JOURNEY = {
  id: 'melek-welcome-drip', name: 'MELEK welcome drip',
  steps: [
    { templateId: 'melek-welcome', delayMs: 0, subjectVariants: WELCOME_VARIANTS },
    { templateId: 'melek-value', delayMs: 2 * 86400000 },   // +2 days
    { templateId: 'melek-cta', delayMs: 5 * 86400000 },     // +5 days
  ],
};

export const CAMPAIGN = { id: 'melek-launch-welcome', name: 'MELEK Launch — welcome broadcast', listId: LIST.id, templateId: 'melek-welcome' };

/**
 * launch({ adStore, sender }) — pure core so tests drive it with in-memory stores. Returns a shaped report;
 * never throws. Prod (the CLI below) passes a disk-backed adStore + a disk-backed sender.
 */
export function launch({ adStore, sender } = {}) {
  const report = { adNetwork: { campaigns: [], live: 0, pendingFlip: 0, flip: null }, email: { list: null, templates: 0, journey: null, campaign: null, ready: false, flip: null } };

  // ── Path B — crypto ad network on the /go rail ──────────────────────────────────────────────────────
  const net = createAdNetwork({ storage: adStore });
  net.registerPublisher({ id: 'melek', name: 'MELEK', origins: ['https://melek.salon'], payout: 'token' });
  for (const o of OFFERS) {
    const r = net.firstDollarCampaign(o);
    const row = { code: o.code, ok: !!(r && r.ok), tracked: !!(r && r.tracked), landingUrl: r && r.campaign && r.campaign.landingUrl };
    if (row.ok && row.tracked) report.adNetwork.live++;
    else if (row.ok) report.adNetwork.pendingFlip++;
    report.adNetwork.campaigns.push(row);
  }
  // the single flip for Path B: the Impact publisher id env (canonical or AFFIL_* alias).
  const impact = NETWORKS.impact;
  report.adNetwork.flip = {
    configured: networkConfigured('impact'),
    env: impact.env, altEnv: impact.altEnv, signupUrl: impact.signupUrl,
    note: `Set ${impact.env} (or ${impact.altEnv}) to the Impact publisher id → all ${OFFERS.length} crypto ads serve TRACKED links and earn per click.`,
  };

  // ── Path A — opt-in email nurture (staged; no fabricated subscribers) ────────────────────────────────
  const cs = sender;
  if (!cs || typeof cs.createList !== 'function') {
    report.email.flip = { espConfigured: false, note: 'no campaign sender provided — Path A skipped' };
    return report;
  }
  const l = cs.createList(LIST.id, { id: LIST.id, name: LIST.name });
  report.email.list = l && l.ok ? LIST.id : null;
  for (const t of TEMPLATES) { const r = cs.upsertTemplate(t); if (r && r.ok) report.email.templates++; }
  const j = cs.defineJourney(JOURNEY);
  report.email.journey = j && j.ok ? JOURNEY.id : null;
  const c = cs.createCampaign(CAMPAIGN);
  report.email.campaign = c && c.ok ? CAMPAIGN.id : null;
  report.email.ready = !!(report.email.list && report.email.templates === TEMPLATES.length && report.email.journey && report.email.campaign);
  const espSet = !!(process.env.HERALD_RESEND_KEY || process.env.RESEND_API_KEY || process.env.HERALD_POSTMARK_TOKEN || process.env.POSTMARK_SERVER_TOKEN);
  report.email.flip = {
    espConfigured: espSet,
    note: 'Set a Resend key (HERALD_RESEND_KEY) + a verified From domain (HERALD_SENDER_FROM). Sends stay a soft no-op until then AND until real opt-ins exist — real opt-ins flow in via /api/subscribe and the chat lead-capture bridge. No list is fabricated.',
  };

  return report;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const adStore = loadJson(AD_FILE, {});
  const sender = createCampaignSender();   // disk-backed: persists to data/herald-sender.json
  const rep = launch({ adStore, sender });
  saveJson(AD_FILE, adStore);              // firstDollarCampaign also wrote the /go rail (data/qr-scans.json)

  const bar = '─'.repeat(72);
  console.log(bar);
  console.log('HERALD — LAUNCH CAMPAIGN');
  console.log(bar);
  console.log('\nPath B — Crypto Ad Network (revenue on the next click):');
  for (const c of rep.adNetwork.campaigns) {
    console.log(`  • /go/${c.code}  ${c.tracked ? 'LIVE (tracked)' : 'STAGED (plain link — earns $0 until flip)'}  → ${c.landingUrl || '?'}`);
  }
  console.log(`  live: ${rep.adNetwork.live} · staged-pending-flip: ${rep.adNetwork.pendingFlip}`);
  console.log(`  FLIP: ${rep.adNetwork.flip.configured ? 'DONE — Impact id is set' : rep.adNetwork.flip.note}`);
  if (!rep.adNetwork.flip.configured) console.log(`        apply for the id: ${rep.adNetwork.flip.signupUrl}`);

  console.log('\nPath A — Opt-in email nurture (compounding funnel):');
  console.log(`  list: ${rep.email.list || 'FAILED'} · templates: ${rep.email.templates}/${TEMPLATES.length} · journey: ${rep.email.journey || 'FAILED'} · campaign: ${rep.email.campaign || 'FAILED'}`);
  console.log(`  staged & ready: ${rep.email.ready ? 'YES' : 'NO'}`);
  console.log(`  FLIP: ${rep.email.flip.espConfigured ? 'ESP key detected' : rep.email.flip.note}`);
  console.log(`\n${bar}`);
  console.log('SINGLE HIGHEST-LEVERAGE FLIP → set the Impact publisher id env on the Herald host, reload the');
  console.log('service, and the 4 crypto ad units above serve tracked links + earn on the next click.');
  console.log(bar);
}
