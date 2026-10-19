// Small helpers shared across screens.

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

// Accepts "a@b.com, Name <c@d.org>; e@f.net" and returns lowercased,
// de-duplicated addresses plus anything that didn't parse.
export function parseRecipients(text) {
  const good = [];
  const bad = [];
  text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).forEach((part) => {
    const angle = part.match(/<([^>]+)>/);
    const addr = (angle ? angle[1] : part).trim().toLowerCase();
    if (EMAIL.test(addr)) { if (!good.includes(addr)) good.push(addr); } else bad.push(part);
  });
  return { good, bad };
}

export const isEmail = (s) => EMAIL.test(s.trim());

// Links always point at the public address (e.g. https://app.chiaramail.com), even
// when the app is opened on its .web.app address. Falls back to the current site.
// The desktop app links to the reader page of its European ECS server.
const PUBLIC_ORIGIN = window.chiaramailDesktop?.ecs?.readerOrigin || import.meta.env.VITE_PUBLIC_ORIGIN || window.location.origin;
export const messageUrl = (id) => new URL(`/m/${id}`, PUBLIC_ORIGIN).toString();
export const homeUrl = () => new URL('/', PUBLIC_ORIGIN).toString();

// The note the sender emails to recipients, containing the link.
export function invitation(t, { id, updated }) {
  return [
    updated ? t('mailUpdated') : t('mailIntro'),
    '',
    messageUrl(id),
    '',
    t('mailSignIn'),
  ].join('\n');
}

export function composeLinks({ to, subject, body }) {
  const enc = encodeURIComponent;
  const toList = to.join(',');
  return {
    mailto: `mailto:${toList.split(',').map(enc).join(',')}?subject=${enc(subject)}&body=${enc(body)}`,
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(toList)}&su=${enc(subject)}&body=${enc(body)}`,
    outlook: `https://outlook.live.com/mail/0/deeplink/compose?to=${enc(toList)}&subject=${enc(subject)}&body=${enc(body)}`,
  };
}

// Splits plain text into paragraphs and turns bare URLs into link parts.
const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
export function toParagraphs(text) {
  return text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((para) =>
    para.split(URL_RE).map((chunk, i) => (i % 2 === 1 ? { href: chunk } : { text: chunk })));
}

export function peopleLabel(t, list, myEmail) {
  const names = list.map((e) => (e === myEmail ? t('you') : e));
  if (names.length <= 2) return names.join(', ');
  return t('andN', { first: names[0], n: names.length - 1 });
}

export const fmtSize = (n) => (!n ? '0 KB' : n >= 1073741824 ? `${+(n / 1073741824).toFixed(1)} GB` : n > 1048576 ? `${+(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
