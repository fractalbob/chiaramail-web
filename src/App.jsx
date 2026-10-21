import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import { useI18n } from './i18n.jsx';
import * as backend from '@backend';
import * as gmail from '@gmail';
import { MailProvider, useMail } from './mail/context.jsx';
import MailLanding from './mail/MailLanding.jsx';
import MailLayout from './mail/MailLayout.jsx';
import EmailLinkFinisher from './components/EmailLinkFinisher.jsx';
import Compose from './components/Compose.jsx';
import MessagePage from './components/MessagePage.jsx';
import ReaderHome from './components/ReaderHome.jsx';
import DownloadNote from './mail/DownloadNote.jsx';

function Header() {
  const { user } = useAuth();
  const { t } = useI18n();
  const loc = useLocation();
  const onReaderPage = loc.pathname.startsWith('/m/');
  return (
    <header className="masthead">
      <Link to="/" className="wordmark" aria-label="ChiaraMail">
        <span className="wordmark-glyph" aria-hidden="true" />
        <span>Chiara<span className="wordmark-mail">Mail</span><sup className="wordmark-tm">™</sup></span>
      </Link>
      {onReaderPage && user && (
        <nav className="masthead-nav">
          <span className="who">{user.email}</span>
          <button type="button" className="btn btn-quiet" onClick={() => backend.signOut()}>{t('signOut')}</button>
        </nav>
      )}
    </header>
  );
}

function Footer() {
  const { t, toggle } = useI18n();
  return (
    <footer className="foot">
      {gmail.mode === 'mock-gmail' && <p className="testmode">{t('testModeMail')}</p>}
      <p>
        ChiaraMail™ · The Fractal Images Company
        {/* The desktop app and the reader page use the European server: their own policy. */}
        <a className="footlink" href={backend.mode === 'reader' || backend.mode === 'desktop' ? '/privacy-eu.html' : '/privacy.html'}>{t('privacy')}</a>
        <a className="footlink" href="/terms.html">{t('terms')}</a>
        <button type="button" className="linklike" onClick={toggle}>{t('language')}</button>
      </p>
    </footer>
  );
}

function MailRoot() {
  const mail = useMail();
  const { t } = useI18n();
  if (mail.status === 'checking') return <p className="loading">{t('loading')}</p>;
  if (mail.status !== 'connected') return <MailLanding />;
  return <MailLayout />;
}

function Routed() {
  const { user } = useAuth();
  const { t } = useI18n();
  if (backend.isPendingEmailLink()) return <EmailLinkFinisher />;
  if (user === undefined) return <p className="loading">{t('loading')}</p>;
  // The reader page (ecs server, for recipients without the app): ECS messages only.
  if (backend.mode === 'reader') {
    return (
      <Routes>
        <Route path="/m/:id" element={<MessagePage />} />
        <Route path="/*" element={<ReaderHome />} />
      </Routes>
    );
  }
  return (
    <Routes>
      {/* The web page an ECS message links to, for readers without ChiaraMail. */}
      <Route path="/m/:id" element={<MessagePage />} />
      <Route path="/m/:id/edit" element={user ? <Compose editing /> : <MessagePage />} />
      <Route path="/*" element={<MailRoot />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MailProvider>
        <div className="page">
          <Header />
          <main className="main"><Routed /></main>
          <Footer />
          <DownloadNote />
        </div>
      </MailProvider>
    </AuthProvider>
  );
}
