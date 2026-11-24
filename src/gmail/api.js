// Real Gmail: Google sign-in for a Gmail access token (Google Identity
// Services), then the Gmail REST API, straight from the browser. Mail is never
// stored on any server; ChiaraMail stores only its own ECS messages and, with
// "Keep me signed in", an encrypted Google refresh token (functions/keep.js).
import * as backend from '@backend';
import { busy } from '../busy.js';
import { widenQuery } from './query.js';

export const mode = 'gmail';
const SCOPES = 'openid email profile https://www.googleapis.com/auth/gmail.modify';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const UPLOAD = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart';
const TOKEN_KEY = 'chiaramail.gmailToken';
const HINT_KEY = 'chiaramail.lastAccount';
const CHOOSE_KEY = 'chiaramail.chooseAccount'; // set by Sign out: next sign-in shows Google's account chooser
const KEEP_KEY = 'chiaramail.keepSignedIn'; // '1': the server keeps a refresh token for this account

let token = null; // { accessToken, expiresAt, email }
let gisLoaded = null;

const reconnectError = () => Object.assign(new Error('Gmail access expired'), { code: 'reconnect' });

function loadGis() {
  if (gisLoaded) return gisLoaded;
  gisLoaded = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisLoaded = null; reject(new Error('Could not load Google sign-in')); };
    document.head.appendChild(s);
  });
  return gisLoaded;
}

// The access token (Google gives it for an hour) is kept in this browser until it
// expires, so reopening the app within the hour goes straight to the inbox. Signing
// out removes it. (Never a refresh token: with "Keep me signed in" it stays on the
// server, which hands out fresh access tokens; see refreshFromServer.)
function saveToken(t) {
  token = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); else localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY); // where earlier versions kept it
  } catch { /* private mode */ }
}

/** Silent: reuse a still-valid token from this browser. Returns the address or null. */
export function restore() {
  for (const store of [() => localStorage, () => sessionStorage]) {
    try {
      const t = JSON.parse(store().getItem(TOKEN_KEY));
      if (t && t.expiresAt > Date.now() + 60_000) { token = t; return t.email; }
    } catch { /* ignore */ }
  }
  return null;
}

// Only the desktop app saves an account on the computer (see desktop.js).
export const savedAccount = () => null;
export const lastAccount = () => { try { return localStorage.getItem(HINT_KEY) || ''; } catch { return ''; } };

const flag = (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const setFlag = (k, on) => { try { if (on) localStorage.setItem(k, '1'); else localStorage.removeItem(k); } catch { /* ignore */ } };

// ---- Keep me signed in -------------------------------------------------------
/** Whether this browser asked to stay signed in (the sign-in screen's checkbox starts from it). */
export const keepsSignedIn = () => flag(KEEP_KEY);

// The app's own server functions (Hosting rewrites /api/gmail/* to them).
async function api(path, body, idToken) {
  const res = await fetch(`/api/gmail/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XmlHttpRequest', // Google's code model (popup): the server checks it
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  let json = {};
  try { json = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw Object.assign(new Error(json.error || res.statusText), { status: res.status, code: json.error });
  return json;
}

let refreshing = null;
/**
 * A fresh access token from the server, for the ChiaraMail user signed in in
 * this browser, if they chose to stay signed in. Returns the address or null.
 */
export function refreshFromServer() {
  if (!flag(KEEP_KEY)) return Promise.resolve(null);
  refreshing ||= (async () => {
    try {
      const id = await backend.idToken();
      if (!id) return null;
      const r = await api('token', {}, id);
      saveToken({ accessToken: r.access_token, expiresAt: Date.now() + Number(r.expires_in) * 1000, email: r.email });
      return r.email;
    } catch (e) {
      if (e.status === 404 || e.status === 403) setFlag(KEEP_KEY, false); // no longer kept (revoked, or Gmail access removed)
      return null;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

/** On opening the app: carry on without a tap when the server keeps this account signed in. */
export const resume = () => refreshFromServer();

async function ensureToken() {
  if (token && token.expiresAt > Date.now() + 30_000) return;
  if (await refreshFromServer()) return;
  throw reconnectError();
}

// Google's code model: a one-time code that only the server can exchange (it
// holds the client secret), for an access token now and a refresh token kept there.
async function connectKept({ pick, hint, clientId }) {
  const code = await new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: SCOPES,
      ux_mode: 'popup',
      include_granted_scopes: true,
      select_account: pick,
      login_hint: hint || (pick ? undefined : (lastAccount() || undefined)),
      callback: (r) => (r.error ? reject(Object.assign(new Error(r.error_description || r.error), { code: r.error })) : resolve(r.code)),
      error_callback: (e) => reject(Object.assign(new Error(e.message || e.type), { code: e.type })),
    });
    client.requestCode();
  });
  let r;
  try { r = await api('keep', { code }); } catch (e) {
    if (e.code === 'scope-denied') throw Object.assign(new Error('Gmail access was not granted'), { code: 'scope-denied', email: '' });
    throw e;
  }
  const user = await backend.signInWithGoogleAccessToken(r.access_token);
  try { localStorage.setItem(HINT_KEY, user.email); } catch { /* ignore */ }
  setFlag(CHOOSE_KEY, false);
  if (!r.kept) {
    // This account had allowed ChiaraMail before, without letting it stay signed in,
    // so Google gave no refresh token. Have Google forget that permission; the next
    // tap asks again, and this time Google gives one.
    await new Promise((res) => window.google.accounts.oauth2.revoke(r.access_token, res));
    throw Object.assign(new Error('Confirm once more'), { code: 'keep-again' });
  }
  saveToken({ accessToken: r.access_token, expiresAt: Date.now() + Number(r.expires_in) * 1000, email: user.email });
  setFlag(KEEP_KEY, true);
  return user.email;
}

/**
 * Opens Google's window (must be called from a click). Normally Google reuses
 * the last account without asking; after Sign out, or with { choose: true },
 * it shows the account chooser so another account can be picked.
 */
export async function connect({ choose = false, consent = false, hint = '', keep = false } = {}) {
  const pick = !consent && (choose || flag(CHOOSE_KEY));
  await loadGis();
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID is not set in .env.local');
  if (keep) return connectKept({ pick, hint, clientId });
  const resp = await new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      include_granted_scopes: true,
      hint: hint || (pick ? undefined : (lastAccount() || undefined)),
      callback: (r) => (r.error ? reject(Object.assign(new Error(r.error_description || r.error), { code: r.error })) : resolve(r)),
      error_callback: (e) => reject(Object.assign(new Error(e.message || e.type), { code: e.type })),
    });
    client.requestAccessToken({ prompt: consent ? 'consent' : pick ? 'select_account' : '' });
  });
  if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, GMAIL_SCOPE)) {
    // Signed in without Gmail access (e.g. Google skipped its consent page after
    // the account chooser). Find out which account, so the next tap can ask
    // Google for Gmail access for exactly that account.
    let email = '';
    try {
      const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${resp.access_token}` } });
      if (r.ok) email = (await r.json()).email || '';
    } catch { /* ignore */ }
    throw Object.assign(new Error('Gmail access was not granted'), { code: 'scope-denied', email });
  }
  // Sign in to ChiaraMail (Firebase) with the same Google account.
  const user = await backend.signInWithGoogleAccessToken(resp.access_token);
  await forgetKept(); // signed in without "Keep me signed in": the server keeps nothing any more
  saveToken({ accessToken: resp.access_token, expiresAt: Date.now() + Number(resp.expires_in) * 1000, email: user.email });
  try { localStorage.setItem(HINT_KEY, user.email); } catch { /* ignore */ }
  setFlag(CHOOSE_KEY, false);
  return user.email;
}

/**
 * Sign out: forget this tab's Gmail access and sign out of ChiaraMail. The
 * permission granted to ChiaraMail is kept (revoking it made Google repeat
 * its whole consent screen at every sign-in); it can be removed at
 * myaccount.google.com/permissions. The next sign-in lets you choose the account.
 */
export async function disconnect() {
  await forgetKept();
  saveToken(null);
  setFlag(CHOOSE_KEY, true);
  await backend.signOut();
}

// Sign out, or signing in without "Keep me signed in": Google and the server forget the refresh token.
async function forgetKept() {
  if (!flag(KEEP_KEY)) return;
  setFlag(KEEP_KEY, false);
  try { const id = await backend.idToken(); if (id) await api('forget', {}, id); } catch { /* best effort */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Google limits how much an app may read per user per minute. When it says
// "slow down", wait and try again a few times before giving up.
const isRateLimit = (status, msg) => status === 429 || (status === 403 && /rate ?limit|quota/i.test(msg || ''));

function call(path, opts = {}) {
  return busy(async () => {
    let renewed = false;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await callOnce(path, opts);
      } catch (e) {
        // Google refused the token before its hour was up (e.g. revoked): one fresh try.
        if (e.code === 'reconnect' && !renewed && flag(KEEP_KEY)) { renewed = true; if (await refreshFromServer()) continue; }
        if (!e.rateLimited || attempt >= 4) throw e;
        await sleep(2000 * 2 ** attempt + Math.random() * 1000); // 2s, 4s, 8s, 16s
      }
    }
  });
}

async function callOnce(path, { method = 'GET', query, body, url } = {}) {
  await ensureToken();
  const u = new URL(url || BASE + path);
  if (query) Object.entries(query).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    (Array.isArray(v) ? v : [v]).forEach((x) => u.searchParams.append(k, x));
  });
  const res = await fetch(u, {
    method,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      ...(body && typeof body === 'string' ? {} : body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body && typeof body !== 'string' && !(body instanceof Blob) ? JSON.stringify(body) : body,
  });
  if (res.status === 401) { saveToken(null); throw reconnectError(); }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error.message; } catch { /* ignore */ }
    throw Object.assign(new Error(msg), { status: res.status, rateLimited: isRateLimit(res.status, msg), code: isRateLimit(res.status, msg) ? 'rate-limit' : undefined });
  }
  return res.status === 204 ? null : res.json();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export const getProfile = () => call('/profile');
// The signature set in Gmail's settings for the main address ('' if none).
export async function getGmailSignature() {
  const r = await call('/settings/sendAs');
  const a = (r.sendAs || []).find((x) => x.isDefault) || (r.sendAs || []).find((x) => x.isPrimary);
  return a?.signature || '';
}
export async function listLabels() { return (await call('/labels')).labels || []; }
export const getLabel = (id) => call(`/labels/${encodeURIComponent(id)}`);
/** A new user label, shown in Gmail's label list. If one with this name already exists, that one. */
export async function createLabel(name) {
  try {
    return await call('/labels', { method: 'POST', body: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' } });
  } catch (e) {
    if (e.status !== 409) throw e;
    const found = (await listLabels()).find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (!found) throw e;
    return found;
  }
}

export async function listThreads({ labelId, q, pageToken, max = 25 }) {
  const r = await call('/threads', { query: { labelIds: labelId, q: widenQuery(q), pageToken, maxResults: max } });
  return { ids: (r.threads || []).map((t) => t.id), nextPageToken: r.nextPageToken || null, estimate: r.resultSizeEstimate || 0 };
}

const META = ['From', 'To', 'Subject', 'Date', 'X-ChiaraMail-Content-Pointer'];
export const getThreadsMeta = (ids) => mapLimit(ids, 6, (id) => call(`/threads/${id}`, { query: { format: 'metadata', metadataHeaders: META } }));
export const getThread = (id) => call(`/threads/${id}`, { query: { format: 'full' } });
/** The message exactly as received (RFC 822), base64url — for Forward as attachment. */
export const getRawMessage = (id) => call(`/messages/${id}`, { query: { format: 'raw' } }).then((r) => r.raw);

/** Address headers of recent messages matching a Gmail query (for recipient suggestions). */
export async function recentAddresses(q, max) {
  const r = await call('/messages', { query: { q, maxResults: max } });
  const ids = (r.messages || []).map((m) => m.id);
  // Six at a time, asking only for the address headers; a message that fails is skipped.
  return mapLimit(ids, 6, (id) => call(`/messages/${id}`, {
    query: { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Bcc'], fields: 'internalDate,payload/headers' },
  }).catch(() => null))
    .then((msgs) => msgs.filter(Boolean).map((m) => ({ date: Number(m.internalDate), headers: m.payload?.headers || [] })));
}
export async function getAttachment(messageId, attachmentId) {
  return (await call(`/messages/${messageId}/attachments/${attachmentId}`)).data;
}
export const modifyThread = (id, add = [], remove = []) => call(`/threads/${id}/modify`, { method: 'POST', body: { addLabelIds: add, removeLabelIds: remove } });
// Trashing makes Gmail drop the INBOX label, and untrash does not give it back,
// so remember which threads were in the Inbox when they were deleted.
const WAS_INBOX = 'chiaramail.trashedFromInbox';
const readWasInbox = () => { try { return JSON.parse(localStorage.getItem(WAS_INBOX)) || {}; } catch { return {}; } };
const writeWasInbox = (m) => { try { localStorage.setItem(WAS_INBOX, JSON.stringify(m)); } catch { /* ignore */ } };
const labelsOf = (th) => (th?.messages || []).flatMap((m) => m.labelIds || []);

export async function trashThread(id) {
  let wasInbox = null;
  try { wasInbox = labelsOf(await call(`/threads/${id}`, { query: { format: 'minimal' } })).includes('INBOX'); } catch { /* best effort */ }
  const r = await call(`/threads/${id}/trash`, { method: 'POST' });
  if (wasInbox !== null) { const m = readWasInbox(); m[id] = wasInbox; writeWasInbox(m); }
  return r;
}

/**
 * Restore from Trash to where it was. If we deleted it, we know whether it was
 * in the Inbox. If it was deleted elsewhere, put it in the Inbox unless it is
 * plainly mail you only sent: anything received, or sent to yourself (Gmail
 * gives those an inbox category), goes back to the Inbox.
 */
export async function untrashThread(id) {
  const th = await call(`/threads/${id}/untrash`, { method: 'POST' });
  const m = readWasInbox();
  let toInbox = m[id];
  if (toInbox === undefined) {
    const msgs = th?.messages || [];
    toInbox = !msgs.length || msgs.some((x) => {
      const l = x.labelIds || [];
      return (!l.includes('SENT') && !l.includes('DRAFT')) || l.some((k) => k.startsWith('CATEGORY_'));
    });
  }
  if (toInbox) await modifyThread(id, ['INBOX'], []);
  delete m[id]; writeWasInbox(m);
  return th;
}

// ---- drafts -------------------------------------------------------------------
const b64url = (raw) => btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function upload(...args) { return busy(() => uploadOnce(...args)); }
async function uploadOnce(path, method, meta, raw) {
  await ensureToken();
  const b = `cm_${Date.now()}`;
  const res = await fetch(`https://gmail.googleapis.com/upload/gmail/v1/users/me${path}?uploadType=multipart`, {
    method,
    headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': `multipart/related; boundary=${b}` },
    body: [`--${b}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(meta),
      `--${b}`, 'Content-Type: message/rfc822', '', raw, `--${b}--`, ''].join('\r\n'),
  });
  if (res.status === 401) { saveToken(null); throw reconnectError(); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message || res.statusText);
  return res.json();
}
export async function listDrafts({ pageToken, max = 25 } = {}) {
  const r = await call('/drafts', { query: { pageToken, maxResults: max } });
  return { drafts: r.drafts || [], nextPageToken: r.nextPageToken || null };
}
export const getDraft = (id) => call(`/drafts/${id}`, { query: { format: 'full' } });
export const getDraftsMeta = (ids) => mapLimit(ids, 6, (id) => call(`/drafts/${id}`, { query: { format: 'metadata' } }));
export async function createDraft(raw, threadId) {
  const message = threadId ? { threadId } : {};
  if (raw.length >= 4_000_000) return upload('/drafts', 'POST', { message }, raw);
  return call('/drafts', { method: 'POST', body: { message: { ...message, raw: b64url(raw) } } });
}
export async function updateDraft(id, raw, threadId) {
  const message = threadId ? { threadId } : {};
  if (raw.length >= 4_000_000) return upload(`/drafts/${id}`, 'PUT', { id, message }, raw);
  return call(`/drafts/${id}`, { method: 'PUT', body: { id, message: { ...message, raw: b64url(raw) } } });
}
export const deleteDraft = (id) => call(`/drafts/${id}`, { method: 'DELETE' });
/** The draft ID for a draft message shown in a conversation. */
export async function findDraftId(messageId) {
  let pageToken;
  for (let i = 0; i < 5; i += 1) {
    const r = await call('/drafts', { query: { pageToken, maxResults: 100 } });
    const hit = (r.drafts || []).find((d) => d.message?.id === messageId);
    if (hit) return hit.id;
    if (!r.nextPageToken) return null;
    pageToken = r.nextPageToken;
  }
  return null;
}

/** Sends an RFC 2822 message (ASCII). Returns { id, threadId }. */
export async function sendRaw(raw, threadId) {
  if (raw.length < 4_000_000) {
    const b64url = btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return call('/messages/send', { method: 'POST', body: { raw: b64url, ...(threadId ? { threadId } : {}) } });
  }
  // Large messages (attachments) go through the upload endpoint.
  const b = `cm_${Date.now()}`;
  const body = [
    `--${b}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(threadId ? { threadId } : {}),
    `--${b}`, 'Content-Type: message/rfc822', '', raw, `--${b}--`, '',
  ].join('\r\n');
  await ensureToken();
  const res = await fetch(UPLOAD, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': `multipart/related; boundary=${b}` },
    body,
  });
  if (res.status === 401) { saveToken(null); throw reconnectError(); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message || res.statusText);
  return res.json();
}
