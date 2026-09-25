// pentecaust-recipes.mjs — Pentecaust F2: an IFTTT-style trigger→action recipe engine for the
// creator hub. A creator wires their own recipes ("new donation → play animation + post to Discord";
// "went live → announce on Telegram + Discord"; "new chain post → cross-post"). This module is the
// PURE, DETERMINISTIC engine: it defines the trigger/action vocabulary, validates a recipe, decides
// whether an event fires a recipe, renders message templates, and dispatches matched actions to
// INJECTABLE connector functions. No network, no side-effects, no secrets at import.
//
// SECURITY (BRIEF.md §7, CLAUDE.md key-custody): a recipe NEVER holds a bot token. Actions carry a
// `tokenRef` — a NAME the connector resolves against the server-side vault. Raw secrets are passed
// in only at run time, by the injected connectors, never stored in the recipe object or logged here.
//
//   import { TRIGGERS, ACTIONS, validateRecipe, matchTrigger, renderTemplate, runRecipe }
//     from './pentecaust-recipes.mjs'
//   const report = await runRecipe(recipe, event, { connectors })
//   node integrations/pentecaust-recipes.mjs            -> demo (validate + dry-run, no network)

// --- HTML escape (exported for any HTML surface that renders a recipe; message BODIES are plain
//     text — see renderTemplate — so they are NOT html-escaped, that would corrupt chat text). -----
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// ── TRIGGER vocabulary ──────────────────────────────────────────────────────────────────────────
// Each trigger declares the event.type it fires on and the fields an event of that type carries
// (used for template hints + validation of conditions). `fields` is documentation, not a hard schema.
export const TRIGGERS = Object.freeze({
  'donation':       { type: 'donation',       fields: ['amount', 'currency', 'from', 'message'],  note: 'A donation landed on the show page.' },
  'went-live':      { type: 'went-live',      fields: ['title', 'url', 'creator'],                note: 'The creator started a live show.' },
  'new-chain-post': { type: 'new-chain-post', fields: ['author', 'permlink', 'title', 'url'],     note: 'A new post appeared on the MELEK chain.' },
  'schedule':       { type: 'schedule',       fields: ['cron', 'now', 'label'],                   note: 'A scheduled tick fired.' },
});
export function triggerTypes() { return Object.keys(TRIGGERS); }

// ── ACTION vocabulary ───────────────────────────────────────────────────────────────────────────
// `params` names the fields an action expects on its recipe entry. `secretParams` names the params
// that are token REFERENCES (vault keys), so validateRecipe can assert they are refs, not raw tokens.
export const ACTIONS = Object.freeze({
  'post-to-discord':  { params: ['tokenRef', 'channelId', 'template'], secretParams: ['tokenRef'], note: 'Send a message to a Discord channel.' },
  'post-to-telegram': { params: ['tokenRef', 'chatId', 'template'],    secretParams: ['tokenRef'], note: 'Send a message to a Telegram chat/group.' },
  'play-animation':   { params: ['animation', 'durationMs'],           secretParams: [],           note: 'Fire an on-screen overlay animation on the show page.' },
  'cross-post':       { params: ['targets', 'template'],               secretParams: [],           note: 'Fan a message out to several named targets (each a configured surface).' },
});
export function actionTypes() { return Object.keys(ACTIONS); }

// Heuristic: does a string look like a raw bot token rather than a vault reference name? Discord bot
// tokens are long dotted base64; Telegram tokens are "<digits>:<base64ish>". Vault refs are short
// slugs like "creator42-discord". This guards against a token accidentally pasted into a recipe row.
export function looksLikeRawToken(v) {
  const s = str(v);
  if (!s) return false;
  if (/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(s)) return true;            // Telegram bot token
  if (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}$/.test(s)) return true; // Discord token
  if (s.length > 50 && !/\s/.test(s) && /[A-Za-z0-9]{40,}/.test(s)) return true;          // generic long secret
  return false;
}

// ── validateRecipe ────────────────────────────────────────────────────────────────────────────────
// Returns { valid, errors, warnings }. Soft — never throws; a malformed recipe yields errors, not an
// exception. A valid recipe has a known trigger, >=1 known action, valid conditions, and carries NO
// raw secret (only tokenRefs).
export function validateRecipe(recipe) {
  const errors = [];
  const warnings = [];
  if (!recipe || typeof recipe !== 'object') {
    return { valid: false, errors: ['recipe must be an object'], warnings };
  }
  if (!str(recipe.id)) warnings.push('recipe has no id');
  if (!str(recipe.name)) warnings.push('recipe has no name');

  const trig = recipe.trigger;
  if (!trig || typeof trig !== 'object') {
    errors.push('recipe.trigger is required');
  } else if (!TRIGGERS[str(trig.type)]) {
    errors.push(`unknown trigger type "${str(trig.type)}" (expected one of: ${triggerTypes().join(', ')})`);
  } else {
    for (const c of normConditions(trig.conditions)) {
      if (!c.field) errors.push('a condition is missing "field"');
      if (!COND_OPS[c.op]) errors.push(`a condition uses unknown op "${c.op}" (expected: ${Object.keys(COND_OPS).join(', ')})`);
    }
  }

  const actions = Array.isArray(recipe.actions) ? recipe.actions : [];
  if (actions.length === 0) errors.push('recipe needs at least one action');
  actions.forEach((a, i) => {
    const spec = a && ACTIONS[str(a.type)];
    if (!spec) {
      errors.push(`action[${i}] unknown type "${str(a && a.type)}" (expected one of: ${actionTypes().join(', ')})`);
      return;
    }
    for (const p of spec.secretParams) {
      const v = a[p];
      if (!str(v)) errors.push(`action[${i}] (${a.type}) missing secret reference "${p}"`);
      else if (looksLikeRawToken(v)) errors.push(`action[${i}] (${a.type}) "${p}" looks like a RAW TOKEN — it must be a vault reference name, never the secret itself`);
    }
    // per-action shape checks
    if (a.type === 'post-to-discord' && !str(a.channelId)) errors.push(`action[${i}] post-to-discord missing channelId`);
    if (a.type === 'post-to-telegram' && !str(a.chatId)) errors.push(`action[${i}] post-to-telegram missing chatId`);
    if (a.type === 'cross-post' && !(Array.isArray(a.targets) && a.targets.length)) errors.push(`action[${i}] cross-post needs a non-empty targets array`);
    if (a.type === 'play-animation' && !str(a.animation)) errors.push(`action[${i}] play-animation missing animation name`);
  });

  return { valid: errors.length === 0, errors, warnings };
}

// ── conditions ───────────────────────────────────────────────────────────────────────────────────
// A trigger may carry conditions: [{ field, op, value }]. ALL must pass (AND). Empty = always match.
// Fields are read from the event by dot-path (e.g. "amount", "donor.tier").
export const COND_OPS = Object.freeze({
  eq:       (a, b) => a === b || str(a) === str(b),
  ne:       (a, b) => !(a === b || str(a) === str(b)),
  gt:       (a, b) => num(a) != null && num(b) != null && num(a) > num(b),
  gte:      (a, b) => num(a) != null && num(b) != null && num(a) >= num(b),
  lt:       (a, b) => num(a) != null && num(b) != null && num(a) < num(b),
  lte:      (a, b) => num(a) != null && num(b) != null && num(a) <= num(b),
  contains: (a, b) => str(a).toLowerCase().includes(str(b).toLowerCase()),
  in:       (a, b) => Array.isArray(b) && b.some((x) => x === a || str(x) === str(a)),
});

function normConditions(conditions) {
  if (!Array.isArray(conditions)) return [];
  return conditions
    .filter((c) => c && typeof c === 'object')
    .map((c) => ({ field: str(c.field), op: str(c.op) || 'eq', value: c.value }));
}

function getPath(obj, path) {
  if (!obj || !path) return undefined;
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Does `event` fire this recipe? Checks type match, enabled flag, and all conditions. Never throws. */
export function matchTrigger(recipe, event) {
  try {
    if (!recipe || recipe.enabled === false) return false;
    const trig = recipe.trigger;
    if (!trig || !TRIGGERS[str(trig.type)]) return false;
    if (!event || str(event.type) !== str(trig.type)) return false;
    for (const c of normConditions(trig.conditions)) {
      const fn = COND_OPS[c.op];
      if (!fn) return false;
      if (!fn(getPath(event, c.field), c.value)) return false;
    }
    return true;
  } catch { return false; }
}

// ── renderTemplate ───────────────────────────────────────────────────────────────────────────────
// Fill {{field}} placeholders from the event by dot-path. Output is PLAIN chat text (Discord/Telegram
// message bodies), so values are NOT html-escaped; they are coerced to string and stripped of control
// chars to keep a message from carrying line-noise. Unknown placeholders render empty. Never throws.
export function renderTemplate(template, event = {}) {
  try {
    const t = String(template ?? '');
    return t.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
      const v = getPath(event, path);
      return v == null ? '' : String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    });
  } catch { return ''; }
}

// ── runRecipe ────────────────────────────────────────────────────────────────────────────────────
// Dispatch a matched recipe's actions to injected connector functions. `connectors` is a map from
// action type -> async fn(payload). runRecipe renders each action's template, builds a payload
// (carrying tokenRef by NAME, never a resolved secret — the connector resolves it), and calls the
// connector. Every action is isolated: one failing connector soft-fails to { ok:false, error } and
// the rest still run. Returns a structured report; never throws.
export async function runRecipe(recipe, event, { connectors = {}, dryRun = false } = {}) {
  const report = { recipeId: str(recipe && recipe.id) || null, triggered: false, reason: '', actions: [] };

  const v = validateRecipe(recipe);
  if (!v.valid) { report.reason = 'invalid: ' + v.errors.join('; '); return report; }
  if (!matchTrigger(recipe, event)) { report.reason = 'event did not match trigger'; return report; }
  report.triggered = true;

  for (const a of recipe.actions) {
    const type = str(a.type);
    const entry = { type, ok: false };
    try {
      const payload = buildPayload(a, event);
      if (dryRun) { entry.ok = true; entry.dryRun = true; entry.payload = redact(payload); report.actions.push(entry); continue; }
      const fn = connectors[type];
      if (typeof fn !== 'function') { entry.skipped = true; entry.error = `no connector for "${type}"`; report.actions.push(entry); continue; }
      const res = await fn(payload);
      // A connector should soft-fail to { ok:false } rather than throw; honor its own ok if present.
      entry.ok = res == null ? true : (res.ok !== false);
      if (res && res.ok === false && res.error) entry.error = String(res.error);
      entry.result = redact(res);
    } catch (e) {
      entry.ok = false;
      entry.error = e && e.message ? e.message : 'connector threw';
    }
    report.actions.push(entry);
  }
  report.ok = report.actions.every((x) => x.ok || x.skipped);
  return report;
}

// Build the payload handed to a connector. Carries tokenRef (a vault key name), NOT a secret. The
// message text is rendered here so connectors stay dumb transports.
function buildPayload(action, event) {
  const type = str(action.type);
  const base = { type, event };
  if (type === 'post-to-discord') {
    return { ...base, tokenRef: str(action.tokenRef), channelId: str(action.channelId), text: renderTemplate(action.template, event) };
  }
  if (type === 'post-to-telegram') {
    return { ...base, tokenRef: str(action.tokenRef), chatId: str(action.chatId), text: renderTemplate(action.template, event), parseMode: str(action.parseMode) || undefined };
  }
  if (type === 'play-animation') {
    return { ...base, animation: str(action.animation), durationMs: num(action.durationMs) || 3000 };
  }
  if (type === 'cross-post') {
    return { ...base, targets: Array.isArray(action.targets) ? action.targets.map(str) : [], text: renderTemplate(action.template, event) };
  }
  return base;
}

// Never let a resolved secret leak into a report, even if a connector echoes one back.
function redact(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  const clone = Array.isArray(obj) ? [] : {};
  for (const [k, val] of Object.entries(obj)) {
    if (/token|secret|wif|password|auth/i.test(k) && k !== 'tokenRef') { clone[k] = '[redacted]'; continue; }
    clone[k] = (val && typeof val === 'object') ? redact(val) : val;
  }
  return clone;
}

// ── demo (no network) ───────────────────────────────────────────────────────────────────────────
const isMain = (() => { try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; } })();
if (isMain) {
  const recipe = {
    id: 'demo-1', name: 'Big donation → animate + announce', enabled: true,
    trigger: { type: 'donation', conditions: [{ field: 'amount', op: 'gte', value: 10 }] },
    actions: [
      { type: 'play-animation', animation: 'confetti', durationMs: 4000 },
      { type: 'post-to-discord', tokenRef: 'creator42-discord', channelId: '123', template: '💸 {{from}} donated {{amount}} {{currency}}! "{{message}}"' },
    ],
  };
  const event = { type: 'donation', amount: 25, currency: 'USD', from: 'alice', message: 'love the show' };
  process.stdout.write('validate: ' + JSON.stringify(validateRecipe(recipe)) + '\n');
  process.stdout.write('dry-run: ' + JSON.stringify(await runRecipe(recipe, event, { dryRun: true }), null, 2) + '\n');
}
