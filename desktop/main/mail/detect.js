// Finds the IMAP and SMTP servers for an email address, so most people only
// type their address and password. In order:
//   1. well-known providers (by the address's domain, or by its mail servers (MX)
//      for people with their own domain at OVHcloud, Gandi, Infomaniak…);
//   2. the domain's own published settings (DNS SRV records, RFC 6186);
//   3. the domain's own autoconfig file (the format Thunderbird uses);
//   4. the usual names (imap.<domain>, mail.<domain>…), checked by connecting.
// Only the domain is ever looked up, never the address or the password, and
// nothing is asked of any third party: only DNS and the provider's own servers.
import { promises as dns } from 'node:dns';
import tls from 'node:tls';
import net from 'node:net';

const ssl = (host, port = 993) => ({ host, port, security: 'ssl' });
const starttls = (host, port = 587) => ({ host, port, security: 'starttls' });
const P = (imapHost, smtp, name) => ({ name, imap: ssl(imapHost), smtp });

// Settings these providers publish for IMAP/SMTP with a password.
const PROVIDERS = [
  { domains: ['orange.fr', 'wanadoo.fr'], ...P('imap.orange.fr', ssl('smtp.orange.fr', 465), 'Orange') },
  { domains: ['free.fr'], ...P('imap.free.fr', ssl('smtp.free.fr', 465), 'Free') },
  { domains: ['sfr.fr', 'neuf.fr', 'cegetel.net', 'club-internet.fr'], ...P('imap.sfr.fr', ssl('smtp.sfr.fr', 465), 'SFR') },
  { domains: ['laposte.net'], ...P('imap.laposte.net', ssl('smtp.laposte.net', 465), 'La Poste') },
  { domains: ['bbox.fr'], ...P('imap4.bbox.fr', starttls('smtp.bbox.fr'), 'Bouygues Telecom') },
  { domains: ['mailo.com', 'net-c.com', 'net-c.fr'], ...P('mail.mailo.com', ssl('mail.mailo.com', 465), 'Mailo') },
  { domains: ['gmx.fr', 'gmx.com', 'gmx.net', 'gmx.de'], ...P('imap.gmx.com', ssl('mail.gmx.com', 465), 'GMX') },
  { domains: ['yahoo.com', 'yahoo.fr', 'ymail.com'], ...P('imap.mail.yahoo.com', ssl('smtp.mail.yahoo.com', 465), 'Yahoo') },
  { domains: ['icloud.com', 'me.com', 'mac.com'], ...P('imap.mail.me.com', starttls('smtp.mail.me.com'), 'iCloud') },
  { domains: ['gmail.com', 'googlemail.com'], ...P('imap.gmail.com', ssl('smtp.gmail.com', 465), 'Gmail') },
  { mx: /\.mail\.ovh\.net$/i, ...P('ssl0.ovh.net', ssl('ssl0.ovh.net', 465), 'OVHcloud') },
  { mx: /\.ovh\.net$/i, ...P('ssl0.ovh.net', ssl('ssl0.ovh.net', 465), 'OVHcloud') },
  { mx: /\.infomaniak\.ch$/i, ...P('mail.infomaniak.com', ssl('mail.infomaniak.com', 465), 'Infomaniak') },
  { mx: /\.gandi\.net$/i, ...P('mail.gandi.net', ssl('mail.gandi.net', 465), 'Gandi') },
  { mx: /\.ionos\.(fr|com|de)$/i, ...P('imap.ionos.fr', ssl('smtp.ionos.fr', 465), 'IONOS') },
  { mx: /\.protonmail\.ch$/i, name: 'Proton', note: 'proton' },
  { mx: /\.(google|googlemail)\.com$/i, ...P('imap.gmail.com', ssl('smtp.gmail.com', 465), 'Google Workspace') },
  { mx: /\.(outlook|office365)\.com$/i, name: 'Microsoft', note: 'microsoft' },
];
// Microsoft (Outlook.com, Hotmail, Microsoft 365) no longer accepts passwords
// over IMAP; Proton needs its Bridge app. Both are reported, not guessed.
const NO_PASSWORD = { 'outlook.com': 'microsoft', 'hotmail.com': 'microsoft', 'hotmail.fr': 'microsoft', 'live.com': 'microsoft', 'live.fr': 'microsoft', 'msn.com': 'microsoft', 'proton.me': 'proton', 'protonmail.com': 'proton', 'pm.me': 'proton' };

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** Can we reach this server? (TLS handshake for ssl, a greeting for the others.) */
export function reachable({ host, port, security }, ms = 4000) {
  return new Promise((resolve) => {
    let done = false;
    const end = (ok) => { if (!done) { done = true; try { sock.destroy(); } catch { /* ignore */ } resolve(ok); } };
    const sock = security === 'ssl'
      ? tls.connect({ host, port, servername: host }, () => end(true))
      : net.connect({ host, port }, () => sock.once('data', () => end(true)));
    sock.setTimeout(ms, () => end(false));
    sock.on('error', () => end(false));
  });
}

async function fromSrv(domain) {
  const pick = async (name) => {
    const r = (await withTimeout(dns.resolveSrv(name), 3000).catch(() => [])).filter((x) => x.name && x.name !== '.');
    r.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
    return r[0] || null;
  };
  const [imaps, imap, subs, sub] = await Promise.all(['_imaps._tcp', '_imap._tcp', '_submissions._tcp', '_submission._tcp'].map((p) => pick(`${p}.${domain}`)));
  const i = imaps ? ssl(imaps.name, imaps.port) : imap ? { host: imap.name, port: imap.port, security: 'starttls' } : null;
  const s = subs ? ssl(subs.name, subs.port) : sub ? starttls(sub.name, sub.port) : null;
  return i && s ? { imap: i, smtp: s } : null;
}

const SEC = { SSL: 'ssl', STARTTLS: 'starttls', plain: 'none' };
export function parseAutoconfig(xml) {
  const servers = (tag) => [...xml.matchAll(new RegExp(`<${tag}[^>]*type="(imap|smtp)"[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))]
    .map(([, type, body]) => {
      const v = (n) => (body.match(new RegExp(`<${n}>([^<]*)</${n}>`)) || [])[1]?.trim();
      return { type, host: v('hostname'), port: Number(v('port')), security: SEC[v('socketType')] || 'none', user: v('username') };
    })
    .filter((s) => s.host && s.port && s.security !== 'none');
  const imap = servers('incomingServer').find((s) => s.type === 'imap');
  const smtp = servers('outgoingServer').find((s) => s.type === 'smtp');
  if (!imap || !smtp) return null;
  const strip = ({ host, port, security }) => ({ host, port, security });
  return { imap: strip(imap), smtp: strip(smtp), userIsLocalPart: imap.user === '%EMAILLOCALPART%' };
}

async function fromAutoconfig(domain, email) {
  for (const url of [`https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`,
    `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: 'follow' });
      if (!r.ok) continue;
      const c = parseAutoconfig(await r.text());
      if (c) return c;
    } catch { /* next */ }
  }
  return null;
}

async function fromGuess(domain) {
  const imaps = [ssl(`imap.${domain}`), ssl(`mail.${domain}`)];
  const smtps = [ssl(`smtp.${domain}`, 465), starttls(`smtp.${domain}`), ssl(`mail.${domain}`, 465), starttls(`mail.${domain}`)];
  const ok = async (list) => { for (const s of list) if (await reachable(s)) return s; return null; };
  const [imap, smtp] = await Promise.all([ok(imaps), ok(smtps)]);
  return imap && smtp ? { imap, smtp } : null;
}

/**
 * Returns { imap, smtp, provider?, source } or { note: 'microsoft' | 'proton' }
 * or null when nothing was found (the person then types the servers in).
 */
export async function detect(email) {
  const domain = String(email).split('@')[1]?.toLowerCase().trim();
  if (!domain) return null;
  if (NO_PASSWORD[domain]) return { note: NO_PASSWORD[domain] };
  const byDomain = PROVIDERS.find((p) => p.domains?.includes(domain));
  if (byDomain) return { imap: byDomain.imap, smtp: byDomain.smtp, provider: byDomain.name, source: 'known' };
  const mx = (await withTimeout(dns.resolveMx(domain), 3000).catch(() => [])).sort((a, b) => a.priority - b.priority);
  for (const m of mx) {
    const p = PROVIDERS.find((x) => x.mx && x.mx.test(m.exchange));
    if (p?.note) return { note: p.note, provider: p.name };
    if (p) return { imap: p.imap, smtp: p.smtp, provider: p.name, source: 'mx' };
  }
  const srv = await fromSrv(domain);
  if (srv) return { ...srv, source: 'srv' };
  const auto = await fromAutoconfig(domain, email);
  if (auto) return { ...auto, source: 'autoconfig' };
  const guess = await fromGuess(domain);
  if (guess) return { ...guess, source: 'guess' };
  return null;
}
