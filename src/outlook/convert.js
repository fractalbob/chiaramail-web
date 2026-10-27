// Turns the message being written in Outlook into an ECS message: its text and
// attachments are encrypted and stored by ChiaraMail, and the email becomes a
// short note with a link to them. Used by the task pane (the button) and by
// the send handler (events.js), when ECS is on for the message.
import * as backend from '@backend';
import { createEcs } from '../ecs.js';
import { storeRich, richIsEmpty } from '../richtext.js';
import { b64ToBytes, bytesToB64, escapeHtml, CONTENT_POINTER, CONTENT_KEY } from '../gmail/mime.js';
import { fmtSize } from '../lib.js';
import * as office from './office.js';

const MAX_FILES = 20;
const MAX_RECIPIENTS = 50;

// Outlook's own attachments → files for ChiaraMail. Attached emails and
// meeting requests become .eml and .ics files.
async function readFiles(list) {
  return Promise.all(list.map(async (a) => {
    const c = await office.getAttachmentContent(a.id);
    let bytes; let name = a.name || 'attachment'; let type = a.contentType || 'application/octet-stream';
    if (c.format === 'base64') bytes = b64ToBytes(c.content);
    else {
      bytes = new TextEncoder().encode(c.content);
      if (c.format === 'eml') { type = 'message/rfc822'; if (!/\.eml$/i.test(name)) name += '.eml'; }
      if (c.format === 'iCalendar') { type = 'text/calendar'; if (!/\.ics$/i.test(name)) name += '.ics'; }
    }
    return { id: a.id, name, type, size: bytes.length, bytes, isInline: !!a.isInline, base64: c.format === 'base64' ? c.content : null };
  }));
}

// The note that replaces the body: what recipients' mail programs show
// (the same wording as the ChiaraMail apps).
function noteHtml(t, { name, subject, link }) {
  const intro = t('ecsMailIntro', { name, subject: subject || t('noSubject') });
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">
<p>${escapeHtml(intro)}</p>
<p>${escapeHtml(t('ecsMailRead'))} <a href="${link}">${escapeHtml(t('liveFallbackButton'))}</a></p>
<p style="color:#666;font-size:13px">${escapeHtml(t('ecsMailAbout'))}</p></div>`;
}

/** The message a person should see for a failed conversion. */
export function convertError(t, e) {
  if (e.shown) return e.message;
  if (e.code === 'quota') return t('ecsQuota', { quota: fmtSize(e.quota), need: fmtSize(e.need), left: fmtSize(Math.max(0, e.quota - e.used)) });
  return t('errorGeneric', { msg: e.message });
}

/**
 * Converts the open message. Returns { id, html, files }, what Undo needs to put
 * it back. On failure nothing is left half done: the stored copy is deleted and
 * the email put back as it was. Errors meant for the person carry .shown.
 */
export async function convertToEcs({ user, t, allowForward, onProgress }) {
  let made = null; let original = null;
  const removed = []; let bodySet = false;
  try {
    const [to, cc, bcc, subject, html, atts] = await Promise.all([
      office.getRecipients('to'), office.getRecipients('cc'), office.getRecipients('bcc'),
      office.getSubject(), office.getBodyHtml(), office.getAttachments(),
    ]);
    const fail = (msg) => { throw Object.assign(new Error(msg), { shown: true }); };
    if (bcc.length) fail(t('ol_bcc'));
    const recipients = [...new Set([...to, ...cc].map((r) => r.email).filter(Boolean))];
    if (!recipients.length) fail(t('needRecipient'));
    if (recipients.length > MAX_RECIPIENTS) fail(t('tooMany'));
    const cloud = atts.find((a) => a.attachmentType === 'cloud');
    if (cloud) fail(t('ol_cloud', { name: cloud.name }));
    if (atts.length > MAX_FILES) fail(t('tooManyFiles', { n: MAX_FILES }));
    if (atts.some((a) => a.size > backend.MAX_FILE)) fail(t('tooBigEcs'));
    if (richIsEmpty(html) && !atts.length) fail(t('needBody'));
    original = html;
    const files = await readFiles(atts);
    if (files.some((f) => f.size > backend.MAX_FILE)) fail(t('tooBigEcs'));
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total) {
      const u = await backend.getUsage().catch(() => null);
      if (u && u.used + total > u.quota) fail(t('ecsQuota', { quota: fmtSize(u.quota), need: fmtSize(total), left: fmtSize(Math.max(0, u.quota - u.used)) }));
    }

    made = await createEcs(user, { recipients, subject: (subject || '').trim(), body: storeRich(html), allowForward, files }, onProgress);
    // This server's own reader page (not VITE_PUBLIC_ORIGIN, which is the Gmail version's address).
    const link = `${window.location.origin}/m/${made.id}#k=${made.key}`;
    const who = office.me().name || user.email;
    for (const f of files) { await office.removeAttachment(f.id); removed.push(f); }
    await office.setBodyHtml(noteHtml(t, { name: who, subject: (subject || '').trim(), link }));
    bodySet = true;
    await office.setHeaders({ [CONTENT_POINTER]: made.id, [CONTENT_KEY]: made.key }).catch(() => {}); // the link alone is enough
    return { id: made.id, html, files };
  } catch (e) {
    if (made) {
      // Stored but not finished: the stored copy goes, and the email is put back as it was.
      await backend.deleteMessage(made.id).catch(() => {});
      if (bodySet) await office.setBodyHtml(original).catch(() => {});
      for (const f of removed) await office.addAttachment(f.base64 || bytesToB64(f.bytes), f.name, f.isInline).catch(() => {});
    }
    throw e;
  }
}

/** Puts a converted message back as it was written, and deletes the stored copy. */
export async function undoConvert(r) {
  await office.setBodyHtml(r.html);
  for (const f of r.files) await office.addAttachment(f.base64 || bytesToB64(f.bytes), f.name, f.isInline);
  await office.removeHeaders([CONTENT_POINTER, CONTENT_KEY]).catch(() => {});
  await backend.deleteMessage(r.id).catch(() => {});
}
