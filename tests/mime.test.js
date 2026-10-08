// Unit tests for src/gmail/mime.js — run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import PostalMime from 'postal-mime';
import {
  buildRaw, parseAddressList, parseMessage, summarize, toB64url, utf8ToB64,
  replySubject, forwardSubject, htmlToText, CONTENT_POINTER, decodeEntities,
} from '../src/gmail/mime.js';

test('parseAddressList handles names, quotes and separators', () => {
  const r = parseAddressList('Bob <bob@x.com>, "Smith, Jr" <s@y.org>; plain@z.net');
  assert.deepEqual(r, [
    { name: 'Bob', email: 'bob@x.com' },
    { name: 'Smith, Jr', email: 's@y.org' },
    { name: '', email: 'plain@z.net' },
  ]);
});

test('buildRaw round-trips through a real MIME parser (UTF-8, attachment, custom header)', async () => {
  const raw = buildRaw({
    from: { name: 'Robert Uomini', email: 'ruomini@gmail.com' },
    to: [{ name: 'Élodie Ç', email: 'e@example.fr' }],
    cc: [{ name: '', email: 'c@example.com' }],
    subject: 'Réunion — ordre du jour ✓',
    text: 'Bonjour,\n\nÀ demain. Ça marche ?',
    html: '<p>Bonjour,</p><p>À demain.</p>',
    attachments: [{ filename: 'notes été.txt', mimeType: 'text/plain', base64: utf8ToB64('contenu ✓') }],
    headers: { [CONTENT_POINTER]: 'abc123' },
    inReplyTo: '<m1@mail.gmail.com>',
    references: '<m0@mail.gmail.com> <m1@mail.gmail.com>',
  });
  assert.match(raw, /^[\x00-\x7f]*$/, 'raw message must be pure ASCII');
  const p = await PostalMime.parse(raw);
  assert.equal(p.subject, 'Réunion — ordre du jour ✓');
  assert.equal(p.from.name, 'Robert Uomini');
  assert.equal(p.to[0].name, 'Élodie Ç');
  assert.equal(p.cc[0].address, 'c@example.com');
  assert.equal(p.text.trim(), 'Bonjour,\n\nÀ demain. Ça marche ?');
  assert.match(p.html, /À demain/);
  assert.equal(p.attachments.length, 1);
  assert.equal(p.attachments[0].filename, 'notes été.txt');
  assert.equal(new TextDecoder().decode(p.attachments[0].content), 'contenu ✓');
  assert.equal(p.headers.find((h) => h.key === CONTENT_POINTER.toLowerCase()).value, 'abc123');
  assert.equal(p.inReplyTo, '<m1@mail.gmail.com>');
});

test('buildRaw plain text only', async () => {
  const raw = buildRaw({ to: [{ name: '', email: 'a@b.co' }], subject: 'Hi', text: 'Hello' });
  const p = await PostalMime.parse(raw);
  assert.equal(p.text.trim(), 'Hello');
  assert.equal(p.attachments.length, 0);
});

const gmailMessage = {
  id: 'm1', threadId: 't1', labelIds: ['INBOX', 'UNREAD'], snippet: 'Hello &amp; welcome', internalDate: '1759830000000',
  payload: {
    mimeType: 'multipart/mixed',
    headers: [
      { name: 'From', value: '"Alice A" <alice@example.com>' },
      { name: 'To', value: 'bob@example.com, Carol <carol@example.com>' },
      { name: 'Subject', value: 'Plans' },
      { name: 'Message-ID', value: '<abc@example.com>' },
      { name: CONTENT_POINTER, value: 'ptr42' },
    ],
    parts: [
      { mimeType: 'multipart/alternative', headers: [], parts: [
        { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=UTF-8' }], body: { data: toB64url('Plain ✓') } },
        { mimeType: 'text/html', headers: [], body: { data: toB64url('<b>Rich ✓</b><img src="cid:logo1">') } },
      ] },
      { mimeType: 'image/png', filename: 'logo.png', headers: [{ name: 'Content-ID', value: '<logo1>' }, { name: 'Content-Disposition', value: 'inline' }], body: { attachmentId: 'att1', size: 10 } },
      { mimeType: 'application/pdf', filename: 'plan.pdf', headers: [{ name: 'Content-Disposition', value: 'attachment; filename="plan.pdf"' }], body: { attachmentId: 'att2', size: 2048 } },
    ],
  },
};

test('parseMessage extracts bodies, attachments, inline images and the content pointer', () => {
  const m = parseMessage(gmailMessage);
  assert.equal(m.text, 'Plain ✓');
  assert.equal(m.html, '<b>Rich ✓</b><img src="cid:logo1">');
  assert.equal(m.from.name, 'Alice A');
  assert.equal(m.to.length, 2);
  assert.equal(m.pointer, 'ptr42');
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].filename, 'plan.pdf');
  assert.equal(m.inline.logo1.attachmentId, 'att1');
  assert.equal(m.snippet, 'Hello & welcome');
});

test('summarize flags unread, live and attachments', () => {
  const s = summarize({ id: 't1', messages: [gmailMessage] }, 'bob@example.com');
  assert.equal(s.subject, 'Plans');
  assert.deepEqual(s.people.map((p) => p.label), ['Alice A']);
  assert.equal(s.unread, true);
  assert.equal(s.live, true);
  assert.equal(s.ecs[0].pointer, 'ptr42');
  assert.equal(s.ecs[0].from, s.people[0].email);
  assert.equal(s.hasAttachment, true);
});

test('subject prefixes and html to text', () => {
  assert.equal(replySubject('Plans'), 'Re: Plans');
  assert.equal(replySubject('RE: Plans'), 'RE: Plans');
  assert.equal(forwardSubject('Plans'), 'Fwd: Plans');
  assert.equal(htmlToText('<p>One</p><p>Two &amp; three</p>'), 'One\nTwo & three');
});

test('decodeEntities turns Gmail snippet codes back into characters', () => {
  assert.equal(decodeEntities('I&#39;ll send it &amp; then &quot;call&quot; &lt;you&gt;'), 'I\'ll send it & then "call" <you>');
  assert.equal(decodeEntities('caf&#xE9; &#8364;5 &apos;ok&apos;'), 'café €5 \'ok\'');
  assert.equal(decodeEntities('&amp;#39; stays literal'), '&#39; stays literal');
  assert.equal(decodeEntities(undefined), '');
});

test('ECS encryption round-trips text and bytes; wrong or missing key fails', async () => {
  const { newKey, isKey, encryptText, decryptText, encryptBytes, decryptBytes, isEncrypted } = await import('../src/ecsCrypto.js');
  const k = newKey();
  assert.ok(isKey(k));
  const c = await encryptText(k, 'Héllo — ECS ✉');
  assert.ok(isEncrypted(c));
  assert.ok(!c.includes('llo'));
  assert.equal(await decryptText(k, c), 'Héllo — ECS ✉');
  assert.notEqual(await encryptText(k, 'same'), await encryptText(k, 'same')); // fresh IV each time
  assert.equal(await decryptText(k, 'plain old text'), 'plain old text');
  await assert.rejects(decryptText(newKey(), c));
  await assert.rejects(decryptText(undefined, c));
  const bytes = new Uint8Array([1, 2, 3, 250]);
  const eb = await encryptBytes(k, bytes);
  assert.equal(eb.length, bytes.length + 12 + 16);
  assert.deepEqual(await decryptBytes(k, eb), bytes);
});
