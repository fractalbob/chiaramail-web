import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as k from './keep.js';

const KEY = randomBytes(32).toString('base64');
const cfg = { clientId: 'cid', clientSecret: 'secret', key: KEY };
const req = ({ body, auth, origin = 'https://app.chiaramail.com', xrw = 'XmlHttpRequest', method = 'POST' } = {}) => ({
  method, body, get: (h) => ({ origin, 'x-requested-with': xrw, authorization: auth && `Bearer ${auth}` })[h.toLowerCase()],
});
const memStore = () => { const m = new Map(); return { m, get: async (s) => m.get(s) || null, set: async (s, d) => { m.set(s, d); }, delete: async (s) => { m.delete(s); } }; };
const SCOPE = `openid email ${k.GMAIL_SCOPE}`;
// A stand-in for Google's token and revoke endpoints.
function google(responses) {
  const calls = [];
  const fetchFn = async (url, opts) => {
    const form = Object.fromEntries(new URLSearchParams(opts.body));
    calls.push({ url, form });
    const r = responses.shift();
    return { ok: !r.error, status: r.error ? 400 : 200, json: async () => r };
  };
  return { fetchFn, calls };
}
const verifyGoogleIdToken = async (t, aud) => { assert.equal(aud, 'cid'); return JSON.parse(t); };
const verifyIdToken = async (t) => { if (t === 'bad') throw new Error('bad'); return JSON.parse(t); };
const fbToken = (sub) => JSON.stringify({ email: 'bob@gmail.com', firebase: { identities: { 'google.com': [sub] } } });

test('encryption round trip, bound to the account', () => {
  const s = k.encrypt(KEY, 'sub1', 'rt-123');
  assert.equal(k.decrypt(KEY, 'sub1', s), 'rt-123');
  assert.throws(() => k.decrypt(KEY, 'sub2', s));
  assert.notEqual(k.encrypt(KEY, 'sub1', 'rt-123'), s, 'fresh IV each time');
});

test('requests must come from the app, with the popup header', async () => {
  const store = memStore();
  const g = google([]);
  const run = (r) => k.keep({ req: r, cfg, store, fetchFn: g.fetchFn, verifyGoogleIdToken });
  await assert.rejects(run(req({ body: { code: 'c' }, origin: 'https://evil.example' })), { status: 403, code: 'origin' });
  await assert.rejects(run(req({ body: { code: 'c' }, xrw: '' })), { status: 403, code: 'header' });
  await assert.rejects(run(req({ body: { code: 'c' }, method: 'GET' })), { status: 405 });
  await assert.rejects(run(req({ body: {} })), { status: 400, code: 'code' });
  assert.equal(g.calls.length, 0);
});

test('keep: stores the refresh token encrypted and returns an access token', async () => {
  const store = memStore();
  const g = google([{ access_token: 'at1', expires_in: 3599, refresh_token: 'rt1', scope: SCOPE, id_token: JSON.stringify({ sub: 's1', email: 'bob@gmail.com' }) }]);
  const r = await k.keep({ req: req({ body: { code: 'c1' } }), cfg, store, fetchFn: g.fetchFn, verifyGoogleIdToken });
  assert.deepEqual(r, { access_token: 'at1', expires_in: 3599, email: 'bob@gmail.com', kept: true });
  assert.equal(g.calls[0].form.redirect_uri, 'postmessage');
  assert.equal(g.calls[0].form.client_secret, 'secret');
  const doc = store.m.get('s1');
  assert.ok(!JSON.stringify(doc).includes('rt1'), 'not stored in clear');
  assert.equal(k.decrypt(KEY, 's1', doc.rt), 'rt1');
});

test('keep: redirect_uri falls back to the page origin', async () => {
  const store = memStore();
  const g = google([{ error: 'redirect_uri_mismatch' }, { access_token: 'at', expires_in: 1, refresh_token: 'rt', scope: SCOPE, id_token: JSON.stringify({ sub: 's1' }) }]);
  await k.keep({ req: req({ body: { code: 'c' } }), cfg, store, fetchFn: g.fetchFn, verifyGoogleIdToken });
  assert.equal(g.calls[1].form.redirect_uri, 'https://app.chiaramail.com');
});

test('keep: no refresh token from Google → kept false, unless one is already kept', async () => {
  const store = memStore();
  const resp = () => ({ access_token: 'at', expires_in: 1, scope: SCOPE, id_token: JSON.stringify({ sub: 's1' }) });
  let g = google([resp()]);
  assert.equal((await k.keep({ req: req({ body: { code: 'c' } }), cfg, store, fetchFn: g.fetchFn, verifyGoogleIdToken })).kept, false);
  await store.set('s1', { rt: k.encrypt(KEY, 's1', 'old'), email: 'x' });
  g = google([resp()]);
  assert.equal((await k.keep({ req: req({ body: { code: 'c' } }), cfg, store, fetchFn: g.fetchFn, verifyGoogleIdToken })).kept, true);
});

test('keep: without Gmail access nothing is stored', async () => {
  const store = memStore();
  const g = google([{ access_token: 'at', refresh_token: 'rt', scope: 'openid email', id_token: JSON.stringify({ sub: 's1' }) }]);
  await assert.rejects(k.keep({ req: req({ body: { code: 'c' } }), cfg, store, fetchFn: g.fetchFn, verifyGoogleIdToken }), { code: 'scope-denied' });
  assert.equal(store.m.size, 0);
});

test('token: signed-in user gets a fresh access token; revoked grant is forgotten', async () => {
  const store = memStore();
  await store.set('s1', { rt: k.encrypt(KEY, 's1', 'rt1'), email: 'bob@gmail.com' });
  let g = google([{ access_token: 'at2', expires_in: 3599, scope: SCOPE }]);
  const r = await k.token({ req: req({ auth: fbToken('s1') }), cfg, store, fetchFn: g.fetchFn, verifyIdToken });
  assert.deepEqual(r, { access_token: 'at2', expires_in: 3599, email: 'bob@gmail.com' });
  assert.equal(g.calls[0].form.refresh_token, 'rt1');
  assert.equal(g.calls[0].form.grant_type, 'refresh_token');
  // Another account, or not signed in, or not a Google account: nothing.
  await assert.rejects(k.token({ req: req({ auth: fbToken('s2') }), cfg, store, fetchFn: g.fetchFn, verifyIdToken }), { status: 404 });
  await assert.rejects(k.token({ req: req({}), cfg, store, fetchFn: g.fetchFn, verifyIdToken }), { status: 401 });
  await assert.rejects(k.token({ req: req({ auth: 'bad' }), cfg, store, fetchFn: g.fetchFn, verifyIdToken }), { status: 401 });
  await assert.rejects(k.token({ req: req({ auth: JSON.stringify({ firebase: { identities: {} } }) }), cfg, store, fetchFn: g.fetchFn, verifyIdToken }), { status: 403 });
  g = google([{ error: 'invalid_grant' }]);
  await assert.rejects(k.token({ req: req({ auth: fbToken('s1') }), cfg, store, fetchFn: g.fetchFn, verifyIdToken }), { status: 404 });
  assert.equal(store.m.size, 0, 'forgotten after Google revoked it');
});

test('forget: revokes at Google and deletes', async () => {
  const store = memStore();
  await store.set('s1', { rt: k.encrypt(KEY, 's1', 'rt1'), email: 'bob@gmail.com' });
  const g = google([{}]);
  assert.deepEqual(await k.forget({ req: req({ auth: fbToken('s1') }), cfg, store, fetchFn: g.fetchFn, verifyIdToken }), { ok: true });
  assert.match(g.calls[0].url, /revoke/);
  assert.equal(g.calls[0].form.token, 'rt1');
  assert.equal(store.m.size, 0);
});
