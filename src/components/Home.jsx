import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as backend from '@backend';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { peopleLabel } from '../lib.js';

function useList(kind, user) {
  const [state, setState] = useState({ kind: null, items: null, error: '' });
  useEffect(() => {
    const onItems = (items) => setState({ kind, items, error: '' });
    const onErr = (e) => setState({ kind, items: null, error: e.message });
    return kind === 'sent'
      ? backend.watchSent(user.uid, onItems, onErr)
      : backend.watchReceived(user.email, onItems, onErr);
  }, [kind, user.uid, user.email]);
  // Until the new tab's first answer arrives, show it as loading.
  return state.kind === kind ? state : { items: null, error: '' };
}

// For received mail: which editions has this reader already seen?
function useSeen(items, user, enabled) {
  const [seen, setSeen] = useState({});
  useEffect(() => {
    if (!enabled || !items) return;
    let live = true;
    Promise.all(items.map((m) => backend.getMyReceipt(m.id, user.email)
      .then((r) => [m.id, r ? r.editionSeen : 0]).catch(() => [m.id, 0])))
      .then((pairs) => { if (live) setSeen(Object.fromEntries(pairs)); });
    return () => { live = false; };
  }, [items, user.email, enabled]);
  return seen;
}

export default function Home() {
  const { user } = useAuth();
  const { t, formatDate } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'received' ? 'received' : 'sent';
  const { items, error } = useList(tab, user);
  const seen = useSeen(items, user, tab === 'received');

  return (
    <div className="home">
      <div className="tabs" role="tablist">
        {['sent', 'received'].map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            className={tab === k ? 'tab tab-on' : 'tab'}
            onClick={() => setParams(k === 'sent' ? {} : { tab: k })}>
            {t(k)}
          </button>
        ))}
      </div>

      {error && <p className="error" role="alert">{t('errorGeneric', { msg: error })}</p>}
      {!items && !error && <p className="loading">{t('loading')}</p>}

      {items && items.length === 0 && (
        <div className="empty">
          <p>{tab === 'sent' ? t('emptySent') : t('emptyReceived', { email: user.email })}</p>
          {tab === 'sent' && <Link className="btn btn-primary" to="/new">{t('writeFirst')}</Link>}
        </div>
      )}

      {items && items.length > 0 && (
        <ul className="msglist">
          {items.map((m) => {
            const fresh = tab === 'received' && !m.withdrawn && seen[m.id] !== undefined && seen[m.id] < m.edition;
            return (
              <li key={m.id}>
                <Link to={`/m/${m.id}`} className={fresh ? 'row row-fresh' : 'row'}>
                  <span className="row-people">
                    {tab === 'sent'
                      ? `${t('to')}: ${peopleLabel(t, m.recipients, user.email)}`
                      : (m.senderName || m.senderEmail)}
                  </span>
                  <span className="row-subject">
                    {m.withdrawn ? <s>{m.subject || t('noSubject')}</s> : (m.subject || t('noSubject'))}
                  </span>
                  <span className="row-meta">
                    {fresh && <span className="dot" aria-label={t('updatedSince')} />}
                    {m.withdrawn ? t('withdraw') : t('editionN', { n: m.edition })}
                    {' · '}
                    {formatDate(m.updatedAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
