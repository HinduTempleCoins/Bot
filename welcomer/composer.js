/**
 * welcomer/composer.js — Phase-2 deterministic welcome message composer.
 *
 * One surface: a comment posted on the canonical Welcome / Tutorial Program
 * post, mentioning the new account by handle (`@<account>`). The mention
 * generates the user's wallet notification — that's how they discover the
 * welcome.
 *
 * Per the brief (single shared welcome thread, NOT per-user first-post
 * comments):
 *   - greet by handle
 *   - ask ONE specific, easy-to-answer question
 *   - point at the tutorial / getting-started content
 *   - 2-4 sentences
 *   - rotate among a small set of variants so the thread doesn't read
 *     like identical spam
 *
 * Pure function: (account, welcomePost, tutorialLink) -> { action, comment }.
 *
 * Determinism: variant picked by sha256(account + 'welcome')[0] % N.
 * Same account → same variant, every run. No need to persist the choice.
 *
 * Phase 3 replaces the templates with LLM generation in the Angelic
 * register (CHARACTER.md §2). The orchestrator's call shape stays the same.
 *
 * No "I am a bot" disclaimer per project policy (CLAUDE.md / brief): MELEK
 * does not label accounts AI-vs-human by default.
 */

import { createHash } from 'node:crypto';

// Three openers, each with a different question. All under 4 sentences,
// all include the @-mention (which is what generates the notification),
// all include the tutorial link.

const WELCOME_TEMPLATES = [
  (account, link) =>
    `Welcome, @${account}. What brought you to MELEK? ` +
    `When you're ready, the walkthrough of how this place works is here: ${link}`,

  (account, link) =>
    `@${account} — welcome. What's one thing you're working on right now? ` +
    `If you want the orientation: ${link}`,

  (account, link) =>
    `Welcome, @${account}. I'd love to know what you're hoping to find here. ` +
    `The getting-started walkthrough: ${link}`,

  (account, link) =>
    `@${account}, you're here. Tell me one thing you're curious about lately. ` +
    `The tutorial, when you want it: ${link}`,
];

function pickVariant(account, pool) {
  const h = createHash('sha256').update(`${account}::welcome`).digest();
  return pool[h[0] % pool.length];
}

/**
 * Compose the welcome comment.
 *
 * @param {object} args
 * @param {string} args.account                 the new user (without @)
 * @param {{author: string, permlink: string}} args.welcomePost the canonical Welcome thread
 * @param {string} args.tutorialLink            URL pointing at the tutorial / start-here content
 * @returns {{
 *   action: 'comment',
 *   comment: { parentAuthor: string, parentPermlink: string, body: string, permlink: string }
 * }}
 */
export function composeWelcomeMention({ account, welcomePost, tutorialLink }) {
  if (!account) throw new Error('composeWelcomeMention: account required');
  if (!welcomePost?.author || !welcomePost?.permlink) {
    throw new Error('composeWelcomeMention: welcomePost.author and welcomePost.permlink required');
  }
  if (!tutorialLink) throw new Error('composeWelcomeMention: tutorialLink required');

  const template = pickVariant(account, WELCOME_TEMPLATES);
  const body = template(account, tutorialLink);

  // Permlink for the reply. Graphene permlinks are lowercase + hyphenated,
  // max 256 chars. The (welcomePost, account) pair is unique because each
  // account is welcomed exactly once, so `welcome-${account}` suffices as
  // the unique tail.
  const permlink = `re-${welcomePost.author}-${welcomePost.permlink}-welcome-${account}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 255);

  return {
    action: 'comment',
    comment: {
      parentAuthor: welcomePost.author,
      parentPermlink: welcomePost.permlink,
      body,
      permlink,
    },
  };
}

// Exported for tests / introspection
export const _internals = {
  WELCOME_TEMPLATES,
  pickVariant,
};
