import { useState } from 'react';
import { NavLink, Link, Navigate, Route, Routes, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useMail } from './context.jsx';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { FOLDERS } from './folders.js';
import { useAlwaysImages, setAlwaysImages } from './prefs.js';
import ThreadList from './ThreadList.jsx';
import DraftList from './DraftList.jsx';
import ThreadView from './ThreadView.jsx';
import Composer from './Composer.jsx';

function SearchBox() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const urlQ = params.get('q') || '';
  const [q, setQ] = useState(urlQ);
  // Follow searches started elsewhere (e.g. "Find emails from…" in the right-click menu).
  const [seen, setSeen] = useState(urlQ);
  if (seen !== urlQ) { setSeen(urlQ); setQ(urlQ); }
  return (
    <form role="search" className="search" onSubmit={(e) => { e.preventDefault(); nav(q.trim() ? `/mail/all?q=${encodeURIComponent(q.trim())}` : '/mail/inbox'); }}>
      <label className="sr-only" htmlFor="search">{t('search')}</label>
      <input id="search" type="search" placeholder={t('searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
    </form>
  );
}

// The connected address, followed by the account's name from Google, e.g.
// "ruomini@gmail.com (Robert Uomini)".
function AccountLine() {
  const mail = useMail();
  const { user } = useAuth();
  const name = user && user.email === mail.account ? (user.name || '').trim() : '';
  const text = name ? `${mail.account} (${name})` : mail.account;
  return <span className="who account-line" title={text}>{text}</span>;
}

function ImagesSetting() {
  const { t } = useI18n();
  const on = useAlwaysImages();
  return (
    <label className="setting" title={on ? t('alwaysImagesNote') : undefined}>
      <input type="checkbox" checked={on} onChange={(e) => setAlwaysImages(e.target.checked)} />
      <span>{t('alwaysShowImages')}</span>
    </label>
  );
}

function Sidebar({ onNavigate }) {
  const { t } = useI18n();
  const mail = useMail();
  const count = { inbox: mail.unread.inbox, spam: mail.unread.spam, drafts: mail.unread.drafts };
  return (
    <nav className="sidebar" aria-label={t('folders')}>
      <Link to="/compose" className="btn btn-primary compose-btn" onClick={onNavigate}>{t('compose')}</Link>
      <ul className="folders">
        {FOLDERS.map((f) => (
          <li key={f.key}>
            <NavLink to={`/mail/${f.key}`} onClick={onNavigate} className={({ isActive }) => (isActive ? 'folder folder-on' : 'folder')}>
              <span>{t(`folder_${f.key}`)}</span>
              {count[f.key] > 0 && <span className="count">{count[f.key]}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
      {mail.userLabels.length > 0 && (
        <>
          <h2 className="sidebar-title">{t('labels')}</h2>
          <ul className="folders">
            {mail.userLabels.map((l) => (
              <li key={l.id}>
                <NavLink to={`/mail/${encodeURIComponent(l.id)}`} onClick={onNavigate} className={({ isActive }) => (isActive ? 'folder folder-on' : 'folder')}>
                  <span>{l.name}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  );
}

export default function MailLayout() {
  const { t } = useI18n();
  const mail = useMail();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  return (
    <div className={open ? 'mail mail-menu-open' : 'mail'}>
      <div className="mail-bar">
        <button type="button" className="btn btn-quiet menu-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{t('menu')}</button>
        <div className="search-col">
          <SearchBox key={loc.search} />
          <AccountLine />
          <ImagesSetting />
        </div>
        <button type="button" className="btn btn-quiet signout" onClick={mail.disconnect}>{t('signOut')}</button>
      </div>
      <Sidebar onNavigate={() => setOpen(false)} />
      <section className="mail-main">
        <Routes>
          <Route path="/" element={<Navigate to="/mail/inbox" replace />} />
          <Route path="/mail/drafts" element={<DraftList />} />
          <Route path="/mail/:folder" element={<ThreadList />} />
          <Route path="/mail/:folder/:threadId" element={<ThreadView />} />
          <Route path="/compose" element={<Composer />} />
          <Route path="*" element={<Navigate to="/mail/inbox" replace />} />
        </Routes>
      </section>
    </div>
  );
}
