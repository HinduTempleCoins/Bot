// indie-mint.mjs — how an indie game gets its items minted on Botanica.
//
// THE MODEL. An indie developer should not have to build a token system, a supply policy, an economy
// or a player base. They should be able to say "my game needs a Brass Sextant, here is roughly what
// one is worth in materials," and then have Botanica's players actually make them.
//
// So a game does not mint. A game REGISTERS a want. Botanica players craft it out of real materials
// through a real station, and the crafting is the mint — the same rule as everywhere else in this
// economy: crafting is the only mint, and every craft both creates and destroys.
//
// That is the difference between this and every "NFTs for games" platform: the item is not conjured
// for a fee and dropped into a wallet. Somebody grew the flax, somebody spun the rope, somebody
// stood at the forge. The indie game gets an item with a supply chain behind it, and the Botanica
// economy gets a new sink for its materials.
//
//   material-demand.mjs  — what games CONSUME (demand, and therefore versatility)
//   botanica-registry.mjs— what EXISTS (the canonical catalog)
//   item-nft.mjs         — how many may exist (the shared cap, and provenance)
//   THIS MODULE          — how a game adds something new to be made
//
// PURE + deterministic: no network, no clock, no keys, no minting. Registration returns a decision;
// the mint itself is a Signer-broadcast op far outside this file. Soft-fail-never-throw — a bad
// submission comes back as { ok:false, reason } with the specific defect named.
//
// ── Exports ──────────────────────────────────────────────────────────────────────────────────────
//   STATIONS_OPEN, MAX_INPUTS, MIN_INPUT_KINDS
//   emptyBook() / submitItem(book, submission, reg) / listByGame(book, game) / listAll(book)
//   reviewSubmission(submission, reg, book)  -> { ok, reason?, detail? }
//   recipeFor(book, itemId) / registryWith(reg, book)

import { buildRegistry, itemsById } from './botanica-registry.mjs';

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const id = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// A submitted item must be made at a station that already exists. A game does not get to invent
// infrastructure — it gets to use the workshops Botanica already has, which is what keeps the new
// item inside the existing economy instead of beside it.
export const STATIONS_OPEN = true;

export const MAX_INPUTS = 6;        // a recipe nobody can assemble is not a recipe
export const MIN_INPUT_KINDS = 2;   // one input is a rename, not a production chain

export const emptyBook = () => ({ items: [] });

/**
 * reviewSubmission — the whole gate, stated as checks rather than judgement.
 *
 * submission = { game, item, name, station, effort?, inputs:[{item,qty}], cap?, note? }
 */
export function reviewSubmission(submission, reg, book = emptyBook()) {
  const s = submission || {};
  const game = String(s.game || '').trim();
  const item = id(s.item);
  if (!game) return { ok: false, reason: 'no_game' };
  if (!item) return { ok: false, reason: 'no_item_id' };

  const registry = reg || buildRegistry();
  const known = itemsById(registry);

  // 1. It must be new. Colliding with an existing item would let a game redefine the economy's
  //    vocabulary underneath everyone else.
  if (known[item]) return { ok: false, reason: 'item_exists', detail: item };
  if ((book.items || []).some((r) => r.item === item)) return { ok: false, reason: 'already_registered', detail: item };

  // 2. It must be made somewhere real.
  const station = id(s.station);
  if (!station) return { ok: false, reason: 'no_station' };
  if (!registry.stations.includes(station)) {
    return { ok: false, reason: 'unknown_station', detail: station, known: registry.stations };
  }

  // 3. Its inputs must already exist and be obtainable. This is the load-bearing check: it is what
  //    forces a new item to consume the farm economy rather than appear from nothing.
  const inputs = (Array.isArray(s.inputs) ? s.inputs : [])
    .map((i) => ({ item: id(i && i.item), qty: Math.max(1, Math.trunc(num(i && i.qty, 1))) }))
    .filter((i) => i.item);
  if (!inputs.length) return { ok: false, reason: 'no_inputs' };
  if (inputs.length > MAX_INPUTS) return { ok: false, reason: 'too_many_inputs', detail: inputs.length };

  // Duplicates are checked first: listing the same input twice is a distinct defect from asking for
  // too few kinds, and reporting the specific one is more useful to whoever is fixing the submission.
  const distinct = new Set(inputs.map((i) => i.item));
  if (distinct.size !== inputs.length) return { ok: false, reason: 'duplicate_inputs' };
  if (distinct.size < MIN_INPUT_KINDS) {
    return { ok: false, reason: 'too_few_input_kinds', detail: distinct.size };
  }

  const unknown = inputs.filter((i) => !known[i.item]).map((i) => i.item);
  if (unknown.length) return { ok: false, reason: 'unknown_inputs', detail: unknown };

  // 4. It must not be a money pump. If the new item can be fed back into a recipe that reproduces
  //    its own inputs, the graph inflates. Crafting has to consume more than it returns.
  const pump = inputs.filter((i) => {
    const back = registry.recipes.filter((r) => r.output.item === i.item);
    return back.some((r) => r.inputs.some((bi) => bi.item === item));
  });
  if (pump.length) return { ok: false, reason: 'money_pump', detail: pump.map((p) => p.item) };

  // 5. Supply must be finite and sane. Unbounded supply is how a game's item becomes worthless and
  //    takes the materials market with it.
  const cap = Math.trunc(num(s.cap, 0));
  if (cap <= 0) return { ok: false, reason: 'no_cap' };
  if (cap > 1000000) return { ok: false, reason: 'cap_too_large', detail: cap };

  return { ok: true };
}

/** submitItem — review, then record. Returns the new book; never mutates the one passed in. */
export function submitItem(book, submission, reg) {
  const b = book && Array.isArray(book.items) ? book : emptyBook();
  const registry = reg || buildRegistry();
  const verdict = reviewSubmission(submission, registry, b);
  if (!verdict.ok) return { ok: false, reason: verdict.reason, detail: verdict.detail, book: b };

  const s = submission;
  const entry = {
    item: id(s.item),
    name: String(s.name || '').trim() || id(s.item).replace(/_/g, ' '),
    game: String(s.game).trim(),
    station: id(s.station),
    effort: Math.max(0, Math.trunc(num(s.effort, 1))),
    inputs: s.inputs.map((i) => ({ item: id(i.item), qty: Math.max(1, Math.trunc(num(i.qty, 1))) })),
    cap: Math.trunc(num(s.cap, 0)),
    note: String(s.note || '').slice(0, 300),
  };
  return { ok: true, entry, book: { ...b, items: b.items.concat([entry]) } };
}

export const listAll = (book) => ((book && book.items) || []).slice();
export const listByGame = (book, game) =>
  ((book && book.items) || []).filter((r) => r.game === String(game || '').trim());

/** The recipe a registered item is made by — the shape the rest of the economy already speaks. */
export function recipeFor(book, itemId) {
  const e = ((book && book.items) || []).find((r) => r.item === id(itemId));
  if (!e) return null;
  return {
    id: `indie-${e.item}`,
    inputs: e.inputs.slice(),
    output: { item: e.item, qty: 1 },
    station: e.station,
    effort: e.effort,
    source: `indie:${e.game}`,
  };
}

/**
 * registryWith — the canonical registry plus everything indie games have registered, so a client
 * that renders the economy sees one world rather than a core and a bolt-on.
 */
export function registryWith(reg, book) {
  const base = reg || buildRegistry();
  const entries = listAll(book);
  const items = base.items.concat(entries.map((e) => ({
    id: e.item, name: e.name, kind: 'good', domains: ['indie'], sources: [`indie:${e.game}`],
  })));
  const recipes = base.recipes.concat(entries.map((e) => recipeFor(book, e.item)).filter(Boolean));
  const stations = [...new Set(recipes.map((r) => r.station))].sort();
  return { ...base, items, recipes, stations };
}

export default {
  STATIONS_OPEN, MAX_INPUTS, MIN_INPUT_KINDS,
  emptyBook, submitItem, reviewSubmission, listAll, listByGame, recipeFor, registryWith, esc,
};
