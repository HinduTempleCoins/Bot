// hathor-council.mjs — THE egregore Council: "several AIs deciding together / egregore within an
// egregore" (the design doc's integrative part). Named sub-egregores each answer from their own domain
// and ABSTAIN when they have nothing; a MYCIN certainty-factor arbiter (cfCombine) aggregates them,
// scaled by the REWARD lobe's learned per-seat weights, into Hathor's one voice. Seats that AGREE
// reinforce each other (their CFs combine); the Fact-Checker can FLAG (never edits). Outcomes feed back
// into the reward lobe, so the council learns who to believe.
//
// Pure + injectable + soft-fail: pass seats (tests), a reward lobe, a fact-checker. A broken seat is
// skipped, never throws. Default seats compose an injected crypt-ology brain's capabilities.
//
//   import { createCouncil } from './hathor-council.mjs';
//   const c = createCouncil({ brain, reward });
//   const r = await c.deliberate('who are you?', { account:'@a' });  // { answer, by, confidence, agreed, seats, flags }
//   c.feedback(r, 'good');   // reinforce the seats that spoke

import { cfCombine } from './decades-brain.mjs';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const words = (s) => new Set(norm(s).match(/[a-z0-9']{3,}/g) || []);
function jaccard(a, b) {
  const A = words(a), B = words(b); if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Build the default council seats from an injected crypt-ology brain. Each returns {answer,confidence}|null. */
export function defaultSeats(brain) {
  if (!brain) return [];
  const askSeat = (name, role, guard) => ({
    name, role,
    async answer(q, ctx) {
      if (guard && !guard(q)) return null;                 // out of this seat's domain → abstain
      try {
        const r = await brain.ask({ account: ctx?.account || null, question: q, k: ctx?.k || 5 });
        if (!r || !r.answer) return null;
        return { answer: r.answer, confidence: r.routedBy === 'library' ? 0.7 : 0.85, sources: r.sources || [] };
      } catch { return null; }
    },
  });
  return [
    askSeat('librarian', 'healer/scripture/library recall', null),
    askSeat('witness', 'chain & ops facts', (q) => /\b(witness|block|chain|price|vote|stake|account|melek|prana|transfer)\b/i.test(q)),
    askSeat('solomon', 'judgment / law', (q) => /\b(law|right|court|legal|statute|constitution|rule)\b/i.test(q)),
    {
      name: 'babel', role: 'language/translation',
      async answer(q) {
        if (/^[\x00-\x7F]*$/.test(q) && !/translate|in (french|spanish|arabic|kurdish|hebrew|greek)/i.test(q)) return null;
        try { const t = await brain.translate?.translate(q, { from: 'english', to: 'french' }); return t && t.text ? { answer: t.text, confidence: 0.55 } : null; }
        catch { return null; }
      },
    },
    {
      name: 'angel', role: 'pastoral disposition (always present, low confidence)',
      async answer() { return { answer: brain.rule1Short || 'I am here, and I answer from the Library I am given.', confidence: 0.25 }; },
    },
  ];
}

export function createCouncil({ brain = null, reward = null, seats = null, factChecker = null } = {}) {
  const roster = seats || defaultSeats(brain);
  const rw = (name) => (reward && typeof reward.weightFor === 'function' ? reward.weightFor(`seat:${name}`) : 1);

  return {
    seats: () => roster.map((s) => ({ name: s.name, role: s.role })),

    /** Convene the council on one question. */
    async deliberate(question, ctx = {}) {
      const q = String(question || '');
      const spoke = [];
      await Promise.all(roster.map(async (s) => {
        try {
          const r = await s.answer(q, ctx);
          if (r && r.answer != null) spoke.push({ name: s.name, answer: r.answer, confidence: clamp(+r.confidence || 0, 0, 1), eff: clamp((+r.confidence || 0) * rw(s.name), 0, 1.5), sources: r.sources || [] });
        } catch { /* a broken seat abstains */ }
      }));
      if (!spoke.length) return { answer: null, by: null, confidence: 0, agreed: [], seats: [], flags: [] };

      // group seats whose answers agree (cf combines within a group → agreement boosts certainty)
      const groups = [];
      for (const s of spoke) {
        const g = groups.find((gr) => jaccard(gr.rep.answer, s.answer) >= 0.5);
        if (g) { g.members.push(s); if (s.eff > g.rep.eff) g.rep = s; }
        else groups.push({ rep: s, members: [s] });
      }
      for (const g of groups) g.cf = g.members.reduce((acc, m) => cfCombine(acc, m.eff), 0);
      groups.sort((a, b) => b.cf - a.cf);
      const win = groups[0];

      let flags = [];
      if (factChecker && typeof factChecker === 'function') {
        try { const f = await factChecker(win.rep.answer, q); if (f && f.length) flags = f; } catch { /* soft */ }
      }
      return {
        answer: win.rep.answer, by: win.rep.name, confidence: Math.round(win.cf * 1000) / 1000,
        agreed: win.members.map((m) => m.name),
        seats: spoke.map((s) => ({ name: s.name, confidence: s.confidence, eff: Math.round(s.eff * 1000) / 1000 })),
        sources: win.rep.sources, flags,
      };
    },

    /** Feed an outcome back: reinforce the seats that spoke in the winning group. */
    feedback(result, outcome = 'neutral') {
      if (!reward || !result) return;
      for (const name of (result.agreed || [])) reward.reinforce(`seat:${name}`, outcome);
    },
  };
}
