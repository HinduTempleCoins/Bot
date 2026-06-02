// integrations/soapbox/wikis-catalog.mjs
//
// WIKIS CATALOG — a broad, cross-domain catalog of public wikis and
// encyclopedias for the SoapBox Resource Center / Directory (operator task #185).
//
// WHY THIS EXISTS
// ---------------
// Most of these are MediaWiki (or the Fandom fork of MediaWiki), which means they
// are *parseable and linkable* through a uniform HTTP API. Two API shapes cover
// nearly the whole list:
//
//   1. action API:  <origin>/w/api.php?action=query&format=json&...
//                   (also …?action=parse, …?action=opensearch for search)
//   2. REST v1:     <origin>/api/rest_v1/page/summary/<Title>
//                   (clean per-page summary/extract/HTML; Wikimedia + many others)
//
// IMPORTANT: **Fandom and Wikimedia share the MediaWiki API shape.** A Fandom wiki
// at https://<wiki>.fandom.com exposes the same action API at
// https://<wiki>.fandom.com/api.php (note: Fandom serves api.php at the wiki root,
// not under /w/). So a single MediaWiki client can fan out across this entire
// catalog with only a per-entry base URL swap. That is what makes this list the
// bulk-ingest target list for the booklore scraper (task #126): point it at
// `mediawikiApis()` and it can enumerate, search, and pull page extracts uniformly.
//
// `engine` legend:
//   'mediawiki' — self-hosted / institutional MediaWiki (api.php available)
//   'fandom'    — Fandom-hosted MediaWiki (api.php at wiki root; shared shape)
//   'other'     — bespoke CMS / static / non-MediaWiki (no uniform api)
//
// `api` is the base for the action API (api.php) or REST root when known. Where a
// site is MediaWiki but the exact api.php path is unverified, `api` is omitted and
// the entry still counts as engine:'mediawiki' for human reference only.
//
// Anchor example (operator): the Wikipedia "Head cone" article on Egyptian
// wax/perfume head cones is included under History/Humanities as the canonical
// reference point against our own generated 'Egyptian Wax Headcones' wiki article.

export const WIKIS = [
  // ─────────────────────────────────────────────────────────────────────────
  // GENERAL ENCYCLOPEDIAS — Wikimedia family
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Wikipedia (English)',
    url: 'https://en.wikipedia.org/',
    category: 'General encyclopedias',
    engine: 'mediawiki',
    api: 'https://en.wikipedia.org/w/api.php',
    lang: 'en',
    notes: 'Flagship encyclopedia. Also REST: https://en.wikipedia.org/api/rest_v1/.',
  },
  {
    name: 'Wiktionary (English)',
    url: 'https://en.wiktionary.org/',
    category: 'General encyclopedias',
    engine: 'mediawiki',
    api: 'https://en.wiktionary.org/w/api.php',
    lang: 'en',
    notes: 'Multilingual dictionary/thesaurus. Same Wikimedia action+REST API.',
  },
  {
    name: 'Wikidata',
    url: 'https://www.wikidata.org/',
    category: 'General encyclopedias',
    engine: 'mediawiki',
    api: 'https://www.wikidata.org/w/api.php',
    lang: 'mul',
    notes: 'Structured knowledge graph; also SPARQL at query.wikidata.org. wbgetentities.',
  },
  {
    name: 'Wikisource (English)',
    url: 'https://en.wikisource.org/',
    category: 'General encyclopedias',
    engine: 'mediawiki',
    api: 'https://en.wikisource.org/w/api.php',
    lang: 'en',
    notes: 'Free library of source texts. Useful for verbatim corpus ingest.',
  },
  {
    name: 'Wikivoyage (English)',
    url: 'https://en.wikivoyage.org/',
    category: 'General encyclopedias',
    engine: 'mediawiki',
    api: 'https://en.wikivoyage.org/w/api.php',
    lang: 'en',
    notes: 'Travel guide.',
  },
  {
    name: 'Wikibooks (English)',
    url: 'https://en.wikibooks.org/',
    category: 'General encyclopedias',
    engine: 'mediawiki',
    api: 'https://en.wikibooks.org/w/api.php',
    lang: 'en',
    notes: 'Open-content textbooks/manuals.',
  },
  {
    name: 'Wikiquote (English)',
    url: 'https://en.wikiquote.org/',
    category: 'General encyclopedias',
    engine: 'mediawiki',
    api: 'https://en.wikiquote.org/w/api.php',
    lang: 'en',
    notes: 'Sourced quotations.',
  },
  {
    name: 'Wikispecies',
    url: 'https://species.wikimedia.org/',
    category: 'Nature / herbal / medical',
    engine: 'mediawiki',
    api: 'https://species.wikimedia.org/w/api.php',
    lang: 'mul',
    notes: 'Taxonomic directory of life. Cross-listed under General/Wikimedia.',
  },
  {
    name: 'Wikinews (English)',
    url: 'https://en.wikinews.org/',
    category: 'General encyclopedias',
    engine: 'mediawiki',
    api: 'https://en.wikinews.org/w/api.php',
    lang: 'en',
    notes: 'Citizen journalism.',
  },
  {
    name: 'Wikimedia Commons',
    url: 'https://commons.wikimedia.org/',
    category: 'General encyclopedias',
    engine: 'mediawiki',
    api: 'https://commons.wikimedia.org/w/api.php',
    lang: 'mul',
    notes: 'Media repository; imageinfo/structured-data via the same API.',
  },
  {
    name: 'Meta-Wiki',
    url: 'https://meta.wikimedia.org/',
    category: 'General encyclopedias',
    engine: 'mediawiki',
    api: 'https://meta.wikimedia.org/w/api.php',
    lang: 'mul',
    notes: 'Wikimedia coordination wiki; hosts "List of largest wikis".',
  },
  {
    name: 'MediaWiki.org',
    url: 'https://www.mediawiki.org/',
    category: 'Science / math / tech',
    engine: 'mediawiki',
    api: 'https://www.mediawiki.org/w/api.php',
    lang: 'en',
    notes: 'Docs for the engine itself; canonical api.php reference.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GENERAL ENCYCLOPEDIAS — non-Wikimedia
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Encyclopædia Britannica',
    url: 'https://www.britannica.com/',
    category: 'General encyclopedias',
    engine: 'other',
    lang: 'en',
    notes: 'Bespoke CMS, not MediaWiki. No open api.php; scrape per-page only.',
  },
  {
    name: 'Scholarpedia',
    url: 'http://www.scholarpedia.org/',
    category: 'Science / math / tech',
    engine: 'mediawiki',
    api: 'http://www.scholarpedia.org/w/api.php',
    lang: 'en',
    notes: 'Peer-reviewed MediaWiki encyclopedia (neuroscience, dynamical systems).',
  },
  {
    name: 'Citizendium',
    url: 'https://citizendium.org/',
    category: 'General encyclopedias',
    engine: 'mediawiki',
    api: 'https://citizendium.org/wiki/api.php',
    lang: 'en',
    notes: 'Expert-curated MediaWiki fork of the original Wikipedia model.',
  },
  {
    name: 'Infogalactic',
    url: 'https://infogalactic.com/',
    category: 'General encyclopedias',
    engine: 'mediawiki',
    api: 'https://infogalactic.com/w/api.php',
    lang: 'en',
    notes: 'MediaWiki Wikipedia fork ("Planetary Knowledge Core").',
  },
  {
    name: 'Everybodywiki',
    url: 'https://en.everybodywiki.com/',
    category: 'General encyclopedias',
    engine: 'mediawiki',
    api: 'https://en.everybodywiki.com/api.php',
    lang: 'en',
    notes: 'Inclusionist MediaWiki encyclopedia; mirrors Wikipedia deletions.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // FANDOM / ENTERTAINMENT — games
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Minecraft Wiki',
    url: 'https://minecraft.wiki/',
    category: 'Fandom / entertainment',
    engine: 'mediawiki',
    api: 'https://minecraft.wiki/api.php',
    lang: 'en',
    notes: 'Independent (left Fandom). MediaWiki api.php at root.',
  },
  {
    name: 'RuneScape Wiki (RS Wiki)',
    url: 'https://runescape.wiki/',
    category: 'Fandom / entertainment',
    engine: 'mediawiki',
    api: 'https://runescape.wiki/api.php',
    lang: 'en',
    notes: 'Independent (weirdgloop). Sister: oldschool.runescape.wiki.',
  },
  {
    name: 'Old School RuneScape Wiki',
    url: 'https://oldschool.runescape.wiki/',
    category: 'Fandom / entertainment',
    engine: 'mediawiki',
    api: 'https://oldschool.runescape.wiki/api.php',
    lang: 'en',
    notes: 'Independent weirdgloop wiki. Clean api.php.',
  },
  {
    name: 'Wowpedia (World of Warcraft)',
    url: 'https://wowpedia.fandom.com/',
    category: 'Fandom / entertainment',
    engine: 'fandom',
    api: 'https://wowpedia.fandom.com/api.php',
    lang: 'en',
    notes: 'Fandom-hosted. (Active fork: warcraft.wiki.gg, also MediaWiki.)',
  },
  {
    name: 'Zelda Wiki (Zeldapedia)',
    url: 'https://zelda.fandom.com/',
    category: 'Fandom / entertainment',
    engine: 'fandom',
    api: 'https://zelda.fandom.com/api.php',
    lang: 'en',
    notes: 'Fandom-hosted. Independent fork at zeldawiki.wiki.',
  },
  {
    name: 'Bulbapedia (Pokémon)',
    url: 'https://bulbapedia.bulbagarden.net/',
    category: 'Fandom / entertainment',
    engine: 'mediawiki',
    api: 'https://bulbapedia.bulbagarden.net/w/api.php',
    lang: 'en',
    notes: 'Independent MediaWiki; one of the largest fan wikis.',
  },
  {
    name: 'Final Fantasy Wiki',
    url: 'https://finalfantasy.fandom.com/',
    category: 'Fandom / entertainment',
    engine: 'fandom',
    api: 'https://finalfantasy.fandom.com/api.php',
    lang: 'en',
    notes: 'Fandom-hosted; among the largest fannish wikis.',
  },
  {
    name: 'UESP (Unofficial Elder Scrolls Pages)',
    url: 'https://en.uesp.net/',
    category: 'Fandom / entertainment',
    engine: 'mediawiki',
    api: 'https://en.uesp.net/w/api.php',
    lang: 'en',
    notes: 'Independent MediaWiki; deep Elder Scrolls reference.',
  },
  {
    name: 'Terraria Wiki',
    url: 'https://terraria.wiki.gg/',
    category: 'Fandom / entertainment',
    engine: 'mediawiki',
    api: 'https://terraria.wiki.gg/api.php',
    lang: 'en',
    notes: 'Official, wiki.gg-hosted MediaWiki.',
  },
  {
    name: 'Stardew Valley Wiki',
    url: 'https://stardewvalleywiki.com/',
    category: 'Fandom / entertainment',
    engine: 'mediawiki',
    api: 'https://stardewvalleywiki.com/mediawiki/api.php',
    lang: 'en',
    notes: 'Independent MediaWiki; api.php under /mediawiki/.',
  },
  {
    name: 'Fandom (Community Central hub)',
    url: 'https://community.fandom.com/',
    category: 'Fandom / entertainment',
    engine: 'fandom',
    api: 'https://community.fandom.com/api.php',
    lang: 'en',
    notes: 'Hub for hundreds of thousands of Fandom wikis; all share api.php shape.',
  },
  {
    name: 'GamePedia / wiki.gg network',
    url: 'https://www.wiki.gg/',
    category: 'Fandom / entertainment',
    engine: 'mediawiki',
    lang: 'en',
    notes: 'Independent game-wiki network (Terraria, Don\'t Starve, etc.); per-wiki api.php.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // FANDOM / ENTERTAINMENT — film / TV
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Memory Alpha (Star Trek)',
    url: 'https://memory-alpha.fandom.com/',
    category: 'Fandom / entertainment',
    engine: 'fandom',
    api: 'https://memory-alpha.fandom.com/api.php',
    lang: 'en',
    notes: 'Canonical Star Trek wiki; Fandom-hosted MediaWiki.',
  },
  {
    name: 'Wookieepedia (Star Wars)',
    url: 'https://starwars.fandom.com/',
    category: 'Fandom / entertainment',
    engine: 'fandom',
    api: 'https://starwars.fandom.com/api.php',
    lang: 'en',
    notes: 'Largest Star Wars wiki; Fandom-hosted.',
  },
  {
    name: 'Marvel Cinematic Universe Wiki',
    url: 'https://marvelcinematicuniverse.fandom.com/',
    category: 'Fandom / entertainment',
    engine: 'fandom',
    api: 'https://marvelcinematicuniverse.fandom.com/api.php',
    lang: 'en',
    notes: 'MCU film/TV reference; Fandom-hosted.',
  },
  {
    name: 'Game of Thrones Wiki',
    url: 'https://gameofthrones.fandom.com/',
    category: 'Fandom / entertainment',
    engine: 'fandom',
    api: 'https://gameofthrones.fandom.com/api.php',
    lang: 'en',
    notes: 'A Song of Ice and Fire / HBO show wiki.',
  },
  {
    name: 'Disney Wiki',
    url: 'https://disney.fandom.com/',
    category: 'Fandom / entertainment',
    engine: 'fandom',
    api: 'https://disney.fandom.com/api.php',
    lang: 'en',
    notes: 'Fandom-hosted.',
  },
  {
    name: 'Wikitubia (YouTube)',
    url: 'https://youtube.fandom.com/',
    category: 'Fandom / entertainment',
    engine: 'fandom',
    api: 'https://youtube.fandom.com/api.php',
    lang: 'en',
    notes: 'Fandom-hosted creator reference.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // FANDOM / ENTERTAINMENT — anime / manga
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Fandom Anime Hub',
    url: 'https://www.fandom.com/topics/anime',
    category: 'Fandom / entertainment',
    engine: 'fandom',
    lang: 'en',
    notes: 'Index of anime wikis; each sub-wiki has its own api.php.',
  },
  {
    name: 'One Piece Wiki',
    url: 'https://onepiece.fandom.com/',
    category: 'Fandom / entertainment',
    engine: 'fandom',
    api: 'https://onepiece.fandom.com/api.php',
    lang: 'en',
    notes: 'One of the largest anime wikis; Fandom-hosted.',
  },
  {
    name: 'Naruto Wiki (Narutopedia)',
    url: 'https://naruto.fandom.com/',
    category: 'Fandom / entertainment',
    engine: 'fandom',
    api: 'https://naruto.fandom.com/api.php',
    lang: 'en',
    notes: 'Fandom-hosted.',
  },
  {
    name: 'Dragon Ball Wiki',
    url: 'https://dragonball.fandom.com/',
    category: 'Fandom / entertainment',
    engine: 'fandom',
    api: 'https://dragonball.fandom.com/api.php',
    lang: 'en',
    notes: 'Fandom-hosted.',
  },
  {
    name: 'AniDB',
    url: 'https://anidb.net/',
    category: 'Fandom / entertainment',
    engine: 'other',
    lang: 'en',
    notes: 'Specialized anime database, not MediaWiki; HTTP API exists but bespoke.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SCIENCE / MATH / TECH
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Wolfram MathWorld',
    url: 'https://mathworld.wolfram.com/',
    category: 'Science / math / tech',
    engine: 'other',
    lang: 'en',
    notes: 'Authoritative math reference; bespoke CMS, not MediaWiki.',
  },
  {
    name: 'nLab',
    url: 'https://ncatlab.org/nlab/',
    category: 'Science / math / tech',
    engine: 'other',
    lang: 'en',
    notes: 'Category-theory wiki on Instiki (not MediaWiki). Pages at /nlab/show/<topic>.',
  },
  {
    name: 'Stanford Encyclopedia of Philosophy',
    url: 'https://plato.stanford.edu/',
    category: 'Science / math / tech',
    engine: 'other',
    lang: 'en',
    notes: 'Peer-reviewed; static per-entry pages, not MediaWiki. Stable /entries/ URLs.',
  },
  {
    name: 'Encyclopedia of Mathematics',
    url: 'https://encyclopediaofmath.org/',
    category: 'Science / math / tech',
    engine: 'mediawiki',
    api: 'https://encyclopediaofmath.org/api.php',
    lang: 'en',
    notes: 'Springer/EMS MediaWiki. Clean action API.',
  },
  {
    name: 'ProofWiki',
    url: 'https://proofwiki.org/',
    category: 'Science / math / tech',
    engine: 'mediawiki',
    api: 'https://proofwiki.org/w/api.php',
    lang: 'en',
    notes: 'Compendium of mathematical proofs on MediaWiki.',
  },
  {
    name: 'OEIS (On-Line Encyclopedia of Integer Sequences)',
    url: 'https://oeis.org/',
    category: 'Science / math / tech',
    engine: 'other',
    lang: 'en',
    notes: 'Bespoke; JSON search API at https://oeis.org/search?fmt=json&q=... Not MediaWiki.',
  },
  {
    name: 'Rosetta Code',
    url: 'https://rosettacode.org/',
    category: 'Science / math / tech',
    engine: 'mediawiki',
    api: 'https://rosettacode.org/w/api.php',
    lang: 'en',
    notes: 'Programming-task chrestomathy on MediaWiki.',
  },
  {
    name: 'Arch Linux Wiki (ArchWiki)',
    url: 'https://wiki.archlinux.org/',
    category: 'Science / math / tech',
    engine: 'mediawiki',
    api: 'https://wiki.archlinux.org/api.php',
    lang: 'en',
    notes: 'Premier Linux documentation wiki; MediaWiki api.php at root.',
  },
  {
    name: 'Gentoo Wiki',
    url: 'https://wiki.gentoo.org/',
    category: 'Science / math / tech',
    engine: 'mediawiki',
    api: 'https://wiki.gentoo.org/api.php',
    lang: 'en',
    notes: 'Official Gentoo Linux documentation on MediaWiki.',
  },
  {
    name: 'Wikitech (Wikimedia infra)',
    url: 'https://wikitech.wikimedia.org/',
    category: 'Science / math / tech',
    engine: 'mediawiki',
    api: 'https://wikitech.wikimedia.org/w/api.php',
    lang: 'en',
    notes: 'Wikimedia ops/infra documentation.',
  },
  {
    name: 'ESolangs (Esoteric Languages Wiki)',
    url: 'https://esolangs.org/',
    category: 'Science / math / tech',
    engine: 'mediawiki',
    api: 'https://esolangs.org/w/api.php',
    lang: 'en',
    notes: 'MediaWiki catalog of esoteric programming languages.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // NATURE / HERBAL / MEDICAL
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'WikiDoc',
    url: 'https://www.wikidoc.org/',
    category: 'Nature / herbal / medical',
    engine: 'mediawiki',
    api: 'https://www.wikidoc.org/api.php',
    lang: 'en',
    notes: 'Collaborative medical encyclopedia on MediaWiki.',
  },
  {
    name: 'WikiVet',
    url: 'https://en.wikivet.net/',
    category: 'Nature / herbal / medical',
    engine: 'mediawiki',
    api: 'https://en.wikivet.net/api.php',
    lang: 'en',
    notes: 'Veterinary education MediaWiki (login may gate some content).',
  },
  {
    name: 'Plants For A Future (PFAF)',
    url: 'https://pfaf.org/',
    category: 'Nature / herbal / medical',
    engine: 'other',
    lang: 'en',
    notes: 'Edible/medicinal plant database; bespoke CMS, not MediaWiki.',
  },
  {
    name: 'iNaturalist',
    url: 'https://www.inaturalist.org/',
    category: 'Nature / herbal / medical',
    engine: 'other',
    lang: 'en',
    notes: 'Biodiversity observations; REST JSON API at api.inaturalist.org. Not MediaWiki.',
  },
  {
    name: 'Useful Temperate Plants',
    url: 'https://temperate.theferns.info/',
    category: 'Nature / herbal / medical',
    engine: 'other',
    lang: 'en',
    notes: 'Herbal/edible plant database (Ken Fern). Bespoke; not MediaWiki.',
  },
  {
    name: 'Practical Plants',
    url: 'https://practicalplants.org/',
    category: 'Nature / herbal / medical',
    engine: 'mediawiki',
    api: 'https://practicalplants.org/w/api.php',
    lang: 'en',
    notes: 'Permaculture plant wiki on MediaWiki (semantic).',
  },
  {
    name: 'Wikispecies (taxonomy)',
    url: 'https://species.wikimedia.org/',
    category: 'Nature / herbal / medical',
    engine: 'mediawiki',
    api: 'https://species.wikimedia.org/w/api.php',
    lang: 'mul',
    notes: 'Taxonomic backbone; same Wikimedia API. (Also referenced above.)',
  },
  {
    name: 'Ganfyd',
    url: 'https://www.ganfyd.org/',
    category: 'Nature / herbal / medical',
    engine: 'mediawiki',
    api: 'https://www.ganfyd.org/api.php',
    lang: 'en',
    notes: 'Clinician-edited medical reference on MediaWiki.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // HISTORY / HUMANITIES / RELIGION
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'World History Encyclopedia (formerly Ancient History Enc.)',
    url: 'https://www.worldhistory.org/',
    category: 'History / humanities / religion',
    engine: 'other',
    lang: 'en',
    notes: 'Editorial CMS, not MediaWiki. Has a partner REST API (registration).',
  },
  {
    name: 'Livius.org',
    url: 'https://www.livius.org/',
    category: 'History / humanities / religion',
    engine: 'other',
    lang: 'en',
    notes: 'Ancient-history reference (Jona Lendering); static CMS, not MediaWiki.',
  },
  {
    name: 'Theoi Greek Mythology',
    url: 'https://www.theoi.com/',
    category: 'History / humanities / religion',
    engine: 'other',
    lang: 'en',
    notes: 'Greek-myth source compendium; static site, not MediaWiki.',
  },
  {
    name: 'Internet Sacred Text Archive',
    url: 'https://sacred-texts.com/',
    category: 'History / humanities / religion',
    engine: 'other',
    lang: 'en',
    notes: 'Large religious/esoteric text library; static, not MediaWiki. Verbatim corpus.',
  },
  {
    name: 'Behind the Name',
    url: 'https://www.behindthename.com/',
    category: 'History / humanities / religion',
    engine: 'other',
    lang: 'en',
    notes: 'Etymology of given names; bespoke, JSON API available with key. Not MediaWiki.',
  },
  {
    name: 'Wikipedia — "Head cone" (Egyptian wax/perfume cones)',
    url: 'https://en.wikipedia.org/wiki/Head_cone',
    category: 'History / humanities / religion',
    engine: 'mediawiki',
    api: 'https://en.wikipedia.org/w/api.php',
    lang: 'en',
    notes:
      'ANCHOR EXAMPLE (#185). Canonical reference on ancient-Egyptian wax/perfume ' +
      'head cones: conical head ornaments of oils/resins/fat (likely beeswax) that ' +
      'melted with body heat to perfume the wearer; long known only from tomb art ' +
      'until physical specimens were excavated at Amarna (2009, published 2019). ' +
      'Compare against our generated "Egyptian Wax Headcones" article.',
  },
  {
    name: 'New World Encyclopedia',
    url: 'https://www.newworldencyclopedia.org/',
    category: 'History / humanities / religion',
    engine: 'mediawiki',
    api: 'https://www.newworldencyclopedia.org/p/index.php?api.php',
    lang: 'en',
    notes: 'Curated MediaWiki encyclopedia (humanities-leaning). Index at /entry/.',
  },
  {
    name: 'WikiTree (genealogy)',
    url: 'https://www.wikitree.com/',
    category: 'History / humanities / religion',
    engine: 'other',
    lang: 'en',
    notes: 'Genealogy; bespoke platform with its own API. Not MediaWiki.',
  },
  {
    name: 'Religions Wiki',
    url: 'https://religion.fandom.com/',
    category: 'History / humanities / religion',
    engine: 'fandom',
    api: 'https://religion.fandom.com/api.php',
    lang: 'en',
    notes: 'Fandom-hosted comparative-religion wiki.',
  },
  {
    name: 'Mythology Wiki',
    url: 'https://mythology.fandom.com/',
    category: 'History / humanities / religion',
    engine: 'fandom',
    api: 'https://mythology.fandom.com/api.php',
    lang: 'en',
    notes: 'Fandom-hosted world-mythology wiki.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // FOREIGN-LANGUAGE — major non-English Wikipedias
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Wikipedia (Spanish)',
    url: 'https://es.wikipedia.org/',
    category: 'Foreign-language',
    engine: 'mediawiki',
    api: 'https://es.wikipedia.org/w/api.php',
    lang: 'es',
    notes: 'Same Wikimedia API; swap subdomain.',
  },
  {
    name: 'Wikipedia (French)',
    url: 'https://fr.wikipedia.org/',
    category: 'Foreign-language',
    engine: 'mediawiki',
    api: 'https://fr.wikipedia.org/w/api.php',
    lang: 'fr',
    notes: 'Same Wikimedia API.',
  },
  {
    name: 'Wikipedia (German)',
    url: 'https://de.wikipedia.org/',
    category: 'Foreign-language',
    engine: 'mediawiki',
    api: 'https://de.wikipedia.org/w/api.php',
    lang: 'de',
    notes: 'Same Wikimedia API.',
  },
  {
    name: 'Wikipedia (Chinese)',
    url: 'https://zh.wikipedia.org/',
    category: 'Foreign-language',
    engine: 'mediawiki',
    api: 'https://zh.wikipedia.org/w/api.php',
    lang: 'zh',
    notes: 'Same Wikimedia API; variant conversion (zh-hans/zh-hant) supported.',
  },
  {
    name: 'Wikipedia (Japanese)',
    url: 'https://ja.wikipedia.org/',
    category: 'Foreign-language',
    engine: 'mediawiki',
    api: 'https://ja.wikipedia.org/w/api.php',
    lang: 'ja',
    notes: 'Same Wikimedia API.',
  },
  {
    name: 'Wikipedia (Arabic)',
    url: 'https://ar.wikipedia.org/',
    category: 'Foreign-language',
    engine: 'mediawiki',
    api: 'https://ar.wikipedia.org/w/api.php',
    lang: 'ar',
    notes: 'Same Wikimedia API; RTL content.',
  },
  {
    name: 'Wikipedia (Russian)',
    url: 'https://ru.wikipedia.org/',
    category: 'Foreign-language',
    engine: 'mediawiki',
    api: 'https://ru.wikipedia.org/w/api.php',
    lang: 'ru',
    notes: 'Same Wikimedia API.',
  },
  {
    name: 'Wikipedia (Hindi)',
    url: 'https://hi.wikipedia.org/',
    category: 'Foreign-language',
    engine: 'mediawiki',
    api: 'https://hi.wikipedia.org/w/api.php',
    lang: 'hi',
    notes: 'Same Wikimedia API.',
  },
  {
    name: 'Wikipedia (Portuguese)',
    url: 'https://pt.wikipedia.org/',
    category: 'Foreign-language',
    engine: 'mediawiki',
    api: 'https://pt.wikipedia.org/w/api.php',
    lang: 'pt',
    notes: 'Same Wikimedia API.',
  },
  {
    name: 'Jewish Encyclopedia (1906)',
    url: 'https://www.jewishencyclopedia.com/',
    category: 'Foreign-language',
    engine: 'other',
    lang: 'en',
    notes: 'Public-domain reference; static site. Cross-listed for religion corpus.',
  },
  {
    name: 'Vikidia (French, for children)',
    url: 'https://fr.vikidia.org/',
    category: 'Foreign-language',
    engine: 'mediawiki',
    api: 'https://fr.vikidia.org/w/api.php',
    lang: 'fr',
    notes: 'Non-English domain MediaWiki encyclopedia for ages 8–13.',
  },
  {
    name: 'Jedipedia (German Star Wars)',
    url: 'https://jedipedia.fandom.com/',
    category: 'Foreign-language',
    engine: 'fandom',
    api: 'https://jedipedia.fandom.com/api.php',
    lang: 'de',
    notes: 'Notable non-English Fandom wiki; among the largest fannish wikis.',
  },
];

// ───────────────────────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────────────────────

/** All entries in a given category (case-insensitive exact match). */
export function byCategory(cat) {
  if (!cat) return [];
  const want = String(cat).toLowerCase();
  return WIKIS.filter((w) => w.category.toLowerCase() === want);
}

/** All entries on a given engine ('mediawiki' | 'fandom' | 'other'). */
export function byEngine(engine) {
  if (!engine) return [];
  const want = String(engine).toLowerCase();
  return WIKIS.filter((w) => w.engine.toLowerCase() === want);
}

/**
 * Entries exposing a usable MediaWiki-shape API (an explicit `api` base).
 * Includes both engine:'mediawiki' and engine:'fandom' — they share the api.php
 * action API shape, so a single client can consume both. This is the bulk-ingest
 * target list for the booklore scraper (#126).
 */
export function mediawikiApis() {
  return WIKIS.filter(
    (w) => (w.engine === 'mediawiki' || w.engine === 'fandom') && typeof w.api === 'string' && w.api,
  );
}

/** Distinct, sorted list of category names present in the catalog. */
export function categories() {
  return [...new Set(WIKIS.map((w) => w.category))].sort();
}

/** Counts and rollups for the Directory / Resource Center. */
export function summary() {
  const byCat = {};
  const byEng = {};
  for (const w of WIKIS) {
    byCat[w.category] = (byCat[w.category] || 0) + 1;
    byEng[w.engine] = (byEng[w.engine] || 0) + 1;
  }
  return {
    total: WIKIS.length,
    categories: byCat,
    engines: byEng,
    withMediawikiApi: mediawikiApis().length,
  };
}

export default WIKIS;

// ───────────────────────────────────────────────────────────────────────────
// CLI: `node integrations/soapbox/wikis-catalog.mjs` prints a summary.
// ───────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = summary();
  const line = '─'.repeat(60);
  console.log(line);
  console.log(`WIKIS CATALOG — ${s.total} entries (task #185)`);
  console.log(line);
  console.log('By category:');
  for (const [cat, n] of Object.entries(s.categories).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${cat}`);
  }
  console.log('By engine:');
  for (const [eng, n] of Object.entries(s.engines).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${eng}`);
  }
  console.log(line);
  console.log(`MediaWiki-API-parseable (mediawiki+fandom w/ api base): ${s.withMediawikiApi}`);
  console.log(line);
}
