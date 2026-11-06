// Translating a received message on the reader's own computer, with the browser's built-in
// translator (Chrome's Translator and LanguageDetector APIs). Nothing is sent anywhere: the
// language models run on the device. Where the browser has no translator (phones, for now,
// and other browsers), ChiaraMail simply doesn't offer translation.
const T = () => globalThis.Translator;
const D = () => globalThis.LanguageDetector;

export const canTranslate = () => typeof T()?.create === 'function';

/** The message's text, for guessing its language. */
export function plainOf(message) {
  if (message.text && message.text.trim()) return message.text;
  try { return new DOMParser().parseFromString(message.html || '', 'text/html').body?.textContent || ''; } catch { return ''; }
}

/** The message's language if the detector is ready without a download and is confident, else null.
 *  (A model download needs a click, so a first-time detection waits for the menu's Translate.) */
export async function detectQuietly(text) {
  if (!canTranslate() || typeof D()?.create !== 'function') return null;
  try {
    if ((await D().availability()) !== 'available') return null;
    const det = await D().create();
    const [best] = await det.detect(text.slice(0, 3000));
    det.destroy?.();
    return best && best.detectedLanguage !== 'und' && best.confidence >= 0.7 ? best.detectedLanguage : null;
  } catch { return null; }
}

/** The language, detecting it even if that means downloading the detector (call from a click). */
export async function detect(text, onProgress) {
  const det = await D().create({ monitor: (m) => m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded)) });
  const [best] = await det.detect(text.slice(0, 3000));
  det.destroy?.();
  return best && best.detectedLanguage !== 'und' ? best.detectedLanguage : null;
}

const base = (l) => (l || '').split('-')[0].toLowerCase();
export const sameLanguage = (a, b) => base(a) === base(b);

/** Whether this pair can be translated here: 'available', 'downloadable', 'downloading' or 'unavailable'. */
export async function pairStatus(from, to) {
  try { return await T().availability({ sourceLanguage: base(from), targetLanguage: base(to) }); } catch { return 'unavailable'; }
}

/** A translator for the pair (call from a click: it may download a language model). */
export function translator(from, to, onProgress) {
  return T().create({
    sourceLanguage: base(from), targetLanguage: base(to),
    monitor: (m) => m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded)),
  });
}

const SKIP = new Set(['STYLE', 'SCRIPT', 'NOSCRIPT', 'TITLE', 'CODE', 'PRE', 'TEMPLATE']);

/** Translates an HTML email text node by text node, keeping its layout, links and pictures. */
export async function translateHtml(tr, html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue.trim().length > 1 && !SKIP.has(n.parentNode?.nodeName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const v = n.nodeValue;
    const lead = v.match(/^\s*/)[0];
    const trail = v.match(/\s*$/)[0];
    try { n.nodeValue = lead + await tr.translate(v.trim()) + trail; } catch { /* keep the original words */ }
  }
  // Keep the sender's <style> blocks (in <head>) with the translated body.
  const styles = [...doc.querySelectorAll('head style')].map((s) => s.outerHTML).join('');
  return styles + doc.body.innerHTML;
}

/** Translates plain text paragraph by paragraph, keeping blank lines. */
export async function translateText(tr, text) {
  const parts = text.split(/(\n\s*\n)/);
  const out = [];
  for (const p of parts) {
    if (!p.trim() || /^\n\s*\n$/.test(p)) { out.push(p); continue; }
    try { out.push(await tr.translate(p)); } catch { out.push(p); }
  }
  return out.join('');
}

/** "Italian", "italien"… in the reader's language. */
export function languageName(code, uiLang) {
  try { return new Intl.DisplayNames([uiLang], { type: 'language' }).of(base(code)) || code; } catch { return code; }
}
