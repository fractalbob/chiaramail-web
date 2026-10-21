// Desktop app: ChiaraMail's European ECS server (server/), reached through the
// app's own process (desktop/main/ecs.js), with the same functions as
// firebase.js. The person is who their mail account says; the ECS session
// follows by itself (a code emailed to them, picked up from their inbox).
// Until it is in place, or when no ECS server is set up, ECS messages can't be
// sent (ecsReady is false) and settings are kept on this computer.
import { busy } from '../busy.js';

export const mode = 'desktop';
const bridge = window.chiaramailDesktop?.ecs;
/** True once signed in to the ECS server: ECS messages can then be sent and read. */
export let ecsReady = false;
/** True while signing in to the ECS server. */
export let ecsPending = false;

/** Attachments can change with a new edition (the ECS server; not yet the Firebase version). */
export const editAttachments = true;
export const QUOTA = 1024 * 1024 * 1024;
export const MAX_FILE = 25 * 1024 * 1024;
export class QuotaError extends Error {
  constructor(used, need, quota = QUOTA) { super('quota'); this.code = 'quota'; this.used = used; this.need = need; this.quota = quota; }
}

const unwrap = (r) => {
  if (r?.error) throw Object.assign(new Error(r.error.message), r.error);
  return r?.ok;
};
const notReady = () => Object.assign(new Error('ECS server not available'), { code: 'no-server' });
async function api(method, path, opts) {
  if (!bridge?.configured) throw notReady();
  const r = unwrap(await bridge.call(method, path, opts));
  return r?.json !== undefined ? r.json : r?.bytes;
}
const date = (v) => (v ? new Date(v) : null);
const toMessage = (m) => ({ ...m, createdAt: date(m.createdAt), updatedAt: date(m.updatedAt) });

// ---- who is signed in ----------------------------------------------------------
const listeners = new Set();
let user = null; // { uid, email, name, verified }
let localUser = null;
// A new object each time, so the screens notice a change of ECS state too.
const notify = () => listeners.forEach((fn) => fn(user && { ...user }));
const setUser = (u) => { user = u; notify(); };

export function onUserChanged(cb) {
  listeners.add(cb);
  setTimeout(() => cb(user), 0);
  return () => listeners.delete(cb);
}

const lang = () => { try { return localStorage.getItem('chiaramail.lang') || (navigator.language || 'fr').slice(0, 2); } catch { return 'fr'; } };

async function connectEcs(email, name) {
  if (!bridge?.configured) return;
  ecsPending = true;
  notify();
  try {
    let s = null;
    try { s = unwrap(await bridge.session(email)); } catch { /* none */ }
    if (!s) {
      try { s = unwrap(await bridge.signIn(email, lang() === 'en' ? 'en' : 'fr')); } catch { return; }
    }
    if (!s || user?.email !== email) return;
    ecsReady = true;
    user = { ...s, name };
  } finally {
    ecsPending = false;
    notify();
  }
}

/**
 * Called by the mail module once the mail account is open (the name is kept
 * for "signInWithGoogleAccessToken" so the screens need no change).
 */
export async function signInWithGoogleAccessToken(email, name = '') {
  const e = String(email).toLowerCase();
  if (user?.email === e && ecsReady) return user;
  localUser = { uid: `local:${e}`, email: e, name, verified: true };
  ecsReady = false;
  user = localUser;
  queueMicrotask(notify); // may be called while the screens are being drawn
  connectEcs(e, name); // in the background
  return localUser;
}

// Signing out leaves nothing personal here (as in firebase.js).
const KEEP_ON_SIGN_OUT = new Set(['chiaramail.lang', 'chiaramail.folded', 'chiaramail.alwaysImages', 'chiaramail.chooseAccount']);
export async function signOut() {
  ecsReady = false;
  setUser(null);
  for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      const keys = [];
      for (let i = 0; i < store.length; i += 1) keys.push(store.key(i));
      keys.filter((k) => k && k.startsWith('chiaramail.') && !KEEP_ON_SIGN_OUT.has(k)).forEach((k) => store.removeItem(k));
    } catch { /* ignore */ }
  }
}

// Web-only sign-in paths (Google, email links): not used in the desktop app.
export async function signInWithGoogle() { throw notReady(); }
export async function sendSignInLink() { throw notReady(); }
export const isPendingEmailLink = () => false;
export async function completeEmailLink() { return { needsEmail: false }; }

// ---- settings (the signature) ---------------------------------------------------
const PREFS_KEY = 'chiaramail.desktopPrefs';
const localPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)); } catch { return null; } };
export async function getPrefs() {
  if (ecsReady) { try { return await api('GET', '/prefs'); } catch { /* offline: the copy here */ } }
  return localPrefs();
}
export const savePrefs = (_uid, prefs) => busy(async () => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...(localPrefs() || {}), ...prefs })); } catch { /* ignore */ }
  if (ecsReady) await api('PUT', '/prefs', { json: { signature: prefs.signature ?? '' } });
});

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
