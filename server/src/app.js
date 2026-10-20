// ChiaraMail's ECS server. The same rules as the Firebase version
// (firestore.rules and storage.rules), enforced here:
//   - a message can be read only by its sender and the addresses it was sent to;
//   - only the sender can change it (a new edition), withdraw it, or delete it;
//     recipients and authorship never change;
//   - each sender keeps at most 1 GB of attachments: 20 files a message, 25 MB each;
//   - every edition is kept, for the sender's eyes only;
//   - read receipts: each recipient records when they last read it and which edition.
// People sign in with a code sent to their address; nothing else about them is kept.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const QUOTA = 1024 * 1024 * 1024;
export const MAX_FILE = 25 * 1024 * 1024;
const FILE_SLACK = 1024; // encryption adds a few bytes to each file
const MAX_FILES = 20;
const MAX_RECIPIENTS = 50;
const MAX_JSON = 2 * 1024 * 1024;
const CODE_TTL_MIN = 15;
const CODE_ATTEMPTS = 5;
const CODES_PER_EMAIL_HOUR = 5;
const CODES_PER_IP_HOUR = 30;
const SESSION_DAYS = 180;

const sha = (s) => createHash('sha256').update(s).digest('hex');
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const newId = (n = 20) => Array.from(randomBytes(n), (b) => ID_CHARS[b % 62]).join('');
const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(s);
const bad = (msg) => Object.assign(new Error(msg), { status: 400, code: 'invalid' });
const denied = () => Object.assign(new Error('Not found'), { status: 404, code: 'not-found' }); // no difference between "not yours" and "doesn't exist"

function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

async function readJson(req) {
  const chunks = []; let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > MAX_JSON) throw Object.assign(new Error('Too large'), { status: 413 });
    chunks.push(c);
  }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw bad('Bad JSON'); }
}

const out = (m) => {
  const d = {
    id: m.id, senderUid: m.sender_uid, senderEmail: m.sender_email, recipients: m.recipients,
    subject: m.subject, body: m.body, createdAt: m.created_at, updatedAt: m.updated_at,
    edition: m.edition, withdrawn: m.withdrawn, allowForward: m.allow_forward,
  };
  if (m.sender_name) d.senderName = m.sender_name;
  if (m.attachments) d.attachments = m.attachments;
  if (m.enc) d.enc = m.enc;
  if (m.counted) d.counted = true;
  return d;
};
const total = (atts) => (atts || []).reduce((n, a) => n + (a.size || 0), 0);

/**
 * db: openDb(); store: fileStore(); mailer: smtpMailer()/memoryMailer();
 * origins: the web origins allowed to call (the desktop app; the reader page is on this server itself);
 * site: staticSite() for the reader page, served for the paths the API doesn't use.
 */
export function createApp({ db, store, mailer, origins = [], secret = randomBytes(32).toString('hex'), trustProxy = false, site = null }) {
  const codeHash = (email, code) => sha(`${secret}:${email}:${code}`);

  const ipOf = (req) => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';

  async function me(req) {
    const h = String(req.headers.authorization || '');
    const m = h.match(/^Bearer ([A-Za-z0-9_-]{20,})$/);
    if (!m) return null;
    const r = await db.query(
      `UPDATE sessions s SET used_at = now() FROM users u
       WHERE s.token_hash = $1 AND u.uid = s.uid AND s.used_at > now() - interval '${SESSION_DAYS} days'
       RETURNING u.uid, u.email`, [sha(m[1])]);
    return r.rows[0] ? { uid: r.rows[0].uid, email: r.rows[0].email, verified: true } : null;
  }
  const need = async (req) => {
    const u = await me(req);
    if (!u) throw Object.assign(new Error('Sign in first'), { status: 401, code: 'unauthenticated' });
    return u;
  };

  const getMsg = async (id, c = db, lock = false) => {
    if (!/^[A-Za-z0-9]{20}$/.test(id)) return null;
    const r = await c.query(`SELECT * FROM messages WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
    return r.rows[0] || null;
  };
  const isSender = (u, m) => !!u && m.sender_uid === u.uid;
  const isRecipient = (u, m) => !!u && m.recipients.includes(u.email);
  const readable = async (u, id) => {
    const m = await getMsg(id);
    if (!m || !(isSender(u, m) || isRecipient(u, m))) throw denied();
    return m;
  };
  const mine = async (u, id, c = db, lock = false) => {
    const m = await getMsg(id, c, lock);
    if (!m || !isSender(u, m)) throw denied();
    return m;
  };
  // Gives a counted message's files back to its sender's allowance.
  const free = async (c, m) => {
    if (m.counted && !m.withdrawn) await c.query('UPDATE usage SET bytes = GREATEST(0, bytes - $2) WHERE uid = $1', [m.sender_uid, total(m.attachments)]);
  };

  // ---- sign-in -----------------------------------------------------------------
  async function startSignIn(req) {
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!isEmail(email)) throw bad('Bad email');
    const ip = ipOf(req);
    const counts = await db.query(
      `SELECT count(*) FILTER (WHERE email = $1) AS e, count(*) FILTER (WHERE ip = $2) AS i
       FROM sign_in_log WHERE at > now() - interval '1 hour'`, [email, ip]);
    if (Number(counts.rows[0].e) >= CODES_PER_EMAIL_HOUR || Number(counts.rows[0].i) >= CODES_PER_IP_HOUR) {
      throw Object.assign(new Error('Too many codes asked for; wait a while'), { status: 429, code: 'rate-limit' });
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const ref = newId(4).toUpperCase();
    await db.query('INSERT INTO sign_in_log (email, ip) VALUES ($1, $2)', [email, ip]);
    await db.query(`DELETE FROM sign_in_log WHERE at < now() - interval '1 day'`);
    await db.query(
      `INSERT INTO sign_in_codes (email, code_hash, expires_at, attempts) VALUES ($1, $2, now() + interval '${CODE_TTL_MIN} minutes', 0)
       ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0`,
      [email, codeHash(email, code)]);
    await mailer.sendCode(email, code, ref, b.lang === 'en' ? 'en' : 'fr');
    return { sent: true, ref, from: mailer.from };
  }

  async function verifySignIn(req) {
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const code = String(b.code || '').replace(/\D/g, '');
    const wrong = () => Object.assign(new Error('Wrong or expired code'), { status: 401, code: 'bad-code' });
    if (!isEmail(email) || code.length !== 6) throw wrong();
    const r = await db.query(
      `UPDATE sign_in_codes SET attempts = attempts + 1 WHERE email = $1 AND expires_at > now() RETURNING code_hash, attempts`, [email]);
    const row = r.rows[0];
    if (!row || row.attempts > CODE_ATTEMPTS) throw wrong();
    const a = Buffer.from(row.code_hash); const x = Buffer.from(codeHash(email, code));
    if (a.length !== x.length || !timingSafeEqual(a, x)) throw wrong();
    await db.query('DELETE FROM sign_in_codes WHERE email = $1', [email]);
    const u = await db.query(
      `INSERT INTO users (uid, email) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING uid, email`,
      [`u${newId(27)}`, email]);
    const token = randomBytes(32).toString('base64url');
    await db.query('INSERT INTO sessions (token_hash, uid) VALUES ($1, $2)', [sha(token), u.rows[0].uid]);
    return { token, user: { uid: u.rows[0].uid, email, verified: true } };
  }

  // ---- messages ------------------------------------------------------------------
  function checkContent(subject, body) {
    if (typeof subject !== 'string' || subject.length > 2000) throw bad('Bad subject');
    if (typeof body !== 'string' || body.length < 1 || body.length > 300000) throw bad('Bad body');
  }

  async function createMessage(u, req) {
    const b = await readJson(req);
    const recipients = Array.isArray(b.recipients) ? [...new Set(b.recipients.map((r) => String(r).trim().toLowerCase()))] : [];
    if (recipients.length < 1 || recipients.length > MAX_RECIPIENTS || !recipients.every(isEmail)) throw bad('Bad recipients');
    checkContent(b.subject, b.body);
    if (b.allowForward !== undefined && typeof b.allowForward !== 'boolean') throw bad('Bad allowForward');
    if (b.enc !== undefined && b.enc !== 0 && b.enc !== 1) throw bad('Bad enc');
    if (b.senderName !== undefined && (typeof b.senderName !== 'string' || b.senderName.length > 120)) throw bad('Bad name');
    let atts = null;
    if (b.attachments !== undefined && !(Array.isArray(b.attachments) && b.attachments.length === 0)) {
      if (!Array.isArray(b.attachments) || b.attachments.length > MAX_FILES) throw bad('Bad attachments');
      atts = b.attachments.map((a) => {
        if (!a || typeof a.name !== 'string' || a.name.length > 2000 || typeof a.type !== 'string' || a.type.length > 2000
          || !Number.isInteger(a.size) || a.size < 0 || a.size > MAX_FILE + FILE_SLACK) throw bad('Bad attachment');
        return { name: a.name, type: a.type || 'application/octet-stream', size: a.size };
      });
    }
    const id = newId();
    await db.tx(async (c) => {
      if (atts) {
        await c.query('INSERT INTO usage (uid) VALUES ($1) ON CONFLICT DO NOTHING', [u.uid]);
        const used = (await c.query('SELECT bytes FROM usage WHERE uid = $1 FOR UPDATE', [u.uid])).rows[0].bytes;
        const needBytes = total(atts);
        if (used + needBytes > QUOTA) throw Object.assign(new Error('quota'), { status: 409, code: 'quota', used, need: needBytes, quota: QUOTA });
        await c.query('UPDATE usage SET bytes = bytes + $2 WHERE uid = $1', [u.uid, needBytes]);
      }
      await c.query(
        `INSERT INTO messages (id, sender_uid, sender_email, sender_name, recipients, subject, body, allow_forward, attachments, enc, counted)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, u.uid, u.email, b.senderName ? b.senderName.slice(0, 120) : null, recipients, b.subject, b.body, !!b.allowForward,
          atts ? JSON.stringify(atts) : null, b.enc === 1 ? 1 : null, !!atts]);
      await c.query('INSERT INTO editions (message_id, edition, subject, body) VALUES ($1, 1, $2, $3)', [id, b.subject, b.body]);
    });
    return { id };
  }

  async function putFile(u, id, i, req) {
    const m = await mine(u, id);
    if (m.withdrawn) throw denied();
    const a = (m.attachments || [])[i];
    if (!a) throw bad('No such attachment');
    const max = Math.min(MAX_FILE + FILE_SLACK, a.size + FILE_SLACK);
    const declared = Number(req.headers['content-length']);
    if (declared && declared > max) throw Object.assign(new Error('Too large'), { status: 413 });
    const size = await store.put(id, i, req, max);
    // Withdrawn or deleted while uploading: don't keep it.
    const still = await getMsg(id);
    if (!still || still.withdrawn) { await store.removeAll(id); throw denied(); }
    return { size };
  }

  async function getFile(u, id, i, res) {
    const m = await readable(u, id);
    if (m.withdrawn || !(m.attachments || [])[i]) throw denied();
    const f = await store.get(id, i);
    if (!f) throw denied();
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': f.size, 'Cache-Control': 'no-store' });
    f.stream.pipe(res);
  }

  async function saveEdition(u, id, req) {
    const b = await readJson(req);
    checkContent(b.subject, b.body);
    return db.tx(async (c) => {
      const m = await mine(u, id, c, true);
      if (m.withdrawn) throw Object.assign(new Error('Withdrawn'), { status: 409, code: 'withdrawn' });
      const next = m.edition + 1;
      await c.query('UPDATE messages SET subject = $2, body = $3, edition = $4, updated_at = now() WHERE id = $1', [id, b.subject, b.body, next]);
      await c.query('INSERT INTO editions (message_id, edition, subject, body) VALUES ($1, $2, $3, $4)', [id, next, b.subject, b.body]);
      return { edition: next };
    });
  }

  async function setForward(u, id, req) {
    const b = await readJson(req);
    if (typeof b.allowForward !== 'boolean') throw bad('Bad allowForward');
    const m = await mine(u, id);
    if (m.withdrawn) throw Object.assign(new Error('Withdrawn'), { status: 409, code: 'withdrawn' });
    await db.query('UPDATE messages SET allow_forward = $2 WHERE id = $1', [id, b.allowForward]);
    return { allowForward: b.allowForward };
  }

  async function withdraw(u, id) {
    await db.tx(async (c) => {
      const m = await mine(u, id, c, true);
      if (m.withdrawn) return;
      await free(c, m);
      await c.query(`UPDATE messages SET withdrawn = true, body = '', updated_at = now() WHERE id = $1`, [id]);
    });
    await store.removeAll(id);
    return { withdrawn: true };
  }

  async function remove(u, id) {
    await db.tx(async (c) => {
      const m = await mine(u, id, c, true);
      await free(c, m);
      await c.query('DELETE FROM messages WHERE id = $1', [id]);
    });
    await store.removeAll(id);
    return { deleted: true };
  }

  async function editions(u, id) {
    await mine(u, id);
    const r = await db.query('SELECT edition, subject, body, saved_at FROM editions WHERE message_id = $1 ORDER BY edition DESC', [id]);
    return r.rows.map((e) => ({ edition: e.edition, subject: e.subject, body: e.body, savedAt: e.saved_at }));
  }

  async function markRead(u, id, req) {
    const b = await readJson(req);
    if (!Number.isInteger(b.edition)) throw bad('Bad edition');
    const m = await getMsg(id);
    if (!m || !isRecipient(u, m)) throw denied();
    await db.query(
      `INSERT INTO reads (message_id, email, edition_seen) VALUES ($1, $2, $3)
       ON CONFLICT (message_id, email) DO UPDATE SET edition_seen = EXCLUDED.edition_seen, last_read_at = now()`, [id, u.email, b.edition]);
    return { ok: true };
  }

  async function reads(u, id) {
    await mine(u, id);
    const r = await db.query('SELECT email, edition_seen, last_read_at FROM reads WHERE message_id = $1', [id]);
    return Object.fromEntries(r.rows.map((x) => [x.email, { editionSeen: x.edition_seen, lastReadAt: x.last_read_at }]));
  }

  async function myRead(u, id) {
    const m = await getMsg(id);
    if (!m || !isRecipient(u, m)) throw denied();
    const r = await db.query('SELECT edition_seen, last_read_at FROM reads WHERE message_id = $1 AND email = $2', [id, u.email]);
    return r.rows[0] ? { editionSeen: r.rows[0].edition_seen, lastReadAt: r.rows[0].last_read_at } : null;
  }

  // ---- routes --------------------------------------------------------------------
  const routes = [
    ['GET', /^\/health$/, async () => ({ ok: true })],
    ['POST', /^\/auth\/start$/, (req) => startSignIn(req)],
    ['POST', /^\/auth\/verify$/, (req) => verifySignIn(req)],
    ['POST', /^\/auth\/signout$/, async (req) => {
      const t = String(req.headers.authorization || '').replace(/^Bearer /, '');
      if (t) await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha(t)]);
      return { ok: true };
    }],
    ['GET', /^\/me$/, async (req) => need(req)],
    ['GET', /^\/prefs$/, async (req) => {
      const u = await need(req);
      const r = await db.query('SELECT signature, updated_at FROM prefs WHERE uid = $1', [u.uid]);
      return r.rows[0] ? { signature: r.rows[0].signature, updatedAt: r.rows[0].updated_at } : null;
    }],
    ['PUT', /^\/prefs$/, async (req) => {
      const u = await need(req);
      const b = await readJson(req);
      if (typeof b.signature !== 'string' || b.signature.length > 10000) throw bad('Bad signature');
      await db.query(`INSERT INTO prefs (uid, signature) VALUES ($1, $2)
        ON CONFLICT (uid) DO UPDATE SET signature = EXCLUDED.signature, updated_at = now()`, [u.uid, b.signature]);
      return { ok: true };
    }],
    ['GET', /^\/usage$/, async (req) => {
      const u = await need(req);
      const r = await db.query('SELECT bytes FROM usage WHERE uid = $1', [u.uid]);
      return { used: r.rows[0]?.bytes || 0, quota: QUOTA };
    }],
    ['POST', /^\/directory$/, async (req) => {
      const u = await need(req);
      await db.query('INSERT INTO ecs_users (email) VALUES ($1) ON CONFLICT DO NOTHING', [u.email]);
      return { ok: true };
    }],
    ['GET', /^\/directory\/([^/]+)$/, async (req, [email]) => {
      await need(req);
      const r = await db.query('SELECT 1 FROM ecs_users WHERE email = $1', [decodeURIComponent(email).toLowerCase()]);
      return { ecs: r.rowCount > 0 };
    }],
    ['POST', /^\/messages$/, async (req) => createMessage(await need(req), req)],
    ['GET', /^\/messages\/([A-Za-z0-9]+)$/, async (req, [id]) => out(await readable(await need(req), id))],
    ['PATCH', /^\/messages\/([A-Za-z0-9]+)$/, async (req, [id]) => setForward(await need(req), id, req)],
    ['DELETE', /^\/messages\/([A-Za-z0-9]+)$/, async (req, [id]) => remove(await need(req), id)],
    ['POST', /^\/messages\/([A-Za-z0-9]+)\/withdraw$/, async (req, [id]) => withdraw(await need(req), id)],
    ['GET', /^\/messages\/([A-Za-z0-9]+)\/sender$/, async (req, [id]) => ({ senderEmail: (await readable(await need(req), id)).sender_email })],
    ['GET', /^\/messages\/([A-Za-z0-9]+)\/editions$/, async (req, [id]) => editions(await need(req), id)],
    ['POST', /^\/messages\/([A-Za-z0-9]+)\/editions$/, async (req, [id]) => saveEdition(await need(req), id, req)],
    ['PUT', /^\/messages\/([A-Za-z0-9]+)\/read$/, async (req, [id]) => markRead(await need(req), id, req)],
    ['GET', /^\/messages\/([A-Za-z0-9]+)\/reads$/, async (req, [id]) => reads(await need(req), id)],
    ['GET', /^\/messages\/([A-Za-z0-9]+)\/reads\/me$/, async (req, [id]) => myRead(await need(req), id)],
    ['PUT', /^\/messages\/([A-Za-z0-9]+)\/files\/(\d{1,2})$/, async (req, [id, i]) => putFile(await need(req), id, Number(i), req)],
    ['GET', /^\/messages\/([A-Za-z0-9]+)\/files\/(\d{1,2})$/, async (req, [id, i], res) => { await getFile(await need(req), id, Number(i), res); return undefined; }],
  ];

  return async function handle(req, res) {
    const origin = req.headers.origin;
    const cors = origin && origins.includes(origin) ? {
      'Access-Control-Allow-Origin': origin, Vary: 'Origin',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
      'Access-Control-Max-Age': '600',
    } : {};
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const path = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '') || '/';
    try {
      for (const [method, re, fn] of routes) {
        const m = path.match(re);
        if (!m || method !== req.method) continue;
        const r = await fn(req, m.slice(1), res);
        if (!res.headersSent) send(res, 200, r === undefined ? null : r);
        return;
      }
      if (site && await site(req, res, path)) return;
      send(res, 404, { error: { message: 'Not found', code: 'not-found' } });
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(new Date().toISOString(), req.method, path, e.message);
      if (!res.headersSent) {
        send(res, status, { error: { message: status === 500 ? 'Server error' : e.message, code: e.code || null, ...(e.code === 'quota' ? { used: e.used, need: e.need, quota: e.quota } : {}) } });
      } else res.destroy();
      req.resume();
    }
  };
}
