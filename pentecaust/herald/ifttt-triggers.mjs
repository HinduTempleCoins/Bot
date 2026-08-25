// pentecaust/herald/ifttt-triggers.mjs — Herald IFTTT-style automation triggers.
//
// The differentiator the other Steem clones never shipped: "WHEN <a tag/velocity/campaign condition>
// THEN <do a thing>" recipes, wired to the tag engines we already run. A recipe reads:
//
//   { id, name, when:{ type:'tag'|'velocity'|'campaign', tag, threshold? },
//                then:{ type:'notify'|'webhook'|'reward'|'post', target } }
//
//   when.type='tag'      → fires when an incoming post/event carries `when.tag`.
//   when.type='velocity' → fires when the tag's velocity signal (from integrations/tag-tracker.mjs /
//                          hashtag-external.mjs) is AT OR ABOVE `when.threshold`.
//   when.type='campaign' → fires when a campaign event names `when.tag` (its campaign id).
//   then.type            → the ACTION to plan: notify a user, POST a webhook, grant a reward, make a post.
//
// This module is PURE and READ-ONLY over HTTP. It holds NO key, signs NOTHING, broadcasts NOTHING. When a
// recipe fires, evaluate() RETURNS the planned action — a real executor (the thing that actually notifies /
// webhooks / rewards / posts) is deliberately OUT OF SCOPE and lives behind the Signer, not here.
//
// It builds on the existing rule engine — integrations/hashtag-trigger.mjs (matchRules / parseTags) —
// rather than re-implementing tag matching, so a recipe's `when.tag` matches a post the exact same way a
// reward rule does. The store's dedupe window is a recipe+event guard (author|tag dedupeTriggers doesn't
// fit here: two distinct recipes on one tag must both fire).
//
// House style: ESM, esc() all interpolation, soft-fail-never-throw (shaped returns), injectable `now`,
// offline (no network, no keys). CLI guarded by process.argv[1].
//
//   import { validateRecipe, matchRecipe, evaluate, makeStore, handler } from './ifttt-triggers.mjs'

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { matchRules } from '../../integrations/hashtag-trigger.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const WHEN_TYPES = new Set(['tag', 'velocity', 'campaign']);
const THEN_TYPES = new Set(['notify', 'webhook', 'reward', 'post']);
const DEFAULT_DEDUPE_MS = 5 * 60 * 1000; // same event can't re-fire a recipe inside 5 min

const clean = (s) => String(s == null ? '' : s).trim();
const normTag = (t) => clean(t).replace(/^#/, '').toLowerCase();
const isTag = (t) => /^[a-z0-9_]{1,64}$/.test(t);
const now_ = (now) => (Number.isFinite(now) ? now : Date.now());
let seq = 0;

/**
 * validateRecipe(r) — normalize + validate a recipe, or reject it. Never throws.
 * @returns {{ ok:true, recipe }} | {{ ok:false, reason }}
 */
export function validateRecipe(r) {
  try {
    if (!r || typeof r !== 'object') return { ok: false, reason: 'not-an-object' };
    const name = clean(r.name);
    if (!name) return { ok: false, reason: 'missing-name' };

    const when = r.when && typeof r.when === 'object' ? r.when : null;
    if (!when) return { ok: false, reason: 'missing-when' };
    const wType = clean(when.type);
    if (!WHEN_TYPES.has(wType)) return { ok: false, reason: 'bad-when-type' };
    const tag = normTag(when.tag);
    if (!isTag(tag)) return { ok: false, reason: 'bad-when-tag' };

    let threshold;
    if (wType === 'velocity') {
      threshold = Number(when.threshold);
      if (!Number.isFinite(threshold) || threshold <= 0) return { ok: false, reason: 'bad-velocity-threshold' };
    } else if (when.threshold != null) {
      const t = Number(when.threshold);
      if (Number.isFinite(t) && t > 0) threshold = t; // optional on non-velocity, ignored if absent/bad
    }

    const then = r.then && typeof r.then === 'object' ? r.then : null;
    if (!then) return { ok: false, reason: 'missing-then' };
    const tType = clean(then.type);
    if (!THEN_TYPES.has(tType)) return { ok: false, reason: 'bad-then-type' };
    const target = clean(then.target);
    if (!target) return { ok: false, reason: 'missing-then-target' };

    const id = clean(r.id) || `r${Date.now().toString(36)}${(seq = (seq + 1) % 1e6).toString(36)}`;
    const whenOut = { type: wType, tag };
    if (threshold != null) whenOut.threshold = threshold;
    return { ok: true, recipe: { id, name, when: whenOut, then: { type: tType, target } } };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/**
 * matchRecipe(recipe, event) — does this event FIRE this recipe? Pure boolean, never throws.
 * The event's `type` must match the recipe's when.type. Then:
 *   tag      → recipe's tag appears in the event's tags (via hashtag-trigger.matchRules).
 *   velocity → event.value (the tag's velocity signal) >= recipe.when.threshold, tags must include the tag.
 *   campaign → event names the recipe's tag as its campaign (event.campaign|tag).
 */
export function matchRecipe(recipe, event) {
  try {
    const v = validateRecipe(recipe);
    if (!v.ok) return false;
    const rec = v.recipe;
    if (!event || typeof event !== 'object') return false;
    if (clean(event.type) !== rec.when.type) return false;

    if (rec.when.type === 'tag') {
      // one-rule matchRules: fires iff the recipe's tag is among the event's parsed tags
      return matchRules(event, [{ tag: rec.when.tag }]).length > 0;
    }
    if (rec.when.type === 'velocity') {
      if (normTag(event.tag) !== rec.when.tag) return false;
      const val = Number(event.value != null ? event.value : event.velocity);
      if (!Number.isFinite(val)) return false;
      return val >= rec.when.threshold;
    }
    if (rec.when.type === 'campaign') {
      const camp = normTag(event.campaign != null ? event.campaign : event.tag);
      return camp === rec.when.tag;
    }
    return false;
  } catch {
    return false;
  }
}

// A stable identity for an event, so the store can dedupe repeats of the SAME event.
function eventKey(event) {
  if (!event || typeof event !== 'object') return 'e|';
  const parts = [clean(event.type), normTag(event.tag != null ? event.tag : event.campaign),
    clean(event.author), clean(event.id != null ? event.id : event.permlink)];
  return `e|${parts.join('|')}`;
}

// Short human-readable summary of the event for the returned action (esc'd at render, plain here).
function eventSummary(event) {
  if (!event || typeof event !== 'object') return '';
  return clean(event.type) + ':' + normTag(event.tag != null ? event.tag : event.campaign);
}

/**
 * evaluate(recipes, event) — the fired recipes' PLANNED actions for one incoming event. Pure; never throws.
 * Returns [{ recipeId, name, action, target, tag, whenType, event }]. Firing here PLANS the action only —
 * nothing is executed, notified, posted, or paid. Order follows `recipes`.
 */
export function evaluate(recipes, event) {
  try {
    if (!Array.isArray(recipes)) return [];
    const out = [];
    const firedIds = new Set();
    const summary = eventSummary(event);
    for (const r of recipes) {
      const v = validateRecipe(r);
      if (!v.ok) continue;
      const rec = v.recipe;
      if (firedIds.has(rec.id)) continue; // one fire per recipe per event
      if (!matchRecipe(rec, event)) continue;
      firedIds.add(rec.id);
      out.push({
        recipeId: rec.id,
        name: rec.name,
        action: rec.then.type,
        target: rec.then.target,
        tag: rec.when.tag,
        whenType: rec.when.type,
        event: summary,
        planned: true, // NEVER executed here — a downstream executor (behind the Signer) does the real work
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * makeStore({ recipes?, dedupeMs? }) — an in-memory, injectable recipe store with a dedupe window so the
 * same event can't double-fire a recipe. Soft-fail throughout.
 *   add(recipe)            → { ok, recipe? , reason? }   (validates before storing)
 *   list()                 → recipe[] (copies)
 *   get(id) / has(id)
 *   remove(id)             → boolean
 *   fire(event, now?)      → planned action[] for this event, minus any already fired inside the window
 * fire() reuses hashtag-trigger.dedupeTriggers for the in-window suppression (author|tag identity),
 * plus a per-(recipe,event) window guard so a repeated identical event is suppressed too.
 */
export function makeStore(opts = {}) {
  const dedupeMs = Number.isFinite(Number(opts.dedupeMs)) && Number(opts.dedupeMs) > 0
    ? Number(opts.dedupeMs) : DEFAULT_DEDUPE_MS;
  const recipes = [];
  const fired = new Map(); // `${recipeId}|${eventKey}` -> last fired ts (window guard)

  if (Array.isArray(opts.recipes)) {
    for (const r of opts.recipes) { const v = validateRecipe(r); if (v.ok) recipes.push(v.recipe); }
  }

  const list = () => recipes.map((r) => ({ id: r.id, name: r.name, when: { ...r.when }, then: { ...r.then } }));
  const get = (id) => recipes.find((r) => r.id === clean(id)) || null;

  function add(recipe) {
    const v = validateRecipe(recipe);
    if (!v.ok) return { ok: false, reason: v.reason };
    const existing = recipes.findIndex((r) => r.id === v.recipe.id);
    if (existing >= 0) recipes[existing] = v.recipe; else recipes.push(v.recipe);
    return { ok: true, recipe: v.recipe };
  }

  function remove(id) {
    const key = clean(id);
    const i = recipes.findIndex((r) => r.id === key);
    if (i < 0) return false;
    recipes.splice(i, 1);
    return true;
  }

  function fire(event, now) {
    try {
      const t = now_(now);
      const ek = eventKey(event);
      const planned = evaluate(recipes, event);
      // window guard: a given (recipe, event) fires at most once inside the dedupe window. Keyed by
      // recipe+event (NOT author|tag) so two distinct recipes on the same tag both still fire.
      const fresh = [];
      for (const a of planned) {
        const key = `${a.recipeId}|${ek}`;
        const last = fired.get(key);
        if (Number.isFinite(last) && (t - last) < dedupeMs) continue; // suppressed in-window
        fired.set(key, t);
        fresh.push(a);
      }
      return fresh;
    } catch {
      return [];
    }
  }

  return { add, list, get, has: (id) => !!get(id), remove, fire, dedupeMs };
}

// ── HTTP surface ────────────────────────────────────────────────────────────────────────────────────
// A module singleton so the mounted handler is stateful across requests (like ad-network's). Seeded with a
// couple of example recipes so the page and API are never empty. Injectable via handler(req,res,{store}).
const DEFAULT_RECIPES = [
  { id: 'ex-melek-notify', name: 'Ping me on #melek', when: { type: 'tag', tag: 'melek' }, then: { type: 'notify', target: '@hathor' } },
  { id: 'ex-trend-webhook', name: 'Webhook when a tag trends', when: { type: 'velocity', tag: 'prana', threshold: 25 }, then: { type: 'webhook', target: 'https://example.invalid/hook' } },
  { id: 'ex-campaign-reward', name: 'Reward the launch campaign', when: { type: 'campaign', tag: 'launch' }, then: { type: 'reward', target: '10 MELEK' } },
];
const singletonStore = makeStore({ recipes: DEFAULT_RECIPES });

const sendJson = (res, code, obj) => {
  try { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); } catch {}
  try { res.end(JSON.stringify(obj)); } catch {}
};
const sendHtml = (res, code, html) => {
  try { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); } catch {}
  try { res.end(html); } catch {}
};

function readJsonBody(req, max = 262144) {
  if (req && req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let d = ''; let over = false;
    try {
      req.on('data', (c) => { d += c; if (d.length > max) { over = true; try { req.destroy(); } catch {} } });
      req.on('end', () => { if (over) return resolve(null); try { resolve(d ? JSON.parse(d) : {}); } catch { resolve(null); } });
      req.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

function page(store) {
  const rows = store.list().map((r) => `<tr>
    <td>${esc(r.name)}</td>
    <td><span class=pill>WHEN</span> ${esc(r.when.type)} <code>#${esc(r.when.tag)}</code>${r.when.threshold != null ? ` ≥ ${esc(r.when.threshold)}` : ''}</td>
    <td><span class="pill p2">THEN</span> ${esc(r.then.type)} <code>${esc(r.then.target)}</code></td>
    <td><code>${esc(r.id)}</code></td></tr>`).join('') || `<tr><td colspan=4 class=mut>No recipes yet.</td></tr>`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>IFTTT triggers — Herald</title>
<style>
 :root{--bg:#0b0d12;--panel:#141a24;--line:#232c3a;--fg:#e9eef5;--mut:#8896a6;--blue:#1d9bf0;--gold:#d9a441;--grn:#3fb950}
 *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
 a{color:var(--blue);text-decoration:none} .wrap{max-width:900px;margin:0 auto;padding:0 18px 40px}
 header{padding:22px 0 8px;border-bottom:1px solid var(--line);margin-bottom:18px}
 .brand{font-weight:800;font-size:22px;color:var(--gold)} .alpha{font-size:11px;font-weight:700;color:#1a1305;background:var(--gold);border-radius:6px;padding:2px 7px;margin-left:6px;vertical-align:middle}
 .lead{color:var(--mut);max-width:640px;margin:10px 0 0} h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--gold);margin:26px 0 10px}
 table{width:100%;border-collapse:collapse;margin-top:6px} th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}
 th{color:var(--mut);text-transform:uppercase;font-size:11px;letter-spacing:.06em} code{font-family:ui-monospace,monospace;color:var(--grn);font-size:12px}
 .pill{font-size:10px;font-weight:700;background:var(--blue);color:#04121f;border-radius:5px;padding:1px 5px} .pill.p2{background:var(--gold);color:#1a1305}
 .mut{color:var(--mut)} .card{border:1px solid var(--line);border-radius:12px;padding:15px 16px;background:var(--panel);margin-top:14px}
 label{display:block;font-size:12px;color:var(--mut);margin:8px 0 3px} input,select{width:100%;background:#0b0f16;border:1px solid var(--line);border-radius:7px;color:var(--fg);padding:7px 9px;font:inherit}
 .row{display:grid;grid-template-columns:1fr 1fr;gap:10px} button{margin-top:12px;background:var(--blue);color:#04121f;border:0;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer}
 .note{color:var(--mut);font-size:12px;margin-top:10px;border-top:1px solid var(--line);padding-top:10px} pre{background:#0b0f16;border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto;font-size:12px}
</style></head><body><div class=wrap>
<header><span class=brand>◇ Herald · IFTTT triggers</span><span class=alpha>ALPHA</span>
<p class=lead>Automation recipes for the MELEK ecosystem: <b>WHEN</b> a tag appears, a tag trends, or a campaign
fires — <b>THEN</b> notify, webhook, reward, or post. The differentiator the other Steem clones never had,
wired to our tag engines. Read-only: this surface holds no key and <b>plans</b> actions; a downstream
executor behind the Signer does the real work.</p></header>

<h2>Recipes</h2>
<table><thead><tr><th>Name</th><th>When</th><th>Then</th><th>ID</th></tr></thead><tbody>${rows}</tbody></table>

<div class=card><h2 style="margin-top:0">Add a recipe (client-side preview)</h2>
<form id=f onsubmit="return false">
 <label>Name</label><input id=name placeholder="Ping me on #melek">
 <div class=row><div><label>When type</label><select id=wtype><option>tag</option><option>velocity</option><option>campaign</option></select></div>
 <div><label>Tag</label><input id=wtag placeholder="melek"></div></div>
 <div class=row><div><label>Threshold (velocity only)</label><input id=wthr type=number placeholder="25"></div>
 <div><label>Then type</label><select id=ttype><option>notify</option><option>webhook</option><option>reward</option><option>post</option></select></div></div>
 <label>Then target</label><input id=ttarget placeholder="@hathor  /  https://…/hook  /  10 MELEK">
 <button id=preview>Preview JSON</button></form>
 <pre id=out class=mut>The recipe JSON appears here. This preview is client-side only — nothing is stored or executed.</pre>
 <div class=note>API: <code>GET /api/ifttt/recipes</code> lists recipes as JSON ·
 <code>POST /api/ifttt/evaluate</code> with <code>{ event, recipes? }</code> returns the fired recipes' planned actions
 (or <code>GET /api/ifttt/evaluate?type=tag&amp;tag=melek</code> offline). Nothing is signed or broadcast.</div>
</div>
<script>
(function(){var $=function(id){return document.getElementById(id)};
 $('preview').addEventListener('click',function(){
  var r={name:$('name').value,when:{type:$('wtype').value,tag:$('wtag').value},then:{type:$('ttype').value,target:$('ttarget').value}};
  var thr=parseFloat($('wthr').value); if(!isNaN(thr))r.when.threshold=thr;
  $('out').textContent=JSON.stringify(r,null,2); $('out').className='';
 });})();
</script>
</div></body></html>`;
}

// handler(req,res,{store?}) — GET / or /ifttt → HTML; GET /api/ifttt/recipes → JSON; POST/GET /api/ifttt/evaluate → fired actions.
export async function handler(req, res, opts = {}) {
  try {
    const store = opts.store || singletonStore;
    const method = ((req && req.method) || 'GET').toUpperCase();
    const raw = String((req && req.url) || '/');
    const [pathRaw, qs = ''] = raw.split('?');
    const path = (pathRaw || '/').replace(/\/+$/, '') || '/';

    if (method === 'GET' && (path === '/' || path === '/ifttt')) return sendHtml(res, 200, page(store));
    if (method === 'GET' && path === '/health') return sendJson(res, 200, { ok: true, service: 'herald-ifttt-triggers' });
    if (method === 'GET' && path === '/api/ifttt/recipes') return sendJson(res, 200, { ok: true, recipes: store.list() });

    if (path === '/api/ifttt/evaluate') {
      let event = null; let recipes = null; let now;
      if (method === 'POST') {
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, reason: 'bad-body' });
        event = body.event && typeof body.event === 'object' ? body.event : body;
        if (Array.isArray(body.recipes)) recipes = body.recipes;
        if (Number.isFinite(Number(body.now))) now = Number(body.now);
      } else if (method === 'GET') {
        const params = new URLSearchParams(qs);
        const tag = params.get('tag') || '';
        event = { type: params.get('type') || 'tag', tag, tags: tag ? [tag] : [], author: params.get('author') || '' };
        if (params.get('value') != null) event.value = Number(params.get('value'));
        if (params.get('campaign')) event.campaign = params.get('campaign');
      } else {
        return sendJson(res, 405, { ok: false, reason: 'method' });
      }
      // recipes supplied → pure evaluate; otherwise fire against the store (with dedupe window).
      const actions = Array.isArray(recipes) ? evaluate(recipes, event) : store.fire(event, now);
      return sendJson(res, 200, { ok: true, fired: actions.length, actions, note: 'planned only — nothing signed or broadcast' });
    }

    return sendJson(res, 404, { ok: false, reason: 'not-found' });
  } catch {
    return sendJson(res, 500, { ok: false, reason: 'error' });
  }
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('ifttt-triggers.mjs')) {
  const PORT = +(env('PORT', '8166'));
  const HOST = env('HOST', '127.0.0.1');
  createServer((req, res) => handler(req, res)).listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`herald ifttt-triggers on http://${HOST}:${PORT}`);
  });
}
