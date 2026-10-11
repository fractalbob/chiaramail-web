// Busy cursor for things the user started: a request that begins just after a
// click, tap, Enter or form submit (or while another such request is still
// running) shows the "progress" cursor until it finishes. Background refreshes
// stay invisible. A short delay avoids flicker on quick actions.
let pending = 0;
let userUntil = 0;
let timer = null;

const markUser = () => { userUntil = Date.now() + 1500; };
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', markUser, true);
  window.addEventListener('submit', markUser, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') markUser(); }, true);
}

function apply() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (pending > 0) {
    if (!timer && !root.classList.contains('busy')) timer = setTimeout(() => { timer = null; if (pending > 0) root.classList.add('busy'); }, 150);
  } else {
    clearTimeout(timer); timer = null;
    root.classList.remove('busy');
  }
}

/** Run fn(); if the user just asked for it, show the busy cursor meanwhile. */
export async function busy(fn) {
  if (pending === 0 && Date.now() > userUntil) return fn();
  pending += 1; apply();
  try { return await fn(); } finally { pending -= 1; apply(); }
}
