// pentecaust/herald/seed-operator.mjs — OPERATOR seeding: runs Herald from the admin side, populating the
// CRM (campaigns + ICPs with real audience/demographics), the growth-plan planner, and the ad-network
// (our sites as PUBLISHERS, crypto affiliate networks as ADVERTISERS) — the "Hub of Crypto Advertising."
// Idempotent-ish: re-running overwrites by id. Persists to data/crm.json + data/herald-adnetwork.json +
// data/herald-plans.json. No network, no keys, no customer UI — this is the operator running the machine.
//   Run:  node pentecaust/herald/seed-operator.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createCampaign, setICP, campaignsForOwner } from '../crm/model.mjs';
import { buildCampaign } from './campaign-planner.mjs';
import { createAdNetwork } from './ad-network.mjs';

const OWNER = 'hathor';                       // the MELEK witness account that owns the growth campaigns
const DATA = join(process.cwd(), 'data');
const CRM_FILE = join(DATA, 'crm.json');
const AD_FILE = join(DATA, 'herald-adnetwork.json');
const PLANS_FILE = join(DATA, 'herald-plans.json');
try { mkdirSync(DATA, { recursive: true }); } catch {}
const loadJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const saveJson = (p, o) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2)); };

// ── OUR PROPERTIES — each with the audience/demographics the operator specified ──────────────────────────
// icp uses the fixed CRM schema {titles, industries, keywords, geo, size, valueProp}; demographics ride
// keywords + valueProp (the schema is B2B-shaped, so audience/persona is encoded there).
const PROPERTIES = [
  { id: 'soapy-blog', name: 'Soapy.Blog', origin: 'https://soapy.blog', channels: ['blog', 'pinterest', 'instagram', 'email'],
    goal: 'Grow a primarily-female wellness/spirituality readership and monetize via affiliate + sponsored placements',
    icp: { industries: ['media', 'wellness', 'lifestyle'], geo: ['US'], size: 'consumer',
      keywords: ['women', 'female readers', 'wellness', 'spirituality', 'astrology', 'self-care', 'holistic health', 'plant medicine curious', 'ages 25-54'],
      valueProp: 'Lifestyle, wellness and spirituality content for a primarily female audience — the top-of-funnel that feeds coupons, travel and crypto onboarding.' } },
  { id: 'prana', name: 'PRANA', origin: 'https://prana.melek.salon', channels: ['blog', 'youtube', 'reddit', 'discord', 'x'],
    goal: 'Grow a gamer + AI-enthusiast audience for the compute-gated gaming chain and its arcade/mining',
    icp: { industries: ['gaming', 'ai', 'crypto', 'web3'], geo: ['US', 'global'], size: 'consumer + developer',
      keywords: ['gamers', 'AI enthusiasts', 'GPU miners', 'crypto gaming', 'web3 gaming', 'indie devs', 'machine learning hobbyists', 'RandomX/Etchash miners'],
      valueProp: 'A gaming + AI compute chain: play-to-earn arcade, GPU mining, and AI compute — built for gamers and AI enthusiasts.' } },
  { id: 'kulaswap', name: 'KulaSwap', origin: 'https://alpha.kula.money', channels: ['x', 'blog', 'discord', 'crypto-forums'],
    goal: 'Grow DeFi traders and liquidity providers for the KULA DEX/CDP/farms',
    icp: { industries: ['defi', 'crypto'], geo: ['global'], size: 'consumer',
      keywords: ['DeFi traders', 'yield farmers', 'liquidity providers', 'DEX users', 'CDP borrowers', 'crypto degens'],
      valueProp: 'DEX + CDP + farms on PRANA — swap, LP, and borrow against KULA.' } },
  { id: 'melek', name: 'MELEK', origin: 'https://melek.salon', channels: ['blog', 'x', 'crypto-forums', 'reddit'],
    goal: 'Onboard crypto-curious creators to the MELEK social chain (earn tokens for posting)',
    icp: { industries: ['crypto', 'social media', 'content'], geo: ['global'], size: 'consumer',
      keywords: ['crypto social', 'web3 creators', 'bloggers', 'content creators', 'token earners', 'Hive/Steem/Blurt users'],
      valueProp: 'Post and earn on a no-fee social blockchain — the MELEK front door.' } },
  { id: 'coupons', name: 'SoapBox Coupons', origin: 'https://coupons.soapbox.community', channels: ['blog', 'pinterest', 'facebook', 'email'],
    goal: 'Capture deal-seeking shoppers and monetize via Rakuten/affiliate CPA',
    icp: { industries: ['ecommerce', 'retail'], geo: ['US'], size: 'consumer',
      keywords: ['coupons', 'deals', 'promo codes', 'online shopping', 'savings', 'bargain hunters'],
      valueProp: 'Live coupons + deals across major retailers — affiliate-monetized savings.' } },
  { id: 'travel', name: 'SoapBox Travel', origin: 'https://travel.soapbox.community', channels: ['blog', 'pinterest', 'youtube'],
    goal: 'Capture trip-planning traffic and monetize via hotel/flight booking commissions',
    icp: { industries: ['travel', 'hospitality'], geo: ['US', 'global'], size: 'consumer',
      keywords: ['travelers', 'trip planning', 'cheap flights', 'hotel deals', 'digital nomads', 'vacation'],
      valueProp: 'Hotel + flight search with booking commissions and local-stats trip planning.' } },
  { id: 'finance', name: 'SoapBox Money (Credit / Insurance / Jobs)', origin: 'https://credit.soapbox.community', channels: ['blog', 'email'],
    goal: 'Capture high-CPA financial + career lead-gen (cards, loans, insurance, jobs)',
    icp: { industries: ['fintech', 'insurance', 'careers'], geo: ['US'], size: 'consumer',
      keywords: ['personal finance', 'credit cards', 'loans', 'insurance quotes', 'job seekers', 'credit score help'],
      valueProp: 'Credit, insurance and job tools — the highest-CPA affiliate/lead-gen verticals (Impact/CJ).' } },
];

// ── CRYPTO ADVERTISERS — the "Hub of Crypto Advertising" advertiser set (+ the generic affiliate networks) ──
const ADVERTISERS = [
  { id: 'coinbase', name: 'Coinbase', network: 'impact', contact: 'affiliates@coinbase.com', budgetUsd: 0 },
  { id: 'binance', name: 'Binance', network: 'binance-affiliate', contact: '', budgetUsd: 0 },
  { id: 'kraken', name: 'Kraken', network: 'impact', contact: '', budgetUsd: 0 },
  { id: 'bybit', name: 'Bybit', network: 'bybit-affiliate', contact: '', budgetUsd: 0 },
  { id: 'ledger', name: 'Ledger', network: 'impact', contact: '', budgetUsd: 0 },
  { id: 'kucoin', name: 'KuCoin', network: 'kucoin-affiliate', contact: '', budgetUsd: 0 },
  { id: 'koinly', name: 'Koinly (crypto tax)', network: 'impact', contact: '', budgetUsd: 0 },
  { id: 'nexo', name: 'Nexo', network: 'impact', contact: '', budgetUsd: 0 },
  { id: 'cryptocom', name: 'Crypto.com', network: 'cj', contact: '', budgetUsd: 0 },
  { id: 'impact', name: 'Impact.com network (cards/loans/insurance)', network: 'impact', contact: '', budgetUsd: 0 },
  { id: 'rakuten', name: 'Rakuten Advertising (coupons)', network: 'rakuten', contact: '', budgetUsd: 0 },
];

// a starter sponsored creative per crypto advertiser — labeled sponsored, honest ranking signals set neutral.
const CREATIVES = [
  { id: 'cr-coinbase', advertiserId: 'coinbase', code: 'coinbase', headline: 'Start with Coinbase', body: 'Buy your first crypto on a trusted US exchange.', clarity: 5, relevance: 4, bidCpc: 0.40 },
  { id: 'cr-ledger', advertiserId: 'ledger', code: 'ledger', headline: 'Secure it on a Ledger', body: 'Self-custody hardware wallet for your keys.', clarity: 5, relevance: 4, bidCpc: 0.35 },
  { id: 'cr-koinly', advertiserId: 'koinly', code: 'koinly', headline: 'Crypto taxes, sorted', body: 'Import your wallets, get a tax report.', clarity: 5, relevance: 4, bidCpc: 0.30 },
  { id: 'cr-kraken', advertiserId: 'kraken', code: 'kraken', headline: 'Trade on Kraken', body: 'Spot + staking on a veteran exchange.', clarity: 5, relevance: 4, bidCpc: 0.35 },
];

// ── RUN ──────────────────────────────────────────────────────────────────────────────────────────────────
const summary = { campaigns: [], plans: [], advertisers: 0, publishers: 0, creatives: 0 };

// 1) CRM campaigns + ICPs + growth plans, one per property.
const plans = loadJson(PLANS_FILE, {});
for (const p of PROPERTIES) {
  const r = createCampaign({ owner: OWNER, name: p.name, goal: p.goal, website: p.origin });
  if (!r.ok) { console.error('campaign failed', p.id, r.reason); continue; }
  setICP(r.campaign.id, p.icp);
  const plan = buildCampaign({ brand: p.name, goal: p.goal, channels: p.channels, weeks: 8 });
  plans[p.id] = { campaignId: r.campaign.id, brand: p.name, audience: p.icp.keywords, plan };
  summary.campaigns.push(`${p.name} (icp: ${p.icp.keywords.slice(0, 3).join(', ')}…)`);
  summary.plans.push(`${p.name}: ${plan.stages.length} stages`);
}
saveJson(PLANS_FILE, plans);

// 2) Ad-network — our sites as publishers, crypto networks as advertisers, starter creatives.
const adStore = loadJson(AD_FILE, {});
const net = createAdNetwork({ storage: adStore });
for (const a of ADVERTISERS) { if (net.registerAdvertiser(a).ok) summary.advertisers++; }
for (const p of PROPERTIES) {
  const r = net.registerPublisher({ id: p.id, name: p.name, origins: [p.origin], payout: 'token' });
  if (r.ok) summary.publishers++;
}
for (const c of CREATIVES) { if (net.registerCreative({ ...c, sponsored: true }).ok) summary.creatives++; }
saveJson(AD_FILE, adStore);

console.log('── Herald operator seed complete ──');
console.log('CRM campaigns + ICPs:', summary.campaigns.length, '→', CRM_FILE);
summary.campaigns.forEach((c) => console.log('  •', c));
console.log('Growth plans (8-week):', summary.plans.join(' | '), '→', PLANS_FILE);
console.log('Ad-network:', summary.advertisers, 'crypto advertisers,', summary.publishers, 'publishers,', summary.creatives, 'creatives →', AD_FILE);
console.log('Owner account:', OWNER, '| campaigns now owned:', (campaignsForOwner(OWNER).campaigns || campaignsForOwner(OWNER) || []).length);
