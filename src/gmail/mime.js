// Pure helpers for building and reading Gmail messages. No network, no React,
// so they're unit-tested in tests/mime.test.js.

export const CONTENT_POINTER = 'X-ChiaraMail-Content-Pointer';

// ---- base64 / base64url over UTF-8 ----------------------------------------

const enc = new TextEncoder();

export function bytesToB64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
export const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
export const b64urlToB64 = (s) => {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return b + '='.repeat((4 - (b.length % 4)) % 4);
};
export const b64ToB64url = (s) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const b64urlToBytes = (s) => b64ToBytes(b64urlToB64(s));
export const utf8ToB64 = (s) => bytesToB64(enc.encode(s));
export const toB64url = (s) => b64ToB64url(utf8ToB64(s));

export function decodeBytes(bytes, charset = 'utf-8') {
  try { return new TextDecoder(charset || 'utf-8').decode(bytes); } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

// ---- addresses --------------------------------------------------------------

// Splits "A <a@x>, \"B, Jr\" <b@y>; c@z" into [{name, email}], respecting quotes.
export function parseAddressList(str) {
  if (!str) return [];
  const out = [];
  let cur = '';
  let quote = false;
  let angle = false;
  for (const ch of str) {
    if (ch === '"') quote = !quote;
    if (!quote && ch === '<') angle = true;
    if (!quote && ch === '>') angle = false;
    if (!quote && !angle && (ch === ',' || ch === ';' || ch === '\n')) { push(cur); cur = ''; } else cur += ch;
  }
  push(cur);
  return out;
  function push(part) {
    const p = part.trim();
    if (!p) return;
    const m = p.match(/^(.*?)<([^>]+)>\s*$/);
    if (m) out.push({ name: m[1].trim().replace(/^"|"$/g, '').trim(), email: m[2].trim() });
    else out.push({ name: '', email: p.replace(/^"|"$/g, '') });
  }
}

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
export const isEmail = (s) => EMAIL_RE.test((s || '').trim());

export const displayName = (a) => (a ? a.name || a.email : '');

// ---- building outgoing messages --------------------------------------------

const isAscii = (s) => /^[\x20-\x7e]*$/.test(s);
export const encodeWord = (s) => (isAscii(s) ? s : `=?UTF-8?B?${utf8ToB64(s)}?=`);

function formatAddress({ name, email }) {
  if (!name) return email;
  const safe = isAscii(name) ? `"${name.replace(/(["\\])/g, '\\$1')}"` : encodeWord(name);
  return `${safe} <${email}>`;
}
const formatList = (list) => list.map(formatAddress).join(', ');
const wrap76 = (b64) => b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
const boundary = () => `cm_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

function textPart(type, content) {
  return [
    `Content-Type: ${type}; charset="UTF-8"`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(utf8ToB64(content)),
  ].join('\r\n');
}

/**
 * Builds an RFC 2822 message. All headers are ASCII (non-ASCII is
 * encoded-word), all bodies base64, so the result is plain ASCII.
 * attachments: [{ filename, mimeType, base64 }]
 */
export function buildRaw({
  from, to = [], cc = [], bcc = [], subject = '', text = '', html,
  attachments = [], inReplyTo, references, headers = {}, date = new Date(),
}) {
  const head = [];
  if (from) head.push(`From: ${formatAddress(from)}`);
  if (to.length) head.push(`To: ${formatList(to)}`);
  if (cc.length) head.push(`Cc: ${formatList(cc)}`);
  if (bcc.length) head.push(`Bcc: ${formatList(bcc)}`);
  head.push(`Subject: ${encodeWord(subject)}`);
  head.push(`Date: ${date.toUTCString().replace('GMT', '+0000')}`);
  if (inReplyTo) head.push(`In-Reply-To: ${inReplyTo}`);
  if (references) head.push(`References: ${references}`);
  Object.entries(headers).forEach(([k, v]) => head.push(`${k}: ${v}`));
  head.push('MIME-Version: 1.0');

  let body = html
    ? (() => {
      const b = boundary();
      return {
        type: `multipart/alternative; boundary="${b}"`,
        content: [`--${b}`, textPart('text/plain', text), `--${b}`, textPart('text/html', html), `--${b}--`].join('\r\n'),
      };
    })()
    : null;

  if (attachments.length) {
    const b = boundary();
    const first = body
      ? `Content-Type: ${body.type}\r\n\r\n${body.content}`
      : textPart('text/plain', text);
    const parts = attachments.map((a) => [
      `Content-Type: ${a.mimeType || 'application/octet-stream'}; name="${encodeWord(a.filename)}"`,
      `Content-Disposition: attachment; filename="${encodeWord(a.filename)}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(a.base64),
    ].join('\r\n'));
    body = {
      type: `multipart/mixed; boundary="${b}"`,
      content: [`--${b}`, first, ...parts.flatMap((p) => [`--${b}`, p]), `--${b}--`].join('\r\n'),
    };
  }

  if (body) return [...head, `Content-Type: ${body.type}`, '', body.content, ''].join('\r\n');
  return [...head, textPart('text/plain', text), ''].join('\r\n');
}

// ---- reading Gmail API messages ---------------------------------------------

export function headerMap(headers = []) {
  const m = {};
  headers.forEach(({ name, value }) => {
    const k = name.toLowerCase();
    if (!(k in m)) m[k] = value;
  });
  return m;
}

const charsetOf = (part) => {
  const ct = (headerMap(part.headers)['content-type'] || '');
  const m = ct.match(/charset="?([^";\s]+)"?/i);
  return m ? m[1] : 'utf-8';
};

/** Turns a Gmail API message (format=full) into something easy to render. */
export function parseMessage(msg) {
  const payload = msg.payload || {};
  const h = headerMap(payload.headers);
  const out = {
    id: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds || [],
    snippet: decodeEntities(msg.snippet || ''),
    date: msg.internalDate ? new Date(Number(msg.internalDate)) : (h.date ? new Date(h.date) : null),
    subject: h.subject || '',
    from: parseAddressList(h.from)[0] || null,
    to: parseAddressList(h.to),
    cc: parseAddressList(h.cc),
    bcc: parseAddressList(h.bcc),
    replyTo: parseAddressList(h['reply-to']),
    messageId: h['message-id'] || '',
    references: h.references || '',
    pointer: (h[CONTENT_POINTER.toLowerCase()] || '').trim() || null,
    inReplyTo: h['in-reply-to'] || '',
    headers: h,
    text: '',
    html: '',
    attachments: [],
    inline: {},
  };
  const walk = (part) => {
    const ph = headerMap(part.headers);
    const type = (part.mimeType || '').toLowerCase();
    const disposition = (ph['content-disposition'] || '').toLowerCase();
    const cid = (ph['content-id'] || '').replace(/[<>]/g, '');
    if (part.parts) { part.parts.forEach(walk); return; }
    const isAttachment = part.filename || disposition.startsWith('attachment');
    if (!isAttachment && type === 'text/plain' && part.body?.data && !out.text) {
      out.text = decodeBytes(b64urlToBytes(part.body.data), charsetOf(part));
    } else if (!isAttachment && type === 'text/html' && part.body?.data && !out.html) {
      out.html = decodeBytes(b64urlToBytes(part.body.data), charsetOf(part));
    } else if (part.body?.attachmentId || part.body?.data) {
      const a = {
        filename: part.filename || (cid ? `${cid}` : 'attachment'),
        mimeType: type || 'application/octet-stream',
        size: part.body.size || 0,
        attachmentId: part.body.attachmentId || null,
        data: part.body.data || null,
        cid,
      };
      if (cid && !disposition.startsWith('attachment')) out.inline[cid] = a;
      else out.attachments.push(a);
    }
  };
  walk(payload);
  return out;
}

/** One row of a thread list, from a thread fetched with format=metadata. */
export function summarize(thread, me) {
  const msgs = thread.messages || [];
  const first = msgs[0] ? headerMap(msgs[0].payload?.headers) : {};
  const last = msgs[msgs.length - 1];
  const lastH = last ? headerMap(last.payload?.headers) : {};
  const labels = new Set(msgs.flatMap((m) => m.labelIds || []));
  const people = [];
  msgs.forEach((m) => {
    const f = parseAddressList(headerMap(m.payload?.headers).from)[0];
    if (!f) return;
    const label = f.email.toLowerCase() === (me || '').toLowerCase() ? 'me' : displayName(f);
    if (!people.includes(label)) people.push(label);
  });
  return {
    id: thread.id,
    subject: first.subject || lastH.subject || '',
    people,
    count: msgs.length,
    snippet: decodeEntities(last?.snippet || thread.snippet || ''),
    date: last?.internalDate ? new Date(Number(last.internalDate)) : null,
    unread: labels.has('UNREAD'),
    draft: labels.has('DRAFT'),
    starred: labels.has('STARRED'),
    important: labels.has('IMPORTANT'),
    live: msgs.some((m) => headerMap(m.payload?.headers)[CONTENT_POINTER.toLowerCase()]),
    hasAttachment: msgs.some((m) => hasAttachment(m.payload)),
  };
}
const hasAttachment = (p) => !!p && ((p.filename && p.filename.length > 0) || (p.parts || []).some(hasAttachment));

// Gmail's snippets are HTML-escaped (&#39; for an apostrophe, &amp; and so on).
const NAMED = { quot: '"', apos: "'", lt: '<', gt: '>', nbsp: '\u00a0', amp: '&' };
export function decodeEntities(s) {
  return (s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&(quot|apos|lt|gt|nbsp|amp);/g, (_, k) => NAMED[k]);
}

// ---- replies and forwards ------------------------------------------------------

export function replySubject(s) { return /^re:/i.test(s) ? s : `Re: ${s}`; }
export function forwardSubject(s) { return /^(fwd?|tr):/i.test(s) ? s : `Fwd: ${s}`; }

export function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h\d|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const quote = (text) => text.split('\n').map((l) => `> ${l}`).join('\n');

export const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
