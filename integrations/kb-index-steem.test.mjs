// Offline tests for kb-index-steem.mjs. Injects a fetch that returns a canned condenser_api
// JSON-RPC result so no network is touched. Run:  node --test integrations/kb-index-steem.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchAuthorPosts, markdownToText, indexPost, indexAuthors, toRecords,
  sourceForNode, STEEM_NODE, HIVE_NODE, __setFetch,
} from './kb-index-steem.mjs';

// --- canned condenser_api.get_discussions_by_blog result (2 posts) ---------
function cannedRows(author = 'marsresident') {
  return [
    {
      author,
      permlink: 'temple-coin-intro',
      title: 'Temple Coin Introduction',
      body: '# Temple Coin\n\nThis is **bold** intro to [Cryptonote](https://example.com/cn) and ![logo](https://img/x.png) the chain.\n\n<p>HTML body here.</p>',
      created: '2017-08-01T12:00:00',
      json_metadata: JSON.stringify({ tags: ['Cryptocurrency', 'temple', 'tutorial'] }),
    },
    {
      author,
      permlink: 'eth-clone-guide',
      title: 'How to Clone Ethereum',
      body: 'Step one: fork the repo. Step two: rename. ' + 'word '.repeat(600),
      created: '2017-09-15T08:30:00',
      json_metadata: JSON.stringify({ tags: ['ethereum', 'howto'] }),
    },
  ];
}

// fetch that returns a JSON-RPC envelope wrapping the canned rows.
function okFetch(rows = cannedRows()) {
  return async () => ({
    ok: true,
    json: async () => ({ jsonrpc: '2.0', id: 1, result: rows }),
  });
}

test('fetchAuthorPosts normalizes RPC rows into posts', async () => {
  __setFetch(okFetch());
  const posts = await fetchAuthorPosts('marsresident', { node: STEEM_NODE });
  assert.equal(posts.length, 2);
  const p = posts[0];
  assert.equal(p.author, 'marsresident');
  assert.equal(p.permlink, 'temple-coin-intro');
  assert.equal(p.title, 'Temple Coin Introduction');
  assert.ok(p.body.includes('Temple Coin'));
  assert.equal(p.created, '2017-08-01T12:00:00');
  assert.deepEqual(p.tags, ['cryptocurrency', 'temple', 'tutorial']);
  assert.ok(p.url.includes('steemit.com'));
  assert.ok(p.url.includes('@marsresident/temple-coin-intro'));
  __setFetch(null);
});

test('fetchAuthorPosts strips reblogs (rows by another author)', async () => {
  const rows = cannedRows();
  rows.push({ author: 'someoneelse', permlink: 'reblog', title: 'X', body: 'y', json_metadata: '{}' });
  __setFetch(okFetch(rows));
  const posts = await fetchAuthorPosts('marsresident', { node: STEEM_NODE });
  assert.equal(posts.length, 2);
  assert.ok(posts.every((p) => p.author === 'marsresident'));
  __setFetch(null);
});

test('fetchAuthorPosts soft-fails to [] when fetch throws', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const posts = await fetchAuthorPosts('marsresident', { node: STEEM_NODE });
  assert.deepEqual(posts, []);
  __setFetch(null);
});

test('fetchAuthorPosts soft-fails to [] on an RPC error result', async () => {
  __setFetch(async () => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'boom' } }) }));
  const posts = await fetchAuthorPosts('marsresident', { node: STEEM_NODE });
  assert.deepEqual(posts, []);
  __setFetch(null);
});

test('fetchAuthorPosts soft-fails to [] on non-ok HTTP', async () => {
  __setFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  const posts = await fetchAuthorPosts('marsresident', { node: STEEM_NODE });
  assert.deepEqual(posts, []);
  __setFetch(null);
});

test('fetchAuthorPosts returns [] for empty author without fetching', async () => {
  __setFetch(async () => { throw new Error('should not be called'); });
  assert.deepEqual(await fetchAuthorPosts('', {}), []);
  assert.deepEqual(await fetchAuthorPosts('  ', {}), []);
  __setFetch(null);
});

test('markdownToText strips headings, bold, links, images, html', () => {
  const md = '# Heading\n\nThis is **bold** and _italic_ with a [link](https://x.com) and ![alt text](https://img/y.png).\n\n<div class="z">html content</div>\n\n> quoted line\n\n- list item\n1. numbered';
  const txt = markdownToText(md);
  assert.ok(!txt.includes('#'), 'no heading marker');
  assert.ok(!txt.includes('**'), 'no bold marker');
  assert.ok(!txt.includes('](') && !txt.includes('https://x.com'), 'link url gone');
  assert.ok(!txt.includes('https://img/y.png'), 'image url gone');
  assert.ok(txt.includes('alt text'), 'image alt kept');
  assert.ok(!txt.includes('<div') && !txt.includes('</div>'), 'html tags gone');
  assert.ok(txt.includes('html content'), 'html inner text kept');
  assert.ok(txt.includes('Heading'));
  assert.ok(txt.includes('bold') && txt.includes('italic'));
  assert.ok(txt.includes('link'));
  assert.ok(txt.includes('quoted line'));
  assert.ok(txt.includes('list item'));
});

test('markdownToText handles empty / nullish input', () => {
  assert.equal(markdownToText(''), '');
  assert.equal(markdownToText(null), '');
  assert.equal(markdownToText(undefined), '');
});

test('indexPost chunks body, builds id from author/permlink, tags source steem', () => {
  const post = {
    author: 'marsresident', permlink: 'temple-coin-intro', title: 'Temple Coin',
    body: 'long body. ' + 'alpha beta gamma '.repeat(400),
    created: '2017-08-01T12:00:00', tags: ['temple'],
    url: 'https://steemit.com/temple/@marsresident/temple-coin-intro',
  };
  const doc = indexPost(post, { maxChars: 500, overlap: 50 });
  assert.equal(doc.id, 'marsresident/temple-coin-intro');
  assert.equal(doc.source, 'steem');
  assert.equal(doc.author, 'marsresident');
  assert.equal(doc.title, 'Temple Coin');
  assert.ok(doc.url.includes('@marsresident/temple-coin-intro'));
  assert.ok(doc.chunks.length > 1, 'long body chunked');
  assert.equal(doc.chunks[0].ord, 0);
  assert.equal(doc.chunks[1].ord, 1);
  assert.ok(doc.chunks.every((c) => c.text.length <= 500));
});

test('indexPost tags source hive correctly (explicit + url inference)', () => {
  const explicit = indexPost({ author: 'vankush', permlink: 'p1', body: 'x', url: 'https://hive.blog/h/@vankush/p1' }, { source: 'hive' });
  assert.equal(explicit.source, 'hive');
  assert.equal(explicit.id, 'vankush/p1');
  const inferred = indexPost({ author: 'kalivankush', permlink: 'p2', body: 'x', url: 'https://hive.blog/h/@kalivankush/p2' });
  assert.equal(inferred.source, 'hive');
});

test('sourceForNode maps node URLs to chain', () => {
  assert.equal(sourceForNode(STEEM_NODE), 'steem');
  assert.equal(sourceForNode(HIVE_NODE), 'hive');
  assert.equal(sourceForNode('https://api.hive.blog'), 'hive');
  assert.equal(sourceForNode('https://api.steemit.com'), 'steem');
});

test('indexAuthors aggregates and soft-skips a failing author', async () => {
  // fail for 'punicwax', succeed for 'marsresident'.
  __setFetch(async (_node, opts) => {
    const body = JSON.parse(opts.body);
    const tag = body.params[0].tag;
    if (tag === 'punicwax') throw new Error('rate limited');
    return { ok: true, json: async () => ({ result: cannedRows(tag) }) };
  });
  const indexed = await indexAuthors(['marsresident', 'punicwax'], { node: STEEM_NODE });
  // only marsresident's 2 posts indexed; punicwax soft-skipped.
  assert.equal(indexed.length, 2);
  assert.ok(indexed.every((d) => d.author === 'marsresident'));
  assert.ok(indexed.every((d) => d.source === 'steem'));
  __setFetch(null);
});

test('indexAuthors honors per-entry node/source for Hive handles', async () => {
  __setFetch(async (node, opts) => {
    const tag = JSON.parse(opts.body).params[0].tag;
    return { ok: true, json: async () => ({ result: cannedRows(tag) }) };
  });
  const indexed = await indexAuthors([{ author: 'vankush', node: HIVE_NODE }], {});
  assert.equal(indexed.length, 2);
  assert.ok(indexed.every((d) => d.source === 'hive'));
  assert.ok(indexed[0].url.includes('hive.blog'));
  __setFetch(null);
});

test('toRecords flattens indexed docs into citable chunk records with url', () => {
  const indexed = [
    {
      id: 'marsresident/a', source: 'steem', author: 'marsresident', title: 'A',
      url: 'https://steemit.com/x/@marsresident/a', created: '2017-01-01', tags: ['t'],
      chunks: [{ ord: 0, text: 'first' }, { ord: 1, text: 'second' }],
    },
    {
      id: 'vankush/b', source: 'hive', author: 'vankush', title: 'B',
      url: 'https://hive.blog/x/@vankush/b', created: '2021-01-01', tags: [],
      chunks: [{ ord: 0, text: 'only' }],
    },
  ];
  const recs = toRecords(indexed);
  assert.equal(recs.length, 3);
  const r = recs[0];
  assert.equal(r.docId, 'marsresident/a');
  assert.equal(r.ord, 0);
  assert.equal(r.text, 'first');
  assert.equal(r.source, 'steem');
  assert.equal(r.author, 'marsresident');
  assert.equal(r.title, 'A');
  assert.ok(r.url.includes('@marsresident/a'), 'record carries citation url');
  // every record is citable: has a url + docId.
  assert.ok(recs.every((x) => x.url && x.docId));
  assert.equal(recs[2].source, 'hive');
});

test('toRecords tolerates a single doc and empty / malformed input', () => {
  assert.deepEqual(toRecords([]), []);
  assert.deepEqual(toRecords([{ id: 'x', chunks: null }]), []);
  const single = toRecords({ id: 'z/p', source: 'steem', author: 'z', title: 'T', url: 'u', chunks: [{ ord: 0, text: 'q' }] });
  assert.equal(single.length, 1);
  assert.equal(single[0].docId, 'z/p');
});

test('end-to-end: fetch → index → records (offline)', async () => {
  __setFetch(okFetch());
  const indexed = await indexAuthors(['marsresident'], { node: STEEM_NODE, maxChars: 800, overlap: 100 });
  const recs = toRecords(indexed);
  assert.ok(indexed.length === 2);
  assert.ok(recs.length >= 2);
  assert.ok(recs.every((r) => r.source === 'steem' && r.url.includes('steemit.com')));
  // the long eth-clone post should have produced multiple chunks.
  const ethRecs = recs.filter((r) => r.docId === 'marsresident/eth-clone-guide');
  assert.ok(ethRecs.length > 1, 'long post chunked into multiple records');
  __setFetch(null);
});
