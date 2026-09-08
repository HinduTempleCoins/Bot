// token-invariants — the deploy-time decisions that cannot be undone, checked before they are made.
//
// WHY THIS EXISTS. Today's audit of the live PRANA KULA found one Critical and two High findings, and
// NOT ONE OF THEM WAS A BUG. Every one was a choice made at deployment and frozen there:
//
//   cap() is 11,000,000 on a token described everywhere as 100,000
//   an EmissionScheduler holds MINTER_ROLE, minting 1,000,000/year to an EOA, forever, never halving,
//     and mintDue() is permissionless so anyone can trigger it
//   88.09% of supply sits in one EOA which also holds PAUSER_ROLE with NO timelock delay
//
// Those took seconds to decide and cannot be revised. The contract is not upgradeable, and the
// remediation for each is now more expensive and more visible than declining it would have been.
//
// So this module is a checklist that runs. Give it what a token WILL be, before it is, and it says
// which of those choices are permanent and which are recoverable — and it refuses to grade a claim it
// cannot check, because "we did not verify" and "it is fine" are different answers.
//
// It is deliberately not a linter and does not read Solidity. It checks DECLARED intent, which is the
// thing a person actually gets wrong. Reading the bytecode afterwards is `prana-contract-audit`'s job.

const str = (v) => String(v == null ? '' : v).trim();

/**
 * The properties that are permanent once deployed, in the order they cost you.
 *
 * `permanent` means: no upgrade path, no admin function, no governance vote can change it afterwards.
 * That is what makes these worth an argument BEFORE deployment and worthless after.
 */
export const INVARIANTS = Object.freeze({
  supplyIsFixed: {
    permanent: true,
    ask: 'Can new tokens ever be created?',
    good: 'No mint function exists. Supply is a compile-time constant minted once.',
    bad: 'A mint function, a cap above the intended supply, or any MINTER_ROLE that outlives deployment.',
    why: 'KULA is capped at 11,000,000 while being described as 100,000. The cap is not a bug and cannot be lowered.',
  },
  mintAuthority: {
    permanent: true,
    ask: 'Who can mint?',
    good: 'Nobody. Mint authority belonging to no one is stronger than a promise not to use a key.',
    bad: 'An EOA, a scheduler contract, a multisig, or a timelock — all of them are somebody.',
    why: 'KULA\'s EmissionScheduler mints 1,000,000/year to an EOA and mintDue() is permissionless.',
  },
  pauseAuthority: {
    permanent: false,
    ask: 'Can transfers be frozen, and by whom, and how fast?',
    good: 'No pause exists. If one must, it is behind the same timelock as everything else.',
    bad: 'An EOA holding PAUSER_ROLE with no delay — instant, unilateral, and it freezes any escrow too.',
    why: 'KULA\'s pauser is an EOA with no timelock while DEFAULT_ADMIN has 48h. A pause strands bridged value.',
  },
  initialDistribution: {
    permanent: true,
    ask: 'Where does the whole supply land at deployment?',
    good: 'A contract — a Safe or a TimelockController — enforced in the constructor, not requested in a comment.',
    bad: 'An externally-owned account. Every scanner flags top-holder concentration on day one, correctly.',
    why: '88.09% of KULA sits in one EOA. KulaHub documented "MUST be a multisig" and enforced nothing.',
  },
  burnable: {
    permanent: true,
    ask: 'Can holders burn?',
    good: 'Only if the supply invariant is written to survive it — totalSupply + cumulativeBurned.',
    bad: 'Burnable while an auditor asserts totalSupply() == FIXED. The first burn makes that false forever.',
    why: 'A supply auditor that reports drift during legitimate use trains everyone to ignore it.',
  },
  upgradeable: {
    permanent: true,
    ask: 'Is there a proxy?',
    good: 'No. The bytecode read at verification is the bytecode forever.',
    bad: 'Any proxy. It converts every other answer here into a temporary one.',
    why: 'An upgradeable token means none of the guarantees above are guarantees.',
  },
});

export const UNKNOWN = 'unknown';

/**
 * Check a declared token spec.
 *
 * Every field is REQUIRED to be stated. An omitted field is `unknown` and counts as a failure, not a
 * pass — the whole failure mode being guarded against is a decision nobody consciously made.
 */
export function check(spec = {}) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const rows = [];

  const ask = (key, ok, detail) => {
    const inv = INVARIANTS[key];
    const stated = Object.prototype.hasOwnProperty.call(s, key);
    if (!stated) {
      rows.push({ key, verdict: UNKNOWN, permanent: inv.permanent, detail: `not stated — "${inv.ask}" must be answered before deployment, not after`, why: inv.why });
      return;
    }
    rows.push({ key, verdict: ok ? 'ok' : 'problem', permanent: inv.permanent, detail, why: inv.why });
  };

  ask('supplyIsFixed', s.supplyIsFixed === true,
    s.supplyIsFixed === true ? 'no mint path; supply is constant' : 'supply can grow — this is permanent');
  ask('mintAuthority', str(s.mintAuthority).toLowerCase() === 'nobody',
    str(s.mintAuthority).toLowerCase() === 'nobody' ? 'mint authority belongs to nobody' : `mint authority held by "${str(s.mintAuthority) || '(unstated)'}" — permanent`);
  ask('pauseAuthority', str(s.pauseAuthority).toLowerCase() === 'none' || str(s.pauseAuthority).toLowerCase() === 'timelock',
    `pause held by "${str(s.pauseAuthority) || '(unstated)'}"`);
  ask('initialDistribution', str(s.initialDistribution).toLowerCase() === 'contract',
    str(s.initialDistribution).toLowerCase() === 'contract' ? 'supply lands in a contract' : `supply lands in "${str(s.initialDistribution) || '(unstated)'}" — an EOA here is the mistake already made once`);
  ask('burnable', s.burnable === false || (s.burnable === true && s.supplyInvariantSurvivesBurn === true),
    s.burnable === false ? 'not burnable; supply assertions stay true' : 'burnable — the supply invariant must account for it');
  ask('upgradeable', s.upgradeable === false,
    s.upgradeable === false ? 'no proxy' : 'upgradeable — every other answer here becomes temporary');

  const problems = rows.filter((r) => r.verdict === 'problem');
  const unknowns = rows.filter((r) => r.verdict === UNKNOWN);
  const permanentProblems = problems.filter((r) => r.permanent);
  return {
    ok: problems.length === 0 && unknowns.length === 0,
    rows,
    problems: problems.length,
    unknowns: unknowns.length,
    permanentProblems: permanentProblems.length,
    verdict: unknowns.length ? 'incomplete'
      : permanentProblems.length ? 'permanent-problems'
        : problems.length ? 'recoverable-problems' : 'clean',
    note: permanentProblems.length
      ? 'These cannot be fixed after deployment. Change them now or accept them forever.'
      : 'Nothing permanent is wrong. Recoverable items should still be settled before a public pool exists.',
  };
}

/** Cornpone, as drafted. Supply and authority settled; purpose deliberately not. */
export const CORNPONE = Object.freeze({
  name: 'Cornpone', symbol: 'PONE', decimals: 18, totalSupply: '1000000',
  supplyIsFixed: true,
  mintAuthority: 'nobody',
  pauseAuthority: 'none',
  initialDistribution: 'contract',
  burnable: false,
  upgradeable: false,
  purpose: 'undecided, deliberately — purpose is not encoded in a token; supply and authority are',
  inscription: 'Mark Twain, "Corn-Pone Opinions" (1901), public domain',
});

/** The live PRANA KULA, as measured on-chain 2026-09-08. Kept as the worked counter-example. */
export const KULA_AS_DEPLOYED = Object.freeze({
  name: 'KulaSwap', symbol: 'KULA', decimals: 18, totalSupply: '100000',
  supplyIsFixed: false,
  mintAuthority: 'EmissionScheduler contract (1,000,000/yr to an EOA, permissionless mintDue)',
  pauseAuthority: 'EOA, no timelock delay',
  initialDistribution: 'EOA (88.09%)',
  burnable: false,
  upgradeable: false,
});

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'token-invariants',
    invariants: Object.keys(INVARIANTS),
    rule: 'an unstated answer is a failure, not a pass — the failure mode is a decision nobody consciously made',
    cornpone: check(CORNPONE).verdict,
  }, null, 2));
}

export default { INVARIANTS, check, CORNPONE, KULA_AS_DEPLOYED, handler };

if (process.argv[1] && process.argv[1].endsWith('token-invariants.mjs')) {
  for (const [label, spec] of [['CORNPONE (drafted)', CORNPONE], ['KULA (as deployed)', KULA_AS_DEPLOYED]]) {
    const r = check(spec);
    console.log(`\n${label}: ${r.verdict}  (${r.permanentProblems} permanent problem(s))`);
    for (const row of r.rows.filter((x) => x.verdict !== 'ok')) console.log(`   ${row.verdict.padEnd(8)} ${row.key}: ${row.detail}`);
  }
}
