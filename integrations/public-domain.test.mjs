// public-domain.test.mjs — offline tests for the PD status calculator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lifePlusYears,
  isPublicDomainUS,
  classify,
  TERMS,
  esc,
  __setClock,
} from './public-domain.mjs';

// Pin the clock so the rolling US window is deterministic across the suite.
__setClock(2026); // cutoff = 2026 - 95 = 1931

test('US 95-year rolling boundary: isPublicDomainUS', () => {
  // cutoff is 1931: published strictly before 1931 => PD.
  assert.equal(isPublicDomainUS(1930), true, '1930 < 1931 cutoff -> PD');
  assert.equal(isPublicDomainUS(1931), false, '1931 is the cutoff, not before it');
  assert.equal(isPublicDomainUS(1925), true);
  assert.equal(isPublicDomainUS(2000), false);
  // asOf override moves the window.
  assert.equal(isPublicDomainUS(1931, { asOf: 2027 }), true, 'next year, 1931 falls in');
});

test('US classify uses the rolling window and reports entersPdYear', () => {
  const pd = classify({ pubYear: 1920, country: 'US' });
  assert.equal(pd.status, 'public-domain');
  assert.equal(pd.entersPdYear, 1920 + 95 + 1); // 2016

  const inc = classify({ pubYear: 1980, country: 'US' });
  assert.equal(inc.status, 'in-copyright');
  assert.equal(inc.entersPdYear, 1980 + 95 + 1); // 2076

  // default country is US
  assert.equal(classify({ pubYear: 1900 }).status, 'public-domain');
});

test('life+70 boundary (lifePlusYears + classify)', () => {
  // term runs through end of 70th year after death; PD begins year after.
  assert.equal(lifePlusYears(1950, { term: 70 }), 2021);
  assert.equal(lifePlusYears(1956), 2027); // default term 70

  // asOf 2026: died 1955 -> PD 2026 (>=) ; died 1956 -> PD 2027 (still in-copyright)
  const justIn = classify({ authorDeathYear: 1955, country: 'GB' });
  assert.equal(justIn.status, 'public-domain');
  assert.equal(justIn.entersPdYear, 2026);

  const stillCopy = classify({ authorDeathYear: 1956, country: 'EU' });
  assert.equal(stillCopy.status, 'in-copyright');
  assert.equal(stillCopy.entersPdYear, 2027);
});

test('life+50 country (CN) uses its shorter term', () => {
  assert.equal(TERMS.CN.term, 50);
  const c = classify({ authorDeathYear: 1970, country: 'CN' });
  assert.equal(c.entersPdYear, 1970 + 50 + 1); // 2021
  assert.equal(c.status, 'public-domain');

  const c2 = classify({ authorDeathYear: 1980, country: 'CN' });
  assert.equal(c2.entersPdYear, 2031);
  assert.equal(c2.status, 'in-copyright');
});

test('unknown: missing data soft-fails to {status:"unknown"}', () => {
  // US rule but no pubYear
  assert.equal(classify({ country: 'US' }).status, 'unknown');
  // life rule but no authorDeathYear and not old enough to guess
  assert.equal(classify({ country: 'GB' }).status, 'unknown');
  // unmapped country
  const u = classify({ pubYear: 1900, country: 'ZZ' });
  assert.equal(u.status, 'unknown');
  assert.equal(u.entersPdYear, null);
});

test('life regime with no death year but very old pub => likely-public-domain', () => {
  // asOf 2026, pubYear < 2026-120 = 1906
  const r = classify({ pubYear: 1850, country: 'FR' });
  assert.equal(r.status, 'likely-public-domain');
  assert.equal(r.entersPdYear, null);
});

test('soft-fail: bad inputs never throw', () => {
  assert.equal(lifePlusYears('not-a-year'), null);
  assert.equal(lifePlusYears(undefined), null);
  assert.equal(isPublicDomainUS('xyz'), false);
  assert.equal(isPublicDomainUS(NaN), false);
  assert.equal(classify({ pubYear: 'oops', country: 'US' }).status, 'unknown');
  assert.equal(classify().status, 'unknown'); // no args at all (US, no pubYear)
});

test('esc() escapes HTML in a status string', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
  // an unmapped country with markup is escaped in the reason
  const r = classify({ pubYear: 1900, country: '<x>' });
  assert.ok(r.reason.includes('&lt;X&gt;')); // country is upper-cased then esc()'d
});

test('__setClock accepts a number or function; asOf overrides', () => {
  __setClock(2000); // cutoff 1905
  assert.equal(isPublicDomainUS(1904), true);
  assert.equal(isPublicDomainUS(1906), false);
  __setClock(() => 2050); // cutoff 1955
  assert.equal(isPublicDomainUS(1954), true);
  assert.equal(isPublicDomainUS(1956), false);
  // explicit asOf still wins over the clock
  assert.equal(isPublicDomainUS(1956, { asOf: 2026 }), false);
  __setClock(2026); // restore for any later runs
});
