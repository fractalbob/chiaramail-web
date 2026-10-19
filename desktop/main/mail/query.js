// A Gmail-style search ("from:paul subject:\"print sizes\" is:unread julia")
// split into terms, each an imapflow SEARCH object. The service runs one
// IMAP SEARCH per term and intersects the results (minus negated terms), so
// any number of words and operators combine with AND, as in Gmail.
// in:<folder> and label:<name> pick folders; Gmail-only category: is ignored.
const TOKEN = /(-?)(\w+:)?("[^"]*"|\{[^}]*\}|\S+)/g;

const day = (v) => { const d = new Date(v.replace(/\//g, '-')); return Number.isNaN(d.getTime()) ? null : d; };

export function parseQuery(q) {
  const out = { terms: [], inFolder: null, label: null };
  for (const m of String(q || '').matchAll(TOKEN)) {
    const neg = m[1] === '-';
    const op = (m[2] || '').slice(0, -1).toLowerCase();
    let val = m[3];
    if (val.startsWith('{')) val = (val.slice(1, -1).match(/"[^"]*"|\S+/) || [''])[0]; // {a "b"}: first alternative
    val = val.replace(/^"|"$/g, '');
    if (!val) continue;
    let c = null;
    switch (op) {
      case 'from': case 'to': case 'cc': case 'bcc': case 'subject': c = { [op]: val }; break;
      case 'in': if (!neg) out.inFolder = val.toLowerCase(); break;
      case 'label': if (!neg) out.label = val; break;
      case 'category': break;
      case 'is':
        if (val === 'unread') c = { seen: false };
        else if (val === 'read') c = { seen: true };
        else if (val === 'starred') c = { flagged: true };
        else if (val === 'important') c = { keyword: '$Important' };
        break;
      case 'has':
        if (val === 'attachment') c = { header: { 'content-type': 'multipart/mixed' } };
        break;
      case 'after': case 'since': { const d = day(val); if (d) c = { since: d }; break; }
      case 'before': { const d = day(val); if (d) c = { before: d }; break; }
      case 'rfc822msgid': c = { header: { 'message-id': val } }; break;
      case '': c = { text: val }; break;
      default: c = { text: `${op}:${val}` };
    }
    if (c) out.terms.push({ neg, criteria: c });
  }
  return out;
}
