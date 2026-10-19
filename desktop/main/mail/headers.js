// Raw header block → [{ name, value }] with folded lines joined and RFC 2047
// encoded-words decoded, as the Gmail API returns them.
import libmime from 'libmime';

export function parseHeaders(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString('binary') : String(raw || '');
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line) continue;
    if (/^[ \t]/.test(line) && out.length) { out[out.length - 1].raw += ` ${line.trim()}`; continue; }
    const i = line.indexOf(':');
    if (i <= 0) continue;
    out.push({ name: line.slice(0, i).trim(), raw: line.slice(i + 1).trim() });
  }
  return out.map(({ name, raw: v }) => {
    let value = v;
    // Headers may carry raw UTF-8 bytes (RFC 6532) as well as encoded-words.
    try { value = Buffer.from(v, 'binary').toString('utf8'); } catch { /* keep */ }
    try { value = libmime.decodeWords(value); } catch { /* keep */ }
    return { name, value };
  });
}

export const headerValue = (headers, name) => {
  const n = name.toLowerCase();
  return (headers.find((h) => h.name.toLowerCase() === n) || {}).value || '';
};

/** Message-IDs in a References / In-Reply-To header, lowercased, without brackets. */
export const msgIds = (v) => (String(v || '').match(/<[^<>\s]+>/g) || []).map((x) => x.slice(1, -1).toLowerCase());
