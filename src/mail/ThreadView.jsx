import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import * as gmail from '@gmail';
import { parseMessage, b64urlToBytes, displayName, deliveryInfo } from '../gmail/mime.js';

const fmtAddr = (a) => (a.name ? `${a.name} <${a.email}>` : a.email);
import PersonHover from './PersonCard.jsx';
import { useMail } from './context.jsx';
import { useI18n } from '../i18n.jsx';
import HtmlBody from './HtmlBody.jsx';
import LiveMessage from './LiveMessage.jsx';
import PlainBody from './PlainBody.jsx';
import { useIsEcsUser } from './ecsCheck.js';
import { markSpamHandled } from './prefs.js';
import Icon from './icons.jsx';
import { IconButton, Menu, MenuItem } from './Menu.jsx';
import LabelPicker from './LabelPicker.jsx';
import AttachmentCards from './AttachmentCards.jsx';


function Attachments({ message }) {
  const { t } = useI18n();
  const items = message.attachments.map((a, i) => ({
    key: a.attachmentId || `p${i}`, name: a.filename, type: a.mimeType, size: a.size,
    load: async () => new Blob([b64urlToBytes(a.data || await gmail.getAttachment(message.id, a.attachmentId))], { type: a.mimeType }),
  }));
  return <AttachmentCards items={items} label={t('attachments')} />;
}

// Gmail's "Show details" (▾ beside the recipients): who sent it, to whom, when, and how it
// reached the mailbox (mailed-by, signed-by, encryption).
function MessageDetails({ m, onClose }) {
  const { t, formatDate } = useI18n();
  const ref = useRef(null);
  useEffect(() => {
    const out = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('.mdetails-btn')) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', out);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  const d = deliveryInfo(m.rawHeaders);
  const list = (l) => l.map(fmtAddr).join(', ');
  const rows = [
    ['dFrom', m.from ? fmtAddr(m.from) : ''],
    ['dReplyTo', list(m.replyTo)],
    ['dTo', list(m.to)],
    ['dCc', list(m.cc)],
    ['dBcc', list(m.bcc)],
    ['dDate', m.date ? formatDate(m.date) : ''],
    ['dSubject', m.subject],
    ['dMailedBy', d.mailedBy],
    ['dSignedBy', d.signedBy.join(', ')],
    ['dSecurity', d.tls == null ? '' : t(d.tls ? 'tlsYes' : 'tlsNo')],
  ].filter(([, v]) => v);
  return (
    <div className="mdetails" ref={ref} role="dialog" aria-label={t('showDetails')}>
      <table>
        <tbody>
          {rows.map(([k, v]) => <tr key={k}><th scope="row">{t(k)}:</th><td>{v}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

function DraftCard({ m }) {
  const { t, formatMail } = useI18n();
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
      <p className="mdraft-head"><span className="draft-tag">{t('draft')}</span> <span className="mdate">{formatMail(m.date)}</span></p>
      <p className="msnip">{m.text ? m.text.slice(0, 200) : m.snippet}</p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={open}>{t('continueEditing')}</button>
        <button type="button" className="btn btn-quiet" onClick={remove}>{t('deleteDraft')}</button>
      </div>
    </li>
  );
}

function MessageCard({ m, expanded, onToggle, isLast, threadId, me }) {
  const { t, formatMail } = useI18n();
  const nav = useNavigate();
  const [live, setLive] = useState(null); // { isSender, allowForward, withdrawn } for ECS messages
  const forwardBlocked = !!(m.pointer && live && !live.isSender && (live.withdrawn || !live.allowForward));
  const people = (list) => list.map((a) => (a.email.toLowerCase() === me ? t('me') : displayName(a))).join(', ');
  const replyBase = `/compose?thread=${threadId}&msg=${m.id}`;
  const fromEmail = (m.from?.email || '').toLowerCase();
  const ecsSender = useIsEcsUser(fromEmail === me ? '' : fromEmail) && !live?.spoof;
  const [details, setDetails] = useState(false);
  const fromName = (
    <PersonHover name={displayName(m.from)} email={m.from?.email}>
      <span className={ecsSender ? 'ecs-user' : undefined} title={ecsSender ? t('ecsUserTitle') : undefined}>{displayName(m.from)}</span>
    </PersonHover>
  );
  if (!expanded) {
    return (
      <li className="mcard mcard-collapsed">
        <button type="button" className="mcard-toggle" onClick={onToggle} aria-expanded="false">
          <span className="mfrom">{fromEmail === me ? t('me') : fromName}</span>
          <span className="msnip">{m.pointer ? t('liveCollapsed') : m.snippet}</span>
          <span className="mdate">{formatMail(m.date)}</span>
        </button>
      </li>
    );
  }
  return (
    <li className="mcard">
      <header className="mhead">
        <div className="mhead-row">
          <button type="button" className="mcard-toggle mcard-toggle-open" onClick={onToggle} aria-expanded="true" disabled={isLast}>
            <span className="mfrom">{fromName} <span className="maddr">&lt;{m.from?.email}&gt;</span></span>
            <span className="mdate">{formatMail(m.date)}</span>
          </button>
          {/* Gmail: a reply arrow and a ⋮ menu for this message, beside its date */}
          <span className="mhead-actions">
            <Link className="ibtn" to={`${replyBase}&mode=reply`} aria-label={t('reply')} title={t('reply')}><Icon name="reply" /></Link>
            <Menu align="right" label={t('moreActions')} button={<Icon name="more" />}>
              <MenuItem icon={<Icon name="reply" size={18} />} onClick={() => nav(`${replyBase}&mode=reply`)}>{t('reply')}</MenuItem>
              {(m.to.length + m.cc.length > 1) && <MenuItem icon={<Icon name="replyAll" size={18} />} onClick={() => nav(`${replyBase}&mode=replyAll`)}>{t('replyAll')}</MenuItem>}
              <MenuItem icon={<Icon name="forward" size={18} />} disabled={forwardBlocked} onClick={() => nav(`${replyBase}&mode=forward`)}>{t('forward')}</MenuItem>
              <MenuItem icon={<Icon name="attach" size={18} />} disabled={forwardBlocked} onClick={() => nav(`${replyBase}&mode=forwardAttach&one=1`)}>{t('forwardAttach')}</MenuItem>
            </Menu>
          </span>
        </div>
        <div className="mto">
          <span>
            {t('to')}: {people(m.to) || '—'}
            {m.cc.length > 0 && <> · {t('cc')}: {people(m.cc)}</>}
            {m.bcc.length > 0 && <> · {t('bcc')}: {people(m.bcc)}</>}
          </span>
          <button type="button" className="mdetails-btn" aria-expanded={details} aria-label={t('showDetails')} title={t('showDetails')}
            onClick={() => setDetails((v) => !v)}><Icon name="drop" size={20} /></button>
          {details && <MessageDetails m={m} onClose={() => setDetails(false)} />}
        </div>
      </header>
      <div className="mbody">
        {m.pointer
          ? <LiveMessage pointer={m.pointer} message={m} threadId={threadId} onInfo={setLive} />
          : m.html ? <HtmlBody message={m} /> : <PlainBody text={m.text} />}
      </div>
      <Attachments message={m} />
      {isLast && (
        // Gmail: one row of big buttons, under the last message only.
        <div className="actions mactions">
          <Link className="btn btn-icon" to={`${replyBase}&mode=reply`}><Icon name="reply" size={18} />{t('reply')}</Link>
          {(m.to.length + m.cc.length > 1) && <Link className="btn btn-icon" to={`${replyBase}&mode=replyAll`}><Icon name="replyAll" size={18} />{t('replyAll')}</Link>}
          {forwardBlocked
            ? <button type="button" className="btn btn-icon" disabled aria-describedby={`nofwd-${m.id}`}><Icon name="forward" size={18} />{t('forward')}</button>
            : <Link className="btn btn-icon" to={`${replyBase}&mode=forward`}><Icon name="forward" size={18} />{t('forward')}</Link>}
        </div>
      )}
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
      <div className="toolbar thread-toolbar" role="toolbar" aria-label={t('threadActions')}>
        <Link to={back} className="ibtn" aria-label={t('backToList')} title={t('backToList')}><Icon name="back" /></Link>
        {labels.has('INBOX') && <IconButton label={t('archive')} onClick={() => act(() => gmail.modifyThread(threadId, [], ['INBOX']))}><Icon name="archive" /></IconButton>}
        {!labels.has('INBOX') && !labels.has('TRASH') && !labels.has('SPAM') && <IconButton label={t('moveToInbox')} onClick={() => act(() => gmail.modifyThread(threadId, ['INBOX'], []), false)}><Icon name="inbox" /></IconButton>}
        {labels.has('SPAM')
          ? <IconButton label={t('notSpam')} onClick={() => act(() => gmail.modifyThread(threadId, ['INBOX'], ['SPAM']))}><Icon name="inbox" /></IconButton>
          : <IconButton label={t('reportSpam')} onClick={() => { markSpamHandled([threadId]); act(() => gmail.modifyThread(threadId, ['SPAM'], ['INBOX'])); }}><Icon name="report" /></IconButton>}
        {labels.has('TRASH')
          ? <IconButton label={t('restore')} onClick={() => act(() => gmail.untrashThread(threadId))}><Icon name="restore" /></IconButton>
          : <IconButton label={t('trash')} onClick={() => act(() => gmail.trashThread(threadId))}><Icon name="delete" /></IconButton>}
        <span className="tool-sep" aria-hidden="true" />
        <IconButton label={t('markUnread')} onClick={() => act(() => gmail.modifyThread(threadId, ['UNREAD'], []))}><Icon name="unread" /></IconButton>
        <IconButton label={labels.has('STARRED') ? t('unstar') : t('star')} className={labels.has('STARRED') ? 'star-on' : ''} aria-pressed={labels.has('STARRED')}
          onClick={() => act(() => gmail.modifyThread(threadId, labels.has('STARRED') ? [] : ['STARRED'], labels.has('STARRED') ? ['STARRED'] : []), false)}>
          <Icon name="star" />
        </IconButton>
        {!labels.has('TRASH') && !labels.has('SPAM') && (
          <Menu align="right" label={t('labelAs')} button={<Icon name="label" />}>
            <LabelPicker state={(id) => labels.has(id)}
              onToggle={(l) => act(() => gmail.modifyThread(threadId, labels.has(l.id) ? [] : [l.id], labels.has(l.id) ? [l.id] : []), false)}
              onNew={(name) => act(async () => {
                const l = mail.userLabels.find((x) => x.name.toLowerCase() === name.toLowerCase()) || await mail.createLabel(name);
                await gmail.modifyThread(threadId, [l.id], []);
              }, false)} />
          </Menu>
        )}
      </div>
      <h1 className="thread-subject">
        {subject}
        {mail.userLabels.filter((l) => labels.has(l.id)).map((l) => <span key={l.id} className="lchip lchip-title">{l.name}</span>)}
        <button type="button" className={labels.has('IMPORTANT') ? 'imp imp-on' : 'imp'} aria-pressed={labels.has('IMPORTANT')}
          aria-label={labels.has('IMPORTANT') ? t('markNotImportant') : t('markImportant')} title={labels.has('IMPORTANT') ? t('importantTitle') : t('markImportant')}
          onClick={() => act(() => gmail.modifyThread(threadId, labels.has('IMPORTANT') ? [] : ['IMPORTANT'], labels.has('IMPORTANT') ? ['IMPORTANT'] : []), false)}>
          <Icon name="important" size={22} />
        </button>
      </h1>
      <ol className="mcards">
        {msgs.map((m, i) => (m.labelIds.includes('DRAFT') ? <DraftCard key={m.id} m={m} /> : (
          <MessageCard key={m.id} m={m} threadId={threadId} me={mail.account} isLast={i === lastReal}
            expanded={isOpen(m, i)} onToggle={() => setOpen({ ...open, [m.id]: !isOpen(m, i) })} />
        )))}
      </ol>
    </article>
  );
}
