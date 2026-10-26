// The Outlook add-in (outlook.html) end to end, against a real ECS server
// (a private PostgreSQL, codes kept in memory) with a stand-in for Office.js.
//   npm run build:reader && node tests/outlook.e2e.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { startPostgres } from '../server/test/pg.js';
import { openDb } from '../server/src/db.js';
import { fileStore } from '../server/src/store.js';
import { memoryMailer } from '../server/src/mailer.js';
import { createApp } from '../server/src/app.js';
import { staticSite } from '../server/src/static.js';
import { findEcsLink } from '../src/outlook/ecsLink.js';

const ROOT = new URL('..', import.meta.url).pathname;

// ---- the link finder, on its own --------------------------------------------------
{
  const id = 'A'.repeat(20); const key = 'k'.repeat(43); const o = 'https://ecs.chiaramail.com';
  const plain = `<a href="${o}/m/${id}#k=${key}">Read</a>`;
  assert.equal(findEcsLink(plain, o)?.id, id);
  const safe = `<a href="https://eur01.safelinks.protection.outlook.com/?url=${encodeURIComponent(`${o}/m/${id}#k=${key}`)}&amp;data=x">Read</a>`;
  assert.deepEqual(findEcsLink(safe, o), { id, key, link: `${o}/m/${id}#k=${key}` });
  assert.equal(findEcsLink(`<a href="https://evil.example/m/${id}#k=${key}">x</a>`, o), null);
  assert.equal(findEcsLink('<p>hello</p>', o), null);
  console.log('ok link finder');
}

// ---- server -----------------------------------------------------------------------
const pg = await startPostgres();
const files = mkdtempSync(join(tmpdir(), 'cm-files-'));
const db = await openDb(pg.url);
const mailer = memoryMailer();
const server = createServer(createApp({ db, store: fileStore(files), mailer, origins: [], site: staticSite(join(ROOT, 'server', 'reader')) }));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// The add-in page is meant to be framed by Outlook.
{
  const r = await fetch(`${BASE}/outlook.html`);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /frame-ancestors 'self' https:\/\/\*\.office\.com/);
  assert.match(csp, /script-src [^;]*https:\/\/appsforoffice\.microsoft\.com/);
  assert.equal(r.headers.get('x-frame-options'), null);
  const idx = await fetch(`${BASE}/m/x`);
  assert.equal(idx.headers.get('x-frame-options'), 'DENY');
  const man = await fetch(`${BASE}/outlook/manifest.xml`);
  assert.equal(man.status, 200);
  assert.match(man.headers.get('content-type'), /xml/);
  console.log('ok headers and manifest');
}

// ---- a stand-in for Office.js -----------------------------------------------------------
// window.__mock (set before the page loads) describes the mailbox and the open message;
// window.__st is what Outlook would hold, for the test to look at.
const OFFICE = `window.Office = (() => {
  const cfg = window.__mock;
  const S = { Succeeded: 'succeeded', Failed: 'failed' };
  const ok = (cb, value) => setTimeout(() => cb && cb({ status: S.Succeeded, value }), 0);
  const st = window.__st = { body: cfg.body || '', to: cfg.to || [], cc: cfg.cc || [], bcc: cfg.bcc || [], subject: cfg.subject || '',
    attachments: (cfg.attachments || []).map((a, i) => ({ id: 'a' + i, ...a })), headers: {}, replyAll: null, next: 1 };
  const people = (l) => l.map((e) => ({ emailAddress: e, displayName: '' }));
  const item = cfg.mode === 'compose' ? {
    itemType: 'message',
    ...(cfg.sendFrom ? { from: { getAsync: (cb) => ok(cb, { emailAddress: cfg.sendFrom, displayName: '' }) } } : {}),
    subject: { getAsync: (cb) => ok(cb, st.subject) },
    to: { getAsync: (cb) => ok(cb, people(st.to)) }, cc: { getAsync: (cb) => ok(cb, people(st.cc)) }, bcc: { getAsync: (cb) => ok(cb, people(st.bcc)) },
    body: { getAsync: (t, cb) => ok(cb, st.body), setAsync: (html, o, cb) => { st.body = html; ok(cb); } },
    getAttachmentsAsync: (cb) => ok(cb, st.attachments.map((a) => ({ id: a.id, name: a.name, contentType: a.type, size: atob(a.b64).length, attachmentType: a.cloud ? 'cloud' : 'file', isInline: !!a.isInline }))),
    getAttachmentContentAsync: (id, cb) => { const a = st.attachments.find((x) => x.id === id); ok(cb, { format: 'base64', content: a.b64 }); },
    removeAttachmentAsync: (id, cb) => { st.attachments = st.attachments.filter((a) => a.id !== id); ok(cb); },
    addFileAttachmentFromBase64Async: (b64, name, o, cb) => { const id = 'n' + (st.next++); st.attachments.push({ id, name, b64, isInline: !!o.isInline }); ok(cb, id); },
    internetHeaders: { setAsync: (h, cb) => { Object.assign(st.headers, h); ok(cb); }, removeAsync: (n, cb) => { n.forEach((k) => delete st.headers[k]); ok(cb); } },
  } : {
    itemType: 'message', subject: st.subject, from: { emailAddress: cfg.from, displayName: '' },
    body: { getAsync: (t, cb) => ok(cb, st.body) },
    displayReplyAllForm: (d) => { st.replyAll = d; },
  };
  return {
    AsyncResultStatus: S, CoercionType: { Html: 'html', Text: 'text' }, EventType: { ItemChanged: 'olkItemSelectedChanged' }, HostType: { Outlook: 'Outlook' },
    context: { mailbox: { item, userProfile: { emailAddress: cfg.me, displayName: cfg.meName || '' }, addHandlerAsync: (t, h, cb) => { window.__changed = h; ok(cb); } } },
    onReady: (cb) => { const info = { host: 'Outlook' }; setTimeout(() => cb && cb(info), 0); return Promise.resolve(info); },
  };
})();`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const contexts = {};
// One browser profile per person, so each keeps their own ChiaraMail sign-in.
async function pane(who, mock) {
  contexts[who] ||= await browser.newContext({ viewport: { width: 380, height: 900 } });
  const page = await contexts[who].newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.errors = errors;
  await page.route('https://appsforoffice.microsoft.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: OFFICE }));
  await page.addInitScript((m) => { window.__mock = m; }, { me: who, ...mock });
  await page.goto(`${BASE}/outlook.html`);
  return page;
}
async function signIn(page, email) {
  await page.getByRole('button', { name: 'Email me a code' }).waitFor();
  assert.equal(await page.getByLabel('Your email address').inputValue(), email, 'the mailbox address is filled in');
  const before = mailer.sent.length;
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('6-digit code').waitFor();
  const code = mailer.sent.slice(before).find((m) => m.to === email).code;
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
const st = (page) => page.evaluate(() => window.__st);
const b64 = (s) => Buffer.from(s).toString('base64');
// SHOTS=<folder>: also saves pictures of the panes.
const shot = (page, name) => (process.env.SHOTS ? page.screenshot({ path: join(process.env.SHOTS, `${name}.png`), fullPage: true }) : null);

// Outlook's own HTML for a message: a whole document with styles and Word classes.
const OUTLOOK_HTML = `<html><head><style>p.MsoNormal{margin:0}</style></head><body><div class="WordSection1">
<p class="MsoNormal">Dear Alice,</p><p class="MsoNormal">The <b>wire details</b> for the closing are attached.</p>
<p class="MsoNormal">Bob</p></div></body></html>`;

try {
  // ---- outside Outlook, the page says what it is -------------------------------------
  {
    const page = await (await browser.newContext()).newPage();
    await page.route('https://appsforoffice.microsoft.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.goto(`${BASE}/outlook.html`);
    await page.getByText('it works inside Outlook').waitFor();
    console.log('ok not in Outlook');
  }

  // ---- Bob writes a message and makes it an ECS message --------------------------------
  const compose = await pane('bob@example.fr', {
    mode: 'compose', meName: 'Bob Uomini', subject: 'Closing documents', to: ['alice@example.fr'], cc: ['carol@example.fr'],
    body: OUTLOOK_HTML, attachments: [{ name: 'wire.txt', type: 'text/plain', b64: b64('IBAN FR76 0000') }],
  });
  await signIn(compose, 'bob@example.fr');
  await compose.getByRole('heading', { name: 'Send as an ECS message' }).waitFor();
  await shot(compose, '1-compose');
  await compose.getByText('Signed in to ChiaraMail as bob@example.fr').waitFor();

  // Bcc isn't allowed; then it is converted.
  await compose.evaluate(() => { window.__st.bcc = ['dave@example.fr']; });
  await compose.getByRole('button', { name: 'Make it an ECS message' }).click();
  await compose.getByText('Remove the Bcc recipients first').waitFor();
  await compose.evaluate(() => { window.__st.bcc = []; });
  await compose.getByRole('button', { name: 'Make it an ECS message' }).click();
  await compose.getByText('Done: the text and attachments are stored').waitFor();
  let s = await st(compose);
  assert.equal(s.attachments.length, 0, 'the attachment left the email');
  assert.ok(!s.body.includes('wire details'), 'the text left the email');
  assert.match(s.body, /Bob Uomini sent you a message: “Closing documents”/);
  const hit = findEcsLink(s.body, BASE);
  assert.ok(hit, 'the email links to the reader page');
  assert.equal(s.headers['X-ChiaraMail-Content-Pointer'], hit.id);
  assert.equal(s.headers['X-ChiaraMail-Content-Key'], hit.key);

  await shot(compose, '2-converted');
  // Undo puts everything back and deletes the stored copy; then again, for real.
  await compose.getByRole('button', { name: 'Undo' }).click();
  await compose.getByText('Undone: the message is back').waitFor();
  s = await st(compose);
  assert.ok(s.body.includes('wire details'));
  assert.deepEqual(s.attachments.map((a) => a.name), ['wire.txt']);
  assert.equal(Object.keys(s.headers).length, 0);
  const gone = await db.query('SELECT count(*)::int AS n FROM messages WHERE id = $1', [hit.id]).catch(() => null);
  if (gone) assert.equal(gone.rows[0].n, 0, 'the undone message is deleted');
  await compose.getByRole('button', { name: 'Make it an ECS message' }).click();
  await compose.getByText('Done: the text and attachments are stored').waitFor();
  s = await st(compose);
  const sent = findEcsLink(s.body, BASE);
  assert.ok(sent && sent.id !== hit.id);
  assert.deepEqual(compose.errors, []);
  console.log('ok compose: convert, bcc check, undo');

  // ---- Alice reads it in Outlook ------------------------------------------------------------
  const alice = await pane('alice@example.fr', { mode: 'read', from: 'bob@example.fr', subject: 'Closing documents', body: s.body });
  await signIn(alice, 'alice@example.fr');
  await alice.getByText('wire details').waitFor();
  await alice.getByText('Verified sender').waitFor();
  await alice.getByText('wire.txt').waitFor();
  assert.equal(await alice.getByRole('button', { name: 'Edit', exact: true }).count(), 0, 'readers can’t edit');
  await shot(alice, '3-reader');
  console.log('ok read: recipient sees content and attachment');

  // A Safe Links copy of the same email works too.
  const wrapped = s.body.replace(/href="([^"]+)"/, (_, u) => `href="https://eur01.safelinks.protection.outlook.com/?url=${encodeURIComponent(u)}&amp;reserved=0"`);
  const alice2 = await pane('alice@example.fr', { mode: 'read', from: 'bob@example.fr', body: wrapped });
  await alice2.getByText('wire details').waitFor();
  await alice2.close();

  // An ordinary email.
  const plain = await pane('alice@example.fr', { mode: 'read', from: 'x@example.com', body: '<p>Lunch?</p>' });
  await plain.getByText('This email isn’t an ECS message').waitFor();
  await plain.close();
  console.log('ok read: Safe Links and ordinary emails');

  // ---- Bob, in Sent Items: edits, lets them know, withdraws ----------------------------------------
  const bobRead = await pane('bob@example.fr', { mode: 'read', from: 'bob@example.fr', subject: 'Closing documents', body: s.body });
  await bobRead.getByRole('button', { name: 'Edit', exact: true }).waitFor();
  await shot(bobRead, '4-sender');
  await bobRead.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = bobRead.locator('[contenteditable="true"]').first();
  await editor.click();
  await bobRead.keyboard.press('Control+End');
  await bobRead.keyboard.type(' Corrected: wire on Friday.');
  await bobRead.getByRole('button', { name: 'Save new edition' }).click();
  await bobRead.getByText('Edition 2 saved').waitFor();
  await bobRead.getByRole('button', { name: 'Let them know' }).click();
  const reply = (await st(bobRead)).replyAll;
  assert.ok(reply && reply.htmlBody.includes(`/m/${sent.id}#k=`), 'reply-all opens with the link');

  await alice.reload();
  await alice.getByText('Corrected: wire on Friday.').waitFor({ timeout: 30_000 });
  console.log('ok edit: new edition reaches the reader');

  await bobRead.getByRole('button', { name: 'Withdraw' }).click();
  await bobRead.getByText('Withdraw this message?').waitFor();
  await shot(bobRead, '5-withdraw-ask');
  await bobRead.getByRole('button', { name: 'Cancel' }).click();
  await bobRead.getByRole('button', { name: 'Withdraw' }).click();
  await bobRead.getByRole('button', { name: 'Withdraw it' }).click();
  await bobRead.getByText('You withdrew this message', { exact: false }).waitFor({ timeout: 30_000 });
  await alice.reload();
  await alice.getByText('withdrew this message', { exact: false }).waitFor({ timeout: 30_000 });
  assert.deepEqual([...bobRead.errors, ...alice.errors], []);
  console.log('ok withdraw (asked on the page, no browser dialog)');

  // ---- signed in with another address than the mailbox ---------------------------------------------
  const other = await pane('bob@example.fr', { mode: 'compose', me: 'bob@work.example', to: ['alice@example.fr'], body: '<p>Hi</p>' });
  await other.getByText('This message goes out from bob@work.example').waitFor();
  console.log('ok other-account warning');
  // outlook.com: the mailbox's internal name differs from the From address; the From address counts.
  const ocom = await pane('dave@example.fr', { mode: 'compose', me: 'outlook_79c1192107c52657@outlook.com', sendFrom: 'dave@example.fr', to: ['alice@example.fr'], body: '<p>Hi</p>' });
  await ocom.getByRole('button', { name: 'Email me a code' }).waitFor();
  assert.equal(await ocom.getByLabel('Your email address').inputValue(), 'dave@example.fr', 'signs in with the From address');
  await signIn(ocom, 'dave@example.fr');
  await ocom.getByRole('heading', { name: 'Send as an ECS message' }).waitFor();
  assert.equal(await ocom.getByText('This message goes out from').count(), 0, 'no mismatch note');
  console.log('ok outlook.com: the From address, not the mailbox name');
  console.log('\nAll Outlook add-in checks passed.');
} finally {
  await browser.close();
  server.close();
  await db.close();
  await pg.stop();
  rmSync(files, { recursive: true, force: true });
}
