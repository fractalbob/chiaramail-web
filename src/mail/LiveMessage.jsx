import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as backend from '@backend';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { Readers, Editions } from '../components/SenderTools.jsx';
import PlainBody from './PlainBody.jsx';
import RichBody from './RichBody.jsx';
import RichEditor from './RichEditor.jsx';
import { bodyHtml, storeRich, richIsEmpty } from '../richtext.js';
import EcsAttachments from '../components/EcsAttachments.jsx';
import { watchEcs, saveEcsEdition } from '../ecs.js';

// The content of an ECS message (body and attachments): fetched live from
// ChiaraMail (the original's FETCH CONTENT), editable in place by its sender
// (UPDATE CONTENT).
export default function LiveMessage({ pointer, message, threadId, onInfo }) {
  const { user } = useAuth();
  const { t, formatDate } = useI18n();
  const [loaded, setLoaded] = useState({ id: null });
  const [seen, setSeen] = useState({ id: null, edition: null });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const receiptFor = useRef(null);
  const [fwdPending, setFwdPending] = useState(null); // { value, base } until the server confirms

  const key = message.key;
  useEffect(() => watchEcs(pointer, key,
    (d) => setLoaded(d ? { id: pointer, status: 'ok', data: d } : { id: pointer, status: 'missing' }),
    (e) => setLoaded({ id: pointer, status: e.code === 'permission-denied' ? 'denied' : 'error', error: e.message })), [pointer, key, user?.uid]); // again once signed in (desktop: the ECS server)

  const state = loaded.id === pointer ? loaded : { status: 'loading' };
  const d = state.data;
  const isSender = !!(d && user && d.senderUid === user.uid);
  const lastSeen = seen.id === pointer ? seen.edition : null;
  const edition = d?.edition;
  const withdrawn = d?.withdrawn;

  const allowForward = d?.allowForward === true;
  // Does the email's From match who really stored this content?
  const claimed = (message.from?.email || '').toLowerCase();
  const verified = !!d && !!claimed && claimed === (d.senderEmail || '').toLowerCase();
  useEffect(() => {
    if (onInfo && d) onInfo({ isSender, allowForward, withdrawn: !!withdrawn, spoof: !verified });
  }, [onInfo, d, isSender, allowForward, withdrawn, verified]);

  // Readers: remember the edition they'd seen, then record this read.
  useEffect(() => {
    if (!d || isSender || !user || withdrawn) return;
    let live = true;
    (async () => {
      if (receiptFor.current !== pointer) {
        receiptFor.current = pointer;
        const r = await backend.getMyReceipt(pointer, user.email).catch(() => null);
        if (live) setSeen({ id: pointer, edition: r ? r.editionSeen : 0 });
      }
      await backend.markRead(pointer, user.email, edition).catch(() => {});
    })();
    return () => { live = false; };
  }, [pointer, edition, withdrawn, isSender, user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.status === 'loading') return <p className="loading">{t('loading')}</p>;
  if (state.status !== 'ok') {
    return (
      <div className="live-block live-unavailable">
        <p className="notice-lead">{state.status === 'missing' ? t('liveDeleted') : t('liveNotForYou')}</p>
        <PlainBody text={message.text} />
      </div>
    );
  }

  const fresh = !isSender && lastSeen > 0 && lastSeen < d.edition && !d.withdrawn;

  const save = async () => {
    if (richIsEmpty(draft) && !d.attachments?.length) return setError(t('needBody'));
    setBusy(true); setError('');
    try { await saveEcsEdition(pointer, d, { subject: d.subject, body: storeRich(draft) }, key); setEditing(false); setSaved(true); } catch (e) { setError(t('errorGeneric', { msg: e.message })); } finally { setBusy(false); }
  };
  const withdraw = async () => {
    if (!window.confirm(t('withdrawConfirm'))) return;
    try { await backend.withdraw(pointer); } catch (e) { setError(t('errorGeneric', { msg: e.message })); }
  };

  return (
    <div className={!verified ? 'live-block live-spoof' : fresh ? 'live-block live-fresh' : 'live-block'}>
      {!verified && (
        <div className="spoof-alert" role="alert">
          <p className="notice-lead">{t('spoofHead')}</p>
          <p>{t('spoofBody', { claimed: claimed || t('noSender'), real: d.senderEmail })}</p>
        </div>
      )}
      <p className="edition">
        <span className="live-badge">{t('live')}</span>
        {verified && <span className="verified-mark" title={t('verifiedTitle')}>✓ {t('verifiedSender')}</span>}
        {!d.withdrawn && (
          <>
            <span className={fresh ? 'edition-mark edition-fresh' : 'edition-mark'}>
              {d.edition === 1 ? t('firstEdition') : t('editionN', { n: d.edition })}
            </span>
            <span className="edition-date">
              {d.edition === 1 ? t('sentOn', { date: formatDate(d.createdAt) }) : t('updatedOn', { date: formatDate(d.updatedAt) })}
            </span>
          </>
        )}
      </p>
      {fresh && (
        <p className="updated-banner" role="status">
          <mark>{t('updatedSince')}</mark>
          <span>{t('updatedSinceDetail', { seen: lastSeen, n: d.edition })}</span>
        </p>
      )}

      {d.locked && !d.withdrawn ? (
        <p className="notice">{t('ecsLocked')}</p>
      ) : d.withdrawn ? (
        <p className="notice">{isSender ? t('withdrawnMine', { date: formatDate(d.updatedAt) }) : t('withdrawnBy', { name: d.senderName || d.senderEmail, date: formatDate(d.updatedAt) })}</p>
      ) : editing ? (
        <div className="live-edit">
          <RichEditor id={`edit-${pointer}`} label={t('message')} labelClass="sr-only" value={draft} onChange={setDraft} minRows={10} />
          <p className="help">{t('editNote')}</p>
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? t('saving') : t('saveEdition')}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)}>{t('cancel')}</button>
          </div>
        </div>
      ) : (
        <div className="letter-body live-body"><RichBody body={d.body} /></div>
      )}
      {!d.locked && <EcsAttachments id={pointer} message={d} ecsKey={key} />}

      {!isSender && !d.withdrawn && <p className="fineprint">{t('readNotice')}</p>}

      {isSender && (
        <div className="live-tools">
          {saved && !editing && (
            <p className="note" role="status">
              {t('editionSaved', { n: d.edition })}{' '}
              <Link to={`/compose?thread=${threadId}&msg=${message.id}&mode=replyAll&note=updated`}>{t('letThemKnow')}</Link>
            </p>
          )}
          {!d.withdrawn && !editing && (
            <div className="actions">
              {!d.locked && <button type="button" className="btn btn-primary" onClick={() => { setDraft(bodyHtml(d.body)); setEditing(true); setSaved(false); }}>{t('edit')}</button>}
              <button type="button" className="btn btn-danger" onClick={withdraw}>{t('withdraw')}</button>
            </div>
          )}
          {!d.withdrawn && (
            <label className="subtoggle">
              <input type="checkbox" checked={fwdPending && fwdPending.base === allowForward ? fwdPending.value : allowForward}
                onChange={(e) => {
                  const value = e.target.checked;
                  setFwdPending({ value, base: allowForward });
                  backend.setAllowForward(pointer, value).catch((err) => { setFwdPending(null); setError(t('errorGeneric', { msg: err.message })); });
                }} />
              <span>{t('allowForwardSender')}</span>
            </label>
          )}
          <details className="live-details">
            <summary>{t('readers')}</summary>
            <Readers message={{ ...d, id: pointer }} />
          </details>
          {!d.withdrawn && (
            <details className="live-details">
              <summary>{t('history')}</summary>
              <Editions message={{ ...d, id: pointer }} ecsKey={key} />
            </details>
          )}
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
