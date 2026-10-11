import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import * as gmail from '@gmail';
import { summarize } from '../gmail/mime.js';
import { useMail } from './context.jsx';
import { useI18n } from '../i18n.jsx';
import { labelIdFor, isSystemFolder } from './folders.js';
import { useEcsMarks } from './ecsCheck.js';
import Icon from './icons.jsx';
import { IconButton, Menu, MenuItem } from './Menu.jsx';

const PAGE = 25;

export default function ThreadList() {
  const { folder } = useParams();
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const mail = useMail();
  const { t, formatShort } = useI18n();
  const [pages, setPages] = useState(['']); // page tokens; last is current
  const [state, setState] = useState({ key: null, rows: null, next: null, total: 0, error: '' });
  const key = `${folder}|${q}|${pages[pages.length - 1]}`;
  const { handle } = mail;
  const viewLabel = q ? null : labelIdFor(folder); // the label every row in this view carries

  const fetchPage = useCallback(async () => {
    const pageToken = pages[pages.length - 1] || undefined;
    const labelId = labelIdFor(folder) || undefined;
    // The count after "1–25 of": the label's own total when browsing a folder, Gmail's estimate otherwise.
    const [{ ids, nextPageToken, estimate }, label] = await Promise.all([
      gmail.listThreads({ labelId, q, pageToken, max: PAGE }),
      labelId && !q ? gmail.getLabel(labelId).catch(() => null) : null,
    ]);
    const threads = await gmail.getThreadsMeta(ids);
    return { key, rows: threads.map((th) => summarize(th, mail.account)), next: nextPageToken, total: label?.threadsTotal ?? estimate ?? 0, exact: !!label, error: '' };
  }, [folder, q, pages, key, mail.account]);

  const load = useCallback((silent) => fetchPage().then(setState).catch((e) => {
    if (!handle(e) && !silent) setState({ key, rows: null, next: null, total: 0, error: e.code === 'rate-limit' ? t('rateLimited') : e.message });
  }), [fetchPage, handle, key, t]);

  useEffect(() => {
    let live = true;
    fetchPage().then((r) => { if (live) setState(r); }).catch((e) => {
      if (live && !handle(e)) setState({ key, rows: null, next: null, total: 0, error: e.code === 'rate-limit' ? t('rateLimited') : e.message });
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

  // Gmail-style selection: a checkbox on each row, one in the toolbar with a
  // ▾ menu (All, None, Read, …), and icon actions for everything ticked.
  const [sel, setSel] = useState({ key: null, ids: new Set() });
  const [busyBulk, setBusyBulk] = useState(false);
  const selected = sel.key === key ? sel.ids : new Set();
  const selRows = (rows || []).filter((r) => selected.has(r.id));
  const toggle = (id) => {
    const ids = new Set(selected);
    if (ids.has(id)) ids.delete(id); else ids.add(id);
    setSel({ key, ids });
  };
  const pick = (test) => setSel({ key, ids: new Set((rows || []).filter(test).map((r) => r.id)) });
  const allTicked = !!rows?.length && rows.every((r) => selected.has(r.id));
  const someTicked = selected.size > 0 && !allTicked;
  const tickAll = () => pick(() => !allTicked);
  const inFolder = (f) => !q && folder === f;

  // What a row looks like after labels change, or null when it leaves this view.
  const relabel = (r, add, remove) => {
    const ids = new Set(r.labelIds);
    remove.forEach((l) => ids.delete(l));
    add.forEach((l) => ids.add(l));
    if (viewLabel && !ids.has(viewLabel)) return null;
    if (['TRASH', 'SPAM'].some((x) => x !== viewLabel && ids.has(x))) return null;
    return { ...r, labelIds: [...ids], unread: ids.has('UNREAD'), starred: ids.has('STARRED'), important: ids.has('IMPORTANT') };
  };
  // Act on conversations (the ticked ones by default). The list updates at once
  // and Gmail catches up in the background; if Gmail refuses, the error shows
  // and the list is reloaded.
  const bulk = async (fn, add = [], remove = [], ids = [...selected]) => {
    if (!ids.length) return;
    const picked = new Set(ids);
    const leaves = (rows || []).some((r) => picked.has(r.id) && !relabel(r, add, remove));
    setSel({ key, ids: new Set() });
    setState((s) => ({ ...s, error: '', rows: s.rows.flatMap((r) => { if (!picked.has(r.id)) return [r]; const n = relabel(r, add, remove); return n ? [n] : []; }) }));
    setBusyBulk(true);
    try {
      for (let i = 0; i < ids.length; i += 3) await Promise.all(ids.slice(i, i + 3).map(fn)); // a few at a time
      mail.refreshCounts();
      if (leaves) load(true); // fill the page back up from Gmail
    } catch (e) {
      if (!handle(e)) setState((s) => ({ ...s, error: e.code === 'rate-limit' ? t('rateLimited') : e.message }));
      load(true);
    } finally { setBusyBulk(false); }
  };
  const labelBulk = (add, remove, ids) => bulk((id) => gmail.modifyThread(id, add, remove), add, remove, ids);
  const toggleStar = async (row) => {
    const on = !row.starred;
    setState((s) => ({ ...s, rows: s.rows.map((r) => (r.id === row.id ? { ...r, starred: on, labelIds: on ? [...r.labelIds, 'STARRED'] : r.labelIds.filter((l) => l !== 'STARRED') } : r)) }));
    try { await gmail.modifyThread(row.id, on ? ['STARRED'] : [], on ? [] : ['STARRED']); } catch (e) { handle(e); load(true); }
  };

  const title = q ? t('searchResults', { q }) : isSystemFolder(folder) ? t(`folder_${folder}`) : (mail.labels.find((l) => l.id === folder)?.name || folder);
  const anyUnread = selRows.some((r) => r.unread);
  const anyRead = selRows.some((r) => !r.unread);
  const has = (l) => selRows.filter((r) => r.labelIds.includes(l)).length;
  const labelState = (l) => { const n = has(l); return n === 0 ? false : n === selRows.length ? true : 'mixed'; };
  const canMove = !inFolder('trash') && !inFolder('spam');
  // "Move to" takes the conversation out of where it is now: this label if it's one you can remove, else the inbox.
  const moveFrom = viewLabel === 'INBOX' || (viewLabel && !isSystemFolder(folder)) ? viewLabel : 'INBOX';
  const moveTo = (target) => labelBulk([target], target === moveFrom ? [] : [moveFrom]);
  const first = (pages.length - 1) * PAGE + 1;
  const last = first + (rows?.length || 0) - 1;
  const range = !rows?.length ? ''
    : !state.exact && state.next && state.total <= last ? t('rangeOfMany', { a: first, b: last })
      : t('rangeOf', { a: first, b: last, n: Math.max(state.total, last).toLocaleString() });

  return (
    <div className="threadlist">
      <div className="list-head">
        <div className="list-tools">
          {rows && rows.length > 0 && (
            <div className="selbox">
              <input type="checkbox" className="rowcheck" aria-label={t('selectAll')} title={t('selectAll')} checked={allTicked}
                ref={(el) => { if (el) el.indeterminate = someTicked; }} onChange={tickAll} />
              <Menu label={t('selectMenu')} button={<Icon name="drop" size={18} />} className="selmenu">
                <MenuItem onClick={() => pick(() => true)}>{t('selAll')}</MenuItem>
                <MenuItem onClick={() => pick(() => false)}>{t('selNone')}</MenuItem>
                <MenuItem onClick={() => pick((r) => !r.unread)}>{t('selRead')}</MenuItem>
                <MenuItem onClick={() => pick((r) => r.unread)}>{t('selUnread')}</MenuItem>
                <MenuItem onClick={() => pick((r) => r.starred)}>{t('selStarred')}</MenuItem>
                <MenuItem onClick={() => pick((r) => !r.starred)}>{t('selUnstarred')}</MenuItem>
              </Menu>
            </div>
          )}
          {selected.size > 0 ? (
            <div className="bulkbar" role="toolbar" aria-label={t('selectedActions')}>
              {canMove && selRows.some((r) => r.labelIds.includes('INBOX')) && (
                <IconButton label={t('archive')} disabled={busyBulk} onClick={() => labelBulk([], ['INBOX'])}><Icon name="archive" /></IconButton>
              )}
              {inFolder('spam')
                ? <IconButton label={t('notSpam')} disabled={busyBulk} onClick={() => labelBulk(['INBOX'], ['SPAM'])}><Icon name="inbox" /></IconButton>
                : !inFolder('trash') && <IconButton label={t('reportSpam')} disabled={busyBulk} onClick={() => labelBulk(['SPAM'], ['INBOX'])}><Icon name="report" /></IconButton>}
              {inFolder('trash')
                ? <IconButton label={t('restore')} disabled={busyBulk} onClick={() => bulk((id) => gmail.untrashThread(id), [], ['TRASH'])}><Icon name="restore" /></IconButton>
                : <IconButton label={t('trash')} disabled={busyBulk} onClick={() => bulk((id) => gmail.trashThread(id), ['TRASH'], ['INBOX'])}><Icon name="delete" /></IconButton>}
              <span className="tool-sep" aria-hidden="true" />
              {anyUnread
                ? <IconButton label={t('markRead')} disabled={busyBulk} onClick={() => labelBulk([], ['UNREAD'])}><Icon name="read" /></IconButton>
                : <IconButton label={t('markUnread')} disabled={busyBulk} onClick={() => labelBulk(['UNREAD'], [])}><Icon name="unread" /></IconButton>}
              {canMove && (
                <Menu align="right" label={t('moveTo')} button={<Icon name="move" />}>
                  {moveFrom !== 'INBOX' && <MenuItem onClick={() => moveTo('INBOX')}>{t('folder_inbox')}</MenuItem>}
                  {mail.userLabels.filter((l) => l.id !== viewLabel).map((l) => <MenuItem key={l.id} onClick={() => moveTo(l.id)}>{l.name}</MenuItem>)}
                  {!mail.userLabels.length && <p className="menu-note">{t('noLabels')}</p>}
                </Menu>
              )}
              <Menu align="right" label={t('labelAs')} button={<Icon name="label" />}>
                {mail.userLabels.map((l) => {
                  const st = labelState(l.id);
                  return <MenuItem key={l.id} checked={st} onClick={() => (st === true ? labelBulk([], [l.id]) : labelBulk([l.id], []))}>{l.name}</MenuItem>;
                })}
                {!mail.userLabels.length && <p className="menu-note">{t('noLabels')}</p>}
              </Menu>
              <Menu align="right" label={t('moreActions')} button={<Icon name="more" />}>
                {anyUnread && <MenuItem onClick={() => labelBulk([], ['UNREAD'])}>{t('markRead')}</MenuItem>}
                {anyRead && <MenuItem onClick={() => labelBulk(['UNREAD'], [])}>{t('markUnread')}</MenuItem>}
                {has('IMPORTANT') < selRows.length && <MenuItem onClick={() => labelBulk(['IMPORTANT'], [])}>{t('markImportant')}</MenuItem>}
                {has('IMPORTANT') > 0 && <MenuItem onClick={() => labelBulk([], ['IMPORTANT'])}>{t('markNotImportant')}</MenuItem>}
                {has('STARRED') < selRows.length && <MenuItem onClick={() => labelBulk(['STARRED'], [])}>{t('addStar')}</MenuItem>}
                {has('STARRED') > 0 && <MenuItem onClick={() => labelBulk([], ['STARRED'])}>{t('unstar')}</MenuItem>}
              </Menu>
              <span className="bulkcount">{t('nSelected', { n: selected.size })}</span>
            </div>
          ) : busyBulk ? (
            <span className="bulkcount working" role="status">{t('working')}</span>
          ) : (
            <>
              <IconButton label={t('refresh')} onClick={() => load(false)}><Icon name="refresh" /></IconButton>
              {rows?.some((r) => r.unread) && (
                <Menu label={t('moreActions')} button={<Icon name="more" />}>
                  <MenuItem onClick={() => labelBulk([], ['UNREAD'], rows.filter((r) => r.unread).map((r) => r.id))}>{t('markAllRead')}</MenuItem>
                </Menu>
              )}
            </>
          )}
        </div>
        <div className="pager">
          <h1 className="list-title">{title}</h1>
          {range && <span className="range">{range}</span>}
          <IconButton label={t('newer')} disabled={pages.length < 2} onClick={() => setPages(pages.slice(0, -1))}><Icon name="left" /></IconButton>
          <IconButton label={t('older')} disabled={!state.next || state.key !== key} onClick={() => setPages([...pages, state.next])}><Icon name="right" /></IconButton>
        </div>
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
