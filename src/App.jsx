import { Routes, Route, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import { useI18n } from './i18n.jsx';
import * as backend from '@backend';
import EmailLinkFinisher from './components/EmailLinkFinisher.jsx';
import Landing from './components/Landing.jsx';
import Home from './components/Home.jsx';
import Compose from './components/Compose.jsx';
import MessagePage from './components/MessagePage.jsx';

function Header() {
  const { user } = useAuth();
  const { t } = useI18n();
  return (
    <header className="masthead">
      <Link to="/" className="wordmark" aria-label="ChiaraMail">
        <span className="wordmark-glyph" aria-hidden="true" />
        <span>Chiara<span className="wordmark-mail">Mail</span></span>
      </Link>
      {user && (
        <nav className="masthead-nav">
          <Link to="/new" className="btn btn-primary">{t('newMessage')}</Link>
          <span className="who" title={t('signedInAs', { email: user.email })}>{user.email}</span>
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
      {backend.mode === 'mock' && <p className="testmode">{t('testMode')}</p>}
      <p>
        ChiaraMail · The Fractal Images Company
        <button type="button" className="linklike" onClick={toggle}>{t('language')}</button>
      </p>
    </footer>
  );
}

function Routed() {
  const { user } = useAuth();
  const { t } = useI18n();
  if (backend.isPendingEmailLink()) return <EmailLinkFinisher />;
  if (user === undefined) return <p className="loading">{t('loading')}</p>;
  return (
    <Routes>
      <Route path="/" element={user ? <Home /> : <Landing />} />
      <Route path="/new" element={user ? <Compose /> : <Landing />} />
      <Route path="/m/:id" element={<MessagePage />} />
      <Route path="/m/:id/edit" element={user ? <Compose editing /> : <MessagePage />} />
      <Route path="*" element={user ? <Home /> : <Landing />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <div className="page">
        <Header />
        <main className="main"><Routed /></main>
        <Footer />
      </div>
    </AuthProvider>
  );
}
