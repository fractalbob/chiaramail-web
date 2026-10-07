// Firestore security-rule tests — run with `npm run test:rules`.
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where,
  orderBy, getDocs, serverTimestamp, increment, writeBatch,
} from 'firebase/firestore';

let env;
const ALICE = { uid: 'alice', email: 'alice@example.com' };
const BOB = { uid: 'bob', email: 'bob@example.com' };
const EVE = { uid: 'eve', email: 'eve@example.com' };

const ctx = (u, verified = true, email = u.email) =>
  env.authenticatedContext(u.uid, { email, email_verified: verified }).firestore();

const newMessage = (over = {}) => ({
  senderUid: 'alice', senderEmail: 'alice@example.com', senderName: 'Alice',
  recipients: ['bob@example.com'], subject: 'Hello', body: 'First edition',
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  edition: 1, withdrawn: false, ...over,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-chiaramail',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

async function seed() {
  await assertSucceeds(setDoc(doc(ctx(ALICE), 'messages/m1'), newMessage()));
}

test('sender can create a message', seed);

test('cannot create as someone else', async () => {
  await assertFails(setDoc(doc(ctx(EVE), 'messages/m1'), newMessage()));
  await assertFails(setDoc(doc(ctx(EVE), 'messages/m1'),
    newMessage({ senderUid: 'eve' }))); // email still alice's
});

test('unverified address cannot send', async () => {
  await assertFails(setDoc(doc(ctx(ALICE, false), 'messages/m1'), newMessage()));
});

test('create rejects bad shapes', async () => {
  const db = ctx(ALICE);
  await assertFails(setDoc(doc(db, 'messages/a'), newMessage({ recipients: [] })));
  await assertFails(setDoc(doc(db, 'messages/b'), newMessage({ edition: 5 })));
  await assertFails(setDoc(doc(db, 'messages/c'), newMessage({ withdrawn: true })));
  await assertFails(setDoc(doc(db, 'messages/d'), newMessage({ body: '' })));
  await assertFails(setDoc(doc(db, 'messages/e'), newMessage({ extra: 1 })));
});

test('recipient can read, outsider cannot', async () => {
  await seed();
  await assertSucceeds(getDoc(doc(ctx(BOB), 'messages/m1')));
  await assertFails(getDoc(doc(ctx(EVE), 'messages/m1')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'messages/m1')));
});

test('recipient match ignores letter case', async () => {
  await seed();
  await assertSucceeds(getDoc(doc(ctx(BOB, true, 'Bob@Example.COM'), 'messages/m1')));
});

test('recipient with unverified address cannot read', async () => {
  await seed();
  await assertFails(getDoc(doc(ctx(BOB, false), 'messages/m1')));
});

test('list queries: sent and received', async () => {
  await seed();
  await assertSucceeds(getDocs(query(collection(ctx(ALICE), 'messages'),
    where('senderUid', '==', 'alice'), orderBy('updatedAt', 'desc'))));
  await assertSucceeds(getDocs(query(collection(ctx(BOB), 'messages'),
    where('recipients', 'array-contains', 'bob@example.com'), orderBy('updatedAt', 'desc'))));
  // Eve can't list Bob's received mail, or everything.
  await assertFails(getDocs(query(collection(ctx(EVE), 'messages'),
    where('recipients', 'array-contains', 'bob@example.com'))));
  await assertFails(getDocs(collection(ctx(EVE), 'messages')));
});

test('sender edits make a new edition', async () => {
  await seed();
  const ref = doc(ctx(ALICE), 'messages/m1');
  await assertSucceeds(updateDoc(ref, {
    body: 'Second edition', updatedAt: serverTimestamp(), edition: increment(1),
  }));
  await assertFails(updateDoc(ref, { body: 'Skip', updatedAt: serverTimestamp(), edition: 7 }));
  await assertFails(updateDoc(ref, {
    recipients: ['eve@example.com'], updatedAt: serverTimestamp(), edition: increment(1),
  }));
});

test('recipients and outsiders cannot edit or delete', async () => {
  await seed();
  for (const u of [BOB, EVE]) {
    const ref = doc(ctx(u), 'messages/m1');
    await assertFails(updateDoc(ref, {
      body: 'hacked', updatedAt: serverTimestamp(), edition: increment(1),
    }));
    await assertFails(deleteDoc(ref));
  }
});

test('withdraw wipes the text and is final', async () => {
  await seed();
  const ref = doc(ctx(ALICE), 'messages/m1');
  await assertFails(updateDoc(ref, { withdrawn: true, updatedAt: serverTimestamp() })); // text kept
  await assertSucceeds(updateDoc(ref, { withdrawn: true, body: '', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, {
    withdrawn: false, body: 'back', updatedAt: serverTimestamp(), edition: increment(1),
  }));
  await assertSucceeds(getDoc(doc(ctx(BOB), 'messages/m1'))); // still sees "withdrawn"
});

test('editions are written with the message and visible to the sender only', async () => {
  const db = ctx(ALICE);
  const b = writeBatch(db);
  b.set(doc(db, 'messages/m1'), newMessage());
  b.set(doc(db, 'messages/m1/editions/1'),
    { edition: 1, subject: 'Hello', body: 'First edition', savedAt: serverTimestamp() });
  await assertSucceeds(b.commit());
  // A second edition goes in the same batch as the edit.
  const b2 = writeBatch(db);
  b2.update(doc(db, 'messages/m1'),
    { body: 'Second', updatedAt: serverTimestamp(), edition: increment(1) });
  b2.set(doc(db, 'messages/m1/editions/2'),
    { edition: 2, subject: 'Hello', body: 'Second', savedAt: serverTimestamp() });
  await assertSucceeds(b2.commit());
  // An edition that doesn't match the message is refused.
  await assertFails(setDoc(doc(db, 'messages/m1/editions/9'),
    { edition: 9, subject: '', body: 'fake', savedAt: serverTimestamp() }));
  await assertSucceeds(getDocs(collection(db, 'messages/m1/editions')));
  await assertFails(getDocs(collection(ctx(BOB), 'messages/m1/editions')));
  await assertFails(setDoc(doc(ctx(BOB), 'messages/m1/editions/2'),
    { edition: 2, subject: '', body: 'fake', savedAt: serverTimestamp() }));
});

test('read receipts: recipient writes own, sender reads all', async () => {
  await seed();
  const receipt = { lastReadAt: serverTimestamp(), editionSeen: 1 };
  await assertSucceeds(setDoc(doc(ctx(BOB), 'messages/m1/reads/bob@example.com'), receipt));
  await assertFails(setDoc(doc(ctx(BOB), 'messages/m1/reads/carol@example.com'), receipt));
  await assertFails(setDoc(doc(ctx(EVE), 'messages/m1/reads/eve@example.com'), receipt));
  await assertSucceeds(getDocs(collection(ctx(ALICE), 'messages/m1/reads')));
  await assertFails(getDocs(collection(ctx(BOB), 'messages/m1/reads')));
  await assertSucceeds(getDoc(doc(ctx(BOB), 'messages/m1/reads/bob@example.com')));
});

test('old ChiaraMail users/ collection keeps its original open rules', async () => {
  const anon = env.unauthenticatedContext().firestore();
  await assertSucceeds(setDoc(doc(anon, 'users/device1'), { 'Device ID': 'abc' }));
  await assertSucceeds(getDoc(doc(anon, 'users/device1')));
});

test('forwarding permission: set at sending, switched by the sender only', async () => {
  await assertSucceeds(setDoc(doc(ctx(ALICE), 'messages/f1'), newMessage({ allowForward: false })));
  await assertFails(setDoc(doc(ctx(ALICE), 'messages/f2'), newMessage({ allowForward: 'yes' })));
  const ref = doc(ctx(ALICE), 'messages/f1');
  await assertSucceeds(updateDoc(ref, { allowForward: true }));            // no new edition needed
  await assertFails(updateDoc(ref, { allowForward: 1 }));
  await assertFails(updateDoc(doc(ctx(BOB), 'messages/f1'), { allowForward: false }));
  await assertFails(updateDoc(ref, { allowForward: false, body: 'sneaky' })); // can't slip an edit in
  await assertSucceeds(updateDoc(ref, { withdrawn: true, body: '', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { allowForward: false }));               // final once withdrawn
});

test('sender can delete the message', async () => {
  await seed();
  await assertSucceeds(deleteDoc(doc(ctx(ALICE), 'messages/m1')));
});
