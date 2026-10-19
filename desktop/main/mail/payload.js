// IMAP BODYSTRUCTURE → the Gmail API's message "payload" tree, so the app's
// renderer (src/gmail/mime.js) reads IMAP mail exactly as it reads Gmail.
// Text parts carry their content (filled in by the caller); everything else
// gets an attachmentId — the IMAP part number — fetched on demand.

const quote = (v) => (/[\s;"()<>@,:\\/[\]?=]/.test(v) ? `"${String(v).replace(/"/g, '\\"')}"` : v);
const params = (p) => Object.entries(p || {}).map(([k, v]) => `; ${k}=${quote(v)}`).join('');

export function partHeaders(node) {
  const h = [{ name: 'Content-Type', value: `${node.type || 'text/plain'}${params(node.parameters)}` }];
  if (node.encoding) h.push({ name: 'Content-Transfer-Encoding', value: node.encoding });
  if (node.disposition) h.push({ name: 'Content-Disposition', value: `${node.disposition}${params(node.dispositionParameters)}` });
  if (node.id) h.push({ name: 'Content-ID', value: node.id });
  return h;
}

const filenameOf = (n) => n.dispositionParameters?.filename || n.parameters?.name || '';
export const isTextBody = (n) => !n.childNodes && /^text\/(plain|html)$/i.test(n.type || '')
  && (n.disposition || '').toLowerCase() !== 'attachment' && !filenameOf(n);

/** Walks a bodyStructure; calls visit(node, partId) on each leaf. */
export function leaves(node, visit, part = '') {
  const id = node.part || part || '1';
  if (node.childNodes) node.childNodes.forEach((c, i) => leaves(c, visit, c.part || (part ? `${part}.${i + 1}` : `${i + 1}`)));
  else visit(node, id);
}

/**
 * texts: { [partId]: Buffer } — decoded content of the text bodies.
 * rootHeaders: the message's own headers.
 */
export function toPayload(node, rootHeaders, texts = {}, part = '') {
  const id = node.part || part || '1';
  const p = {
    partId: part || '',
    mimeType: (node.type || 'text/plain').toLowerCase(),
    filename: node.childNodes ? '' : filenameOf(node),
    headers: rootHeaders || partHeaders(node),
    body: { size: node.size || 0 },
  };
  if (node.childNodes) {
    p.parts = node.childNodes.map((c, i) => toPayload(c, null, texts, c.part || (part ? `${part}.${i + 1}` : `${i + 1}`)));
    return p;
  }
  // A single-part message: the root headers must still describe the content.
  if (rootHeaders && !rootHeaders.some((h) => h.name.toLowerCase() === 'content-type')) p.headers = [...rootHeaders, ...partHeaders(node)];
  if (texts[id]) {
    // Content arrives already converted to UTF-8, so say so (the renderer decodes by charset).
    p.headers = p.headers.map((h) => (h.name.toLowerCase() === 'content-type' ? { name: h.name, value: `${node.type}; charset=utf-8` } : h));
    p.body = { size: texts[id].length, data: texts[id].toString('base64url') };
  } else {
    p.body = { size: node.size || 0, attachmentId: id };
  }
  return p;
}
