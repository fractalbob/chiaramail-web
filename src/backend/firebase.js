// Real backend: Firebase Auth + Cloud Firestore.
import { busy } from '../busy.js';
import { cut } from '../lib.js';
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
  signOut as fbSignOut, connectAuthEmulator, signInWithCredential,
} from 'firebase/auth';

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
});
const auth = getAuth(app);
const EMULATORS = import.meta.env.VITE_USE_EMULATORS === '1';
if (EMULATORS) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

// Firestore and Storage are nearly half the app's code, and the inbox (which comes from
// Gmail) doesn't need them to appear. So they load just after the start, in the background,
// instead of making the start screen wait for them.
let fsLoad = null;
const loadFirestore = () => (fsLoad ||= import('firebase/firestore').then((m) => {
  const db = m.getFirestore(app);
  if (EMULATORS) m.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return { ...m, db, messages: m.collection(db, 'messages'), ecsUsers: m.collection(db, 'ecsUsers') };
}));
let stLoad = null;
const loadStorage = () => (stLoad ||= import('firebase/storage').then((m) => {
  const storage = m.getStorage(app);
  if (EMULATORS) m.connectStorageEmulator(storage, '127.0.0.1', 9199);
  return { ...m, storage };
}));
setTimeout(() => { loadFirestore(); }, 0);
// A live view that starts once Firestore has loaded; the returned stop works before that too.
function live(start) {
  let stop = null;
  let cancelled = false;
  loadFirestore().then((F) => { if (!cancelled) stop = start(F); });
  return () => { cancelled = true; stop?.(); };
}

const EMAIL_KEY = 'chiaramail.emailForSignIn';
export const mode = 'firebase';
export const ecsReady = true; // ECS messages can be sent (the desktop app waits for its server sign-in)
export const ecsPending = false;

const toUser = (u) => u && {
  uid: u.uid,
  email: (u.email || '').toLowerCase(),
  name: u.displayName || '',
  verified: !!u.emailVerified,
};

const toDate = (ts) => (ts && typeof ts.toDate === 'function' ? ts.toDate() : null);

const toMessage = (snap) => {
  const d = snap.data({ serverTimestamps: 'estimate' });
  return {
    id: snap.id,
    ...d,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
};

// ---- auth ---------------------------------------------------------------

export function onUserChanged(cb) {
  return onAuthStateChanged(auth, (u) => cb(toUser(u)));
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, provider);
}

// Used by the mail client: the same Google sign-in that grants Gmail access
// also signs in to ChiaraMail.
export async function signInWithGoogleAccessToken(accessToken) {
  const res = await signInWithCredential(auth, GoogleAuthProvider.credential(null, accessToken));
  return toUser(res.user);
}

export async function sendSignInLink(email, returnPath) {
  const url = new URL(returnPath || '/', window.location.origin).toString();
  await sendSignInLinkToEmail(auth, email, { url, handleCodeInApp: true });
  try { localStorage.setItem(EMAIL_KEY, email); } catch { /* private mode */ }
}

export function isPendingEmailLink() {
  return isSignInWithEmailLink(auth, window.location.href);
}

// Finishes an email-link sign-in. Returns { needsEmail: true } when the link
// was opened on a different device and we must ask which address it was for.
export async function completeEmailLink(emailIfAsked) {
  let email = emailIfAsked;
  if (!email) {
    try { email = localStorage.getItem(EMAIL_KEY); } catch { email = null; }
  }
  if (!email) return { needsEmail: true };
  await signInWithEmailLink(auth, email, window.location.href);
  try { localStorage.removeItem(EMAIL_KEY); } catch { /* ignore */ }
  const clean = new URL(window.location.href);
  ['apiKey', 'oobCode', 'mode', 'lang', 'continueUrl', 'tenantId'].forEach((k) => clean.searchParams.delete(k));
  window.history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
  return { needsEmail: false };
}

// Signing out leaves nothing personal in this browser: ECS keys, the contact
// book, the last account's address, the signature copy and Gmail housekeeping
// lists are all removed. Only plain display settings stay (language, folded
// folders, the remote-images choice, and the flag that makes the next sign-in
// show Google's account chooser).
const KEEP_ON_SIGN_OUT = new Set([
  'chiaramail.lang', 'chiaramail.folded', 'chiaramail.alwaysImages', 'chiaramail.chooseAccount',
]);
function clearBrowserStorage() {
  for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      const keys = [];
      for (let i = 0; i < store.length; i += 1) keys.push(store.key(i));
      keys.filter((k) => k && k.startsWith('chiaramail.') && !KEEP_ON_SIGN_OUT.has(k))
        .forEach((k) => store.removeItem(k));
    } catch { /* storage unavailable (private mode) */ }
  }
}

export async function signOut() {
  await fbSignOut(auth);
  clearBrowserStorage();
}

// ---- messages -----------------------------------------------------------

export function watchSent(uid, cb, onErr) {
  return live(({ query, where, orderBy, onSnapshot, messages }) => onSnapshot(
    query(messages, where('senderUid', '==', uid), orderBy('updatedAt', 'desc')),
    (s) => cb(s.docs.map(toMessage)), onErr));
}

export function watchReceived(email, cb, onErr) {
  return live(({ query, where, orderBy, onSnapshot, messages }) => onSnapshot(
    query(messages, where('recipients', 'array-contains', email), orderBy('updatedAt', 'desc')),
    (s) => cb(s.docs.map(toMessage)), onErr));
}

export function watchMessage(id, cb, onErr) {
  return live(({ onSnapshot, doc, messages }) => onSnapshot(doc(messages, id), (s) => cb(s.exists() ? toMessage(s) : null), onErr));
}

// An ECS message's attachments travel with its body, not with the email:
// they're stored at ecs/{messageId}/{index} and only its readers can fetch them.
const fileRef = (S, id, i) => S.ref(S.storage, `ecs/${id}/${i}`);
const fileMeta = (files) => files.map((f) => ({ name: f.name, type: f.type || 'application/octet-stream', size: f.size }));

// ---- attachment allowance ----------------------------------------------------
// Each sender may keep up to QUOTA bytes of ECS attachments stored at once;
// usage/{uid}.bytes is their running total (enforced in firestore.rules).
export const QUOTA = 1024 * 1024 * 1024;
export const MAX_FILE = 25 * 1024 * 1024;
const usageRef = (F, uid) => F.doc(F.db, 'usage', uid);
const filesTotal = (atts) => (atts || []).reduce((n, a) => n + (a.size || 0), 0);
export async function getUsage(uid) {
  const F = await loadFirestore();
  const s = await F.getDoc(usageRef(F, uid)).catch(() => null);
  return { used: s?.exists() ? s.data().bytes || 0 : 0, quota: QUOTA };
}
// prefs/{uid}: the user's own settings (their email signature), shared by all their devices.
const prefsRef = (F, uid) => F.doc(F.db, 'prefs', uid);
export async function getPrefs(uid) {
  const F = await loadFirestore();
  const s = await F.getDoc(prefsRef(F, uid));
  return s.exists() ? s.data() : null;
}
export const savePrefs = (uid, prefs) => busy(async () => {
  const F = await loadFirestore();
  return F.setDoc(prefsRef(F, uid), { ...prefs, updatedAt: F.serverTimestamp() }, { merge: true });
});
// Thrown when a message's files would go over the allowance.
export class QuotaError extends Error {
  constructor(used, need) { super('quota'); this.code = 'quota'; this.used = used; this.need = need; this.quota = QUOTA; }
}

async function createMessage_(user, { recipients, subject, body, allowForward = false, attachments = [], enc = 0 }) {
  const F = await loadFirestore();
  const { doc, serverTimestamp, writeBatch, runTransaction, db, messages } = F;
  const ref = doc(messages);
  const data = {
    senderUid: user.uid,
    senderEmail: user.email,
    recipients,
    subject,
    body,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    edition: 1,
    withdrawn: false,
    allowForward: !!allowForward,
  };
  if (user.name) data.senderName = cut(user.name, 120);
  if (enc) data.enc = 1; // end-to-end encrypted: subject, body and attachment names are ciphertext
  const edition = { edition: 1, subject, body, savedAt: serverTimestamp() };
  if (!attachments.length) {
    const batch = writeBatch(db);
    batch.set(ref, data);
    batch.set(doc(ref, 'editions', '1'), edition);
    await batch.commit();
    return ref.id;
  }
  // With files: count them against the sender's allowance in the same write.
  data.attachments = fileMeta(attachments);
  data.counted = true;
  const need = filesTotal(data.attachments);
  await runTransaction(db, async (tx) => {
    const u = await tx.get(usageRef(F, user.uid));
    const used = u.exists() ? u.data().bytes || 0 : 0;
    if (used + need > QUOTA) throw new QuotaError(used, need);
    tx.set(usageRef(F, user.uid), { bytes: used + need });
    tx.set(ref, data);
    tx.set(doc(ref, 'editions', '1'), edition);
  });
  return ref.id;
}

// Gives a counted message's files back to the sender's allowance, in the same
// write that withdraws or deletes it. `change(tx, ref)` does that write.
async function freeing(F, id, change) {
  const ref = F.doc(F.messages, id);
  try {
    await F.runTransaction(F.db, async (tx) => {
      const m = await tx.get(ref);
      const d = m.data();
      if (d && d.counted && !d.withdrawn && d.senderUid) {
        const u = await tx.get(usageRef(F, d.senderUid));
        const used = u.exists() ? u.data().bytes || 0 : 0;
        tx.set(usageRef(F, d.senderUid), { bytes: Math.max(0, used - filesTotal(d.attachments)), freed: id });
      }
      change(tx, ref);
    });
  } catch (e) {
    // Never let the allowance stand in the way of withdrawing or deleting.
    if (e?.code === 'permission-denied') {
      const batch = F.writeBatch(F.db);
      change(batch, ref);
      await batch.commit();
    } else throw e;
  }
}

// files: [{ name, type, bytes: Blob | Uint8Array }] in the same order as
// createMessage's attachments. onProgress gets the fraction uploaded (0–1).
async function uploadAttachments_(id, files, onProgress) {
  const S = await loadStorage();
  const total = files.reduce((n, f) => n + (f.bytes.size ?? f.bytes.length), 0) || 1;
  const done = files.map(() => 0);
  await Promise.all(files.map((f, i) => new Promise((resolve, reject) => {
    const task = S.uploadBytesResumable(fileRef(S, id, i), f.bytes, { contentType: f.type || 'application/octet-stream' });
    task.on('state_changed', (snap) => {
      done[i] = snap.bytesTransferred;
      onProgress?.(done.reduce((a, b) => a + b, 0) / total);
    }, reject, resolve);
  })));
}

async function getAttachment_(id, i) {
  const S = await loadStorage();
  return S.getBlob(fileRef(S, id, i));
}

async function removeFiles(id, count) {
  if (!count) return;
  const S = await loadStorage();
  await Promise.all(Array.from({ length: count }, (_, i) => S.deleteObject(fileRef(S, id, i)).catch(() => {})));
}

async function saveEdition_(id, current, { subject, body }) {
  const { doc, writeBatch, serverTimestamp, increment, db, messages } = await loadFirestore();
  const ref = doc(messages, id);
  const next = current.edition + 1;
  const batch = writeBatch(db);
  batch.update(ref, { subject, body, updatedAt: serverTimestamp(), edition: increment(1) });
  batch.set(doc(ref, 'editions', String(next)), { edition: next, subject, body, savedAt: serverTimestamp() });
  await batch.commit();
  return next;
}

async function setAllowForward_(id, allow) {
  const { updateDoc, doc, messages } = await loadFirestore();
  return updateDoc(doc(messages, id), { allowForward: !!allow });
}

async function withdraw_(id) {
  const F = await loadFirestore();
  const snap = await F.getDoc(F.doc(F.messages, id));
  await freeing(F, id, (w, ref) => w.update(ref, { withdrawn: true, body: '', updatedAt: F.serverTimestamp() }));
  await removeFiles(id, snap.data()?.attachments?.length || 0);
}

async function deleteMessage_(id, fileCount) {
  const F = await loadFirestore();
  const { doc, getDoc, getDocs, collection, deleteDoc, messages } = F;
  const ref = doc(messages, id);
  const count = fileCount ?? ((await getDoc(ref).catch(() => null))?.data()?.attachments?.length || 0);
  await removeFiles(id, count);
  const [eds, reads] = await Promise.all([
    getDocs(collection(ref, 'editions')),
    getDocs(collection(ref, 'reads')),
  ]);
  await Promise.all([...eds.docs, ...reads.docs].map((d) => deleteDoc(d.ref)));
  await freeing(F, id, (w, r) => w.delete(r));
}

async function listEditions_(id) {
  const { getDocs, query, collection, doc, orderBy, messages } = await loadFirestore();
  const s = await getDocs(query(collection(doc(messages, id), 'editions'), orderBy('edition', 'desc')));
  return s.docs.map((d) => {
    const e = d.data({ serverTimestamps: 'estimate' });
    return { ...e, savedAt: toDate(e.savedAt) };
  });
}

export async function getMyReceipt(id, email) {
  const { getDoc, doc, messages } = await loadFirestore();
  const s = await getDoc(doc(messages, id, 'reads', email));
  if (!s.exists()) return null;
  const r = s.data();
  return { editionSeen: r.editionSeen, lastReadAt: toDate(r.lastReadAt) };
}

export async function markRead(id, email, edition) {
  const { setDoc, doc, serverTimestamp, messages } = await loadFirestore();
  return setDoc(doc(messages, id, 'reads', email), { lastReadAt: serverTimestamp(), editionSeen: edition });
}

export function watchReads(id, cb, onErr) {
  return live(({ onSnapshot, collection, doc, messages }) => onSnapshot(collection(doc(messages, id), 'reads'), (s) => {
    const out = {};
    s.docs.forEach((d) => {
      const r = d.data({ serverTimestamps: 'estimate' });
      out[d.id] = { editionSeen: r.editionSeen, lastReadAt: toDate(r.lastReadAt) };
    });
    cb(out);
  }, onErr));
}

// ---- sender verification and the ECS directory ------------------------------

// Who really stored an ECS message (verified by their sign-in), or null if this
// reader can't see it. Compared with the email's From to catch forgeries.
const senderCache = new Map();
export function getSender(id) {
  if (!senderCache.has(id)) {
    senderCache.set(id, loadFirestore()
      .then(({ getDoc, doc, messages }) => getDoc(doc(messages, id)))
      .then((s) => (s.exists() ? (s.data().senderEmail || '').toLowerCase() : null))
      .catch(() => null));
  }
  return senderCache.get(id);
}

// ecsUsers/{email}: addresses that have signed in to ChiaraMail. Anyone signed
// in may look up one address; nobody can list them.
export async function registerEcsUser(user) {
  if (!user?.email || !user.verified) return;
  const { doc, getDoc, setDoc, serverTimestamp, ecsUsers } = await loadFirestore();
  const ref = doc(ecsUsers, user.email);
  const s = await getDoc(ref).catch(() => null);
  if (s && !s.exists()) await setDoc(ref, { since: serverTimestamp() }).catch(() => {});
}
const ecsCache = new Map();
export function isEcsUser(email) {
  const e = (email || '').toLowerCase();
  if (!e) return Promise.resolve(false);
  if (!ecsCache.has(e)) {
    ecsCache.set(e, loadFirestore()
      .then(({ getDoc, doc, ecsUsers }) => getDoc(doc(ecsUsers, e)))
      .then((s) => s.exists()).catch(() => false));
  }
  return ecsCache.get(e);
}

// User-visible actions show the busy cursor while they run (see busy.js).
export const createMessage = (...a) => busy(() => createMessage_(...a));
export const uploadAttachments = (...a) => busy(() => uploadAttachments_(...a));
export const getAttachment = (...a) => busy(() => getAttachment_(...a));
export const saveEdition = (...a) => busy(() => saveEdition_(...a));
export const setAllowForward = (...a) => busy(() => setAllowForward_(...a));
export const withdraw = (...a) => busy(() => withdraw_(...a));
export const deleteMessage = (...a) => busy(() => deleteMessage_(...a));
export const listEditions = (...a) => busy(() => listEditions_(...a));
