// server.mjs — Critter Keep (pets.soapbox.community). A NeoPets-pattern virtual-pet / creature-keeper
// site: adopt an original creature, then come back daily to feed / play / groom / rest it as its stats
// decay over real time. Play minigames to earn Kibble; spend Kibble in the shop on food, toys and treats.
// Everything runs 100% CLIENT-SIDE (SVG/DOM + inline vendored JS — no CDN, no <script src>, no runtime
// network). Your pet + stats + Kibble persist to localStorage (try/catch guarded), so a no-account
// visitor keeps a leveled pet locally.
//
//   PORT=8215 BASE_URL=https://pets.soapbox.community node site/pets/server.mjs
//   → the pet home at  /   ·  /health  ·  robots/sitemap/llms
//
// ── ASSEMBLY, NOT INVENTION (see .local/TRAFFIC_GENERATING_SITES.md §2A / §5) ───────────────────────
//   The pet MODEL is `integrations/games/creatures.mjs` (original-IP Mendelian creatures — species,
//   genes, traits, rarity, NFT-ready `tradeable()`). We generate an adoption POOL from it SERVER-SIDE at
//   module load (deterministic seeded RNG — ZERO request-time work) and serialize it into the page; the
//   client only *selects* + *names* + *persists* a creature. The soft economy reuses the rarity ladder
//   from `economy.mjs`; the shop folds in real boost items from `farm-items.mjs`; the daily-care bonus
//   reuses the weighted prize table + streak formula from `daily-spin.mjs`. The minigame faucets link to
//   the existing `site/idlegames/` games ("play to earn Kibble for your pet").
//
// ── STEALTH FUNNEL (mundane-app-suite-stealth-funnel) ──────────────────────────────────────────────
//   ZERO crypto up front. The page reads and plays like an ordinary free virtual-pet site. Off-chain
//   play works fully with no account. The free-MELEK-account opt-in surfaces ONLY once the visitor has a
//   *leveled* pet, framed as loss-aversion ("save & trade your pet across devices") — never a wallet /
//   token pitch, never the opening copy. Trading/marketplace is a "comes with your account" teaser only.
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated / echoed value; safeHref() on any URL. The handler does NO request-time
//   network. Soft-fail: every route renders even with no data — unknown path → 404, never a 500. No PII.
//   BASE_PATH support so it can mount under the Tools hub. All creatures/art/names are ORIGINAL.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

// Reuse the tested pure game modules — the pet model + economy + daily bonus all come from here.
import { SPECIES, GENES, createCreature, breed, traits, tradeable, makeRng } from '../../integrations/games/creatures.mjs';
import { RARITY_LADDER, rarityWeight } from '../../integrations/games/economy.mjs';
import { boostItems } from '../../integrations/games/farm-items.mjs';
import { PRIZE_TABLE, TOTAL_WEIGHT, streakBonus } from '../../integrations/games/daily-spin.mjs';

const PORT = +(process.env.PORT || 8215);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'Critter Keep';
// The opt-in unlock links the ordinary free-account signup flow (env-overridable). No wallet/token here.
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';
// The minigame faucets live in the separate Idle-Time Games app (its own host). Env-overridable.
const IDLEGAMES_URL = (process.env.IDLEGAMES_URL || 'https://idlegames.soapbox.community').replace(/\/$/, '');

// ── Tools-hub path awareness (mundane-app-suite-stealth-funnel) ────────────────
// Behind a path-routing proxy the prefix is stripped inbound (our routes stay on '/'); we PREPEND it to
// every self-URL we EMIT. BASE_PATH defaults to '' → standalone behaviour is byte-for-byte unchanged.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
const TOOLS_HUB_URL = (process.env.TOOLS_HUB_URL || '/').replace(/\/+$/, '');
const hub = (p) => TOOLS_HUB_URL + p;
const HUB_SIBLINGS = [['/idlegames', 'Games'], ['/diagram', 'Diagram'], ['/calculator', 'Calculator']];
const TOOLS_NAV = `<a class=hublink href="${hub('/')}">◧ SoapBox Tools</a>`
  + HUB_SIBLINGS.slice(0, 2).map(([p, l]) => `<a href="${hub(p)}">${l}</a>`).join('');  // labels are static constants

// ── shared house-style helpers ─────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// safeHref: only pass through real http(s) URLs; everything else (javascript:, data:, junk) → ''.
export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// JSON embedded into a <script> tag — neutralise any '<' so a payload can never break out.
const jsonForScript = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

// Decode a percent-encoded path for display, never throwing on malformed input (e.g. "%%%").
function safeDecode(s) { try { return decodeURIComponent(String(s)); } catch { return String(s); } }

// ── the adoption POOL — generated SERVER-SIDE from creatures.mjs at module load (deterministic; no
//    request-time work). Each species contributes its base creature plus several bred variants so
//    players see real trait + rarity variety. ALL genetics/rarity/tradeable metadata come from the
//    tested module; the client only selects, names and persists one. ────────────────────────────────
function buildPool() {
  const out = [];
  const speciesKeys = Object.keys(SPECIES);
  for (const sp of speciesKeys) {
    const base = createCreature({ species: sp });
    const variants = [base];
    // breed the base against every other species with varied seeds → trait spread + occasional rares.
    let n = 0;
    for (const other of speciesKeys) {
      const mate = createCreature({ species: other });
      variants.push(breed(base, mate, { rng: makeRng(1000 + n * 7 + sp.length), mutationRate: 0.18 }));
      variants.push(breed(mate, base, { rng: makeRng(50 + n * 13 + other.length), mutationRate: 0.22 }));
      n++;
    }
    for (const c of variants) {
      const t = traits(c);
      const meta = tradeable(c);
      out.push({
        id: `${c.species}-g${c.generation || 0}-${meta.genomeFingerprint.length}-${out.length}`,
        species: c.species,
        name: meta.name,                       // the species display name from the module
        blurb: SPECIES[c.species].blurb,
        generation: c.generation || 0,
        hue: t.hue, hide: t.hide, aura: t.aura, size: t.size,
        rarity: t.rarity.charAt(0).toUpperCase() + t.rarity.slice(1), // Common/Rare/Mythic — matches CSS + shop tiers
        rarityWeight: t.rarityWeight,
        fingerprint: meta.genomeFingerprint,
      });
    }
  }
  // de-dupe by phenotype+species so the picker isn't full of look-alikes; keep rarer ones.
  const seen = new Map();
  for (const c of out) {
    const key = `${c.species}|${c.hue}|${c.hide}|${c.aura}|${c.size}`;
    const prev = seen.get(key);
    if (!prev || c.rarityWeight > prev.rarityWeight) seen.set(key, c);
  }
  return [...seen.values()].sort((a, b) => a.species.localeCompare(b.species) || a.rarityWeight - b.rarityWeight);
}
export const POOL = buildPool();

// ── the shop — original pet food/toys, tiered by the economy.mjs rarity ladder; plus real boost items
//    folded in from farm-items.mjs as "Garden treats". Prices are in Kibble (the soft currency). ─────
const PET_ITEMS = [
  { id: 'kibble-scoop', name: 'Kibble Scoop', emoji: '🥣', kind: 'food', stat: 'hunger', boost: 34, rarity: 'Common', price: 20,
    blurb: 'A hearty scoop of house blend. Fills the belly right up.' },
  { id: 'berry-tart', name: 'Sunberry Tart', emoji: '🥧', kind: 'food', stat: 'hunger', boost: 48, rarity: 'Uncommon', price: 45,
    blurb: 'A sweet baked treat — a bigger, tastier meal.' },
  { id: 'yarn-comet', name: 'Yarn Comet', emoji: '☄️', kind: 'toy', stat: 'happiness', boost: 38, rarity: 'Common', price: 25,
    blurb: 'A glowing tail-chaser. Endless pounce-and-play fun.' },
  { id: 'puzzle-cube', name: 'Puzzle Cube', emoji: '🧩', kind: 'toy', stat: 'happiness', boost: 55, rarity: 'Rare', price: 90,
    blurb: 'A clever toy that keeps a bright critter delighted for ages.' },
  { id: 'dew-soap', name: 'Morning-Dew Soap', emoji: '🧼', kind: 'care', stat: 'health', boost: 30, rarity: 'Common', price: 22,
    blurb: 'A gentle wash that leaves the coat gleaming and healthy.' },
  { id: 'moon-bed', name: 'Moonpetal Bed', emoji: '🛏️', kind: 'care', stat: 'energy', boost: 60, rarity: 'Epic', price: 140,
    blurb: 'The comfiest rest there is — deep, restoring sleep.' },
];
// Fold real farm-items boost items in as collectible "garden treats" (genuine catalog reuse).
function gardenTreats() {
  const RMAP = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', legendary: 'Legendary' };
  const EMO = { yield: '🌿', growthSpeed: '💧', seasonExtend: '🌤️', producesFertilizer: '♻️', seedReturn: '🌰' };
  return boostItems().map((it) => ({
    id: `treat-${it.id}`,
    name: it.name,
    emoji: EMO[it.boost && it.boost.effect] || '🌱',
    kind: 'treat',
    stat: 'happiness',
    boost: 20,
    rarity: RMAP[it.rarity] || 'Common',
    // farm-items prices are its own currency; re-tier into Kibble by the economy rarity ladder.
    price: 30 + rarityWeightSafe(RMAP[it.rarity] || 'Common'),
    blurb: (it.blurb || 'A curious garden find your critter adores.'),
  }));
}
// economy.mjs weights are drop-likelihood (higher = commoner); invert into a small Kibble premium.
function rarityWeightSafe(r) { const w = rarityWeight(r) || 1; return Math.round(200 / w); }
export const SHOP = [...PET_ITEMS, ...gardenTreats()];

// ── the minigame faucets — link out to the existing Idle-Time Games app. Play there, earn Kibble here. ─
export const FAUCETS = [
  { slug: 'idle', name: 'Cinder Foundry', emoji: '🔥', blurb: 'An idle forge that keeps working while you\'re away.' },
  { slug: 'snake', name: 'Glow Worm', emoji: '🪱', blurb: 'Steer a growing worm; don\'t bite your own tail.' },
  { slug: 'merge', name: 'Nova Merge', emoji: '✦', blurb: 'Slide and merge orbs into a supernova.' },
  { slug: 'mines', name: 'Signal Sweeper', emoji: '📡', blurb: 'Clear the field without tripping a signal.' },
];

// ── styling (bright, friendly, self-contained — theme-aware via prefers-color-scheme) ────────────────
const STYLE = `<style>
  :root{--bg:#f4f1ea;--panel:#fffdf8;--line:#e6e0d2;--line2:#d8d0bd;--fg:#2c2822;--mut:#7c7566;--acc:#3f8f6e;--acc2:#c9772e;--gold:#c99a2e;--good:#4a9d5b;--bad:#d1584f;--warn:#d99a2e}
  @media (prefers-color-scheme:dark){:root{--bg:#12140f;--panel:#1b1e17;--line:#2a2e22;--line2:#3a4030;--fg:#eef0e6;--mut:#9aa08c;--acc:#6fc79a;--acc2:#e0a05a;--gold:#e0c05a;--good:#6fc78a;--bad:#e07a70;--warn:#e0b05a}}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--acc);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span.sub{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .topbar-r a,.hublink{color:var(--fg);font-weight:700;font-size:13px;border:1px solid var(--line2);border-radius:8px;padding:5px 11px;white-space:nowrap;background:var(--panel)}
  .topbar-r a:hover{border-color:var(--acc);color:var(--acc);text-decoration:none}
  .kibble{border:1px solid var(--gold)!important;color:var(--gold)!important}
  .wrap{max-width:1000px;margin:0 auto;padding:22px 22px 70px}
  h1{margin:0 0 4px;font-size:27px} h2{font-size:20px;margin:30px 0 10px;border-bottom:1px solid var(--line);padding-bottom:6px}
  .sub{color:var(--mut);margin:0 0 16px;font-size:15px} .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:14px;padding:18px}
  .btn{border:1px solid var(--line2);border-radius:10px;padding:9px 16px;font-weight:700;font-size:14px;color:var(--fg);background:var(--panel);cursor:pointer}
  .btn:hover:not(:disabled){border-color:var(--acc);color:var(--acc)} .btn:disabled{opacity:.45;cursor:not-allowed}
  .btn.primary{background:var(--acc);border-color:var(--acc);color:#fff} .btn.primary:hover{filter:brightness(1.06);color:#fff}
  /* adopt picker */
  .pickgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin:14px 0}
  .critter-card{background:var(--panel);border:2px solid var(--line2);border-radius:16px;padding:14px;text-align:center;cursor:pointer;transition:border-color .12s,transform .12s}
  .critter-card:hover{border-color:var(--acc);transform:translateY(-2px)}
  .critter-card.sel{border-color:var(--acc);box-shadow:0 0 0 3px color-mix(in srgb,var(--acc) 30%,transparent)}
  .critter-card .nm{font-weight:800;margin-top:6px} .critter-card .rr{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;margin-top:3px}
  .rr.Common{color:var(--mut)} .rr.Uncommon{color:var(--good)} .rr.Rare{color:var(--acc)} .rr.Epic{color:#a06fd0} .rr.Mythic,.rr.Legendary{color:var(--gold)}
  svg.pet{display:block;margin:0 auto;width:120px;height:120px}
  /* home / stage */
  .home{display:grid;grid-template-columns:1.1fr 1fr;gap:18px} @media(max-width:760px){.home{grid-template-columns:1fr}}
  .stage{text-align:center;padding:22px}
  .stage svg.pet{width:210px;height:210px}
  .petname{font-size:1.5rem;font-weight:800;margin-top:6px}
  .petmeta{color:var(--mut);font-size:.9rem}
  .lvl{display:inline-block;border:1px solid var(--gold);color:var(--gold);border-radius:20px;padding:1px 10px;font-size:.78rem;font-weight:700;margin-left:6px}
  .bars{display:flex;flex-direction:column;gap:11px;margin:6px 0 4px}
  .bar{display:grid;grid-template-columns:78px 1fr 44px;align-items:center;gap:10px;font-size:.86rem}
  .bar .track{height:14px;border-radius:8px;background:var(--line);overflow:hidden}
  .bar .fill{height:100%;border-radius:8px;transition:width .3s}
  .bar b{text-align:right;font-variant-numeric:tabular-nums;color:var(--mut)}
  .care{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:14px}
  .care .btn{display:flex;flex-direction:column;align-items:center;gap:2px;padding:12px}
  .care .btn .ce{font-size:1.5rem}
  .xpwrap{height:8px;border-radius:6px;background:var(--line);overflow:hidden;margin-top:12px}
  .xpwrap .xp{height:100%;background:var(--gold);border-radius:6px;transition:width .3s}
  .toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--fg);color:var(--bg);padding:9px 18px;border-radius:22px;font-weight:700;font-size:14px;opacity:0;transition:opacity .25s;pointer-events:none;z-index:20}
  .toast.on{opacity:1}
  /* grids */
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin:12px 0}
  .shopitem,.faucet{background:var(--panel);border:1px solid var(--line2);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:4px}
  .shopitem .top{display:flex;align-items:center;gap:8px} .shopitem .em{font-size:1.6rem}
  .shopitem .nm{font-weight:800} .shopitem .bl{color:var(--mut);font-size:.86rem;flex:1}
  .shopitem .buy{margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px}
  .price{color:var(--gold);font-weight:800;white-space:nowrap}
  a.faucet{color:var(--fg)} a.faucet:hover{border-color:var(--acc);text-decoration:none;transform:translateY(-2px);transition:.12s}
  a.faucet .nm{font-weight:800;color:var(--acc)}
  .daily{background:color-mix(in srgb,var(--gold) 12%,transparent);border:1px solid var(--gold);border-radius:12px;padding:14px 16px;margin:14px 0;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  .daily .btn{margin-left:auto}
  /* inline mini-game */
  #treatcanvas{background:color-mix(in srgb,var(--acc) 8%,var(--panel));border:1px solid var(--line2);border-radius:12px;max-width:100%;height:auto;touch-action:none;display:block;margin:6px auto}
  .hint{color:var(--mut);font-size:13px;margin:8px 0}
  /* opt-in */
  .optin{margin:10px 0}
  .optin>button{border:1px dashed var(--gold);border-radius:10px;padding:10px 16px;font-weight:700;font-size:14px;color:var(--gold);background:transparent;cursor:pointer}
  .optin>button:hover{background:color-mix(in srgb,var(--gold) 12%,transparent)}
  .panel{display:none;border:1px solid var(--gold);background:color-mix(in srgb,var(--gold) 8%,transparent);border-radius:12px;padding:16px 18px;margin:12px 0;max-width:660px}
  .panel.on{display:block} .panel h3{margin:0 0 6px;font-size:16px} .panel p{margin:6px 0;font-size:14px}
  .panel a.cta{display:inline-block;margin-top:8px;border:1px solid var(--gold);color:var(--gold);border-radius:9px;padding:9px 16px;font-weight:700}
  .panel a.cta:hover{background:var(--gold);color:#fff;text-decoration:none}
  .hidden{display:none!important}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:26px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--acc)}
</style>`;

// The understated, loss-aversion opt-in — hidden until the client detects a leveled pet (JS reveals it).
// It names the free account + saving/trading the pet; never a wallet/token pitch, never the opening copy.
function optInBlock() {
  const cta = esc(safeHref(SIGNUP_URL) || '/');
  return `<div id=optinwrap class="optin hidden">
  <button type=button id=optin-btn>💾 Save &amp; trade your pet across devices</button>
  <div class=panel id=optin-panel role=note>
    <h3>Your critter is safe here — on this device</h3>
    <p>You've raised a real companion. Right now it lives in <b>this browser</b>: clear your data or switch
      devices and it's gone. Want to keep it forever, carry it to your phone, and one day <b>trade it</b>
      with other keepers? You can claim a <b>free MELEK account</b> and your pet — traits, level and all —
      becomes truly yours to keep and swap.</p>
    <p class=muted>Totally optional. Everything here plays fully without it — this is just how you make your
      critter permanent. Trading &amp; the keeper marketplace arrive with your account.</p>
    <a class=cta href="${cta}" target=_blank rel="noopener">Claim your free account &amp; save your pet</a>
  </div>
</div>`;
}

const FOOTER = `<footer>
  <b>${esc(SITE_NAME)}</b> — adopt a critter, raise it, keep it. Everything runs in your browser; your pet
  saves to this device. No sign-up, no install, no tracking. Original creatures — our own species, art
  &amp; names.
</footer>`;

// ── page shell ──────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Adopt an original creature and raise it — feed, play, groom and rest it as its stats change over time. Play free minigames to earn Kibble, then shop for food, toys and treats. No sign-up, no install; it all runs in your browser.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="${bp('/')}">🐣 ${esc(SITE_NAME)}<span class=alpha>Alpha</span></a>
  <div class=topbar-r>${TOOLS_NAV}<span id=kibbleTag class="hublink kibble" title="Your Kibble">🦴 <b id=kibbleAmt>0</b></span></div></header>
<main class=wrap>${body}</main>
${FOOTER}
<div class=toast id=toast></div></body></html>`;
}

// ── the one rich page: adopt picker (if no pet) → pet home (care loop) → shop → faucets → daily → optin.
// All state is client-side. The server ships the same static HTML every time; JS decides what to show.
function homePage() {
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'WebApplication',
    name: SITE_NAME, url: `${BASE_URL}/`, applicationCategory: 'GameApplication',
    operatingSystem: 'Any (web browser)',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description: 'Adopt and raise an original virtual creature — a daily-care pet game that runs entirely in your browser.',
  };

  // NOTE: the intro/tool copy comes FIRST; no crypto/account language appears before the pet is raised.
  const intro = `<h1>Adopt a critter. Raise it. Keep it. 🐾</h1>
<p class=sub>Pick a little creature all your own, then check in to feed it, play with it, groom it and let it
  rest. Look after it and it grows. It lives right here in your browser — no sign-up, no install.</p>`;

  // Adopt picker — populated client-side from the server-built POOL (three random candidates + reroll).
  const adopt = `<section id=adopt class=card>
  <h2 style="margin-top:4px;border:0">Choose your critter</h2>
  <p class=muted>Every critter is one of a kind — its colours, coat, aura and size come from its own genes.
    Here are three looking for a home. Pick a favourite (or shuffle for more).</p>
  <div class=pickgrid id=pickgrid></div>
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px">
    <label>Name your critter: <input id=petname type=text maxlength=20 placeholder="e.g. Sprocket"
      style="padding:8px 10px;border:1px solid var(--line2);border-radius:9px;background:var(--panel);color:var(--fg);font:inherit"></label>
    <button class="btn" id=reroll type=button>🔀 Shuffle</button>
    <button class="btn primary" id=adoptbtn type=button disabled>Adopt this critter</button>
  </div>
</section>`;

  // Pet home — the daily-care loop. Hidden until a pet exists; JS fills it in.
  const home = `<section id=home class="home hidden">
  <div class=card>
    <div class=stage>
      <div id=petart></div>
      <div class=petname id=hnPetname>—<span class=lvl id=hnLevel>Lv 1</span></div>
      <div class=petmeta id=hnMeta></div>
    </div>
    <div class=xpwrap><div class=xp id=xpfill style="width:0%"></div></div>
    <p class=hint id=moodline></p>
  </div>
  <div class=card>
    <div class=bars id=bars></div>
    <div class=care>
      <button class=btn data-care=feed><span class=ce>🍖</span>Feed</button>
      <button class=btn data-care=play><span class=ce>🎾</span>Play</button>
      <button class=btn data-care=groom><span class=ce>🧽</span>Groom</button>
      <button class=btn data-care=rest><span class=ce>😴</span>Rest</button>
    </div>
    <p class=hint>Stats drift while you're away — come back and tend your critter to keep it happy and
      healthy. Each bit of care earns a little XP (and sometimes a 🦴 Kibble).</p>
    <button class=btn id=releasebtn type=button style="margin-top:4px">↩ Adopt a different critter</button>
  </div>
</section>`;

  const daily = `<section id=dailywrap class="hidden">
  <div class=daily>
    <span style="font-size:1.6rem">🎁</span>
    <div><b>Daily care bonus</b><br><span class=muted id=dailymsg>Come back each day for a Kibble bonus — streaks pay more.</span></div>
    <button class=btn id=dailybtn type=button>Claim today's Kibble</button>
  </div>
</section>`;

  // Inline mini care-game — a tiny reflex "treat toss" that pays a little Kibble. Self-contained canvas.
  const minigame = `<section id=treatgame class="hidden">
  <h2>Treat Toss <span class=muted style="font-size:.8rem;font-weight:400">— a quick game for a Kibble snack</span></h2>
  <div class=card>
    <p class=muted style="margin-top:0">Tap the falling treats before they hit the ground. Every catch is a
      Kibble for your critter. A 20-second round.</p>
    <canvas id=treatcanvas width=460 height=280 aria-label="Treat Toss playfield"></canvas>
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      <button class="btn primary" id=treatstart type=button>Start round</button>
      <span>Caught: <b id=treatscore>0</b></span>
      <span class=muted>Time: <b id=treattime>20</b>s</span>
    </div>
  </div>
</section>`;

  const faucets = `<section>
  <h2>Earn Kibble — play a game 🎮</h2>
  <p class=sub>Every one of these free games pays out <b>Kibble</b> you can spend on your critter. They open in
    the game arcade; your best scores save there.</p>
  <div class=grid>${FAUCETS.map((f) => {
    const href = esc(safeHref(`${IDLEGAMES_URL}/${f.slug}`));
    return `<a class=faucet href="${href}" target=_blank rel=noopener>
      <div style="font-size:1.6rem">${esc(f.emoji)}</div>
      <div class=nm>${esc(f.name)}</div>
      <div class=muted style="font-size:.86rem">${esc(f.blurb)}</div>
      <div class=price style="font-size:.8rem;margin-top:4px">Play to earn 🦴</div></a>`;
  }).join('')}</div>
  <p class=hint>Tip: the Treat Toss above is the quickest snack — but the arcade games pay the most.</p>
</section>`;

  const shop = `<section id=shopwrap>
  <h2>The Critter Shop 🛒</h2>
  <p class=sub>Spend your Kibble on better food, fun toys, grooming care and collectible garden treats. Rarer
    items give a bigger boost.</p>
  <div class=grid id=shopgrid></div>
</section>`;

  const body = `${intro}${adopt}${home}${daily}${minigame}${faucets}${shop}
<section id=optinsec>${optInBlock()}</section>
<script id=pooldata type=application/json>${jsonForScript(POOL)}</script>
<script id=shopdata type=application/json>${jsonForScript(SHOP)}</script>
<script id=prizedata type=application/json>${jsonForScript({ table: PRIZE_TABLE, total: TOTAL_WEIGHT })}</script>
<script id=cfg type=application/json>${jsonForScript({ base: BASE_PATH })}</script>
<script>${clientScript()}</script>`;

  return page(`${SITE_NAME} — adopt & raise your own virtual critter`, body, { canonical: `${BASE_URL}/`, jsonld });
}

// ── the entire client app. Self-contained, no external libs. Draws pets procedurally as original SVG
//    from their traits, runs the offline-decay care loop, the shop, the daily bonus (weighted prize
//    table + streak formula mirrored from daily-spin.mjs) and the inline Treat Toss game. ─────────────
function clientScript() {
  return `(function(){
  "use strict";
  var KEY='critterkeep.v1';
  var POOL=readJSON('pooldata',[]), SHOP=readJSON('shopdata',[]), PRIZE=readJSON('prizedata',{table:[],total:1});
  function readJSON(id,dflt){try{return JSON.parse(document.getElementById(id).textContent);}catch(e){return dflt;}}
  function $(id){return document.getElementById(id);}
  function clamp(n){return Math.max(0,Math.min(100,n));}
  function now(){return Date.now();}
  function today(){return new Date().toISOString().slice(0,10);}

  // ---- persistence (try/catch guarded; a fresh/blocked store just yields no pet) ----
  var S=load();
  function blank(){return {pet:null,stats:{hunger:70,happiness:70,energy:80,health:80},kibble:0,xp:0,level:1,ts:now(),lastDaily:null,streak:0};}
  function load(){try{var s=JSON.parse(localStorage.getItem(KEY)||'null');if(s&&typeof s==='object')return s;}catch(e){}return blank();}
  function save(){try{S.ts=now();localStorage.setItem(KEY,JSON.stringify(S));}catch(e){}}

  // ---- offline decay: stats drift by real elapsed time, computed on load (like idle accrual) ----
  // rates are per hour; hunger/happiness fall, energy recovers slowly, health drifts toward wellbeing.
  function applyDecay(){
    if(!S.pet)return;
    var hrs=Math.min(72,(now()-(S.ts||now()))/3600000); if(hrs<=0)return;
    S.stats.hunger=clamp(S.stats.hunger-6*hrs);
    S.stats.happiness=clamp(S.stats.happiness-5*hrs);
    S.stats.energy=clamp(S.stats.energy+4*hrs);
    var wellbeing=(S.stats.hunger+S.stats.happiness)/2;
    S.stats.health=clamp(S.stats.health+(wellbeing-50)/50*3*hrs);
  }

  // ---- procedural ORIGINAL pet art from traits (colour/coat/aura/size) — pure SVG, no assets ----
  var HUE={ember:'#e0662e',verdant:'#4caf6a',cobalt:'#4d79e0',ashen:'#8b8f9c',prism:'#b06fe0'};
  function petSVG(t,mood){
    var c=HUE[t.hue]||'#4caf6a';
    var scale={small:.82,medium:1,large:1.14,colossal:1.26}[t.size]||1;
    var glow = t.aura==='none' ? '' :
      t.aura==='umbra' ? '<circle cx=100 cy=108 r=76 fill="#000" opacity=.18/>' :
      '<circle cx=100 cy=104 r="'+(70)+'" fill="'+c+'" opacity="'+(t.aura==='corona'?.28:.15)+'"/>';
    // coat texture as a light overlay
    var coat='';
    if(t.hide==='scaled'){coat='<g opacity=.25 fill="#000"><circle cx=84 cy=104 r=5/><circle cx=104 cy=98 r=5/><circle cx=116 cy=116 r=5/><circle cx=92 cy=122 r=5/></g>';}
    else if(t.hide==='chitin'){coat='<g opacity=.3 stroke="#000" fill=none stroke-width=2><path d="M72 104 H128"/><path d="M74 118 H126"/></g>';}
    else if(t.hide==='glassine'){coat='<ellipse cx=90 cy=96 rx=14 ry=20 fill="#fff" opacity=.35/>';}
    var bodyOpacity=t.hide==='glassine'?.82:1;
    var happy=(mood||50)>55, sad=(mood||50)<30;
    var mouth = happy? '<path d="M88 128 Q100 140 112 128" stroke="#2c2822" stroke-width=3 fill=none stroke-linecap=round/>'
      : sad? '<path d="M88 134 Q100 124 112 134" stroke="#2c2822" stroke-width=3 fill=none stroke-linecap=round/>'
      : '<line x1=90 y1=130 x2=110 y2=130 stroke="#2c2822" stroke-width=3 stroke-linecap=round/>';
    return '<svg class=pet viewBox="0 0 200 200" role=img aria-label="your critter">'+glow+
      '<g transform="translate(100 108) scale('+scale+') translate(-100 -108)">'+
      // tail
      '<path d="M132 118 Q160 110 150 138 Q140 132 132 122 Z" fill="'+c+'" opacity="'+bodyOpacity+'"/>'+
      // body
      '<ellipse cx=100 cy=118 rx=46 ry=42 fill="'+c+'" opacity="'+bodyOpacity+'"/>'+
      // belly
      '<ellipse cx=100 cy=128 rx=28 ry=26 fill="#fff" opacity=.45/>'+
      // ears/horns
      '<path d="M74 84 Q70 58 88 78 Z" fill="'+c+'"/><path d="M126 84 Q130 58 112 78 Z" fill="'+c+'"/>'+
      coat+
      // eyes
      '<circle cx=88 cy=108 r=7 fill=#fff/><circle cx=112 cy=108 r=7 fill=#fff/>'+
      '<circle cx="'+(happy?89:88)+'" cy=109 r=3.4 fill=#2c2822/><circle cx="'+(happy?113:112)+'" cy=109 r=3.4 fill=#2c2822/>'+
      mouth+
      // little feet
      '<ellipse cx=84 cy=156 rx=11 ry=7 fill="'+c+'"/><ellipse cx=116 cy=156 rx=11 ry=7 fill="'+c+'"/>'+
      '</g></svg>';
  }

  // ---- adopt picker ----
  function pickThree(){
    var pool=POOL.slice();
    for(var i=pool.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var tmp=pool[i];pool[i]=pool[j];pool[j]=tmp;}
    return pool.slice(0,3);
  }
  var candidates=[], selected=null;
  function renderPicker(){
    candidates=pickThree(); selected=null; $('adoptbtn').disabled=true;
    var g=$('pickgrid'); g.innerHTML='';
    candidates.forEach(function(c,i){
      var d=document.createElement('div'); d.className='critter-card'; d.setAttribute('data-i',i);
      d.innerHTML=petSVG(c,60)+'<div class=nm>'+esc(c.name)+'</div>'+
        '<div class="rr '+esc(c.rarity)+'">'+esc(c.rarity)+'</div>'+
        '<div class=muted style="font-size:.76rem;margin-top:3px">'+esc(cap(c.hue))+' · '+esc(cap(c.hide))+' · '+esc(cap(c.size))+'</div>';
      d.addEventListener('click',function(){
        selected=candidates[i];
        Array.prototype.forEach.call(g.children,function(el){el.classList.remove('sel');});
        d.classList.add('sel'); $('adoptbtn').disabled=false;
      });
      g.appendChild(d);
    });
  }
  function cap(s){s=String(s||'');return s.charAt(0).toUpperCase()+s.slice(1);}
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch];});}

  // ---- render the pet home ----
  var STATBAR=[['hunger','Hunger','🍖'],['happiness','Happiness','😊'],['energy','Energy','⚡'],['health','Health','❤️']];
  function barColour(v){return v>=60?'var(--good)':v>=30?'var(--warn)':'var(--bad)';}
  function mood(){var s=S.stats;return Math.round((s.hunger+s.happiness+s.energy+s.health)/4);}
  function xpNeeded(lvl){return 40+ (lvl-1)*30;}
  function renderHome(){
    if(!S.pet){show('adopt',true);show('home',false);show('dailywrap',false);show('treatgame',false);renderPicker();renderShop();paintKibble();return;}
    show('adopt',false);show('home',true);show('dailywrap',true);show('treatgame',true);
    var t=S.pet.traits;
    $('petart').innerHTML=petSVG(t,mood());
    $('hnPetname').firstChild&&($('hnPetname').firstChild.textContent=S.pet.given||S.pet.name);
    $('hnPetname').childNodes[0].nodeValue=S.pet.given||S.pet.name;
    $('hnLevel').textContent='Lv '+S.level;
    $('hnMeta').textContent=S.pet.name+' · '+cap(t.hue)+' '+cap(t.hide)+' · '+t.rarity+(S.pet.traits.generation? ' · gen '+S.pet.traits.generation:'');
    var bars=$('bars');bars.innerHTML='';
    STATBAR.forEach(function(b){var v=Math.round(S.stats[b[0]]);
      var row=document.createElement('div');row.className='bar';
      row.innerHTML='<span>'+b[2]+' '+b[1]+'</span><div class=track><div class=fill style="width:'+v+'%;background:'+barColour(v)+'"></div></div><b>'+v+'</b>';
      bars.appendChild(row);});
    var need=xpNeeded(S.level);
    $('xpfill').style.width=Math.min(100,Math.round(S.xp/need*100))+'%';
    var m=mood();
    $('moodline').textContent = m>70?'Your critter is thriving and adores you. 💚'
      : m>45?'Your critter is doing okay — a little care would help.'
      : m>25?'Your critter is a bit down. It could use some attention.'
      : 'Your critter really needs you right now. 🥺';
    paintKibble();
    maybeShowOptin();
  }
  function paintKibble(){$('kibbleAmt').textContent=Math.floor(S.kibble);}

  // ---- care actions ----
  var CARE={
    feed:{stat:'hunger',amt:26,energy:0,msg:'Yum! 🍖'},
    play:{stat:'happiness',amt:24,energy:-12,msg:'So much fun! 🎾'},
    groom:{stat:'health',amt:20,energy:-4,msg:'Squeaky clean! 🧽'},
    rest:{stat:'energy',amt:40,energy:0,msg:'Zzz… fully rested. 😴'}
  };
  function doCare(kind){
    if(!S.pet)return; var c=CARE[kind]; if(!c)return;
    if(kind==='play'&&S.stats.energy<10){toast('Too tired to play — let it rest first. 😴');return;}
    S.stats[c.stat]=clamp(S.stats[c.stat]+c.amt);
    if(c.energy)S.stats.energy=clamp(S.stats.energy+c.energy);
    gainXP(6);
    if(Math.random()<0.35){var k=1+Math.floor(Math.random()*3);S.kibble+=k;toast(c.msg+' +'+k+' 🦴');}
    else toast(c.msg);
    save();renderHome();
  }
  function gainXP(n){
    S.xp+=n;
    while(S.xp>=xpNeeded(S.level)){S.xp-=xpNeeded(S.level);S.level++;toast('🎉 '+ (S.pet&&(S.pet.given||S.pet.name)) +' reached level '+S.level+'!');}
  }

  // ---- shop ----
  function renderShop(){
    var g=$('shopgrid');if(!g)return;g.innerHTML='';
    SHOP.forEach(function(it){
      var d=document.createElement('div');d.className='shopitem';
      d.innerHTML='<div class=top><span class=em>'+esc(it.emoji)+'</span><span class=nm>'+esc(it.name)+'</span>'+
        '<span class="rr '+esc(it.rarity)+'" style="margin-left:auto;font-size:.68rem;text-transform:uppercase">'+esc(it.rarity)+'</span></div>'+
        '<div class=bl>'+esc(it.blurb)+'</div>'+
        '<div class=buy><span class=price>🦴 '+esc(it.price)+'</span></div>';
      var btn=document.createElement('button');btn.className='btn';btn.type='button';btn.textContent='Buy & use';
      btn.addEventListener('click',function(){buy(it);});
      d.querySelector('.buy').appendChild(btn);
      g.appendChild(d);
    });
  }
  function buy(it){
    if(!S.pet){toast('Adopt a critter first! 🐣');window.scrollTo({top:0,behavior:'smooth'});return;}
    if(S.kibble<it.price){toast('Not enough Kibble — go earn some! 🎮');return;}
    S.kibble-=it.price;
    S.stats[it.stat]=clamp(S.stats[it.stat]+it.boost);
    gainXP(4);
    toast(esc(it.name)+' — your critter loved it! ✨');
    save();renderHome();renderShop();
  }

  // ---- daily bonus: weighted prize table + streak formula (mirrors daily-spin.mjs) ----
  function streakBonus(streakDays){var n=Number(streakDays);if(!isFinite(n)||n<=1)return 0;return Math.min(50,(Math.floor(n)-1)*5);}
  function drawPrize(){var roll=Math.floor(Math.random()*PRIZE.total),acc=0,hit=PRIZE.table[PRIZE.table.length-1];
    for(var i=0;i<PRIZE.table.length;i++){acc+=PRIZE.table[i].weight;if(roll<acc){hit=PRIZE.table[i];break;}}return hit;}
  function claimDaily(){
    var d=today();
    if(S.lastDaily===d){toast('Already claimed today — come back tomorrow! 🎁');return;}
    // consecutive-day check for the streak
    var yest=new Date(Date.now()-86400000).toISOString().slice(0,10);
    S.streak=(S.lastDaily===yest)?(S.streak+1):1;
    var prize=drawPrize();
    var bonus=streakBonus(S.streak);
    var total=prize.points+bonus;
    // scale down to Kibble units (prize points are big; a tenth reads nicely as a pet reward)
    var k=Math.max(5,Math.round(total/5));
    S.kibble+=k; S.lastDaily=d;
    gainXP(5);
    $('dailymsg').textContent='+'+k+' 🦴 today ('+prize.segment.toLowerCase()+(bonus?', streak +'+Math.round(bonus/5):'')+'). Day '+S.streak+' streak!';
    toast('🎁 Daily bonus: +'+k+' 🦴');
    save();renderHome();
  }
  function refreshDaily(){
    if(!$('dailymsg'))return;
    if(S.lastDaily===today()){$('dailybtn').disabled=true;$('dailybtn').textContent='Claimed ✓';
      $('dailymsg').textContent='Claimed today — come back tomorrow for more (day '+S.streak+' streak).';}
    else{$('dailybtn').disabled=false;$('dailybtn').textContent="Claim today's Kibble";}
  }

  // ---- opt-in reveal: only once the pet has leveled up (loss-aversion converts on something loved) ----
  function maybeShowOptin(){
    var w=$('optinwrap');if(!w)return;
    if(S.pet&&S.level>=2)w.classList.remove('hidden');else w.classList.add('hidden');
  }

  // ---- inline Treat Toss mini-game (self-contained canvas; pays a little Kibble) ----
  function initTreatGame(){
    var cv=$('treatcanvas');if(!cv)return;var ctx=cv.getContext('2d');
    var treats=[],running=false,score=0,tleft=20,spawnT=0,last=0,raf=null,tick=null;
    var EMO=['🦴','🍖','🍎','⭐'];
    function reset(){treats=[];score=0;tleft=20;$('treatscore').textContent='0';$('treattime').textContent='20';draw();}
    function start(){if(running)return;reset();running=true;$('treatstart').disabled=true;last=performance.now();spawnT=0;
      tick=setInterval(function(){tleft--;$('treattime').textContent=tleft;if(tleft<=0)stop();},1000);
      raf=requestAnimationFrame(loop);}
    function stop(){running=false;clearInterval(tick);cancelAnimationFrame(raf);$('treatstart').disabled=false;
      $('treatstart').textContent='Play again';
      if(score>0&&S.pet){S.kibble+=score;gainXP(Math.min(20,score));save();renderHome();renderShop();toast('Nice! +'+score+' 🦴 for your critter');}
      else if(score>0){toast('Caught '+score+' — adopt a critter to keep the Kibble!');}
      draw(true);}
    function loop(tnow){if(!running)return;var dt=(tnow-last)/1000;last=tnow;spawnT-=dt;
      if(spawnT<=0){spawnT=0.55+Math.random()*0.5;treats.push({x:20+Math.random()*(cv.width-40),y:-20,v:70+Math.random()*90,e:EMO[Math.floor(Math.random()*EMO.length)]});}
      for(var i=treats.length-1;i>=0;i--){treats[i].y+=treats[i].v*dt;if(treats[i].y>cv.height+20)treats.splice(i,1);}
      draw();raf=requestAnimationFrame(loop);}
    function draw(ended){ctx.clearRect(0,0,cv.width,cv.height);
      ctx.font='26px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      treats.forEach(function(t){ctx.fillText(t.e,t.x,t.y);});
      if(ended){ctx.fillStyle='rgba(0,0,0,.06)';ctx.fillRect(0,0,cv.width,cv.height);
        ctx.fillStyle='var(--fg)';ctx.font='700 20px system-ui,sans-serif';
        ctx.fillStyle=getComputedStyle(document.body).color;
        ctx.fillText('Caught '+score+' treats!',cv.width/2,cv.height/2);}}
    function hit(x,y){for(var i=treats.length-1;i>=0;i--){var t=treats[i];if(Math.abs(t.x-x)<26&&Math.abs(t.y-y)<26){
      treats.splice(i,1);score++;$('treatscore').textContent=score;return;}}}
    cv.addEventListener('mousedown',function(e){if(!running)return;var r=cv.getBoundingClientRect();
      hit((e.clientX-r.left)*cv.width/r.width,(e.clientY-r.top)*cv.height/r.height);});
    cv.addEventListener('touchstart',function(e){if(!running)return;e.preventDefault();var r=cv.getBoundingClientRect();var tt=e.touches[0];
      hit((tt.clientX-r.left)*cv.width/r.width,(tt.clientY-r.top)*cv.height/r.height);},{passive:false});
    $('treatstart').addEventListener('click',start);
    reset();
  }

  // ---- toast ----
  var toastT=null;
  function toast(msg){var el=$('toast');if(!el)return;el.textContent=msg;el.classList.add('on');
    clearTimeout(toastT);toastT=setTimeout(function(){el.classList.remove('on');},1800);}

  function show(id,on){var el=$(id);if(el)el.classList[on?'remove':'add']('hidden');}

  // ---- wire it up ----
  applyDecay();save();
  document.querySelectorAll('[data-care]').forEach(function(b){b.addEventListener('click',function(){doCare(b.getAttribute('data-care'));});});
  $('reroll').addEventListener('click',renderPicker);
  $('adoptbtn').addEventListener('click',function(){
    if(!selected)return;
    var nm=($('petname').value||'').trim().slice(0,20);
    S=blank(); S.pet={id:selected.id,species:selected.species,name:selected.name,given:nm||selected.name,
      traits:{hue:selected.hue,hide:selected.hide,aura:selected.aura,size:selected.size,rarity:selected.rarity,generation:selected.generation||0}};
    save();renderHome();refreshDaily();
    toast('🎉 You adopted '+(nm||selected.name)+'!');
    window.scrollTo({top:0,behavior:'smooth'});
  });
  $('releasebtn').addEventListener('click',function(){
    if(!confirm('Adopt a different critter? Your current pet will be let go from this device.'))return;
    S=blank();save();renderHome();refreshDaily();
  });
  $('dailybtn')&&$('dailybtn').addEventListener('click',claimDaily);
  initTreatGame();
  renderHome();refreshDaily();renderShop();
})();`;
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/'];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt(BASE_URL));
    }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'weekly', priority: u === '/' ? '1.0' : '0.7' }));
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
        summary: 'A virtual-pet / creature-keeper game: adopt an original creature and raise it with a daily feed/play/groom/rest care loop as its stats decay over time. Play free minigames to earn Kibble, spend it in a shop on food, toys and treats. Runs entirely in the browser; the pet saves locally with no account. An optional free MELEK account lets a player save their leveled pet across devices and (soon) trade it.',
        links: [{ label: 'Pet home', path: '/' }],
      }));
    }

    if (path === '/' || path === '') return sendHtml(res, homePage());

    // unknown → 404, never a 500. The requested path is echoed back ESCAPED.
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — ' + SITE_NAME,
      `<h1>Not found</h1><p class=muted>There's nothing at <code>${esc(safeDecode(path))}</code>. <a href="${bp('/')}">Back to your critter</a>.</p>`,
      { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/pets\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
