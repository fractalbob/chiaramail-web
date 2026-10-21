// The reader page (served by the European ECS server at /m/<id>): for
// recipients of ECS messages who don't have the ChiaraMail app. They sign in
// with a 6-digit code emailed to their address, then read the message, which is
// decrypted in their browser with the key from the link (#k=…). The same
// functions as firebase.js and desktop.js, over HTTPS to the same server.
import { busy } from '../busy.js';

export const mode = 'reader';
export let ecsReady = false;
export const ecsPending = false;

/** Attachments can change with a new edition (the ECS server; not yet the Firebase version). */
export const editAttachments = true;
export const QUOTA = 1024 * 1024 * 1024;
export const MAX_FILE = 25 * 1024 * 1024;
export class QuotaError extends Error {
  constructor(used, need, quota = QUOTA) { super('quota'); this.code = 'quota'; this.used = used; this.need = need; this.quota = quota; }
}

const TOKEN = 'chiaramail.readerToken';
const getToken = () => { try { return localStorage.getItem(TOKEN); } catch { return null; } };
const setToken = (t) => { try { if (t) localStorage.setItem(TOKEN, t); else localStorage.removeItem(TOKEN); } catch { /* private window: this visit only */ } };
let memToken = null; // when the browser keeps nothing (private window)
const token = () => getToken() || memToken;

async function api(method, path, { json, bytes, auth = true } = {}) {
  const headers = {};
  const t = auth && token();
  if (t) headers.Authorization = `Bearer ${t}`;
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (bytes !== undefined) { headers['Content-Type'] = 'application/octet-stream'; body = bytes; }
  let r;
  try { r = await fetch(path, { method, headers, body }); } catch (e) {
    throw Object.assign(new Error(e.message || 'Offline'), { code: 'offline' });
  }
  const type = r.headers.get('content-type') || '';
  if (!r.ok) {
    const err = type.includes('json') ? (await r.json().catch(() => ({}))).error || {} : {};
    if (r.status === 401 && auth && t) { memToken = null; setToken(null); ecsReady = false; setUser(null); }
    throw Object.assign(new Error(err.message || r.statusText), { status: r.status, ...err, code: err.code || (r.status === 401 ? 'unauthenticated' : null) });
  }
  if (type.includes('json')) return r.json();
  return new Uint8Array(await r.arrayBuffer());
}
const date = (v) => (v ? new Date(v) : null);
const toMessage = (m) => ({ ...m, createdAt: date(m.createdAt), updatedAt: date(m.updatedAt) });

// ---- who is signed in ----------------------------------------------------------
const listeners = new Set();
let user; // undefined while checking the saved session, then null or { uid, email }
const notify = () => listeners.forEach((fn) => fn(user && { ...user }));
function setUser(u) { user = u; ecsReady = !!u; notify(); }

export function onUserChanged(cb) {
  listeners.add(cb);
  setTimeout(() => cb(user && { ...user }), 0);
  return () => listeners.delete(cb);
}

// The saved session, checked once when the page opens.
(async () => {
  if (!token()) { setUser(null); return; }
  try { setUser(await api('GET', '/me')); } catch { if (user === undefined) setUser(null); }
})();

const lang = () => { try { return localStorage.getItem('chiaramail.lang') || (navigator.language || 'fr').slice(0, 2); } catch { return 'fr'; } };

/** Emails a 6-digit code to the address. Returns { ref, from }. */
export const sendCode = (email) => busy(() => api('POST', '/auth/start', { json: { email: String(email).trim().toLowerCase(), lang: lang() === 'en' ? 'en' : 'fr' }, auth: false }));

/** Signs in with the code from that email. */
export const verifyCode = (email, code) => busy(async () => {
  const r = await api('POST', '/auth/verify', { json: { email: String(email).trim().toLowerCase(), code: String(code) }, auth: false });
  memToken = r.token;
  setToken(r.token);
  setUser(r.user);
  return r.user;
});

const KEEP_ON_SIGN_OUT = new Set(['chiaramail.lang']);
export async function signOut() {
  await api('POST', '/auth/signout').catch(() => {});
  memToken = null;
  setToken(null);
  setUser(null);
  for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      const keys = [];
      for (let i = 0; i < store.length; i += 1) keys.push(store.key(i));
      keys.filter((k) => k && k.startsWith('chiaramail.') && !KEEP_ON_SIGN_OUT.has(k)).forEach((k) => store.removeItem(k));
    } catch { /* ignore */ }
  }
}

// Sign-in paths of the other versions: not used here.
const notReady = () => Object.assign(new Error('Sign in first'), { code: 'unauthenticated' });
const notHere = () => Object.assign(new Error('Not available on this page'), { code: 'not-here' });
export async function signInWithGoogle() { throw notHere(); }
export async function signInWithGoogleAccessToken() { throw notHere(); }
export async function sendSignInLink() { throw notHere(); }
export const isPendingEmailLink = () => false;
export async function completeEmailLink() { return { needsEmail: false }; }

// ---- settings (the signature) ---------------------------------------------------
export async function getPrefs() { return ecsReady ? api('GET', '/prefs').catch(() => null) : null; }
export const savePrefs = (_uid, prefs) => busy(() => api('PUT', '/prefs', { json: { signature: prefs.signature ?? '' } }));

// ---- messages ---------------------------------------------------------------------
export async function getUsage() {
  if (!ecsReady) return { used: 0, quota: QUOTA };
  return api('GET', '/usage');
}

async function createMessage_(u, { recipients, subject, body, allowForward = false, attachments = [], enc = 0 }) {
  if (!ecsReady) throw notReady();
  try {
    const r = await api('POST', '/messages', { json: { recipients, subject, body, allowForward, enc: enc ? 1 : 0, ...(u?.name ? { senderName: u.name.slice(0, 120) } : {}), ...(attachments.length ? { attachments: attachments.map((a) => ({ name: a.name, type: a.type || 'application/octet-stream', size: a.size })) } : {}) } });
    return r.id;
  } catch (e) {
    if (e.code === 'quota') throw new QuotaError(e.used, e.need, e.quota || QUOTA);
    throw e;
  }
}

// slots: where each file goes (from saveEdition); by default 0, 1, 2…
async function uploadAttachments_(id, files, onProgress, slots) {
  const sizes = files.map((f) => f.bytes.size ?? f.bytes.length);
  const all = sizes.reduce((a, b) => a + b, 0) || 1;
  let done = 0;
  for (let i = 0; i < files.length; i += 1) {
    const b = files[i].bytes;
    const bytes = b instanceof Uint8Array ? b : new Uint8Array(await b.arrayBuffer());
    await api('PUT', `/messages/${id}/files/${slots?.[i] ?? i}`, { bytes });
    done += sizes[i];
    onProgress?.(done / all);
  }
}

async function getAttachment_(id, i) {
  const bytes = await api('GET', `/messages/${id}/files/${i}`);
  return new Blob([bytes], { type: 'application/octet-stream' });
}

// Returns { edition, slots }: slots, where to upload the new files, in order.
async function saveEdition_(id, _current, { subject, body, attachments }) {
  try {
    return await api('POST', `/messages/${id}/editions`, { json: { subject, body, ...(attachments ? { attachments } : {}) } });
  } catch (e) {
    if (e.code === 'quota') throw new QuotaError(e.used, e.need, e.quota || QUOTA);
    throw e;
  }
}
const setAllowForward_ = (id, allow) => api('PATCH', `/messages/${id}`, { json: { allowForward: !!allow } });
const withdraw_ = (id) => api('POST', `/messages/${id}/withdraw`);
const deleteMessage_ = (id) => api('DELETE', `/messages/${id}`);
async function listEditions_(id) {
  return (await api('GET', `/messages/${id}/editions`)).map((e) => ({ ...e, savedAt: date(e.savedAt) }));
}

// "Live" views: the server is asked again every few seconds while a message is open.
function poll(fetchOnce, cb, onErr, everyMs) {
  let stopped = false; let last = null; let timer = null;
  const tick = async () => {
    try {
      const v = await fetchOnce();
      const key = JSON.stringify(v);
      if (!stopped && key !== last) { last = key; cb(v); }
    } catch (e) {
      if (!stopped) onErr?.(e);
    }
    if (!stopped) timer = setTimeout(tick, everyMs);
  };
  tick();
  return () => { stopped = true; clearTimeout(timer); };
}

export function watchMessage(id, cb, onErr) {
  return poll(async () => {
    try { return await api('GET', `/messages/${id}`); } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }, (m) => cb(m ? toMessage(m) : null), onErr, 15_000);
}

export function watchReads(id, cb, onErr) {
  return poll(() => api('GET', `/messages/${id}/reads`), (r) => {
    const o = {};
    Object.entries(r || {}).forEach(([k, v]) => { o[k] = { editionSeen: v.editionSeen, lastReadAt: date(v.lastReadAt) }; });
    cb(o);
  }, onErr, 30_000);
}
// Lists of sent and received ECS messages (not used by the mail screens).
export function watchSent(_uid, cb) { cb([]); return () => {}; }
export function watchReceived(_email, cb) { cb([]); return () => {}; }

export async function getMyReceipt(id) {
  const r = await api('GET', `/messages/${id}/reads/me`);
  return r ? { editionSeen: r.editionSeen, lastReadAt: date(r.lastReadAt) } : null;
}
export const markRead = (id, _email, edition) => api('PUT', `/messages/${id}/read`, { json: { edition } });

// ---- sender verification and the ECS directory -------------------------------------
const senderCache = new Map();
export function getSender(id) {
  if (!ecsReady) return Promise.resolve(null);
  if (!senderCache.has(id)) senderCache.set(id, api('GET', `/messages/${id}/sender`).then((r) => (r.senderEmail || '').toLowerCase()).catch(() => null));
  return senderCache.get(id);
}
export async function registerEcsUser() {
  if (ecsReady) await api('POST', '/directory').catch(() => {});
}
const ecsCache = new Map();
export function isEcsUser(email) {
  const e = (email || '').toLowerCase();
  if (!e || !ecsReady) return Promise.resolve(false);
  if (!ecsCache.has(e)) ecsCache.set(e, api('GET', `/directory/${encodeURIComponent(e)}`).then((r) => !!r.ecs).catch(() => false));
  return ecsCache.get(e);
}

export const createMessage = (...a) => busy(() => createMessage_(...a));
export const uploadAttachments = (...a) => busy(() => uploadAttachments_(...a));
export const getAttachment = (...a) => busy(() => getAttachment_(...a));
export const saveEdition = (...a) => busy(() => saveEdition_(...a));
export const setAllowForward = (...a) => busy(() => setAllowForward_(...a));
export const withdraw = (...a) => busy(() => withdraw_(...a));
export const deleteMessage = (...a) => busy(() => deleteMessage_(...a));
export const listEditions = (...a) => busy(() => listEditions_(...a));
export { notify as refreshUser };
