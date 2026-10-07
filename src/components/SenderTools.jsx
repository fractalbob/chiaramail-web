import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as backend from '@backend';
import { useI18n } from '../i18n.jsx';
import { toParagraphs } from '../lib.js';

function Readers({ message }) {
  const { t, formatDate } = useI18n();
  const [reads, setReads] = useState({});
  useEffect(() => backend.watchReads(message.id, setReads, () => {}), [message.id]);
  return (
    <ul className="readers">
      {message.recipients.map((e) => {
        const r = reads[e];
        let state = t('notOpened');
        if (r) state = r.editionSeen >= message.edition
          ? t('readLatest', { date: formatDate(r.lastReadAt) })
          : t('readEdition', { n: r.editionSeen, date: formatDate(r.lastReadAt) });
        return (
          <li key={e} className={r && r.editionSeen >= message.edition ? 'reader reader-current' : 'reader'}>
            <span className="reader-addr">{e}</span>
            <span className="reader-state">{state}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Editions({ message }) {
  const { t, formatDate } = useI18n();
  const [eds, setEds] = useState(null);
  useEffect(() => {
    let live = true;
    backend.listEditions(message.id).then((x) => { if (live) setEds(x); }).catch(() => setEds([]));
    return () => { live = false; };
  }, [message.id, message.edition]);
  if (!eds) return <p className="help">{t('editionsLoading')}</p>;
  return (
    <ol className="editions" reversed>
      {eds.map((e) => (
        <li key={e.edition}>
          <details open={false}>
            <summary>
              {t('editionN', { n: e.edition })}
              {e.edition === message.edition && <em className="current"> ({t('current')})</em>}
              <span className="ed-date">{formatDate(e.savedAt)}</span>
            </summary>
            <div className="ed-body">
              {e.subject && <p className="ed-subject">{e.subject}</p>}
              {toParagraphs(e.body).map((parts, i) => (
                <p key={i}>{parts.map((p, j) => <span key={j}>{p.href || p.text}</span>)}</p>
              ))}
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}

export default function SenderTools({ message, onSendLink }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const act = async (confirmText, fn) => {
    if (!window.confirm(confirmText)) return;
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(t('errorGeneric', { msg: e.message })); } finally { setBusy(false); }
  };

  return (
    <aside className="tools">
      {!message.withdrawn && (
        <div className="actions">
          <Link to={`/m/${message.id}/edit`} className="btn btn-primary">{t('edit')}</Link>
          <button type="button" className="btn" onClick={onSendLink}>{t('sendLink')}</button>
        </div>
      )}
      <section>
        <h2 className="tools-title">{t('readers')}</h2>
        <Readers message={message} />
      </section>
      {!message.withdrawn && (
        <section>
          <h2 className="tools-title">{t('history')}</h2>
          <Editions message={message} />
        </section>
      )}
      <div className="actions actions-danger">
        {!message.withdrawn && (
          <button type="button" className="btn btn-danger" disabled={busy}
            onClick={() => act(t('withdrawConfirm'), () => backend.withdraw(message.id))}>
            {t('withdraw')}
          </button>
        )}
        <button type="button" className="btn btn-quiet" disabled={busy}
          onClick={() => act(t('deleteConfirm'), async () => { await backend.deleteMessage(message.id); nav('/'); })}>
          {t('delete')}
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </aside>
  );
}
