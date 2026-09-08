// claims — the one positioning axis we can actually defend, and the guards that keep us on it.
//
// Operator, 2026-09-08:
//
//   "Ours is Native PMs, most of our Claims will be that way, like 'Other Chains have more 3rd Party,
//    but not more IaaS PaaS or even SaaS Infrastructure.'"
//
// That is the whole strategy in one line, and it fixes a mistake this repo kept making.
//
// ── THE WRONG AXIS: SIZE ──────────────────────────────────────────────────────────────────────────
//
// Every size claim we could make is losable. "More dApps than Ethereum" — no. "The only chain with
// private messaging" — no; it is the GRAPHENE family that lacks them, and somebody shipped
// @snapie/chat-client to npm in mid-2026 anyway. A size claim invites a bigger number, and there is
// always a bigger number.
//
// ── THE RIGHT AXIS: FIRST-PARTY ───────────────────────────────────────────────────────────────────
//
// Other ecosystems have more THIRD-PARTY surface. They do not have more of their own stack. The
// Ethereum Foundation does not run an email service, a fax service, a PDF toolchain, an image host or
// a CRM. We run all of it, on chains we also run, in one repo. That is not a boast about scale; it is
// a statement about ownership, and it is checkable line by line.
//
// The claim shape that follows is therefore never "we have more X than Y". It is:
//
//   "X is native here. Everywhere else it is a third-party bolt-on, or it does not exist."
//
// which is a claim about WHOSE it is, not HOW MUCH there is — and it survives someone arriving with a
// bigger number, because the bigger number was never the point.
//
// `verify()` refuses the size shape and the overreaching version of the native shape, and `phrase()`
// hands back the sentence that is actually true.

const str = (v) => String(v == null ? '' : v).trim();
const low = (v) => str(v).toLowerCase();

// ── what we actually operate, first-party ─────────────────────────────────────────────────────────
// Only things this organization runs. A dependency we merely use does not belong here — that is the
// discipline that keeps the inventory honest enough to publish.
export const NATIVE = Object.freeze({
  iaas: {
    label: 'Infrastructure we run',
    items: [
      'MELEK — a Graphene/DPoS chain, mainnet and testnet, our own witness nodes',
      'PRANA — an EVM proof-of-work chain (Etchash), our own miners and RPC',
      'the mining pool, with in-browser wallet generation',
      'the bridge between them',
    ],
  },
  paas: {
    label: 'Platform we run on top of it',
    items: [
      'KULA Swap — a DEX on PRANA, with farms, gauges, a lotto and an arcade',
      'MELEK-Engine — a side-token layer',
      'the signup, invite-tree and account-creation path',
      'Hathor — an AI witness account that produces blocks, tips, teaches and moderates',
    ],
  },
  saas: {
    label: 'Software people actually use',
    items: [
      'Pentecaust — messaging, email, channels and translation',
      'Herald — outreach and CRM',
      'SoapBox — image hosting, PDF tools, internet fax, document services',
      'Witness School and the Library of Ashurbanipal',
      'Congress.ink — a social client',
    ],
  },
});

/** Features that are NATIVE here and are third-party or absent elsewhere. */
export const NATIVE_FEATURES = Object.freeze({
  private_messages: {
    id: 'private_messages',
    true: 'Graphene social chains — Steem, Hive, Blurt and their forks — have no native private '
        + 'messaging at all. Pentecaust gives MELEK its own.',
    // The precise scope matters. Overreach here is how a good claim becomes a correctable one.
    scope: 'graphene chains',
    notTrue: 'that no blockchain has private messaging (Nostr, Matrix-bridged chains, DeSo and Minds '
           + 'all do), and not that nobody else is building it for Hive — @snapie/chat-client shipped '
           + 'to npm in mid-2026.',
    odd: 'A chain family built for posting, following, curating and tipping, with no way to say '
       + 'something to one person. That is the genuinely strange part, and it is the claim.',
  },
  translation: {
    id: 'translation',
    true: 'Translation is built into Pentecaust rather than bolted on by a third party.',
    scope: 'graphene chains',
    notTrue: 'that our translation is better than DeepL or Google. It is not a quality claim.',
  },
  full_stack: {
    id: 'full_stack',
    true: 'Chain, DEX, messaging, email, document tools and CRM are all first-party, in one stack, '
        + 'run by the same people.',
    scope: 'every ecosystem we know of',
    notTrue: 'that our ecosystem is larger. It is not, and that was never the claim.',
  },
});

// ── refusals ──────────────────────────────────────────────────────────────────────────────────────
const REFUSALS = Object.freeze({
  size_comparison: 'A size claim invites a bigger number, and there is always a bigger number. Other '
    + 'ecosystems have more third-party surface — say so, and then say what we run ourselves.',
  overreach_native: 'Scope it. Graphene chains have no native PMs; "no blockchain has PMs" is false '
    + '(Nostr, Matrix, DeSo, Minds) and hands the argument away in one reply.',
  only_ones: '"The only" is almost always checkably wrong and costs the whole paragraph when it is.',
  counting_others: 'Never claim a number for somebody else\'s ecosystem. We have not counted it.',
});

/**
 * Check a claim before it is published. Returns the specific refusal, and — this is the useful part —
 * what to say instead.
 */
export function verify(text = '') {
  const t = low(text);
  const problems = [];

  if (/\b(more|bigger|larger|biggest|largest|most)\b[^.]{0,60}\b(than|dapps|projects|users|ecosystem|chains)\b/.test(t)
      && !/third[- ]party/.test(t)) {
    problems.push({
      code: 'size_comparison', why: REFUSALS.size_comparison,
      instead: 'Other chains have more third-party surface. They do not run more of their own stack.',
    });
  }
  if (/\b(no|not a|zero)\s+blockchain[s]?\b[^.]{0,40}\b(private message|pms|dms|messaging)\b/.test(t)
      || /\b(private message|pms|dms)\b[^.]{0,40}\bdo(es)? not exist\b/.test(t)) {
    problems.push({
      code: 'overreach_native', why: REFUSALS.overreach_native,
      instead: NATIVE_FEATURES.private_messages.true,
    });
  }
  if (/\bthe only\b/.test(t)) {
    problems.push({ code: 'only_ones', why: REFUSALS.only_ones, instead: 'Say what is native here, and let that stand.' });
  }
  if (/\b\d[\d,]*\+?\s*(dapps|projects|protocols)\b/.test(t) && /\b(ethereum|solana|hive|steem|bnb|polygon)\b/.test(t)) {
    problems.push({ code: 'counting_others', why: REFUSALS.counting_others, instead: 'Drop the number.' });
  }

  return problems.length
    ? { ok: false, problems, reason: problems.map((p) => p.why).join(' ') }
    : { ok: true };
}

/** The sentence that is actually true about a native feature, with its scope attached. */
export function phrase(featureId) {
  const f = NATIVE_FEATURES[low(featureId)];
  if (!f) return { ok: false, code: 'unknown-feature', reason: `no such claim "${featureId}"` };
  const line = `${f.true} (Scope: ${f.scope}.)`;
  const v = verify(line);
  return v.ok
    ? { ok: true, id: f.id, say: line, doNotSay: f.notTrue, note: f.odd || null }
    : { ok: false, ...v };
}

/** The whole first-party inventory as one countable statement. */
export function inventory() {
  const layers = Object.entries(NATIVE).map(([k, v]) => ({
    layer: k.toUpperCase(), label: v.label, count: v.items.length, items: v.items,
  }));
  return {
    ok: true,
    layers,
    total: layers.reduce((n, l) => n + l.count, 0),
    claim: 'Other ecosystems have more third-party surface. None of them runs more of its own '
         + 'infrastructure, platform and software than this one does.',
    checkable: 'Every line is a thing that is running or is not. Nothing here is a projection.',
  };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'claims',
    axis: 'first-party, not size',
    features: Object.values(NATIVE_FEATURES).map((f) => ({ id: f.id, say: f.true, scope: f.scope, doNotSay: f.notTrue })),
    refuses: REFUSALS,
    ...inventory(),
  }, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith('claims.mjs')) {
  const inv = inventory();
  for (const l of inv.layers) console.log(`${l.layer.padEnd(6)} ${l.count}  ${l.label}`);
  console.log(`\n${inv.claim}\n`);
  console.log(phrase('private_messages').say);
}
