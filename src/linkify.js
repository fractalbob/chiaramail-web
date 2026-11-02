// Finding web addresses in plain text, so they can be turned into real links.
// No DOM here, so it can be unit-tested in Node (tests/linkify.test.js).

// Addresses without "https://" or "www." (play.p3nto.com) are only recognised
// with a common domain ending, so "e.g." or "file.txt" never become links.
const TLDS = 'com|org|net|edu|gov|int|info|biz|io|app|dev|ai|co|me|tv|eu|fr|uk|de|it|es|ch|be|nl|lu|at|pt|ie|se|no|dk|fi|pl|cz|gr|ca|us|au|nz|jp|cn|in|br|mx|ar|ru|xyz|online|site|tech|store|blog|news|shop|page|web|cloud|email|link|live';
const BARE = `(?<![@\\w./:-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS})(?![a-z0-9@-])(?::\\d+)?(?:[/?#][^\\s<>"]*)?`;
const FIND = new RegExp(`\\b(?:https?:\\/\\/|www\\.)[^\\s<>"]+|${BARE}`, 'gi');
export const MAYBE = /https?:\/\/|www\.|\.[a-z]{2,}/i; // cheap check before the full search
const TRAIL = /[.,;:!?'"’”*]$/;

// The end of a match that isn't part of the address: closing punctuation, and a
// bracket only when the address didn't open one ("(see https://x.com/a_(b))").
function trim(url) {
  for (;;) {
    if (TRAIL.test(url)) { url = url.slice(0, -1); continue; }
    const last = url.slice(-1);
    const open = { ')': '(', ']': '[', '}': '{' }[last];
    if (open && url.split(last).length > url.split(open).length) { url = url.slice(0, -1); continue; }
    return url;
  }
}

export const hrefFor = (url) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

// Is this a whole address worth linking? ("https://" alone or "www." alone isn't.)
function usable(url) {
  const host = url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0].replace(/:\d+$/, '');
  return /^[^.\s]+(\.[^.\s]+)*\.[a-z]{2,}$/i.test(host) || /^localhost$|^\d{1,3}(\.\d{1,3}){3}$/i.test(host);
}

// Text → pieces: { text } for ordinary text, { text, href } for an address.
export function splitLinks(text) {
  const out = [];
  let at = 0;
  for (const m of (text || '').matchAll(FIND)) {
    const url = trim(m[0]);
    if (!usable(url)) continue;
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: url, href: hrefFor(url) });
    at = m.index + url.length;
  }
  if (at < (text || '').length) out.push({ text: text.slice(at) });
  return out;
}

// The address at the end of `text` (the word just typed), allowing closing
// punctuation after it ("…p3nto.com." at the end of a sentence).
export function linkAtEnd(text) {
  const parts = splitLinks(text);
  let tail = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.href) return { start: text.length - tail - p.text.length, end: text.length - tail, ...p };
    if (!/^[.,;:!?'"\u2019\u201d)\]}*]*$/.test(p.text)) return null;
    tail += p.text.length;
  }
  return null;
}
