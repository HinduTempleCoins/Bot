// melek-theme.test.mjs — offline, no network, no keys. Verifies the shared vaporwave-core tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, themeVars, themeCSS, CONTEXTS, CORE, FUNCTIONAL,
} from './melek-theme.mjs';

test('vaporwave core tokens are always present, on every context', () => {
  for (const ctx of CONTEXTS) {
    const v = themeVars(ctx);
    assert.equal(v['--mk-magenta'], CORE.magenta, `${ctx}: magenta present`);
    assert.equal(v['--mk-cyan'], CORE.cyan, `${ctx}: cyan present`);
    assert.equal(v['--mk-bg'], CORE.bg, `${ctx}: plum ground present`);
    assert.ok(v['--mk-sunset'].includes(CORE.sunsetLow), `${ctx}: sunset gradient present`);
  }
});

test('ground is deep plum, never pure black (psycho-guide halation rule)', () => {
  const v = themeVars('default');
  assert.notEqual(v['--mk-bg'].toLowerCase(), '#000000');
  assert.notEqual(v['--mk-bg'].toLowerCase(), '#000');
});

test('context shifts only the ACCENT, not the vaporwave core', () => {
  const def = themeVars('default');
  const temple = themeVars('temple');
  const neon = themeVars('neon');
  // core constant across contexts
  assert.equal(def['--mk-bg'], temple['--mk-bg']);
  assert.equal(def['--mk-magenta'], neon['--mk-magenta']);
  // accents differ by context
  assert.equal(def['--mk-primary'], CORE.magenta, 'default primary = magenta');
  assert.equal(temple['--mk-primary'], '#e8b923', 'temple primary = gold');
  assert.equal(neon['--mk-primary'], CORE.cyan, 'neon primary = cyan');
});

test('functional gain/red reserved and distinct from brand hues', () => {
  const v = themeVars('default');
  assert.equal(v['--mk-gain'], FUNCTIONAL.gain);
  assert.equal(v['--mk-loss'], FUNCTIONAL.loss);
  assert.notEqual(v['--mk-gain'], v['--mk-primary']);
  assert.notEqual(v['--mk-loss'], v['--mk-magenta']);
});

test('unknown context falls back to default (never throws)', () => {
  assert.deepEqual(themeVars('bogus'), themeVars('default'));
});

test('themeCSS emits a <style> with :root vars + readable body base', () => {
  const css = themeCSS({ context: 'temple' });
  assert.match(css, /<style>/);
  assert.match(css, /:root\{/);
  assert.match(css, /--mk-primary: #e8b923;/); // temple gold
  assert.match(css, /body\{background:var\(--mk-bg\);color:var\(--mk-text\)/);
  assert.match(css, /a\{color:var\(--mk-cyan\)/);
  assert.match(css, /readability guardrail/i); // the eyestrain guardrail comment ships
});

test('themeCSS honors a custom selector and escapes it', () => {
  const css = themeCSS({ selector: '.metaverse' });
  assert.match(css, /\.metaverse\{/);
  const bad = themeCSS({ selector: '</style><x>' });
  assert.doesNotMatch(bad, /<\/style><x>/); // esc() neutralized it
});

test('esc neutralizes html metacharacters', () => {
  assert.equal(esc('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
});
