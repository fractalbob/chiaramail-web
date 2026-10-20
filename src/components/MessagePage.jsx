import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams, useLocation } from 'react-router-dom';
import * as backend from '@backend';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import Letter from './Letter.jsx';
import SendPanel from './SendPanel.jsx';
import SenderTools from './SenderTools.jsx';
import SignIn from './SignIn.jsx';
import { watchEcs } from '../ecs.js';
import { keyFor } from '../ecsKeys.js';

function Notice({ children }) {
  return <div className="notice">{children}</div>;
}

export default function MessagePage() {
  const { user } = useAuth();
  const { t, formatDate } = useI18n();
  const { id } = useParams();
  const loc = useLocation();
  const [params, setParams] = useSearchParams();
  const [loaded, setLoaded] = useState({ id: null });
  const [seenState, setSeenState] = useState({ id: null, edition: null }); // edition seen before this visit
  const receiptLoadedFor = useRef(null);
  const [key, setKey] = useState(() => keyFor(id)); // from the link's #k=…, kept across sign-in
  useEffect(() => {
    const onHash = () => setKey(keyFor(id));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [id]);

  useEffect(() => {
    if (!user) return;
    return watchEcs(id, key,
      (m) => setLoaded(m ? { id, status: 'ok', message: m } : { id, status: 'missing' }),
      (e) => setLoaded(e.code === 'permission-denied' ? { id, status: 'denied' } : { id, status: 'error', error: e.message }));
  }, [id, user, key]);

  const state = loaded.id === id ? loaded : { status: 'loading' };
  const lastSeen = seenState.id === id ? seenState.edition : null;

  const m = state.message;
  const isSender = !!(m && user && m.senderUid === user.uid);
  const edition = m?.edition;
  const withdrawn = m?.withdrawn;

  // Recipient: remember what they'd seen before, then record this read.
  useEffect(() => {
    if (!m || isSender || !user || withdrawn) return;
    let live = true;
    (async () => {
      if (receiptLoadedFor.current !== id) {
        receiptLoadedFor.current = id;
        const r = await backend.getMyReceipt(id, user.email).catch(() => null);
        if (live) setSeenState({ id, edition: r ? r.editionSeen : 0 });
      }
      await backend.markRead(id, user.email, edition).catch(() => {});
    })();
    return () => { live = false; };
  }, [id, edition, withdrawn, isSender, user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) {
    return (
      <div className="gate">
        <Notice>
          <p className="notice-lead">{t('privateGate')}</p>
          <p>{t('privateGateHelp')}</p>
        </Notice>
        <SignIn returnPath={loc.pathname} />
      </div>
    );
  }

  // The reader page has nowhere to go back to.
  const back = backend.mode === 'reader' ? null : <p className="back"><Link to={isSender || !m ? '/' : '/?tab=received'}>{t('back')}</Link></p>;

  if (state.status === 'loading') return <p className="loading">{t('loading')}</p>;
  if (state.status === 'missing') return <>{back}<Notice><p>{t('notFound')}</p></Notice></>;
  if (state.status === 'denied') {
    return (
      <>{back}
        <Notice>
          <p className="notice-lead">{t('notForYou', { email: user.email })}</p>
          <p>{t('notForYouHelp')}</p>
          <button type="button" className="btn" onClick={() => backend.signOut()}>{t('signOut')}</button>
        </Notice>
      </>
    );
  }
  if (state.status === 'error') return <>{back}<p className="error">{t('errorGeneric', { msg: state.error })}</p></>;

  const send = params.get('send');
  const updatedBanner = !isSender && lastSeen > 0 && lastSeen < m.edition && !m.withdrawn ? (
    <p className="updated-banner" role="status">
      <mark>{t('updatedSince')}</mark>
      <span>{t('updatedSinceDetail', { seen: lastSeen, n: m.edition })}</span>
    </p>
  ) : null;
  const withdrawnNote = m.withdrawn ? (
    <Notice>
      <p>{isSender
        ? t('withdrawnMine', { date: formatDate(m.updatedAt) })
        : t('withdrawnBy', { name: m.senderName || m.senderEmail, date: formatDate(m.updatedAt) })}</p>
    </Notice>
  ) : null;

  return (
    <div className={isSender ? 'reading reading-sender' : 'reading'}>
      {back}
      {isSender && send && !m.withdrawn && (
        <SendPanel message={m} updated={send === 'updated'} onDone={() => setParams({})} />
      )}
      <div className="reading-grid">
        <div>
          {m.locked && !m.withdrawn && <Notice><p>{t('ecsLockedWeb')}</p></Notice>}
          <Letter message={m} myEmail={user.email} banner={updatedBanner} ecsKey={key} />
          {withdrawnNote}
          {!isSender && !m.withdrawn && <p className="fineprint">{t('readNotice')}</p>}
          {!isSender && (
            <aside className="invite" aria-labelledby="invite-title">
              <h2 id="invite-title" className="invite-title">{t('inviteTitle')}</h2>
              <p>{t('inviteBody')}</p>
              {backend.mode === 'reader'
                ? <a href="https://chiaramail.com" className="btn btn-primary" target="_blank" rel="noopener noreferrer">{t('inviteButton')}</a>
                : <Link to="/" className="btn btn-primary">{t('inviteButton')}</Link>}
            </aside>
          )}
        </div>
        {isSender && <SenderTools message={m} ecsKey={key} onSendLink={() => { setParams({ send: 'new' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
      </div>
    </div>
  );
}
