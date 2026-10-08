import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import * as gmail from '@gmail';
import { parseMessage, b64urlToBytes, displayName } from '../gmail/mime.js';
import { useMail } from './context.jsx';
import { useI18n } from '../i18n.jsx';
import HtmlBody from './HtmlBody.jsx';
import LiveMessage from './LiveMessage.jsx';
import PlainBody from './PlainBody.jsx';
import { fmtSize } from '../lib.js';
import { useIsEcsUser } from './ecsCheck.js';


function Attachments({ message }) {
  const { t } = useI18n();
  const { handle } = useMail();
  const download = async (a) => {
    try {
      const data = a.data || await gmail.getAttachment(message.id, a.attachmentId);
      const url = URL.createObjectURL(new Blob([b64urlToBytes(data)], { type: a.mimeType }));
      const link = document.createElement('a');
      link.href = url; link.download = a.filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { handle(e); }
  };
  if (!message.attachments.length) return null;
  return (
    <ul className="attachments" aria-label={t('attachments')}>
      {message.attachments.map((a, i) => (
        <li key={i}>
          <button type="button" className="chip" onClick={() => download(a)}>
            📎 {a.filename} <span className="chip-size">{fmtSize(a.size)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DraftCard({ m }) {
  const { t, formatDate } = useI18n();
  const nav = useNavigate();
  const { handle, refreshCounts } = useMail();
  const [gone, setGone] = useState(false);
  const open = async () => {
    try { const id = await gmail.findDraftId(m.id); if (id) nav(`/compose?draft=${id}`); } catch (e) { handle(e); }
  };
  const remove = async () => {
    try { const id = await gmail.findDraftId(m.id); if (id) await gmail.deleteDraft(id); setGone(true); refreshCounts(); } catch (e) { handle(e); }
  };
  if (gone) return null;
  return (
    <li className="mcard mcard-draft">
      <p className="mdraft-head"><span className="draft-tag">{t('draft')}</span> <span className="mdate">{formatDate(m.date)}</span></p>
      <p className="msnip">{m.text ? m.text.slice(0, 200) : m.snippet}</p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={open}>{t('continueEditing')}</button>
        <button type="button" className="btn btn-quiet" onClick={remove}>{t('deleteDraft')}</button>
      </div>
    </li>
  );
}

function MessageCard({ m, expanded, onToggle, isLast, threadId, me }) {
  const { t, formatDate } = useI18n();
  const [live, setLive] = useState(null); // { isSender, allowForward, withdrawn } for ECS messages
  const forwardBlocked = !!(m.pointer && live && !live.isSender && (live.withdrawn || !live.allowForward));
  const people = (list) => list.map((a) => (a.email.toLowerCase() === me ? t('me') : displayName(a))).join(', ');
  const replyBase = `/compose?thread=${threadId}&msg=${m.id}`;
  const fromEmail = (m.from?.email || '').toLowerCase();
  const ecsSender = useIsEcsUser(fromEmail === me ? '' : fromEmail) && !live?.spoof;
  const fromName = <span className={ecsSender ? 'ecs-user' : undefined} title={ecsSender ? t('ecsUserTitle') : undefined}>{displayName(m.from)}</span>;
  if (!expanded) {
    return (
      <li className="mcard mcard-collapsed">
        <button type="button" className="mcard-toggle" onClick={onToggle} aria-expanded="false">
          <span className="mfrom">{fromEmail === me ? t('me') : fromName}</span>
          <span className="msnip">{m.pointer ? t('liveCollapsed') : m.snippet}</span>
          <span className="mdate">{formatDate(m.date)}</span>
        </button>
      </li>
    );
  }
  return (
    <li className="mcard">
      <header className="mhead">
        <button type="button" className="mcard-toggle mcard-toggle-open" onClick={onToggle} aria-expanded="true" disabled={isLast}>
          <span className="mfrom">{fromName} <span className="maddr">&lt;{m.from?.email}&gt;</span></span>
          <span className="mdate">{formatDate(m.date)}</span>
        </button>
        <p className="mto">
          {t('to')}: {people(m.to) || '—'}
          {m.cc.length > 0 && <> · {t('cc')}: {people(m.cc)}</>}
          {m.bcc.length > 0 && <> · {t('bcc')}: {people(m.bcc)}</>}
        </p>
      </header>
      <div className="mbody">
        {m.pointer
          ? <LiveMessage pointer={m.pointer} message={m} threadId={threadId} onInfo={setLive} />
          : m.html ? <HtmlBody message={m} /> : <PlainBody text={m.text} />}
      </div>
      <Attachments message={m} />
      <div className="actions mactions">
        <Link className="btn" to={`${replyBase}&mode=reply`}>{t('reply')}</Link>
        {(m.to.length + m.cc.length > 1) && <Link className="btn" to={`${replyBase}&mode=replyAll`}>{t('replyAll')}</Link>}
        {forwardBlocked
          ? <button type="button" className="btn" disabled aria-describedby={`nofwd-${m.id}`}>{t('forward')}</button>
          : <Link className="btn" to={`${replyBase}&mode=forward`}>{t('forward')}</Link>}
      </div>
      {forwardBlocked && <p id={`nofwd-${m.id}`} className="help">{t('forwardBlocked')}</p>}
    </li>
  );
}

export default function ThreadView() {
  const { folder, threadId } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const mail = useMail();
  const { t } = useI18n();
  const [state, setState] = useState({ id: null });
  const [open, setOpen] = useState({});
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const back = `/mail/${encodeURIComponent(folder)}${params.get('q') ? `?q=${encodeURIComponent(params.get('q'))}` : ''}`;
  const { handle, refreshCounts } = mail;

  const fetchThread = useCallback(() => gmail.getThread(threadId).then((th) => ({ id: threadId, msgs: th.messages.map(parseMessage) })), [threadId]);
  const fail = useCallback((e) => (handle(e) ? null : { id: threadId, error: e.status === 404 ? t('threadGone') : e.code === 'rate-limit' ? t('rateLimited') : e.message }), [handle, threadId, t]);
  const load = useCallback(() => fetchThread().then(setState).catch((e) => { const s = fail(e); if (s) setState(s); }), [fetchThread, fail]);

  useEffect(() => {
    let live = true;
    fetchThread().then(async (s) => {
      if (!live) return;
      setState(s);
      if (s.msgs.some((m) => m.labelIds.includes('UNREAD'))) {
        await gmail.modifyThread(threadId, [], ['UNREAD']).catch(() => {});
        refreshCounts();
      }
    }).catch((e) => { const s = fail(e); if (live && s) setState(s); });
    return () => { live = false; };
  }, [fetchThread, fail, threadId, refreshCounts]);

  if (state.id !== threadId) return <p className="loading">{t('loading')}</p>;
  if (state.error) return <><p className="back"><Link to={back}>{t('backToList')}</Link></p><p className="error">{state.error}</p></>;

  const msgs = state.msgs;
  const labels = new Set(msgs.flatMap((m) => m.labelIds));
  const act = async (fn, leave = true) => {
    // If the reader has already moved elsewhere, don't pull them back.
    try { await fn(); refreshCounts(); if (!mounted.current) return; if (leave) nav(back); else load(); } catch (e) { handle(e); }
  };
  const subject = msgs[0]?.subject || t('noSubject');
  const lastReal = msgs.map((m) => m.labelIds.includes('DRAFT')).lastIndexOf(false);
  const isOpen = (m, i) => open[m.id] ?? (i === lastReal || m.labelIds.includes('UNREAD') || !!m.pointer);

  return (
    <article className="thread">
      <div className="toolbar" role="toolbar" aria-label={t('threadActions')}>
        <Link to={back} className="btn btn-quiet">{t('backToList')}</Link>
        {labels.has('INBOX') && <button type="button" className="btn" onClick={() => act(() => gmail.modifyThread(threadId, [], ['INBOX']))}>{t('archive')}</button>}
        {!labels.has('INBOX') && !labels.has('TRASH') && !labels.has('SPAM') && <button type="button" className="btn" onClick={() => act(() => gmail.modifyThread(threadId, ['INBOX'], []), false)}>{t('moveToInbox')}</button>}
        {labels.has('SPAM')
          ? <button type="button" className="btn" onClick={() => act(() => gmail.modifyThread(threadId, ['INBOX'], ['SPAM']))}>{t('notSpam')}</button>
          : <button type="button" className="btn" onClick={() => act(() => gmail.modifyThread(threadId, ['SPAM'], ['INBOX']))}>{t('reportSpam')}</button>}
        {labels.has('TRASH')
          ? <button type="button" className="btn" onClick={() => act(() => gmail.untrashThread(threadId))}>{t('restore')}</button>
          : <button type="button" className="btn" onClick={() => act(() => gmail.trashThread(threadId))}>{t('trash')}</button>}
        <button type="button" className="btn" onClick={() => act(() => gmail.modifyThread(threadId, ['UNREAD'], []))}>{t('markUnread')}</button>
        <button type="button" className={labels.has('STARRED') ? 'btn star-btn star-on' : 'btn star-btn'} aria-pressed={labels.has('STARRED')}
          onClick={() => act(() => gmail.modifyThread(threadId, labels.has('STARRED') ? [] : ['STARRED'], labels.has('STARRED') ? ['STARRED'] : []), false)}>
          ★ {labels.has('STARRED') ? t('starred') : t('star')}
        </button>
      </div>
      <h1 className="thread-subject">{subject}</h1>
      <ol className="mcards">
        {msgs.map((m, i) => (m.labelIds.includes('DRAFT') ? <DraftCard key={m.id} m={m} /> : (
          <MessageCard key={m.id} m={m} threadId={threadId} me={mail.account} isLast={i === lastReal}
            expanded={isOpen(m, i)} onToggle={() => setOpen({ ...open, [m.id]: !isOpen(m, i) })} />
        )))}
      </ol>
    </article>
  );
}
