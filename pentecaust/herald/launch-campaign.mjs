// pentecaust/herald/launch-campaign.mjs — the OPERATOR LAUNCHER, redirected to its REAL job: user
// acquisition for OUR OWN sites. Herald's mission is to bring real people to MELEK / PRANA / KULA / SoapBox
// — social users, DeFi users, GPU miners — NOT to earn affiliate commissions off other brands (that was a
// misbuild). This launcher wires two channels end-to-end and reports, per channel, what is LIVE driving
// users now vs. the one operator flip that widens reach. Idempotent (re-run overwrites by id/code), offline.
//
//   node pentecaust/herald/launch-campaign.mjs
//
// ── Channel 1 — the /go traffic rail to our own sign-up funnels (LIVE the moment it runs on the host) ─────
//   Registers OUR OWN destinations as HOUSE campaigns on the shipped /go/{code} click rail via
//   ad-network.houseCampaign(). Each is our own site, verbatim — no affiliate network, no trackedLink, no
//   commission. The /go rail logs every click and 301-redirects with UTM attribution, so scanStats() counts
//   exactly how many visitors each campaign drove into signup / KulaSwap / the miner pool. These go LIVE with
//   no env flip: the instant the rail is served on our pages, every click is one user sent to our funnel.
//
// ── Channel 2 — opt-in email nurture to a MELEK signup (compounding; sends gated on ESP key + REAL opt-ins) ─
//   Stages the owned campaign sender: an opt-in list, a 3-step welcome/nurture sequence ("Your Voice Is
//   Worth Something"), a drip journey, and a broadcast campaign — all CTA'd to our own signup + KulaSwap +
//   the miner pool. NO subscribers are fabricated — real opt-ins arrive via /api/subscribe (public form) and
//   the chat lead-capture bridge. Sending stays a soft no-op until a Resend/Postmark key AND real
//   double-opted-in subscribers both exist. Email only.
//
// Persists to data/herald-adnetwork.json, data/qr-scans.json (the /go rail), data/herald-sender.json.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdNetwork } from './ad-network.mjs';
import { createCampaignSender } from './campaign-sender.mjs';

const DATA = join(process.cwd(), 'data');
const AD_FILE = join(DATA, 'herald-adnetwork.json');
const loadJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const saveJson = (p, o) => { try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2)); } catch { /* soft */ } };

// ── Channel 1 inventory: OUR OWN destinations (the sites we are driving users to) ────────────────────────
// targetUrl is one of our live properties. Nothing here is env-gated — it is our own site, always live.
// clarity/relevance are honest quality signals used by the ad-server's organic ranking (never bid).
export const DESTINATIONS = [
  { code: 'join-melek', product: 'MELEK', targetUrl: 'https://wallet.melek.salon/signup', publisherId: 'melek',
    headline: 'Join MELEK — your voice is worth something',
    body: 'A no-fee social blockchain that pays you for the posts, comments and votes you already make. Free account, no card, no crypto to start.',
    cta: 'Claim your free account', clarity: 5, relevance: 5, label: 'Join MELEK (free account)' },
  { code: 'kula-defi', product: 'KULA', targetUrl: 'https://alpha.kula.money', publisherId: 'melek',
    headline: 'KulaSwap — real DeFi on PRANA',
    body: 'Swap tokens, provide liquidity, lock KULA to borrow MELEK, and farm real yield. Non-custodial — hold your own keys.',
    cta: 'Open KulaSwap', clarity: 5, relevance: 4, label: 'KulaSwap (DeFi)' },
  { code: 'prana-mine', product: 'PRANA', targetUrl: 'https://pool.soapbox.community', publisherId: 'melek',
    headline: 'Mine PRANA — turn your GPU into rewards',
    body: 'Point your GPU at the PRANA pool, or mine right in your browser. Useful-work security, real payouts, no minimum.',
    cta: 'Start mining', clarity: 5, relevance: 4, label: 'PRANA mining pool' },
  { code: 'soapbox', product: 'SoapBox', targetUrl: 'https://soapbox.community', publisherId: 'melek',
    headline: 'The SoapBox network',
    body: 'Social, DeFi, tools and content — one identity across MELEK, PRANA and KULA. Explore what the ecosystem does.',
    cta: 'Explore SoapBox', clarity: 4, relevance: 4, label: 'SoapBox network' },
];

// ── Channel 2 content: the opt-in welcome/nurture sequence (real copy, all CTAs to OUR sites) ─────────────
export const LIST = { id: 'melek-launch', name: 'MELEK Launch — opt-in' };

// Honest, plain copy. {{name}} is interpolated per-subscriber; the CAN-SPAM unsubscribe footer + a
// List-Unsubscribe header are appended by the sender at render time — do not add one here.
export const TEMPLATES = [
  { id: 'melek-welcome', name: 'Welcome — Your Voice Is Worth Something',
    subject: 'Your voice is worth something on MELEK',
    html: '<p>Hi {{name}},</p><p>Welcome to MELEK — a no-fee social blockchain where you earn tokens for the'
      + ' posts, comments and votes you already make. On MELEK, <b>your voice is worth something</b>.</p>'
      + '<p><a href="https://wallet.melek.salon/signup?utm_source=herald&utm_medium=email&utm_campaign=welcome">Claim your free account</a> — it takes a minute, no card, no crypto to start.</p>'
      + '<p>— Hathor, the MELEK Witness</p>' },
  { id: 'melek-value', name: 'How earning works',
    subject: 'How posting on MELEK actually pays',
    html: '<p>Hi {{name}},</p><p>Two-minute version: you post, readers vote, and the chain pays authors and'
      + ' curators from a daily reward pool. No middleman takes a cut. The more real your contribution, the'
      + ' more it earns.</p><p><a href="https://witness.melek.salon">See how the Witness School explains it</a>,'
      + ' or <a href="https://wallet.melek.salon/signup?utm_source=herald&utm_medium=email&utm_campaign=value">start your account</a>.</p><p>— Hathor</p>' },
  { id: 'melek-cta', name: 'Claim + explore the ecosystem',
    subject: 'One step left — claim your MELEK account',
    html: '<p>Hi {{name}},</p><p>If you have been meaning to try it: <a href="https://wallet.melek.salon/signup?utm_source=herald&utm_medium=email&utm_campaign=claim">claim'
      + ' your MELEK account</a> and make your first post today. The ecosystem also runs <a href="https://alpha.kula.money">KulaSwap DeFi</a>'
      + ' and a <a href="https://pool.soapbox.community">GPU/browser mining pool</a> you can join right now.</p>'
      + '<p>Your voice is worth something.</p><p>— Hathor</p>' },
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
  const report = { growth: { campaigns: [], live: 0 }, email: { list: null, templates: 0, journey: null, campaign: null, ready: false, flip: null } };

  // ── Channel 1 — house campaigns to OUR OWN sites on the /go rail (live now; no flip) ──────────────────
  const net = createAdNetwork({ storage: adStore });
  net.registerPublisher({ id: 'melek', name: 'MELEK', origins: ['https://melek.salon', 'https://soapbox.community'], payout: 'token' });
  for (const d of DESTINATIONS) {
    const r = net.houseCampaign(d);
    const row = { code: d.code, product: d.product, ok: !!(r && r.ok), live: !!(r && r.ok), landingUrl: r && r.campaign && r.campaign.landingUrl };
    if (row.live) report.growth.live++;
    report.growth.campaigns.push(row);
  }

  // ── Channel 2 — opt-in email nurture (staged; no fabricated subscribers) ──────────────────────────────
  const cs = sender;
  if (!cs || typeof cs.createList !== 'function') {
    report.email.flip = { espConfigured: false, note: 'no campaign sender provided — email channel skipped' };
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
    note: 'Set a Resend key (HERALD_RESEND_KEY) + a verified From domain (HERALD_SENDER_FROM). Sends stay a soft no-op until then AND until real double-opted-in subscribers exist — real opt-ins flow in via /api/subscribe and the chat lead-capture bridge. No list is fabricated.',
  };

  return report;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const adStore = loadJson(AD_FILE, {});
  const sender = createCampaignSender();   // disk-backed: persists to data/herald-sender.json
  const rep = launch({ adStore, sender });
  saveJson(AD_FILE, adStore);              // houseCampaign also wrote the /go rail (data/qr-scans.json)

  const bar = '─'.repeat(72);
  console.log(bar);
  console.log('HERALD — LAUNCH CAMPAIGN (user acquisition for OUR sites)');
  console.log(bar);
  console.log('\nChannel 1 — /go traffic rail to our own sign-up funnels (LIVE now):');
  for (const c of rep.growth.campaigns) {
    console.log(`  • /go/${c.code}  [${c.product}]  ${c.live ? 'LIVE — driving users' : 'FAILED'}  → ${c.landingUrl || '?'}`);
  }
  console.log(`  live campaigns: ${rep.growth.live}/${rep.growth.campaigns.length}`);

  console.log('\nChannel 2 — Opt-in email nurture (compounding funnel):');
  console.log(`  list: ${rep.email.list || 'FAILED'} · templates: ${rep.email.templates}/${TEMPLATES.length} · journey: ${rep.email.journey || 'FAILED'} · campaign: ${rep.email.campaign || 'FAILED'}`);
  console.log(`  staged & ready: ${rep.email.ready ? 'YES' : 'NO'}`);
  console.log(`  FLIP: ${rep.email.flip.espConfigured ? 'ESP key detected' : rep.email.flip.note}`);
  console.log(`\n${bar}`);
  console.log('The /go campaigns above drive real users to melek.salon signup, KulaSwap and the miner pool the');
  console.log('instant the rail is served on our pages. Watch the numbers on the Herald dashboard: /api/funnel.');
  console.log(bar);
}
