// Real Gmail: Google sign-in for a Gmail access token (Google Identity
// Services), then the Gmail REST API, straight from the browser. Nothing is
// stored on any server except the content of ChiaraMail's own ECS messages.
import * as backend from '@backend';

export const mode = 'gmail';
const SCOPES = 'openid email profile https://www.googleapis.com/auth/gmail.modify';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const UPLOAD = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart';
const TOKEN_KEY = 'chiaramail.gmailToken';
const HINT_KEY = 'chiaramail.lastAccount';

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

function saveToken(t) {
  token = t;
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t)); else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode */ }
}

/** Silent: reuse this tab's still-valid token. Returns the address or null. */
export function restore() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY));
    if (t && t.expiresAt > Date.now() + 60_000) { token = t; return t.email; }
  } catch { /* ignore */ }
  return null;
}

export const lastAccount = () => { try { return localStorage.getItem(HINT_KEY) || ''; } catch { return ''; } };

/** Opens Google's window (must be called from a click). */
export async function connect() {
  await loadGis();
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID is not set in .env.local');
  const resp = await new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      include_granted_scopes: true,
      hint: lastAccount() || undefined,
      callback: (r) => (r.error ? reject(Object.assign(new Error(r.error_description || r.error), { code: r.error })) : resolve(r)),
      error_callback: (e) => reject(Object.assign(new Error(e.message || e.type), { code: e.type })),
    });
    client.requestAccessToken({ prompt: '' });
  });
  if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, GMAIL_SCOPE)) {
    throw Object.assign(new Error('Gmail access was not granted'), { code: 'scope-denied' });
  }
  // Sign in to ChiaraMail (Firebase) with the same Google account.
  const user = await backend.signInWithGoogleAccessToken(resp.access_token);
  saveToken({ accessToken: resp.access_token, expiresAt: Date.now() + Number(resp.expires_in) * 1000, email: user.email });
  try { localStorage.setItem(HINT_KEY, user.email); } catch { /* ignore */ }
  return user.email;
}

export async function disconnect() {
  const t = token?.accessToken;
  saveToken(null);
  try { if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => {}); } catch { /* ignore */ }
  await backend.signOut();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Google limits how much an app may read per user per minute. When it says
// "slow down", wait and try again a few times before giving up.
const isRateLimit = (status, msg) => status === 429 || (status === 403 && /rate ?limit|quota/i.test(msg || ''));

async function call(path, opts = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await callOnce(path, opts);
    } catch (e) {
      if (!e.rateLimited || attempt >= 4) throw e;
      await sleep(2000 * 2 ** attempt + Math.random() * 1000); // 2s, 4s, 8s, 16s
    }
  }
}

async function callOnce(path, { method = 'GET', query, body, url } = {}) {
  if (!token || token.expiresAt < Date.now() + 30_000) throw reconnectError();
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
export async function listLabels() { return (await call('/labels')).labels || []; }
export const getLabel = (id) => call(`/labels/${encodeURIComponent(id)}`);

export async function listThreads({ labelId, q, pageToken, max = 25 }) {
  const r = await call('/threads', { query: { labelIds: labelId, q, pageToken, maxResults: max } });
  return { ids: (r.threads || []).map((t) => t.id), nextPageToken: r.nextPageToken || null };
}

const META = ['From', 'To', 'Subject', 'Date', 'X-ChiaraMail-Content-Pointer'];
export const getThreadsMeta = (ids) => mapLimit(ids, 6, (id) => call(`/threads/${id}`, { query: { format: 'metadata', metadataHeaders: META } }));
export const getThread = (id) => call(`/threads/${id}`, { query: { format: 'full' } });

/** Address headers of recent messages matching a Gmail query (for recipient suggestions). */
export async function recentAddresses(q, max) {
  const r = await call('/messages', { query: { q, maxResults: max } });
  const ids = (r.messages || []).map((m) => m.id);
  // Gently: two at a time, so building suggestions never crowds out reading mail.
  return mapLimit(ids, 2, (id) => call(`/messages/${id}`, { query: { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Bcc'] } }))
    .then((msgs) => msgs.map((m) => ({ date: Number(m.internalDate), headers: m.payload?.headers || [] })));
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
async function upload(path, method, meta, raw) {
  if (!token || token.expiresAt < Date.now() + 30_000) throw reconnectError();
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
  if (!token || token.expiresAt < Date.now() + 30_000) throw reconnectError();
  const res = await fetch(UPLOAD, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': `multipart/related; boundary=${b}` },
    body,
  });
  if (res.status === 401) { saveToken(null); throw reconnectError(); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message || res.statusText);
  return res.json();
}
