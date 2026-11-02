// Unit tests for src/linkify.js — run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLinks, linkAtEnd } from '../src/linkify.js';

const links = (t) => splitLinks(t).filter((p) => p.href).map((p) => [p.text, p.href]);

test('finds https and www addresses', () => {
  assert.deepEqual(links('live at https://play.p3nto.com and www.p3nto.com'), [
    ['https://play.p3nto.com', 'https://play.p3nto.com'],
    ['www.p3nto.com', 'https://www.p3nto.com'],
  ]);
});

test('leaves trailing punctuation outside the link', () => {
  assert.deepEqual(links('Play it at https://play.p3nto.com. Thanks!'), [['https://play.p3nto.com', 'https://play.p3nto.com']]);
  assert.deepEqual(links('(see https://x.com/a)'), [['https://x.com/a', 'https://x.com/a']]);
  assert.deepEqual(links('https://en.wikipedia.org/wiki/Lingo_(game),'), [['https://en.wikipedia.org/wiki/Lingo_(game)', 'https://en.wikipedia.org/wiki/Lingo_(game)']]);
});

test('keeps paths, queries and ports', () => {
  assert.deepEqual(links('https://app.chiaramail.com/compose?draft=1#x'), [['https://app.chiaramail.com/compose?draft=1#x', 'https://app.chiaramail.com/compose?draft=1#x']]);
  assert.deepEqual(links('http://localhost:5173/x'), [['http://localhost:5173/x', 'http://localhost:5173/x']]);
});

test('ignores half-typed or non-addresses', () => {
  assert.deepEqual(links('type https:// then'), []);
  assert.deepEqual(links('www. alone'), []);
  assert.deepEqual(links('a.b.c is not a site, nor is p3nto.com without www'), []);
});

test('text pieces join back to the original', () => {
  const t = 'Go to https://play.p3nto.com, or www.p3nto.com.';
  assert.equal(splitLinks(t).map((p) => p.text).join(''), t);
});

test('linkAtEnd finds only an address that ends the text', () => {
  assert.equal(linkAtEnd('see https://play.p3nto.com')?.start, 4);
  assert.deepEqual(linkAtEnd('at https://play.p3nto.com.'), { start: 3, end: 25, text: 'https://play.p3nto.com', href: 'https://play.p3nto.com' });
  assert.equal(linkAtEnd('https://play.p3nto.com more'), null);
});
