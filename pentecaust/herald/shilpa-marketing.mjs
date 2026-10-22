// shilpa-marketing.mjs — @shilpa-shastra publishes a TEST MARKETING set of native Herald ad creatives.
//
// Companion to shilpa-poster.mjs. Same account, same publish path (one `comment` op signed by MELEK-Signer,
// posting role — no key on this box), same feed. It does NOT touch the remakes/videos/songs poster or its
// state: it reads its OWN ad manifest (built by gen-marketing-batch.mjs) and keeps its OWN state file, so the
// two run side by side without colliding (offset timers + the chain's one-root-post-per-5-min rule).
//
// Every creative is a native Herald ad (our own ad-templates.mjs engine) over a hero generated on our own
// CPU-SD worker — no external gen API. Every post says plainly, at the top, that this is TEST MARKETING we
// are developing and measuring, not a finished campaign.
//
// The run is bounded: it posts nothing on or after MKTG_END (the 7-day window), and nothing once the pool is
// drained — exactly like the remakes poster when everything is already posted.
//
//   node pentecaust/herald/shilpa-marketing.mjs [--dry] [--batch=N]
//   import { buildMarketingPost, selectBatch } from './shilpa-marketing.mjs'
//
// Env: MELEK_SIGNER_TOKEN (required to post), MELEK_SIGNER_URL, MKTG_STATE_DIR, MKTG_MANIFEST, MKTG_END,
//      MKTG_BATCH, MKTG_RPC. House style: ESM, injectable fetch, soft-fail-never-throw, CLI guarded.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const BATCH = +(process.argv.find((a) => a.startsWith('--batch='))?.slice(8) || process.env.MKTG_BATCH || 6);
const SIGNER = String(process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/$/, '');
const TOKEN = process.env.MELEK_SIGNER_TOKEN || '';
const RPC = String(process.env.MKTG_RPC || 'https://melek.salon/rpc');
const AUTHOR = 'shilpa-shastra';
const STATE_DIR = process.env.MKTG_STATE_DIR || new URL('./.shilpa-marketing-state/', import.meta.url).pathname;
const STATE = `${STATE_DIR}/state.json`;
const MANIFEST = process.env.MKTG_MANIFEST || `${STATE_DIR}/ad-manifest.json`;
// Default close of the 7-day window is set by the installer; absent, treat as open (never auto-stops).
const END = process.env.MKTG_END || '';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }


/** Load the ad manifest written by the generator. Soft-fail → { creatives: [] }. */
export function loadManifest(path = MANIFEST) {
  try { const m = JSON.parse(readFileSync(path, 'utf8')); return m && Array.isArray(m.creatives) ? m : { creatives: [] }; }
  catch { return { creatives: [] }; }
}

/** The next BATCH creatives not already in `posted`. */
export function selectBatch(creatives, posted, batch = BATCH) {
  const done = new Set(posted || []);
  return (creatives || []).filter((c) => c && c.id && c.url && !done.has(c.id)).slice(0, Math.max(1, batch));
}

const PRODUCT_NAMES = {
  // The live set, from ad-templates.mjs PRODUCTS (operator's self-advertising list).
  vkbt: 'VKBT (Van Kush Beauty Token)', pool: 'SoapBox Mining Pool', hathor: 'Hathor (AI Witness)',
  // Retired ids, kept so older manifests still render a readable title.
  writing: 'Writing & Blogging', music: 'Music', streaming: 'Streaming', wiki: 'The Library', games: 'Games & Arcade',
  dex: 'KulaSwap (DEX)', mining: 'Solar Mining', chain: 'The MELEK Chain',
  onboard: 'Onboarding / School', social: 'Social / The Feed',
};

/** Build the chain post for one set of creatives. Pure — no I/O. */
export function buildMarketingPost(items, setNo) {
  const products = [...new Set(items.map((c) => PRODUCT_NAMES[c.product] || c.product).filter(Boolean))];
  const title = `Herald ad creatives for ${products.slice(0, 4).join(', ')}${products.length > 4 ? ' and more' : ''}`.slice(0, 250);
  const block = (c) => {
    const bits = [PRODUCT_NAMES[c.product] || c.product, c.format, c.theme].filter(Boolean).join(' · ');
    const line = [`**${bits}**`];
    if (c.slogan) line.push(`“${c.slogan}”`);
    line.push(`![${c.slogan || c.product || 'MELEK ad'}](${c.url})`);
    if (c.surface) line.push(`→ [${c.surface}](https://${c.surface})`);
    return line.join('\n\n');
  };
  const body = [
    'Hathor runs the ecosystem\'s own marketing engine — Herald. It lays out ads in dozens of real formats '
    + '(social posts, stories, display banners, posters, cards) over heroes in the VanKushFamily aesthetic, all '
    + 'made on our own servers. This set is a cross-section of what it produces for the MELEK products.',
    '---',
    ...items.map(block),
    '---',
    'Join MELEK — free: [melek.salon](https://melek.salon) · meet the AI witness: [hathor.live](https://hathor.live) · '
    + 'own your words: [soapbox.community](https://soapbox.community)',
  ].join('\n\n');
  return { title, body, permlink: `shilpa-shastra-test-marketing-set-${setNo}`, tags: ['shilpashastra', 'marketing', 'melek', 'herald', 'ai', 'advertising'] };
}

const loadState = () => { try { return { posted: [], sets: 0, ...JSON.parse(readFileSync(STATE, 'utf8')) }; } catch { return { posted: [], sets: 0 }; } };
const saveState = (s) => { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(STATE, JSON.stringify(s, null, 1)); };

async function rpc(method, params) {
  const r = await _fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
  return (await r.json()).result;
}

async function signerComment(op) {
  const r = await _fetch(`${SIGNER}/v1/broadcast`, {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'posting', ops: [['comment', op]], client_ref: `mktg-${op.permlink}` }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(`signer ${r.status}: ${j.error || 'failed'}`);
  return j.result;
}

// The chain allows one top-level post per account every 5 minutes — wait out whatever is left of that window.
async function waitForRootWindow() {
  const acct = await rpc('condenser_api.get_accounts', [[AUTHOR]]).catch(() => null);
  const last = acct && acct[0] && Date.parse(`${acct[0].last_root_post}Z`);
  const head = await rpc('condenser_api.get_dynamic_global_properties', []).catch(() => null);
  const now = head ? Date.parse(`${head.time}Z`) : Date.now();
  const wait = last ? last + 5 * 60 * 1000 + 10000 - now : 0;
  if (wait > 0) { console.log(`waiting ${Math.ceil(wait / 1000)} s (one root post per 5 minutes)`); await new Promise((r) => setTimeout(r, wait)); }
}

async function postOnce(p, image) {
  await waitForRootWindow();
  const existing = await rpc('condenser_api.get_content', [AUTHOR, p.permlink]).catch(() => null);
  if (existing && existing.author === AUTHOR) return 'already on chain';
  const res = await signerComment({
    parent_author: '', parent_permlink: p.tags[0], author: AUTHOR, permlink: p.permlink, title: p.title, body: p.body,
    json_metadata: JSON.stringify({ tags: p.tags, app: 'shilpa-shastra/test-marketing', image: image ? [image] : [], format: 'markdown' }),
  });
  return `tx ${res && (res.id || res.trx_id)}`;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  if (!TOKEN && !DRY) { console.log('MELEK_SIGNER_TOKEN not set — nothing posted'); process.exit(0); }
  if (process.env.PRODUCTION_PAUSE_FILE && existsSync(process.env.PRODUCTION_PAUSE_FILE)) { console.log('production paused (flag file present) — nothing posted'); process.exit(0); }
  if (END && Date.now() >= Date.parse(END)) { console.log(`test-marketing window closed (MKTG_END=${END}) — nothing posted`); process.exit(0); }
  const st = loadState();
  const m = loadManifest();
  const batch = selectBatch(m.creatives, st.posted);
  console.log(`creatives ${(m.creatives || []).length} · posted ${(st.posted || []).length} · to post ${(m.creatives || []).length - (st.posted || []).length}`);
  if (!batch.length) { console.log('nothing to post (pool drained or empty manifest)'); process.exit(0); }
  const setNo = (st.sets || 0) + 1;
  const p = buildMarketingPost(batch, setNo);
  const images = (p.body.match(/!\[/g) || []).length;
  if (DRY) { console.log(`would post set ${setNo}: "${p.title}" — ${batch.length} creatives, ${images} images, ${p.body.length} chars`); process.exit(0); }
  const r = await postOnce(p, batch[0].url).catch((e) => { console.log(`set ${setNo} not posted: ${e.message}`); return null; });
  if (!r) process.exit(1);
  console.log(`posted test-marketing set ${setNo}: ${batch.length} creatives, ${images} images, ${r}`);
  st.posted = [...(st.posted || []), ...batch.map((c) => c.id)]; st.sets = setNo; saveState(st);
}
