// status.js — generates a current, plain-English status summary for the Library of Ashurbanipal bot.
//
// The operator is NOT a coder. Everything this module produces for a human to READ is plain
// real-world English — no file paths, no module names, no jargon. The structured fields (for other
// code) may carry technical handles; the `plain` / `sentence` fields never do.
//
// CONVENTIONS (match the library bot):
//   - ESM (package.json "type":"module"), like every other src/ module.
//   - DETERMINISTIC + offline-testable: statusSummary() takes injected module-list / test-results so
//     a test can run it with no disk, no network, no LLM. capabilities() is a static, hand-curated
//     map of what the bot can actually do today (kept honest against what exists in src/).
//   - SOFT-FAIL: bad/missing input → a safe, empty-but-valid result, never a throw.
//   - SECURITY: reads nothing sensitive, holds no keys, makes no network calls.
//
// Exports:
//   capabilities()            → [{ name, state:'live'|'built'|'pending', plain }]
//   statusSummary({modules,tests}) → { counts, sentence, capabilities, modules, tests }
//   renderStatus(summary)     → operator-friendly markdown string
//
// Run the tests: node --test test/status.test.js

// ── what the bot can do ───────────────────────────────────────────────────────────────────────
// state meanings (operator-facing):
//   'live'    — working and in use right now.
//   'built'   — finished and tested, but waiting on something outside the bot to be switched on.
//   'pending' — not built yet / waiting on you.
//
// Each entry's `plain` line is written for a non-coder: what it does in the real world.
const CAPABILITIES = Object.freeze([
  {
    name: 'Draft wiki articles from the library',
    state: 'built',
    plain: 'Writes encyclopedia-style articles by weaving together what the source documents say, instead of copying and pasting any one of them.',
  },
  {
    name: 'Ground every article in its sources',
    state: 'built',
    plain: 'Each finished article lists exactly which source documents it leaned on, and quietly marks any section that rests on thin evidence so you know what to trust.',
  },
  {
    name: 'Fact-check claims and flag problems',
    state: 'built',
    plain: 'Reads back what it (or a source) claims, checks it against the outside world, and raises a flag when something looks wrong — it never changes your documents, it only points.',
  },
  {
    name: 'Keep a permanent record of every check',
    state: 'built',
    plain: 'Keeps an unerasable log of every claim it checked and what it found, so you can always see how a verdict was reached and trust nothing was quietly rewritten.',
  },
  {
    name: 'Hold drafts for your approval',
    state: 'built',
    plain: 'Nothing the bot writes goes public on its own. Drafts wait in a review pile until you say yes; you can approve or reject each one.',
  },
  {
    name: 'Turn wiki text into safe web pages',
    state: 'built',
    plain: 'Converts the raw article text into a clean, safe web page — stripping anything that could be used to attack a reader.',
  },
  {
    name: 'Fill in missing linked pages',
    state: 'built',
    plain: 'When an article points to a topic that has no page yet, it creates a small placeholder so there are no dead ends, and notes which article asked for it.',
  },
  {
    name: 'Update only what changed',
    state: 'built',
    plain: 'On a later run it notices which source documents are new or edited and re-writes only the articles those affect, instead of redoing everything.',
  },
  {
    name: 'Publish into a real wiki',
    state: 'pending',
    plain: 'Putting approved articles onto a live, public wiki website. Waiting on you to stand up that wiki for it to publish into.',
  },
  {
    name: 'Check against live market and chain data',
    state: 'pending',
    plain: 'Cross-checking claims against the live coin-market and blockchain data feeds. Waiting on those feeds to be connected.',
  },
  {
    name: 'Answer in Discord and Telegram',
    state: 'pending',
    plain: 'Letting you and others reach the librarian through Discord or Telegram. Not wired up yet.',
  },
]);

/** A static, hand-curated list of what the bot can do, each with a plain-English line and a state. */
export function capabilities() {
  // Return a fresh, frozen copy so callers can't mutate the canonical list.
  return CAPABILITIES.map((c) => Object.freeze({ ...c }));
}

// ── deterministic summary from injected data ────────────────────────────────────────────────────

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function countStates(caps) {
  const out = { live: 0, built: 0, pending: 0 };
  for (const c of caps) {
    if (c && Object.prototype.hasOwnProperty.call(out, c.state)) out[c.state] += 1;
  }
  return out;
}

/**
 * Build a plain-English summary object from injected data (so it's testable offline).
 *
 * @param {object} input
 * @param {Array}  input.modules  list of the bot's code parts that exist, e.g. [{name, present:true}]
 *                                (or plain strings). Only the COUNT is used in the human sentence.
 * @param {object} input.tests    test results, e.g. { passed: 90, failed: 0, suites: 8 }.
 * @returns {{counts, sentence, capabilities, modules, tests}}
 */
export function statusSummary({ modules, tests } = {}) {
  const caps = capabilities();
  const mods = asArray(modules);
  const presentModules = mods.filter((m) => (typeof m === 'string' ? true : m && m.present !== false));

  const t = tests && typeof tests === 'object' ? tests : {};
  const passed = Number.isFinite(t.passed) ? t.passed : 0;
  const failed = Number.isFinite(t.failed) ? t.failed : 0;

  const states = countStates(caps);
  const counts = {
    capabilities: caps.length,
    live: states.live,
    built: states.built,
    pending: states.pending,
    modules: presentModules.length,
    testsPassed: passed,
    testsFailed: failed,
  };

  // Plain real-world sentence — NO file paths, NO module names, NO jargon.
  const readyCount = states.live + states.built;
  const ready = readyCount === 1 ? 'one thing' : `${readyCount} things`;
  const testPart = failed > 0
    ? `${failed} of its checks are currently failing and need attention`
    : passed > 0
      ? 'all of its checks are passing'
      : 'its checks have not been run';
  const waitingPart = states.pending > 0
    ? `, with ${states.pending} more waiting on you to switch on the outside pieces`
    : '';
  const sentence =
    `The librarian can already do ${ready} on its own${waitingPart}, and right now ${testPart}.`;

  return { counts, sentence, capabilities: caps, modules: presentModules, tests: { passed, failed } };
}

// ── markdown rendering (operator-friendly) ──────────────────────────────────────────────────────

const STATE_LABEL = Object.freeze({
  live: 'Working now',
  built: 'Ready, waiting on outside setup',
  pending: 'Not yet',
});

/** Render a summary (from statusSummary) into plain-English operator-facing markdown. */
export function renderStatus(summary) {
  const s = summary && typeof summary === 'object' ? summary : statusSummary();
  const caps = asArray(s.capabilities).length ? s.capabilities : capabilities();
  const counts = s.counts || statusSummary().counts;
  const sentence = typeof s.sentence === 'string' && s.sentence ? s.sentence : statusSummary().sentence;

  const lines = [];
  lines.push('# Library of Ashurbanipal — Status at a glance');
  lines.push('');
  lines.push(sentence);
  lines.push('');

  const group = (state) => caps.filter((c) => c && c.state === state);

  const section = (title, state) => {
    const items = group(state);
    if (!items.length) return;
    lines.push(`## ${title}`);
    lines.push('');
    for (const c of items) lines.push(`- **${c.name}** — ${c.plain}`);
    lines.push('');
  };

  section('Working now', 'live');
  section('Ready, waiting on outside setup', 'built');
  section('Waiting on you', 'pending');

  lines.push('## The numbers');
  lines.push('');
  lines.push(`- Things the librarian can do: **${counts.capabilities}** total`);
  lines.push(`- Working or ready: **${counts.live + counts.built}**`);
  lines.push(`- Waiting on you: **${counts.pending}**`);
  if (counts.testsPassed || counts.testsFailed) {
    lines.push(`- Self-checks passing: **${counts.testsPassed}**${counts.testsFailed ? `, failing: **${counts.testsFailed}**` : ''}`);
  }
  lines.push('');

  return lines.join('\n');
}

export default { capabilities, statusSummary, renderStatus, STATE_LABEL };

// ── CLI (guarded) ───────────────────────────────────────────────────────────────────────────────
// Prints the at-a-glance markdown. Deterministic; no network, no keys. Module list is a best-effort,
// soft-failing scan of src/ for context only — the human text never depends on it.
if (process.argv[1] && process.argv[1].endsWith('status.js')) {
  let modules = [];
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const walk = (dir) => {
      let out = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out = out.concat(walk(p));
        else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push({ name: e.name, present: true });
      }
      return out;
    };
    modules = walk(here);
  } catch { /* soft-fail: human text doesn't depend on this */ }

  const summary = statusSummary({ modules, tests: {} });
  process.stdout.write(renderStatus(summary) + '\n');
}
