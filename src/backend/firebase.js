// Real backend: Firebase Auth + Cloud Firestore.
import { busy } from '../busy.js';
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
  signOut as fbSignOut, connectAuthEmulator, signInWithCredential,
} from 'firebase/auth';
import {
  getFirestore, connectFirestoreEmulator, collection, doc, query, where,
  orderBy, onSnapshot, writeBatch, serverTimestamp, increment, getDoc,
  getDocs, setDoc, updateDoc, deleteDoc, runTransaction,
} from 'firebase/firestore';
import {
  getStorage, connectStorageEmulator, ref as sref, uploadBytesResumable, getBlob, deleteObject,
} from 'firebase/storage';

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
});
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

if (import.meta.env.VITE_USE_EMULATORS === '1') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}

const EMAIL_KEY = 'chiaramail.emailForSignIn';
export const mode = 'firebase';

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

export function signOut() {
  return fbSignOut(auth);
}

// ---- messages -----------------------------------------------------------

const messages = collection(db, 'messages');

export function watchSent(uid, cb, onErr) {
  const q = query(messages, where('senderUid', '==', uid), orderBy('updatedAt', 'desc'));
  return onSnapshot(q, (s) => cb(s.docs.map(toMessage)), onErr);
}

export function watchReceived(email, cb, onErr) {
  const q = query(messages, where('recipients', 'array-contains', email), orderBy('updatedAt', 'desc'));
  return onSnapshot(q, (s) => cb(s.docs.map(toMessage)), onErr);
}

export function watchMessage(id, cb, onErr) {
  return onSnapshot(doc(messages, id), (s) => cb(s.exists() ? toMessage(s) : null), onErr);
}

// An ECS message's attachments travel with its body, not with the email:
// they're stored at ecs/{messageId}/{index} and only its readers can fetch them.
const fileRef = (id, i) => sref(storage, `ecs/${id}/${i}`);
const fileMeta = (files) => files.map((f) => ({ name: f.name, type: f.type || 'application/octet-stream', size: f.size }));

// ---- attachment allowance ----------------------------------------------------
// Each sender may keep up to QUOTA bytes of ECS attachments stored at once;
// usage/{uid}.bytes is their running total (enforced in firestore.rules).
export const QUOTA = 1024 * 1024 * 1024;
export const MAX_FILE = 25 * 1024 * 1024;
const usageRef = (uid) => doc(db, 'usage', uid);
const filesTotal = (atts) => (atts || []).reduce((n, a) => n + (a.size || 0), 0);
export async function getUsage(uid) {
  const s = await getDoc(usageRef(uid)).catch(() => null);
  return { used: s?.exists() ? s.data().bytes || 0 : 0, quota: QUOTA };
}
// Thrown when a message's files would go over the allowance.
export class QuotaError extends Error {
  constructor(used, need) { super('quota'); this.code = 'quota'; this.used = used; this.need = need; this.quota = QUOTA; }
}

async function createMessage_(user, { recipients, subject, body, allowForward = false, attachments = [], enc = 0 }) {
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
  if (user.name) data.senderName = user.name.slice(0, 120);
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
    const u = await tx.get(usageRef(user.uid));
    const used = u.exists() ? u.data().bytes || 0 : 0;
    if (used + need > QUOTA) throw new QuotaError(used, need);
    tx.set(usageRef(user.uid), { bytes: used + need });
    tx.set(ref, data);
    tx.set(doc(ref, 'editions', '1'), edition);
  });
  return ref.id;
}

// Gives a counted message's files back to the sender's allowance, in the same
// write that withdraws or deletes it. `change(tx, ref)` does that write.
async function freeing(id, change) {
  const ref = doc(messages, id);
  try {
    await runTransaction(db, async (tx) => {
      const m = await tx.get(ref);
      const d = m.data();
      if (d && d.counted && !d.withdrawn && d.senderUid) {
        const u = await tx.get(usageRef(d.senderUid));
        const used = u.exists() ? u.data().bytes || 0 : 0;
        tx.set(usageRef(d.senderUid), { bytes: Math.max(0, used - filesTotal(d.attachments)), freed: id });
      }
      change(tx, ref);
    });
  } catch (e) {
    // Never let the allowance stand in the way of withdrawing or deleting.
    if (e?.code === 'permission-denied') {
      const batch = writeBatch(db);
      change(batch, ref);
      await batch.commit();
    } else throw e;
  }
}

// files: [{ name, type, bytes: Blob | Uint8Array }] in the same order as
// createMessage's attachments. onProgress gets the fraction uploaded (0–1).
async function uploadAttachments_(id, files, onProgress) {
  const total = files.reduce((n, f) => n + (f.bytes.size ?? f.bytes.length), 0) || 1;
  const done = files.map(() => 0);
  await Promise.all(files.map((f, i) => new Promise((resolve, reject) => {
    const task = uploadBytesResumable(fileRef(id, i), f.bytes, { contentType: f.type || 'application/octet-stream' });
    task.on('state_changed', (snap) => {
      done[i] = snap.bytesTransferred;
      onProgress?.(done.reduce((a, b) => a + b, 0) / total);
    }, reject, resolve);
  })));
}

function getAttachment_(id, i) {
  return getBlob(fileRef(id, i));
}

const removeFiles = (id, count) => Promise.all(
  Array.from({ length: count }, (_, i) => deleteObject(fileRef(id, i)).catch(() => {})),
);

async function saveEdition_(id, current, { subject, body }) {
  const ref = doc(messages, id);
  const next = current.edition + 1;
  const batch = writeBatch(db);
  batch.update(ref, { subject, body, updatedAt: serverTimestamp(), edition: increment(1) });
  batch.set(doc(ref, 'editions', String(next)), { edition: next, subject, body, savedAt: serverTimestamp() });
  await batch.commit();
  return next;
}

function setAllowForward_(id, allow) {
  return updateDoc(doc(messages, id), { allowForward: !!allow });
}

async function withdraw_(id) {
  const snap = await getDoc(doc(messages, id));
  await freeing(id, (w, ref) => w.update(ref, { withdrawn: true, body: '', updatedAt: serverTimestamp() }));
  await removeFiles(id, snap.data()?.attachments?.length || 0);
}

async function deleteMessage_(id, fileCount) {
  const ref = doc(messages, id);
  const count = fileCount ?? ((await getDoc(ref).catch(() => null))?.data()?.attachments?.length || 0);
  await removeFiles(id, count);
  const [eds, reads] = await Promise.all([
    getDocs(collection(ref, 'editions')),
    getDocs(collection(ref, 'reads')),
  ]);
  await Promise.all([...eds.docs, ...reads.docs].map((d) => deleteDoc(d.ref)));
  await freeing(id, (w, r) => w.delete(r));
}

async function listEditions_(id) {
  const s = await getDocs(query(collection(doc(messages, id), 'editions'), orderBy('edition', 'desc')));
  return s.docs.map((d) => {
    const e = d.data({ serverTimestamps: 'estimate' });
    return { ...e, savedAt: toDate(e.savedAt) };
  });
}

export async function getMyReceipt(id, email) {
  const s = await getDoc(doc(messages, id, 'reads', email));
  if (!s.exists()) return null;
  const r = s.data();
  return { editionSeen: r.editionSeen, lastReadAt: toDate(r.lastReadAt) };
}

export function markRead(id, email, edition) {
  return setDoc(doc(messages, id, 'reads', email), { lastReadAt: serverTimestamp(), editionSeen: edition });
}

export function watchReads(id, cb, onErr) {
  return onSnapshot(collection(doc(messages, id), 'reads'), (s) => {
    const out = {};
    s.docs.forEach((d) => {
      const r = d.data({ serverTimestamps: 'estimate' });
      out[d.id] = { editionSeen: r.editionSeen, lastReadAt: toDate(r.lastReadAt) };
    });
    cb(out);
  }, onErr);
}

// ---- sender verification and the ECS directory ------------------------------

// Who really stored an ECS message (verified by their sign-in), or null if this
// reader can't see it. Compared with the email's From to catch forgeries.
const senderCache = new Map();
export function getSender(id) {
  if (!senderCache.has(id)) {
    senderCache.set(id, getDoc(doc(messages, id))
      .then((s) => (s.exists() ? (s.data().senderEmail || '').toLowerCase() : null))
      .catch(() => null));
  }
  return senderCache.get(id);
}

// ecsUsers/{email}: addresses that have signed in to ChiaraMail. Anyone signed
// in may look up one address; nobody can list them.
const ecsUsers = collection(db, 'ecsUsers');
export async function registerEcsUser(user) {
  if (!user?.email || !user.verified) return;
  const ref = doc(ecsUsers, user.email);
  const s = await getDoc(ref).catch(() => null);
  if (s && !s.exists()) await setDoc(ref, { since: serverTimestamp() }).catch(() => {});
}
const ecsCache = new Map();
export function isEcsUser(email) {
  const e = (email || '').toLowerCase();
  if (!e) return Promise.resolve(false);
  if (!ecsCache.has(e)) ecsCache.set(e, getDoc(doc(ecsUsers, e)).then((s) => s.exists()).catch(() => false));
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
