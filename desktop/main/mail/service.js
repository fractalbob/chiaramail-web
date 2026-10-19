// ChiaraMail desktop: any mail provider over IMAP and SMTP, presented to the
// app with the same functions and data shapes as the Gmail API (src/gmail/api.js),
// so every screen works unchanged.
//
//   Gmail idea           here
//   label INBOX/SENT/…   the folder with that role (special-use flag, or its usual name)
//   user label           any other folder (several "labels" = copies in several folders)
//   UNREAD / STARRED     the \Seen / \Flagged flags; IMPORTANT = the $Important keyword
//   archive              move from the Inbox to the Archive folder (created if needed)
//   thread               messages linked by Message-ID / In-Reply-To / References
//
// Mail is read straight from the provider; only a small index of headers and
// flags is kept on this computer (in dataDir) to build conversations quickly.
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import addressparser from 'nodemailer/lib/addressparser';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { parseHeaders, headerValue, msgIds } from './headers.js';
import { toPayload, leaves, isTextBody } from './payload.js';
import { parseQuery } from './query.js';

const sha = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
const META = ['from', 'to', 'cc', 'bcc', 'reply-to', 'subject', 'date', 'message-id', 'in-reply-to', 'references', 'x-chiaramail-content-pointer', 'content-type'];
const SPECIAL = { '\\Inbox': 'INBOX', '\\Sent': 'SENT', '\\Drafts': 'DRAFT', '\\Trash': 'TRASH', '\\Junk': 'SPAM', '\\Archive': 'ARCHIVE' };
const BY_NAME = [
  ['SENT', /^(sent|sent items|sent messages|sent mail|envoy[ée]s|[ée]l[ée]ments envoy[ée]s|messages envoy[ée]s)$/i],
  ['DRAFT', /^(drafts?|brouillons?)$/i],
  ['TRASH', /^(trash|deleted|deleted items|deleted messages|corbeille|bin)$/i],
  ['SPAM', /^(junk|spam|junk e-?mail|bulk mail|courrier ind[ée]sirable|ind[ée]sirables?|pourriel)$/i],
  ['ARCHIVE', /^(archives?)$/i],
];
// Where a message "lives" when it is in several folders (shown as several labels).
const RANK = { INBOX: 0, USER: 1, ARCHIVE: 2, SENT: 3, DRAFT: 4, SPAM: 5, TRASH: 6 };
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const streamToBuffer = async (s) => { const c = []; for await (const x of s) c.push(x); return Buffer.concat(c); };
const byDate = (a, b) => (a.meta.date - b.meta.date) || ((a.meta.hdate || 0) - (b.meta.hdate || 0));
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export class MailService {
  /**
   * email, name: the account's address and display name.
   * imap/smtp: { host, port, secure }; auth: { user, pass } (shared by both unless smtpAuth).
   * dataDir: where the index is kept. saveSent: append sent mail to Sent (most IMAP providers don't do it themselves).
   */
  constructor({ email, name = '', imap, smtp, auth, smtpAuth, dataDir, saveSent = true, logger = false }) {
    this.email = email.toLowerCase();
    this.name = name;
    this.opts = { imap, smtp, auth, smtpAuth: smtpAuth || auth, logger };
    this.saveSent = saveSent;
    this.file = join(dataDir, `index-${sha(this.email)}.json`);
    this.dataDir = dataDir;
    this.client = null;
    this.folders = []; // [{ path, name, role, delimiter }]
    this.idx = { version: 1, folders: {}, trashedFrom: {} };
    this.lastSync = 0;
    this.saveTimer = null;
  }

  // ---- connection ------------------------------------------------------------
  async conn() {
    if (this.client?.usable) return this.client;
    const c = new ImapFlow({ ...this.opts.imap, auth: this.opts.auth, logger: this.opts.logger, emitLogs: false });
    c.on('error', () => {}); // a dropped connection is reopened on the next call
    await c.connect();
    this.client = c;
    return c;
  }

  async inBox(path, fn) {
    const c = await this.conn();
    const lock = await c.getMailboxLock(path);
    try { return await fn(c); } finally { lock.release(); }
  }

  /** Checks the address and password; loads the folder list and the saved index. */
  async open() {
    await mkdir(this.dataDir, { recursive: true });
    try { const saved = JSON.parse(await readFile(this.file, 'utf8')); if (saved.version === 1) this.idx = saved; } catch { /* first run */ }
    await this.conn();
    await this.loadFolders();
    return this.email;
  }

  async close() {
    await this.flush();
    try { await this.client?.logout(); } catch { /* already closed */ }
    this.client = null;
  }

  async verifySmtp() {
    const t = this.transport();
    try { await t.verify(); } finally { t.close(); }
  }

  transport() {
    return nodemailer.createTransport({ ...this.opts.smtp, auth: this.opts.smtpAuth, logger: false });
  }

  // ---- folders ---------------------------------------------------------------
  async loadFolders() {
    const c = await this.conn();
    const list = await c.list();
    const out = [];
    for (const f of list) {
      const flags = new Set([...(f.flags || [])].map(String));
      if (flags.has('\\Noselect') || flags.has('\\NonExistent')) continue;
      if (f.specialUse === '\\All' || f.specialUse === '\\Flagged' || f.specialUse === '\\Important') continue; // Gmail-style virtual folders
      let role = f.path.toUpperCase() === 'INBOX' ? 'INBOX' : SPECIAL[f.specialUse] || null;
      if (!role) {
        const leaf = f.path.split(f.delimiter || '/').pop();
        role = (BY_NAME.find(([, re]) => re.test(leaf)) || [])[0] || null;
        if (role && out.some((x) => x.role === role)) role = null; // first match wins
      }
      // "INBOX/Work" or "INBOX.Work" (servers that nest everything under INBOX) is shown as "Work".
      let name = f.path;
      const d = f.delimiter || '/';
      if (role !== 'INBOX' && name.toUpperCase().startsWith(`INBOX${d}`)) name = name.slice(6);
      out.push({ path: f.path, name: name.split(d).join('/'), role: role || 'USER', delimiter: d });
    }
    // A special-use flag beats a guessed name: keep one folder per role.
    const seen = new Set();
    for (const f of out) {
      if (f.role === 'USER') continue;
      if (seen.has(f.role)) f.role = 'USER'; else seen.add(f.role);
    }
    this.folders = out;
    return out;
  }

  pathOf(role) { return this.folders.find((f) => f.role === role)?.path || null; }
  roleOf(path) { return this.folders.find((f) => f.path === path)?.role || 'USER'; }
  labelIdOf(path) {
    const f = this.folders.find((x) => x.path === path);
    if (!f) return null;
    if (f.role === 'USER') return `Label_${Buffer.from(f.path).toString('base64url')}`;
    return f.role === 'ARCHIVE' ? null : f.role;
  }
  pathOfLabel(id) {
    if (id?.startsWith('Label_')) return Buffer.from(id.slice(6), 'base64url').toString();
    return this.pathOf(id);
  }

  async ensureFolder(role, name) {
    let p = this.pathOf(role);
    if (p) return p;
    const c = await this.conn();
    const d = this.folders[0]?.delimiter || '/';
    const inboxNested = this.folders.some((f) => f.path.toUpperCase().startsWith(`INBOX${d}`));
    p = inboxNested ? `INBOX${d}${name}` : name;
    try { await c.mailboxCreate(p); } catch (e) { if (!/exist/i.test(e.responseText || e.message)) throw e; }
    await this.loadFolders();
    const f = this.folders.find((x) => x.path === p);
    if (f) f.role = role;
    return p;
  }

  // ---- index -----------------------------------------------------------------
  saveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.flush().catch(() => {}); }, 500);
  }

  async flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.idx));
    await rename(tmp, this.file);
  }

  metaOf(m) {
    const all = parseHeaders(m.headers);
    const h = all.filter((x) => META.includes(x.name.toLowerCase()));
    return {
      uid: m.uid,
      mid: msgIds(headerValue(h, 'message-id'))[0] || '',
      refs: msgIds(headerValue(h, 'references')),
      irt: msgIds(headerValue(h, 'in-reply-to'))[0] || '',
      date: m.internalDate ? new Date(m.internalDate).getTime() : Date.now(),
      hdate: Date.parse(headerValue(h, 'date')) || 0, // breaks ties between messages that arrived in the same second
      flags: [...(m.flags || [])],
      size: m.size || 0,
      h,
    };
  }

  /** Brings the index up to date with the server: new, removed and re-flagged messages. */
  async sync({ force = false, paths } = {}) {
    if (!force && !paths && Date.now() - this.lastSync < 10_000) return;
    if (!this.folders.length) await this.loadFolders();
    const c = await this.conn();
    for (const f of this.folders) {
      if (paths && !paths.includes(f.path)) continue;
      let st;
      try { st = await c.status(f.path, { uidNext: true, uidValidity: true, messages: true }); } catch { continue; }
      let fx = this.idx.folders[f.path];
      if (!fx || String(fx.uidValidity) !== String(st.uidValidity)) {
        fx = { uidValidity: String(st.uidValidity), uidNext: 0, msgs: {} };
        this.idx.folders[f.path] = fx;
      }
      if (!st.messages) { fx.msgs = {}; fx.uidNext = Number(st.uidNext || 0); continue; }
      await this.inBox(f.path, async (cc) => {
        const uids = (await cc.search({ all: true }, { uid: true })) || [];
        const now = new Set(uids.map(String));
        for (const u of Object.keys(fx.msgs)) if (!now.has(u)) delete fx.msgs[u];
        const fresh = uids.filter((u) => !fx.msgs[u]).sort((a, b) => b - a); // newest first
        for (const part of chunks(fresh, 400)) {
          for await (const m of cc.fetch(part, { uid: true, flags: true, internalDate: true, size: true, headers: META }, { uid: true })) {
            fx.msgs[m.uid] = this.metaOf(m);
          }
        }
        if (uids.length) {
          for await (const m of cc.fetch('1:*', { uid: true, flags: true })) {
            if (fx.msgs[m.uid]) fx.msgs[m.uid].flags = [...(m.flags || [])];
          }
        }
        fx.uidNext = Number(st.uidNext || 0);
      });
    }
    // Forget folders that no longer exist.
    for (const p of Object.keys(this.idx.folders)) if (!this.folders.some((f) => f.path === p)) delete this.idx.folders[p];
    if (!paths) this.lastSync = Date.now();
    this.saveSoon();
  }

  // ---- the Gmail-shaped view ---------------------------------------------------
  /** Every message once (copies in several folders merged), grouped into threads. */
  view() {
    const byKey = new Map();
    for (const [path, fx] of Object.entries(this.idx.folders)) {
      const role = this.roleOf(path);
      for (const meta of Object.values(fx.msgs)) {
        const key = meta.mid || `${path}#${fx.uidValidity}#${meta.uid}`;
        let e = byKey.get(key);
        if (!e) { e = { key, id: `m${sha(key)}`, locs: [] }; byKey.set(key, e); }
        e.locs.push({ path, uid: meta.uid, role, meta });
      }
    }
    const entries = [...byKey.values()];
    for (const e of entries) {
      e.locs.sort((a, b) => RANK[a.role] - RANK[b.role]);
      e.primary = e.locs[0];
      e.meta = e.primary.meta;
      e.labels = this.labelsOf(e);
    }
    // Thread roots: References' first ID; else follow In-Reply-To through known messages.
    const byMid = new Map(entries.filter((e) => e.meta.mid).map((e) => [e.meta.mid, e]));
    const rootOf = (e, depth = 0) => {
      if (e.root) return e.root;
      const m = e.meta;
      let r;
      if (m.refs.length) r = m.refs[0];
      else if (m.irt && byMid.has(m.irt) && depth < 50) r = rootOf(byMid.get(m.irt), depth + 1);
      else r = m.irt || m.mid || e.key;
      e.root = r;
      return r;
    };
    const threads = new Map();
    for (const e of entries) {
      e.threadId = `t${sha(rootOf(e))}`;
      let t = threads.get(e.threadId);
      if (!t) { t = { id: e.threadId, msgs: [] }; threads.set(e.threadId, t); }
      t.msgs.push(e);
    }
    for (const t of threads.values()) {
      t.msgs.sort(byDate);
      t.latest = t.msgs[t.msgs.length - 1].meta;
    }
    return { entries, byId: new Map(entries.map((e) => [e.id, e])), threads };
  }

  labelsOf(e) {
    const l = new Set();
    for (const loc of e.locs) { const id = this.labelIdOf(loc.path); if (id) l.add(id); }
    const flags = new Set(e.primary.meta.flags);
    if (!flags.has('\\Seen') && e.primary.role !== 'DRAFT' && e.primary.role !== 'SENT') l.add('UNREAD');
    if (flags.has('\\Flagged')) l.add('STARRED');
    if (flags.has('$Important') || flags.has('Important')) l.add('IMPORTANT');
    return [...l];
  }

  static visible(msgs, labelId) {
    const has = (l) => msgs.some((m) => m.labels.includes(l));
    if (labelId === 'TRASH' || labelId === 'SPAM') return has(labelId);
    const live = msgs.filter((m) => !m.labels.includes('TRASH') && !m.labels.includes('SPAM'));
    if (!live.length) return false;
    return labelId ? live.some((m) => m.labels.includes(labelId)) : true;
  }

  metaMessage(e) {
    return {
      id: e.id, threadId: e.threadId, labelIds: e.labels,
      snippet: e.meta.snip || '', internalDate: String(e.meta.date), sizeEstimate: e.meta.size,
      payload: { headers: e.meta.h },
    };
  }

  // ---- reading -------------------------------------------------------------------
  getProfile() { return { emailAddress: this.email }; }
  getGmailSignature() { return ''; }

  async listLabels() {
    if (!this.folders.length) await this.loadFolders();
    const sys = ['INBOX', 'STARRED', 'IMPORTANT', 'UNREAD', ...this.folders.filter((f) => !['INBOX', 'USER', 'ARCHIVE'].includes(f.role)).map((f) => f.role)];
    return [
      ...[...new Set(sys)].map((id) => ({ id, name: id, type: 'system' })),
      ...this.folders.filter((f) => f.role === 'USER').map((f) => ({ id: this.labelIdOf(f.path), name: f.name, type: 'user' })),
    ];
  }

  async createLabel(name) {
    const clean = name.trim().replace(/^\/+|\/+$/g, '');
    const have = this.folders.find((f) => f.role === 'USER' && f.name.toLowerCase() === clean.toLowerCase());
    if (have) return { id: this.labelIdOf(have.path), name: have.name, type: 'user' };
    const c = await this.conn();
    const d = this.folders[0]?.delimiter || '/';
    const inboxNested = this.folders.some((f) => f.path.toUpperCase().startsWith(`INBOX${d}`));
    const path = (inboxNested ? `INBOX${d}` : '') + clean.split('/').join(d);
    await c.mailboxCreate(path);
    await this.loadFolders();
    const f = this.folders.find((x) => x.path === path);
    return { id: this.labelIdOf(f.path), name: f.name, type: 'user' };
  }

  async getLabel(id) {
    await this.sync();
    const { threads, entries } = this.view();
    const inLabel = [...threads.values()].filter((t) => MailService.visible(t.msgs, id));
    return {
      id,
      threadsTotal: inLabel.length,
      threadsUnread: inLabel.filter((t) => t.msgs.some((m) => m.labels.includes('UNREAD') && (!id || m.labels.includes(id) || id === 'UNREAD'))).length,
      messagesTotal: entries.filter((e) => e.labels.includes(id)).length,
    };
  }

  /** Searches the server; returns the Set of matching "path#uid", or null for "no search". */
  async searchServer(q, labelId) {
    const pq = parseQuery(q);
    if (!pq.terms.length && !pq.inFolder && !pq.label) return null;
    let paths;
    const role = { inbox: 'INBOX', sent: 'SENT', drafts: 'DRAFT', draft: 'DRAFT', spam: 'SPAM', junk: 'SPAM', trash: 'TRASH', archive: 'ARCHIVE' }[pq.inFolder];
    if (role) paths = [this.pathOf(role)].filter(Boolean);
    else if (pq.label) paths = this.folders.filter((f) => f.name.toLowerCase() === pq.label.toLowerCase()).map((f) => f.path);
    else if (labelId && this.pathOfLabel(labelId)) paths = [this.pathOfLabel(labelId)];
    else if (pq.inFolder === 'anywhere') paths = this.folders.map((f) => f.path);
    else paths = this.folders.filter((f) => f.role !== 'TRASH' && f.role !== 'SPAM').map((f) => f.path);
    const hits = new Set();
    for (const path of paths) {
      if (!this.idx.folders[path] || !Object.keys(this.idx.folders[path].msgs).length) continue;
      await this.inBox(path, async (c) => {
        let set = null;
        const pos = pq.terms.filter((t) => !t.neg);
        if (!pos.length) set = new Set(Object.keys(this.idx.folders[path].msgs).map(Number));
        for (const t of pos) {
          const r = new Set((await c.search(t.criteria, { uid: true })) || []);
          set = set ? new Set([...set].filter((u) => r.has(u))) : r;
          if (!set.size) break;
        }
        for (const t of pq.terms.filter((x) => x.neg)) {
          if (!set.size) break;
          const r = new Set((await c.search(t.criteria, { uid: true })) || []);
          set = new Set([...set].filter((u) => !r.has(u)));
        }
        for (const u of set) hits.add(`${path}#${u}`);
      });
    }
    return hits;
  }

  async listThreads({ labelId, q, pageToken, max = 25 } = {}) {
    await this.sync();
    const hits = q ? await this.searchServer(q, labelId) : null;
    const { threads } = this.view();
    let list = [...threads.values()].filter((t) => MailService.visible(t.msgs, labelId));
    if (hits) list = list.filter((t) => t.msgs.some((m) => m.locs.some((l) => hits.has(`${l.path}#${l.uid}`))));
    list.sort((a, b) => byDate({ meta: b.latest }, { meta: a.latest }));
    const start = Number(pageToken || 0);
    return { ids: list.slice(start, start + max).map((t) => t.id), nextPageToken: start + max < list.length ? String(start + max) : null, estimate: list.length };
  }

  async ensureSnippet(e) {
    if (e.meta.snip !== undefined) return;
    try {
      e.meta.snip = await this.inBox(e.primary.path, async (c) => {
        const m = await c.fetchOne(String(e.primary.uid), { bodyStructure: true }, { uid: true });
        if (!m?.bodyStructure) return '';
        let plain = null; let html = null;
        leaves(m.bodyStructure, (n, id) => {
          if (!isTextBody(n)) return;
          if (/plain/i.test(n.type) && !plain) plain = id;
          if (/html/i.test(n.type) && !html) html = id;
        });
        const part = plain || html;
        if (!part) return '';
        const { content } = await c.download(String(e.primary.uid), part, { uid: true, maxBytes: 4096 });
        let s = (await streamToBuffer(content)).toString('utf8');
        if (!plain) s = s.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
        return s.replace(/^>.*$/gm, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      });
    } catch { e.meta.snip = ''; }
    this.saveSoon();
  }

  async getThreadsMeta(ids) {
    await this.sync();
    const { threads } = this.view();
    const out = [];
    for (const id of ids) {
      const t = threads.get(id);
      if (!t) { out.push({ id, messages: [] }); continue; }
      await this.ensureSnippet(t.msgs[t.msgs.length - 1]);
      out.push({ id, messages: t.msgs.map((e) => this.metaMessage(e)) });
    }
    return out;
  }

  /** One message as the Gmail API returns it with format=full. */
  async fullMessage(e) {
    return this.inBox(e.primary.path, async (c) => {
      const m = await c.fetchOne(String(e.primary.uid), { uid: true, headers: true, bodyStructure: true }, { uid: true });
      if (!m) throw notFound('Message');
      const texts = {};
      const want = [];
      leaves(m.bodyStructure, (n, id) => { if (isTextBody(n)) want.push(id); });
      for (const id of want) {
        const { content } = await c.download(String(e.primary.uid), id, { uid: true });
        texts[id] = await streamToBuffer(content);
      }
      const headers = parseHeaders(m.headers);
      const text = Object.values(texts)[0];
      return {
        id: e.id, threadId: e.threadId, labelIds: e.labels,
        snippet: e.meta.snip || (text ? text.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : ''),
        internalDate: String(e.meta.date), sizeEstimate: e.meta.size,
        payload: toPayload(m.bodyStructure, headers, texts),
      };
    });
  }

  async getThread(id) {
    await this.sync();
    const t = this.view().threads.get(id);
    if (!t) throw notFound('Thread');
    const messages = [];
    for (const e of t.msgs) messages.push(await this.fullMessage(e));
    return { id, messages };
  }

  entry(id) {
    const e = this.view().byId.get(id);
    if (!e) throw notFound('Message');
    return e;
  }

  async getAttachment(messageId, attachmentId) {
    const e = this.entry(messageId);
    return this.inBox(e.primary.path, async (c) => {
      const { content } = await c.download(String(e.primary.uid), attachmentId, { uid: true });
      return b64url(await streamToBuffer(content));
    });
  }

  async getRawMessage(id) {
    const e = this.entry(id);
    return this.inBox(e.primary.path, async (c) => {
      const m = await c.fetchOne(String(e.primary.uid), { uid: true, source: true }, { uid: true });
      return b64url(m.source);
    });
  }

  async recentAddresses(q, max = 50) {
    await this.sync();
    const role = /in:sent/.test(q || '') ? 'SENT' : 'INBOX';
    return this.view().entries
      .filter((e) => e.locs.some((l) => l.role === role))
      .sort((a, b) => byDate(b, a))
      .slice(0, max)
      .map((e) => ({ date: e.meta.date, headers: e.meta.h }));
  }

  // ---- changing --------------------------------------------------------------------
  async flagLocs(locs, add, remove) {
    const byPath = new Map();
    locs.forEach((l) => (byPath.get(l.path) || byPath.set(l.path, []).get(l.path)).push(l.uid));
    for (const [path, uids] of byPath) {
      await this.inBox(path, async (c) => {
        if (add.length) await c.messageFlagsAdd(uids, add, { uid: true }).catch(() => {});
        if (remove.length) await c.messageFlagsRemove(uids, remove, { uid: true }).catch(() => {});
      });
    }
  }

  async moveLocs(locs, to) {
    const byPath = new Map();
    locs.filter((l) => l.path !== to).forEach((l) => (byPath.get(l.path) || byPath.set(l.path, []).get(l.path)).push(l.uid));
    for (const [path, uids] of byPath) await this.inBox(path, (c) => c.messageMove(uids, to, { uid: true }));
  }

  async copyLoc(loc, to) { await this.inBox(loc.path, (c) => c.messageCopy([loc.uid], to, { uid: true })); }

  async deleteLocs(locs) {
    const byPath = new Map();
    locs.forEach((l) => (byPath.get(l.path) || byPath.set(l.path, []).get(l.path)).push(l.uid));
    for (const [path, uids] of byPath) await this.inBox(path, (c) => c.messageDelete(uids, { uid: true }));
  }

  /** Gmail's "add/remove labels" on every message of a conversation. */
  async modifyThread(id, add = [], remove = []) {
    await this.sync();
    const t = this.view().threads.get(id);
    if (!t) throw notFound('Thread');
    const flagAdd = []; const flagRemove = [];
    const flagOf = { UNREAD: '\\Seen', STARRED: '\\Flagged', IMPORTANT: '$Important' };
    add.forEach((l) => { if (l === 'UNREAD') flagRemove.push('\\Seen'); else if (flagOf[l]) flagAdd.push(flagOf[l]); });
    remove.forEach((l) => { if (l === 'UNREAD') flagAdd.push('\\Seen'); else if (flagOf[l]) flagRemove.push(flagOf[l]); });
    // Marking read/unread acts on every message, as in Gmail; stars only on the latest one when added.
    const allLocs = t.msgs.flatMap((e) => e.locs);
    if (flagAdd.includes('\\Flagged')) {
      await this.flagLocs(t.msgs[t.msgs.length - 1].locs, ['\\Flagged'], []);
      flagAdd.splice(flagAdd.indexOf('\\Flagged'), 1);
    }
    if (flagAdd.length || flagRemove.length) await this.flagLocs(allLocs, flagAdd, flagRemove);

    const touched = new Set(allLocs.map((l) => l.path));
    const userAdd = add.filter((l) => l.startsWith('Label_')).map((l) => this.pathOfLabel(l));
    const userRemove = remove.filter((l) => l.startsWith('Label_')).map((l) => this.pathOfLabel(l));
    for (const e of t.msgs) {
      if (e.primary.role === 'DRAFT') continue;
      for (const p of userAdd) if (!e.locs.some((l) => l.path === p)) { await this.copyLoc(e.primary, p); touched.add(p); }
    }
    if (add.includes('SPAM')) {
      const junk = await this.ensureFolder('SPAM', 'Junk'); touched.add(junk);
      for (const e of t.msgs) await this.moveLocs(e.locs.filter((l) => !['SENT', 'DRAFT', 'SPAM'].includes(l.role)), junk);
    }
    if (remove.includes('SPAM')) {
      const inbox = this.pathOf('INBOX'); touched.add(inbox);
      for (const e of t.msgs) await this.moveLocs(e.locs.filter((l) => l.role === 'SPAM'), inbox);
    }
    if (remove.includes('INBOX')) {
      const archive = await this.ensureFolder('ARCHIVE', 'Archive'); touched.add(archive);
      for (const e of t.msgs) {
        const inInbox = e.locs.filter((l) => l.role === 'INBOX');
        // Already filed in another folder (a label): archiving just takes it out of the Inbox.
        if (e.locs.some((l) => l.role === 'USER')) await this.deleteLocs(inInbox);
        else await this.moveLocs(inInbox, archive);
      }
    }
    if (add.includes('INBOX')) {
      const inbox = this.pathOf('INBOX'); touched.add(inbox);
      for (const e of t.msgs) {
        if (e.locs.some((l) => l.role === 'INBOX') || e.primary.role === 'DRAFT') continue;
        const from = e.locs.find((l) => ['ARCHIVE', 'SPAM', 'TRASH'].includes(l.role));
        if (from) await this.moveLocs([from], inbox);
        else await this.copyLoc(e.primary, inbox);
      }
    }
    for (const p of userRemove) {
      touched.add(p);
      for (const e of t.msgs) {
        const there = e.locs.filter((l) => l.path === p);
        if (!there.length) continue;
        if (e.locs.length > there.length) await this.deleteLocs(there);
        else { const archive = await this.ensureFolder('ARCHIVE', 'Archive'); touched.add(archive); await this.moveLocs(there, archive); }
      }
    }
    if (add.includes('TRASH')) return this.trashThread(id);
    await this.sync({ paths: [...touched] });
    return { id };
  }

  async trashThread(id) {
    await this.sync();
    const t = this.view().threads.get(id);
    if (!t) throw notFound('Thread');
    const trash = await this.ensureFolder('TRASH', 'Trash');
    const touched = new Set([trash]);
    for (const e of t.msgs) {
      if (e.locs.every((l) => l.role === 'TRASH')) continue;
      this.idx.trashedFrom[e.key] = e.primary.path;
      const [first, ...rest] = e.locs.filter((l) => l.role !== 'TRASH');
      if (e.locs.some((l) => l.role === 'TRASH')) { await this.deleteLocs([first, ...rest]); continue; }
      await this.moveLocs([first], trash);
      if (rest.length) await this.deleteLocs(rest);
      e.locs.forEach((l) => touched.add(l.path));
    }
    await this.sync({ paths: [...touched] });
    return { id };
  }

  async untrashThread(id) {
    await this.sync();
    const t = this.view().threads.get(id);
    if (!t) throw notFound('Thread');
    const touched = new Set();
    for (const e of t.msgs) {
      const inTrash = e.locs.filter((l) => l.role === 'TRASH');
      if (!inTrash.length) continue;
      const fromMe = (headerValue(e.meta.h, 'from').toLowerCase().includes(this.email));
      let to = this.idx.trashedFrom[e.key];
      if (!to || !this.folders.some((f) => f.path === to)) to = this.pathOf(fromMe ? 'SENT' : 'INBOX') || this.pathOf('INBOX');
      await this.moveLocs(inTrash, to);
      delete this.idx.trashedFrom[e.key];
      touched.add(to); touched.add(inTrash[0].path);
    }
    await this.sync({ paths: [...touched] });
    const t2 = this.view().threads.get(id);
    return { id, messages: t2 ? t2.msgs.map((e) => this.metaMessage(e)) : [] };
  }

  // ---- drafts ----------------------------------------------------------------------
  /** Adds From and Message-ID (keeping mid if given); returns { raw: Buffer, mid }. */
  prepare(raw, { mid } = {}) {
    // Work on bytes: a string from the app is UTF-8 text.
    let s = (Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8')).toString('binary');
    const cut = s.search(/\r?\n\r?\n/);
    let head = cut >= 0 ? s.slice(0, cut) : s;
    const body = cut >= 0 ? s.slice(cut) : '\r\n\r\n';
    const hasHeader = (n) => new RegExp(`^${n}:`, 'im').test(head);
    if (!hasHeader('From')) {
      const display = this.name ? `"${this.name.replace(/"/g, '')}" <${this.email}>` : this.email;
      head = `From: ${display}\r\n${head}`;
    }
    const domain = this.email.split('@')[1] || 'localhost';
    const id = mid || `${randomUUID()}@${domain}`;
    head = head.replace(/^Message-ID:.*(\r?\n[ \t].*)*\r?\n?/im, '');
    head = `${head.replace(/\r?\n$/, '')}\r\nMessage-ID: <${id}>`;
    if (!hasHeader('Date')) head += `\r\nDate: ${new Date().toUTCString().replace('GMT', '+0000')}`;
    s = head + body;
    return { raw: Buffer.from(s, 'binary'), mid: id.toLowerCase() };
  }

  async listDrafts({ pageToken, max = 25 } = {}) {
    await this.sync();
    const list = this.view().entries.filter((e) => e.locs.some((l) => l.role === 'DRAFT')).sort((a, b) => byDate(b, a));
    const start = Number(pageToken || 0);
    return {
      drafts: list.slice(start, start + max).map((e) => ({ id: `r${e.id}`, message: { id: e.id, threadId: e.threadId } })),
      nextPageToken: start + max < list.length ? String(start + max) : null,
    };
  }

  draftEntry(id) {
    const e = this.view().byId.get(String(id).replace(/^r/, ''));
    if (!e || !e.locs.some((l) => l.role === 'DRAFT')) throw notFound('Draft');
    return e;
  }

  async getDraft(id) {
    await this.sync();
    return { id, message: await this.fullMessage(this.draftEntry(id)) };
  }

  async getDraftsMeta(ids) {
    await this.sync();
    const out = [];
    for (const id of ids) {
      const e = this.draftEntry(id);
      await this.ensureSnippet(e);
      out.push({ id, message: this.metaMessage(e) });
    }
    return out;
  }

  async appendTo(role, name, raw, flags) {
    const path = await this.ensureFolder(role, name);
    const c = await this.conn();
    await c.append(path, raw, flags);
    await this.sync({ paths: [path] });
    return path;
  }

  async createDraft(raw) {
    const p = this.prepare(raw);
    await this.appendTo('DRAFT', 'Drafts', p.raw, ['\\Draft', '\\Seen']);
    const e = this.view().byId.get(`m${sha(p.mid)}`);
    return { id: `r${e.id}`, message: { id: e.id, threadId: e.threadId } };
  }

  async updateDraft(id, raw) {
    await this.sync();
    const old = this.draftEntry(id);
    const oldLocs = old.locs.filter((l) => l.role === 'DRAFT');
    // Same Message-ID, so the draft keeps its ID while its content is replaced.
    const p = this.prepare(raw, { mid: old.meta.mid || undefined });
    const path = await this.appendTo('DRAFT', 'Drafts', p.raw, ['\\Draft', '\\Seen']);
    await this.deleteLocs(oldLocs);
    await this.sync({ paths: [path] });
    const e = this.view().byId.get(`m${sha(p.mid)}`);
    return { id: `r${e.id}`, message: { id: e.id, threadId: e.threadId } };
  }

  async deleteDraft(id) {
    await this.sync();
    let e;
    try { e = this.draftEntry(id); } catch { return null; }
    const locs = e.locs.filter((l) => l.role === 'DRAFT');
    await this.deleteLocs(locs);
    await this.sync({ paths: [...new Set(locs.map((l) => l.path))] });
    return null;
  }

  async findDraftId(messageId) {
    await this.sync();
    const e = this.view().byId.get(messageId);
    return e && e.locs.some((l) => l.role === 'DRAFT') ? `r${e.id}` : null;
  }

  // ---- sending ---------------------------------------------------------------------
  async sendRaw(raw) {
    const p = this.prepare(raw);
    const s = p.raw.toString('binary');
    const cut = s.search(/\r?\n\r?\n/);
    const head = s.slice(0, cut);
    const unfolded = head.replace(/\r?\n[ \t]+/g, ' ');
    const field = (n) => (unfolded.match(new RegExp(`^${n}:(.*)$`, 'gim')) || []).map((l) => l.slice(l.indexOf(':') + 1)).join(',');
    const rcpts = addressparser([field('To'), field('Cc'), field('Bcc')].filter(Boolean).join(','), { flatten: true })
      .map((a) => a.address).filter(Boolean);
    if (!rcpts.length) throw new Error('No recipients');
    // Bcc is not written into the copy that travels; it stays in your Sent copy.
    const travelling = Buffer.from(head.replace(/^Bcc:.*(\r?\n[ \t].*)*\r?\n?/im, '') + s.slice(cut), 'binary');
    const t = this.transport();
    try {
      await t.sendMail({ envelope: { from: this.email, to: rcpts }, raw: travelling });
    } finally { t.close(); }
    if (this.saveSent) await this.appendTo('SENT', 'Sent', p.raw, ['\\Seen']);
    await this.sync({ force: true });
    const e = this.view().byId.get(`m${sha(p.mid)}`);
    return { id: e?.id || `m${sha(p.mid)}`, threadId: e?.threadId || null, labelIds: e?.labels || ['SENT'] };
  }
}
