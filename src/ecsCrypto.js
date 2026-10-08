// End-to-end encryption for ECS content (pure; no app dependencies).
//
// Each ECS message gets its own random 256-bit AES-GCM key, made in the
// sender's browser. The text, subject, attachment names and files are
// encrypted with it before they leave the browser, so ChiaraMail stores only
// ciphertext. The key travels in the email (a header, and the link fragment
// after '#', which browsers never send to a server): the email alone has a key
// but no content, ChiaraMail alone has content but no key.

const te = new TextEncoder();
const td = new TextDecoder();
const PREFIX = 'e1.';

export const toB64url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const fromB64url = (s) => {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b + '='.repeat((4 - (b.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

export const isKey = (k) => typeof k === 'string' && /^[A-Za-z0-9_-]{43}$/.test(k);
export function newKey() {
  return toB64url(crypto.getRandomValues(new Uint8Array(32)));
}

const cache = new Map();
function cryptoKey(raw) {
  if (!isKey(raw)) return Promise.reject(Object.assign(new Error('Missing or invalid key'), { code: 'no-key' }));
  if (!cache.has(raw)) cache.set(raw, crypto.subtle.importKey('raw', fromB64url(raw), 'AES-GCM', false, ['encrypt', 'decrypt']));
  return cache.get(raw);
}

// bytes → iv (12) ‖ ciphertext+tag
export async function encryptBytes(raw, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(raw), bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}
export async function decryptBytes(raw, data) {
  const d = data instanceof Uint8Array ? data : new Uint8Array(data);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: d.subarray(0, 12) }, await cryptoKey(raw), d.subarray(12));
  return new Uint8Array(pt);
}

export const isEncrypted = (s) => typeof s === 'string' && s.startsWith(PREFIX);
export async function encryptText(raw, text) {
  return PREFIX + toB64url(await encryptBytes(raw, te.encode(text || '')));
}
// Plain (older, unencrypted) values pass through unchanged.
export async function decryptText(raw, s) {
  if (!isEncrypted(s)) return s || '';
  return td.decode(await decryptBytes(raw, fromB64url(s.slice(PREFIX.length))));
}
