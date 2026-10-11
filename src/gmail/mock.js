// Stand-in Gmail for local testing (npm run dev:mock). Mailboxes live in this
// browser's localStorage; sent messages go through the real MIME builder and a
// real MIME parser, then land in each recipient's stand-in mailbox.
import PostalMime from 'postal-mime';
import * as backend from '@backend';
import { toB64url, bytesToB64, b64ToB64url, parseAddressList } from './mime.js';
import { busy } from '../busy.js';

export const mode = 'mock-gmail';
const KEY = 'chiaramail.mock.gmail';
const SESSION = 'chiaramail.mock.gmailSession';
const later = (v) => busy(() => new Promise((r) => setTimeout(() => r(v), 60)));

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { boxes: {}, seq: 1 }; } catch { return { boxes: {}, seq: 1 }; } };
const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));
const nextId = (s) => (s.seq++).toString(16).padStart(8, '0') + Math.random().toString(16).slice(2, 8);

let me = null;
const box = (s, email) => {
  const k = email.toLowerCase();
  if (!s.boxes[k]) s.boxes[k] = { seeded: false, messages: {}, attachments: {}, labels: [] };
  return s.boxes[k];
};
const mine = (s) => { if (!me) throw Object.assign(new Error('Not connected'), { code: 'reconnect' }); return box(s, me); };

export function restore() {
  try { me = sessionStorage.getItem(SESSION); } catch { me = null; }
  return me;
}
export const lastAccount = () => '';

export async function connect(email) {
  const addr = (email || '').trim().toLowerCase();
  if (!addr) throw new Error('Enter an address');
  await backend.signInWithGoogleAccessToken(addr);
  me = addr;
  sessionStorage.setItem(SESSION, addr);
  const s = load();
  const b = box(s, addr);
  if (!b.seeded) { seed(s, b, addr); b.seeded = true; }
  save(s);
  return addr;
}
export async function disconnect() {
  me = null;
  sessionStorage.removeItem(SESSION);
  await backend.signOut();
}

// ---- seed data -----------------------------------------------------------------
function msgJson(s, b, { threadId, from, to, subject, text, html, labels, minutesAgo, attachments = [], extraHeaders = [] }) {
  const id = nextId(s);
  const parts = [{ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=UTF-8' }], body: { data: toB64url(text), size: text.length } }];
  if (html) parts.push({ mimeType: 'text/html', headers: [], body: { data: toB64url(html), size: html.length } });
  const att = attachments.map((a) => {
    const attId = 'att' + nextId(s);
    b.attachments[attId] = toB64url(a.content);
    return { mimeType: a.mimeType, filename: a.filename, headers: [{ name: 'Content-Disposition', value: `attachment; filename="${a.filename}"` }], body: { attachmentId: attId, size: a.content.length } };
  });
  const body = { mimeType: 'multipart/alternative', headers: [], parts };
  b.messages[id] = {
    id, threadId: threadId || id, labelIds: labels,
    snippet: text.replace(/\s+/g, ' ').slice(0, 120),
    internalDate: String(Date.now() - minutesAgo * 60_000),
    payload: {
      mimeType: att.length ? 'multipart/mixed' : 'multipart/alternative',
      headers: [
        { name: 'From', value: from }, { name: 'To', value: to }, { name: 'Subject', value: subject },
        { name: 'Message-ID', value: `<${id}@mock.chiaramail>` }, ...extraHeaders,
      ],
      parts: att.length ? [body, ...att] : parts,
    },
  };
  return b.messages[id];
}

function seed(s, b, addr) {
  b.labels = [{ id: 'Label_1', name: 'Fractals', type: 'user' }];
  msgJson(s, b, {
    from: 'Fractal Forums Digest <digest@fractalforums.example>', to: addr,
    subject: 'This week: deep zooms and the Mandelbrot set',
    text: 'This week on Fractal Forums: a 10^200 deep zoom, a new colouring algorithm, and the image of the month.',
    html: '<div style="font-family:Georgia,serif;max-width:560px"><h2 style="color:#5b2a86">Fractal Forums Digest</h2><img src="https://images.example.com/zoom.jpg" width="560" height="200" alt="Deep zoom"><p>This week: a <b>10<sup>200</sup> deep zoom</b>, a new colouring algorithm, and the image of the month.</p><p><a href="https://fractalforums.example/digest">Read the digest</a></p></div>',
    labels: ['INBOX', 'UNREAD', 'Label_1', 'CATEGORY_UPDATES'], minutesAgo: 95,
  });
  msgJson(s, b, {
    from: 'Marie Dupont <marie@example.fr>', to: addr,
    subject: 'Liste pour samedi',
    text: 'Bonjour,\n\nVoici la liste pour samedi, en pièce jointe.\n\nÀ bientôt,\nMarie',
    labels: ['INBOX'], minutesAgo: 300,
    attachments: [{ filename: 'liste.txt', mimeType: 'text/plain', content: 'pain\nfromage\nvin rouge\n' }],
  });
  const first = msgJson(s, b, {
    from: 'Paul Martin <paul@atelier.example>', to: addr,
    subject: 'Print sizes for the exhibition',
    text: 'Hi Bob,\n\nCould you send the final print sizes for the three Julia set pieces?\n\nPaul',
    labels: ['INBOX'], minutesAgo: 2000,
  });
  const d = msgJson(s, b, {
    from: `Me <${addr}>`, to: 'Paul Martin <paul@atelier.example>',
    subject: 'Framing quote', text: 'Hi Paul,\n\nCould you also quote for',
    labels: ['DRAFT'], minutesAgo: 600,
  });
  b.drafts = { r_seed: d.id };
  msgJson(s, b, {
    threadId: first.threadId, from: `Me <${addr}>`, to: 'Paul Martin <paul@atelier.example>',
    subject: 'Re: Print sizes for the exhibition',
    text: 'Hi Paul,\n\n60 x 90 cm for all three.\n\nBob',
    labels: ['SENT'], minutesAgo: 1900,
  });
}

// ---- reading ---------------------------------------------------------------------
const SYSTEM = ['INBOX', 'STARRED', 'SENT', 'SPAM', 'TRASH', 'UNREAD', 'IMPORTANT', 'DRAFT'];
export async function listLabels() {
  const s = load();
  return [...SYSTEM.map((id) => ({ id, name: id, type: 'system' })), ...mine(s).labels];
}
function threadsOf(b) {
  const t = {};
  Object.values(b.messages).forEach((m) => { (t[m.threadId] ||= []).push(m); });
  Object.values(t).forEach((list) => list.sort((a, c) => Number(a.internalDate) - Number(c.internalDate)));
  return t;
}
const has = (msgs, l) => msgs.some((m) => m.labelIds.includes(l));
function visible(msgs, labelId) {
  if (labelId === 'TRASH' || labelId === 'SPAM') return has(msgs, labelId);
  if (has(msgs, 'TRASH') && msgs.every((m) => m.labelIds.includes('TRASH'))) return false;
  if (has(msgs, 'SPAM') && msgs.every((m) => m.labelIds.includes('SPAM'))) return false;
  return labelId ? has(msgs, labelId) : true;
}
const text = (m) => JSON.stringify(m.payload.headers) + ' ' + m.snippet;
export async function getLabel(id) {
  const s = load();
  const b = mine(s);
  const threads = Object.values(threadsOf(b)).filter((ms) => visible(ms, id));
  const messagesTotal = Object.values(b.messages).filter((m) => m.labelIds.includes(id)).length;
  return { id, threadsTotal: threads.length, threadsUnread: threads.filter((ms) => has(ms, 'UNREAD')).length, messagesTotal };
}
export async function listThreads({ labelId, q, pageToken, max = 25 }) {
  await later();
  const s = load();
  const needle = (q || '').toLowerCase().replace(/^in:\w+\s*/, '').trim();
  const all = Object.entries(threadsOf(mine(s)))
    .filter(([, ms]) => visible(ms, labelId))
    .filter(([, ms]) => !needle || ms.some((m) => text(m).toLowerCase().includes(needle)))
    .sort(([, a], [, c]) => Number(c[c.length - 1].internalDate) - Number(a[a.length - 1].internalDate));
  const start = Number(pageToken || 0);
  return { ids: all.slice(start, start + max).map(([id]) => id), nextPageToken: start + max < all.length ? String(start + max) : null, estimate: all.length };
}
const threadJson = (b, id) => {
  const msgs = threadsOf(b)[id];
  if (!msgs) throw Object.assign(new Error('Thread not found'), { status: 404 });
  return { id, messages: JSON.parse(JSON.stringify(msgs)) };
};
export async function recentAddresses(q, max) {
  const s = load();
  const want = /in:sent/.test(q) ? 'SENT' : 'INBOX';
  return Object.values(mine(s).messages)
    .filter((m) => m.labelIds.includes(want))
    .sort((a, b) => Number(b.internalDate) - Number(a.internalDate))
    .slice(0, max)
    .map((m) => ({ date: Number(m.internalDate), headers: m.payload.headers }));
}
export async function getThreadsMeta(ids) { const s = load(); return ids.map((id) => threadJson(mine(s), id)); }
export async function getThread(id) { await later(); const s = load(); return threadJson(mine(s), id); }
export async function getAttachment(_messageId, attachmentId) { const s = load(); return mine(s).attachments[attachmentId]; }
export const getProfile = async () => ({ emailAddress: me });

// ---- changing -------------------------------------------------------------------
function modify(id, add, remove) {
  const s = load();
  const b = mine(s);
  Object.values(b.messages).filter((m) => m.threadId === id).forEach((m) => {
    m.labelIds = [...new Set([...m.labelIds.filter((l) => !remove.includes(l)), ...add])];
  });
  save(s);
}
export async function modifyThread(id, add = [], remove = []) { await later(); modify(id, add, remove); }
// Like real Gmail: trash drops INBOX and untrash only removes TRASH; putting it
// back in the Inbox is the app's job (same rule as api.js).
const WAS_INBOX = 'chiaramail.trashedFromInbox';
const readWasInbox = () => { try { return JSON.parse(localStorage.getItem(WAS_INBOX)) || {}; } catch { return {}; } };
const writeWasInbox = (m) => { try { localStorage.setItem(WAS_INBOX, JSON.stringify(m)); } catch { /* ignore */ } };
export async function trashThread(id) {
  await later();
  const was = (threadJson(mine(load()), id)?.messages || []).some((m) => m.labelIds.includes('INBOX'));
  modify(id, ['TRASH'], ['INBOX']);
  const m = readWasInbox(); m[id] = was; writeWasInbox(m);
}
export async function untrashThread(id) {
  await later();
  modify(id, [], ['TRASH']);
  const th = threadJson(mine(load()), id);
  const m = readWasInbox();
  let toInbox = m[id];
  if (toInbox === undefined) {
    toInbox = (th?.messages || []).some((x) => (!x.labelIds.includes('SENT') && !x.labelIds.includes('DRAFT')) || x.labelIds.some((k) => k.startsWith('CATEGORY_')));
  }
  if (toInbox) modify(id, ['INBOX'], []);
  delete m[id]; writeWasInbox(m);
  return th;
}

// ---- drafts ------------------------------------------------------------------------
async function messageFromRaw(s, b, raw, labels, threadId) {
  const p = await PostalMime.parse(raw);
  const id = nextId(s);
  const headers = p.headers.filter((h) => !['content-type', 'content-transfer-encoding', 'mime-version'].includes(h.key))
    .map((h) => ({ name: h.key.replace(/(^|-)([a-z])/g, (_, d, c) => d + c.toUpperCase()), value: h.value }));
  if (!headers.some((h) => h.name === 'From')) headers.unshift({ name: 'From', value: me });
  const parts = [];
  if (p.text) parts.push({ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=UTF-8' }], body: { data: toB64url(p.text), size: p.text.length } });
  const atts = p.attachments.map((a) => {
    const attId = 'att' + nextId(s);
    const bytes = new Uint8Array(a.content);
    b.attachments[attId] = b64ToB64url(bytesToB64(bytes));
    return { mimeType: a.mimeType, filename: a.filename, headers: [{ name: 'Content-Disposition', value: `attachment; filename="${a.filename}"` }], body: { attachmentId: attId, size: bytes.length } };
  });
  b.messages[id] = {
    id, threadId: threadId || id, labelIds: labels, snippet: (p.text || '').replace(/\s+/g, ' ').slice(0, 120),
    internalDate: String(Date.now()),
    payload: { mimeType: 'multipart/mixed', headers, parts: [{ mimeType: 'multipart/alternative', headers: [], parts }, ...atts] },
  };
  return b.messages[id];
}
export async function listDrafts() {
  const s = load(); const b = mine(s);
  const drafts = Object.entries(b.drafts || {})
    .map(([id, mid]) => ({ id, message: { id: mid, threadId: b.messages[mid]?.threadId } }))
    .filter((d) => b.messages[d.message.id])
    .sort((x, y) => Number(b.messages[y.message.id].internalDate) - Number(b.messages[x.message.id].internalDate));
  return { drafts, nextPageToken: null };
}
export async function getDraft(id) {
  await later();
  const s = load(); const b = mine(s);
  const mid = (b.drafts || {})[id];
  if (!mid || !b.messages[mid]) throw Object.assign(new Error('Draft not found'), { status: 404 });
  return { id, message: JSON.parse(JSON.stringify(b.messages[mid])) };
}
export async function getDraftsMeta(ids) { return Promise.all(ids.map(getDraft)); }
export async function createDraft(raw, threadId) {
  await later();
  const s = load(); const b = mine(s);
  const m = await messageFromRaw(s, b, raw, ['DRAFT'], threadId);
  const id = 'r' + nextId(s);
  (b.drafts ||= {})[id] = m.id;
  save(s);
  return { id, message: { id: m.id, threadId: m.threadId } };
}
export async function updateDraft(id, raw, threadId) {
  await later();
  const s = load(); const b = mine(s);
  const old = (b.drafts || {})[id];
  if (!old) throw Object.assign(new Error('Draft not found'), { status: 404 });
  const keepThread = threadId || b.messages[old]?.threadId;
  delete b.messages[old];
  const m = await messageFromRaw(s, b, raw, ['DRAFT'], keepThread);
  b.drafts[id] = m.id;
  save(s);
  return { id, message: { id: m.id, threadId: m.threadId } };
}
export async function deleteDraft(id) {
  await later();
  const s = load(); const b = mine(s);
  const mid = (b.drafts || {})[id];
  if (mid) delete b.messages[mid];
  delete (b.drafts || {})[id];
  save(s);
}
export async function findDraftId(messageId) {
  const s = load(); const b = mine(s);
  return Object.entries(b.drafts || {}).find(([, mid]) => mid === messageId)?.[0] || null;
}

// ---- sending: parse the real RFC 2822 message and deliver it -------------------
export async function sendRaw(raw, threadId) {
  await later();
  const p = await PostalMime.parse(raw);
  const s = load();
  const sender = mine(s);
  const msgIdHeader = `<${nextId(s)}@mock.chiaramail>`;
  const baseHeaders = p.headers.filter((h) => h.key !== 'content-type' && h.key !== 'content-transfer-encoding' && h.key !== 'mime-version')
    .map((h) => ({ name: h.key.replace(/(^|-)([a-z])/g, (_, d, c) => d + c.toUpperCase()), value: h.value }));
  baseHeaders.push({ name: 'Message-ID', value: msgIdHeader });
  // Like Gmail, fill in From with the account's address when it's missing.
  if (!baseHeaders.some((h) => h.name === 'From')) baseHeaders.unshift({ name: 'From', value: me });
  const refs = `${p.inReplyTo || ''} ${(p.headers.find((h) => h.key === 'references') || {}).value || ''}`;

  const deliver = (b, labels, keepBcc, forcedThread) => {
    const id = nextId(s);
    let tid = forcedThread;
    if (!tid) {
      const prev = Object.values(b.messages).find((m) => {
        const mid = (m.payload.headers.find((h) => h.name.toLowerCase() === 'message-id') || {}).value;
        return mid && refs.includes(mid);
      });
      tid = prev ? prev.threadId : id;
    }
    const parts = [];
    if (p.text) parts.push({ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=UTF-8' }], body: { data: toB64url(p.text), size: p.text.length } });
    if (p.html) parts.push({ mimeType: 'text/html', headers: [], body: { data: toB64url(p.html), size: p.html.length } });
    const atts = p.attachments.map((a) => {
      const attId = 'att' + nextId(s);
      const bytes = new Uint8Array(a.content);
      b.attachments[attId] = b64ToB64url(bytesToB64(bytes));
      return { mimeType: a.mimeType, filename: a.filename, headers: [{ name: 'Content-Disposition', value: `attachment; filename="${a.filename}"` }], body: { attachmentId: attId, size: bytes.length } };
    });
    b.messages[id] = {
      id, threadId: tid, labelIds: labels,
      snippet: (p.text || '').replace(/\s+/g, ' ').slice(0, 120),
      internalDate: String(Date.now()),
      payload: {
        mimeType: 'multipart/mixed',
        headers: keepBcc ? baseHeaders : baseHeaders.filter((h) => h.name !== 'Bcc'),
        parts: [{ mimeType: 'multipart/alternative', headers: [], parts }, ...atts],
      },
    };
    return b.messages[id];
  };

  const sent = deliver(sender, ['SENT'], true, threadId || null);
  const rcpts = [...(p.to || []), ...(p.cc || []), ...(p.bcc || [])].map((a) => a.address.toLowerCase());
  [...new Set(rcpts)].forEach((addr) => {
    // Like real Gmail, mail to yourself is ONE message marked both Sent and Inbox.
    if (addr === me && sender === box(s, me)) { sent.labelIds = [...new Set([...sent.labelIds, 'INBOX', 'UNREAD', 'CATEGORY_PERSONAL'])]; return; }
    deliver(box(s, addr), ['INBOX', 'UNREAD'], false, addr === me ? sent.threadId : null);
  });
  save(s);
  return { id: sent.id, threadId: sent.threadId, labelIds: sent.labelIds };
}

export const _debugAddresses = (str) => parseAddressList(str);

// Test hook: lets the browser walkthrough deliver a hand-made (e.g. forged) email.
if (typeof window !== 'undefined') window.__mockGmail = { sendRaw, wait: (ms) => busy(() => new Promise((r) => setTimeout(r, ms))) };
