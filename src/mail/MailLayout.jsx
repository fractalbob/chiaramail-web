import { useRef, useState } from 'react';
import { NavLink, Link, Navigate, Route, Routes, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useMail } from './context.jsx';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { CATEGORIES, FOLDERS, labelTree } from './folders.js';
import Icon from './icons.jsx';
import { useAlwaysImages, setAlwaysImages } from './prefs.js';
import ThreadList from './ThreadList.jsx';
import DraftList from './DraftList.jsx';
import ThreadView from './ThreadView.jsx';
import Composer from './Composer.jsx';
import { NewLabelDialogHost } from './LabelPicker.jsx';

function SearchBox() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const urlQ = params.get('q') || '';
  const [q, setQ] = useState(urlQ);
  // Follow searches started elsewhere (e.g. "Find emails from…" in the right-click menu).
  const [seen, setSeen] = useState(urlQ);
  if (seen !== urlQ) { setSeen(urlQ); setQ(urlQ); }
  // As in Gmail: touching the box shows a ← on its left, which always goes back to the
  // whole Inbox (so does Escape). The × only empties the box, so a new search can be typed;
  // the results stay until the ← is used or a new search is made.
  // The × is our own: browsers' built-in ones behave differently, especially on phones.
  const box = useRef(null);
  const [focused, setFocused] = useState(false);
  const clear = () => { setQ(''); box.current?.focus(); };
  const back = () => {
    setQ(''); setFocused(false); box.current?.blur();
    if (urlQ) nav('/mail/inbox');
  };
  const keep = (e) => e.preventDefault(); // pressing a button doesn't take the focus from the box
  const open = focused || !!urlQ;
  return (
    <form role="search" className={open ? 'search search-open' : 'search'}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}
      onSubmit={(e) => { e.preventDefault(); box.current?.blur(); nav(q.trim() ? `/mail/all?q=${encodeURIComponent(q.trim())}` : '/mail/inbox'); }}>
      {open && (
        <button type="button" className="search-back" aria-label={t('backToInbox')} title={t('backToInbox')}
          onPointerDown={keep} onMouseDown={keep} onClick={back}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z" fill="currentColor" /></svg>
        </button>
      )}
      <label className="sr-only" htmlFor="search">{t('search')}</label>
      <input id="search" ref={box} type="search" placeholder={t('searchPlaceholder')} value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); back(); } }} />
      {q && (
        <button type="button" className="search-clear" aria-label={t('clearSearch')} title={t('clearSearch')}
          onPointerDown={keep} onMouseDown={keep} onClick={clear}>×</button>
      )}
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

const FOLD_KEY = 'chiaramail.folded';
function useFolded() {
  const [folded, setFolded] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')); } catch { return new Set(); }
  });
  const toggle = (k) => setFolded((cur) => {
    const next = new Set(cur);
    if (next.has(k)) next.delete(k); else next.add(k);
    try { localStorage.setItem(FOLD_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
    return next;
  });
  return [folded, toggle];
}

function FoldButton({ open, name, onClick }) {
  const { t } = useI18n();
  return (
    <button type="button" className="fold" aria-expanded={open} onClick={onClick}
      aria-label={t(open ? 'collapseLabel' : 'expandLabel', { name })} title={t(open ? 'collapseLabel' : 'expandLabel', { name })}>
      <Icon name={open ? 'drop' : 'right'} size={18} />
    </button>
  );
}

function FolderLink({ to, onNavigate, children, count, depth = 0 }) {
  return (
    <NavLink to={to} onClick={onNavigate} style={depth ? { '--depth': depth } : undefined}
      className={({ isActive }) => (isActive ? 'folder folder-on' : 'folder')}>
      <span className="folder-name">{children}</span>
      {count > 0 && <span className="count">{count.toLocaleString()}</span>}
    </NavLink>
  );
}

function LabelNode({ node, depth, folded, toggle, onNavigate }) {
  const open = !folded.has(`label:${node.path}`);
  const kids = node.children.length > 0;
  return (
    <li className={kids ? 'has-kids' : undefined}>
      <div className="folder-row">
        {kids ? <FoldButton open={open} name={node.name} onClick={() => toggle(`label:${node.path}`)} /> : <span className="fold-space" />}
        {node.label
          ? <FolderLink to={`/mail/${encodeURIComponent(node.label.id)}`} onNavigate={onNavigate} depth={depth}>{node.name}</FolderLink>
          : <span className="folder folder-plain" style={{ '--depth': depth }}>{node.name}</span>}
      </div>
      {kids && open && (
        <ul className="folders">
          {node.children.map((c) => <LabelNode key={c.path} node={c} depth={depth + 1} folded={folded} toggle={toggle} onNavigate={onNavigate} />)}
        </ul>
      )}
    </li>
  );
}

function Sidebar({ onNavigate }) {
  const { t } = useI18n();
  const mail = useMail();
  const [folded, toggle] = useFolded();
  const count = mail.unread;
  const cats = CATEGORIES.filter((c) => mail.labels.some((l) => l.id === c.label));
  const catsOpen = !folded.has('categories');
  const tree = labelTree(mail.userLabels);
  return (
    <nav className="sidebar" aria-label={t('folders')}>
      <Link to="/compose" className="btn btn-primary compose-btn" onClick={onNavigate}>{t('compose')}</Link>
      <ul className="folders">
        {FOLDERS.map((f) => (
          <li key={f.key}>
            <FolderLink to={`/mail/${f.key}`} onNavigate={onNavigate} count={count[f.key]}>{t(`folder_${f.key}`)}</FolderLink>
          </li>
        ))}
      </ul>
      {cats.length > 0 && (
        <>
          <div className="sidebar-group">
            <FoldButton open={catsOpen} name={t('categories')} onClick={() => toggle('categories')} />
            <h2 className="sidebar-title">{t('categories')}</h2>
          </div>
          {catsOpen && (
            <ul className="folders folders-indent">
              {cats.map((c) => (
                <li key={c.key}>
                  <FolderLink to={`/mail/${c.key}`} onNavigate={onNavigate} count={count[c.key]}>{t(`folder_${c.key}`)}</FolderLink>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {tree.length > 0 && (
        <>
          <h2 className="sidebar-title sidebar-title-labels">{t('labels')}</h2>
          <ul className="folders label-tree">
            {tree.map((n) => <LabelNode key={n.path} node={n} depth={0} folded={folded} toggle={toggle} onNavigate={onNavigate} />)}
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
        <button type="button" className="btn btn-quiet menu-btn" aria-expanded={open} aria-label={t('menu')} title={t('menu')} onClick={() => setOpen(!open)}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" fill="currentColor" /></svg>
        </button>
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
      <NewLabelDialogHost />
    </div>
  );
}
