// The ECS server against a real PostgreSQL: sign-in, and every access rule
// that firestore.rules and storage.rules enforce for the web app.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPostgres } from './pg.js';
import { openDb } from '../src/db.js';
import { fileStore } from '../src/store.js';
import { memoryMailer } from '../src/mailer.js';
import { createApp, QUOTA } from '../src/app.js';

let pg; let db; let server; let base; let mailer; let files;

const call = async (method, path, { token, json, body, headers = {} } = {}) => {
  const r = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : body,
  });
  const type = r.headers.get('content-type') || '';
  return { status: r.status, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
async function signIn(email) {
  const s = await call('POST', '/auth/start', { json: { email, lang: 'en' } });
  assert.equal(s.status, 200);
  const sent = mailer.sent.at(-1);
  assert.equal(sent.to, email.toLowerCase());
  assert.match(sent.subject, new RegExp(`ChiaraMail: your code ${sent.code} \\(ref\\. ${s.data.ref}\\)`));
  const v = await call('POST', '/auth/verify', { json: { email, code: sent.code } });
  assert.equal(v.status, 200);
  return v.data;
}
const newMsg = (token, extra = {}) => call('POST', '/messages', { token, json: { recipients: ['alice@example.fr'], subject: 'S1', body: 'B1', enc: 1, ...extra } });

let bob; let alice; let eve;
before(async () => {
  pg = await startPostgres();
  db = await openDb(pg.url);
  mailer = memoryMailer();
  files = mkdtempSync(join(tmpdir(), 'cm-files-'));
  server = createServer(createApp({ db, store: fileStore(files), mailer, origins: ['app://chiaramail'] }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  bob = await signIn('Bob@Example.fr');
  alice = await signIn('alice@example.fr');
  eve = await signIn('eve@example.fr');
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  await pg.stop();
  rmSync(files, { recursive: true, force: true });
});

test('sign-in with an emailed code', async () => {
  assert.equal(bob.user.email, 'bob@example.fr');
  assert.equal((await call('GET', '/me', { token: bob.token })).data.uid, bob.user.uid);
  // Signing in again keeps the same account.
  const again = await signIn('bob@example.fr');
  assert.equal(again.user.uid, bob.user.uid);
  await call('POST', '/auth/signout', { token: again.token });
  assert.equal((await call('GET', '/me', { token: again.token })).status, 401);
  assert.equal((await call('GET', '/me')).status, 401);
});

test('wrong codes: refused, and only five tries', async () => {
  await call('POST', '/auth/start', { json: { email: 'carol@example.fr' } });
  const { code } = mailer.sent.at(-1);
  assert.match(mailer.sent.at(-1).subject, /^ChiaraMail : votre code/); // French by default
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i += 1) assert.equal((await call('POST', '/auth/verify', { json: { email: 'carol@example.fr', code: wrong } })).status, 401);
  assert.equal((await call('POST', '/auth/verify', { json: { email: 'carol@example.fr', code } })).status, 401, 'locked after 5 wrong tries');
});

test('at most five codes an hour per address', async () => {
  for (let i = 0; i < 5; i += 1) assert.equal((await call('POST', '/auth/start', { json: { email: 'dan@example.fr' } })).status, 200);
  const r = await call('POST', '/auth/start', { json: { email: 'dan@example.fr' } });
  assert.equal(r.status, 429);
  assert.equal(r.data.error.code, 'rate-limit');
});

test('only the sender and recipients can read a message', async () => {
  const { data: { id } } = await newMsg(bob.token, { senderName: 'Bob Uomini' });
  assert.match(id, /^[A-Za-z0-9]{20}$/);
  const forAlice = await call('GET', `/messages/${id}`, { token: alice.token });
  assert.equal(forAlice.status, 200);
  assert.equal(forAlice.data.senderEmail, 'bob@example.fr');
  assert.equal(forAlice.data.senderName, 'Bob Uomini');
  assert.equal(forAlice.data.enc, 1);
  assert.equal(forAlice.data.edition, 1);
  assert.equal((await call('GET', `/messages/${id}`, { token: bob.token })).status, 200);
  assert.equal((await call('GET', `/messages/${id}`, { token: eve.token })).status, 404);
  assert.equal((await call('GET', `/messages/${id}`)).status, 401);
  assert.equal((await call('GET', `/messages/${id}/sender`, { token: alice.token })).data.senderEmail, 'bob@example.fr');
  assert.equal((await call('GET', `/messages/${id}/sender`, { token: eve.token })).status, 404);
});

test('creating: the sender is whoever is signed in; limits are checked', async () => {
  const r = await newMsg(alice.token, { senderEmail: 'bob@example.fr', senderUid: bob.user.uid });
  assert.equal((await call('GET', `/messages/${r.data.id}`, { token: alice.token })).data.senderEmail, 'alice@example.fr');
  assert.equal((await newMsg(bob.token, { recipients: [] })).status, 400);
  assert.equal((await newMsg(bob.token, { recipients: Array.from({ length: 51 }, (_, i) => `r${i}@x.fr`) })).status, 400);
  assert.equal((await newMsg(bob.token, { body: '' })).status, 400);
  assert.equal((await newMsg(bob.token, { body: 'x'.repeat(300001) })).status, 400);
  assert.equal((await newMsg(bob.token, { subject: 'x'.repeat(2001) })).status, 400);
  assert.equal((await newMsg(bob.token, { recipients: ['not an address'] })).status, 400);
});

test('only the sender edits; every edition is kept, for the sender only', async () => {
  const { data: { id } } = await newMsg(bob.token);
  assert.equal((await call('POST', `/messages/${id}/editions`, { token: alice.token, json: { subject: 'X', body: 'X' } })).status, 404);
  const e = await call('POST', `/messages/${id}/editions`, { token: bob.token, json: { subject: 'S2', body: 'B2' } });
  assert.equal(e.data.edition, 2);
  const m = (await call('GET', `/messages/${id}`, { token: alice.token })).data;
  assert.equal(m.body, 'B2');
  assert.equal(m.edition, 2);
  const eds = (await call('GET', `/messages/${id}/editions`, { token: bob.token })).data;
  assert.deepEqual(eds.map((x) => [x.edition, x.body]), [[2, 'B2'], [1, 'B1']]);
  assert.equal((await call('GET', `/messages/${id}/editions`, { token: alice.token })).status, 404);
  // forwarding switch: sender only
  assert.equal((await call('PATCH', `/messages/${id}`, { token: alice.token, json: { allowForward: true } })).status, 404);
  await call('PATCH', `/messages/${id}`, { token: bob.token, json: { allowForward: true } });
  assert.equal((await call('GET', `/messages/${id}`, { token: alice.token })).data.allowForward, true);
});

test('read receipts', async () => {
  const { data: { id } } = await newMsg(bob.token);
  assert.equal((await call('GET', `/messages/${id}/reads/me`, { token: alice.token })).data, null);
  await call('PUT', `/messages/${id}/read`, { token: alice.token, json: { edition: 1 } });
  assert.equal((await call('PUT', `/messages/${id}/read`, { token: eve.token, json: { edition: 1 } })).status, 404);
  assert.equal((await call('GET', `/messages/${id}/reads/me`, { token: alice.token })).data.editionSeen, 1);
  const reads = (await call('GET', `/messages/${id}/reads`, { token: bob.token })).data;
  assert.deepEqual(Object.keys(reads), ['alice@example.fr']);
  assert.ok(reads['alice@example.fr'].lastReadAt);
  assert.equal((await call('GET', `/messages/${id}/reads`, { token: alice.token })).status, 404, 'only the sender sees who read it');
});

test('attachments: only readers fetch them; size limits; the 1 GB allowance', async () => {
  const atts = [{ name: 'n1', type: 't1', size: 10 }, { name: 'n2', type: 't2', size: 3 }];
  const { data: { id } } = await newMsg(bob.token, { attachments: atts });
  assert.deepEqual((await call('GET', '/usage', { token: bob.token })).data, { used: 13, quota: QUOTA });
  assert.equal((await call('PUT', `/messages/${id}/files/0`, { token: alice.token, body: Buffer.alloc(10) })).status, 404, 'only the sender uploads');
  assert.equal((await call('PUT', `/messages/${id}/files/0`, { token: bob.token, body: Buffer.from('0123456789') })).status, 200);
  assert.equal((await call('PUT', `/messages/${id}/files/1`, { token: bob.token, body: Buffer.alloc(3 + 1025) })).status, 413, 'not bigger than declared');
  assert.equal((await call('PUT', `/messages/${id}/files/2`, { token: bob.token, body: Buffer.alloc(1) })).status, 400, 'no undeclared files');
  const got = await call('GET', `/messages/${id}/files/0`, { token: alice.token });
  assert.equal(got.data.toString(), '0123456789');
  assert.equal((await call('GET', `/messages/${id}/files/0`, { token: eve.token })).status, 404);
  // Over the allowance: refused, with the figures.
  const big = await newMsg(bob.token, { attachments: Array.from({ length: 20 }, () => ({ name: 'x', type: 'x', size: 25 * 1024 * 1024 })) });
  assert.equal(big.status, 200);
  await db.query('UPDATE usage SET bytes = $2 WHERE uid = $1', [bob.user.uid, QUOTA - 5]);
  const over = await newMsg(bob.token, { attachments: [{ name: 'x', type: 'x', size: 10 }] });
  assert.equal(over.status, 409);
  assert.equal(over.data.error.code, 'quota');
  assert.equal(over.data.error.need, 10);
  assert.equal((await newMsg(bob.token, { attachments: Array.from({ length: 21 }, () => ({ name: 'x', type: 'x', size: 1 })) })).status, 400, 'at most 20 files');
  assert.equal((await newMsg(bob.token, { attachments: [{ name: 'x', type: 'x', size: 26 * 1024 * 1024 }] })).status, 400, 'at most 25 MB a file');
  await db.query('UPDATE usage SET bytes = 13 WHERE uid = $1', [bob.user.uid]);
  // Withdrawing frees the space, wipes the text, and removes the files.
  assert.equal((await call('POST', `/messages/${id}/withdraw`, { token: alice.token })).status, 404);
  await call('POST', `/messages/${id}/withdraw`, { token: bob.token });
  const w = (await call('GET', `/messages/${id}`, { token: alice.token })).data;
  assert.equal(w.withdrawn, true);
  assert.equal(w.body, '');
  assert.equal((await call('GET', `/messages/${id}/files/0`, { token: alice.token })).status, 404);
  assert.ok(!existsSync(join(files, id)));
  assert.equal((await call('GET', '/usage', { token: bob.token })).data.used, 0);
  assert.equal((await call('POST', `/messages/${id}/editions`, { token: bob.token, json: { subject: 'S', body: 'B' } })).status, 409, 'no edits after withdrawing');
});

test('deleting: sender only; frees the space; everything goes', async () => {
  const { data: { id } } = await newMsg(bob.token, { attachments: [{ name: 'n', type: 't', size: 4 }] });
  await call('PUT', `/messages/${id}/files/0`, { token: bob.token, body: Buffer.from('abcd') });
  await call('PUT', `/messages/${id}/read`, { token: alice.token, json: { edition: 1 } });
  const before = (await call('GET', '/usage', { token: bob.token })).data.used;
  assert.equal((await call('DELETE', `/messages/${id}`, { token: alice.token })).status, 404);
  assert.equal((await call('DELETE', `/messages/${id}`, { token: bob.token })).status, 200);
  assert.equal((await call('GET', `/messages/${id}`, { token: bob.token })).status, 404);
  assert.equal((await call('GET', '/usage', { token: bob.token })).data.used, before - 4);
  assert.equal((await db.query('SELECT count(*) FROM editions WHERE message_id = $1', [id])).rows[0].count, 0);
  assert.equal((await db.query('SELECT count(*) FROM reads WHERE message_id = $1', [id])).rows[0].count, 0);
  assert.ok(!existsSync(join(files, id)));
});

test('preferences: your own, nobody else’s', async () => {
  assert.equal((await call('GET', '/prefs', { token: bob.token })).data, null);
  await call('PUT', '/prefs', { token: bob.token, json: { signature: '<b>Bob</b>' } });
  assert.equal((await call('GET', '/prefs', { token: bob.token })).data.signature, '<b>Bob</b>');
  assert.equal((await call('GET', '/prefs', { token: alice.token })).data, null);
  assert.equal((await call('PUT', '/prefs', { token: bob.token, json: { signature: 'x'.repeat(10001) } })).status, 400);
});

test('the ECS directory: one address at a time', async () => {
  await call('POST', '/directory', { token: bob.token });
  assert.equal((await call('GET', '/directory/bob%40example.fr', { token: alice.token })).data.ecs, true);
  assert.equal((await call('GET', '/directory/zed%40example.fr', { token: alice.token })).data.ecs, false);
  assert.equal((await call('GET', '/directory/bob%40example.fr')).status, 401);
  assert.equal((await call('GET', '/directory', { token: alice.token })).status, 404, 'no list');
});

test('only the app and the reader page may call from a browser', async () => {
  const ok = await fetch(`${base}/health`, { headers: { Origin: 'app://chiaramail' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'app://chiaramail');
  const no = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(no.headers.get('access-control-allow-origin'), null);
});
