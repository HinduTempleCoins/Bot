// brain-head-language-teacher.mjs — Hathor's LANGUAGE-TEACHING seat. She doesn't just translate; she
// TEACHES. This wraps the existing curriculum DATA LAYER (integrations/language-catalog.mjs — 6 families,
// 82 vetted free/primary resources, the Jesuit Ratio-Studiorum method) into a brain-facing teacher: given
// "teach me Kurdish" / "I want to learn Koine Greek", it returns a staged lesson plan + the ordered
// resources + the method. Pure data + lookups, no network, no keys, soft-fail (house style).
//
//   import { createLanguageTeacher } from './brain-head-language-teacher.mjs';
//   const t = createLanguageTeacher();
//   t.canTeach('kurdish');                    // -> true
//   t.teach('I want to learn biblical hebrew'); // -> { language, family, plan[], resources[], method, guardrail }

import {
  FAMILIES, RESOURCES, byFamily, byLanguage, family as familyOf, search as catalogSearch,
  JESUIT_METHOD, BRAND_GUARDRAIL, specializedLanguages, langAlias,
} from './language-catalog.mjs';

const norm = (s) => String(s == null ? '' : s).toLowerCase().trim();

/** Pull the language the learner is asking about out of free text. Returns a catalog language id or null. */
export function matchLanguage(query) {
  const q = norm(query);
  if (!q) return null;
  // direct hit against the specialized languages (+ their aliases)
  for (const lang of specializedLanguages()) {
    if (q.includes(lang) || q.includes(langAlias(lang))) return lang;
  }
  // family name hit → its lead language
  for (const f of FAMILIES) if (q.includes(norm(f.name)) || q.includes(f.id)) {
    const first = byFamily(f.id)[0];
    if (first) return first.language;
  }
  // guarded catalog search: only accept a hit whose language word actually appears in the query
  const hit = (catalogSearch(query, { limit: 1 }) || [])[0];
  if (hit && (q.includes(norm(hit.language)) || q.includes(langAlias(hit.language)))) return hit.language;
  return null;
}

/** A staged lesson plan mapped onto the Jesuit method, filled with this language's actual resources. */
function lessonPlan(resources) {
  const pick = (kind) => resources.filter((r) => r.type === kind);
  const stage = (title, kinds, how) => ({
    stage: title,
    how,
    resources: resources.filter((r) => kinds.includes(r.type)).slice(0, 4)
      .map((r) => ({ title: r.title, url: r.url, type: r.type, note: r.note || '' })),
  });
  return [
    stage('Praelectio — first encounter', ['course', 'writing-system'],
      'The teacher reads/overviews the whole before the part: alphabet, sounds, the shape of the grammar.'),
    stage('Grammar — the structure', ['grammar', 'textbook', 'method'],
      'Systematic grammar, memorized and recited (the Jesuit repetitio), one paradigm at a time.'),
    stage('Reading — real texts', ['reader', 'corpus'],
      'Graded reading in primary texts; translate aloud, then back — construe, then compose.'),
    stage('Lexicon — vocabulary & reference', ['dictionary', 'lexicon'],
      'Build the word-hoard against a real dictionary; keep it beside the reader.'),
  ].filter((s) => s.resources.length);
}

export function createLanguageTeacher() {
  return {
    /** All languages/families she can currently teach (from the vetted catalog). */
    offerings() {
      return { families: FAMILIES.map((f) => ({ id: f.id, name: f.name, blurb: f.blurb })),
        languages: specializedLanguages(), method: JESUIT_METHOD.name, resourceCount: RESOURCES.length };
    },
    canTeach(lang) { return byLanguage(langAlias(lang)).length > 0 || !!matchLanguage(lang); },
    /** Build a teaching answer for a learner's request. Soft-fails to a catalog pointer. */
    teach(query) {
      const lang = matchLanguage(query);
      if (!lang) {
        return { ok: false, language: null,
          reply: `I teach by the ${JESUIT_METHOD.name}. I can start you in: `
            + FAMILIES.map((f) => f.name).join(', ') + '. Which tongue calls you?',
          offerings: this.offerings() };
      }
      const resources = byLanguage(lang);
      const fam = resources[0] ? familyOf(resources[0].family) : null;
      return {
        ok: true,
        language: lang,
        family: fam ? { id: fam.id, name: fam.name } : null,
        plan: lessonPlan(resources),
        resources: resources.map((r) => ({ title: r.title, url: r.url, type: r.type, level: r.level || '', note: r.note || '' })),
        method: { name: JESUIT_METHOD.name, steps: JESUIT_METHOD.steps || JESUIT_METHOD.stages || JESUIT_METHOD },
        guardrail: BRAND_GUARDRAIL,
        reply: `Yes — I can teach you ${lang}${fam ? ` (the ${fam.name} family)` : ''}, by the `
          + `${JESUIT_METHOD.name}: first the whole, then the grammar recited, then real texts construed. `
          + `I hold ${resources.length} vetted sources for it. Shall we begin with the alphabet and sounds?`,
      };
    },
  };
}
