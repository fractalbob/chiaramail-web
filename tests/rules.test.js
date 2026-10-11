// Firestore and Storage security-rule tests — run with `npm run test:rules`.
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
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await env.clearStorage(); });

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

// ---- ECS attachments --------------------------------------------------------

const FILES = [{ name: 'agenda.txt', type: 'text/plain', size: 5 }];
const bytes = new Uint8Array([104, 101, 108, 108, 111]);
const store = (u, verified = true) =>
  env.authenticatedContext(u.uid, { email: u.email, email_verified: verified }).storage();
const sum = (fs) => fs.reduce((n, f) => n + f.size, 0);
// A message with files is written together with the sender's raised total.
function sendWithFiles(db, id, files = FILES, before = 0, uid = 'alice', over = {}) {
  const b = writeBatch(db);
  b.set(doc(db, `messages/${id}`), newMessage({ attachments: files, counted: true, ...over }));
  b.set(doc(db, `usage/${uid}`), { bytes: before + sum(files) });
  return b.commit();
}

test('a message may list its attachments, within limits, and never change them', async () => {
  const db = ctx(ALICE);
  await assertSucceeds(sendWithFiles(db, 'm1'));
  await assertFails(setDoc(doc(db, 'messages/m2'), newMessage({ attachments: 'x' })));
  await assertFails(setDoc(doc(db, 'messages/m3'), newMessage({ attachments: [] })));
  await assertFails(sendWithFiles(db, 'm4', Array(21).fill(FILES[0]), 5));
  await assertFails(updateDoc(doc(db, 'messages/m1'), { attachments: [...FILES, ...FILES] }));
});

async function seedWithFile() {
  await assertSucceeds(sendWithFiles(ctx(ALICE), 'm1'));
  await assertSucceeds(store(ALICE).ref('ecs/m1/0').put(bytes, { contentType: 'text/plain' }));
}

test('only the sender uploads, and only the files the message lists', async () => {
  await assertSucceeds(sendWithFiles(ctx(ALICE), 'm1'));
  await assertFails(store(ALICE).ref('ecs/m1/0').put(new Uint8Array(2048))); // bigger than declared
  await assertFails(store(BOB).ref('ecs/m1/0').put(bytes));
  await assertFails(store(ALICE).ref('ecs/m1/1').put(bytes));
  await assertFails(store(ALICE).ref('ecs/m1/x').put(bytes));
  await assertFails(store(ALICE).ref('ecs/nope/0').put(bytes));
  await assertSucceeds(store(ALICE).ref('ecs/m1/0').put(bytes));
});

test('sender and verified recipients can fetch attachments; others cannot', async () => {
  await seedWithFile();
  await assertSucceeds(store(ALICE).ref('ecs/m1/0').getMetadata());
  await assertSucceeds(store(BOB).ref('ecs/m1/0').getMetadata());
  await assertFails(store(BOB, false).ref('ecs/m1/0').getMetadata());
  await assertFails(store(EVE).ref('ecs/m1/0').getMetadata());
  await assertFails(env.unauthenticatedContext().storage().ref('ecs/m1/0').getMetadata());
});

test('withdrawn: nobody can fetch attachments; only the sender deletes them', async () => {
  await seedWithFile();
  await assertFails(store(BOB).ref('ecs/m1/0').delete());
  await assertSucceeds(updateDoc(doc(ctx(ALICE), 'messages/m1'),
    { withdrawn: true, body: '', updatedAt: serverTimestamp() }));
  await assertFails(store(BOB).ref('ecs/m1/0').getMetadata());
  await assertFails(store(ALICE).ref('ecs/m1/0').getMetadata());
  await assertSucceeds(store(ALICE).ref('ecs/m1/0').delete());
});

// ---- Attachment allowance (1 GB per sender) -----------------------------------
test('files count against the sender’s allowance, in the same write', async () => {
  const db = ctx(ALICE);
  // not counted, or counted wrongly: refused
  await assertFails(setDoc(doc(db, 'messages/a'), newMessage({ attachments: FILES })));
  await assertFails(setDoc(doc(db, 'messages/b'), newMessage({ attachments: FILES, counted: true })));
  const wrong = writeBatch(db);
  wrong.set(doc(db, 'messages/c'), newMessage({ attachments: FILES, counted: true }));
  wrong.set(doc(db, 'usage/alice'), { bytes: 1 });
  await assertFails(wrong.commit());
  // counted right: accepted, and the total adds up
  await assertSucceeds(sendWithFiles(db, 'm1'));
  await assertSucceeds(sendWithFiles(db, 'm2', FILES, 5));
  // over 1 GB: refused
  const big = [{ name: 'x', type: 'x', size: 1024 * 1024 * 1024 }];
  await assertFails(sendWithFiles(db, 'm3', big, 10));
  // nobody else can touch or read Alice's total
  await assertFails(getDoc(doc(ctx(BOB), 'usage/alice')));
  await assertFails(setDoc(doc(ctx(BOB), 'usage/alice'), { bytes: 0 }));
  // she can't simply lower it…
  await assertFails(setDoc(doc(db, 'usage/alice'), { bytes: 0 }));
  await assertFails(setDoc(doc(db, 'usage/alice'), { bytes: 5, freed: 'm1' })); // m1 not withdrawn
});

test('withdrawing or deleting a counted message gives its space back, once', async () => {
  const db = ctx(ALICE);
  await assertSucceeds(sendWithFiles(db, 'm1'));
  await assertSucceeds(sendWithFiles(db, 'm2', FILES, 5));
  const w = writeBatch(db);
  w.update(doc(db, 'messages/m1'), { withdrawn: true, body: '', updatedAt: serverTimestamp() });
  w.set(doc(db, 'usage/alice'), { bytes: 5, freed: 'm1' });
  await assertSucceeds(w.commit());
  // not again for the same message
  await assertFails(setDoc(doc(db, 'usage/alice'), { bytes: 0, freed: 'm1' }));
  const d = writeBatch(db);
  d.delete(doc(db, 'messages/m2'));
  d.set(doc(db, 'usage/alice'), { bytes: 0, freed: 'm2' });
  await assertSucceeds(d.commit());
  // and withdrawing never depends on the total
  await assertSucceeds(sendWithFiles(db, 'm3'));
  await assertSucceeds(updateDoc(doc(db, 'messages/m3'), { withdrawn: true, body: '', updatedAt: serverTimestamp() }));
});

test('at most 25 MB per file; several files add up', async () => {
  const big = [{ name: 'v', type: 'video/mp4', size: 30 * 1024 * 1024 }];
  await assertFails(sendWithFiles(ctx(ALICE), 'm1', big));
  const three = [FILES[0], { name: 'b', type: 'x', size: 1000 }, { name: 'c', type: 'x', size: 20 * 1024 * 1024 }];
  await assertSucceeds(sendWithFiles(ctx(ALICE), 'm2', three));
  await assertFails(sendWithFiles(ctx(ALICE), 'm3', [{ name: 'n', type: 'x', size: -5 }, FILES[0]], sum(three)));
});

// ---- ECS directory -----------------------------------------------------------

test('ECS directory: list yourself only; look up one address; never browse', async () => {
  await assertSucceeds(setDoc(doc(ctx(ALICE), 'ecsUsers/alice@example.com'), { since: serverTimestamp() }));
  await assertFails(setDoc(doc(ctx(EVE), 'ecsUsers/bob@example.com'), { since: serverTimestamp() }));
  await assertFails(setDoc(doc(ctx(BOB, false), 'ecsUsers/bob@example.com'), { since: serverTimestamp() }));
  await assertFails(setDoc(doc(ctx(BOB), 'ecsUsers/bob@example.com'), { since: serverTimestamp(), extra: 1 }));
  await assertSucceeds(getDoc(doc(ctx(EVE), 'ecsUsers/alice@example.com')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'ecsUsers/alice@example.com')));
  await assertFails(getDocs(collection(ctx(EVE), 'ecsUsers')));
  await assertFails(updateDoc(doc(ctx(EVE), 'ecsUsers/alice@example.com'), { since: serverTimestamp() }));
});

test('old content/ folder keeps its rule; it opens nothing else', async () => {
  await assertSucceeds(store(EVE).ref('content/x').put(bytes));
  await assertSucceeds(store(EVE).ref('content/x').getMetadata());
  await assertFails(env.unauthenticatedContext().storage().ref('content/x').getMetadata());
  await assertFails(store(EVE).ref('other/x').put(bytes));
  await seedWithFile();
  await assertFails(store(EVE).ref('ecs/m1/0').getMetadata());
});

test('encrypted messages: enc flag must be 1 and can never change', async () => {
  const db = ctx(ALICE);
  const sealed = 'e1.' + 'A'.repeat(1200);
  await assertSucceeds(setDoc(doc(db, 'messages/e1'), newMessage({ enc: 1, subject: sealed.slice(0, 900), body: sealed })));
  await assertFails(setDoc(doc(db, 'messages/e2'), newMessage({ enc: 2 })));
  await assertFails(setDoc(doc(db, 'messages/e3'), newMessage({ enc: true })));
  await assertFails(updateDoc(doc(db, 'messages/e1'), { enc: 0 }));
});
