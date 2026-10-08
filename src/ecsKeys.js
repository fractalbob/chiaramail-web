// Keys for the web page an ECS message links to. The key arrives in the
// link's fragment (#k=…), which is never sent to any server; it's kept in this
// browser so it survives signing in (the email-link sign-in reloads the page).
import { isKey } from './ecsCrypto.js';

const K = (id) => `chiaramail.ecsKey.${id}`;

export function keyFor(id) {
  const m = /[#&]k=([A-Za-z0-9_-]{43})/.exec(window.location.hash || '');
  if (m) {
    try { localStorage.setItem(K(id), m[1]); } catch { /* private mode */ }
    return m[1];
  }
  try { const k = localStorage.getItem(K(id)); return isKey(k) ? k : null; } catch { return null; }
}
