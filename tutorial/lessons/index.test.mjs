/**
 * index.test.mjs — OFFLINE tests for the tutorial lesson catalog (#44).
 *
 * No network, no chain reads — only the local catalog + markdown files. Run with:
 *   node --test tutorial/lessons/index.test.mjs
 *
 * The catalog is organized into four tracks:
 *   Track 1 — MELEK (Tier A, lessons 01–12)
 *   Track 2 — account-automation (Tier B, strand 'account-automation', 13–15)
 *   Track 3 — platforms (Tier C, strand 'platforms', 16–24), each ending with the
 *             CryptoKannon learn-and-earn completion (do an action → upvote reward)
 *   Track 4 — defi (Tier C, strand 'defi', 25–29): KulaSwap DEX + KULA DeFi stack,
 *             each ending with the same learn-and-earn completion + HONEST DeFi risk
 *             framing (impermanent loss / liquidation / smart-contract / no returns)
 *
 * The load-bearing test here is KEY-CUSTODY SAFETY: no lesson may instruct a user
 * to paste / type / send / share a private key or secret. The phrase "private
 * key" (and friends) is only allowed inside an explicit "never share / we never
 * ask" safety context. See `assertKeyCustodySafe` below.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LESSONS, PLATFORMS, DEFI_TOPICS, lessonList, lessonsInStrand, loadLesson } from './index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stagesPath = join(__dirname, '..', 'stages.json');

const VALID_TIERS = new Set(['A', 'B', 'C']);

// A representative sample of ids we expect to ship, across all four tracks.
const EXPECTED_IDS = [
  // Track 1 — MELEK (Tier A)
  'welcome-create-account',
  'your-first-post',
  'comments-and-replies',
  'voting-and-curation',
  'transfers-and-memos',
  'your-profile',
  'claiming-rewards',
  'following-and-feeds',
  'sharing-what-you-know',
  'power-up-your-account',
  'witnessing-and-governance',
  'delegation',
  // Track 2 — automation (Tier B)
  'automating-your-account-safely',
  'account-health-and-curation-bots',
  'running-your-own-bot',
  // Track 3 — platforms (Tier C)
  'kula-arcade',
  'games-and-idle-games',
  'melek-move',
  'herald-web-builder',
  'gambling-education-center',
  'the-forum',
  'tools-hub-and-profile',
  'ren-naming',
  'tokens-curation-witnessing',
  // Track 4 — DeFi (Tier C)
  'what-a-dex-is-and-swapping',
  'providing-liquidity',
  'farming-and-yield',
  'kula-cdp-and-the-dollar-stable',
  'the-bridge',
];

test('LESSONS entries are well-formed, valid tier, unique ids/files', () => {
  assert.ok(LESSONS.length >= EXPECTED_IDS.length, `expected at least ${EXPECTED_IDS.length} lessons, got ${LESSONS.length}`);
  for (const l of LESSONS) {
    assert.ok(VALID_TIERS.has(l.tier), `lesson ${l.id} must be tier A/B/C, got ${l.tier}`);
    assert.equal(typeof l.id, 'string');
    assert.ok(l.id.length > 0);
    assert.equal(typeof l.file, 'string');
    assert.match(l.file, /\.md$/, `lesson ${l.id} file must be a .md`);
    assert.equal(typeof l.title, 'string');
    assert.ok(l.title.length > 0, `lesson ${l.id} must have a title`);
    assert.ok('stageRef' in l, `lesson ${l.id} must declare stageRef (may be null)`);
  }
  const ids = LESSONS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, 'lesson ids must be unique');
  const files = LESSONS.map((l) => l.file);
  assert.equal(new Set(files).size, files.length, 'lesson files must be unique');
});

test('the expected topic ids across all four tracks are present', () => {
  const ids = new Set(LESSONS.map((l) => l.id));
  for (const want of EXPECTED_IDS) {
    assert.ok(ids.has(want), `missing expected lesson: ${want}`);
  }
});

test('every referenced markdown file exists, is non-trivial, and teaches+closes', () => {
  for (const l of LESSONS) {
    const p = join(__dirname, l.file);
    assert.ok(existsSync(p), `markdown file missing for ${l.id}: ${l.file}`);
    const body = readFileSync(p, 'utf8');
    assert.ok(body.trim().length >= 400, `lesson ${l.id} is too short (${body.trim().length} chars)`);
    assert.match(body, /^#\s+.+/m, `lesson ${l.id} must have a markdown H1 title`);
    // Each lesson teaches and closes: "what you'll learn" + a "you did it" close.
    assert.match(body, /what you'll learn/i, `lesson ${l.id} must have a "what you'll learn" section`);
    assert.match(body, /you did it/i, `lesson ${l.id} must have a "you did it" close`);
  }
});

test('non-null stageRefs resolve to a real stage key in stages.json', () => {
  const stages = JSON.parse(readFileSync(stagesPath, 'utf8'));
  const keys = new Set(stages.stages.map((s) => s.key));
  for (const l of LESSONS) {
    if (l.stageRef !== null) {
      assert.ok(keys.has(l.stageRef), `lesson ${l.id} stageRef "${l.stageRef}" not found in stages.json`);
    }
  }
});

/* ------------------------- Track 2 — automation ------------------------- */

test("the account-automation strand is present, Tier-B, and off the FSM", () => {
  const auto = lessonsInStrand('account-automation');
  assert.ok(auto.length >= 3, `expected >=3 automation lessons, got ${auto.length}`);
  for (const l of auto) {
    assert.equal(l.tier, 'B', `automation lesson ${l.id} must be Tier B`);
    assert.equal(l.stageRef, null, `automation lesson ${l.id} must be off the FSM (stageRef null)`);
  }
});

test('the automation foundation lesson teaches the safe, zero-WIF, Signer-scoped model', () => {
  const foundation = readFileSync(join(__dirname, '13-automating-your-account-safely.md'), 'utf8');
  assert.match(foundation, /MELEK-Signer/i, 'foundation lesson must name MELEK-Signer');
  assert.match(foundation, /scoped/i, 'foundation lesson must teach scoped tokens');
  assert.match(foundation, /revoc|revoke/i, 'foundation lesson must teach revocation');
  assert.match(foundation, /zero-?WIF/i, 'foundation lesson must state the zero-WIF property');
});

/* --------------------- Track 3 — platforms (learn-and-earn) --------------------- */

test('the platforms strand is present, Tier-C, off the FSM, with valid platform refs', () => {
  const plat = lessonsInStrand('platforms');
  assert.ok(plat.length >= 9, `expected >=9 platform lessons, got ${plat.length}`);
  const validPlatforms = new Set(PLATFORMS);
  for (const l of plat) {
    assert.equal(l.tier, 'C', `platform lesson ${l.id} must be Tier C`);
    assert.equal(l.stageRef, null, `platform lesson ${l.id} must be off the FSM (stageRef null)`);
    assert.equal(typeof l.platform, 'string', `platform lesson ${l.id} must declare a platform`);
    assert.ok(validPlatforms.has(l.platform), `platform lesson ${l.id} references unknown platform "${l.platform}"`);
  }
  // Each declared platform is covered by exactly one lesson.
  const covered = plat.map((l) => l.platform);
  assert.equal(new Set(covered).size, covered.length, 'each platform must map to a unique lesson');
});

test('every platform we set out to cover has a lesson', () => {
  const covered = new Set(lessonsInStrand('platforms').map((l) => l.platform));
  for (const p of PLATFORMS) {
    assert.ok(covered.has(p), `missing a platforms lesson for "${p}"`);
  }
});

// A "do the action" cue: the learner actively DOES something in the lesson.
const DO_ACTION = /\b(play|walk|record|publish|claim|post|comment|verify|set up|run one|make one|find your|do one)\b/i;

test('every platforms lesson ends with the learn-and-earn completion', () => {
  for (const l of lessonsInStrand('platforms')) {
    const body = readFileSync(join(__dirname, l.file), 'utf8');
    // Collapse whitespace so multi-word phrases still match when they wrap lines.
    const flat = body.replace(/\s+/g, ' ');
    // The CryptoKannon completion section.
    assert.match(flat, /learn and earn/i, `platform lesson ${l.id} must have a "Learn and earn" completion`);
    // The learner DOES the thing.
    assert.match(flat, DO_ACTION, `platform lesson ${l.id} must ask the learner to DO an action`);
    // The reward is an upvote worth whatever.
    assert.match(flat, /upvote/i, `platform lesson ${l.id} must reward with an upvote`);
    assert.match(flat, /worth whatever the vote is worth/i, `platform lesson ${l.id} must frame the reward honestly (worth whatever)`);
    // Honest framing: no promise of returns.
    assert.match(flat, /no (promise|returns)|no promise of returns/i, `platform lesson ${l.id} must keep the honest no-returns framing`);
    // Cross-linked with a "Next:" pointer.
    assert.match(flat, /\bNext:/i, `platform lesson ${l.id} must carry a "Next:" pointer`);
  }
});

test('the KULA Arcade lesson keeps the play-token / provably-fair compliance line', () => {
  const arcade = readFileSync(join(__dirname, '16-kula-arcade.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(arcade, /provably.fair/i, 'KULA lesson must teach provably-fair');
  assert.match(arcade, /non-?cashable|cannot cash|worthless to a bank/i, 'KULA lesson must state PLAY is non-cashable');
  assert.match(arcade, /entertainment/i, 'KULA lesson must frame it as entertainment');
  assert.match(arcade, /sweepstakes|no-?purchase|void where prohibited/i, 'KULA lesson must carry the sweepstakes/AMOE line for draws');
});

test('the Gambling Education Center lesson is education-not-how-to-win and gives help resources', () => {
  const edu = readFileSync(join(__dirname, '20-gambling-education-center.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(edu, /house edge/i, 'must teach house edge');
  assert.match(edu, /expected value|\bEV\b/, 'must teach expected value');
  assert.match(edu, /not.*how-to-win|does not teach you to win|never.*how-to-win/i, 'must NOT frame as how-to-win');
  // Load-bearing: where to get help.
  assert.match(edu, /1-800-GAMBLER|1-800-426-2537|helpline/i, 'must give a problem-gambling help resource');
});

/* --------------------- Track 4 — DeFi (learn-and-earn) --------------------- */

test('the defi strand is present, Tier-C, off the FSM, with valid topic refs', () => {
  const defi = lessonsInStrand('defi');
  assert.ok(defi.length >= 5, `expected >=5 defi lessons, got ${defi.length}`);
  const validTopics = new Set(DEFI_TOPICS);
  for (const l of defi) {
    assert.equal(l.tier, 'C', `defi lesson ${l.id} must be Tier C`);
    assert.equal(l.stageRef, null, `defi lesson ${l.id} must be off the FSM (stageRef null)`);
    assert.equal(typeof l.topic, 'string', `defi lesson ${l.id} must declare a topic`);
    assert.ok(validTopics.has(l.topic), `defi lesson ${l.id} references unknown topic "${l.topic}"`);
  }
  // Each declared topic is covered by exactly one lesson.
  const covered = defi.map((l) => l.topic);
  assert.equal(new Set(covered).size, covered.length, 'each defi topic must map to a unique lesson');
});

test('every defi topic we set out to cover has a lesson', () => {
  const covered = new Set(lessonsInStrand('defi').map((l) => l.topic));
  for (const t of DEFI_TOPICS) {
    assert.ok(covered.has(t), `missing a defi lesson for "${t}"`);
  }
});

test('every defi lesson ends with the learn-and-earn completion', () => {
  for (const l of lessonsInStrand('defi')) {
    const body = readFileSync(join(__dirname, l.file), 'utf8');
    const flat = body.replace(/\s+/g, ' ');
    assert.match(flat, /learn and earn/i, `defi lesson ${l.id} must have a "Learn and earn" completion`);
    // The learner DOES the thing (swap / add liquidity / stake / borrow / bridge → post).
    assert.match(flat, DO_ACTION, `defi lesson ${l.id} must ask the learner to DO an action`);
    assert.match(flat, /upvote/i, `defi lesson ${l.id} must reward with an upvote`);
    assert.match(flat, /worth whatever the vote is worth/i, `defi lesson ${l.id} must frame the reward honestly (worth whatever)`);
    assert.match(flat, /no (promise|returns)|no promise of returns/i, `defi lesson ${l.id} must keep the honest no-returns framing`);
    assert.match(flat, /\bNext:/i, `defi lesson ${l.id} must carry a "Next:" pointer`);
  }
});

// HONEST DeFi risk framing: every defi lesson must name at least one concrete risk.
const DEFI_RISK = /impermanent loss|liquidat|smart-contract risk|smart contract risk|no promise of returns|alpha|testnet/i;

test('every defi lesson carries an honest DeFi risk note', () => {
  for (const l of lessonsInStrand('defi')) {
    const flat = readFileSync(join(__dirname, l.file), 'utf8').replace(/\s+/g, ' ');
    assert.match(flat, DEFI_RISK, `defi lesson ${l.id} must carry an honest DeFi risk note`);
  }
});

test('the swap lesson teaches AMM basics and swap risk', () => {
  const swap = readFileSync(join(__dirname, '25-what-a-dex-is-and-swapping.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(swap, /automated market maker|AMM/i, 'swap lesson must teach the AMM');
  assert.match(swap, /liquidity pool|pool/i, 'swap lesson must teach liquidity pools');
  assert.match(swap, /slippage/i, 'swap lesson must teach slippage');
  assert.match(swap, /ratio/i, 'swap lesson must teach price = ratio');
  assert.match(swap, /smart-contract risk/i, 'swap lesson must state smart-contract risk');
});

test('the liquidity lesson is HONEST about impermanent loss and LP tokens', () => {
  const lp = readFileSync(join(__dirname, '26-providing-liquidity.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(lp, /impermanent loss/i, 'liquidity lesson must name impermanent loss');
  assert.match(lp, /LP token/i, 'liquidity lesson must teach LP tokens');
  // Honest: possible to still come out behind simply holding.
  assert.match(lp, /behind|less of the winner|does not always/i, 'liquidity lesson must state IL can leave you behind holding');
});

test('the farming lesson is HONEST that yield is not free money (emissions/risk)', () => {
  const farm = readFileSync(join(__dirname, '27-farming-and-yield.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(farm, /yield is not free money|not free money/i, 'farming lesson must state yield is not free money');
  assert.match(farm, /emission/i, 'farming lesson must explain emissions');
  assert.match(farm, /APR/i, 'farming lesson must read an APR honestly');
});

test('the CDP lesson teaches the SBD history, missing MBD, and collateral-backed stable', () => {
  const cdp = readFileSync(join(__dirname, '28-kula-cdp-and-the-dollar-stable.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(cdp, /\bSBD\b/, 'CDP lesson must teach SBD history');
  assert.match(cdp, /Blurt/i, 'CDP lesson must state Blurt removed the dollar token');
  assert.match(cdp, /\bMBD\b/, 'CDP lesson must state MELEK has no MBD');
  assert.match(cdp, /\bCDP\b|collateraliz/i, 'CDP lesson must teach the CDP');
  assert.match(cdp, /overcollateraliz/i, 'CDP lesson must teach overcollateralization');
  assert.match(cdp, /liquidat/i, 'CDP lesson must teach liquidation risk');
  // Unicoin line: NEVER "asset-backed" / "SEC-registered".
  assert.match(cdp, /utility/i, 'CDP lesson must frame KULA/stable as a utility mechanism');
  assert.match(cdp, /asset-backed|SEC-registered/i, 'CDP lesson must explicitly disclaim the asset-backed/SEC-registered framing');
});

test('the bridge lesson teaches wrapping, wMELEK backing, and security posture', () => {
  const br = readFileSync(join(__dirname, '29-the-bridge.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(br, /wMELEK/i, 'bridge lesson must name wMELEK');
  assert.match(br, /wrap/i, 'bridge lesson must teach wrapping');
  assert.match(br, /lock.*mint|mint.*lock/i, 'bridge lesson must teach lock-and-mint');
  assert.match(br, /security|attest|validator|risk/i, 'bridge lesson must teach the security posture');
});

/* ------------------------------ loader API ------------------------------ */

test('loadLesson returns content for every id; soft-fails on unknown/bad', () => {
  for (const l of LESSONS) {
    const loaded = loadLesson(l.id);
    assert.ok(loaded, `loadLesson(${l.id}) returned null`);
    assert.equal(loaded.id, l.id);
    assert.equal(loaded.file, l.file);
    assert.ok(loaded.path.endsWith(l.file));
    assert.equal(typeof loaded.content, 'string');
    assert.ok(loaded.content.trim().length > 0);
  }
  assert.equal(loadLesson('no-such-lesson'), null, 'unknown id must soft-fail to null');
  assert.equal(loadLesson(undefined), null, 'undefined id must soft-fail to null');
  assert.equal(loadLesson(''), null, 'empty id must soft-fail to null');
});

test('lessonList returns a defensive copy of the metadata', () => {
  const list = lessonList();
  assert.equal(list.length, LESSONS.length);
  list[0].title = 'MUTATED';
  list.push({ id: 'x' });
  assert.notEqual(LESSONS[0].title, 'MUTATED', 'mutating the list must not touch LESSONS');
  assert.equal(LESSONS.length, list.length - 1, 'pushing to the list must not touch LESSONS');
});

test('lessonsInStrand returns defensive copies and only that strand', () => {
  const plat = lessonsInStrand('platforms');
  for (const l of plat) assert.equal(l.strand, 'platforms');
  plat[0].title = 'MUTATED';
  assert.notEqual(LESSONS.find((l) => l.id === plat[0].id).title, 'MUTATED', 'mutating the strand copy must not touch LESSONS');
  assert.deepEqual(lessonsInStrand('no-such-strand'), [], 'unknown strand yields empty list');
});

/**
 * KEY-CUSTODY SAFETY.
 *
 * For each lesson, scan every line. If a line mentions a secret-credential token
 * (private key / master password / WIF / secret key / seed phrase), it MUST be in
 * a safety context — i.e. the line (or its immediate neighbours) tells the user
 * NOT to share it, or states that the Witness never asks for it. A line that
 * mentions a secret in any *instructional* way ("paste your private key…",
 * "enter your master password…") is a failure.
 */

// Tokens that name an actual secret credential.
const SECRET_TOKENS = [
  /private key/i,
  /master password/i,
  /\bWIF\b/,
  /secret key/i,
  /seed phrase/i,
];

// Safety-context cues — a secret mention is OK only near one of these.
const SAFETY_CUES = [
  /never/i,
  /\bnot\b/i,
  /don'?t/i,
  /do not/i,
  /no one/i,
  /\bnever ask/i,
  /will never/i,
  /keep .*(safe|offline|secret|private)/i,
  /stays? with you/i,
  /your (own )?(hands|control|device|machine|browser)/i,
  /only .*(you|your)/i,
  /\boffline\b/i,
  /should ever pass/i,
];

// Instructional verbs that, applied to a secret, are an outright failure regardless.
const SHARE_INSTRUCTION = [
  /\b(paste|type|enter|send|share|give|provide|submit|hand over|copy)\b[^.]{0,60}\b(private key|master password|secret key|seed phrase|WIF)\b/i,
  /\b(private key|master password|secret key|seed phrase|WIF)\b[^.]{0,40}\b(paste|type|enter|send|share|provide|submit)\b/i,
];

function assertKeyCustodySafe(id, body) {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Hard fail: any instruction to share a secret, anywhere.
    for (const re of SHARE_INSTRUCTION) {
      assert.ok(!re.test(line), `KEY-CUSTODY VIOLATION in ${id} line ${i + 1}: instructs sharing a secret -> ${line.trim()}`);
    }

    // Any mention of a secret token must sit in a safety context.
    const mentionsSecret = SECRET_TOKENS.some((re) => re.test(line));
    if (!mentionsSecret) continue;

    const neighbourhood = [lines[i - 1] || '', line, lines[i + 1] || ''].join(' ');
    const isSafetyContext = SAFETY_CUES.some((re) => re.test(neighbourhood));
    assert.ok(
      isSafetyContext,
      `KEY-CUSTODY: ${id} line ${i + 1} mentions a secret outside a never-share/we-never-ask context -> ${line.trim()}`,
    );
  }
}

test('no lesson instructs sharing a private key; secrets only in safety context', () => {
  for (const l of LESSONS) {
    const body = readFileSync(join(__dirname, l.file), 'utf8');
    assertKeyCustodySafe(l.id, body);
  }
});

test('lessons reinforce that the Witness never asks for keys', () => {
  // At least the account-creation lesson must carry the explicit promise.
  const welcome = readFileSync(join(__dirname, '01-welcome-create-account.md'), 'utf8');
  assert.match(welcome, /never ask you for a private key/i, 'welcome lesson must promise the Witness never asks for keys');
});
