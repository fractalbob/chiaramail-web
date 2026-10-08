// Recipient suggestions, built from the user's own Gmail: people they've
// written to (Sent) and people who've written to them (Inbox). Kept in this
// browser only, refreshed every few hours. No extra Google permission needed.
import * as gmail from '@gmail';
import { headerMap, parseAddressList } from '../gmail/mime.js';

const KEY = (me) => `chiaramail.contacts.${me}`;
const MAX_AGE = 24 * 3600 * 1000; // rebuilt at most once a day

function load(me) {
  try { return JSON.parse(localStorage.getItem(KEY(me))) || { at: 0, people: {} }; } catch { return { at: 0, people: {} }; }
}
function save(me, book) {
  try { localStorage.setItem(KEY(me), JSON.stringify(book)); } catch { /* full or private mode */ }
}

function note(people, a, kind, date, me) {
  const email = (a.email || '').trim().toLowerCase();
  if (!email.includes('@') || email === me || /no-?reply|mailer-daemon|notifications?@/.test(email)) return;
  const p = people[email] || (people[email] = { email, name: '', sent: 0, received: 0, last: 0 });
  if (a.name && !a.name.includes('@') && (!p.name || kind === 'sent')) p.name = a.name;
  p[kind] += 1;
  p.last = Math.max(p.last, date || 0);
}

// One build at a time per account: the mailbox starts it on connect, and the
// composer joins it instead of starting another.
const inflight = new Map();

/** Refreshes the address book from Gmail if it's stale; returns the list. */
export function refreshContacts(me, force = false) {
  const book = load(me);
  if (!force && Date.now() - book.at < MAX_AGE && Object.keys(book.people).length) return Promise.resolve(Object.values(book.people));
  if (!inflight.has(me)) {
    inflight.set(me, build(me).finally(() => inflight.delete(me)));
  }
  return inflight.get(me);
}

async function build(me) {
  const book = load(me);
  const people = {};
  const [sent, received] = await Promise.all([
    gmail.recentAddresses('in:sent', 80),
    gmail.recentAddresses('in:inbox -category:promotions -category:social', 40),
  ]);
  sent.forEach(({ date, headers }) => {
    const h = headerMap(headers);
    [...parseAddressList(h.to), ...parseAddressList(h.cc), ...parseAddressList(h.bcc)].forEach((a) => note(people, a, 'sent', date, me));
  });
  received.forEach(({ date, headers }) => {
    parseAddressList(headerMap(headers).from).forEach((a) => note(people, a, 'received', date, me));
  });
  // Keep counts from addresses added locally since the last refresh.
  Object.values(book.people).forEach((p) => { if (!people[p.email] && p.local) people[p.email] = p; });
  save(me, { at: Date.now(), people });
  return Object.values(people);
}

export const cachedContacts = (me) => Object.values(load(me).people);

/** Remembers addresses just written to, so they're suggested straight away. */
export function rememberRecipients(me, list) {
  const book = load(me);
  list.forEach((a) => {
    note(book.people, a, 'sent', Date.now(), me);
    const p = book.people[(a.email || '').toLowerCase()];
    if (p) p.local = true;
  });
  save(me, book);
}

const score = (p) => p.sent * 3 + p.received + (Date.now() - p.last < 30 * 86400_000 ? 5 : 0);

/** Best matches for what's being typed: start of the address or of any word in the name. */
export function suggest(contacts, query, exclude = [], limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const skip = new Set(exclude.map((e) => e.toLowerCase()));
  return contacts
    .filter((p) => !skip.has(p.email))
    .filter((p) => p.email.startsWith(q)
      || p.email.split(/[@._-]/).some((w) => w.startsWith(q))
      || (p.name || '').toLowerCase().split(/[\s,.'-]+/).some((w) => w.startsWith(q))
      || (p.name || '').toLowerCase().startsWith(q))
    .sort((a, b) => score(b) - score(a) || b.last - a.last)
    .slice(0, limit);
}
