// The part of the Outlook add-in that Outlook runs by itself, without the task
// pane (outlook-events.html; manifest LaunchEvent). It works only where an
// organisation's administrator installed the add-in, in Outlook on the web, new
// Outlook for Windows and Outlook for Mac.
//  - A new message: unless the person turned ECS off by default, a bar says it
//    will be sent as an ECS message.
//  - Send: if ECS is on for the message, its text and attachments are encrypted
//    and stored, and the email becomes the short note with the link, before it
//    leaves. If that can't be done (not signed in, a Bcc, too big…), Outlook asks
//    the person what to do, saying why.
import * as backend from '@backend';
import { makeT } from '../i18n.jsx';
import { findEcsLink } from './ecsLink.js';
import { convertToEcs, convertError } from './convert.js';
import * as office from './office.js';
import * as prefs from './prefs.js';

// The signed-in ChiaraMail user (shared with the task pane), or null.
const whoIsIn = () => new Promise((resolve) => {
  const stop = backend.onUserChanged((u) => {
    if (u === undefined) return;
    stop();
    resolve(u);
  });
});

async function onNewMessageCompose(event) {
  try {
    const t = makeT();
    await prefs.markAuto();
    const on = prefs.ecsByDefault();
    await prefs.setWantsEcs(on);
    await prefs.showEcsBar(t, on);
  } finally {
    event.completed();
  }
}

async function onMessageSend(event) {
  const t = makeT();
  // When it can't be sent as an ECS message, the button besides Send anyway opens the pane.
  const stop = (message) => event.completed({
    allowEvent: false, errorMessage: message.slice(0, 500),
    ...(office.supports('1.14') ? { cancelLabel: t('ol_openPane'), commandId: 'composeButton' } : {}),
  });
  try {
    if (!(await prefs.wantsEcs())) { event.completed({ allowEvent: true }); return; }
    // Already converted with the pane's button.
    if (findEcsLink(await office.getBodyHtml(), window.location.origin)) { event.completed({ allowEvent: true }); return; }
    const user = await whoIsIn();
    if (!user) { stop(t('ol_sendSignIn')); return; }
    const from = await office.sendingAddress();
    if (from && user.email !== from) { stop(t('ol_sendOther', { mailbox: from, email: user.email })); return; }
    await convertToEcs({ user, t, allowForward: await prefs.allowsForward() });
    await prefs.showEcsBar(t, false);
    event.completed({ allowEvent: true });
  } catch (e) {
    stop(t('ol_sendFailed', { why: convertError(t, e) }));
  }
}

window.Office?.onReady?.();
window.Office?.actions?.associate('onNewMessageComposeHandler', onNewMessageCompose);
window.Office?.actions?.associate('onMessageSendHandler', onMessageSend);
