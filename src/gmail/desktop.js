// Desktop app (vite --mode desktop): the same functions as api.js, carried out
// by the app's own process over IMAP/SMTP with the person's mail provider
// (desktop/main/mail/service.js). Nothing goes through Google.
import * as backend from '@backend';
import { busy } from '../busy.js';

export const mode = 'desktop';
const bridge = window.chiaramailDesktop;
let account = bridge?.account || null; // { email, name, imap, smtp, user } or null

const unwrap = (r) => {
  if (r?.error) throw Object.assign(new Error(r.error.message), r.error);
  return r?.ok;
};
const call = (method, ...args) => busy(async () => unwrap(await bridge.call(method, args)));

/** The account saved on this computer, if any (signed in again silently). */
export function restore() {
  if (!account) return null;
  backend.signInWithGoogleAccessToken(account.email, account.name); // the session follows the mail account
  return account.email;
}
export const lastAccount = () => account?.email || '';
export const savedAccount = () => account;

/** Finds the servers for an address: { imap, smtp, provider } | { note } | null. */
export const detect = async (email) => unwrap(await bridge.detect(email));

/** { email, password, name?, user?, imap?, smtp? } — checks the servers, then saves. */
export async function connect(cfg) {
  account = unwrap(await bridge.connect(cfg));
  await backend.signInWithGoogleAccessToken(account.email, account.name);
  return account.email;
}

export async function disconnect() {
  unwrap(await bridge.signOut());
  account = null;
  await backend.signOut();
}

export const getProfile = () => call('getProfile');
export const getGmailSignature = () => call('getGmailSignature');
export const listLabels = () => call('listLabels');
export const getLabel = (id) => call('getLabel', id);
export const createLabel = (name) => call('createLabel', name);
export const listThreads = (opts) => call('listThreads', opts);
export const getThreadsMeta = (ids) => call('getThreadsMeta', ids);
export const getThread = (id) => call('getThread', id);
export const getRawMessage = (id) => call('getRawMessage', id);
export const recentAddresses = (q, max) => call('recentAddresses', q, max);
export const getAttachment = (messageId, attachmentId) => call('getAttachment', messageId, attachmentId);
export const modifyThread = (id, add = [], remove = []) => call('modifyThread', id, add, remove);
export const trashThread = (id) => call('trashThread', id);
export const untrashThread = (id) => call('untrashThread', id);
export const listDrafts = (opts = {}) => call('listDrafts', opts);
export const getDraft = (id) => call('getDraft', id);
export const getDraftsMeta = (ids) => call('getDraftsMeta', ids);
export const createDraft = (raw) => call('createDraft', raw);
export const updateDraft = (id, raw) => call('updateDraft', id, raw);
export const deleteDraft = (id) => call('deleteDraft', id);
export const findDraftId = (messageId) => call('findDraftId', messageId);
export const sendRaw = (raw) => call('sendRaw', raw);
