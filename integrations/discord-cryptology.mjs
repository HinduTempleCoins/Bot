// discord-cryptology.mjs — connects the Discord bot to the Crypt-ology map.
//
// hathor-discord.mjs only SHAPES voice; it never reads or writes the per-person map. This connector is
// the bridge, built on the SAME pattern hathor-agency.mjs already uses for every surface (cryptology.mjs
// §6a: the map was ported FROM the original Discord relationship tracker, so Discord is its home turf):
//
//   • greet(user)        → recall who this Discord user IS to Hathor (disposition + interests) and shape
//                           a greeting that reflects WHERE THEY ARE on the map (positions, not levels).
//   • observe(user,text) → record the interaction, moving their position (cryptology.observe).
//
// The MELEK account is the key, so the same person is the same on Discord, the condenser and Telegram
// (unified-identity). Everything is injectable so `node --test` runs offline; soft-fail, never throws.

import { dispositionGreeting, shapeReply } from './hathor-discord.mjs';
import * as crypt from '../cryptology/cryptology.mjs';
import { normMelek } from './unified-identity.mjs';

// Map a Discord message to a Crypt-ology EVENT key — the same mapping hathor-agency.mjs uses, plus a
// plain-greeting case (Discord opens with a lot of "hi Hathor").
export function classifyDiscordEvent(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(thank|thanks|ty|appreciate|grateful)\b/.test(t)) return 'thanked';
  if (/\b(fuck|idiot|stupid|hate you|shut up|worthless)\b/.test(t)) return 'hostile';
  if (/\b(sorry|apolog|my bad)\b/.test(t)) return 'apologized';
  if (/\b(i (tipped|gave|donated|contributed|helped))\b/.test(t)) return 'gave';
  if (/\b(how|why|what|explain|teach)\b/.test(t) || t.includes('?')) return 'deep_question';
  if (/\b(i (feel|felt|experienced|went through)|my story|happened to me)\b/.test(t)) return 'shared_story';
  if (/^\s*(hi|hello|hey|yo|gm|greetings|peace)\b/.test(t)) return 'greeted';
  return 'warm_exchange';
}

// The Witness's stance → which greeting register, and a seed that drifts with familiarity so a returning
// seeker is not greeted with the identical line each time.
function contextForStance(stance) {
  switch (stance) {
    case 'kindred': case 'warm': case 'familiar': return 'trust';
    case 'deferential': return 'library';
    case 'welcoming': return 'signup';
    default: return 'open'; // guarded / open
  }
}

/** Resolve a Discord user (a linked MELEK handle, or a raw handle) to a valid MELEK account key, or null. */
export function resolveAccount(user) {
  const acct = normMelek(typeof user === 'string' ? user : (user && (user.melek || user.account || user.handle || user.username)) || '');
  return crypt.isValidAccount(acct) ? crypt.accountKey(acct) : null;
}

/**
 * Build the connector. `cryptology` and `file` are injectable for tests; defaults use the real map.
 * @returns {{ greet, observe, dispositionFor, resolveAccount }}
 */
export function connectDiscordCryptology({ cryptology = crypt, file } = {}) {
  const load = () => { try { return file ? cryptology.loadStore(file) : cryptology.loadStore(); } catch { return {}; } };

  function dispositionFor(user) {
    const account = resolveAccount(user);
    if (!account) return null;
    try {
      const profile = cryptology.recall(account, load());
      if (!profile) return null;
      return {
        account,
        disposition: cryptology.dispositionOf ? cryptology.dispositionOf(profile) : null,
        topics: cryptology.suggestTopics ? cryptology.suggestTopics(profile) : [],
        interactions: profile.totalInteractions || 0,
      };
    } catch { return null; }
  }

  /** A greeting that reflects where this person stands on the map. Falls back to a fresh open greeting. */
  function greet(user, { seed } = {}) {
    const d = dispositionFor(user);
    const stance = d && d.disposition ? d.disposition.stance : null;
    const name = typeof user === 'string' ? user : (user && (user.name || user.username || user.handle)) || undefined;
    return dispositionGreeting({
      user: name,
      context: contextForStance(stance),
      seed: seed != null ? seed : (d ? d.interactions : 0),
    });
  }

  /** Record a Discord interaction, moving the person's position. Returns the updated disposition (or null). */
  function observe(user, text, { topics, now } = {}) {
    const account = resolveAccount(user);
    if (!account) return null;
    try {
      const opts = { surface: 'discord', context: String(text || '').slice(0, 120) };
      if (topics && typeof topics === 'object') opts.interests = topics;
      if (file) opts.file = file;
      const profile = cryptology.observe(account, classifyDiscordEvent(text), opts);
      return cryptology.dispositionOf ? cryptology.dispositionOf(profile) : profile;
    } catch { return null; }
  }

  return { greet, observe, dispositionFor, resolveAccount, shapeReply };
}

export default { connectDiscordCryptology, classifyDiscordEvent, resolveAccount };
