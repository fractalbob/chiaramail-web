import { useSyncExternalStore } from 'react';

// Reader preferences kept in this browser. Changing one updates every open view.
const KEY = 'chiaramail.alwaysImages';
const subs = new Set();
const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

export function setAlwaysImages(on) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

export function useAlwaysImages() {
  return useSyncExternalStore((f) => {
    subs.add(f);
    const onStorage = (e) => { if (e.key === KEY) f(); };
    window.addEventListener('storage', onStorage);
    return () => { subs.delete(f); window.removeEventListener('storage', onStorage); };
  }, read, () => false);
}
