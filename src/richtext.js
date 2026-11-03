// Formatted text (bold, italic, underline, lists, links, quotes) for message bodies.
// The editor produces a small subset of HTML; nothing else ever gets through.
// ECS bodies are stored (encrypted) with RICH_MARK in front, so messages written
// before formatting existed are still read as plain text.
import DOMPurify from 'dompurify';
import { escapeHtml } from './gmail/mime.js';
import { splitLinks, MAYBE } from './linkify.js';

export const RICH_MARK = '<!--cm-rich-->';
const TAGS = ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'a', 'ul', 'ol', 'li', 'p', 'div', 'br', 'blockquote', 'span'];
const BLOCKS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE']);

// Text and background colours (from the editor's colour menu) are the only styles
// kept: a style attribute is cut down to color/background-color with plain values.
// The hook only acts while sanitizeRich runs, so other DOMPurify uses are untouched.
let styleMode = null; // null: not ours · 'colors': keep colours · 'none': no styles at all
const COLOR_PROPS = new Set(['color', 'background-color']);
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)|[a-z]{3,20})$/i;
export function onlyColors(style) {
  return (style || '').split(';').map((d) => {
    const i = d.indexOf(':');
    if (i < 0) return '';
    const prop = d.slice(0, i).trim().toLowerCase();
    const val = d.slice(i + 1).trim();
    return COLOR_PROPS.has(prop) && SAFE_COLOR.test(val) ? `${prop}: ${val}` : '';
  }).filter(Boolean).join('; ');
}
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (!styleMode || data.attrName !== 'style') return;
  const v = styleMode === 'colors' ? onlyColors(data.attrValue) : '';
  if (v) data.attrValue = v; else data.keepAttr = false;
});

function sanitizeWith(html, mode) {
  styleMode = mode;
  try {
    return DOMPurify.sanitize(html || '', {
      ALLOWED_TAGS: TAGS,
      ALLOWED_ATTR: ['href', 'style'],
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
      KEEP_CONTENT: true,
    });
  } finally { styleMode = null; }
}
export const sanitizeRich = (html) => sanitizeWith(html, 'colors');
// What a paste may bring in: basic formatting, but none of the source page's colours.
export const sanitizePaste = (html) => sanitizeWith(html, 'none');

export const isRich = (body) => typeof body === 'string' && body.startsWith(RICH_MARK);

// Plain text → editor HTML, one <div> per line (as the editor itself writes it).
export function textToRich(text) {
  return (text || '').replace(/\r\n/g, '\n').split('\n')
    .map((l) => `<div>${l ? escapeHtml(l) : '<br>'}</div>`).join('');
}

// A stored ECS body → HTML for the editor or the reader.
export const bodyHtml = (body) => (isRich(body) ? sanitizeRich(body.slice(RICH_MARK.length)) : textToRich(body));

// Web addresses typed or pasted as plain text become real links (text already
// inside a link is left alone). Runs on everything we send or store.
function linkifyDoc(doc) {
  const texts = [];
  const tw = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  while (tw.nextNode()) if (!tw.currentNode.parentElement.closest('a') && MAYBE.test(tw.currentNode.nodeValue)) texts.push(tw.currentNode);
  texts.forEach((t) => {
    const parts = splitLinks(t.nodeValue);
    if (!parts.some((p) => p.href)) return;
    const frag = doc.createDocumentFragment();
    parts.forEach((p) => {
      if (!p.href) { frag.appendChild(doc.createTextNode(p.text)); return; }
      const a = doc.createElement('a'); a.href = p.href; a.textContent = p.text; frag.appendChild(a);
    });
    t.replaceWith(frag);
  });
}
export function linkifyHtml(html) {
  if (!MAYBE.test(html || '')) return html || '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  linkifyDoc(doc);
  return doc.body.innerHTML;
}

// Editor HTML → what an ECS body stores.
export const storeRich = (html) => RICH_MARK + sanitizeRich(linkifyHtml(html));

// Formatted HTML → readable plain text (for the text part of an email, quoting, checks).
export function richToText(html) {
  const root = new DOMParser().parseFromString(`<body>${sanitizeRich(html)}</body>`, 'text/html').body;
  return walk(root).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\s+$/g, '');
}
function walk(node) {
  let out = '';
  const breakLine = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  node.childNodes.forEach((n) => {
    if (n.nodeType === 3) { out += n.nodeValue.replace(/\u00a0/g, ' '); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (tag === 'BR') { out += '\n'; return; }
    if (tag === 'BLOCKQUOTE') {
      breakLine();
      out += walk(n).replace(/\n+$/, '').split('\n').map((l) => `> ${l}`).join('\n');
      out += '\n';
      return;
    }
    if (tag === 'LI') {
      breakLine();
      const ol = n.parentNode?.tagName === 'OL';
      const k = Array.prototype.indexOf.call(n.parentNode.children, n) + 1;
      out += `${ol ? `${k}.` : '•'} ${walk(n).replace(/\n+$/, '')}\n`;
      return;
    }
    if (tag === 'A') {
      const text = walk(n);
      const href = n.getAttribute('href') || '';
      const bare = href.replace(/^mailto:/i, '');
      out += !href || text.trim() === href || text.trim() === bare ? text : `${text} (${bare})`;
      return;
    }
    if (BLOCKS.has(tag)) {
      breakLine();
      out += walk(n);
      breakLine();
      if (tag === 'P') out += '\n';
      return;
    }
    out += walk(n);
  });
  return out;
}

// An email's HTML back into the editor (drafts): our own outer wrapper is dropped,
// so resuming a draft many times doesn't nest it deeper each time.
export function fromEmailHtml(html) {
  const root = new DOMParser().parseFromString(`<body>${sanitizeRich(html)}</body>`, 'text/html').body;
  const only = root.childNodes.length === 1 && root.firstChild.nodeType === 1 && root.firstChild.tagName === 'DIV';
  return only ? root.firstChild.innerHTML : root.innerHTML;
}

export const richIsEmpty = (html) => !richToText(html).trim();

// The HTML part of an email: quotes styled the way mail programs show them.
export const emailHtml = (html) => `<div dir="auto">${sanitizeRich(linkifyHtml(html))
  .replace(/<blockquote>/g, '<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">')}</div>`;

// For display: links open in a new tab, and bare web addresses become links.
export function displayHtml(body) {
  const doc = new DOMParser().parseFromString(`<body>${bodyHtml(body)}</body>`, 'text/html');
  linkifyDoc(doc);
  doc.querySelectorAll('a').forEach((a) => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer nofollow'); });
  return doc.body.innerHTML;
}
