import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import * as gmail from '@gmail';
import { summarize } from '../gmail/mime.js';
import { useMail } from './context.jsx';
import { useI18n } from '../i18n.jsx';
import { labelIdFor, isSystemFolder } from './folders.js';
import { useEcsMarks } from './ecsCheck.js';

export default function ThreadList() {
  const { folder } = useParams();
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const mail = useMail();
  const { t, formatShort } = useI18n();
  const [pages, setPages] = useState(['']); // page tokens; last is current
  const [state, setState] = useState({ key: null, rows: null, next: null, error: '' });
  const key = `${folder}|${q}|${pages[pages.length - 1]}`;
  const { handle } = mail;

  const fetchPage = useCallback(async () => {
    const pageToken = pages[pages.length - 1] || undefined;
    const { ids, nextPageToken } = await gmail.listThreads({ labelId: labelIdFor(folder) || undefined, q, pageToken });
    const threads = await gmail.getThreadsMeta(ids);
    return { key, rows: threads.map((th) => summarize(th, mail.account)), next: nextPageToken, error: '' };
  }, [folder, q, pages, key, mail.account]);

  const load = useCallback((silent) => fetchPage().then(setState).catch((e) => {
    if (!handle(e) && !silent) setState({ key, rows: null, next: null, error: e.code === 'rate-limit' ? t('rateLimited') : e.message });
  }), [fetchPage, handle, key, t]);

  useEffect(() => {
    let live = true;
    fetchPage().then((r) => { if (live) setState(r); }).catch((e) => {
      if (live && !handle(e)) setState({ key, rows: null, next: null, error: e.code === 'rate-limit' ? t('rateLimited') : e.message });
    });
    return () => { live = false; };
  }, [fetchPage, handle, key, t]);
  // New mail: refresh the first page every minute.
  useEffect(() => {
    if (pages.length > 1) return;
    const id = setInterval(() => load(true), 60_000);
    return () => clearInterval(id);
  }, [load, pages.length]);

  const resetKey = `${folder}|${q}`;
  const [lastReset, setLastReset] = useState(resetKey);
  if (lastReset !== resetKey) { setLastReset(resetKey); setPages(['']); }

  const rows = state.key === key ? state.rows : null;
  const marks = useEcsMarks(rows, (mail.account || '').toLowerCase());

  // Gmail-style selection: a checkbox on each row, one in the header, and
  // actions for everything ticked.
  const [sel, setSel] = useState({ key: null, ids: new Set() });
  const [busyBulk, setBusyBulk] = useState(false);
  const selected = sel.key === key ? sel.ids : new Set();
  const toggle = (id) => {
    const ids = new Set(selected);
    if (ids.has(id)) ids.delete(id); else ids.add(id);
    setSel({ key, ids });
  };
  const allTicked = !!rows?.length && rows.every((r) => selected.has(r.id));
  const someTicked = selected.size > 0 && !allTicked;
  const tickAll = () => setSel({ key, ids: allTicked ? new Set() : new Set(rows.map((r) => r.id)) });
  const inFolder = (f) => !q && folder === f;
  const bulk = async (fn, { local } = {}) => {
    const ids = [...selected];
    setBusyBulk(true);
    try {
      for (let i = 0; i < ids.length; i += 3) await Promise.all(ids.slice(i, i + 3).map(fn)); // a few at a time
      if (local) setState((s) => ({ ...s, rows: s.rows.map((r) => (selected.has(r.id) ? local(r) : r)) }));
      else await load(true);
      setSel({ key, ids: new Set() });
      mail.refreshCounts();
    } catch (e) { if (!handle(e)) setState((s) => ({ ...s, error: e.code === 'rate-limit' ? t('rateLimited') : e.message })); }
    finally { setBusyBulk(false); }
  };
  const toggleStar = async (row) => {
    setState((s) => ({ ...s, rows: s.rows.map((r) => (r.id === row.id ? { ...r, starred: !r.starred } : r)) }));
    try { await gmail.modifyThread(row.id, row.starred ? [] : ['STARRED'], row.starred ? ['STARRED'] : []); } catch (e) { handle(e); load(true); }
  };

  const title = q ? t('searchResults', { q }) : isSystemFolder(folder) ? t(`folder_${folder}`) : (mail.labels.find((l) => l.id === folder)?.name || folder);

  return (
    <div className="threadlist">
      <div className="list-head">
        <div className="list-head-left">
          {rows && rows.length > 0 && (
            <input type="checkbox" className="rowcheck" aria-label={t('selectAll')} checked={allTicked}
              ref={(el) => { if (el) el.indeterminate = someTicked; }} onChange={tickAll} />
          )}
          <h1 className="list-title">{title}</h1>
        </div>
        {selected.size > 0 ? (
          <div className="bulkbar" role="toolbar" aria-label={t('selectedActions')}>
            <span className="bulkcount">{t('nSelected', { n: selected.size })}</span>
            {inFolder('trash')
              ? <button type="button" className="btn" disabled={busyBulk} onClick={() => bulk((id) => gmail.untrashThread(id))}>{t('restore')}</button>
              : <button type="button" className="btn btn-danger" disabled={busyBulk} onClick={() => bulk((id) => gmail.trashThread(id))}>{t('trash')}</button>}
            {inFolder('inbox') && <button type="button" className="btn" disabled={busyBulk} onClick={() => bulk((id) => gmail.modifyThread(id, [], ['INBOX']))}>{t('archive')}</button>}
            {inFolder('spam')
              ? <button type="button" className="btn" disabled={busyBulk} onClick={() => bulk((id) => gmail.modifyThread(id, ['INBOX'], ['SPAM']))}>{t('notSpam')}</button>
              : !inFolder('trash') && <button type="button" className="btn" disabled={busyBulk} onClick={() => bulk((id) => gmail.modifyThread(id, ['SPAM'], ['INBOX']))}>{t('reportSpam')}</button>}
            <button type="button" className="btn" disabled={busyBulk} onClick={() => bulk((id) => gmail.modifyThread(id, [], ['UNREAD']), { local: (r) => ({ ...r, unread: false }) })}>{t('markRead')}</button>
            <button type="button" className="btn" disabled={busyBulk} onClick={() => bulk((id) => gmail.modifyThread(id, ['UNREAD'], []), { local: (r) => ({ ...r, unread: true }) })}>{t('markUnread')}</button>
            <button type="button" className="btn btn-quiet" disabled={busyBulk} onClick={() => setSel({ key, ids: new Set() })}>{t('cancel')}</button>
          </div>
        ) : (
        <div className="pager">
          <button type="button" className="btn btn-quiet" onClick={() => load(false)}>{t('refresh')}</button>
          <button type="button" className="btn btn-quiet" disabled={pages.length < 2} onClick={() => setPages(pages.slice(0, -1))}>{t('newer')}</button>
          <button type="button" className="btn btn-quiet" disabled={!state.next || state.key !== key} onClick={() => setPages([...pages, state.next])}>{t('older')}</button>
        </div>
        )}
      </div>
      {state.error && state.key === key && <p className="error" role="alert">{state.error === t('rateLimited') ? state.error : t('errorGeneric', { msg: state.error })}</p>}
      {!rows && !(state.error && state.key === key) && <p className="loading">{t('loading')}</p>}
      {rows && rows.length === 0 && <p className="empty">{q ? t('noResults') : t('emptyFolder')}</p>}
      {rows && rows.length > 0 && (
        <ul className="msglist">
          {rows.map((r) => (
            <li key={r.id} className={`trow${r.unread ? ' trow-unread' : ''}${selected.has(r.id) ? ' trow-selected' : ''}`}>
              <input type="checkbox" className="rowcheck" checked={selected.has(r.id)} onChange={() => toggle(r.id)}
                aria-label={t('selectRow', { name: r.subject || t('noSubject') })} />
              <button type="button" className={r.starred ? 'star star-on' : 'star'} aria-pressed={r.starred}
                aria-label={r.starred ? t('unstar') : t('star')} onClick={() => toggleStar(r)}>★</button>
              <Link to={`/mail/${encodeURIComponent(folder)}/${r.id}${q ? `?q=${encodeURIComponent(q)}` : ''}`} className="trow-link">
                <span className="row-people">
                  {r.people.length ? r.people.map((p, i) => (
                    <span key={p.email + i}>
                      {i > 0 && ', '}
                      {marks.users.has(p.email) && marks.verdicts[r.id] !== 'spoof'
                        ? <span className="ecs-user" title={t('ecsUserTitle')}>{p.label}</span>
                        : (p.label === 'me' ? t('me') : p.label)}
                    </span>
                  )) : t('noSender')}
                  {r.count > 1 && <span className="tcount"> {r.count}</span>}
                  {r.draft && <span className="draft-tag draft-tag-inline">{t('draft')}</span>}
                </span>
                <span className="row-subject">
                  {r.live && <span className="live" title={t('liveTitle')}>{t('live')}</span>}
                  {marks.verdicts[r.id] === 'spoof' && <span className="spoof-tag">{t('spoofTag')}</span>}
                  <span className={marks.verdicts[r.id] === 'ok' ? 'subj subj-verified' : marks.verdicts[r.id] === 'spoof' ? 'subj subj-spoof' : 'subj'}
                    title={marks.verdicts[r.id] === 'ok' ? t('verifiedTitle') : marks.verdicts[r.id] === 'spoof' ? t('spoofTitle') : undefined}>
                    {r.subject || t('noSubject')}
                  </span>
                  <span className="snip"> · {r.snippet}</span>
                </span>
                <span className="row-meta">
                  {r.hasAttachment && <span aria-label={t('hasAttachment')} title={t('hasAttachment')}>📎</span>}
                  {formatShort(r.date)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
