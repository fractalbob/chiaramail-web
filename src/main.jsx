import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from './i18n.jsx';
import App from './App.jsx';
import '@fontsource-variable/literata/opsz.css';
import '@fontsource-variable/literata/opsz-italic.css';
import '@fontsource-variable/schibsted-grotesk/index.css';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
);

// The installed app, back after a long sleep (overnight, say): start afresh rather than carry on in a copy
// that the phone froze hours ago, unless a message is being written.
const STALE_MS = 30 * 60 * 1000;
let hiddenAt = document.hidden ? Date.now() : 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  const away = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = 0;
  const writing = /^\/compose|\/edit$/.test(location.pathname);
  if (away > STALE_MS && matchMedia('(display-mode: standalone)').matches && !writing) { location.reload(); return; }
  checkForUpdate(); // while writing, the update waits until the message is left
});

// A new version deployed while this copy was open (a phone keeps the app in memory for days):
// each time it comes back on screen, compare its own code with the site's, and if they differ,
// start the new one, unless a message is being written.
const myCode = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src');
let lastCheck = 0;
async function checkForUpdate() {
  if (!myCode || Date.now() - lastCheck < 60 * 1000) return;
  lastCheck = Date.now();
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text();
    const live = html.match(/<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/)?.[1]
      || html.match(/<script[^>]+src="([^"]*\/assets\/[^"]+)"[^>]+type="module"/)?.[1];
    if (live && live !== myCode) updateWaiting = true;
    reloadIfFree();
  } catch { /* offline: try next time */ }
}
// Found while a message was being written: applied as soon as the person leaves it.
let updateWaiting = false;
function reloadIfFree() {
  if (updateWaiting && !/^\/compose|\/edit$/.test(location.pathname)) location.reload();
}
setInterval(reloadIfFree, 2000);
// And looked for every 10 minutes while the app stays open on screen.
setInterval(() => { if (!document.hidden) checkForUpdate(); }, 10 * 60 * 1000);
