// ECS messages, encrypted end to end: the backend only ever sees ciphertext.
// Messages sent before encryption (no `enc` flag) are read as they are.
import * as backend from '@backend';
import { newKey, encryptText, decryptText, encryptBytes, decryptBytes } from './ecsCrypto.js';

const toBytes = async (b) => (b instanceof Uint8Array ? b : new Uint8Array(await b.arrayBuffer()));

// Returns { id, key }. files: [{ name, type, size, bytes: Blob | Uint8Array }]
export async function createEcs(user, { recipients, subject, body, allowForward, files = [] }, onProgress) {
  const key = newKey();
  const [encSubject, encBody, attachments] = await Promise.all([
    encryptText(key, subject),
    encryptText(key, body),
    Promise.all(files.map(async (f) => ({ name: await encryptText(key, f.name), type: await encryptText(key, f.type || 'application/octet-stream'), size: f.size }))),
  ]);
  const id = await backend.createMessage(user, { recipients, subject: encSubject, body: encBody, allowForward, attachments, enc: 1 });
  try {
    if (files.length) {
      const sealed = await Promise.all(files.map(async (f) => ({ name: '', type: 'application/octet-stream', bytes: await encryptBytes(key, await toBytes(f.bytes)) })));
      await backend.uploadAttachments(id, sealed, onProgress);
    }
  } catch (e) {
    await backend.deleteMessage(id, files.length).catch(() => {});
    throw e;
  }
  return { id, key };
}

// The message as its reader sees it. `locked` when it's encrypted and the key
// is missing or wrong.
export async function openEcs(d, key) {
  if (!d || !d.enc) return d;
  try {
    const [subject, body, attachments] = await Promise.all([
      decryptText(key, d.subject),
      decryptText(key, d.body),
      Promise.all((d.attachments || []).map(async (a) => ({ ...a, name: await decryptText(key, a.name), type: await decryptText(key, a.type) }))),
    ]);
    return { ...d, subject, body, attachments, locked: false };
  } catch {
    return { ...d, subject: '', body: '', attachments: (d.attachments || []).map((a) => ({ ...a, name: '', type: '' })), locked: true };
  }
}

export function watchEcs(id, key, cb, onErr) {
  let seq = 0;
  return backend.watchMessage(id, (d) => {
    const n = ++seq;
    openEcs(d, key).then((x) => { if (n === seq) cb(x); });
  }, onErr);
}

// A new edition. `files` (only where backend.editAttachments): the new list of
// attachments, each { keep: slot } for a file of the current edition or
// { file: { name, type, size, bytes } } for a new one; left out, they don't change.
export async function saveEcsEdition(id, current, { subject, body, files }, key, onProgress) {
  if (!current.enc) return backend.saveEdition(id, current, { subject, body });
  const fresh = (files || []).filter((f) => f.file).map((f) => f.file);
  const attachments = files && await Promise.all(files.map(async (f) => (f.file
    ? { name: await encryptText(key, f.file.name), type: await encryptText(key, f.file.type || 'application/octet-stream'), size: f.file.size }
    : { keep: f.keep })));
  const r = await backend.saveEdition(id, current, { subject: await encryptText(key, subject), body: await encryptText(key, body), ...(attachments ? { attachments } : {}) });
  const edition = typeof r === 'number' ? r : r.edition;
  if (fresh.length) {
    const sealed = await Promise.all(fresh.map(async (f) => ({ name: '', type: 'application/octet-stream', bytes: await encryptBytes(key, await toBytes(f.bytes)) })));
    await backend.uploadAttachments(id, sealed, onProgress, r.slots);
  }
  return edition;
}

export async function listEcsEditions(id, key) {
  const eds = await backend.listEditions(id);
  return Promise.all(eds.map(async (e) => {
    try {
      const attachments = e.attachments && await Promise.all(e.attachments.map(async (a) => ({ ...a, name: await decryptText(key, a.name), type: await decryptText(key, a.type) })));
      return { ...e, subject: await decryptText(key, e.subject), body: await decryptText(key, e.body), ...(attachments ? { attachments } : {}) };
    } catch { return { ...e, subject: '', body: '', attachments: undefined, locked: true }; }
  }));
}

// A stored attachment as a Blob the reader can save.
// i: its position in message.attachments (stored under its slot, when it has one).
export async function getEcsAttachment(id, i, message, key) {
  const a = message.attachments?.[i] || {};
  const blob = await backend.getAttachment(id, Number.isInteger(a.slot) ? a.slot : i);
  if (!message.enc) return blob;
  return new Blob([await decryptBytes(key, await toBytes(blob))], { type: a.type || 'application/octet-stream' });
}
