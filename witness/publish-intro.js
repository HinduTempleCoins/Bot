/**
 * publish-intro.js — broadcast Hathor's Phase 1 introduction post.
 *
 * Reads the markdown body from witness/intro-post.md (stripping the
 * leading frontmatter block), then calls Hathor#introductionPost to
 * broadcast it as a comment op signed by HATHOR_POSTING_KEY.
 *
 * Run once per Witness lifetime, after the on-chain account exists and
 * the witness record has been registered (see OPERATOR.md §6, §7).
 *
 *   node witness/publish-intro.js
 *
 * Dry-run mode prints the post body and exits without broadcasting:
 *
 *   node witness/publish-intro.js --dry-run
 *
 * Key-safety: this script never reads, returns, or logs the active or
 * posting key strings. If broadcast fails because no key is loaded, the
 * error from the adapter says only that the key is not configured —
 * not what was attempted with it.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hathor } from './hathor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INTRO_PATH = path.join(__dirname, 'intro-post.md');
const PERMLINK = 'introducing-hathor-on-melek';
const TITLE = 'Hathor on MELEK — an introduction';

function extractBody(raw) {
  // intro-post.md starts with a frontmatter block ended by a single line `---`.
  // Take everything after the first `---` line as the publishable body.
  const parts = raw.split(/^---$/m);
  if (parts.length < 2) return raw.trim();
  return parts.slice(1).join('---').trim();
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const raw = fs.readFileSync(INTRO_PATH, 'utf8');
  const body = extractBody(raw);

  if (dryRun) {
    console.log('--- DRY RUN: post body that would be broadcast ---');
    console.log(`title: ${TITLE}`);
    console.log(`permlink: ${PERMLINK}`);
    console.log('');
    console.log(body);
    console.log('');
    console.log('--- end of body. No broadcast performed. ---');
    return;
  }

  const hathor = new Hathor();
  const status = hathor.status();
  if (!status.readyToConnect) {
    console.error(`cannot broadcast: missing env vars: ${status.missingConfig.join(', ')}`);
    process.exit(1);
  }
  if (!status.postingKeyLoaded) {
    console.error('cannot broadcast: HATHOR_POSTING_KEY not configured');
    process.exit(1);
  }

  console.log(`publishing intro post as @${status.account}...`);
  const result = await hathor.introductionPost({
    permlink: PERMLINK,
    title: TITLE,
    body,
  });
  console.log(`broadcast id: ${result.id ?? '(no id returned)'}`);
}

main().catch((err) => {
  console.error(`publish-intro failed: ${err.message}`);
  process.exit(1);
});
