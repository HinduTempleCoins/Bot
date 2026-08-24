// affiliate-guides.mjs — the editorial BUYING-GUIDE / "best X" content engine that POPULATES the
// SoapBox affiliate verticals (coupons / shopping / travel / home-goods) with QUALITY, useful pages
// that carry real outbound merchant links — the kind Google rewards, NOT thin doorway spam.
//
// WHY THIS EXISTS
//   The verticals (site/coupons, site/shopping, site/travel, site/home-goods) shipped as curated
//   DIRECTORY/doorway surfaces: generic search links routed through integrations/affiliate.mjs. That
//   monetizes clicks but ranks thinly. Affiliate income needs QUALITY editorial pages ("best standing
//   desks", "how to stack coupons + cashback") whose outbound picks link to real merchants. This module
//   is the shared, PURE content layer those pages render from.
//
// HOW THE MONEY ATTACHES (two complementary paths, both already live on every vertical page <head>):
//   1. The Impact UTT (integrations/impact-utt.mjs) is CLIENT-SIDE in each vertical's <head>. It
//      auto-transforms outbound links to merchants the operator has JOINED in Impact into tracked
//      affiliate links. For those merchants we therefore render the PLAIN merchant URL and let the UTT
//      earn — appending our own param would only break Impact's own deep-link.
//   2. For param-deep-link networks (Skimlinks/CJ/Rakuten/etc.) a pick may name a `network`; then we
//      route its href through affiliate.trackedLink(network,url) (server-side tag; soft-fails to the
//      plain URL when that network's publisher id is not yet configured in the env).
//   Either way EVERY guide page carries the FTC disclosure and rel="sponsored nofollow noopener".
//
// THE QUALITY GATE (validateGuide) is the anti-spam moat: a guide that is too thin to be useful is
//   REFUSED (throwing lint in the CLI; { ok:false, errors } in code). We never publish a doorway page.
//
// PURE. No network, no secrets, soft-fail everywhere. esc() on all interpolation. Guarded CLI.
//
//   import * as guides from './affiliate-guides.mjs'
//   node integrations/affiliate-guides.mjs            # lint ALL guides (exit 1 if any fail the gate)
//   node integrations/affiliate-guides.mjs shopping   # list + lint one vertical

// --- HTML escape (strict) --------------------------------------------------
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const slugify = (s) => String(s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// The verticals a guide may belong to — matches the site/<vertical>/ servers that host guides.
export const VERTICALS = ['coupons', 'shopping', 'travel', 'home-goods'];

// --- the quality bar (tunable, but these are the anti-thin-content minimums) ---
export const QUALITY = {
  minIntroChars: 220,   // a real lede, not a sentence of filler
  minPicks: 3,          // a "best X" list is not a list at 1-2
  minBlurbChars: 120,   // each pick needs a genuine rationale
  minProsPerPick: 2,    // concrete reasons, not vibes
  minCriteria: 2,       // "how we chose" / what-to-look-for section
  minFaq: 2,            // real questions a shopper asks (long-tail SEO + usefulness)
};

// ---------------------------------------------------------------------------
// SEED CONTENT — evergreen, honest editorial. Picks are REAL products/merchants; blurbs state
// generally-true, durable facts (no invented prices, no fake review scores, no stale specs). Each pick
// links to the merchant's real page; the Impact UTT transforms it for joined merchants. Extend this
// list to populate more pages — validateGuide() gates every addition.
// ---------------------------------------------------------------------------
export const GUIDES = [
  // ── SHOPPING ──────────────────────────────────────────────────────────────
  {
    slug: 'best-standing-desks',
    vertical: 'shopping',
    title: 'The Best Standing Desks, Honestly Compared',
    description: 'A no-nonsense guide to choosing a sit-stand desk: what actually matters (stability, motor, warranty), and the real options worth your money — ranked by value, never by commission.',
    updated: '2026-08',
    intro:
      'A standing desk is one of the few home-office upgrades you feel every single day, which is exactly '
      + 'why it is worth getting right the first time. The market is crowded with near-identical frames '
      + 'wearing different brand names, so the things that separate a desk you love from one you resent are '
      + 'unglamorous: how little it wobbles at full height, how long the motor and frame are warrantied, and '
      + 'whether the surface is deep enough for your monitor arm. This guide skips the hype and walks through '
      + 'what to look for, then the options that consistently earn their keep.',
    criteria: [
      { h: 'Stability at full height', body: 'Wobble is the number-one regret. Dual-motor frames with a crossbar or heavier steel legs stay steady when raised; single-motor budget frames often shake once you are typing at standing height.' },
      { h: 'Warranty length', body: 'The frame and motor are the parts that fail. A long warranty (7–15 years on the better frames) is both real protection and an honest signal of how the maker rates their own hardware.' },
      { h: 'Top size and shape', body: 'Measure your monitor arm, keyboard tray, and elbow room before buying. A 30-inch-deep top handles a monitor arm without your screen sitting in your face; corner tops suit two-monitor setups.' },
    ],
    picks: [
      { name: 'Uplift V2', merchant: 'Uplift Desk', url: 'https://www.upliftdesk.com/uplift-v2-standing-desk/', badge: 'Best overall', network: 'impact',
        blurb: 'The V2 is the enthusiast default for good reason: a rigid dual-motor frame, an enormous range of tops and accessories, and a long frame-and-motor warranty. It is the desk people stop researching after they buy.',
        pros: ['Very stable at full height', 'Huge top and accessory selection', 'Long frame + motor warranty'], forWho: 'Anyone who wants a buy-it-once desk and is happy to configure it.' },
      { name: 'Flexispot E7', merchant: 'Flexispot', url: 'https://www.flexispot.com/standing-desks/', badge: 'Best value', network: 'impact',
        blurb: 'The E7 delivers most of what the premium frames do — dual motors, a solid weight capacity, a decent warranty — at a noticeably lower price. It is the value pick when you want stability without the top-tier spend.',
        pros: ['Strong stability for the price', 'High weight capacity', 'Frequent sales'], forWho: 'Value hunters who still want a dual-motor frame.' },
      { name: 'Jarvis', merchant: 'Herman Miller (Fully)', url: 'https://www.hermanmiller.com/', badge: 'Design-forward', network: 'impact',
        blurb: 'The Jarvis frame built a devoted following for clean looks, a bamboo top option, and easy assembly, and it now sits under the Herman Miller umbrella. A strong pick if aesthetics and a name-brand backstop matter to you.',
        pros: ['Clean, minimal design', 'Bamboo top option', 'Backed by a major brand'], forWho: 'Buyers who care about how the desk looks in the room.' },
      { name: 'IKEA sit/stand desks', merchant: 'IKEA', url: 'https://www.ikea.com/', badge: 'Simplest', network: 'impact',
        blurb: 'IKEA’s electric sit/stand tops are the low-friction entry point: widely available, easy to pair with the rest of a room, and simple to return. Not the most rigid at full height, but the easiest to just go buy today.',
        pros: ['Easy to buy and return', 'Coordinates with other furniture', 'Low entry price'], forWho: 'First-time buyers who want simple over maximal.' },
    ],
    faq: [
      { q: 'Are standing desks worth it?', a: 'The health benefit comes from ALTERNATING sitting and standing, not standing all day. An electric desk that makes switching effortless is what actually changes your behavior — which is why frame quality and a smooth motor matter more than any single feature.' },
      { q: 'How much should I spend on a standing desk?', a: 'A stable dual-motor frame with a real warranty is the floor worth paying for. Below that, single-motor frames save money up front but wobble and shorter warranties are the common regret. Watch for sales — the better frames discount often.' },
      { q: 'What desk size do I need?', a: 'Measure your monitor setup first. A 30-inch-deep top comfortably fits a monitor arm; 60 inches wide suits a single monitor with room to work, and a corner top suits dual monitors.' },
    ],
  },
  {
    slug: 'best-office-chairs',
    vertical: 'shopping',
    title: 'The Best Office Chairs for Long Days at the Desk',
    description: 'How to choose an ergonomic office chair that actually supports you for eight hours — the adjustments that matter, and the chairs worth the money at each budget.',
    updated: '2026-08',
    intro:
      'You spend more hours in your desk chair than in almost any other single object you own, and a bad one '
      + 'shows up as back pain long before you connect the two. The frustrating part of chair shopping is that '
      + 'price and comfort are only loosely related — a well-adjusted mid-range chair beats an expensive one '
      + 'set up wrong. The features that genuinely matter are the ones that let the chair fit YOUR body: '
      + 'adjustable lumbar support, arms that move in more than one direction, and a seat you can position so '
      + 'your feet rest flat. Here is what to prioritize, then chairs that deliver it at each budget.',
    criteria: [
      { h: 'Adjustable lumbar support', body: 'Your lower back has a curve; the chair should meet it. Height-adjustable (and ideally depth-adjustable) lumbar support is the single feature most correlated with all-day comfort.' },
      { h: 'Arm adjustability', body: 'Fixed arms force your shoulders into whatever height they were built for. 3D or 4D arms (up/down, in/out, pivot) let your forearms rest without hiking your shoulders.' },
      { h: 'Seat depth and warranty', body: 'A seat that is too deep cuts behind your knees. Adjustable seat depth fits more bodies, and a long warranty (often 12 years on the premium chairs) reflects genuine build quality.' },
    ],
    picks: [
      { name: 'Aeron', merchant: 'Herman Miller', url: 'https://www.hermanmiller.com/', badge: 'The classic', network: 'impact',
        blurb: 'The Aeron is the chair every other chair is measured against: a breathable mesh, a well-engineered recline, and three sizes so it actually fits different bodies. Expensive, but the resale value and 12-year warranty soften the blow over time.',
        pros: ['Comes in three sizes for a real fit', 'Breathable mesh', 'Long warranty and strong resale'], forWho: 'Buyers ready to invest once in a chair that lasts a decade.' },
      { name: 'Leap', merchant: 'Steelcase', url: 'https://www.steelcase.com/', badge: 'Best back support', network: 'impact',
        blurb: 'The Leap’s flexing backrest tracks your spine as you move and its adjustability is class-leading, which is why it is a favorite of people with existing back issues. A padded seat rather than mesh, if you prefer cushioning.',
        pros: ['Backrest flexes with your spine', 'Deep, granular adjustability', 'Comfortable padded seat'], forWho: 'Anyone whose priority is lower-back support.' },
      { name: 'Ergonomic mesh chairs', merchant: 'Branch', url: 'https://www.branchfurniture.com/', badge: 'Best value', network: 'impact',
        blurb: 'Branch and similar direct-to-consumer brands hit the sweet spot: the adjustments that matter (lumbar, 3D arms, seat depth) at roughly half the price of the legacy names. The value pick when a four-figure chair is off the table.',
        pros: ['Core ergonomic adjustments included', 'Roughly half the premium price', 'Frequent sales and free returns'], forWho: 'Value buyers who still want real adjustability.' },
    ],
    faq: [
      { q: 'What makes an office chair ergonomic?', a: 'Not a label — adjustability. An ergonomic chair is one you can fit to your body: lumbar support at the right height, arms that support your forearms without lifting your shoulders, and a seat set so your feet rest flat and your knees are not pinched.' },
      { q: 'Is a mesh or padded seat better?', a: 'Mesh runs cooler and resists sagging; padded seats feel plusher up front but can compress over years. It is a comfort preference — both can be ergonomic if the adjustments are right.' },
      { q: 'Are expensive office chairs worth it?', a: 'The premium buys durability and long warranties more than day-one comfort. A well-adjusted mid-range chair can be more comfortable than a pricey one set up poorly — so budget for the adjustments you will actually use.' },
    ],
  },
  // ── HOME-GOODS ─────────────────────────────────────────────────────────────
  {
    slug: 'best-robot-vacuums',
    vertical: 'home-goods',
    title: 'The Best Robot Vacuums for Real Homes',
    description: 'Which robot vacuum is worth it depends on your floors, your pets, and how much cleanup you want to do yourself. A practical guide to what matters and the models that deliver.',
    updated: '2026-08',
    intro:
      'A robot vacuum earns its keep by removing a chore you would otherwise do — but only if it fits your '
      + 'actual home. The gap between a great one and a frustrating one is rarely raw suction; it is navigation '
      + 'that does not get stuck, a bin or dock you are not constantly emptying, and mopping that helps rather '
      + 'than smears. Pet hair, dark floors, and thick rugs each trip up different models. This guide covers '
      + 'the features that decide daily happiness, then the models that consistently handle real homes.',
    criteria: [
      { h: 'Navigation and mapping', body: 'Lidar-mapping robots clean in efficient rows and avoid getting stuck far better than random-bounce models. Good mapping also lets you send the robot to one room instead of the whole floor.' },
      { h: 'Self-emptying dock', body: 'A self-emptying base turns "empty the bin every run" into "empty a bag every couple of months." It is the upgrade owners say they would not give up, especially with pets.' },
      { h: 'Mopping — real or token', body: 'Basic models drag a damp pad; the better ones lift the pad on carpet and scrub, then wash the pad at the dock. Know which you are buying so mopping helps instead of spreading dirt.' },
    ],
    picks: [
      { name: 'Roomba', merchant: 'iRobot', url: 'https://www.irobot.com/', badge: 'Most reliable', network: 'impact',
        blurb: 'iRobot’s Roomba line built its reputation on navigation and dependable dirt pickup, with self-emptying options across the range. The safe pick when you want it to just work rather than tinker with an app.',
        pros: ['Dependable navigation', 'Strong pickup on carpet', 'Self-emptying options'], forWho: 'Buyers who want reliability over the longest feature list.' },
      { name: 'Roborock', merchant: 'Roborock', url: 'https://us.roborock.com/', badge: 'Best all-rounder', network: 'impact',
        blurb: 'Roborock packs the most capable feature set for the money — excellent lidar mapping plus genuinely useful mopping, up to models that lift the mop on carpet and self-wash at the dock. The pick if you want vacuum and mop in one.',
        pros: ['Excellent lidar mapping', 'Genuinely useful mopping', 'Feature-rich for the price'], forWho: 'People who want mopping done well, not as a gimmick.' },
      { name: 'Eufy', merchant: 'Anker (Eufy)', url: 'https://www.eufy.com/', badge: 'Best value', network: 'impact',
        blurb: 'Eufy focuses on quiet, low-profile robots that slide under furniture and clean well without a premium price. Fewer bells and whistles, but a strong value pick for mostly-hard-floor homes.',
        pros: ['Quiet and slim', 'Cleans well on hard floors', 'Lower price'], forWho: 'Hard-floor homes on a budget.' },
      { name: 'Shark', merchant: 'Shark', url: 'https://www.sharkclean.com/', badge: 'Good for pets', network: 'impact',
        blurb: 'Shark’s robots emphasize pet-hair pickup and self-emptying bases at competitive prices, a practical middle ground between budget and premium for households with shedding pets.',
        pros: ['Strong pet-hair pickup', 'Self-emptying options', 'Competitive pricing'], forWho: 'Pet owners who want self-emptying without top-tier spend.' },
    ],
    faq: [
      { q: 'Is a self-emptying robot vacuum worth it?', a: 'For most people, yes — it is the single feature owners say changed the experience, turning an every-run chore into an every-few-months one. It matters most in homes with pets or lots of floor area.' },
      { q: 'Can a robot vacuum replace a regular vacuum?', a: 'For daily maintenance on hard floors and low carpet, largely yes. For deep-cleaning thick rugs, stairs, and upholstery you will still want an upright or handheld. Think of the robot as keeping things clean between deeper cleans.' },
      { q: 'Do robot vacuums work on carpet?', a: 'Most handle low and medium pile well; very thick or high-pile rugs can trip up navigation or reduce pickup. If you have deep rugs, prioritize models with strong suction and carpet-boost, and check they can climb your rug edges.' },
    ],
  },
  {
    slug: 'best-air-purifiers',
    vertical: 'home-goods',
    title: 'The Best Air Purifiers for Cleaner Indoor Air',
    description: 'Cutting through air-purifier marketing: what CADR and true-HEPA actually mean, how to size a unit to your room, and the models that clean air without gimmicks.',
    updated: '2026-08',
    intro:
      'Air purifiers are sold with a lot of noise — ionizers, UV, "smart" everything — but the science of '
      + 'cleaning indoor air is refreshingly simple: pull air through a true-HEPA filter fast enough to cycle '
      + 'the whole room several times an hour. Everything that matters flows from two numbers, the filter type '
      + 'and the clean-air delivery rate (CADR), plus the ongoing cost of replacement filters. Skip the gadgets '
      + 'that promise ozone or "ionization" and you are left with a short list of honest performers. Here is how '
      + 'to size one to your room and the units that deliver.',
    criteria: [
      { h: 'True HEPA, not "HEPA-type"', body: 'A genuine HEPA filter captures 99.97% of fine particles. Marketing terms like "HEPA-type" or "HEPA-like" are not the same standard. Insist on true HEPA and skip ozone-generating ionizers.' },
      { h: 'CADR vs. room size', body: 'Clean-air delivery rate tells you how fast a unit cleans a given room. Match the CADR to your room square footage so the air cycles several times an hour — an undersized unit in a big room just hums.' },
      { h: 'Replacement filter cost', body: 'The sticker price is only the start. Filters are consumables; a cheap unit with pricey, frequent filter changes can cost more over two years than a pricier one with affordable filters.' },
    ],
    picks: [
      { name: 'Coway Airmega', merchant: 'Coway', url: 'https://cowaymega.com/', badge: 'Best overall', network: 'impact',
        blurb: 'Coway’s Airmega line is a long-standing reviewer favorite for strong true-HEPA performance, sensible filter costs, and quiet operation. The dependable default for a bedroom or living room.',
        pros: ['Strong true-HEPA performance', 'Reasonable filter costs', 'Quiet on low settings'], forWho: 'Most rooms, most people — the safe pick.' },
      { name: 'Levoit Core', merchant: 'Levoit', url: 'https://www.levoit.com/', badge: 'Best value', network: 'impact',
        blurb: 'Levoit’s Core purifiers deliver true-HEPA filtration at budget prices, with affordable replacement filters. Excellent value for small-to-medium rooms where you do not need maximum coverage.',
        pros: ['True HEPA at a low price', 'Affordable filters', 'Compact footprint'], forWho: 'Bedrooms, offices, and value buyers.' },
      { name: 'Blueair', merchant: 'Blueair', url: 'https://www.blueair.com/', badge: 'Quietest', network: 'impact',
        blurb: 'Blueair pairs HEPASilent filtration with notably quiet operation and high clean-air delivery, making it a strong pick for larger rooms and light sleepers who want performance without the fan noise.',
        pros: ['Very quiet for its output', 'High CADR for large rooms', 'Clean, minimal design'], forWho: 'Larger rooms and noise-sensitive sleepers.' },
    ],
    faq: [
      { q: 'What size air purifier do I need?', a: 'Match the unit’s CADR to your room. A rough rule: the CADR (in cfm) should be at least two-thirds of the room’s square footage so the air cycles several times an hour. Undersized units in big rooms simply cannot keep up.' },
      { q: 'Are HEPA air purifiers worth it?', a: 'For allergens, dust, smoke, and fine particles, a true-HEPA purifier sized to the room genuinely reduces what you breathe. The value is real — just avoid ozone-generating "ionizers," which can irritate rather than help.' },
      { q: 'How often do I replace the filter?', a: 'Most true-HEPA filters last 6–12 months depending on use and air quality; pre-filters can often be vacuumed to extend life. Factor the ongoing filter cost into the purchase — it is the real cost of ownership.' },
    ],
  },
  // ── TRAVEL ───────────────────────────────────────────────────────────────
  {
    slug: 'best-carry-on-luggage',
    vertical: 'travel',
    title: 'The Best Carry-On Luggage That Actually Fits',
    description: 'How to pick a carry-on that survives real travel: sizing to airline limits, hard vs. soft shell, and the bags worth buying — compared honestly, never ranked by commission.',
    updated: '2026-08',
    intro:
      'The right carry-on quietly removes friction from every trip: it fits the sizer, rolls straight, and '
      + 'holds enough that you never check a bag for a long weekend. The wrong one costs you at the gate or '
      + 'falls apart a year in. Sizing is the first thing to get right — airline limits vary, and "carry-on '
      + 'compliant" is not one universal number — and after that it comes down to shell material, wheel and '
      + 'handle quality, and the warranty. This guide covers what to check before you buy, then the bags that '
      + 'consistently earn their place in the overhead bin.',
    criteria: [
      { h: 'Fits the sizer', body: 'Carry-on limits differ by airline and especially on budget carriers. Buy to the stricter international limit if you fly a mix, and treat over-tall "carry-on" bags with suspicion — the gate is where that mistake gets expensive.' },
      { h: 'Hard vs. soft shell', body: 'Hard shells protect contents and wipe clean; soft-sided bags flex to overstuff and often add an outer laptop pocket. Neither is strictly better — pick for how you pack.' },
      { h: 'Wheels, handle, warranty', body: 'Spinner wheels and a solid telescoping handle are what you touch every trip and the first things to fail on cheap bags. A long or lifetime warranty is both protection and a quality signal.' },
    ],
    picks: [
      { name: 'The Carry-On', merchant: 'Away', url: 'https://www.awaytravel.com/', badge: 'Best overall', network: 'impact',
        blurb: 'Away’s hard-shell carry-on popularized the category for good reason: a durable polycarbonate shell, smooth wheels, a genuinely useful interior compartment system, and a strong warranty. The all-rounder most travelers are happy with.',
        pros: ['Durable polycarbonate shell', 'Smooth, quiet wheels', 'Strong warranty'], forWho: 'Most travelers who want one bag that does everything well.' },
      { name: 'Carry-On Pro', merchant: 'Monos', url: 'https://monos.com/', badge: 'Best design', network: 'impact',
        blurb: 'Monos delivers a premium hard-shell experience — refined finishes, quiet wheels, a built-in compression system and a laptop pocket on the Pro — for travelers who want the bag to feel as good as it works.',
        pros: ['Premium finish and materials', 'Quiet wheels', 'Front laptop pocket (Pro)'], forWho: 'Buyers who care about how the bag looks and feels.' },
      { name: 'Maxlite / Platinum', merchant: 'Travelpro', url: 'https://www.travelpro.com/', badge: 'Crew favorite', network: 'impact',
        blurb: 'Travelpro is the brand you see pilots and flight attendants actually using — soft-sided bags built for daily abuse, with dependable wheels and handles and a long track record. The workhorse pick.',
        pros: ['Built for heavy repeated use', 'Soft-side flexibility to overstuff', 'Trusted by flight crews'], forWho: 'Frequent flyers who value durability over looks.' },
    ],
    faq: [
      { q: 'What size carry-on is allowed on planes?', a: 'There is no single universal size — most major U.S. airlines allow roughly 22 x 14 x 9 inches, but budget and international carriers are often stricter. If you fly a mix, buy to the stricter limit so you are never caught at the gate.' },
      { q: 'Hard shell or soft shell carry-on?', a: 'Hard shells protect fragile contents and wipe clean; soft-sided bags flex to overstuff and usually add an external laptop pocket. Choose for how you pack rather than assuming one is better.' },
      { q: 'Is expensive luggage worth it?', a: 'The premium mostly buys better wheels, handles, and warranty — the parts that fail on cheap bags. If you travel a few times a year, a mid-range bag with a good warranty is the sweet spot; frequent flyers benefit most from the durable options.' },
    ],
  },
  {
    slug: 'how-to-find-cheap-flights',
    vertical: 'travel',
    title: 'How to Find Cheap Flights: A Practical Playbook',
    description: 'The honest, no-secret-hack guide to lower airfare — how the metasearch tools actually work, when to book, and how to use flexible-date search to your advantage.',
    updated: '2026-08',
    intro:
      'Cheap flights are less about secret hacks and more about a repeatable process: search broadly, stay '
      + 'flexible where you can, and know which tool does what. The airfare market is a real-time auction, so '
      + 'the same seat swings in price with demand, day of week, and how far ahead you look. The good news is '
      + 'that a handful of free metasearch tools surface almost the whole market at once, and a few habits — '
      + 'flexible dates, nearby airports, fare alerts — reliably shave the total. Here is the playbook and the '
      + 'tools worth using.',
    criteria: [
      { h: 'Search broad first', body: 'Start with a metasearch engine that scans many airlines and agencies at once, using a flexible-date or whole-month view. You are looking for the shape of the market before you commit to a date.' },
      { h: 'Be flexible on dates and airports', body: 'Mid-week departures and nearby alternate airports are the two biggest, most reliable levers on price. A day either side of your ideal date often moves the fare more than any "hack."' },
      { h: 'Set alerts, then book direct', body: 'Fare alerts catch drops without you refreshing. Once you find a fare, it is often worth booking on the airline’s own site for easier changes and support — the metasearch tool’s job was to find it.' },
    ],
    picks: [
      { name: 'Google Flights', merchant: 'Google Flights', url: 'https://www.google.com/travel/flights', badge: 'Best for research', network: 'impact',
        blurb: 'Google Flights is the fastest way to see the whole market and the price calendar at a glance. Its date grid and "track prices" alerts make it the tool to START every search with, even if you book elsewhere.',
        pros: ['Fast whole-market view', 'Excellent flexible-date grid', 'Free price tracking'], forWho: 'Everyone, as the first stop in any search.' },
      { name: 'Skyscanner', merchant: 'Skyscanner', url: 'https://www.skyscanner.com/', badge: 'Best for flexibility', network: 'travelpayouts',
        blurb: 'Skyscanner’s "everywhere" and whole-month searches are unmatched when your dates or destination are flexible — ideal for finding where a cheap trip is even possible, not just pricing a fixed route.',
        pros: ['"Search everywhere" destination discovery', 'Whole-month price view', 'Broad airline and agency coverage'], forWho: 'Flexible travelers hunting for any good deal.' },
      { name: 'Kayak', merchant: 'Kayak', url: 'https://www.kayak.com/', badge: 'Best filters', network: 'impact',
        blurb: 'Kayak pairs wide coverage with the deepest filters — cabin, stops, layover length, specific airlines — plus a price-forecast that suggests whether to book or wait. The pick when you want to fine-tune a specific route.',
        pros: ['Deep, granular filters', 'Price-forecast guidance', 'Wide coverage'], forWho: 'Travelers optimizing a specific, fixed route.' },
    ],
    faq: [
      { q: 'When is the cheapest time to book a flight?', a: 'There is no magic day, but booking a few weeks to a couple of months ahead for domestic and longer for international tends to land near the low. Mid-week departures are usually cheaper than weekend ones. Set a fare alert and book when it drops rather than trying to time it perfectly.' },
      { q: 'Do flight prices really change based on my searches?', a: 'The persistent price swings you see are driven by real demand and inventory, not your cookies. Still, searching in a private window costs nothing and removes any doubt. The bigger levers are flexible dates and nearby airports.' },
      { q: 'Is it cheaper to book direct with the airline?', a: 'Metasearch tools are best for FINDING the fare; once you have it, booking on the airline’s own site often makes changes, cancellations, and support easier for a similar price. Use the tools to search, then decide where to buy.' },
    ],
  },
  // ── COUPONS ──────────────────────────────────────────────────────────────
  {
    slug: 'how-to-stack-coupons-and-cashback',
    vertical: 'coupons',
    title: 'How to Stack Coupons and Cashback (The Right Way)',
    description: 'A practical guide to layering a coupon code, a cashback portal, and card rewards on one purchase — the honest way to cut a bill without falling for fake-code rabbit holes.',
    updated: '2026-08',
    intro:
      'The biggest savings on an online order rarely come from one big discount — they come from stacking '
      + 'several small ones that each apply independently: a working coupon code at checkout, cashback earned '
      + 'through a portal for the same purchase, and rewards from the card you pay with. Done right, that is '
      + 'three layers of savings on a single order, none of which cancels the others. The trick is knowing the '
      + 'order of operations and which "deals" are real. This guide walks through the honest stack, step by '
      + 'step, and points to the cashback portals worth using.',
    criteria: [
      { h: 'Start at a cashback portal', body: 'Before you shop, click through to the store from a cashback portal — that click is what credits your cashback. Skip it and you lose that layer entirely, no matter what else you do at checkout.' },
      { h: 'Apply the best single coupon code', body: 'Most carts accept only one code, so test a few and keep the one that saves most. Beware time-wasting fake codes — a recently-verified code beats a long list of expired ones.' },
      { h: 'Pay with a rewards card', body: 'The final layer is the card. A cashback or points card adds a percentage back on top of the portal and the code — the same dollars working three times.' },
    ],
    picks: [
      { name: 'Rakuten', merchant: 'Rakuten', url: 'https://www.rakuten.com/', badge: 'Most stores', network: 'rakuten',
        blurb: 'Rakuten is the largest and most widely-supported cashback portal, with rotating higher rates and a simple browser extension that reminds you to activate cashback before you buy. The default first stop for the cashback layer.',
        pros: ['Huge store coverage', 'Frequent elevated rates', 'Simple activation extension'], forWho: 'Almost any online purchase — start here.' },
      { name: 'TopCashback', merchant: 'TopCashback', url: 'https://www.topcashback.com/', badge: 'Highest rates', network: 'impact',
        blurb: 'TopCashback frequently posts higher rates than competitors because it passes back most of its commission, which makes it worth comparing against Rakuten for the same store before you click through.',
        pros: ['Often the highest posted rates', 'Wide store coverage', 'Worth comparing per-store'], forWho: 'Rate maximizers who compare before clicking.' },
      { name: 'Capital One Shopping', merchant: 'Capital One Shopping', url: 'https://capitaloneshopping.com/', badge: 'Auto code-testing', network: 'impact',
        blurb: 'Capital One Shopping (free, and not tied to being a cardholder) automatically tests coupon codes at checkout and offers rewards credits, taking the manual work out of the coupon layer of the stack.',
        pros: ['Auto-tests codes at checkout', 'Free to use for anyone', 'Rewards credits on top'], forWho: 'People who want the coupon step automated.' },
      { name: 'Ibotta', merchant: 'Ibotta', url: 'https://ibotta.com/', badge: 'Best for groceries', network: 'impact',
        blurb: 'Ibotta specializes in receipt- and account-linked cashback, which extends the stack to in-store and grocery purchases where portal cashback usually cannot reach. A useful complement rather than a replacement.',
        pros: ['Covers in-store and groceries', 'Receipt-based offers', 'Complements online portals'], forWho: 'Grocery and in-store shoppers.' },
    ],
    faq: [
      { q: 'Can you really stack coupons and cashback?', a: 'Yes — a coupon code, portal cashback, and card rewards apply through three different mechanisms, so they generally do not cancel each other. The one rule that trips people up: you must click through the cashback portal FIRST, before applying the code and paying.' },
      { q: 'Do cashback portals actually pay out?', a: 'The established portals (Rakuten, TopCashback and the like) have long track records of paying, though cashback can take weeks to confirm while the store confirms the sale. Always activate the portal before buying — an unactivated purchase earns nothing.' },
      { q: 'Why do so many coupon codes not work?', a: 'Codes expire, are single-use, or were never valid. That is why recency matters more than quantity — a short list of recently-verified codes beats a long list of stale ones. Tools that auto-test codes at checkout save the trial-and-error.' },
    ],
  },
];

// ---------------------------------------------------------------------------
// QUALITY GATE — the anti-thin-content moat. Returns { ok, errors:[] }. Never throws.
// ---------------------------------------------------------------------------
export function validateGuide(g) {
  const errors = [];
  if (!g || typeof g !== 'object') return { ok: false, errors: ['not an object'] };
  const id = g.slug || g.title || '(unnamed)';
  if (!g.slug || !/^[a-z0-9-]+$/.test(g.slug)) errors.push(`${id}: missing/invalid slug (lowercase-dashes)`);
  if (!VERTICALS.includes(g.vertical)) errors.push(`${id}: vertical must be one of ${VERTICALS.join(', ')}`);
  if (!g.title || g.title.length < 12) errors.push(`${id}: title too short`);
  if (!g.description || g.description.length < 60) errors.push(`${id}: meta description too short (<60 chars hurts SEO)`);
  if (!g.intro || g.intro.length < QUALITY.minIntroChars) errors.push(`${id}: intro under ${QUALITY.minIntroChars} chars (thin lede)`);

  const criteria = Array.isArray(g.criteria) ? g.criteria : [];
  if (criteria.length < QUALITY.minCriteria) errors.push(`${id}: needs >= ${QUALITY.minCriteria} "what to look for" criteria`);
  for (const c of criteria) if (!c?.h || !c?.body || c.body.length < 40) errors.push(`${id}: a criterion is missing a heading or has a thin body`);

  const picks = Array.isArray(g.picks) ? g.picks : [];
  if (picks.length < QUALITY.minPicks) errors.push(`${id}: needs >= ${QUALITY.minPicks} picks (a "best X" list)`);
  const seen = new Set();
  for (const p of picks) {
    const pid = p?.name || '(pick)';
    if (!p?.name) errors.push(`${id}: a pick is missing a name`);
    if (!p?.url || !/^https?:\/\//.test(p.url)) errors.push(`${id}/${pid}: pick needs a real http(s) merchant url`);
    if (p?.url) { if (seen.has(p.url)) errors.push(`${id}/${pid}: duplicate merchant url`); seen.add(p.url); }
    if (!p?.blurb || p.blurb.length < QUALITY.minBlurbChars) errors.push(`${id}/${pid}: blurb under ${QUALITY.minBlurbChars} chars (thin rationale)`);
    const pros = Array.isArray(p?.pros) ? p.pros : [];
    if (pros.length < QUALITY.minProsPerPick) errors.push(`${id}/${pid}: needs >= ${QUALITY.minProsPerPick} concrete pros`);
  }

  const faq = Array.isArray(g.faq) ? g.faq : [];
  if (faq.length < QUALITY.minFaq) errors.push(`${id}: needs >= ${QUALITY.minFaq} FAQ entries (usefulness + long-tail SEO)`);
  for (const f of faq) if (!f?.q || !f?.a || f.a.length < 40) errors.push(`${id}: an FAQ entry is missing a question or has a thin answer`);

  return { ok: errors.length === 0, errors };
}

// Validate the whole seed set. { ok, results:[{slug, ok, errors}] }.
export function validateAllGuides(list = GUIDES) {
  const results = (Array.isArray(list) ? list : []).map((g) => ({ slug: g?.slug || '(unnamed)', ...validateGuide(g) }));
  return { ok: results.every((r) => r.ok), results };
}

// --- lookups ---------------------------------------------------------------

// Only guides that PASS the quality gate are ever served — a thin guide is invisible, never a doorway.
export function publishedGuides(list = GUIDES) {
  return (Array.isArray(list) ? list : []).filter((g) => validateGuide(g).ok);
}

export function guidesFor(vertical, list = GUIDES) {
  const v = String(vertical || '').toLowerCase();
  return publishedGuides(list).filter((g) => g.vertical === v);
}

export function guideBySlug(vertical, slug, list = GUIDES) {
  const v = String(vertical || '').toLowerCase();
  const s = String(slug || '').toLowerCase();
  return publishedGuides(list).find((g) => g.vertical === v && g.slug === s) || null;
}

// The sitemap paths a vertical server should publish for its guides: the index + one per guide.
export function guideSitemapPaths(vertical, list = GUIDES) {
  return ['/guides', ...guidesFor(vertical, list).map((g) => `/g/${g.slug}`)];
}

// --- outbound link resolution (the money path) -----------------------------

// Resolve a pick's outbound href. Impact (or unspecified) merchants render the PLAIN url so the
// client-side Impact UTT in the page <head> transforms it for JOINED merchants. Param-deep-link
// networks (skimlinks/cj/rakuten/...) route through affiliate.trackedLink (soft-fails to plain url
// when that network's id is unconfigured). `affiliate` is integrations/affiliate.mjs, injected so this
// module stays pure/testable. Returns { href, via, tracked }.
export function pickHref(pick, affiliate, { subId } = {}) {
  const url = pick?.url || '';
  const net = String(pick?.network || 'impact').toLowerCase();
  if (net === 'impact' || !net) {
    return { href: url, via: 'impact-utt', tracked: false };
  }
  if (affiliate && typeof affiliate.trackedLink === 'function') {
    const t = affiliate.trackedLink(net, url, { subId: subId || slugify(pick?.name || '') });
    return { href: t.url || url, via: net, tracked: t.tracked === true };
  }
  return { href: url, via: net, tracked: false };
}

// --- render: a single guide page body + JSON-LD ----------------------------

// Render the guide's <main> body HTML and its JSON-LD array. Reuses the host server's page shell.
//   opts: { baseUrl, affiliate, seo } — affiliate = integrations/affiliate.mjs; seo = soapbox/seo.mjs
// Returns { html, jsonld }.
export function renderGuideBody(guide, { baseUrl = '', affiliate = null, seo = null } = {}) {
  if (!guide) return { html: '<p>Guide not found.</p>', jsonld: null };
  const canonical = `${baseUrl}/g/${esc(guide.slug)}`;

  const criteria = (guide.criteria || []).map((c) =>
    `<div class=card><h3>${esc(c.h)}</h3><p class=muted>${esc(c.body)}</p></div>`).join('');

  const picks = (guide.picks || []).map((p, i) => {
    const { href, tracked, via } = pickHref(p, affiliate, { subId: `${guide.slug}-${slugify(p.name)}` });
    const badge = p.badge ? `<span class=pick-badge>${esc(p.badge)}</span>` : '';
    const pros = (p.pros || []).map((x) => `<li>${esc(x)}</li>`).join('');
    const forWho = p.forWho ? `<p class=pick-for><b>Best for:</b> ${esc(p.forWho)}</p>` : '';
    const untracked = (via === 'impact-utt' || tracked) ? '' : ' <span class=meta title="affiliate id not configured">(unmonetized)</span>';
    return `<div class=pick>
      <div class=pick-head><span class=pick-rank>${i + 1}</span><h3>${esc(p.name)}</h3>${badge}</div>
      <p class=pick-merchant>at ${esc(p.merchant || p.name)}</p>
      <p>${esc(p.blurb)}</p>
      <ul class=pick-pros>${pros}</ul>
      ${forWho}
      <p><a class=pick-cta href="${esc(href)}" rel="sponsored nofollow noopener" target=_blank>Check ${esc(p.merchant || p.name)} →</a>${untracked}</p>
    </div>`;
  }).join('');

  const faq = (guide.faq || []).map((f) =>
    `<div class=card><h3>${esc(f.q)}</h3><p class=muted>${esc(f.a)}</p></div>`).join('');

  const disclosure = affiliate && typeof affiliate.ftcDisclosure === 'function'
    ? affiliate.ftcDisclosure()
    : 'Disclosure: some links are affiliate links — we may earn a commission at no extra cost to you. Commissions never affect our ranking, and we never sell your data.';

  const html = `<article class=guide>
    <p class=crumbs><a href="/guides">Guides</a> &rsaquo; ${esc(guide.title)}</p>
    <h1>${esc(guide.title)}</h1>
    ${guide.updated ? `<p class=muted style="font-size:13px">Updated ${esc(guide.updated)} · ranked by value, never by commission</p>` : ''}
    <p class=lede>${esc(guide.intro)}</p>
    <h2>What to look for</h2>
    <div class=grid>${criteria}</div>
    <h2>The picks</h2>
    ${picks}
    <h2>Frequently asked</h2>
    ${faq}
    <p class=ftc-disclosure>${esc(disclosure)}</p>
  </article>`;

  // JSON-LD: Article + FAQPage + an ItemList of the picks. Uses seo.mjs builders when available.
  const jsonld = [];
  if (seo && typeof seo.articleJsonLd === 'function') {
    jsonld.push(seo.articleJsonLd({ headline: guide.title, description: guide.description, url: canonical }));
  } else {
    jsonld.push({ '@context': 'https://schema.org', '@type': 'Article', headline: guide.title, description: guide.description, url: canonical });
  }
  jsonld.push({
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: guide.title,
    itemListElement: (guide.picks || []).map((p, i) => ({
      '@type': 'ListItem', position: i + 1, name: p.name, url: p.url,
    })),
  });
  if ((guide.faq || []).length) {
    jsonld.push({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: guide.faq.map((f) => ({
        '@type': 'Question', name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }
  return { html, jsonld };
}

// --- render: the /guides index for one vertical ----------------------------
export function renderGuideIndexBody(vertical, { list = GUIDES } = {}) {
  const gs = guidesFor(vertical, list);
  if (!gs.length) {
    return `<h1>Buying guides</h1><p class=muted>No guides published yet for this section — check back soon.</p>`;
  }
  const cards = gs.map((g) =>
    `<a class=sec href="/g/${esc(g.slug)}"><div class=t>${esc(g.title)}</div><div class=d>${esc(g.description)}</div></a>`).join('');
  return `<h1>Buying guides</h1>
    <p class=muted>Honest, useful guides to buying well — each ranked by value to you, never by what pays us. Some links are affiliate links, disclosed on every page.</p>
    <div class=grid style="margin-top:8px">${cards}</div>`;
}

// A little CSS the guide pages want, appended by hosts that don't already style .pick/.guide.
export const GUIDE_STYLE = `<style>
.guide .lede{font-size:17px;line-height:1.6;color:#333}
.guide h2{margin-top:28px}
.crumbs{font-size:13px;color:#777;margin:0 0 4px}
.pick{border:1px solid #e5e5e5;border-radius:10px;padding:16px 18px;margin:14px 0;background:#fff}
.pick-head{display:flex;align-items:center;gap:10px}
.pick-head h3{margin:0}
.pick-rank{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#111;color:#fff;font-size:14px;font-weight:700}
.pick-badge{background:#eef6ff;color:#0552b5;font-size:12px;font-weight:600;padding:2px 8px;border-radius:12px}
.pick-merchant{color:#777;font-size:13px;margin:2px 0 8px}
.pick-pros{margin:8px 0;padding-left:20px}
.pick-pros li{margin:2px 0}
.pick-for{font-size:14px;color:#444}
.pick-cta{display:inline-block;margin-top:6px;font-weight:600}
</style>`;

// --- CLI (guarded) — lint the seed set; exit 1 if any guide fails the gate --
if (process.argv[1] && process.argv[1].endsWith('affiliate-guides.mjs')) {
  const arg = (process.argv[2] || '').toLowerCase();
  const list = arg && VERTICALS.includes(arg) ? GUIDES.filter((g) => g.vertical === arg) : GUIDES;
  const { ok, results } = validateAllGuides(list);
  console.log(`affiliate-guides — ${list.length} guide(s)${arg ? ` in "${arg}"` : ''}\n`);
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.slug}`);
    for (const e of r.errors) console.log(`         - ${e}`);
  }
  const byV = {};
  for (const g of publishedGuides(list)) byV[g.vertical] = (byV[g.vertical] || 0) + 1;
  console.log('\nPublished per vertical:', JSON.stringify(byV));
  console.log(ok ? '\nQuality gate: ALL PASS' : '\nQuality gate: FAILURES ABOVE');
  process.exit(ok ? 0 : 1);
}
