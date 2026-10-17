import { useEffect, useSyncExternalStore } from 'react';
import * as gmail from '@gmail';
import * as backend from '@backend';
import { sanitizeRich, richIsEmpty } from '../richtext.js';

// The user's email signature, added to new messages, replies and forwards as Gmail does.
// It's kept with the user's ChiaraMail settings (prefs/{uid}), so every device uses the same
// one. Until they set one here, ChiaraMail starts from the signature set in Gmail.
// ChiaraMail can read Gmail's signature but not change it (that would need another permission).
const LOCAL = 'chiaramail.signature'; // fallback when not signed in to ChiaraMail's storage
let state = { loaded: false, html: '', uid: undefined };
const subs = new Set();
const set = (s) => { state = { ...state, ...s }; subs.forEach((f) => f()); };

function readLocal() {
  try { const v = localStorage.getItem(LOCAL); return v == null ? null : v; } catch { return null; }
}

async function load(uid) {
  if (state.uid === uid && state.loaded) return;
  set({ uid, loaded: false });
  let html = null;
  if (uid) html = await backend.getPrefs(uid).then((p) => (p && typeof p.signature === 'string' ? p.signature : null)).catch(() => null);
  if (html == null) html = readLocal();
  if (html == null) html = await gmail.getGmailSignature().catch(() => '');
  if (state.uid === uid) set({ loaded: true, html: richIsEmpty(html) ? '' : sanitizeRich(html) });
}

export async function saveSignature(html) {
  const clean = richIsEmpty(html) ? '' : sanitizeRich(html);
  if (state.uid) await backend.savePrefs(state.uid, { signature: clean });
  try { localStorage.setItem(LOCAL, clean); } catch { /* private mode */ }
  set({ html: clean, loaded: true });
}

// { loaded, html } for the signed-in user; loads it the first time it's asked for.
export function useSignature(uid) {
  useEffect(() => { load(uid || null); }, [uid]);
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state, () => state);
}

// The signature as it goes into a message: a blank line, Gmail's "-- " line, then the signature.
export const signatureBlock = (html) => (html ? `<div><br></div><div>-- </div>${html}` : '');
