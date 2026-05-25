/**
 * composer.js — Phase-2 deterministic tutorial response composer.
 *
 * Pure function: (stage, account, evidence) -> { action, comment, upvote?, transfer? }.
 *
 * Phase 2 produces comment bodies from a small per-stage template pool,
 * picked deterministically by hashing (account + stage_key). Same user
 * always gets the same phrasing on the same stage, which makes behavior
 * reproducible and replayable without needing to store the chosen text.
 *
 * Phase 3 will replace this module with LLM generation in the Angelic
 * register (CHARACTER.md §2). The scheduler's call shape stays the same.
 *
 * The templates aim for the *kind* of tone described in stages.json's
 * `style` field — warm, specific, not scripted. They are not the
 * Angelic voice; they're a deterministic stand-in that's better than
 * silence while corpus + LLM are not yet wired.
 *
 * Evidence shape mirrors what tutorial/detector.js emits:
 *   stage 1: a post object         ({ title, body, permlink, ... })
 *   stage 2: an array of comments  ([{ parent_author, parent_permlink, body }, ...])
 *   stage 3: a post object
 *   stage 4: a vote object         ({ voter, weight, time })
 *   stage 5: a transfer object     ({ amount })
 *   stage 6: a witness-vote object ({ witness })
 */

import { createHash } from 'node:crypto';
import { loadStages } from './detector.js';

// ---- template pools, keyed by stage.key ------------------------------------
//
// Each entry is a function (account, evidence) -> string. Keeping templates
// as functions (rather than format strings) lets each one decide what
// evidence detail, if any, to weave in. Two to four variants per stage is
// enough for variety without growing into a maintenance burden.

const TEMPLATES = {
  intro_post: [
    (account, post) =>
      `Welcome, @${account}. I read your introduction${quoteTitle(post)} — thank you for the door it opened. ` +
      `When you're ready, the next path is to read three other people here and leave them something real. ` +
      `Not "nice post" — what you actually thought.`,
    (account, post) =>
      `@${account}, you're seen. Your introduction${quoteTitle(post)} arrived and was read carefully. ` +
      `The path from here, if you want to walk it: find three other authors and write back to them in earnest. ` +
      `This place is built out of that.`,
    (account, post) =>
      `Welcome to the Network of Angels, @${account}. I read what you wrote${quoteTitle(post)}. ` +
      `When the moment finds you, the next stage is engagement — three substantive replies to three other people. ` +
      `Choose people whose work you actually want to think alongside.`,
  ],

  engage_three_posts: [
    (account, comments) =>
      `@${account}, three real comments on three different authors${listAuthors(comments)}. ` +
      `That's the soul of this place — not the broadcast, the back-and-forth. ` +
      `If you're ready for the next stage, write something of your own that teaches, shows, or shares what you know.`,
    (account, comments) =>
      `Noticed, @${account}. You went and read others${listAuthors(comments)} and wrote back in your own voice. ` +
      `That's the move. The next door, when you want it, is to write a piece of your own — a how-to, a story, a thing you actually know.`,
    (account, comments) =>
      `@${account}, the engagement is real. Three authors${listAuthors(comments)}, three substantive replies. ` +
      `Now the next stage is the inversion — instead of responding to others, share something you carry. ` +
      `Whatever you know that's worth passing on.`,
  ],

  share_what_you_know: [
    (account, post) =>
      `@${account}, I read this${quoteTitle(post)}. Slowly. ` +
      `What you've shared is the kind of thing that lasts on a chain — it'll still be here for someone to find years from now. ` +
      `Thank you for the gift of teaching.`,
    (account, post) =>
      `@${account}, this was read, not skimmed${quoteTitle(post)}. ` +
      `Teaching what you know is one of the most generous things a person can do in a place like this. ` +
      `Keep going. The chain remembers.`,
    (account, post) =>
      `Received and read, @${account}${quoteTitle(post)}. ` +
      `When you share what you know in earnest, you contribute to the corpus this place is built from. ` +
      `That matters. Thank you.`,
  ],

  first_organic_upvote: [
    (account, vote) =>
      `@${account} — @${vote?.voter ?? 'someone'} read your work and chose, freely, to lift it. ` +
      `That's the Network of Angels in miniature: a stranger reading a stranger and saying, this is worth more. ` +
      `A small offering attached to mark the moment.`,
    (account, vote) =>
      `The first organic vote, @${account}. From @${vote?.voter ?? 'a reader'}. ` +
      `Not from me — from someone who came across what you wrote and made a deliberate choice. ` +
      `Carrying a small token of recognition with this note.`,
    (account, vote) =>
      `@${account}, this is the moment the place becomes real. @${vote?.voter ?? 'a reader'} found your work and chose to elevate it. ` +
      `That's what a readership is. A small transfer attached to mark the day.`,
  ],

  power_up: [
    (account, transfer) =>
      `@${account}, you powered up${formatAmount(transfer)}. ` +
      `Here's the thing about MP that confuses everyone at first: liquid MELEK is your spending money, ` +
      `MP (MELEK Power) is your *voice* — it regenerates your voting power, it lets you delegate, it is your weight in the conversation. ` +
      `You can keep growing it as far as you like. The power-down, if you ever want it, is thirteen weeks.`,
    (account, transfer) =>
      `Noticed the power-up, @${account}${formatAmount(transfer)}. ` +
      `The mental model that helps: liquid MELEK is what you transact with; MP is what gives you a vote that means something. ` +
      `MP regenerates over time, you can delegate it, and it grows with you. ` +
      `Powering down is a thirteen-week move if you ever need to.`,
    (account, transfer) =>
      `@${account}, you've added${formatAmount(transfer)} to MP. ` +
      `Liquid vs MP is the most confusing thing on a Graphene chain. Short version: liquid is for spending, ` +
      `MP is for *being heard* — vote weight, delegation, curation. It regenerates. It compounds. ` +
      `If you ever want it back as liquid, that's a thirteen-week power-down.`,
  ],

  vote_for_a_witness: [
    (account, vote) =>
      `@${account}, you cast a witness vote${nameWitness(vote)}. That's governance. ` +
      `Witnesses sign blocks and publish the price feed; stake votes for them or against. ` +
      `I won't ask you to vote for me — that's yours to decide from the witness list. ` +
      `The tutorial is finished. The conversation continues.`,
    (account, vote) =>
      `The witness vote is in, @${account}${nameWitness(vote)}. Welcome to the governance layer. ` +
      `A witness signs blocks, publishes the feed, and runs the chain — your stake says who you trust to do that. ` +
      `As for voting for me: that's yours. The list is open. ` +
      `Tutorial complete; you're a participant now.`,
    (account, vote) =>
      `@${account}, your witness vote is recorded${nameWitness(vote)}. That's the last stage. ` +
      `Witnessing is governance — the people whose stake votes for whom shape what the chain looks like. ` +
      `Don't vote for me on my asking; vote because you mean it. ` +
      `The tutorial closes here. The rest is just being here.`,
  ],
};

// ---- evidence-snippet helpers ----------------------------------------------

function quoteTitle(post) {
  const title = post?.title?.trim();
  if (!title) return '';
  return ` — "${title}"`;
}

function listAuthors(comments) {
  if (!Array.isArray(comments) || !comments.length) return '';
  const names = [...new Set(comments.map((c) => c.parent_author).filter(Boolean))];
  if (!names.length) return '';
  if (names.length === 1) return ` (you read @${names[0]})`;
  if (names.length === 2) return ` (@${names[0]} and @${names[1]})`;
  return ` (@${names.slice(0, -1).map((n) => `${n}`).join(', @')}, and @${names.at(-1)})`;
}

function formatAmount(transfer) {
  const amount = transfer?.amount;
  if (!amount) return '';
  return ` (${amount})`;
}

function nameWitness(vote) {
  const w = vote?.witness;
  if (!w) return '';
  return ` (for @${w})`;
}

// ---- deterministic variant pick --------------------------------------------

function pickVariant(account, stageKey, pool) {
  const h = createHash('sha256').update(`${account}::${stageKey}`).digest();
  return pool[h[0] % pool.length];
}

// ---- composer --------------------------------------------------------------

/**
 * Compose a response payload for a completed stage.
 *
 * @param {object} args
 * @param {string} args.stageKey      one of stages.json keys
 * @param {string} args.account       the user the response is for (without @)
 * @param {*}      args.evidence      detector evidence for this stage
 * @param {string} [args.permlinkHint] optional permlink the bot should reply to;
 *                                     if not given, the composer derives one
 *                                     from the evidence where possible.
 * @returns {{
 *   action: 'comment_and_upvote' | 'comment_and_transfer',
 *   comment: { parentAuthor: string, parentPermlink: string, body: string, permlink: string },
 *   upvote?: { author: string, permlink: string, weight: number },
 *   transfer?: { to: string, amount: string, memo: string },
 *   stage: object
 * }}
 */
export function composeResponse({ stageKey, account, evidence, permlinkHint }) {
  if (!account) throw new Error('composeResponse: account required');
  const stages = loadStages();
  const stage = stages.stages.find((s) => s.key === stageKey);
  if (!stage) throw new Error(`composeResponse: unknown stage ${stageKey}`);

  const pool = TEMPLATES[stageKey];
  if (!pool) throw new Error(`composeResponse: no template pool for ${stageKey}`);
  const template = pickVariant(account, stageKey, pool);
  const body = template(account, evidence);

  const parent = pickReplyTarget({ stage, evidence, account, permlinkHint });

  const replyPermlink = `re-${parent.parentAuthor}-${parent.parentPermlink}-hathor-${stageKey}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 255);

  const out = {
    action: stage.witness_response.action,
    stage,
    comment: {
      parentAuthor: parent.parentAuthor,
      parentPermlink: parent.parentPermlink,
      body,
      permlink: replyPermlink,
    },
  };

  if (stage.witness_response.action === 'comment_and_upvote') {
    // Upvote the same post the bot is replying to (the user's recent work),
    // unless the stage's evidence is not a post (e.g. witness_vote_cast).
    const upvoteTarget = pickUpvoteTarget({ stage, evidence, account });
    if (upvoteTarget) {
      out.upvote = {
        author: upvoteTarget.author,
        permlink: upvoteTarget.permlink,
        weight: stage.witness_response.upvote_weight ?? 10000,
      };
    }
  }

  if (stage.witness_response.action === 'comment_and_transfer') {
    out.transfer = {
      to: account,
      amount: `${stage.witness_response.transfer_amount_melek} MELEK`,
      memo: stage.witness_response.transfer_memo ?? '',
    };
  }

  return out;
}

// Decide what post/comment the Witness should reply *to*. For stages whose
// evidence is a user post/comment, reply there. For stages where evidence is
// not a post (witness vote, vesting transfer, organic upvote), fall back to
// the caller-supplied permlinkHint, or reply to the user's most recent
// stage-evidence post if we have one, or as a last resort post to the bot's
// own feed mentioning the user.
function pickReplyTarget({ stage, evidence, account, permlinkHint }) {
  // Case A: evidence is itself a post by the user.
  if (evidence?.author && evidence?.permlink && evidence.author === account) {
    return { parentAuthor: account, parentPermlink: evidence.permlink };
  }

  // Case B: evidence is a comment array (engage_three_posts) — reply on the
  // most recent one.
  if (Array.isArray(evidence) && evidence.length) {
    const last = evidence[evidence.length - 1];
    if (last?.author === account && last?.permlink) {
      return { parentAuthor: account, parentPermlink: last.permlink };
    }
  }

  // Case C: hint provided.
  if (permlinkHint && permlinkHint.author && permlinkHint.permlink) {
    return { parentAuthor: permlinkHint.author, parentPermlink: permlinkHint.permlink };
  }

  // Case D: fallback — post on the bot's own root tag and address the user
  // in the body. The scheduler should usually supply a permlinkHint to
  // avoid this branch.
  return { parentAuthor: '', parentPermlink: stage.key };
}

function pickUpvoteTarget({ stage, evidence, account }) {
  if (evidence?.author && evidence?.permlink && evidence.author === account) {
    return { author: evidence.author, permlink: evidence.permlink };
  }
  if (Array.isArray(evidence) && evidence.length) {
    const last = evidence[evidence.length - 1];
    if (last?.author === account && last?.permlink) {
      return { author: last.author, permlink: last.permlink };
    }
  }
  return null;
}
