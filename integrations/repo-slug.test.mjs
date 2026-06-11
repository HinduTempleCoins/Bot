import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepo, toUrl, toSsh, dedupeRepos, repoKey, esc, KNOWN_HOSTS } from './repo-slug.mjs';

test('parseRepo: bare owner/name defaults to github.com', () => {
  assert.deepEqual(parseRepo('owner/name'), { owner: 'owner', name: 'name', host: 'github.com' });
});

test('parseRepo: https url, strips .git', () => {
  assert.deepEqual(parseRepo('https://github.com/foo/bar.git'), { owner: 'foo', name: 'bar', host: 'github.com' });
  assert.deepEqual(parseRepo('https://github.com/foo/bar'), { owner: 'foo', name: 'bar', host: 'github.com' });
});

test('parseRepo: http and other forge hosts', () => {
  assert.deepEqual(parseRepo('http://gitlab.com/a/b.git'), { owner: 'a', name: 'b', host: 'gitlab.com' });
  assert.deepEqual(parseRepo('https://bitbucket.org/x/y'), { owner: 'x', name: 'y', host: 'bitbucket.org' });
});

test('parseRepo: scp-like git@host:owner/name.git', () => {
  assert.deepEqual(parseRepo('git@github.com:foo/bar.git'), { owner: 'foo', name: 'bar', host: 'github.com' });
  assert.deepEqual(parseRepo('git@gitlab.com:o/n'), { owner: 'o', name: 'n', host: 'gitlab.com' });
});

test('parseRepo: ssh:// url with userinfo and port', () => {
  assert.deepEqual(parseRepo('ssh://git@bitbucket.org/o/n.git'), { owner: 'o', name: 'n', host: 'bitbucket.org' });
  assert.deepEqual(parseRepo('ssh://git@github.com:22/o/n.git'), { owner: 'o', name: 'n', host: 'github.com' });
});

test('parseRepo: strips query and fragment', () => {
  assert.deepEqual(parseRepo('https://github.com/foo/bar?tab=readme#frag'), { owner: 'foo', name: 'bar', host: 'github.com' });
  assert.deepEqual(parseRepo('https://github.com/foo/bar.git?x=1'), { owner: 'foo', name: 'bar', host: 'github.com' });
});

test('parseRepo: surrounding whitespace + www + case-insensitive host', () => {
  assert.deepEqual(parseRepo('  https://WWW.GitHub.com/Foo/Bar  '), { owner: 'Foo', name: 'Bar', host: 'github.com' });
});

test('parseRepo: trailing slash tolerated', () => {
  assert.deepEqual(parseRepo('https://github.com/foo/bar/'), { owner: 'foo', name: 'bar', host: 'github.com' });
});

test('parseRepo: host-prefixed bare slug', () => {
  assert.deepEqual(parseRepo('gitlab.com/o/n'), { owner: 'o', name: 'n', host: 'gitlab.com' });
});

test('parseRepo: soft-fail on garbage -> null, never throws', () => {
  for (const g of [null, undefined, '', '   ', 'justone', 'http://', '://bad', '/', 'owner/', '/name', 42, {}, [], 'a/..', '../b', 'a b/c d/e']) {
    assert.equal(parseRepo(g), null, `expected null for ${JSON.stringify(g)}`);
  }
});

test('parseRepo: rejects malformed scheme', () => {
  assert.equal(parseRepo('foo://github.com'), null);
});

test('toUrl: from string and from parsed object, host override', () => {
  assert.equal(toUrl('git@github.com:foo/bar.git'), 'https://github.com/foo/bar');
  assert.equal(toUrl({ owner: 'a', name: 'b', host: 'gitlab.com' }), 'https://gitlab.com/a/b');
  assert.equal(toUrl('owner/name', { host: 'bitbucket.org' }), 'https://bitbucket.org/owner/name');
  assert.equal(toUrl('garbage'), null);
});

test('toSsh: canonical ssh remote', () => {
  assert.equal(toSsh('https://github.com/foo/bar.git'), 'git@github.com:foo/bar.git');
  assert.equal(toSsh('o/n'), 'git@github.com:o/n.git');
  assert.equal(toSsh(null), null);
});

test('repoKey: lowercased canonical key', () => {
  assert.equal(repoKey('https://github.com/Foo/Bar'), 'github.com/foo/bar');
  assert.equal(repoKey('bad'), null);
});

test('dedupeRepos: unique by lowercased owner/name (+host), first wins', () => {
  const out = dedupeRepos([
    'owner/name',
    'https://github.com/Owner/Name.git',  // dup (case-insensitive)
    'git@github.com:owner/name.git',       // dup
    'https://gitlab.com/owner/name',        // different host -> kept
    'garbage',                              // filtered
    'second/repo',
  ]);
  assert.deepEqual(out, [
    { owner: 'owner', name: 'name', host: 'github.com' },
    { owner: 'owner', name: 'name', host: 'gitlab.com' },
    { owner: 'second', name: 'repo', host: 'github.com' },
  ]);
});

test('dedupeRepos: accepts parsed objects and non-arrays', () => {
  assert.deepEqual(dedupeRepos([{ owner: 'a', name: 'b' }, { owner: 'a', name: 'b', host: 'github.com' }]),
    [{ owner: 'a', name: 'b', host: 'github.com' }]);
  assert.deepEqual(dedupeRepos(null), []);
  assert.deepEqual(dedupeRepos('nope'), []);
});

test('esc: escapes html', () => {
  assert.equal(esc('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
});

test('KNOWN_HOSTS includes the three forges', () => {
  assert.ok(KNOWN_HOSTS.includes('github.com'));
  assert.ok(KNOWN_HOSTS.includes('gitlab.com'));
  assert.ok(KNOWN_HOSTS.includes('bitbucket.org'));
});
