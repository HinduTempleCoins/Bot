// genai-reel-maker.mjs — the CapCut-style "video / reel template maker" for the GenAI page.
//
// THE IDEA (operator's spec, GenAI phase 2): a simple, HONEST template maker. Pick a reel template
// (intro / captions / music-cue structure), fill a few labelled fields, and it produces a downloadable
// STORYBOARD SPEC (JSON + a human-readable shotlist) the user takes into CapCut or any editor. It does
// NOT render video — it's a starting template, not a finished reel. No heavy deps, no GPU, no network.
//
// Pure data + pure functions — fully testable offline.
//
//   listReelTemplates()                 -> all templates
//   getReelTemplate(id)                 -> one or null
//   buildReelSpec(id, fields, opts)     -> { ok, spec } | { ok:false, error }   (the downloadable JSON)
//   shotlist(spec)                      -> a plain-text shotlist string for humans
//   validateReelTemplates()             -> integrity check for /health + tests
//
// A template is a sequence of scenes; each scene has a role (intro/body/caption/cta/outro), a duration
// hint, and a `text` pattern with {{field}} placeholders. Fields are filled exactly like the image
// templates: a missing field falls back to its example so a half-filled form still produces a good spec.
//
// Aspects: 9:16 (reel/short) | 1:1 (square) | 16:9 (wide)

export const REEL_ASPECTS = ['9:16', '1:1', '16:9'];

export const REEL_TEMPLATES = [
  {
    id: 'hook-explainer',
    title: 'Hook → Explainer → CTA',
    aspect: '9:16',
    music: 'upbeat, builds at the hook, settles under the explainer',
    fields: [
      { key: 'topic', label: 'Topic', placeholder: 'e.g. how MELEK block production works', example: 'how MELEK block production works' },
      { key: 'hook', label: 'Opening hook', placeholder: 'e.g. Most people get this completely wrong', example: 'Most people get this completely wrong' },
      { key: 'point1', label: 'Point 1', placeholder: 'e.g. Witnesses take turns making blocks', example: 'Witnesses take turns making blocks' },
      { key: 'point2', label: 'Point 2', placeholder: 'e.g. Your stake votes them in', example: 'Your stake votes them in' },
      { key: 'cta', label: 'Call to action', placeholder: 'e.g. Follow for more chain basics', example: 'Follow for more chain basics' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: '{{hook}}' },
      { role: 'body', seconds: 5, text: 'Here\'s {{topic}}.' },
      { role: 'body', seconds: 5, text: '1. {{point1}}' },
      { role: 'body', seconds: 5, text: '2. {{point2}}' },
      { role: 'cta', seconds: 3, text: '{{cta}}' },
    ],
  },
  {
    id: 'listicle-5',
    title: '5 Quick Tips (listicle)',
    aspect: '9:16',
    music: 'punchy loop, a beat-drop per tip',
    fields: [
      { key: 'subject', label: 'Subject', placeholder: 'e.g. growing tulsi', example: 'growing tulsi' },
      { key: 'tip1', label: 'Tip 1', placeholder: 'e.g. Full sun', example: 'Full sun' },
      { key: 'tip2', label: 'Tip 2', placeholder: 'e.g. Water in the morning', example: 'Water in the morning' },
      { key: 'tip3', label: 'Tip 3', placeholder: 'e.g. Pinch the flowers', example: 'Pinch the flowers' },
      { key: 'tip4', label: 'Tip 4', placeholder: 'e.g. Well-drained soil', example: 'Well-drained soil' },
      { key: 'tip5', label: 'Tip 5', placeholder: 'e.g. Harvest often', example: 'Harvest often' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: '5 tips for {{subject}}' },
      { role: 'body', seconds: 3, text: '① {{tip1}}' },
      { role: 'body', seconds: 3, text: '② {{tip2}}' },
      { role: 'body', seconds: 3, text: '③ {{tip3}}' },
      { role: 'body', seconds: 3, text: '④ {{tip4}}' },
      { role: 'body', seconds: 3, text: '⑤ {{tip5}}' },
      { role: 'outro', seconds: 2, text: 'Save this for later 🔖' },
    ],
  },
  {
    id: 'before-after',
    title: 'Before → After (transformation)',
    aspect: '9:16',
    music: 'tension then release on the reveal',
    fields: [
      { key: 'subject', label: 'Subject', placeholder: 'e.g. my old logo', example: 'my old logo' },
      { key: 'before', label: 'The "before"', placeholder: 'e.g. plain and forgettable', example: 'plain and forgettable' },
      { key: 'after', label: 'The "after"', placeholder: 'e.g. a clean gold ankh mark', example: 'a clean gold ankh mark' },
      { key: 'how', label: 'How', placeholder: 'e.g. made free on the GenAI page', example: 'made free on the GenAI page' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: '{{subject}} — before' },
      { role: 'body', seconds: 3, text: '{{before}}' },
      { role: 'body', seconds: 1, text: '…wait for it…' },
      { role: 'body', seconds: 3, text: 'After: {{after}}' },
      { role: 'cta', seconds: 3, text: '{{how}}' },
    ],
  },
  {
    id: 'quote-card',
    title: 'Quote / Scripture card',
    aspect: '1:1',
    music: 'calm, ambient pad',
    fields: [
      { key: 'quote', label: 'Quote', placeholder: 'e.g. The light shines in the darkness', example: 'The light shines in the darkness' },
      { key: 'attribution', label: 'Attribution', placeholder: 'e.g. John 1:5', example: 'John 1:5' },
      { key: 'handle', label: 'Your handle', placeholder: 'e.g. @hathor', example: '@hathor' },
    ],
    scenes: [
      { role: 'intro', seconds: 1, text: '“' },
      { role: 'body', seconds: 5, text: '{{quote}}' },
      { role: 'caption', seconds: 2, text: '— {{attribution}}' },
      { role: 'outro', seconds: 2, text: '{{handle}}' },
    ],
  },
  {
    id: 'product-promo',
    title: 'Product / Project promo',
    aspect: '9:16',
    music: 'confident, modern',
    fields: [
      { key: 'name', label: 'Name', placeholder: 'e.g. SoapBox', example: 'SoapBox' },
      { key: 'tagline', label: 'Tagline', placeholder: 'e.g. every coin, one clear view', example: 'every coin, one clear view' },
      { key: 'benefit1', label: 'Benefit 1', placeholder: 'e.g. free and open', example: 'free and open' },
      { key: 'benefit2', label: 'Benefit 2', placeholder: 'e.g. no lock-in', example: 'no lock-in' },
      { key: 'cta', label: 'Call to action', placeholder: 'e.g. Try it today', example: 'Try it today' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: 'Meet {{name}}' },
      { role: 'body', seconds: 3, text: '{{tagline}}' },
      { role: 'body', seconds: 3, text: '✓ {{benefit1}}' },
      { role: 'body', seconds: 3, text: '✓ {{benefit2}}' },
      { role: 'cta', seconds: 3, text: '{{cta}}' },
    ],
  },
  {
    id: 'velocity-edit',
    title: 'Velocity / Beat-Sync Edit',
    aspect: '9:16',
    music: 'high-energy track with a clear beat drop to cut on',
    fields: [
      { key: 'subject', label: 'Subject', placeholder: 'e.g. my week in the studio', example: 'my week in the studio' },
      { key: 'clip1', label: 'Clip 1', placeholder: 'e.g. sunrise over the temple', example: 'sunrise over the temple' },
      { key: 'clip2', label: 'Clip 2', placeholder: 'e.g. hands mixing herbs', example: 'hands mixing herbs' },
      { key: 'clip3', label: 'Clip 3', placeholder: 'e.g. the finished piece', example: 'the finished piece' },
      { key: 'punchline', label: 'Ending line', placeholder: 'e.g. save this one', example: 'save this one' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: 'POV: {{subject}}' },
      { role: 'body', seconds: 2, text: '{{clip1}}' },
      { role: 'body', seconds: 2, text: '{{clip2}}' },
      { role: 'body', seconds: 2, text: '{{clip3}}' },
      { role: 'cta', seconds: 2, text: '{{punchline}}' },
    ],
  },
  {
    id: 'photo-dump',
    title: 'Aesthetic Photo Dump',
    aspect: '1:1',
    music: 'lo-fi, warm and nostalgic',
    fields: [
      { key: 'theme', label: 'Theme', placeholder: 'e.g. late summer', example: 'late summer' },
      { key: 'caption', label: 'Caption', placeholder: 'e.g. a few good days', example: 'a few good days' },
      { key: 'song', label: 'Song', placeholder: 'e.g. something soft', example: 'something soft' },
      { key: 'handle', label: 'Your handle', placeholder: 'e.g. @hathor', example: '@hathor' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: '{{theme}} 📸' },
      { role: 'body', seconds: 3, text: 'swipe through the moments' },
      { role: 'caption', seconds: 3, text: '{{caption}}' },
      { role: 'body', seconds: 2, text: '🎵 {{song}}' },
      { role: 'outro', seconds: 2, text: '{{handle}}' },
    ],
  },
  {
    id: 'grwm',
    title: 'Get Ready With Me (GRWM)',
    aspect: '9:16',
    music: 'chatty, upbeat background pop',
    fields: [
      { key: 'occasion', label: 'Occasion', placeholder: 'e.g. a temple festival', example: 'a temple festival' },
      { key: 'step1', label: 'Step 1', placeholder: 'e.g. skincare first', example: 'skincare first' },
      { key: 'step2', label: 'Step 2', placeholder: 'e.g. the outfit', example: 'the outfit' },
      { key: 'step3', label: 'Step 3', placeholder: 'e.g. final touches', example: 'final touches' },
      { key: 'product', label: 'Favorite product', placeholder: 'e.g. the gold liner', example: 'the gold liner' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: 'GRWM for {{occasion}}' },
      { role: 'body', seconds: 3, text: 'Step 1: {{step1}}' },
      { role: 'body', seconds: 3, text: 'Step 2: {{step2}}' },
      { role: 'body', seconds: 3, text: 'Step 3: {{step3}}' },
      { role: 'cta', seconds: 3, text: 'My pick: {{product}}' },
    ],
  },
  {
    id: 'storytime',
    title: 'Storytime Hook',
    aspect: '9:16',
    music: 'subtle, tension building under the voice',
    fields: [
      { key: 'hook', label: 'Opening hook', placeholder: 'e.g. I was not supposed to see this', example: 'I was not supposed to see this' },
      { key: 'setup', label: 'The setup', placeholder: 'e.g. it started on a normal day', example: 'it started on a normal day' },
      { key: 'twist', label: 'The twist', placeholder: 'e.g. everything changed', example: 'everything changed' },
      { key: 'lesson', label: 'The takeaway', placeholder: 'e.g. here is what I learned', example: 'here is what I learned' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: '{{hook}}' },
      { role: 'body', seconds: 5, text: '{{setup}}' },
      { role: 'body', seconds: 4, text: 'But then... {{twist}}' },
      { role: 'cta', seconds: 3, text: '{{lesson}}' },
    ],
  },
  {
    id: 'countdown-reveal',
    title: 'Countdown → Reveal',
    aspect: '9:16',
    music: 'anticipation build with a hit on the reveal',
    fields: [
      { key: 'teaser', label: 'Teaser', placeholder: 'e.g. the thing everyone asked about', example: 'the thing everyone asked about' },
      { key: 'item', label: 'The reveal', placeholder: 'e.g. our new token', example: 'our new token' },
      { key: 'detail', label: 'Key detail', placeholder: 'e.g. live this Friday', example: 'live this Friday' },
      { key: 'cta', label: 'Call to action', placeholder: 'e.g. set a reminder', example: 'set a reminder' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: '{{teaser}}' },
      { role: 'body', seconds: 2, text: '3... 2... 1...' },
      { role: 'body', seconds: 3, text: '{{item}}' },
      { role: 'body', seconds: 2, text: '{{detail}}' },
      { role: 'cta', seconds: 3, text: '{{cta}}' },
    ],
  },
  {
    id: 'testimonial',
    title: 'Testimonial / Review',
    aspect: '9:16',
    music: 'warm, trustworthy acoustic',
    fields: [
      { key: 'name', label: 'Who', placeholder: 'e.g. Maria', example: 'Maria' },
      { key: 'product', label: 'What they tried', placeholder: 'e.g. the free GenAI page', example: 'the free GenAI page' },
      { key: 'result', label: 'The result', placeholder: 'e.g. ten posts in an hour', example: 'ten posts in an hour' },
      { key: 'rating', label: 'Rating', placeholder: 'e.g. 5 stars', example: '5 stars' },
      { key: 'cta', label: 'Call to action', placeholder: 'e.g. try it free', example: 'try it free' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: '{{name}} tried {{product}}' },
      { role: 'body', seconds: 4, text: 'The result: {{result}}' },
      { role: 'caption', seconds: 2, text: 'Rating: {{rating}}' },
      { role: 'cta', seconds: 3, text: '{{cta}}' },
    ],
  },
  {
    id: 'this-vs-that',
    title: 'This vs That (comparison)',
    aspect: '16:9',
    music: 'playful, back-and-forth rhythm',
    fields: [
      { key: 'topic', label: 'Topic', placeholder: 'e.g. free vs paid AI tools', example: 'free vs paid AI tools' },
      { key: 'optionA', label: 'Option A', placeholder: 'e.g. locked behind a card', example: 'locked behind a card' },
      { key: 'optionB', label: 'Option B', placeholder: 'e.g. free, no login', example: 'free, no login' },
      { key: 'verdict', label: 'Verdict', placeholder: 'e.g. free wins', example: 'free wins' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: '{{topic}}: which wins?' },
      { role: 'body', seconds: 3, text: 'A: {{optionA}}' },
      { role: 'body', seconds: 3, text: 'B: {{optionB}}' },
      { role: 'cta', seconds: 3, text: 'Winner: {{verdict}}' },
    ],
  },
  {
    id: 'faceless-narration',
    title: 'Faceless Narration',
    aspect: '16:9',
    music: 'cinematic underscore, low and steady',
    fields: [
      { key: 'title', label: 'Title', placeholder: 'e.g. The lost temple technology', example: 'The lost temple technology' },
      { key: 'line1', label: 'Line 1', placeholder: 'e.g. it began thousands of years ago', example: 'it began thousands of years ago' },
      { key: 'line2', label: 'Line 2', placeholder: 'e.g. the knowledge was scattered', example: 'the knowledge was scattered' },
      { key: 'line3', label: 'Line 3', placeholder: 'e.g. now it is being rebuilt', example: 'now it is being rebuilt' },
      { key: 'cta', label: 'Call to action', placeholder: 'e.g. read the full library', example: 'read the full library' },
    ],
    scenes: [
      { role: 'intro', seconds: 3, text: '{{title}}' },
      { role: 'body', seconds: 4, text: '{{line1}}' },
      { role: 'body', seconds: 4, text: '{{line2}}' },
      { role: 'body', seconds: 4, text: '{{line3}}' },
      { role: 'cta', seconds: 3, text: '{{cta}}' },
    ],
  },
  {
    id: 'day-in-life',
    title: 'Day in the Life',
    aspect: '9:16',
    music: 'easygoing, vlog-style',
    fields: [
      { key: 'role', label: 'Your role', placeholder: 'e.g. a temple gardener', example: 'a temple gardener' },
      { key: 'morning', label: 'Morning', placeholder: 'e.g. water the herbs', example: 'water the herbs' },
      { key: 'afternoon', label: 'Afternoon', placeholder: 'e.g. mix the tinctures', example: 'mix the tinctures' },
      { key: 'evening', label: 'Evening', placeholder: 'e.g. write the almanack', example: 'write the almanack' },
      { key: 'handle', label: 'Your handle', placeholder: 'e.g. @hathor', example: '@hathor' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: 'A day as {{role}}' },
      { role: 'body', seconds: 3, text: '🌅 {{morning}}' },
      { role: 'body', seconds: 3, text: '☀️ {{afternoon}}' },
      { role: 'body', seconds: 3, text: '🌙 {{evening}}' },
      { role: 'outro', seconds: 2, text: '{{handle}}' },
    ],
  },
  {
    id: 'recipe-steps',
    title: 'Recipe / How-To Steps',
    aspect: '9:16',
    music: 'light, kitchen-friendly groove',
    fields: [
      { key: 'dish', label: 'Dish / result', placeholder: 'e.g. tulsi tea', example: 'tulsi tea' },
      { key: 'ingredient', label: 'Main ingredient', placeholder: 'e.g. fresh tulsi leaves', example: 'fresh tulsi leaves' },
      { key: 'step1', label: 'Step 1', placeholder: 'e.g. boil the water', example: 'boil the water' },
      { key: 'step2', label: 'Step 2', placeholder: 'e.g. steep 5 minutes', example: 'steep 5 minutes' },
      { key: 'step3', label: 'Step 3', placeholder: 'e.g. strain and sip', example: 'strain and sip' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: 'How to make {{dish}}' },
      { role: 'body', seconds: 2, text: 'You need: {{ingredient}}' },
      { role: 'body', seconds: 3, text: '1. {{step1}}' },
      { role: 'body', seconds: 3, text: '2. {{step2}}' },
      { role: 'body', seconds: 3, text: '3. {{step3}}' },
    ],
  },
  {
    id: 'sale-promo',
    title: 'Flash Sale / Promo Countdown',
    aspect: '9:16',
    music: 'urgent, driving beat',
    fields: [
      { key: 'brand', label: 'Brand', placeholder: 'e.g. SoapBox', example: 'SoapBox' },
      { key: 'offer', label: 'Offer', placeholder: 'e.g. 40% off everything', example: '40% off everything' },
      { key: 'code', label: 'Code', placeholder: 'e.g. HATHOR40', example: 'HATHOR40' },
      { key: 'deadline', label: 'Deadline', placeholder: 'e.g. tonight only', example: 'tonight only' },
      { key: 'cta', label: 'Call to action', placeholder: 'e.g. shop now', example: 'shop now' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: '{{brand}} FLASH SALE' },
      { role: 'body', seconds: 3, text: '{{offer}}' },
      { role: 'caption', seconds: 2, text: 'Code: {{code}}' },
      { role: 'body', seconds: 2, text: 'Ends {{deadline}}' },
      { role: 'cta', seconds: 3, text: '{{cta}}' },
    ],
  },
  {
    id: 'pov-trend',
    title: 'POV Trend',
    aspect: '9:16',
    music: 'trending sound, moody or funny to match',
    fields: [
      { key: 'scenario', label: 'Scenario', placeholder: 'e.g. you find a free AI tool', example: 'you find a free AI tool' },
      { key: 'feeling', label: 'The feeling', placeholder: 'e.g. pure relief', example: 'pure relief' },
      { key: 'twist', label: 'The twist', placeholder: 'e.g. it has templates too', example: 'it has templates too' },
      { key: 'sound', label: 'Sound / audio', placeholder: 'e.g. that one viral clip', example: 'that one viral clip' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: 'POV: {{scenario}}' },
      { role: 'body', seconds: 3, text: '{{feeling}}' },
      { role: 'body', seconds: 3, text: '{{twist}}' },
      { role: 'caption', seconds: 2, text: '🎵 {{sound}}' },
    ],
  },
  {
    id: 'property-tour',
    title: 'Property / Space Tour',
    aspect: '16:9',
    music: 'smooth, aspirational',
    fields: [
      { key: 'property', label: 'Property', placeholder: 'e.g. 3-bed in McKinney', example: '3-bed in McKinney' },
      { key: 'price', label: 'Price', placeholder: 'e.g. $2,100/mo', example: '$2,100/mo' },
      { key: 'feature1', label: 'Feature 1', placeholder: 'e.g. big backyard', example: 'big backyard' },
      { key: 'feature2', label: 'Feature 2', placeholder: 'e.g. updated kitchen', example: 'updated kitchen' },
      { key: 'contact', label: 'Contact', placeholder: 'e.g. @hathor', example: '@hathor' },
    ],
    scenes: [
      { role: 'intro', seconds: 3, text: '{{property}}' },
      { role: 'body', seconds: 2, text: '{{price}}' },
      { role: 'body', seconds: 3, text: '✓ {{feature1}}' },
      { role: 'body', seconds: 3, text: '✓ {{feature2}}' },
      { role: 'cta', seconds: 3, text: 'DM {{contact}}' },
    ],
  },
  {
    id: 'myth-fact',
    title: 'Myth vs Fact',
    aspect: '9:16',
    music: 'curious, quiz-show energy',
    fields: [
      { key: 'topic', label: 'Topic', placeholder: 'e.g. church tax exemption', example: 'church tax exemption' },
      { key: 'myth', label: 'The myth', placeholder: 'e.g. you must apply to the IRS', example: 'you must apply to the IRS' },
      { key: 'fact', label: 'The fact', placeholder: 'e.g. churches are exempt by law', example: 'churches are exempt by law' },
      { key: 'source', label: 'Source', placeholder: 'e.g. IRC 508(c)(1)(A)', example: 'IRC 508(c)(1)(A)' },
      { key: 'cta', label: 'Call to action', placeholder: 'e.g. learn more free', example: 'learn more free' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: '{{topic}}: myth or fact?' },
      { role: 'body', seconds: 3, text: '❌ Myth: {{myth}}' },
      { role: 'body', seconds: 3, text: '✅ Fact: {{fact}}' },
      { role: 'caption', seconds: 2, text: 'Source: {{source}}' },
      { role: 'cta', seconds: 3, text: '{{cta}}' },
    ],
  },
  {
    id: 'ai-script-story',
    title: 'AI Script → Story',
    aspect: '9:16',
    music: 'evolving, matches the arc',
    fields: [
      { key: 'idea', label: 'Idea / title', placeholder: 'e.g. the coin that funds a temple', example: 'the coin that funds a temple' },
      { key: 'beginning', label: 'Beginning', placeholder: 'e.g. it starts with one witness', example: 'it starts with one witness' },
      { key: 'middle', label: 'Middle', placeholder: 'e.g. the community grows', example: 'the community grows' },
      { key: 'ending', label: 'Ending', placeholder: 'e.g. the temple is built', example: 'the temple is built' },
      { key: 'cta', label: 'Call to action', placeholder: 'e.g. join the story', example: 'join the story' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: '{{idea}}' },
      { role: 'body', seconds: 4, text: '{{beginning}}' },
      { role: 'body', seconds: 4, text: '{{middle}}' },
      { role: 'body', seconds: 4, text: '{{ending}}' },
      { role: 'cta', seconds: 3, text: '{{cta}}' },
    ],
  },
];

const BY_ID = new Map(REEL_TEMPLATES.map((t) => [t.id, t]));
export function listReelTemplates() { return REEL_TEMPLATES; }
export function getReelTemplate(id) { return BY_ID.get(String(id || '')) || null; }

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
function fillText(pattern, vals) {
  return String(pattern || '').replace(PLACEHOLDER_RE, (_, k) => (vals[k] != null ? vals[k] : '')).replace(/\s+/g, ' ').trim();
}

// buildReelSpec — pure. Turns a template id + filled fields into a downloadable storyboard spec.
// Missing fields fall back to their example. Unknown id → { ok:false }. Bad/empty fields are soft —
// the spec still builds from examples. `opts.aspect` overrides the template default if valid.
export function buildReelSpec(id, fields = {}, opts = {}) {
  const t = getReelTemplate(id);
  if (!t) return { ok: false, error: `unknown reel template: ${String(id || '')}` };

  const vals = {};
  for (const f of t.fields) {
    const raw = fields && fields[f.key] != null ? String(fields[f.key]).trim() : '';
    vals[f.key] = raw || f.example || '';
  }

  const aspect = REEL_ASPECTS.includes(opts.aspect) ? opts.aspect : t.aspect;
  let t0 = 0;
  const scenes = t.scenes.map((s, i) => {
    const start = t0;
    const seconds = Math.max(1, +s.seconds || 1);
    t0 += seconds;
    return { n: i + 1, role: s.role, start, seconds, caption: fillText(s.text, vals) };
  });

  const spec = {
    kind: 'reel-storyboard',
    version: 1,
    template: t.id,
    title: t.title,
    aspect,
    musicCue: t.music,
    totalSeconds: t0,
    sceneCount: scenes.length,
    scenes,
    note: 'A starting template — import into CapCut or any editor. This is a storyboard/shotlist, not a rendered video.',
  };
  return { ok: true, spec };
}

// shotlist — a plain-text rendering of a spec for humans (and a second downloadable format).
export function shotlist(spec) {
  if (!spec || !Array.isArray(spec.scenes)) return '';
  const lines = [];
  lines.push(`${spec.title || 'Reel'} — ${spec.aspect || ''} — ${spec.totalSeconds || 0}s, ${spec.sceneCount || 0} scenes`);
  if (spec.musicCue) lines.push(`Music: ${spec.musicCue}`);
  lines.push('');
  for (const s of spec.scenes) {
    const end = (s.start || 0) + (s.seconds || 0);
    lines.push(`${s.n}. [${s.start}s–${end}s] (${s.role}) ${s.caption}`);
  }
  lines.push('');
  lines.push(spec.note || '');
  return lines.join('\n').trim();
}

// integrity check for /health + tests
export function validateReelTemplates() {
  const errors = [];
  const seen = new Set();
  for (const t of REEL_TEMPLATES) {
    if (!t.id) { errors.push('reel template with no id'); continue; }
    if (seen.has(t.id)) errors.push(`duplicate id: ${t.id}`);
    seen.add(t.id);
    if (!t.title) errors.push(`${t.id}: no title`);
    if (!REEL_ASPECTS.includes(t.aspect)) errors.push(`${t.id}: bad aspect ${t.aspect}`);
    if (!t.music) errors.push(`${t.id}: no music cue`);
    if (!Array.isArray(t.fields) || !t.fields.length) errors.push(`${t.id}: no fields`);
    if (!Array.isArray(t.scenes) || !t.scenes.length) errors.push(`${t.id}: no scenes`);
    const declared = new Set((t.fields || []).map((f) => f.key));
    const used = new Set();
    for (const s of (t.scenes || [])) {
      if (!s.role) errors.push(`${t.id}: scene with no role`);
      if (!(+s.seconds > 0)) errors.push(`${t.id}: scene "${s.text}" has no positive duration`);
      let m; PLACEHOLDER_RE.lastIndex = 0;
      while ((m = PLACEHOLDER_RE.exec(s.text || ''))) used.add(m[1]);
    }
    for (const u of used) if (!declared.has(u)) errors.push(`${t.id}: scene uses undeclared field {{${u}}}`);
    for (const f of (t.fields || [])) {
      if (!f.key) errors.push(`${t.id}: field with no key`);
      if (!f.label) errors.push(`${t.id}: field ${f.key} has no label`);
      if (!used.has(f.key)) errors.push(`${t.id}: declared field ${f.key} never used in a scene`);
    }
    // the builder must produce a serializable spec from examples
    const built = buildReelSpec(t.id, {});
    if (!built.ok) errors.push(`${t.id}: buildReelSpec failed`);
    else { try { JSON.parse(JSON.stringify(built.spec)); } catch { errors.push(`${t.id}: spec does not serialize`); } }
  }
  return { ok: errors.length === 0, errors, count: REEL_TEMPLATES.length };
}

if (process.argv[1] && process.argv[1].endsWith('genai-reel-maker.mjs')) {
  const v = validateReelTemplates();
  console.log(`${REEL_TEMPLATES.length} reel templates · ${v.ok ? '✓ valid' : '✗ ' + v.errors.join('; ')}`);
  for (const t of REEL_TEMPLATES) {
    const { spec } = buildReelSpec(t.id, {});
    console.log(`  [${spec.aspect}] ${t.id} — ${spec.totalSeconds}s, ${spec.sceneCount} scenes`);
  }
}
