// Gmail's website reads a search loosely: "sean_welch" also finds "Sean Welch". The Gmail
// API that ChiaraMail uses takes the words literally, so a bare word joined by underscores
// is widened here to "that word, or the same words as a phrase", in Gmail's own syntax:
//   sean_welch  →  {sean_welch "sean welch"}
// Operators (from:sean_welch), quoted phrases, exclusions (-x) and email addresses are left alone.
export function widenQuery(q) {
  if (!q || !q.includes('_')) return q;
  return q.replace(/"[^"]*"|\S+/g, (tok) => {
    if (tok.startsWith('"') || tok.startsWith('-') || tok.includes(':') || tok.includes('@')) return tok;
    if (/[{}()]/.test(tok) || !/[^_]_+[^_]/.test(tok)) return tok;
    const words = tok.split(/_+/).filter(Boolean);
    if (words.length < 2) return tok;
    return `{${tok} "${words.join(' ')}"}`;
  });
}
