// protest-organizing.mjs — Hathor teaches how to keep a protest ORGANIZED, disciplined, coordinated and
// SAFE. It mines the ORGANIZATIONAL lessons from three lineages and reframes them for lawful, nonviolent
// mass action:
//   • the group-dynamics / "organization of the people" chapters of the declassified CIA manual
//     "Psychological Operations in Guerrilla Warfare" (Tayacán, 1983) — cohesion, cadre→mass structure,
//     recognizing how agitators are USED (so protesters aren't provoked). We take the organizing logic;
//     we REJECT the manual's violent/coercive content entirely.
//   • the Black Panther Party's organizing — the 10-Point program (clear demands), political education,
//     strict discipline, "survival programs" (meeting real needs builds a base), and copwatch, the
//     ancestor of modern legal observing.
//   • the modern nonviolent direct-action backbone: AFFINITY GROUPS + CLUSTERS + a SPOKESCOUNCIL, plus
//     the standard role structure (marshals, legal observers, medics, comms, de-escalators, jail support).
//
// GUARDRAIL in every answer: this is coordination & discipline for SAFE, LAWFUL, NONVIOLENT protest —
// keeping people organized and out of harm's way. Not violence, not the manual's coercive tactics. Laws
// vary; verify locally and work with legal support.

export const GUARDRAIL =
  'Coordination and discipline for safe, lawful, nonviolent protest — keeping people organized and out of '
  + 'harm\'s way. Not violence or coercion. The historical military/guerrilla sources are mined for their '
  + 'ORGANIZATIONAL lessons only. Verify local law; work with legal support.';

export const SOURCES = [
  'CIA, "Psychological Operations in Guerrilla Warfare" (Tayacán, 1983) — group-dynamics/organization chapters only; violent content rejected',
  'Black Panther Party — 10-Point Program, political education, survival programs, discipline, copwatch',
  'Nonviolent direct-action tradition — affinity groups, clusters, spokescouncils (anti-nuclear 1970s → today)',
  'Gene Sharp — methods & dynamics of nonviolent action',
];

const T = {
  structure: {
    title: 'Backbone: affinity groups → clusters → spokescouncil',
    points: [
      'An affinity group is a small team (5–15) of people who trust each other, make decisions together, and stay together during the action. It is the basic unit — decentralized, hard to disrupt, and it looks after its own.',
      'Several affinity groups form a cluster to take on a larger piece (a section of a march, a gate, a stage).',
      'Each group sends ONE delegate to a spokescouncil that coordinates shared decisions — route, timing, legal/jail strategy, contingencies — WITHOUT taking away any group\'s autonomy.',
      'This scales a huge crowd from the bottom up: no single leader to arrest or co-opt, yet the whole stays coordinated.',
    ],
  },
  roles: {
    title: 'Assign the roles before you march',
    points: [
      'Marshals / peacekeepers: keep the march together, hold the line, open lanes for medics, steer people away from crush points.',
      'Legal observers (NLG, green hats): NOT participants — they record police conduct and rights violations.',
      'Street medics: first aid, chemical-irritant care, buddy checks.',
      'Comms team: carries the agreed signals, relays between clusters and the spokescouncil, counters rumors.',
      'De-escalators: calm flashpoints, isolate provocation, protect vulnerable people.',
      'Media / spokesperson: one consistent message; keeps everyone else free to focus.',
      'Police liaison (where appropriate), scouts (watch the perimeter/exits), and jail support (tracks who is arrested, holds lawyer numbers).',
    ],
  },
  cohesion: {
    title: 'Cohesion & morale (the real "psychological operations")',
    points: [
      'The legitimate lesson from group-dynamics doctrine: a crowd holds together on SHARED IDENTITY, a clear just cause, and consistent messaging — not on fear.',
      'Call-and-response chants, songs, and a visible common symbol build unity and keep energy steady through long or tense stretches.',
      'Address people\'s REAL grievances plainly; a movement rooted in genuine needs is cohesive and credible (the opposite of manufactured agitation).',
      'Discipline is kindness here: a calm, united crowd is a safe crowd and a persuasive one.',
    ],
  },
  communication: {
    title: 'Communication discipline',
    points: [
      'Agree on hand signals and a relay chain before you start (crowds are loud and phones fail or are surveilled).',
      'One comms team, one message. Rumors and panic spread faster than facts — route everything through the relay and correct bad info fast.',
      'Set rally points and check-in times; every affinity group knows where to regroup if split.',
      'Assume communications may be monitored; keep sensitive logistics off open channels.',
    ],
  },
  planning: {
    title: 'Plan the action',
    points: [
      'Scout the route, the rally points, the exits, and the hospitals beforehand.',
      'Write a clear start, path, and a DISPERSAL/exit plan — how the action ends safely is as important as how it starts.',
      'Have contingencies: what if a street is blocked, if it\'s kettled, if the weather turns, if someone is arrested or hurt.',
      'Handle permits/legal where they apply; coordinate with legal support in advance; brief everyone on the plan and the agreements.',
    ],
  },
  discipline: {
    title: 'Discipline & spotting provocation',
    points: [
      'Adopt shared action agreements (e.g. a nonviolence guideline) that everyone opts into — it protects the whole crowd.',
      'Learn how agitators and provocateurs are USED (the CIA manual is candid about this): a few people pushing escalation can discredit and endanger thousands. Recognize it and do not take the bait.',
      'De-escalators and marshals calmly isolate anyone trying to start violence; the crowd does not follow them.',
      'Keep the line between your disciplined action and any chaos around it visible — to each other, to the public, and to the cameras.',
    ],
  },
  base: {
    title: 'Base-building (the Black Panther lesson)',
    points: [
      'Meet real material needs first: the Panthers\' survival programs (free breakfast, clinics, mutual aid) built deep community trust and a committed base — organizing is service before it is marching.',
      'Political education: an informed, disciplined membership that understands WHY makes better decisions under pressure.',
      'Build from a small committed, disciplined core outward to mass turnout (the cadre→mass-organization logic, done openly and nonviolently) rather than relying on a one-day crowd.',
      'Copwatch → legal observing: lawful, organized observation of police is community self-defense and accountability.',
    ],
  },
  program: {
    title: 'A clear program / demands',
    points: [
      'Put your goals in a short, concrete platform — the Panthers\' 10-Point Program is the model: specific, memorable demands people can rally around.',
      'A clear program keeps a diverse coalition aligned, gives the media something precise, and outlasts any single event.',
      'Tie every action to the program so momentum compounds instead of scattering.',
    ],
  },
};

const ALIASES = {
  'affinity group': 'structure', spokescouncil: 'structure', cluster: 'structure', structure: 'structure',
  marshal: 'roles', marshals: 'roles', 'legal observer': 'roles', roles: 'roles', jobs: 'roles',
  morale: 'cohesion', unity: 'cohesion', chants: 'cohesion', psyops: 'cohesion', 'psychological': 'cohesion',
  comms: 'communication', communication: 'communication', signals: 'communication',
  plan: 'planning', planning: 'planning', route: 'planning', logistics: 'planning',
  provocateur: 'discipline', agitator: 'discipline', discipline: 'discipline', nonviolence: 'discipline',
  'survival program': 'base', panther: 'base', base: 'base', 'base building': 'base', 'political education': 'base', copwatch: 'base',
  demands: 'program', '10 point': 'program', 'ten point': 'program', program: 'program', platform: 'program',
};

export function topics() { return Object.keys(T); }

/** Teach a protest-organizing topic (or an overview). Always returns the guardrail + sources. */
export function teach(topic = '') {
  const key = String(topic || '').toLowerCase().trim();
  const resolved = T[key] ? key : (ALIASES[key] || null);
  if (!resolved) {
    return { topic: 'overview', title: 'How to keep a protest organized, disciplined & safe',
      sections: topics().map((k) => ({ topic: k, title: T[k].title })),
      intro: 'I can teach: ' + topics().map((k) => T[k].title.toLowerCase()).join('; ') + '.',
      guardrail: GUARDRAIL, sources: SOURCES };
  }
  const s = T[resolved];
  return { topic: resolved, title: s.title, points: s.points, guardrail: GUARDRAIL, sources: SOURCES };
}
