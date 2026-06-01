// publish-feed.mjs — delivers the SANITIZED trade feed to where the annal/brief AIs read it.
// READ-ONLY w.r.t. the chain; the only thing it writes is our own already-sanitized artifact.
//
// The boundary rule (trade-sanitizer.mjs) says the external API AIs may read ONLY the sanitized
// copy. This step moves that copy from .local/shared/ into the brain's shared inbox so the AIs
// pick it up on their cadence. It re-runs the leak-check before sending and REFUSES to deliver
// if any secret shape survived — defense in depth on top of the sanitizer.
//
//   node integrations/publish-feed.mjs            # stage to local outbox (+ rsync if SSH ok)
//   node integrations/publish-feed.mjs --local    # stage only, never touch the remote
//
// Remote target (optional, env-overridable):
//   BRAIN_SSH   = melek-4                               (ssh host alias; empty = local-only)
//   BRAIN_INBOX = /var/melek-bot/brain/shared/trade     (dir on the brain host)

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SRC_MD = '.local/shared/trade-brief-feed.md';
const SRC_JSON = '.local/shared/trade-brief-feed.json';
const OUTBOX = '.local/outbox';                       // staged, ready-to-ship copies
const BRAIN_SSH = (process.env.BRAIN_SSH || '').trim();   // empty => local-only by default
const BRAIN_INBOX = (process.env.BRAIN_INBOX || '/var/melek-bot/brain/shared/trade').trim();
const localOnly = process.argv.includes('--local') || !BRAIN_SSH;

// the same secret shapes the sanitizer guards against — last line of defense
const SECRET_SHAPES = [
  /5[HJK][1-9A-HJ-NP-Za-km-z]{49}/,                 // WIF private key
  /\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/, // bot-token shape
  /AIza[0-9A-Za-z_-]{35}/,                          // google key
];

if (!existsSync(SRC_MD)) {
  console.error(`No ${SRC_MD}. Run: node integrations/trade-sanitizer.mjs first.`);
  process.exit(1);
}

const md = readFileSync(SRC_MD, 'utf8');
const leak = SECRET_SHAPES.find(re => re.test(md));
if (leak) {
  console.error('❌ REFUSING TO PUBLISH: a secret shape survived into the sanitized feed.');
  console.error('   The sanitizer boundary failed — fix that before any delivery.');
  process.exit(2);
}

// stage to the local outbox (always)
mkdirSync(OUTBOX, { recursive: true });
copyFileSync(SRC_MD, `${OUTBOX}/trade-brief-feed.md`);
if (existsSync(SRC_JSON)) copyFileSync(SRC_JSON, `${OUTBOX}/trade-brief-feed.json`);
// a tiny manifest so the brain can tell freshness without parsing the body
writeFileSync(`${OUTBOX}/manifest.json`, JSON.stringify({ file: 'trade-brief-feed.md', bytes: md.length, boundary: 'clean' }, null, 2));
console.log(`✅ boundary clean — staged to ${OUTBOX}/`);

if (localOnly) {
  console.log(BRAIN_SSH ? '(--local: not touching the remote)' : '(BRAIN_SSH unset: local-only. Set BRAIN_SSH + BRAIN_INBOX to deliver to the brain.)');
  process.exit(0);
}

// deliver to the brain host (best-effort; never throws the run)
try {
  execFileSync('ssh', [BRAIN_SSH, `mkdir -p ${BRAIN_INBOX}`], { stdio: 'ignore', timeout: 20000 });
  execFileSync('scp', ['-q', `${OUTBOX}/trade-brief-feed.md`, `${OUTBOX}/manifest.json`, `${BRAIN_SSH}:${BRAIN_INBOX}/`], { stdio: 'ignore', timeout: 30000 });
  if (existsSync(`${OUTBOX}/trade-brief-feed.json`)) execFileSync('scp', ['-q', `${OUTBOX}/trade-brief-feed.json`, `${BRAIN_SSH}:${BRAIN_INBOX}/`], { stdio: 'ignore', timeout: 30000 });
  console.log(`✅ delivered to ${BRAIN_SSH}:${BRAIN_INBOX}/ (annal/brief AIs read from here)`);
} catch (e) {
  console.log(`⚠ remote delivery skipped (${e.message.split('\n')[0]}). Staged copy is in ${OUTBOX}/ — deliver later.`);
}
