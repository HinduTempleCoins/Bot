// history.mjs — what actually happened to NaNoWriMo, kept as DATA so the web page, Hathor's post and
// the tests all read the same facts from one place.
//
// THE RULE HERE IS THE LIBRARY'S RULE: every claim carries a grade.
//   'established' — reported by multiple outlets / the organisation itself
//   'contested'   — widely repeated but the detail is disputed or the causation is not supported
//   'unverified'  — circulated in summaries, but we could not confirm it exists
//
// A CORRECTION WORTH KEEPING: four organisations here were briefly marked unverified on the strength
// of ONE broad search that did not surface them. All four are real, with founders, sites and running
// challenges. Absence from a single search result is not absence from the world — when an entity is
// named specifically, search for it specifically before grading it unverified.

export const TIMELINE = [
  { when: '1999', grade: 'established',
    what: 'Chris Baty starts NaNoWriMo with 21 friends in the San Francisco Bay Area. It becomes a non-profit and, at its peak, draws hundreds of thousands of writers a year to the same deal: 50,000 words, 30 days, start November 1.' },
  { when: 'May 2023', grade: 'established',
    what: 'Users raise a child-safety complaint about a long-time volunteer moderator on the Young Writers Program forums — the programme for CHILDREN — alleging that minors were being directed off-platform to adult content. This is the most serious thing in the whole story and the part that deserved the fastest response. Reports describe the organisation as slow to acknowledge or act.' },
  { when: 'November 2023', grade: 'established',
    what: 'The forums are taken down entirely rather than moderated. When the moderator is finally removed it is for unrelated conduct violations — the complaint about children was never what moved them. Deleting the forum destroyed the evidence and the thread the people reporting it had built.' },
  { when: '2023–2024', grade: 'established',
    what: 'Executive director Grant Faulkner departs. Kilby Blades becomes interim executive director. The leadership that had been told about the moderator, and had not acted, was the leadership that left.' },
  { when: 'Early 2024', grade: 'contested',
    what: 'A new contract for Municipal Leaders — the unpaid volunteers who ran local write-ins — is widely reported to have demanded non-disparagement and liability terms that volunteers found unacceptable, prompting resignations. The resignations are well attested; the exact contract terms circulate mostly second-hand.' },
  { when: 'September 2024', grade: 'established',
    what: 'NaNoWriMo publishes a statement describing blanket opposition to generative AI in writing as "classist and ableist." The backlash is immediate: board members Maureen Johnson and Daniel José Older resign, sponsors and authors cut ties. The organisation later walks the wording back. This is the moment most people remember.' },
  { when: 'March 31, 2025', grade: 'established',
    what: 'Interim executive director Kilby Blades announces the non-profit is dissolving. The stated cause is financial: a deficit in four of the previous six years, a 2020 COVID relief loan, and a six-year decline in participation. The organisation explicitly framed it as a long trend rather than a single scandal — the controversies accelerated the loss of donors and trust, they were not the sole cause.' },
  { when: 'After', grade: 'established',
    what: 'The site, the database and the historical archives go offline. Twenty-five years of writers\' records — word counts, forum history, regions, buddy lists — are simply gone. No organisation has revived the name.' },
];

/** Where the 50,000-word challenge actually went. Only entries we could confirm. */
export const SUCCESSORS = [
  { name: 'Novel November (NovNov)', by: 'ProWritingAid', kind: 'commercial',
    what: 'The most prominent organised successor, launched 2025 by a former NaNoWriMo partner. Same 50,000 words, same November, workshops and word-count syncing.' },
  { name: 'Reedsy Novel Sprint', by: 'Reedsy', kind: 'commercial',
    what: 'November 1–30 inside Reedsy Studio. 50,000+ words, cash prizes ($5,000 / $2,500 / $1,000), an agent call and Studio Premium for finishers.' },
  { name: 'NovelEmber', by: 'World Anvil', kind: 'commercial',
    what: 'Created 2024, aimed at fantasy, sci-fi and worldbuilders — worldbuilding articles can count alongside prose.' },
  { name: 'NovelDoctober', by: 'community', kind: 'grassroots',
    what: 'Expanded in 2025 into a community-run November sprint with no central organisation and no fees — a loose federation of Discord servers and hashtags running the same 50k in 30 days.' },
  { name: '4thewords', by: 'independent', kind: 'game',
    what: 'An RPG where your word count is the combat mechanic — you defeat monsters by writing. It absorbed a large share of displaced NaNoWriMo users.' },
  { name: 'Authorlytica', by: 'independent', kind: 'tracker',
    what: 'A year-round tracker: streaks, pace projection, 50,000-word goals in any month, with a free tier.' },
  { name: 'Pathfinders Writing Collective (PaWriCo)', by: 'Rain and Jen', kind: 'grassroots',
    what: 'Founded by two friends who met through NaNoWriMo. Deliberately flexible: you set your own goal and define your own success, over an extended November-to-January window that survives the holidays. Four challenges a year, run through Discord, no fee.' },
  { name: 'Order of the Written Word (O2W)', by: 'Holly Rhiannon', kind: 'grassroots',
    what: 'Founded by a YA author who spent three years as NaNoWriMo\'s Montreal Municipal Liaison, started in direct response to the generative-AI statement. Discord-native, with a Novelist\'s Initiation at 30,000 words and separate poetry and short-story tracks, plus sprint sessions and a word-count bot.' },
  { name: 'NaNo 2.0', by: 'Kristina Horner and Liz Leo', kind: 'grassroots',
    what: 'Built by long-time NaNoWriMo participants to replace the accountability machinery rather than the brand.' },
  { name: 'Novel 90', by: 'AutoCrit', kind: 'commercial',
    what: 'A free 90-day challenge on a different shape entirely: October to plan, November to draft, December to edit. Writers pick a Planner, Pantser or Plantser team with its own coach, plus sprints and daily mail.' },
  { name: 'Local Discords and regional groups', by: 'former Municipal Leaders', kind: 'grassroots',
    what: 'Many of the volunteers who ran local write-ins simply kept running them, independently, without the brand.' },
];

/** Nothing is currently unverified. Kept as a slot, and as a warning about how it got populated. */
export const UNVERIFIED = [];

/** Where we stand, stated rather than implied. Rendered at the top of the history page and carried in
 *  Hathor's post — the operator's instruction is that this must not read as neutral reporting. */
export const POSITION = {
  heading: 'On the child-safety failure',
  body: 'An adult volunteer was accused of using a writing programme for children to move minors toward adult material. The organisation that ran it was told, and was slow. We are against this without qualification and there is no part of it we are neutral about. A report about a child outranks every other consideration an organisation has, including its reputation and its lawyers. When the removal finally came it was for an unrelated rule — that is the organisation telling you what it actually responded to. And deleting the forum destroyed the record the people reporting it had built.',
  // ⭐ BE PRECISE ABOUT WHICH SURFACE. The drafting tool genuinely has no accounts or messaging.
  // MELEK does — it is a blockchain with a blog on it, with accounts, posts and comments. Claiming
  // "nobody can contact anybody here" across both would be false the moment somebody publishes.
  ours: 'Two different things, and the difference matters. THE WRITING TOOL has no accounts, no profiles, no forums, no messaging and no way for one person to reach another — it is a page that saves to your own browser, so there is nothing there to groom anyone through. MELEK IS NOT THAT. It is a public blockchain with a blog on it: accounts, posts, comments, people talking to each other. Anywhere people can reach each other, somebody will try this.',
  stance: 'So our position on MELEK is not a disclaimer. If people use our platforms to groom children, we will do what we can about it — and we would rather be loud about that than quietly hope it never comes up.',
  // The people doing the work, named, because the operator wants them introduced rather than
  // gestured at. Each one checked by name.
  catchers: [
    ['Chris Hansen', '*To Catch a Predator*, and now *Predator Takedown with Chris Hansen*. The one who started the format.'],
    ['Alex Rosen — Predator Poachers', 'Houston, founded 2019. As of late 2025 the group claims arrests in all fifty states and convictions in forty-one.'],
    ['Omma', 'Started catching predators on Discord in 2020 — the platform where a great many children actually are.'],
    ['Skeeter Jean', 'Works as "Skeet Hansen", catching since 2021.'],
    ['JiDion', 'Brings an audience to it that would not otherwise be watching.'],
  ],
  police: 'And the police should get more on board with this, here and everywhere else. Not grudgingly, not after the fact — showing up, taking the handoff seriously, and giving people a legal way to do this so the evidence holds and the case survives court. The catchers keep finding them. The gap is what happens next.',
};

/** The lesson we actually built against. */
export const LESSONS = [
  ['The archive was the real loss.', 'Not the brand — the records. Twenty-five years of word counts and forum history vanished because they lived on one organisation\'s servers, under one organisation\'s budget. A writing tool should not be able to take your work with it when it dies.'],
  ['The child-safety report was the one that mattered and it moved slowest.', 'Reports went to one inbox and sat there, and the volunteers closest to the harm had the least power to act. An organisation that cannot act fast on a complaint about a child has already failed, whatever else it gets right.'],
  ['The AI fight was handled as PR, not as a position.', 'A sweeping claim, a backlash, a walk-back. Writers were never offered a way to simply say what they used.'],
  ['Unpaid volunteers carried it and were the first to be squeezed.', 'The local organisers were the product and were handed liability.'],
  ['Money, not drama, closed it.', 'Four deficit years out of six. The scandals cost trust and donors, but the arithmetic is what ended it.'],
];
