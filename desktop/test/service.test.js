// The IMAP/SMTP mail layer against a real Dovecot server and an SMTP sink.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMailServer } from './mailserver.js';
import { MailService } from '../main/mail/service.js';

const USERS = { 'bob@example.fr': 'bob-secret', 'alice@example.fr': 'alice-secret' };
let srv; let bob; let alice; let dir;

const svc = (email, name) => new MailService({
  email, name, imap: srv.imap, smtp: srv.smtp,
  auth: { user: email, pass: USERS[email] }, dataDir: join(dir, email),
});
const msg = ({ from, to, subject, body, id, irt, refs, date = new Date().toUTCString(), extra = '' }) => [
  `From: ${from}`, `To: ${to}`, `Subject: ${subject}`, `Date: ${date}`, `Message-ID: <${id}>`,
  irt ? `In-Reply-To: <${irt}>` : '', refs ? `References: ${refs.map((r) => `<${r}>`).join(' ')}` : '',
  'MIME-Version: 1.0', extra || 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', body, '',
].filter((l, i, a) => l !== '' || i >= a.indexOf('MIME-Version: 1.0')).join('\r\n');
const header = (m, n) => m.payload.headers.find((h) => h.name.toLowerCase() === n)?.value;
const bodyText = (p) => (p.body?.data ? Buffer.from(p.body.data, 'base64url').toString('utf8') : (p.parts || []).map(bodyText).join(''));
const labels = async (s, tid) => (await s.getThreadsMeta([tid]))[0].messages.flatMap((m) => m.labelIds);
const inLabel = async (s, labelId, q) => (await s.listThreads({ labelId, q })).ids;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cm-desk-'));
  srv = await startMailServer(USERS);
  await srv.deliver('bob@example.fr', msg({ from: 'Paul Martin <paul@studio.fr>', to: 'bob@example.fr', subject: 'Tirages photo', body: 'Bonjour Bob, voici les tailles des tirages.', id: 'p1@studio.fr', date: 'Mon, 12 Oct 2026 09:00:00 +0200' }));
  await srv.deliver('bob@example.fr', msg({ from: 'Paul Martin <paul@studio.fr>', to: 'bob@example.fr', subject: 'Re: Tirages photo', body: 'Et les prix, désolé.', id: 'p2@studio.fr', irt: 'p1@studio.fr', refs: ['p1@studio.fr'], date: 'Mon, 12 Oct 2026 10:00:00 +0200' }));
  await srv.deliver('bob@example.fr', msg({
    from: '=?UTF-8?Q?Julia_K=C3=B6hler?= <julia@example.de>', to: 'bob@example.fr', subject: 'Contrat signé', id: 'j1@example.de',
    date: 'Tue, 13 Oct 2026 09:00:00 +0200',
    extra: 'Content-Type: multipart/mixed; boundary="XX"',
    body: ['--XX', 'Content-Type: text/html; charset=iso-8859-1', 'Content-Transfer-Encoding: quoted-printable', '', '<p>Voici le contrat sign=E9.</p>',
      '--XX', 'Content-Type: application/pdf; name="contrat.pdf"', 'Content-Disposition: attachment; filename="contrat.pdf"', 'Content-Transfer-Encoding: base64', '', Buffer.from('%PDF-1.4 test').toString('base64'), '--XX--'].join('\r\n'),
  }));
  bob = svc('bob@example.fr', 'Bob Uomini');
  alice = svc('alice@example.fr', 'Alice');
  await bob.open(); await alice.open();
});

after(async () => {
  await bob?.close(); await alice?.close();
  await srv?.stop();
  rmSync(dir, { recursive: true, force: true });
});

test('folders become Gmail labels', async () => {
  const ids = (await bob.listLabels()).map((l) => l.id);
  for (const id of ['INBOX', 'SENT', 'DRAFT', 'TRASH', 'SPAM', 'STARRED', 'UNREAD']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('ARCHIVE'));
  assert.deepEqual(bob.getProfile(), { emailAddress: 'bob@example.fr' });
});

test('replies are grouped into one conversation, newest first', async () => {
  const { ids } = await bob.listThreads({ labelId: 'INBOX' });
  assert.equal(ids.length, 2);
  const [julia, paul] = await bob.getThreadsMeta(ids);
  assert.equal(header(julia.messages[0], 'from'), 'Julia Köhler <julia@example.de>');
  assert.equal(paul.messages.length, 2);
  assert.match(paul.messages[1].snippet, /prix, désolé/);
  assert.ok(paul.messages[0].labelIds.includes('UNREAD'));
  const info = await bob.getLabel('INBOX');
  assert.equal(info.threadsTotal, 2);
  assert.equal(info.threadsUnread, 2);
});

test('full message: text in UTF-8, attachments fetched on demand', async () => {
  const [tid] = (await bob.listThreads({ labelId: 'INBOX' })).ids;
  const t = await bob.getThread(tid);
  const m = t.messages[0];
  assert.match(bodyText(m.payload), /contrat signé/);
  const att = m.payload.parts.find((p) => p.filename === 'contrat.pdf');
  const data = await bob.getAttachment(m.id, att.body.attachmentId);
  assert.equal(Buffer.from(data, 'base64url').toString(), '%PDF-1.4 test');
  const raw = Buffer.from(await bob.getRawMessage(m.id), 'base64url').toString();
  assert.match(raw, /Message-ID: <j1@example.de>/);
});

test('read, unread, star, important', async () => {
  const tid = (await bob.listThreads({ labelId: 'INBOX' })).ids[1];
  await bob.modifyThread(tid, [], ['UNREAD']);
  assert.ok(!(await labels(bob, tid)).includes('UNREAD'));
  await bob.modifyThread(tid, ['STARRED', 'IMPORTANT'], []);
  const l = await labels(bob, tid);
  assert.ok(l.includes('STARRED') && l.includes('IMPORTANT'));
  assert.deepEqual(await inLabel(bob, 'STARRED'), [tid]);
  await bob.modifyThread(tid, ['UNREAD'], ['STARRED']);
  assert.ok((await labels(bob, tid)).includes('UNREAD'));
  assert.deepEqual(await inLabel(bob, 'STARRED'), []);
});

test('archive and move back to the inbox', async () => {
  const tid = (await bob.listThreads({ labelId: 'INBOX' })).ids[1];
  await bob.modifyThread(tid, [], ['INBOX']);
  assert.ok(!(await inLabel(bob, 'INBOX')).includes(tid));
  assert.ok((await inLabel(bob, null)).includes(tid), 'still in All mail');
  await bob.modifyThread(tid, ['INBOX'], []);
  assert.ok((await inLabel(bob, 'INBOX')).includes(tid));
});

test('labels are folders; a message can carry several', async () => {
  const work = await bob.createLabel('Clients');
  assert.ok((await bob.listLabels()).some((l) => l.id === work.id && l.name === 'Clients'));
  const tid = (await bob.listThreads({ labelId: 'INBOX' })).ids[0];
  await bob.modifyThread(tid, [work.id], []);
  let l = await labels(bob, tid);
  assert.ok(l.includes('INBOX') && l.includes(work.id));
  assert.deepEqual(await inLabel(bob, work.id), [tid]);
  // Archived but still labelled: only the Inbox copy goes.
  await bob.modifyThread(tid, [], ['INBOX']);
  l = await labels(bob, tid);
  assert.ok(!l.includes('INBOX') && l.includes(work.id));
  await bob.modifyThread(tid, ['INBOX'], [work.id]);
  l = await labels(bob, tid);
  assert.ok(l.includes('INBOX') && !l.includes(work.id));
});

test('trash and restore', async () => {
  const tid = (await bob.listThreads({ labelId: 'INBOX' })).ids[0];
  await bob.trashThread(tid);
  assert.ok(!(await inLabel(bob, 'INBOX')).includes(tid));
  assert.ok(!(await inLabel(bob, null)).includes(tid));
  assert.deepEqual(await inLabel(bob, 'TRASH'), [tid]);
  await bob.untrashThread(tid);
  assert.ok((await inLabel(bob, 'INBOX')).includes(tid));
  assert.deepEqual(await inLabel(bob, 'TRASH'), []);
});

test('spam and not spam', async () => {
  const tid = (await bob.listThreads({ labelId: 'INBOX' })).ids[0];
  await bob.modifyThread(tid, ['SPAM'], ['INBOX']);
  assert.deepEqual(await inLabel(bob, 'SPAM'), [tid]);
  assert.ok(!(await inLabel(bob, null)).includes(tid));
  await bob.modifyThread(tid, ['INBOX'], ['SPAM']);
  assert.ok((await inLabel(bob, 'INBOX')).includes(tid));
});

test('search', async () => {
  assert.equal((await inLabel(bob, null, 'from:julia')).length, 1);
  assert.equal((await inLabel(bob, null, 'tirages')).length, 1);
  assert.equal((await inLabel(bob, null, 'from:paul prix')).length, 1);
  assert.equal((await inLabel(bob, null, 'from:paul -prix')).length, 1, 'the first message has no "prix"');
  assert.equal((await inLabel(bob, null, 'from:paul zzzz')).length, 0);
  assert.equal((await inLabel(bob, null, 'in:sent')).length, 0);
});

test('drafts: create, update keeps the id, delete', async () => {
  const raw = (body) => ['To: alice@example.fr', 'Subject: Brouillon', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n');
  const d = await bob.createDraft(raw('première version'));
  let list = await bob.listDrafts();
  assert.equal(list.drafts.length, 1);
  assert.equal(list.drafts[0].id, d.id);
  const d2 = await bob.updateDraft(d.id, raw('deuxième version'));
  assert.equal(d2.id, d.id);
  const got = await bob.getDraft(d.id);
  assert.match(bodyText(got.message.payload), /deuxième version/);
  assert.match(header(got.message, 'from'), /bob@example\.fr/);
  assert.equal((await bob.listDrafts()).drafts.length, 1);
  assert.equal(await bob.findDraftId(d.message.id), d.id);
  const meta = await bob.getDraftsMeta([d.id]);
  assert.match(meta[0].message.snippet, /deuxième/);
  await bob.deleteDraft(d.id);
  list = await bob.listDrafts();
  assert.equal(list.drafts.length, 0);
});

test('send: delivered, saved in Sent, replies thread together', async () => {
  const raw = ['To: Alice <alice@example.fr>', 'Bcc: bob@example.fr', 'Subject: Rendez-vous', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', 'À jeudi ?'].join('\r\n');
  const sent = await bob.sendRaw(raw);
  assert.ok(sent.labelIds.includes('SENT'));
  assert.deepEqual(await inLabel(bob, 'SENT'), [sent.threadId]);
  // Alice receives it, without the Bcc line.
  await alice.sync({ force: true });
  const [atid] = (await alice.listThreads({ labelId: 'INBOX' })).ids;
  const am = (await alice.getThread(atid)).messages[0];
  assert.equal(header(am, 'subject'), 'Rendez-vous');
  assert.equal(header(am, 'bcc'), undefined);
  assert.match(bodyText(am.payload), /À jeudi/);
  // She replies; Bob sees one conversation with both messages.
  const mid = header(am, 'message-id');
  await alice.sendRaw(['To: bob@example.fr', 'Subject: Re: Rendez-vous', `In-Reply-To: ${mid}`, `References: ${mid}`, 'Content-Type: text/plain; charset=utf-8', '', 'Oui, 10 h.'].join('\r\n'));
  await bob.sync({ force: true });
  const t = await bob.getThread(sent.threadId);
  const subjects = t.messages.map((m) => header(m, 'subject'));
  assert.ok(subjects.includes('Rendez-vous') && subjects.includes('Re: Rendez-vous'));
  assert.ok((await inLabel(bob, 'INBOX')).includes(sent.threadId));
  const recent = await bob.recentAddresses('in:sent');
  assert.ok(recent.some((r) => r.headers.some((h) => h.name.toLowerCase() === 'to' && /alice@example\.fr/.test(h.value))));
});

test('the index survives a restart', async () => {
  await bob.close();
  bob = svc('bob@example.fr', 'Bob Uomini');
  await bob.open();
  assert.ok(Object.keys(bob.idx.folders).length > 0, 'index loaded from disk');
  assert.equal((await bob.listThreads({ labelId: 'INBOX' })).ids.length, 3);
});

test('big folders: newest first, older ones as you page back; counts from the server', async () => {
  const box = await bob.createLabel('Archives 2020');
  const path = bob.pathOfLabel(box.id);
  const c = await bob.conn();
  for (let i = 1; i <= 23; i += 1) {
    await c.append(path, msg({ from: 'Old Friend <old@example.fr>', to: 'bob@example.fr', subject: `Vieux message ${i}`, body: `n° ${i}`, id: `old${i}@example.fr`, date: new Date(Date.UTC(2020, 0, i)).toUTCString() }), i % 2 ? ['\\Seen'] : []);
  }
  const own = (name, initial) => new MailService({ email: 'bob@example.fr', imap: srv.imap, smtp: srv.smtp, auth: { user: 'bob@example.fr', pass: USERS['bob@example.fr'] }, dataDir: join(dir, name), initial });
  const small = own('small', 10);
  await small.open();
  const p1 = await small.listThreads({ labelId: box.id, max: 10 });
  assert.equal(p1.ids.length, 10);
  assert.equal(p1.estimate, 23);
  assert.ok(p1.nextPageToken);
  const [first] = await small.getThreadsMeta([p1.ids[0]]);
  assert.equal(header(first.messages[0], 'subject'), 'Vieux message 23', 'newest first');
  assert.equal(Object.keys(small.idx.folders[path].msgs).length, 10, 'only the newest were read');
  const p2 = await small.listThreads({ labelId: box.id, max: 10, pageToken: p1.nextPageToken });
  assert.equal(p2.ids.length, 10);
  const p3 = await small.listThreads({ labelId: box.id, max: 10, pageToken: p2.nextPageToken });
  assert.equal(p3.ids.length, 3);
  assert.equal(p3.nextPageToken, null);
  const [last] = await small.getThreadsMeta([p3.ids.at(-1)]);
  assert.equal(header(last.messages[0], 'subject'), 'Vieux message 1');
  const info = await small.getLabel(box.id);
  assert.equal(info.messagesTotal, 23);
  assert.equal(info.threadsUnread, 11);
  // Search finds old messages that haven't been read yet.
  const fresh = own('fresh', 5);
  await fresh.open();
  assert.equal((await fresh.listThreads({ labelId: box.id, q: 'subject:"Vieux message 2"' })).ids.length, 1 + 4, '2 and 20–23');
  // A flag changed elsewhere is seen.
  await bob.inBox(path, (cc) => cc.messageFlagsAdd('1:*', ['\\Flagged']));
  await small.sync({ paths: [path] });
  assert.equal((await small.listThreads({ labelId: 'STARRED', max: 50 })).ids.length, 23, 'flags changed elsewhere are seen');
  await bob.inBox(path, (cc) => cc.messageFlagsRemove('1:*', ['\\Flagged']));
  await small.close(); await fresh.close();
});
