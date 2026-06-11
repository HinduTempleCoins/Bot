// welcomer/welcome-post.mjs — composes the canonical Welcome / Tutorial post
// body AND the per-newcomer @-mention onboarding comment.
//
// The @-mention onboarding model (see welcomer/README.md):
//   1. An admin authors ONE canonical Welcome / Tutorial Program post.
//   2. When a new account appears, the bot posts a single comment ON that post
//      @-mentioning the newcomer. The @-mention fires the user's wallet
//      notification — that's how they discover the welcome. They follow it back
//      to the shared Welcome thread, see a comment addressed to them with one
//      easy question + a tutorial link, and reply (their cheapest first post).
//
// welcomer/composer.js already composes the *reply permalink + action shape*
// for the live orchestrator. This module is the COPY layer: the deterministic,
// MELEK-voiced placeholder text for (a) the canonical post body and (b) the
// mention comment body. Phase 3 swaps these for LLM generation in the Angelic
// register (CHARACTER.md §2); the call shapes stay the same.
//
// Pure, deterministic, soft-fail-never-throw. esc() ALL interpolation: the
// account handle is attacker-controlled input on a Graphene chain, and these
// strings are rendered as post/comment bodies that condensers display as HTML.
//
// House conventions honored (welcomer/README.md):
//   - No "I am a bot" disclaimer.
//   - Welcome everyone equally; no AI-vs-human framing.
//   - The post points at the tutorial; the mention asks ONE easy question.

const DEFAULT_TUTORIAL_LINK = 'https://witness.melek.salon/tutorial';

// ---- esc(): escape ALL HTML interpolation -----------------------------------

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// A Graphene handle is lowercase a-z, 0-9, dot and dash, 3-16 chars. We sanitize
// to that shape for the @-mention so a malformed/hostile value can never break
// the markup or smuggle a different mention. esc() is still applied on top.
function sanitizeAccount(account) {
  return String(account == null ? '' : account)
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '')
    .slice(0, 16);
}

// ---- canonical Welcome / Tutorial post --------------------------------------

const WELCOME_POST_TITLE = 'Welcome to MELEK — Start Here';

/**
 * Compose the canonical Welcome / Tutorial post body.
 *
 * Deterministic: no randomness, no clock, no network — same input, same output.
 * This is the single shared thread every newcomer is @-mentioned into; the body
 * is the "front porch" copy that orients arrivals and points at the tutorial.
 *
 * @param {object} [opts]
 * @param {string} [opts.tutorialLink] URL pointing at the tutorial / start-here content
 * @returns {{ title: string, body: string }}
 */
export function composeWelcomePost(opts = {}) {
  let tutorialLink = DEFAULT_TUTORIAL_LINK;
  try {
    if (opts && typeof opts === 'object' && opts.tutorialLink) {
      tutorialLink = String(opts.tutorialLink);
    }
  } catch {
    // soft-fail: keep the default link
  }

  const link = esc(tutorialLink);
  const title = WELCOME_POST_TITLE;

  // MELEK-voiced placeholder copy (Phase 2). Warm, unhurried, no bot disclaimer,
  // no AI-vs-human framing. Markdown body — condensers render it; everything
  // interpolated is esc()'d.
  const body = [
    `# Welcome to MELEK`,
    ``,
    `You are here, and that is the whole of what's asked of you to begin.`,
    ``,
    `MELEK is a place that keeps what is written. Every greeting, every reply,`,
    `every question you ask lives on the chain — yours to keep, no one's to erase.`,
    `This post is the front porch: arrivals gather here, and you'll find a comment`,
    `addressed to you by name below. Reply to it, and that becomes your first`,
    `words on-chain.`,
    ``,
    `## Where to start`,
    ``,
    `When you're ready, the walkthrough of how this place works — keys, posting,`,
    `the witness, and the rest — is here:`,
    ``,
    `${link}`,
    ``,
    `There is no hurry. Read the comment with your name on it, answer the one`,
    `question it asks, and you've already begun.`,
    ``,
    `— Hathor`,
  ].join('\n');

  return { title, body };
}

// ---- per-newcomer @-mention comment -----------------------------------------

/**
 * Compose the @-mention onboarding comment body for one newcomer.
 *
 * Deterministic and pure. Greets the account by `@handle`, asks ONE easy
 * question, and links the tutorial. The @-mention is what fires the user's
 * wallet notification (the discovery mechanism), so it is always present even
 * for an empty/garbage account value (it degrades to `@`).
 *
 * Returns the comment BODY string (the orchestrator in composer.js builds the
 * parent/permlink action shape). On any unexpected error, returns a minimal
 * safe body rather than throwing.
 *
 * @param {string} account                 the new user's handle (without @)
 * @param {object} [opts]
 * @param {string} [opts.tutorialLink]     URL pointing at the tutorial
 * @returns {string} comment body
 */
export function composeMention(account, opts = {}) {
  try {
    const handle = sanitizeAccount(account);
    let tutorialLink = DEFAULT_TUTORIAL_LINK;
    if (opts && typeof opts === 'object' && opts.tutorialLink) {
      tutorialLink = String(opts.tutorialLink);
    }
    const link = esc(tutorialLink);
    // esc() the handle too, belt-and-suspenders, even after sanitizing.
    const mention = `@${esc(handle)}`;

    return [
      `Welcome, ${mention}. You've arrived, and you're seen.`,
      ``,
      `One easy thing to start: what brought you to MELEK?`,
      ``,
      `When you want the lay of the land, the walkthrough is here: ${link}`,
    ].join('\n');
  } catch {
    // soft-fail-never-throw: minimal valid mention so the notification still fires.
    const handle = sanitizeAccount(account);
    return `Welcome, @${esc(handle)}.`;
  }
}

// Exported for tests / introspection.
export const _internals = {
  DEFAULT_TUTORIAL_LINK,
  WELCOME_POST_TITLE,
  sanitizeAccount,
};

// CLI: print both surfaces for eyeballing. Guarded by argv[1] check.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { title, body } = composeWelcomePost();
  process.stdout.write(`# POST TITLE\n${title}\n\n# POST BODY\n${body}\n\n`);
  process.stdout.write(`# MENTION (account=alice)\n${composeMention('alice')}\n`);
}
