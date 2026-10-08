// Stand-in backend for local testing without Firebase (npm run dev:mock).
// Data lives in this browser's localStorage and the permission checks mirror
// firestore.rules, so the screens behave as they will in production.
export const mode = 'mock';

const DB_KEY = 'chiaramail.mock.db';
const USER_KEY = 'chiaramail.mock.user';
const listeners = new Set();

const load = () => {
  try { return JSON.parse(localStorage.getItem(DB_KEY)) || { messages: {} }; } catch { return { messages: {} }; }
};
const save = (db) => {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  queueMicrotask(() => listeners.forEach((fn) => fn()));
};
window.addEventListener('storage', (e) => {
  if (e.key === DB_KEY) listeners.forEach((fn) => fn());
  if (e.key === USER_KEY) userListeners.forEach((fn) => fn(currentUser()));
});
const subscribe = (fn) => { listeners.add(fn); fn(); return () => listeners.delete(fn); };
const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
const later = (v) => new Promise((r) => setTimeout(() => r(v), 120));

// ---- auth ---------------------------------------------------------------
const userListeners = new Set();
const currentUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } };
const setUser = (u) => {
  if (u) localStorage.setItem(USER_KEY, JSON.stringify(u)); else localStorage.removeItem(USER_KEY);
  userListeners.forEach((fn) => fn(u));
};
const uidFor = (email) => 'uid-' + email.replace(/[^a-z0-9]/g, '-');

export function onUserChanged(cb) {
  userListeners.add(cb);
  setTimeout(() => cb(currentUser()), 0);
  return () => userListeners.delete(cb);
}
// Test mode: the "token" is simply the address.
export async function signInWithGoogleAccessToken(email) {
  const u = { uid: uidFor(email.toLowerCase()), email: email.toLowerCase(), name: '', verified: true };
  setUser(u);
  return u;
}
export const currentMockUser = () => currentUser();
export async function signInWithGoogle() {
  const email = window.prompt('Test mode — which Google address?');
  if (email) setUser({ uid: uidFor(email.toLowerCase()), email: email.toLowerCase(), name: '', verified: true });
}
// In test mode the "link" signs you in straight away.
export async function sendSignInLink(email) {
  await later();
  setUser({ uid: uidFor(email.toLowerCase()), email: email.toLowerCase(), name: '', verified: true });
}
export const isPendingEmailLink = () => false;
export async function completeEmailLink() { return { needsEmail: false }; }
export async function signOut() { setUser(null); }

// ---- rules (mirrors firestore.rules) --------------------------------------
const me = () => currentUser();
const isSender = (m) => !!me() && m.senderUid === me().uid;
const isRecipient = (m) => !!me() && me().verified && m.recipients.includes(me().email);
const canRead = (m) => isSender(m) || isRecipient(m);

const out = (id, m) => {
  const { editions: _e, reads: _r, ...rest } = m;
  return { id, ...rest, createdAt: new Date(m.createdAt), updatedAt: new Date(m.updatedAt) };
};
const byUpdated = (a, b) => b.updatedAt - a.updatedAt;

export function watchSent(uid, cb, onErr) {
  return subscribe(() => {
    if (!me() || me().uid !== uid) return onErr?.(denied());
    const all = load().messages;
    cb(Object.entries(all).filter(([, m]) => m.senderUid === uid).map(([id, m]) => out(id, m)).sort(byUpdated));
  });
}
export function watchReceived(email, cb, onErr) {
  return subscribe(() => {
    if (!me() || me().email !== email) return onErr?.(denied());
    const all = load().messages;
    cb(Object.entries(all).filter(([, m]) => m.recipients.includes(email)).map(([id, m]) => out(id, m)).sort(byUpdated));
  });
}
export function watchMessage(id, cb, onErr) {
  return subscribe(() => {
    const m = load().messages[id];
    if (!m) return cb(null);
    if (!canRead(m)) return onErr?.(denied());
    cb(out(id, m));
  });
}
export async function createMessage(user, { recipients, subject, body, allowForward = false, attachments = [] }) {
  await later();
  if (!me() || !me().verified || me().uid !== user.uid) throw denied();
  const db = load();
  const id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  const now = Date.now();
  db.messages[id] = {
    senderUid: user.uid, senderEmail: user.email, senderName: user.name || '',
    recipients, subject, body, createdAt: now, updatedAt: now, edition: 1, withdrawn: false, allowForward: !!allowForward,
    editions: { 1: { edition: 1, subject, body, savedAt: now } }, reads: {},
  };
  if (attachments.length) db.messages[id].attachments = attachments.map((f) => ({ name: f.name, type: f.type || 'application/octet-stream', size: f.size }));
  save(db);
  return id;
}
// Stand-in for Firebase Storage: ecs/{id}/{i} kept as base64 in localStorage.
const FILES_KEY = 'chiaramail.mock.files';
const loadFiles = () => { try { return JSON.parse(localStorage.getItem(FILES_KEY)) || {}; } catch { return {}; } };
const saveFiles = (f) => localStorage.setItem(FILES_KEY, JSON.stringify(f));
const toB64 = (bytes) => { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
export async function uploadAttachments(id, files) {
  await later();
  const m = load().messages[id];
  if (!m || !isSender(m) || m.withdrawn) throw denied();
  const all = loadFiles();
  files.forEach((f, i) => { all[`${id}/${i}`] = { type: f.type, data: toB64(f.bytes) }; });
  saveFiles(all);
}
export async function getAttachment(id, i) {
  await later();
  const m = load().messages[id];
  if (!m || !canRead(m) || m.withdrawn) throw denied();
  const f = loadFiles()[`${id}/${i}`];
  if (!f) throw Object.assign(new Error('File not found.'), { code: 'storage/object-not-found' });
  return new Blob([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], { type: f.type });
}
const removeFiles = (id) => {
  const all = loadFiles();
  Object.keys(all).filter((k) => k.startsWith(`${id}/`)).forEach((k) => delete all[k]);
  saveFiles(all);
};

export async function saveEdition(id, current, { subject, body }) {
  await later();
  const db = load(); const m = db.messages[id];
  if (!m || !isSender(m) || m.withdrawn) throw denied();
  const next = m.edition + 1; const now = Date.now();
  Object.assign(m, { subject, body, updatedAt: now, edition: next });
  m.editions[next] = { edition: next, subject, body, savedAt: now };
  save(db);
  return next;
}
export async function setAllowForward(id, allow) {
  await later();
  const db = load(); const m = db.messages[id];
  if (!m || !isSender(m) || m.withdrawn) throw denied();
  m.allowForward = !!allow;
  save(db);
}
export async function withdraw(id) {
  await later();
  const db = load(); const m = db.messages[id];
  if (!m || !isSender(m) || m.withdrawn) throw denied();
  Object.assign(m, { withdrawn: true, body: '', updatedAt: Date.now() });
  save(db);
  removeFiles(id);
}
export async function deleteMessage(id) {
  await later();
  const db = load(); const m = db.messages[id];
  if (!m || !isSender(m)) throw denied();
  delete db.messages[id];
  save(db);
  removeFiles(id);
}
export async function listEditions(id) {
  await later();
  const m = load().messages[id];
  if (!m || !isSender(m)) throw denied();
  return Object.values(m.editions).sort((a, b) => b.edition - a.edition)
    .map((e) => ({ ...e, savedAt: new Date(e.savedAt) }));
}
export async function getMyReceipt(id, email) {
  const m = load().messages[id];
  if (!m || !me() || me().email !== email) throw denied();
  const r = m.reads[email];
  return r ? { editionSeen: r.editionSeen, lastReadAt: new Date(r.lastReadAt) } : null;
}
export async function markRead(id, email, edition) {
  const db = load(); const m = db.messages[id];
  if (!m || !isRecipient(m) || me().email !== email) throw denied();
  m.reads[email] = { editionSeen: edition, lastReadAt: Date.now() };
  save(db);
}
export function watchReads(id, cb, onErr) {
  return subscribe(() => {
    const m = load().messages[id];
    if (!m) return;
    if (!isSender(m)) return onErr?.(denied());
    const o = {};
    Object.entries(m.reads).forEach(([k, r]) => { o[k] = { editionSeen: r.editionSeen, lastReadAt: new Date(r.lastReadAt) }; });
    cb(o);
  });
}
