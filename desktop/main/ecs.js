// The desktop app's link to ChiaraMail's European ECS server (server/).
// Signing in needs no typing: the server emails a code to the address, and
// since this app already reads that mailbox, it finds the code there (Inbox
// or Spam), enters it, and deletes that email. The session is kept in
// ecs.json in the app's data folder, encrypted like the mail password.
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const CODE_WAIT_MS = 120_000;
const POLL_MS = 4_000;

export class EcsClient {
  /** url: the server, e.g. https://ecs.example.eu ('' = no ECS server: ECS stays off). */
  constructor({ url, readerOrigin, dataDir, safeStorage }) {
    this.url = (url || '').replace(/\/+$/, '');
    this.readerOrigin = readerOrigin || this.url;
    this.file = join(dataDir, 'ecs.json');
    this.safe = safeStorage;
    this.saved = null; // { email, user, token: {enc, value} }
    this.signingIn = null;
  }

  get configured() { return !!this.url; }

  async load() {
    try { this.saved = JSON.parse(await readFile(this.file, 'utf8')); } catch { this.saved = null; }
  }

  token() {
    const t = this.saved?.token;
    if (!t) return null;
    try { return t.enc === 'safe' ? this.safe.decryptString(Buffer.from(t.value, 'base64')) : Buffer.from(t.value, 'base64').toString(); } catch { return null; }
  }

  async save(email, user, token) {
    const enc = this.safe?.isEncryptionAvailable()
      ? { enc: 'safe', value: this.safe.encryptString(token).toString('base64') }
      : { enc: 'none', value: Buffer.from(token).toString('base64') };
    this.saved = { email, user, token: enc };
    await writeFile(this.file, JSON.stringify(this.saved), { mode: 0o600 });
  }

  /** The signed-in ECS user for this address, or null. */
  session(email) {
    if (!this.saved || this.saved.email !== String(email).toLowerCase() || !this.token()) return null;
    return this.saved.user;
  }

  async request(method, path, { json, bytes, auth = true } = {}) {
    if (!this.configured) throw Object.assign(new Error('No ECS server'), { code: 'no-server' });
    const headers = {};
    if (auth) { const t = this.token(); if (t) headers.Authorization = `Bearer ${t}`; }
    let body;
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    if (bytes !== undefined) { headers['Content-Type'] = 'application/octet-stream'; body = Buffer.from(bytes); }
    let r;
    try { r = await fetch(this.url + path, { method, headers, body, signal: AbortSignal.timeout(10 * 60_000) }); } catch (e) {
      throw Object.assign(new Error(`ECS server unreachable: ${e.cause?.code || e.message}`), { code: 'offline' });
    }
    const type = r.headers.get('content-type') || '';
    if (!r.ok) {
      const err = type.includes('json') ? (await r.json().catch(() => ({}))).error || {} : {};
      if (r.status === 401 && auth) { this.saved = null; await rm(this.file, { force: true }); }
      throw Object.assign(new Error(err.message || r.statusText), { status: r.status, ...err, code: err.code || (r.status === 401 ? 'unauthenticated' : null) });
    }
    if (type.includes('json')) return { json: await r.json() };
    return { bytes: new Uint8Array(await r.arrayBuffer()) };
  }

  /**
   * Where the code email can land: the Inbox, Spam, and Sent (when the server
   * sends the codes from this same address, Gmail files them under Sent only).
   * Returns { path: next UID } for each, so only newer messages are looked at.
   */
  async marks(mail) {
    const out = {};
    for (const role of ['INBOX', 'SPAM', 'SENT']) {
      const path = mail.pathOf(role);
      if (!path || out[path]) continue;
      out[path] = await mail.inBox(path, async (c) => c.mailbox?.uidNext || 1).catch(() => 1);
    }
    return out;
  }

  /**
   * Finds the code email for `ref` among the messages that arrived since
   * `marks` (a few envelopes, not a search of the whole mailbox, so the
   * screens aren't held up); returns the code, deleting the email.
   */
  async findCode(mail, ref, marks) {
    for (const [path, next] of Object.entries(marks)) {
      const code = await mail.inBox(path, async (c) => {
        await c.noop().catch(() => {}); // news of arrivals when this folder was already open
        if (!c.mailbox?.exists) return null;
        // (No other command may run while a fetch is being read: collect, then delete.)
        let hit = null;
        for await (const m of c.fetch(`${next}:*`, { envelope: true, uid: true }, { uid: true })) {
          const s = m.envelope?.subject || '';
          const found = m.uid >= next && s.includes(ref) && s.match(/\b(\d{6})\b/);
          if (found && !hit) hit = { uid: m.uid, code: found[1] };
        }
        if (hit) await c.messageDelete([hit.uid], { uid: true }).catch(() => {});
        return hit?.code || null;
      }).catch(() => null);
      if (code) return code;
    }
    return null;
  }

  /** Signs in as `email`, reading the code from that mailbox with `mail` (a MailService). */
  signIn(email, mail, lang = 'fr') {
    if (this.signingIn) return this.signingIn;
    this.signingIn = (async () => {
      email = String(email).toLowerCase();
      const marks = await this.marks(mail);
      const { json: start } = await this.request('POST', '/auth/start', { json: { email, lang }, auth: false });
      const end = Date.now() + CODE_WAIT_MS;
      let code = null;
      while (!code && Date.now() < end) {
        code = await this.findCode(mail, start.ref, marks);
        if (!code) await new Promise((r) => setTimeout(r, POLL_MS));
      }
      if (!code) throw Object.assign(new Error('The sign-in code never arrived'), { code: 'no-code' });
      const { json } = await this.request('POST', '/auth/verify', { json: { email, code }, auth: false });
      await this.save(email, json.user, json.token);
      await this.request('POST', '/directory').catch(() => {});
      return json.user;
    })().finally(() => { this.signingIn = null; });
    return this.signingIn;
  }

  async signOut() {
    if (this.saved && this.configured) await this.request('POST', '/auth/signout').catch(() => {});
    this.saved = null;
    await rm(this.file, { force: true });
  }
}
