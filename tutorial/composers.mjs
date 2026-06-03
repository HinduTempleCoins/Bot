/**
 * composers.mjs — deterministic, pure welcome/lesson-post composer (task #43).
 *
 * Where `composer.js` produces the per-stage REPLY the Witness leaves when a
 * user *completes* a stage (Phase-2 reply text + upvote/transfer payload), this
 * module produces the LESSON / WELCOME post body that describes a stage to a
 * user who is about to attempt it: "here is the next door, here is why it
 * matters, here is what done looks like."
 *
 * It is a pure function of stage data alone — no chain reads, no randomness, no
 * clock, no secrets. The same stage object always yields byte-identical output,
 * which keeps the tutorial reproducible and lets tests pin exact strings.
 *
 * Phase 3 will replace the prose body with Angelic-register LLM generation
 * (CHARACTER.md §2); this module is the deterministic stand-in and remains the
 * fallback when the corpus/LLM are unavailable. The *structure* it emits
 * (heading, why, what-counts, reward, tier note) is the contract Phase 3 fills.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAGES_PATH = path.join(__dirname, 'stages.json');

/** Load stages.json read-only. Pure relative to the file on disk. */
export function loadStagesDoc() {
  return JSON.parse(readFileSync(STAGES_PATH, 'utf8'));
}

const TIER_NOTE = {
  A: 'This works on MELEK today — standard Graphene, nothing extra needed.',
  B: 'This stage is a placeholder: it unlocks once the underlying feature is built on MELEK. You can read ahead, but you cannot complete it yet.',
  C: 'This is part of the conversational arc — it opens in Phase 3, when the Witness greets you as a person, not a checklist.',
};

/**
 * Describe, in one deterministic sentence, what "completing" a stage looks
 * like, derived from completion_criteria. Pure switch over the documented
 * `kind` values; unknown kinds get a safe generic line.
 */
export function describeCompletion(criteria) {
  if (!criteria || typeof criteria !== 'object') return 'Complete the action for this stage.';
  const c = criteria;
  switch (c.kind) {
    case 'post_authored':
      return `Publish a post${c.min_body_chars ? ` of at least ${c.min_body_chars} characters` : ''}${
        c.tag_any_of ? ` tagged ${c.tag_any_of.map((t) => `#${t}`).join(' or ')}` : ''
      }.`;
    case 'comments_authored':
      return `Leave ${c.min_count ?? 1} substantive comment(s)${
        c.min_distinct_parent_authors ? ` across ${c.min_distinct_parent_authors} different authors` : ''
      }${c.min_body_chars_each ? `, each at least ${c.min_body_chars_each} characters` : ''}.`;
    case 'external_upvote_received':
      return 'Receive an upvote from someone other than the Witness.';
    case 'transfer_to_vesting':
      return `Power up at least ${c.min_amount_melek ?? '1.000'} MELEK to MELEK Power.`;
    case 'witness_vote_cast':
      return `Cast at least ${c.min_count ?? 1} witness vote.`;
    case 'profile_set':
      return `Set your profile (${(c.require_fields_any_of ?? ['name']).join(', ')}).`;
    case 'follows_created':
      return `Follow at least ${c.min_distinct_followed ?? 3} different accounts.`;
    case 'transfer_sent':
      return `Send a transfer of at least ${c.min_amount_melek ?? '0.001'} MELEK to another account.`;
    case 'vesting_delegation_made':
      return `Delegate at least ${c.min_amount_mp ?? '1.000'} MP to another account.`;
    case 'conversation_with_witness':
      return `Have a real conversation with the Witness (at least ${c.min_turns ?? 3} turns).`;
    case 'welcomed_a_newcomer':
      return 'Welcome a newer user the way you were welcomed.';
    default:
      return `Complete the "${c.kind}" action for this stage.`;
  }
}

/** Reward line derived from witness_response. Pure. */
function describeReward(wr) {
  if (!wr || typeof wr !== 'object') return '';
  if (wr.action === 'comment_and_transfer' && wr.transfer_amount_melek) {
    return `Reward: a note from the Witness and ${wr.transfer_amount_melek} MELEK.`;
  }
  if (wr.action === 'comment_and_upvote') {
    return 'Reward: a note from the Witness and an upvote on your work.';
  }
  return '';
}

/**
 * composeLessonPost(stage) -> { title, body }
 *
 * Pure. Given a single stage object (the shape in stages.json), produce the
 * deterministic welcome/lesson post text introducing that stage.
 */
export function composeLessonPost(stage) {
  if (!stage || typeof stage !== 'object') {
    throw new Error('composeLessonPost: stage object required');
  }
  const tier = stage.tier ?? 'A';
  const title = `Stage ${stage.id}: ${stage.label ?? stage.key}`;

  const lines = [];
  lines.push(`## ${title}`);
  lines.push('');
  if (stage.description) {
    lines.push(stage.description);
    lines.push('');
  }
  lines.push('**What counts:** ' + describeCompletion(stage.completion_criteria));

  const reward = describeReward(stage.witness_response);
  if (reward) lines.push('');
  if (reward) lines.push('**' + reward.replace(/:.*/, ':') + '**' + reward.slice(reward.indexOf(':') + 1));

  lines.push('');
  lines.push('_' + (TIER_NOTE[tier] ?? TIER_NOTE.A) + '_');

  if (stage.tier === 'B' && stage.infra_dependency) {
    lines.push('');
    lines.push(`_Waiting on: ${stage.infra_dependency}._`);
  }

  if (stage.next_stage === null || stage.next_stage === undefined) {
    lines.push('');
    lines.push('_This is the last stage. After this, the conversation just continues — as peers._');
  }

  return { title, body: lines.join('\n') };
}

/**
 * composeLessonPostByKey(key, [stagesDoc]) — convenience that looks the stage
 * up by key from stages.json (or a supplied doc) and composes its lesson post.
 */
export function composeLessonPostByKey(key, stagesDoc) {
  const doc = stagesDoc ?? loadStagesDoc();
  const stage = doc.stages.find((s) => s.key === key);
  if (!stage) throw new Error(`composeLessonPostByKey: unknown stage key ${key}`);
  return composeLessonPost(stage);
}
