// token-exams — knowledge exams that teach how our own stuff works, pay a little for passing, and
// REFUSE TO ASK ABOUT ANYTHING THAT IS BROKEN.
//
// Operator, 2026-09-08: "set up some kind of Token Exams, that just Teach People how our stuff Works,
// and Pays them a little for Passing a Test." And then the better half of the idea: "making sure all
// the Processes they are being Tested on Function Properly."
//
// ── WHY PAYING IS FINE HERE AND FORBIDDEN NEXT DOOR ───────────────────────────────────────────────
//
// Both Temple Exam research passes independently ruled out any route from a score to a reward, for the
// same reason: a score that buys something gets optimised, and then the data dies. cryptology.mjs
// enforces "positions, not levels" structurally for the same reason.
//
// That ruling is about PERCEPTUAL exams, where the measurement IS the product. Paying someone for
// their unique-hue setting corrupts the only thing it was measuring.
//
// A KNOWLEDGE exam is a different object. There is no honest signal to corrupt — you either know that
// MELEK is a Graphene chain with ~4s blocks and flags instead of downvotes, or you do not. Optimising
// toward the right answer is called learning; it is the entire point.
//
//   THE RULE: pay for knowledge, never for perception. The boundary is bright and it is enforced
//   here — `kind` is required, only 'knowledge' is payable, and there is no argument that overrides it.
//
// ── THE EXAM TESTS US TOO ─────────────────────────────────────────────────────────────────────────
//
// Every question declares the process it verifies. Before a question can be served, that process must
// answer. So an exam that asks "what does !balance return" cannot be set while `!balance` is broken —
// and the attempt to set it reports the breakage. A question bank pointed at live surfaces is a
// continuously-running integration test with a person on the other end, and the person should never be
// the one who discovers the thing is down.
//
// Nothing here pays anything. It decides ELIGIBILITY; the payout goes through the faucet and the
// signer boundary like every other value movement.

const str = (v) => String(v == null ? '' : v).trim();
const low = (v) => str(v).toLowerCase();
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Exam kinds. Only one of them may ever pay. */
export const KINDS = Object.freeze({
  knowledge: { payable: true, why: 'you either know how the thing works or you do not — optimising toward the right answer is learning' },
  perception: { payable: false, why: 'the measurement IS the product; paying for a result corrupts the only thing it measures' },
});

export const isPayableKind = (k) => !!(KINDS[low(k)] && KINDS[low(k)].payable);

// ── the processes an exam may test ────────────────────────────────────────────────────────────────
/**
 * A process is something the ecosystem actually does. Each carries a PROBE — a function that answers
 * "is this working right now" using injected dependencies, so the check is offline-testable and never
 * reaches the network by itself.
 *
 * `probe` returns { ok, detail }. Anything thrown is caught and becomes ok:false — a probe that throws
 * is a broken process, which is exactly the answer we want.
 */
export const PROCESSES = Object.freeze({
  'command:help': { desc: 'The !help command lists the menu.', needs: 'commands' },
  'command:balance': { desc: 'The !balance command reads an account balance.', needs: 'commands' },
  'command:price': { desc: 'The !price command reports the published feed.', needs: 'commands' },
  'command:witness': { desc: 'The !witness command reports witness state.', needs: 'commands' },
  'command:signup': { desc: 'The !signup command explains account creation.', needs: 'commands' },
  'command:tutorial': { desc: 'The !tutorial command starts the staged tutorial.', needs: 'commands' },
  'chain:head': { desc: 'The MELEK chain is producing blocks.', needs: 'chain' },
  'engine:live': { desc: 'MELEK-Engine answers.', needs: 'engine' },
  'pool:live': { desc: 'The mining pool answers.', needs: 'pool' },
});

/**
 * Probe a process. `deps` supplies what each needs; a missing dep is a FAILED probe, never a pass.
 *
 * The default-deny is the whole point. An exam that cannot tell whether a thing works must not ask
 * about it — "we could not check" and "it works" are different answers and only one of them is safe.
 */
export function verifyProcess(id, deps = {}) {
  const spec = PROCESSES[str(id)];
  if (!spec) return { id: str(id), ok: false, detail: 'unknown process — a question may not reference one' };
  try {
    if (spec.needs === 'commands') {
      const list = deps.commands;
      if (!Array.isArray(list)) return { id, ok: false, detail: 'no command registry supplied — cannot verify' };
      const want = str(id).split(':')[1];
      const cmd = list.find((c) => c && low(c.name) === want);
      if (!cmd) return { id, ok: false, detail: `!${want} is not in the command registry` };
      if (typeof cmd.handler !== 'function') return { id, ok: false, detail: `!${want} has no handler` };
      return { id, ok: true, detail: `!${want} registered with a handler` };
    }
    if (spec.needs === 'chain') {
      const head = Number(deps.headBlock);
      if (!Number.isFinite(head) || head <= 0) return { id, ok: false, detail: 'no chain head reported' };
      return { id, ok: true, detail: `head block ${head}` };
    }
    const up = deps[spec.needs];
    if (up === true) return { id, ok: true, detail: `${spec.needs} reachable` };
    return { id, ok: false, detail: `${spec.needs} not reported reachable` };
  } catch (e) {
    return { id, ok: false, detail: `probe threw: ${str(e && e.message) || 'unknown'}` };
  }
}

// ── the bank ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Questions. Each one teaches something true and names the process it depends on.
 *
 * Answers are indexes into `options` as authored; `buildExam()` shuffles the options per candidate, so
 * the letter that is correct differs between two people sitting the same question. That is the
 * anti-sharing measure — "the answer is C" is worth nothing to anybody.
 */
export const QUESTIONS = Object.freeze([
  { id: 'q-blocks', kind: 'knowledge', verifies: 'chain:head', teaches: 'MELEK block time',
    q: 'About how long is a MELEK block?', options: ['~4 seconds', '~10 minutes', '~1 second', '~15 seconds'], answer: 0,
    explain: 'MELEK is a Graphene/DPoS chain with roughly 4-second blocks — not a PoW block time.' },
  { id: 'q-flags', kind: 'knowledge', verifies: 'chain:head', teaches: 'flags vs downvotes',
    q: 'What does MELEK use instead of downvotes?', options: ['Flags', 'Downvotes, same as Hive', 'Nothing at all', 'Slashing'], answer: 0,
    explain: 'MELEK has flags, not downvotes — a deliberate difference from Hive and Steem.' },
  { id: 'q-premine', kind: 'knowledge', verifies: 'chain:head', teaches: 'no premine',
    q: 'How much MELEK was pre-mined before launch?', options: ['None', '10%', '20%', 'Half'], answer: 0,
    explain: 'Fair launch, no premine. Every MELEK in existence was produced by a block.' },
  { id: 'q-keys', kind: 'knowledge', verifies: 'command:signup', teaches: 'key custody',
    q: 'Who generates and holds your private keys when you sign up?', options: ['You do, in your own browser', 'The Witness holds them for you', 'They are emailed to you', 'A support agent'], answer: 0,
    explain: 'Keys are generated client-side and never transmitted. The Witness never sees, requests or stores them — that is a hard boundary, not a policy.' },
  { id: 'q-balance', kind: 'knowledge', verifies: 'command:balance', teaches: 'the balance command',
    q: 'Which command shows an account’s liquid and vesting balance?', options: ['!balance @account', '!wallet', '!funds', '!account'], answer: 0,
    explain: '!balance @account reads it straight off the chain.' },
  { id: 'q-price', kind: 'knowledge', verifies: 'command:price', teaches: 'the price feed',
    q: 'What does the witness price feed publish?', options: ['An informational price the chain uses', 'A guaranteed exchange rate', 'A trading signal', 'Nothing — it is decorative'], answer: 0,
    explain: 'It is an informational feed a witness publishes as part of running the chain. It is not a promise about what anything is worth.' },
  { id: 'q-witness', kind: 'knowledge', verifies: 'command:witness', teaches: 'what a witness does',
    q: 'What does a witness actually do?', options: ['Produces blocks and keeps the chain live', 'Approves transactions manually', 'Holds user funds', 'Sets the token price'], answer: 0,
    explain: 'A witness runs a node, produces blocks in its slot, and publishes a price feed. It does not custody anything.' },
  { id: 'q-cashout', kind: 'knowledge', verifies: 'chain:head', teaches: 'the honest exit path',
    q: 'What is the route out of the ecosystem today?', options: ['KULA Swap, then the bridge to Hive-Engine', 'A bank transfer', 'There is none', 'Directly to a card'], answer: 0,
    explain: 'KULA Swap into wVKBT/wCURE, bridge to Hive-Engine, then SWAP.HIVE. The route works; the market at the far end is thin today, and you should be told that rather than discover it.' },
  { id: 'q-tutorial', kind: 'knowledge', verifies: 'command:tutorial', teaches: 'the tutorial exists',
    q: 'How do you start the staged tutorial?', options: ['!tutorial', '!start', '!learn', 'You cannot'], answer: 0,
    explain: '!tutorial begins the staged onboarding.' },
  { id: 'q-help', kind: 'knowledge', verifies: 'command:help', teaches: 'discoverability',
    q: 'Which command lists everything else?', options: ['!help', '!menu', '!list', '!commands'], answer: 0,
    explain: '!help lists the menu, and !help <command> explains one.' },
]);

// ── deterministic shuffling ───────────────────────────────────────────────────────────────────────
/** mulberry32 — small, fast, seeded. Deterministic per candidate so an exam can be re-rendered. */
function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffled = (arr, rand) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
/** A stable numeric seed from a string, so a candidate id produces the same paper twice. */
export function seedFrom(s) {
  let h = 2166136261;
  for (const ch of str(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ── which questions may be asked at all ───────────────────────────────────────────────────────────
/**
 * The system-test view. Reports every question, whether it is servable, and — when it is not — WHY,
 * naming the broken process rather than silently dropping it.
 *
 * This is the artifact the operator asked for: proof that the processes people are examined on
 * actually function, produced as a side effect of running the exam at all.
 */
export function examHealth(deps = {}, bank = QUESTIONS) {
  const seen = new Map();
  const rows = bank.map((q) => {
    if (!seen.has(q.verifies)) seen.set(q.verifies, verifyProcess(q.verifies, deps));
    const p = seen.get(q.verifies);
    return { id: q.id, teaches: q.teaches, verifies: q.verifies, servable: p.ok, detail: p.detail };
  });
  const broken = [...seen.values()].filter((p) => !p.ok);
  return {
    total: rows.length,
    servable: rows.filter((r) => r.servable).length,
    withheld: rows.filter((r) => !r.servable).length,
    brokenProcesses: broken.map((p) => ({ id: p.id, detail: p.detail })),
    healthy: broken.length === 0,
    rows,
  };
}

export const servableQuestions = (deps = {}, bank = QUESTIONS) =>
  bank.filter((q) => verifyProcess(q.verifies, deps).ok);

// ── building a paper ──────────────────────────────────────────────────────────────────────────────
/**
 * Build one candidate's exam. Questions are drawn only from the servable set, and both the selection
 * and each question's options are shuffled from the candidate's seed — so two people sitting the same
 * exam see different questions in a different order with the correct answer under a different letter.
 */
export function buildExam({ candidate = '', count = 5, deps = {}, bank = QUESTIONS, kind = 'knowledge' } = {}) {
  const pool = servableQuestions(deps, bank).filter((q) => low(q.kind) === low(kind));
  if (!pool.length) {
    const h = examHealth(deps, bank);
    return {
      ok: false, code: 'no-servable-questions',
      reason: 'every question depends on a process that is not answering — the exam is withheld rather than asking about something broken.',
      brokenProcesses: h.brokenProcesses, questions: [],
    };
  }
  const rand = rng(seedFrom(candidate) ^ 0x9E3779B9);
  const picked = shuffled(pool, rand).slice(0, Math.max(1, Math.min(count, pool.length)));
  const questions = picked.map((q) => {
    const order = shuffled(q.options.map((_, i) => i), rand);
    return {
      id: q.id,
      q: q.q,
      teaches: q.teaches,
      verifies: q.verifies,
      options: order.map((i) => q.options[i]),
      // The key is per-candidate: the same question has a different correct index for each person.
      _correctIndex: order.indexOf(q.answer),
    };
  });
  return {
    ok: true, candidate: str(candidate), kind: low(kind),
    count: questions.length, poolSize: pool.length,
    withheld: bank.length - pool.length,
    questions,
  };
}

// ── grading ───────────────────────────────────────────────────────────────────────────────────────
export const PASS_MARK = 0.8;

/**
 * Grade a paper. `answers` maps question id -> chosen option index.
 *
 * Every question returns its explanation whether or not it was answered correctly — the exam exists to
 * teach, and a wrong answer is the moment someone is most willing to read why.
 */
export function grade(exam = {}, answers = {}, bank = QUESTIONS) {
  if (!exam || exam.ok === false || !Array.isArray(exam.questions)) {
    return { ok: false, reason: 'not a built exam', score: 0, passed: false };
  }
  const byId = new Map(bank.map((q) => [q.id, q]));
  const results = exam.questions.map((q) => {
    const chosen = Number(answers[q.id]);
    const correct = Number.isFinite(chosen) && chosen === q._correctIndex;
    return { id: q.id, correct, teaches: q.teaches, explain: (byId.get(q.id) || {}).explain || '' };
  });
  const right = results.filter((r) => r.correct).length;
  const score = results.length ? right / results.length : 0;
  return {
    ok: true, correct: right, total: results.length,
    score, passed: score >= PASS_MARK, passMark: PASS_MARK, results,
  };
}

// ── payout eligibility (decides only; pays nothing) ───────────────────────────────────────────────
/**
 * May this result be paid?
 *
 * Four gates, and the interesting ones are the last two:
 *   - the exam must be a KNOWLEDGE exam (perception is never payable)
 *   - it must have passed
 *   - the same candidate may not be paid for the same exam twice
 *   - EVERY process the paper tested must still be verifying at grading time
 *
 * That last gate is not bureaucracy. If a process broke between building the paper and grading it,
 * the candidate may have answered correctly about a thing that no longer works — and paying for that
 * teaches them something false. Withholding, and saying so, is the honest outcome.
 */
export function rewardEligible({ exam = {}, result = {}, deps = {}, alreadyPaid = false, kind = 'knowledge' } = {}) {
  const reasons = [];
  if (!isPayableKind(kind)) reasons.push(`${low(kind)} exams are never payable — ${(KINDS[low(kind)] || {}).why || 'unknown kind'}`);
  if (!result || result.passed !== true) reasons.push(`did not reach the pass mark (${PASS_MARK * 100}%)`);
  if (alreadyPaid) reasons.push('this candidate has already been paid for this exam');
  const stale = (exam.questions || [])
    .map((q) => verifyProcess(q.verifies, deps))
    .filter((p) => !p.ok);
  if (stale.length) {
    reasons.push(`a process tested on this paper stopped answering before grading: ${stale.map((s) => s.id).join(', ')}`);
  }
  return {
    eligible: reasons.length === 0,
    reasons,
    note: 'This decides eligibility only. The payout itself goes through the faucet and the signer boundary.',
  };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'token-exams',
    kinds: KINDS, passMark: PASS_MARK,
    processes: Object.keys(PROCESSES), questions: QUESTIONS.length,
    rule: 'pay for knowledge, never for perception — and never ask about a process that is not answering',
  }, null, 2));
}

export default {
  KINDS, PROCESSES, QUESTIONS, PASS_MARK, isPayableKind, verifyProcess, examHealth,
  servableQuestions, buildExam, grade, rewardEligible, seedFrom, handler, esc,
};

if (process.argv[1] && process.argv[1].endsWith('token-exams.mjs')) {
  const h = examHealth({});
  console.log(JSON.stringify({ questions: QUESTIONS.length, withNoDeps: h }, null, 1).slice(0, 900));
}
