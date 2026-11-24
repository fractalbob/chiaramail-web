// "Keep me signed in" for the Gmail web app. Google gives a browser only a
// one-hour access token; to stay signed in, the browser sends this server a
// one-time authorization code (Google's code model, popup), the server
// exchanges it for a refresh token and keeps that token encrypted. Later the
// app, still signed in to ChiaraMail (Firebase), asks for a fresh access token.
// The refresh token itself never leaves this server.
//
// Everything that talks to the outside world (Google, Firestore, Firebase Auth)
// is passed in, so this file can be tested on its own (keep.test.js).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

// The pages that may use these endpoints (the app is served from these origins).
export const ORIGINS = new Set([
  'https://app.chiaramail.com',
  'https://chiaramail-mail.web.app',
  'https://chiaramail-mail.firebaseapp.com',
  'https://chiaramail-15119.web.app',
  'https://chiaramail-15119.firebaseapp.com',
]);

export class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

// ---- encryption of stored refresh tokens (AES-256-GCM, bound to the Google account) ----
export function encrypt(keyB64, sub, plain) {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('KEEP_KEY must be 32 bytes, base64');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(sub));
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}
export function decrypt(keyB64, sub, sealed) {
  const key = Buffer.from(keyB64, 'base64');
  const raw = Buffer.from(sealed, 'base64');
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAAD(Buffer.from(sub));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

// ---- requests -----------------------------------------------------------------------
/** Only the app's own pages, sending JSON with the header Google's popup mode asks for. */
export function checkRequest(req) {
  if (req.method !== 'POST') throw new HttpError(405, 'method');
  const origin = req.get('origin') || '';
  if (!ORIGINS.has(origin) && !(process.env.FUNCTIONS_EMULATOR && /^http:\/\/localhost:\d+$/.test(origin))) {
    throw new HttpError(403, 'origin');
  }
  if (req.get('x-requested-with') !== 'XmlHttpRequest') throw new HttpError(403, 'header');
  return origin;
}

/** The Google account (sub) of the signed-in ChiaraMail user. */
export async function googleSub(req, verifyIdToken) {
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  if (!m) throw new HttpError(401, 'signin');
  let d;
  try { d = await verifyIdToken(m[1]); } catch { throw new HttpError(401, 'signin'); }
  const sub = d.firebase?.identities?.['google.com']?.[0];
  if (!sub) throw new HttpError(403, 'not-google');
  return { sub, email: d.email || '' };
}

async function postForm(fetchFn, url, form) {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  let json = {};
  try { json = await res.json(); } catch { /* empty */ }
  return { ok: res.ok, status: res.status, json };
}

/**
 * POST /api/gmail/keep {code}: exchanges the code, keeps the refresh token and
 * returns an access token. kept=false when Google gave no refresh token and none
 * is kept yet (the account had already allowed ChiaraMail without one); the app
 * then has Google forget the old permission and asks once more.
 */
export async function keep({ req, cfg, store, fetchFn, verifyGoogleIdToken }) {
  const origin = checkRequest(req);
  const code = req.body?.code;
  if (typeof code !== 'string' || !code || code.length > 2048) throw new HttpError(400, 'code');
  let r;
  for (const redirect of ['postmessage', origin]) {
    r = await postForm(fetchFn, TOKEN_URL, {
      code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirect, grant_type: 'authorization_code',
    });
    if (r.json.error !== 'redirect_uri_mismatch') break;
  }
  if (!r.ok) throw new HttpError(400, 'exchange', r.json.error_description || r.json.error || 'exchange failed');
  const t = r.json;
  if (!String(t.scope || '').split(' ').includes(GMAIL_SCOPE)) throw new HttpError(403, 'scope-denied');
  const id = await verifyGoogleIdToken(t.id_token, cfg.clientId);
  const sub = id.sub; const email = id.email || '';
  if (!sub) throw new HttpError(400, 'exchange', 'no id token');
  let kept = false;
  if (t.refresh_token) {
    await store.set(sub, { rt: encrypt(cfg.key, sub, t.refresh_token), email, updated: Date.now() });
    kept = true;
  } else {
    kept = !!(await store.get(sub));
  }
  return { access_token: t.access_token, expires_in: t.expires_in, email, kept };
}

/** POST /api/gmail/token (signed in to ChiaraMail): a fresh access token from the kept refresh token. */
export async function token({ req, cfg, store, fetchFn, verifyIdToken }) {
  checkRequest(req);
  const { sub } = await googleSub(req, verifyIdToken);
  const doc = await store.get(sub);
  if (!doc) throw new HttpError(404, 'not-kept');
  const r = await postForm(fetchFn, TOKEN_URL, {
    refresh_token: decrypt(cfg.key, sub, doc.rt), client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token',
  });
  if (!r.ok) {
    if (r.json.error === 'invalid_grant') { await store.delete(sub); throw new HttpError(404, 'not-kept'); } // revoked or expired
    throw new HttpError(502, 'refresh', r.json.error || 'refresh failed');
  }
  if (!String(r.json.scope || GMAIL_SCOPE).split(' ').includes(GMAIL_SCOPE)) throw new HttpError(403, 'scope-denied');
  return { access_token: r.json.access_token, expires_in: r.json.expires_in, email: doc.email };
}

/** POST /api/gmail/forget (signed in): Google forgets the refresh token, and so does this server. */
export async function forget({ req, cfg, store, fetchFn, verifyIdToken }) {
  checkRequest(req);
  const { sub } = await googleSub(req, verifyIdToken);
  const doc = await store.get(sub);
  if (doc) {
    try { await postForm(fetchFn, REVOKE_URL, { token: decrypt(cfg.key, sub, doc.rt) }); } catch { /* deleted anyway */ }
    await store.delete(sub);
  }
  return { ok: true };
}
