// entitlements — who may do what in Herald.
//
// Operator's rule, 2026-09-08: "we still don't want anyone Emailing unless I invite them, but let's
// make PMs available to all Users. No Hijacking each Others Accounts, Login Required."
//
// So there are exactly two tiers and one non-negotiable floor:
//
//   FLOOR    every capability requires a signed session. Nothing here is anonymous, and the account
//            is taken FROM the session -- never from a request parameter. That is the whole defence
//            against acting as someone else, and it is why `check()` refuses a `claimedAccount` that
//            disagrees with the session instead of trusting the caller.
//
//   PM       any logged-in account. Messaging is the product; gating it would leave an empty room.
//
//   EMAIL    ⚠️ operator-granted only. Cold email at volume is the capability that can burn a
//            sending domain, get an account blacklisted, or put a stranger's inbox in our hands.
//            Herald already refuses to cold-send from an identity domain; this is the same
//            principle applied to WHO may send at all.
//
// Why an allow-list rather than the signup invite tree: a signup invite says someone was let into
// the product. It does not say the operator wants that person emailing 604 institutions under our
// name. Those are different grants and conflating them is how a good invite system becomes an open
// relay.

const str = (v) => String(v == null ? '' : v);
const acct = (v) => str(v).toLowerCase().trim();

export const CAPABILITIES = Object.freeze({
  pm: {
    id: 'pm', label: 'Private messages',
    tier: 'all-users',
    why: 'Messaging is the product. Every logged-in account gets it.',
  },
  campaign_build: {
    id: 'campaign_build', label: 'Build campaigns, import leads, write sequences',
    tier: 'all-users',
    why: 'Building a campaign sends nothing. Letting people prepare freely and gating only the send '
       + 'is what makes the gate tolerable rather than a wall.',
  },
  email_send: {
    id: 'email_send', label: 'Send email',
    tier: 'operator-invited',
    why: '⚠️ The capability that can burn a sending domain or put strangers\' inboxes in our hands.',
  },
  bulk_import: {
    id: 'bulk_import', label: 'Import more than 500 leads at once',
    tier: 'operator-invited',
    why: 'A large list is only useful to someone who can send to it.',
  },
});

/** Accounts the operator has granted send rights. Env so it needs no deploy to change. */
export function invitedSenders(env = process.env) {
  return new Set(
    str(env.HERALD_INVITED_SENDERS || '')
      .split(/[,\s]+/).map(acct).filter(Boolean),
  );
}

/** The operator themselves always has it, without needing to be on their own list. */
export function operators(env = process.env) {
  return new Set(
    str(env.HERALD_OPERATORS || env.MELEK_ROOT || 'vankush')
      .split(/[,\s]+/).map(acct).filter(Boolean),
  );
}

/**
 * The single authorization call.
 *
 * @param {object} o
 *   session        the verified session ({ account }) — the ONLY source of identity
 *   capability     a key of CAPABILITIES
 *   claimedAccount optional: an account named in the request. If it disagrees with the session this
 *                  is REFUSED as impersonation rather than silently using the session, because a
 *                  request that names a different account is either a bug or an attempt.
 */
export function check({ session = null, capability = '', claimedAccount = '', env = process.env } = {}) {
  const cap = CAPABILITIES[str(capability)];
  if (!cap) return { ok: false, code: 'unknown-capability', reason: `no such capability "${capability}"` };

  const me = acct(session && session.account);
  if (!me) {
    return { ok: false, code: 'login-required', reason: 'login required — every capability needs a signed session' };
  }

  // Impersonation guard. Identity comes from the session, full stop.
  const claimed = acct(claimedAccount);
  if (claimed && claimed !== me) {
    return {
      ok: false, code: 'impersonation',
      reason: `session is @${me} but the request acts as @${claimed} — refusing rather than guessing`,
      account: me,
    };
  }

  if (cap.tier === 'all-users') {
    return { ok: true, code: 'granted', account: me, capability: cap.id, via: 'all-users' };
  }

  if (operators(env).has(me)) {
    return { ok: true, code: 'granted', account: me, capability: cap.id, via: 'operator' };
  }
  if (invitedSenders(env).has(me)) {
    return { ok: true, code: 'granted', account: me, capability: cap.id, via: 'operator-invite' };
  }

  return {
    ok: false, code: 'not-invited', account: me, capability: cap.id,
    reason: `@${me} may build campaigns but not ${cap.label.toLowerCase()} — that is granted by the `
          + 'operator, one account at a time.',
  };
}

/** What this session can do, for a UI that should not offer a button it will then refuse. */
export function capabilitiesFor(session, env = process.env) {
  const me = acct(session && session.account);
  if (!me) return { account: '', loggedIn: false, can: [], cannot: Object.keys(CAPABILITIES) };
  const can = []; const cannot = [];
  for (const id of Object.keys(CAPABILITIES)) {
    (check({ session, capability: id, env }).ok ? can : cannot).push(id);
  }
  return {
    account: me, loggedIn: true, can, cannot,
    note: cannot.includes('email_send')
      ? 'You can build and import. Sending is granted by the operator per account.'
      : 'Full access including send.',
  };
}

/**
 * A send-time guard that re-checks at the moment of the send.
 *
 * Checking once at campaign creation is not enough: a grant can be revoked between building a
 * campaign and firing it, and the send is the moment that actually costs something.
 */
export function guardSend({ session, campaign = {}, env = process.env } = {}) {
  const c = check({ session, capability: 'email_send', claimedAccount: campaign.owner, env });
  if (!c.ok) return c;
  if (acct(campaign.owner) && acct(campaign.owner) !== acct(session.account)) {
    return { ok: false, code: 'not-your-campaign', reason: 'that campaign belongs to another account' };
  }
  return { ok: true, code: 'granted', account: c.account, via: c.via };
}

export function handler(req, res) {
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj, null, 2));
  };
  return send(200, {
    ok: true, service: 'herald-entitlements',
    capabilities: Object.values(CAPABILITIES).map((c) => ({ id: c.id, label: c.label, tier: c.tier, why: c.why })),
    policy: 'Login required for everything. PMs and campaign-building are open to every logged-in '
          + 'account. Email sending is operator-granted, one account at a time. Identity always comes '
          + 'from the session — a request naming a different account is refused as impersonation.',
  });
}
