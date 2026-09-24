import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, toolsByCat, toolHowto, toolsWikiMarkdown, toolsForumIndexMarkdown } from './genai-tools.mjs';
test('every tool has a url, what, and how-to steps', () => {
  assert.ok(TOOLS.length >= 12);
  for (const t of TOOLS) { assert.ok(t.url && t.what); assert.ok(Array.isArray(t.howto) && t.howto.length >= 1, t.id); }
});
test('renders wiki + forum markdown with links + instructionals', () => {
  const w = toolsWikiMarkdown(); assert.match(w, /Instructionals/); assert.match(w, /\[Convert & Compress\]\(\/convert\)/);
  const f = toolsForumIndexMarkdown(); assert.match(f, /Tools & Wiki index/); assert.match(f, /\/vectorize/);
  assert.ok(toolHowto('convert').howto.length >= 3);
});
