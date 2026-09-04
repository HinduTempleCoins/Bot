// site/shop/server.mjs — shop.soapbox.community — the SEED SHOP storefront.
//
// The us-vendor→player STOREFRONT over the already-built farm-items catalog
// (integrations/games/farm-items.mjs): browse Seeds / Tools / Compost+Fertilizer by category with
// prices + boosts/stats, a product page per item, and a "buy" action that BUILDS a signable purchase
// intent — the MELEK-Engine `shop.buy` custom_json op — for the buyer to sign in the condenser / MELEK
// Signer. This page NEVER holds a key: it renders the intent (required_auths = the buyer), and the
// buyer signs it client-side. The shop is a tuned CURRENCY SINK (roadmap NEXT): buying burns a slice.
//
// Prices + the item set come 100% from farm-items.mjs (shopCatalog / byCategory / priceForSeed) — no
// item is invented here. Currency is config (default Grain, the internal stable unit: 1000 Grain = 1
// KULA) via SHOP_CURRENCY. If a catalog entry ever lacks a valid price, priceFor() derives a
// deterministic fallback from its rarity/boost so a card always shows a number.
//
// House style: ESM, esc() every interpolation, soft-fail-never-throw, handler(req,res) exported,
// PORT/BASE_URL env, CLI guarded + scoped to site/shop/. Reuses crawlers/seo/impact-utt.
//
//   PORT=8202 BASE_URL=https://shop.soapbox.community node site/shop/server.mjs

import { createServer } from 'node:http';

import { shopCatalog, byCategory, itemForSymbol, priceForSeed } from '../../integrations/games/farm-items.mjs';
import { SIDECHAIN_ID } from '../../integrations/games/seed-mint.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags, siteGraph, jsonLdScript } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8202);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = 'MELEK Seed Shop';

// Config (no fiat — an in-game currency). Default Grain, the legible internal stable unit.
export const SHOP_CURRENCY = (process.env.SHOP_CURRENCY || 'GRAIN').toUpperCase();
// The vendor account the buy op pays into (the shop's inventory holder). Buyer signs the transfer.
export const SHOP_ACCOUNT = (process.env.SHOP_ACCOUNT || 'melek-shop').toLowerCase();
const SEEDS_SITE = process.env.SEEDS_SITE || 'https://seeds.soapbox.community';
const FARM_SITE = process.env.FARM_SITE || 'https://farm.soapbox.community';
const GROW_SITE = process.env.GROW_SITE || 'https://kush.soapbox.community';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

// ── category + currency helpers ────────────────────────────────────────────────────────────────────
// The catalog groups by singular keys: seed | tool | consumable. Accept friendly aliases in the URL.
export const CATEGORIES = [
  { key: 'seed', slug: 'seeds', label: 'Seeds', emoji: '🌱', blurb: 'Kush Farm strains — plant them to grow. Priced by scarcity.' },
  { key: 'tool', slug: 'tools', label: 'Tools', emoji: '🛠️', blurb: 'Durable NFTs that boost your grows — you keep the tool.' },
  { key: 'consumable', slug: 'boosts', label: 'Compost & Fertilizer', emoji: '🧪', blurb: 'One-shot boosts. The compost sink’s output, sold back as a boost — closing the loop.' },
];
const CAT_ALIASES = {
  seed: 'seed', seeds: 'seed',
  tool: 'tool', tools: 'tool',
  consumable: 'consumable', consumables: 'consumable', boost: 'consumable', boosts: 'consumable',
  compost: 'consumable', fertilizer: 'consumable',
};
export function normalizeCategory(c) { return CAT_ALIASES[String(c || '').toLowerCase().trim()] || null; }
function catMeta(key) { return CATEGORIES.find((c) => c.key === key) || null; }

// Deterministic price FALLBACK for any entry that somehow lacks a valid catalog price. The real prices
// live in farm-items.mjs (tools/consumables carry `price`; seeds via priceForSeed); this only fills a gap.
const RARITY_FLOOR = { common: '5', uncommon: '25', rare: '150', legendary: '1000' };
export function priceFor(item) {
  if (!item) return '0';
  const p = String(item.price ?? '');
  if (/^\d+(\.\d+)?$/.test(p) && Number(p) > 0) return p;         // catalog price — the normal path
  if (item.category === 'seed') { const s = priceForSeed(item); if (/^\d+(\.\d+)?$/.test(String(s))) return String(s); }
  const boostBump = item.boost && Number(item.boost.bps) > 0 ? Math.round(Number(item.boost.bps) / 20) : 0; // +5% of bps
  return String((Number(RARITY_FLOOR[item.rarity] || '5')) + boostBump); // rarity floor + a boost premium
}

// Human-readable boost line, e.g. { effect:'yield', bps:2500 } → "+25% harvest yield".
const EFFECT_LABEL = {
  growthSpeed: 'grow speed', yield: 'harvest yield', seasonExtend: 'out-of-season growing',
  seedReturn: 'seed return', producesFertilizer: 'fertilizer output',
};
export function boostLine(boost) {
  if (!boost) return '';
  const label = EFFECT_LABEL[boost.effect] || String(boost.effect || 'boost');
  const bps = Number(boost.bps) || 0;
  if (boost.effect === 'seasonExtend') return 'Enables out-of-season growing';
  if (bps <= 0) return `Affects ${label}`;
  return `+${bps / 100}% ${label}`;
}

// ── the signable BUY intent — a MELEK-Engine `shop.buy` custom_json op ───────────────────────────────
// Pure: builds + validates the op. NEVER signs, NEVER broadcasts, NEVER touches a key. required_auths is
// the BUYER's account (filled at sign time if the wallet isn't connected yet). The buyer signs in the
// condenser / MELEK Signer; the engine `shop` contract then charges `currency` and delivers the item.
const ACCOUNT_RE = /^[a-z][a-z0-9-]{2,15}(\.[a-z][a-z0-9-]+)*$/;
const isAccount = (a) => typeof a === 'string' && a.length >= 3 && a.length <= 32 && ACCOUNT_RE.test(a);
const isCount = (q) => /^\d+$/.test(String(q)) && BigInt(String(q)) > 0n;

export function findItem(idOrSymbol) {
  const want = String(idOrSymbol || '').trim();
  if (!want) return null;
  const cat = shopCatalog();
  return cat.find((i) => i.id === want)
    || cat.find((i) => String(i.symbol).toUpperCase() === want.toUpperCase())
    || itemForSymbol(want)
    || null;
}

export function buildBuyIntent({ id, account = '', qty = 1, currency = SHOP_CURRENCY } = {}) {
  const item = findItem(id);
  if (!item) return { ok: false, error: `unknown item "${id}"` };
  const quantity = String(qty == null || qty === '' ? 1 : qty);
  if (!isCount(quantity)) return { ok: false, error: `quantity must be a positive integer (got "${qty}")` };
  const buyer = String(account || '').replace(/^@/, '').toLowerCase();
  const haveBuyer = isAccount(buyer);
  const unit = priceFor(item);
  const total = String(Number(unit) * Number(quantity));
  const cur = String(currency || SHOP_CURRENCY).toUpperCase();
  const envelope = {
    contractName: 'shop', contractAction: 'buy',
    contractPayload: { symbol: item.symbol, quantity, currency: cur, price: unit, vendor: SHOP_ACCOUNT },
  };
  const op = ['custom_json', {
    required_auths: haveBuyer ? [buyer] : [],   // the BUYER signs; filled at sign time if not connected
    required_posting_auths: [],
    id: SIDECHAIN_ID,
    json: JSON.stringify(envelope),
  }];
  return {
    ok: true,
    item: { id: item.id, symbol: item.symbol, name: item.name, category: item.category, rarity: item.rarity },
    currency: cur, unitPrice: unit, quantity, total,
    account: haveBuyer ? buyer : null,
    needsAccount: !haveBuyer,
    sidechainId: SIDECHAIN_ID,
    envelope, op,
    signWith: 'active',   // engine ops use active auth; buyer signs in the condenser / MELEK Signer
    note: 'Sign this in your MELEK wallet (condenser / MELEK Signer). This page never holds your keys.',
    summary: `buy ${quantity} ${item.symbol} for ${total} ${cur}${haveBuyer ? ` as @${buyer}` : ''}`,
  };
}

// ── styling (shared dark theme, matching the Seeds/vertical house style) ─────────────────────────────
const STYLE = `<style>
 :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--blue:#4c8dff;--purp:#b98bff}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
 a{color:var(--gold);text-decoration:none}a:hover{text-decoration:underline}
 header.top{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--bd);padding:9px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
 .brand{font-size:20px;font-weight:800}.brand b{color:var(--green)}
 .alpha{font-size:10px;font-weight:700;color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 7px}
 .nav{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
 .nav a{color:var(--fg);font-weight:700;font-size:13px;border:1px solid var(--bd);border-radius:8px;padding:5px 11px}
 .nav a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
 .wrap{max-width:940px;margin:0 auto;padding:16px}
 h1{margin:2px 0 4px;font-size:24px}h2{font-size:18px;margin:20px 0 8px}
 .lead{color:var(--mut);font-size:14px;margin:0 0 12px}
 .cur{color:var(--gold);font-weight:700}
 .cats{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 6px}
 .cats a{border:1px solid var(--bd);border-radius:999px;padding:5px 12px;color:var(--fg);font-size:13px;font-weight:700}
 .cats a.on,.cats a:hover{border-color:var(--gold);color:var(--gold);text-decoration:none}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
 .item{display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--bd);border-radius:14px;overflow:hidden}
 .item:hover{border-color:var(--rc,var(--blue))}
 .art{position:relative;height:78px;display:flex;align-items:center;justify-content:center;font-size:34px;background:radial-gradient(120px 80px at 50% 20%,color-mix(in srgb,var(--rc,#4c8dff) 28%,transparent),transparent),#0e131b;border-bottom:1px solid var(--bd)}
 .art .kind{position:absolute;top:7px;right:7px;font-size:9px;font-weight:700;padding:2px 6px;border-radius:999px;background:#0b0d12cc;border:1px solid var(--bd);color:var(--mut)}
 .body{padding:11px 12px;display:flex;flex-direction:column;gap:6px;flex:1}
 .top{display:flex;align-items:center;gap:8px}.nm{font-size:15px;font-weight:700}
 .rar{margin-left:auto;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;border:1px solid;border-radius:999px;padding:2px 7px}
 .sym{color:var(--fg);font-weight:700;font-family:ui-monospace,Menlo,monospace;font-size:12px}
 .blurb{color:var(--mut);font-size:12px;flex:1}
 .chips{display:flex;flex-wrap:wrap;gap:5px}
 .tag{font-size:10px;color:var(--mut);border:1px solid var(--bd);border-radius:6px;padding:1px 5px}
 .tag.boost{color:var(--green);border-color:var(--green)}
 .price{display:flex;align-items:baseline;gap:6px;border-top:1px solid var(--bd);padding-top:8px;margin-top:2px}
 .price b{font-size:18px;font-variant-numeric:tabular-nums}.price .u{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.5px}
 .buy{font:inherit;font-weight:700;border:0;border-radius:10px;padding:8px 14px;cursor:pointer;background:var(--gold);color:#1a1306;text-align:center}
 .buy.ghost{background:#0e131b;color:var(--fg);border:1px solid var(--bd)}
 .card{background:var(--panel);border:1px solid var(--bd);border-radius:14px;padding:16px 18px;margin:14px 0}
 input{font:inherit;background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:10px;padding:8px 12px}
 pre{background:#0e131b;border:1px solid var(--bd);border-radius:10px;padding:12px;overflow:auto;font-size:12px;color:var(--fg)}
 .stat{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
 .mut{color:var(--mut)}.green{color:var(--green)}.gold{color:var(--gold)}
 footer{color:var(--mut);font-size:12px;text-align:center;margin:24px 0 10px;line-height:1.7}
</style>`;

const NAV = `<div class=nav><a href="/">Shop</a>${CATEGORIES.map((c) => `<a href="/c/${esc(c.slug)}">${esc(c.emoji)} ${esc(c.label)}</a>`).join('')}<a href="${esc(SEEDS_SITE)}">Seeds wallet</a></div>`;

const FOOTER = `<footer>
  The Seed Shop is an in-game storefront — prices are in <span class=cur>${esc(SHOP_CURRENCY)}</span>, an in-game currency, <b>never fiat</b>.
  Buying builds an op you sign in your own MELEK wallet; <b>this page never holds your keys</b>. The shop is a
  currency sink — a slice of every purchase is burned. Seeds mint through MELEK-Engine.
  <div style="margin-top:8px"><a href="/">Shop</a> · <a href="${esc(SEEDS_SITE)}">🌱 Seeds</a> · <a href="${esc(GROW_SITE)}">🌿 Kush Farm</a> · <a href="${esc(FARM_SITE)}">🌾 KULA Farm</a></div>
</footer>`;

const RARITY_COL = { common: '#93a1b3', uncommon: '#36c08a', rare: '#4c8dff', legendary: '#d9a441' };

function page(title, body, opts = {}) {
  const desc = opts.description || `The MELEK Seed Shop — buy Kush Farm seeds, grow-boosting tools, and compost/fertilizer with ${SHOP_CURRENCY}. In-game currency only; you sign every purchase in your own wallet.`;
  const canonical = opts.canonical || `${BASE_URL}/`;
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    site: { url: BASE_URL, name: SITE_NAME },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=top><span class=brand>🛒 <b>Seed Shop</b></span><span class=alpha>Alpha</span>${NAV}</header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// item card + product-page renderers ------------------------------------------------------------------
function chipsFor(item) {
  const chips = [];
  if (item.category === 'seed') {
    if (item.season && item.season !== 'year-round') chips.push(`<span class=tag>${esc(item.season)}</span>`);
    else chips.push('<span class=tag>year-round</span>');
    if (item.tierLabel) chips.push(`<span class=tag>${esc(item.tierLabel)}</span>`);
    if (item.multiHarvest > 1) chips.push(`<span class=tag>🍎 ×${esc(item.multiHarvest)}</span>`);
    if (item.volunteer) chips.push('<span class=tag>🌱 volunteer</span>');
    if (item.flower) chips.push('<span class=tag>🌷 flower</span>');
    if (item.festival) chips.push('<span class=tag>🍂 festival</span>');
  }
  const bl = boostLine(item.boost);
  if (bl) chips.push(`<span class="tag boost">${esc(bl)}</span>`);
  chips.push(`<span class=tag>${item.kind === 'nft' ? '🖼 NFT' : '🪙 Token'}</span>`);
  return chips;
}

function itemCard(item) {
  const col = RARITY_COL[item.rarity] || '#e9eef5';
  const emoji = item.category === 'seed' ? '🌱' : item.category === 'tool' ? '🛠️' : '🧪';
  const price = priceFor(item);
  return `<a class=item href="/item/${esc(item.id)}" style="--rc:${col}">
    <div class=art aria-hidden=true><span>${emoji}</span><span class=kind>${item.kind === 'nft' ? '🖼 NFT' : '🪙 Token'}</span></div>
    <div class=body>
      <div class=top><span class=nm>${esc(item.name)}</span><span class=rar style="color:${col};border-color:${col}">${esc(item.rarity)}</span></div>
      <div><span class=sym>${esc(item.symbol)}</span></div>
      ${item.blurb ? `<div class=blurb>${esc(item.blurb)}</div>` : '<div class=blurb></div>'}
      <div class=chips>${chipsFor(item).join(' ')}</div>
      <div class=price><b>${esc(price)}</b> <span class=u>${esc(SHOP_CURRENCY)}</span></div>
    </div>
  </a>`;
}

export function homePage() {
  const groups = byCategory();
  const sections = CATEGORIES.map((c) => {
    const items = groups[c.key] || [];
    if (!items.length) return '';
    return `<h2>${esc(c.emoji)} ${esc(c.label)} <span class="mut" style="font-size:13px;font-weight:400">· ${esc(c.blurb)}</span></h2>
      <div class=grid>${items.map(itemCard).join('')}</div>`;
  }).join('');
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'ItemList', name: `${SITE_NAME} catalog`,
    itemListElement: shopCatalog().map((i, n) => ({ '@type': 'ListItem', position: n + 1, name: i.name, url: `${BASE_URL}/item/${i.id}` })),
  };
  const body = `<h1>The Seed Shop</h1>
    <p class=lead>Buy Kush Farm <b>seeds</b>, grow-boosting <b>tools</b>, and <b>compost / fertilizer</b> — priced in
      <span class=cur>${esc(SHOP_CURRENCY)}</span> (an in-game currency, never fiat). Every purchase is an op <b>you</b> sign
      in your own MELEK wallet; the shop never holds your keys.</p>
    <div class=cats><a class=on href="/">All</a>${CATEGORIES.map((c) => `<a href="/c/${esc(c.slug)}">${esc(c.emoji)} ${esc(c.label)}</a>`).join('')}</div>
    ${sections}`;
  return page(`${SITE_NAME} — buy seeds, tools & compost`, body, { canonical: `${BASE_URL}/`, jsonld });
}

export function categoryPage(key) {
  const meta = catMeta(key);
  if (!meta) return null;
  const items = byCategory()[key] || [];
  const body = `<h1>${esc(meta.emoji)} ${esc(meta.label)}</h1>
    <p class=lead>${esc(meta.blurb)} Priced in <span class=cur>${esc(SHOP_CURRENCY)}</span>.</p>
    <div class=cats><a href="/">All</a>${CATEGORIES.map((c) => `<a class="${c.key === key ? 'on' : ''}" href="/c/${esc(c.slug)}">${esc(c.emoji)} ${esc(c.label)}</a>`).join('')}</div>
    ${items.length ? `<div class=grid>${items.map(itemCard).join('')}</div>` : '<p class=mut>Nothing stocked in this aisle yet.</p>'}`;
  return page(`${meta.label} — ${SITE_NAME}`, body, { canonical: `${BASE_URL}/c/${meta.slug}` });
}

export function itemPage(idOrSymbol) {
  const item = findItem(idOrSymbol);
  if (!item) return null;
  const col = RARITY_COL[item.rarity] || '#e9eef5';
  const price = priceFor(item);
  const emoji = item.category === 'seed' ? '🌱' : item.category === 'tool' ? '🛠️' : '🧪';
  const cmeta = catMeta(item.category);
  const bl = boostLine(item.boost);
  const stats = [];
  if (item.category === 'seed') {
    stats.push(['Season', item.season || 'year-round']);
    if (item.tierLabel) stats.push(['Grow tier', item.tierLabel]);
    if (item.multiHarvest > 1) stats.push(['Harvests', `×${item.multiHarvest}`]);
    if (item.volunteer) stats.push(['Volunteer', 'yes — self-reseeds']);
    if (item.flower) stats.push(['Flower', 'yes']);
    if (item.festival) stats.push(['Festival', 'yes']);
  }
  if (bl) stats.push(['Boost', bl]);
  stats.push(['Asset kind', item.kind === 'nft' ? 'NFT (durable / collectable)' : 'Token (fungible)']);
  stats.push(['Rarity', item.rarity]);
  const statRows = stats.map(([k, v]) => `<span class=tag><b>${esc(k)}</b>: ${esc(v)}</span>`).join(' ');
  const body = `<p class=lead><a href="/">Shop</a> › <a href="/c/${esc(cmeta ? cmeta.slug : item.category)}">${esc(cmeta ? cmeta.label : item.category)}</a> › ${esc(item.name)}</p>
    <div class=card style="--rc:${col}">
      <div class=top><span style="font-size:30px">${emoji}</span>
        <h1 style="margin:0">${esc(item.name)}</h1>
        <span class=rar style="color:${col};border-color:${col};margin-left:auto">${esc(item.rarity)}</span></div>
      <div style="margin:6px 0"><span class=sym>${esc(item.symbol)}</span> <span class=mut>· ${esc(cmeta ? cmeta.label : item.category)}</span></div>
      ${item.blurb ? `<p class=mut>${esc(item.blurb)}</p>` : ''}
      <div class=stat>${statRows}</div>
      <div class=price style="margin-top:6px"><b>${esc(price)}</b> <span class=u>${esc(SHOP_CURRENCY)}</span> <span class=mut style="font-size:12px">each</span></div>
    </div>
    <div class=card>
      <h2 style="margin-top:0">Buy</h2>
      <p class=mut style="font-size:13px">Enter your MELEK account and quantity, then <b>Build purchase</b>. We build the
        <code>shop.buy</code> op for you to sign in your wallet — <b>this page never holds your keys</b>, and nothing is
        broadcast for you.</p>
      <div class=stat>
        <input id=acct placeholder="your MELEK account" autocomplete=off spellcheck=false>
        <input id=qty type=number min=1 value=1 style="width:90px">
        <button class=buy id=build>Build purchase</button>
      </div>
      <div id=intent style="display:none">
        <p class=green id=isum></p>
        <pre id=iop></pre>
        <p class=mut style="font-size:12px">Copy this op into the MELEK Signer / condenser and sign it with your active key.</p>
      </div>
    </div>
    <script>
    (function(){
      var id=${JSON.stringify(item.id)};
      var b=document.getElementById('build');
      b.onclick=async function(){
        var acct=document.getElementById('acct').value.trim().replace(/^@/,'').toLowerCase();
        var qty=document.getElementById('qty').value.trim()||'1';
        try{
          var u='/api/buy?id='+encodeURIComponent(id)+'&qty='+encodeURIComponent(qty)+(acct?('&account='+encodeURIComponent(acct)):'');
          var d=await(await fetch(u,{cache:'no-store'})).json();
          var box=document.getElementById('intent');box.style.display='block';
          if(!d||!d.ok){document.getElementById('isum').textContent=(d&&d.error)||'Could not build the purchase.';document.getElementById('iop').textContent='';return;}
          document.getElementById('isum').textContent=d.summary+(d.needsAccount?' — connect / enter your account before signing.':'');
          document.getElementById('iop').textContent=JSON.stringify(d.op,null,2);
        }catch(e){document.getElementById('intent').style.display='block';document.getElementById('isum').textContent='Error building the purchase.';}
      };
    })();
    </script>`;
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Product',
    name: `${item.name} (${item.symbol})`, category: cmeta ? cmeta.label : item.category,
    url: `${BASE_URL}/item/${item.id}`, description: item.blurb || `${item.name} — a ${item.rarity} ${item.category} in the MELEK Seed Shop.`,
    offers: { '@type': 'Offer', price: Number(price), priceCurrency: SHOP_CURRENCY, availability: 'https://schema.org/InStock' },
  };
  return page(`${item.name} — ${SITE_NAME}`, body, { canonical: `${BASE_URL}/item/${item.id}`, description: item.blurb || `Buy ${item.name} (${item.symbol}) for ${price} ${SHOP_CURRENCY} in the MELEK Seed Shop.`, jsonld });
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', ...CATEGORIES.map((c) => `/c/${c.slug}`), ...shopCatalog().map((i) => `/item/${i.id}`)];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') return json(res, 200, { ok: true, items: shopCatalog().length, currency: SHOP_CURRENCY });

    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: u === '/' ? 'daily' : 'weekly', priority: u === '/' ? '1.0' : '0.7' }));
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
        name: SITE_NAME, baseUrl: BASE_URL,
        summary: `Buy Kush Farm seeds, grow-boosting tools, and compost/fertilizer with ${SHOP_CURRENCY} (in-game currency, no fiat). Every purchase is a MELEK-Engine shop.buy op the buyer signs in their own wallet — non-custodial.`,
        links: CATEGORIES.map((c) => ({ label: c.label, path: `/c/${c.slug}` })),
      }));
    }

    // JSON: the catalog + the signable buy intent (no keys, no broadcast)
    if (path === '/api/catalog') return json(res, 200, { ok: true, currency: SHOP_CURRENCY, items: shopCatalog() });
    if (path === '/api/buy') {
      const intent = buildBuyIntent({
        id: url.searchParams.get('id') || '',
        account: url.searchParams.get('account') || '',
        qty: url.searchParams.get('qty') || '1',
        currency: url.searchParams.get('currency') || SHOP_CURRENCY,
      });
      return json(res, intent.ok ? 200 : 404, intent);
    }

    if (path === '/') return sendHtml(res, homePage());

    if (path.startsWith('/c/')) {
      const key = normalizeCategory(path.slice(3));
      const html = key && categoryPage(key);
      if (!html) { res.writeHead(302, { location: '/' }); return res.end(); }
      return sendHtml(res, html);
    }

    if (path.startsWith('/item/')) {
      const html = itemPage(decodeURIComponent(path.slice(6)));
      if (!html) { res.writeHead(302, { location: '/' }); return res.end(); }
      return sendHtml(res, html);
    }
    // ?id= form of the product page
    if (path === '/item') {
      const html = itemPage(url.searchParams.get('id') || '');
      if (!html) { res.writeHead(302, { location: '/' }); return res.end(); }
      return sendHtml(res, html);
    }

    // unknown → home (soft 404)
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// expose for tests
export { siteGraph, jsonLdScript };

// Only bind the port when run directly (scoped to site/shop/), never when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/shop\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT}) — currency ${SHOP_CURRENCY}, ${shopCatalog().length} items`);
  });
}
