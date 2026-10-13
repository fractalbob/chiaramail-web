// Formatted text (bold, italic, underline, lists, links, quotes) for message bodies.
// The editor produces a small subset of HTML; nothing else ever gets through.
// ECS bodies are stored (encrypted) with RICH_MARK in front, so messages written
// before formatting existed are still read as plain text.
import DOMPurify from 'dompurify';
import { escapeHtml } from './gmail/mime.js';

export const RICH_MARK = '<!--cm-rich-->';
const TAGS = ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'a', 'ul', 'ol', 'li', 'p', 'div', 'br', 'blockquote'];
const BLOCKS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE']);

export function sanitizeRich(html) {
  return DOMPurify.sanitize(html || '', {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ['href'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
    KEEP_CONTENT: true,
  });
}

export const isRich = (body) => typeof body === 'string' && body.startsWith(RICH_MARK);

// Plain text → editor HTML, one <div> per line (as the editor itself writes it).
export function textToRich(text) {
  return (text || '').replace(/\r\n/g, '\n').split('\n')
    .map((l) => `<div>${l ? escapeHtml(l) : '<br>'}</div>`).join('');
}

// A stored ECS body → HTML for the editor or the reader.
export const bodyHtml = (body) => (isRich(body) ? sanitizeRich(body.slice(RICH_MARK.length)) : textToRich(body));

// Editor HTML → what an ECS body stores.
export const storeRich = (html) => RICH_MARK + sanitizeRich(html);

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
export const emailHtml = (html) => `<div dir="auto">${sanitizeRich(html)
  .replace(/<blockquote>/g, '<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">')}</div>`;

// For display: links open in a new tab, and bare web addresses become links.
const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
export function displayHtml(body) {
  const doc = new DOMParser().parseFromString(`<body>${bodyHtml(body)}</body>`, 'text/html');
  const texts = [];
  const tw = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  while (tw.nextNode()) if (!tw.currentNode.parentElement.closest('a') && /https?:\/\//.test(tw.currentNode.nodeValue)) texts.push(tw.currentNode);
  texts.forEach((t) => {
    const frag = doc.createDocumentFragment();
    t.nodeValue.split(URL_RE).forEach((chunk, i) => {
      if (i % 2) { const a = doc.createElement('a'); a.href = chunk; a.textContent = chunk; frag.appendChild(a); } else if (chunk) frag.appendChild(doc.createTextNode(chunk));
    });
    t.replaceWith(frag);
  });
  doc.querySelectorAll('a').forEach((a) => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer nofollow'); });
  return doc.body.innerHTML;
}
