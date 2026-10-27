// Promise wrappers for the few Office.js calls the Outlook add-in uses
// (Mailbox requirement set 1.8: Outlook on the web, new Outlook, Outlook 2021+
// for Windows and Mac).
const O = () => window.Office;

const call = (fn) => new Promise((resolve, reject) => {
  fn((r) => {
    if (r.status === O().AsyncResultStatus.Succeeded) resolve(r.value);
    else reject(Object.assign(new Error(r.error?.message || 'Outlook refused the request'), { code: r.error?.name || 'office' }));
  });
});

export const mailbox = () => O().context.mailbox;
export const item = () => mailbox().item;
/** Writing a message (compose) rather than reading one. */
export const isCompose = () => !!item() && typeof item().subject === 'object' && typeof item().subject.getAsync === 'function';
export const me = () => ({ email: (mailbox().userProfile?.emailAddress || '').toLowerCase(), name: mailbox().userProfile?.displayName || '' });
/** The address this message goes out from (an outlook.com account's mailbox can have an
 *  internal name, outlook_…@outlook.com, that nobody sees). Falls back to the mailbox's. */
export async function sendingAddress() {
  const it = item();
  try {
    if (isCompose() && it.from?.getAsync) {
      const f = await call((cb) => it.from.getAsync(cb));
      if (f?.emailAddress) return f.emailAddress.toLowerCase();
    }
  } catch { /* older Outlook */ }
  return me().email;
}

// ---- writing --------------------------------------------------------------------
export const getSubject = () => call((cb) => item().subject.getAsync(cb));
export const getRecipients = (field) => call((cb) => item()[field].getAsync(cb))
  .then((list) => (list || []).map((r) => ({ email: (r.emailAddress || '').toLowerCase(), name: r.displayName || '' })));
export const getBodyHtml = () => call((cb) => item().body.getAsync(O().CoercionType.Html, cb));
export const setBodyHtml = (html) => call((cb) => item().body.setAsync(html, { coercionType: O().CoercionType.Html }, cb));
/** [{ id, name, contentType, size, attachmentType: 'file' | 'item' | 'cloud', isInline }] */
export const getAttachments = () => call((cb) => item().getAttachmentsAsync(cb));
/** { format: 'base64' | 'eml' | 'iCalendar' | 'url', content } */
export const getAttachmentContent = (id) => call((cb) => item().getAttachmentContentAsync(id, cb));
export const removeAttachment = (id) => call((cb) => item().removeAttachmentAsync(id, cb));
export const addAttachment = (base64, name, isInline = false) => call((cb) => item().addFileAttachmentFromBase64Async(base64, name, { isInline }, cb));
export const setHeaders = (headers) => call((cb) => item().internetHeaders.setAsync(headers, cb));
export const removeHeaders = (names) => call((cb) => item().internetHeaders.removeAsync(names, cb));

// ---- ECS by default (send handler, events.js) ----------------------------------------
// sessionData (Mailbox 1.11) holds per-message values that both the task pane and the
// send handler can read, and that never travel with the email. roamingSettings follow
// the person to every computer where they use Outlook.
export const supports = (v) => { try { return !!O().context.requirements.isSetSupported('Mailbox', v); } catch { return false; } };
export async function getSession(name) {
  const sd = item()?.sessionData;
  if (!sd?.getAsync) return null;
  try { return (await call((cb) => sd.getAsync(name, cb))) ?? null; } catch { return null; } // not set yet
}
export async function setSession(name, value) {
  const sd = item()?.sessionData;
  if (sd?.setAsync) await call((cb) => sd.setAsync(name, String(value), cb)).catch(() => {});
}
export const getSetting = (name) => { try { return mailbox() && O().context.roamingSettings?.get(name); } catch { return undefined; } };
export async function setSetting(name, value) {
  const rs = O().context.roamingSettings;
  if (!rs) return;
  rs.set(name, value);
  await call((cb) => rs.saveAsync(cb)).catch(() => {});
}
/** The bar above the message (persistent: it stays until removed). */
export async function showBar(key, message) {
  const n = item()?.notificationMessages;
  if (!n) return;
  await call((cb) => n.replaceAsync(key, {
    type: O().MailboxEnums.ItemNotificationMessageType.InformationalMessage,
    message: message.slice(0, 150), icon: 'Icon16', persistent: true,
  }, cb)).catch(() => {});
}
export async function hideBar(key) {
  const n = item()?.notificationMessages;
  if (n) await call((cb) => n.removeAsync(key, cb)).catch(() => {});
}

// ---- reading --------------------------------------------------------------------
export const readBodyHtml = () => call((cb) => item().body.getAsync(O().CoercionType.Html, cb));
export const readFrom = () => ({ email: (item()?.from?.emailAddress || '').toLowerCase(), name: item()?.from?.displayName || '' });
export const replyAll = (html) => item().displayReplyAllForm({ htmlBody: html });

// Pinned task pane: Outlook keeps it open as the reader moves to another message.
// One handler with Outlook, shared by everyone listening here.
const itemListeners = new Set();
let itemHandler = false;
/** Calls cb whenever the open message changes; returns the way to stop. */
export function onItemChanged(cb) {
  itemListeners.add(cb);
  if (!itemHandler) {
    itemHandler = true;
    try { mailbox().addHandlerAsync(O().EventType.ItemChanged, () => itemListeners.forEach((f) => f())); } catch { /* older Outlook: the pane closes instead */ }
  }
  return () => itemListeners.delete(cb);
}
