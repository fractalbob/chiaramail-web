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

// The start screen (index.html, installed app only) stays briefly so the name can be read,
// then fades out over the app.
const splash = document.getElementById('splash');
if (splash) {
  const shown = getComputedStyle(splash).display !== 'none';
  const wait = shown ? Math.max(0, 900 - performance.now()) : 0;
  setTimeout(() => {
    splash.classList.add('splash-out');
    setTimeout(() => splash.remove(), shown ? 400 : 0);
  }, wait);
}
