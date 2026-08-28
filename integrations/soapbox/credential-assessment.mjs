// credential-assessment.mjs — the knowledge check a learner passes to EARN a course-completion credential.
//
// This is "how they get it" for the completion-type credentials: learn the material (Witness School /
// the tutorials), then pass a short assessment → the Academy issues the credential to you. Ministerial
// (ordination) and press credentials do NOT use an assessment — they go through an application /
// affirmation reviewed by the issuing authority (never auto-minted). Pure/offline, soft-fail.

// programId → { pass (min correct), questions: [{ q, options[], answer (index) }] }.
export const ASSESSMENTS = Object.freeze({
  'crypto-blockchain-literacy': {
    pass: 3,
    questions: [
      { q: 'What actually controls a blockchain account?', options: ['A company password you can reset', 'The private keys only you hold', 'Your email address'], answer: 1 },
      { q: 'What is the rule for your seed phrase / private key?', options: ['Share it with support if asked', 'Never share it — anyone who has it controls your funds', 'Post it so you don’t lose it'], answer: 1 },
      { q: 'On MELEK, who produces blocks?', options: ['Miners with the most hashpower', 'Witnesses the community votes for (DPoS)', 'A single company'], answer: 1 },
    ],
  },
  'angelic-ai-foundations': {
    pass: 3,
    questions: [
      { q: 'Where is an AI’s character best kept, so it survives a model change?', options: ['Locked inside one model’s weights', 'In an open, forkable public corpus', 'Nowhere — it can’t be'], answer: 1 },
      { q: 'The reliable way to build with AI is to…', options: ['Assume it already knows everything', 'Point it at good documentation and verify its work', 'Never check its output'], answer: 1 },
      { q: 'Hathor is…', options: ['A hosted chatbot with no chain role', 'An AI witness that participates on the MELEK chain', 'A person'], answer: 1 },
    ],
  },
  'first-amendment-press-religion': {
    pass: 3,
    questions: [
      { q: 'A press pass is issued by…', options: ['The government', 'A news organization', 'A court'], answer: 1 },
      { q: 'Ordination by a church is legitimate because…', options: ['The state licenses ministers', 'Churches may ordain under the free-exercise clause', 'It requires a college degree'], answer: 1 },
      { q: 'The First Amendment protects…', options: ['Only speech', 'Speech, press, religion, assembly, and petition', 'Only religion'], answer: 1 },
    ],
  },
  'plant-medicine-harm-reduction': {
    pass: 3,
    questions: [
      { q: 'Harm reduction means…', options: ['Promoting use', 'Reducing risk and harm to people who use', 'Ignoring safety'], answer: 1 },
      { q: 'Before combining substances you should…', options: ['Nothing — mixing is always fine', 'Check interactions and contraindications', 'Take more of each'], answer: 1 },
      { q: 'This library provides…', options: ['Manufacturing and extraction recipes', 'Reference, history, and safety information', 'Medical prescriptions'], answer: 1 },
    ],
  },
  'ancient-mysteries': {
    pass: 3,
    questions: [
      { q: 'This course is…', options: ['A claim the traditions are literally true', 'A survey and study of the traditions', 'A religion you must join'], answer: 1 },
      { q: 'The Temple’s frame is…', options: ['A single exclusive tradition', 'Syncretic — drawing many traditions together', 'Anti-religious'], answer: 1 },
      { q: 'Mystery traditions were historically…', options: ['Published openly for all at once', 'Initiatory — learned in stages', 'Purely political'], answer: 1 },
    ],
  },
});

/** The assessment for a program, or null (press/ministry have none). */
export function getAssessment(programId) {
  return ASSESSMENTS[String(programId || '')] || null;
}
export function hasAssessment(programId) { return Boolean(getAssessment(programId)); }

/**
 * Score a learner's answers. `answers` is an array of chosen option indices (answers[i] for question i).
 * Returns { ok, passed, correct, total, needed }. Soft-fails to ok:false on an unknown program.
 */
export function scoreAssessment(programId, answers) {
  const a = getAssessment(programId);
  if (!a) return { ok: false, passed: false, correct: 0, total: 0, needed: 0, reason: 'no-assessment' };
  const arr = Array.isArray(answers) ? answers : [];
  let correct = 0;
  a.questions.forEach((qn, i) => { if (Number(arr[i]) === qn.answer) correct += 1; });
  const needed = a.pass || a.questions.length;
  return { ok: true, passed: correct >= needed, correct, total: a.questions.length, needed };
}

// CLI demo (guarded)
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('credential-assessment.mjs')) {
  console.log('assessments:', Object.keys(ASSESSMENTS).length);
  console.log('all-correct crypto:', scoreAssessment('crypto-blockchain-literacy', [1, 1, 1]));
  console.log('one-wrong crypto:', scoreAssessment('crypto-blockchain-literacy', [1, 0, 1]));
  console.log('press has assessment?', hasAssessment('melek-press-pass'));
}
