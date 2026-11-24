// "Keep me signed in", browser side (src/gmail/api.js), with Google, the
// server functions and Firebase replaced by stand-ins. Run: node --test tests/keep.client.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const store = new Map();
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

let now = Date.now();
const realNow = Date.now;
Date.now = () => now;

// Google Identity Services stand-in.
const gis = { code: 'CODE1', revoked: [], codeConfigs: [] };
window.google = { accounts: { oauth2: {
  initCodeClient: (cfg) => { gis.codeConfigs.push(cfg); return { requestCode: () => setTimeout(() => cfg.callback({ code: gis.code }), 0) }; },
  initTokenClient: (cfg) => ({ requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'PLAIN', expires_in: 3600, scope: 'x' }), 0) }),
  hasGrantedAllScopes: () => true,
  revoke: (t, cb) => { gis.revoked.push(t); cb(); },
} } };

// Server functions + Gmail stand-in.
const calls = [];
let server = {};
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, opts });
  const reply = (status, body) => ({ ok: status < 300, status, statusText: String(status), json: async () => body });
  if (u.startsWith('/api/gmail/')) {
    assert.equal(opts.headers['X-Requested-With'], 'XmlHttpRequest');
    const name = u.slice('/api/gmail/'.length);
    const r = server[name];
    return typeof r === 'function' ? r(opts) : reply(...r);
  }
  if (u.includes('gmail.googleapis.com')) return reply(200, { emailAddress: 'bob@gmail.com', usedWith: opts.headers.Authorization });
  throw new Error('unexpected fetch ' + u);
};

let api; let backend;
before(async () => {
  const vite = await createServer({
    configFile: false, logLevel: 'silent', server: { middlewareMode: true, hmr: false }, appType: 'custom',
    define: { 'import.meta.env.VITE_GOOGLE_CLIENT_ID': '"cid"' },
    resolve: { alias: { '@backend': fileURLToPath(new URL('./keep.backend-stub.mjs', import.meta.url)) } },
  });
  api = await vite.ssrLoadModule('/src/gmail/api.js');
  backend = await vite.ssrLoadModule(fileURLToPath(new URL('./keep.backend-stub.mjs', import.meta.url)));
  await vite.close();
});
const ok = (b) => [200, b];
const lastApi = (name) => calls.filter((c) => c.url === `/api/gmail/${name}`).at(-1);

test('ticked: the code goes to the server, which keeps the refresh token', async () => {
  server = { keep: ok({ access_token: 'A1', expires_in: 3600, email: 'bob@gmail.com', kept: true }) };
  assert.equal(await api.connect({ keep: true }), 'bob@gmail.com');
  assert.equal(JSON.parse(lastApi('keep').opts.body).code, 'CODE1');
  assert.equal(gis.codeConfigs.at(-1).ux_mode, 'popup');
  assert.match(gis.codeConfigs.at(-1).scope, /gmail\.modify/);
  assert.equal(backend.state.signedInWith, 'A1');
  assert.equal(api.keepsSignedIn(), true);
  assert.equal((await api.getProfile()).usedWith, 'Bearer A1');
});

test('after the hour: a fresh token from the server, without a tap', async () => {
  now += 3600_000;
  server = { token: ok({ access_token: 'A2', expires_in: 3600, email: 'bob@gmail.com' }) };
  assert.equal((await api.getProfile()).usedWith, 'Bearer A2');
  assert.equal(lastApi('token').opts.headers.Authorization, 'Bearer FBID');
  // Reopening the app: resume() gives the address.
  now += 3600_000;
  assert.equal(await api.resume(), 'bob@gmail.com');
});

test('several calls at once share one refresh', async () => {
  now += 3600_000;
  let n = 0;
  server = { token: () => { n += 1; return { ok: true, status: 200, json: async () => ({ access_token: 'A3', expires_in: 3600, email: 'bob@gmail.com' }) }; } };
  await Promise.all([api.getProfile(), api.getProfile(), api.getProfile()]);
  assert.equal(n, 1);
});

test('no longer kept (revoked at Google): back to the sign-in screen, flag cleared', async () => {
  now += 3600_000;
  server = { token: [404, { error: 'not-kept' }] };
  await assert.rejects(api.getProfile(), { code: 'reconnect' });
  assert.equal(api.keepsSignedIn(), false);
});

test('Google gave no refresh token: its old permission is dropped and the app asks once more', async () => {
  server = { keep: ok({ access_token: 'A4', expires_in: 3600, email: 'bob@gmail.com', kept: false }) };
  await assert.rejects(api.connect({ keep: true }), { code: 'keep-again' });
  assert.deepEqual(gis.revoked.at(-1), 'A4');
  assert.equal(api.keepsSignedIn(), false);
});

test('Gmail not allowed on the code path: scope-denied, as on the other path', async () => {
  server = { keep: [403, { error: 'scope-denied' }] };
  await assert.rejects(api.connect({ keep: true }), { code: 'scope-denied' });
});

test('sign out: the server and Google forget the refresh token', async () => {
  server = { keep: ok({ access_token: 'A5', expires_in: 3600, email: 'bob@gmail.com', kept: true }), forget: ok({ ok: true }) };
  await api.connect({ keep: true });
  const before = calls.length;
  await api.disconnect();
  assert.equal(lastApi('forget').opts.headers.Authorization, 'Bearer FBID');
  assert.ok(calls.indexOf(lastApi('forget')) >= before);
  assert.equal(api.keepsSignedIn(), false);
  assert.equal(backend.state.signedOut, true);
});

test('unticked after being kept: forgotten once signed in, nothing kept', async () => {
  server = { keep: ok({ access_token: 'A6', expires_in: 3600, email: 'bob@gmail.com', kept: true }), forget: ok({ ok: true }) };
  await api.connect({ keep: true });
  const n = calls.filter((c) => c.url === '/api/gmail/forget').length;
  assert.equal(await api.connect({}), 'bob@gmail.com');
  assert.equal(calls.filter((c) => c.url === '/api/gmail/forget').length, n + 1);
  assert.equal(api.keepsSignedIn(), false);
  // Not kept: after the hour, no server call, straight to reconnect.
  now += 3600_000;
  const t = calls.length;
  await assert.rejects(api.getProfile(), { code: 'reconnect' });
  assert.equal(calls.slice(t).filter((c) => c.url.startsWith('/api/')).length, 0);
  Date.now = realNow;
});
