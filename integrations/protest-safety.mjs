// protest-safety.mjs — Hathor teaches people how to STAY SAFE in an aggressive protest. Defensive,
// harm-reduction, know-your-rights — how to protect yourself and others, read a crowd, survive a crush,
// handle chemical irritants, give basic street-medic aid, and keep your legal rights. In the lineage of
// Abbie Hoffman's "Steal This Book" (survival + movement self-defense), grounded in modern street-medic
// and ACLU / National Lawyers Guild know-your-rights practice.
//
// GUARDRAIL baked into every answer: this is SELF-PROTECTION and your legal RIGHTS — de-escalation, first
// aid, and staying safe. It is not instruction to commit violence or crimes. Laws vary by jurisdiction;
// verify local rules and carry a real legal-aid / jail-support number. In a medical emergency, get real
// medical help.
//
//   import { teach, topics } from './protest-safety.mjs';
//   teach('tear gas');  teach('crush');  teach('rights');  teach();  // overview

export const GUARDRAIL =
  'Self-protection and your legal rights, not instruction to commit violence or crimes. Laws vary by place '
  + '— verify local rules, carry a legal-aid number, and get real medical help in an emergency.';

export const SOURCES = [
  'Abbie Hoffman, "Steal This Book" (1971) — movement survival in its historical frame',
  'ACLU — Know Your Rights: Protesters',
  'National Lawyers Guild — Legal Observers & jail support',
  'Street-medic guides (e.g. Riot Medicine; chemical-weapons response)',
];

const T = {
  prepare: {
    title: 'Before you go — plan & kit',
    points: [
      'Go with a buddy; agree on a meetup spot and a time to check in. Tell someone not attending where you are.',
      'Write a legal-aid / jail-support phone number on your arm in permanent marker (phones get lost or seized).',
      'Dress to protect: cover skin, sturdy closed shoes, no loose hair/jewelry, swap contacts for glasses (irritants trap under lenses).',
      'Bring: water (drinking + flushing), any required meds, a small first-aid item, ID only if you choose to. Leave nonessential data off your phone.',
      'Know the map before you arrive: streets, exits, hospitals, and a few ways out.',
    ],
  },
  awareness: {
    title: 'Situational awareness',
    points: [
      'Stay toward the edges where you can leave; avoid getting boxed between barriers, buildings, and police lines.',
      'Keep identifying exits as you move. Note where the crowd is densest and avoid funnels/chokepoints.',
      'Watch the crowd\'s mood and movement, and the posture of police — sudden line changes, helmets/gas masks going on, or kettling (encirclement) are warnings to move.',
      'Trust a bad feeling and leave early; it is always easier to exit before a surge than during one.',
    ],
  },
  crush: {
    title: 'Surviving a crowd crush / surge',
    points: [
      'Crushes injure by compression, not trampling — the danger is being unable to breathe while standing.',
      'Stay on your feet at all costs; if you go down, get up fast or curl on your side with arms up to make an air pocket around your chest.',
      'Keep your arms up in a boxer\'s guard to protect your ribcage and keep room to breathe.',
      'Move WITH the crowd and diagonally toward the edges during lulls — never push against the flow.',
      'Never bend to pick up a dropped phone or shoe in a dense crowd. Save your breath; conserve energy.',
    ],
  },
  chemical: {
    title: 'Tear gas & pepper spray',
    points: [
      'Move upwind and uphill, calmly — do not run blind or you will fall or start a panic.',
      'Do NOT rub your eyes or face; that grinds it in. Keep hands away.',
      'Flush eyes and skin with lots of plain water or saline. (Milk/antacid folklore is not better than water and can cause infection.)',
      'Remove contact lenses as soon as you safely can; they trap chemicals against the eye.',
      'Protection that works: sealed goggles + a fitted respirator (N95 minimum, P100 better). Exposed skin recovers; cover what you can.',
      'Blow your nose, spit, and breathe slowly; the burning peaks fast and fades once you are in clean air.',
    ],
  },
  firstaid: {
    title: 'Street-medic basics',
    points: [
      'Buddy checks: watch each other for distress, overheating, panic, or injury.',
      'Eye flush: head tilted so runoff goes away from the other eye / nose; flush inner-to-outer with water or saline.',
      'Heat: shade, water, rest; watch for dizziness/confusion (heat illness is an emergency).',
      'Bleeding: direct pressure. Head injury, trouble breathing, chest compression, or confusion = get real medical help now.',
      'You are first aid, not a hospital — stabilize, reassure, and escalate to EMS/medics for anything serious.',
    ],
  },
  rights: {
    title: 'Know your rights (US; verify locally)',
    points: [
      'In traditional public forums (streets, sidewalks, parks) you have strong rights to assemble and protest.',
      'You can photograph/record police in public doing their jobs. They may not delete your footage.',
      'If stopped: stay calm, keep hands visible, do not run or resist even if you believe it is unlawful — contest it later.',
      'You can say: "I am going to remain silent. Am I free to leave?" If free, walk away calmly; if detained, say you want a lawyer and stop talking.',
      'You do not have to consent to a search; say "I do not consent to this search" (they may search anyway — you preserve the challenge).',
      'Permits may be required for some marches/amplified sound, but not for spontaneous assembly on sidewalks — rules vary by city.',
    ],
  },
  deescalation: {
    title: 'De-escalation & protecting others',
    points: [
      'A calm voice and open posture lower tension; do not match aggression.',
      'Put yourself between a threat and a vulnerable person only if you can do it safely; create space and exits.',
      'Discourage others from throwing the first escalation — it endangers everyone and is what provocateurs want.',
      'Help people who are gassed, panicking, or down — a hand on the shoulder and "I\'ve got you, this way" is medicine.',
    ],
  },
  digital: {
    title: 'Phone & digital safety',
    points: [
      'Use a strong PIN, not face/fingerprint unlock (a passcode has more legal protection and can\'t be forced onto you as easily).',
      'Use an encrypted messenger (Signal) with disappearing messages; turn off message previews.',
      'Consider airplane mode or a cheap secondary phone; location and device data can be collected.',
      'Back up and then minimize sensitive data before you go; know how to quick-disable biometrics on your phone.',
    ],
  },
  after: {
    title: 'After / aftercare',
    points: [
      'Rinse clothes separately; residual chemicals transfer. Shower in cool water first (hot opens pores and reactivates sting).',
      'Rest, rehydrate, debrief with your buddy; protest stress is real — decompress.',
      'Photograph any injuries and note times/badge numbers; contact legal support if you or anyone was arrested or hurt.',
    ],
  },
};

const ALIASES = {
  'tear gas': 'chemical', 'pepper spray': 'chemical', 'gas': 'chemical', 'mace': 'chemical',
  stampede: 'crush', surge: 'crush', trample: 'crush', 'crowd crush': 'crush',
  legal: 'rights', 'know your rights': 'rights', arrest: 'rights', detained: 'rights', police: 'rights',
  medic: 'firstaid', 'first aid': 'firstaid', injury: 'firstaid',
  calm: 'deescalation', phone: 'digital', security: 'digital', kit: 'prepare', prep: 'prepare', before: 'prepare',
};

export function topics() { return Object.keys(T); }

/** Teach a protest-safety topic (or an overview). Always returns the guardrail + sources. */
export function teach(topic = '') {
  const key = String(topic || '').toLowerCase().trim();
  const resolved = T[key] ? key : (ALIASES[key] || null);
  if (!resolved) {
    return {
      topic: 'overview',
      title: 'How to stay safe in an aggressive protest',
      sections: topics().map((k) => ({ topic: k, title: T[k].title })),
      intro: 'I can teach: ' + topics().map((k) => T[k].title.toLowerCase()).join('; ') + '.',
      guardrail: GUARDRAIL, sources: SOURCES,
    };
  }
  const s = T[resolved];
  return { topic: resolved, title: s.title, points: s.points, guardrail: GUARDRAIL, sources: SOURCES };
}
