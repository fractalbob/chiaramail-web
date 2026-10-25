// The ChiaraMail add-in for Outlook (outlook.html), served by the European ECS
// server and shown by Outlook in its task pane. While writing a message it turns
// it into an ECS message; while reading one, it shows the content, and lets its
// sender edit or withdraw it. Same sign-in and server as the reader page.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import * as backend from '@backend';
import { I18nProvider, useI18n } from '../i18n.jsx';
import { AuthProvider, useAuth } from '../auth.jsx';
import SignIn from '../components/SignIn.jsx';
import ComposePane from './ComposePane.jsx';
import ReadPane from './ReadPane.jsx';
import * as office from './office.js';
import '@fontsource-variable/literata/opsz.css';
import '@fontsource-variable/schibsted-grotesk/index.css';
import '../styles.css';
import './outlook.css';

function Pane() {
  const { user } = useAuth();
  const { t, toggle } = useI18n();
  const [compose, setCompose] = useState(() => office.isCompose());
  useEffect(() => office.onItemChanged(() => setCompose(office.isCompose())), []);
  const mailboxEmail = office.me().email;

  let body;
  if (user === undefined) body = <p className="loading">{t('loading')}</p>;
  else if (!user) body = <SignIn email={mailboxEmail} />;
  else body = compose ? <ComposePane /> : <ReadPane />;

  return (
    <div className="ol-pane">
      <header className="ol-head">
        <span className="wordmark" aria-label="ChiaraMail">
          <span className="wordmark-glyph" aria-hidden="true" />
          <span>Chiara<span className="wordmark-mail">Mail</span><sup className="wordmark-tm">™</sup></span>
        </span>
      </header>
      {user && mailboxEmail && user.email !== mailboxEmail && (
        <p className="notice ol-other" role="alert">{t('ol_otherAccount', { mailbox: mailboxEmail, email: user.email })}</p>
      )}
      <main>{body}</main>
      <footer className="ol-foot">
        {user && <p className="ol-who">{t('ol_signedInAs', { email: user.email })} · <button type="button" className="linklike" onClick={() => backend.signOut()}>{t('signOut')}</button></p>}
        <p>
          <a className="footlink" href="/privacy-eu.html" target="_blank" rel="noopener noreferrer">{t('privacy')}</a>
          <a className="footlink" href="/terms.html" target="_blank" rel="noopener noreferrer">{t('terms')}</a>
          <button type="button" className="linklike" onClick={toggle}>{t('language')}</button>
        </p>
      </footer>
    </div>
  );
}

function NotInOutlook() {
  const { t } = useI18n();
  return <div className="ol-pane"><p className="notice">{t('ol_noOffice')}</p></div>;
}

const root = createRoot(document.getElementById('root'));
const render = (inOutlook) => root.render(
  <StrictMode>
    <I18nProvider>
      {inOutlook ? (
        <AuthProvider>
          <MemoryRouter><Pane /></MemoryRouter>
        </AuthProvider>
      ) : <NotInOutlook />}
    </I18nProvider>
  </StrictMode>,
);

if (window.Office?.onReady) window.Office.onReady((info) => render(info?.host === window.Office.HostType?.Outlook || !!window.Office.context?.mailbox));
else render(false);
