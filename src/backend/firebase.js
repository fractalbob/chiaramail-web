// Real backend: Firebase Auth + Cloud Firestore.
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
  signOut as fbSignOut, connectAuthEmulator, signInWithCredential,
} from 'firebase/auth';
import {
  getFirestore, connectFirestoreEmulator, collection, doc, query, where,
  orderBy, onSnapshot, writeBatch, serverTimestamp, increment, getDoc,
  getDocs, setDoc, updateDoc, deleteDoc,
} from 'firebase/firestore';

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});
const auth = getAuth(app);
const db = getFirestore(app);

if (import.meta.env.VITE_USE_EMULATORS === '1') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
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

export async function createMessage(user, { recipients, subject, body, allowForward = false }) {
  const ref = doc(messages);
  const batch = writeBatch(db);
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
  batch.set(ref, data);
  batch.set(doc(ref, 'editions', '1'), { edition: 1, subject, body, savedAt: serverTimestamp() });
  await batch.commit();
  return ref.id;
}

export async function saveEdition(id, current, { subject, body }) {
  const ref = doc(messages, id);
  const next = current.edition + 1;
  const batch = writeBatch(db);
  batch.update(ref, { subject, body, updatedAt: serverTimestamp(), edition: increment(1) });
  batch.set(doc(ref, 'editions', String(next)), { edition: next, subject, body, savedAt: serverTimestamp() });
  await batch.commit();
  return next;
}

export function setAllowForward(id, allow) {
  return updateDoc(doc(messages, id), { allowForward: !!allow });
}

export function withdraw(id) {
  return updateDoc(doc(messages, id), { withdrawn: true, body: '', updatedAt: serverTimestamp() });
}

export async function deleteMessage(id) {
  const ref = doc(messages, id);
  const [eds, reads] = await Promise.all([
    getDocs(collection(ref, 'editions')),
    getDocs(collection(ref, 'reads')),
  ]);
  await Promise.all([...eds.docs, ...reads.docs].map((d) => deleteDoc(d.ref)));
  await deleteDoc(ref);
}

export async function listEditions(id) {
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
