// The mail account this computer is signed in to: its settings in account.json
// in the app's data folder, its password encrypted with the system's own
// keychain (macOS Keychain, Windows DPAPI, the Linux secret service) through
// Electron's safeStorage. The password never leaves this computer except to
// the mail provider itself.
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MailService } from './mail/service.js';
import { detect } from './mail/detect.js';

export const imapOptions = ({ host, port, security }) => ({
  host, port: Number(port),
  secure: security === 'ssl',
  ...(security === 'starttls' ? { doSTARTTLS: true } : security === 'none' ? { doSTARTTLS: false } : {}),
});
export const smtpOptions = ({ host, port, security }) => ({
  host, port: Number(port),
  secure: security === 'ssl',
  ...(security === 'starttls' ? { requireTLS: true } : security === 'none' ? { ignoreTLS: true } : {}),
});

const fail = (code, message, extra = {}) => Object.assign(new Error(message || code), { code, ...extra });

/** What went wrong, in terms the sign-in screen can explain. */
function classify(e, where) {
  const m = `${e.responseText || ''} ${e.message || ''} ${e.code || ''}`;
  if (e.authenticationFailed || /auth|login|credentials|password|535|534|invalid user/i.test(m)) return fail('auth', m.trim(), { where });
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|timeout|EHOSTUNREACH|certificate|self.signed|TLS|SSL/i.test(m)) return fail('connect', m.trim(), { where });
  return fail('other', m.trim(), { where });
}

export class AccountManager {
  constructor({ dataDir, safeStorage }) {
    this.dataDir = dataDir;
    this.file = join(dataDir, 'account.json');
    this.safe = safeStorage;
    this.saved = null; // what's in account.json (password still encrypted)
    this.service = null;
  }

  async load() {
    try { this.saved = JSON.parse(await readFile(this.file, 'utf8')); } catch { this.saved = null; }
    return this.publicInfo();
  }

  publicInfo() {
    if (!this.saved) return null;
    const { email, name, imap, smtp, user } = this.saved;
    return { email, name, imap, smtp, user };
  }

  encrypt(pass) {
    if (this.safe?.isEncryptionAvailable()) return { enc: 'safe', value: this.safe.encryptString(pass).toString('base64') };
    return { enc: 'none', value: Buffer.from(pass).toString('base64') };
  }

  decrypt(p) {
    if (!p) return '';
    return p.enc === 'safe' ? this.safe.decryptString(Buffer.from(p.value, 'base64')) : Buffer.from(p.value, 'base64').toString();
  }

  makeService(cfg, pass) {
    const auth = { user: cfg.user || cfg.email, pass };
    return new MailService({
      email: cfg.email, name: cfg.name || '',
      imap: imapOptions(cfg.imap), smtp: smtpOptions(cfg.smtp), auth,
      dataDir: join(this.dataDir, 'mail'),
    });
  }

  /** The service for the saved account, opened on first use. */
  async mail() {
    if (this.service) return this.service;
    if (!this.saved) throw fail('reconnect', 'Not signed in');
    const s = this.makeService(this.saved, this.decrypt(this.saved.pass));
    try { await s.open(); } catch (e) {
      await s.close().catch(() => {});
      const c = classify(e, 'imap');
      // A changed password: ask again. Being offline is reported as it is.
      throw c.code === 'auth' ? fail('reconnect', c.message) : c;
    }
    this.service = s;
    return s;
  }

  detect(email) { return detect(email); }

  /**
   * Signs in: { email, password, name?, user?, imap?, smtp? }. Without servers,
   * they are detected. Checks both IMAP and SMTP before saving anything.
   */
  async connect({ email, password, name = '', user = '', imap, smtp }) {
    email = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail('badEmail');
    if (!password) throw fail('needPassword');
    let found = null;
    if (!imap || !smtp) {
      found = await detect(email);
      if (found?.note) throw fail(found.note, '', { provider: found.provider });
      if (!found) throw fail('notFound');
      imap = found.imap; smtp = found.smtp;
      if (found.userIsLocalPart && !user) user = email.split('@')[0];
    }
    const cfg = { email, name: String(name).trim(), user: String(user).trim(), imap, smtp };
    const settings = { imap, smtp, user: cfg.user, provider: found?.provider || '' };
    const s = this.makeService(cfg, password);
    try {
      await s.open();
    } catch (e) { await s.close().catch(() => {}); throw Object.assign(classify(e, 'imap'), { settings }); }
    try {
      await s.verifySmtp();
    } catch (e) { await s.close().catch(() => {}); throw Object.assign(classify(e, 'smtp'), { settings }); }
    await this.signOut({ keepMail: true });
    this.saved = { ...cfg, pass: this.encrypt(password) };
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.file, JSON.stringify(this.saved, null, 2), { mode: 0o600 });
    this.service = s;
    return this.publicInfo();
  }

  /** Forgets the password and this computer's copy of the message index. */
  async signOut({ keepMail = false } = {}) {
    const s = this.service;
    this.service = null;
    if (s) await s.close().catch(() => {});
    if (keepMail) return;
    this.saved = null;
    await rm(this.file, { force: true });
    await rm(join(this.dataDir, 'mail'), { recursive: true, force: true });
  }

  async close() { if (this.service) await this.service.close().catch(() => {}); }
}
