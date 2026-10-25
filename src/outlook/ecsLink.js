// Finds the ECS message an email points to: the reader link the sender's
// ChiaraMail put in it, https://<this server>/m/<id>#k=<key>. Outlook can wrap
// links (Safe Links: …safelinks.protection.outlook.com/?url=<encoded link>), so
// encoded copies are looked at too.
const ID = '[A-Za-z0-9]{20}';
const KEY = '[A-Za-z0-9_-]{43}';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function findEcsLink(html, origin) {
  const re = new RegExp(`${esc(origin)}/m/(${ID})#k=(${KEY})`);
  const texts = [String(html || '')];
  for (const m of String(html || '').matchAll(/(?:href=["']|url=)([^"'\s<>]+)/gi)) {
    let s = m[1].replace(/&amp;/g, '&');
    for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(s); i += 1) {
      try { s = decodeURIComponent(s); } catch { break; }
    }
    texts.push(s);
  }
  for (const s of texts) {
    const m = re.exec(s);
    if (m) return { id: m[1], key: m[2], link: `${origin}/m/${m[1]}#k=${m[2]}` };
  }
  return null;
}
