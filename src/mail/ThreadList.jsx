import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router-dom';
import * as gmail from '@gmail';
import { summarize, bouncedAddresses } from '../gmail/mime.js';
import { useMail } from './context.jsx';
import { useI18n } from '../i18n.jsx';
import { labelIdFor, isSystemFolder } from './folders.js';
import { useEcsMarks } from './ecsCheck.js';
import { markSpamHandled } from './prefs.js';
import Icon from './icons.jsx';
import { ContextMenu, IconButton, Menu, MenuItem, MenuSep, SubMenu } from './Menu.jsx';
import LabelPicker from './LabelPicker.jsx';
import { hue } from './avatar.js';
import PersonHover from './PersonCard.jsx';

const PAGE = 50; // conversations per page, as in Gmail

// As in Gmail, coming back from a conversation (its ← or the browser's Back)
// returns to the same page of the list, scrolled to where it was, with the
// conversation's row in view. Kept per folder and search, for this session.
const returnTo = new Map(); // `${folder}|${q}` → { pages, state, scrollY, threadId }
const phone = () => window.matchMedia('(max-width: 600px)').matches;

// A row's label chips, as in Gmail: at most two (one on a phone), then "+N" for the rest,
// so labels never push the subject out of sight. The full list is in the tooltip.
// Gmail: tapping a label opens the labels of that conversation, to add or remove some.
// onOpen(e) when tapped (inside the row's link, so not a <button>).
function LabelChips({ ids, names, onOpen, label }) {
  if (!ids.length) return null;
  const all = ids.map((id) => names[id]);
  const tap = onOpen ? {
    role: 'button', tabIndex: 0, 'aria-haspopup': 'menu', 'aria-label': label,
    onClick: onOpen,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(e); },
  } : {};
  const more = (n) => (all.length > n ? <span className={`lchip lchip-more lchip-more-${n}`} title={all.join(', ')} {...tap}>+{all.length - n}</span> : null);
  return (
    <>
      {all.slice(0, 2).map((name, i) => <span key={ids[i]} className={i ? 'lchip lchip-2' : 'lchip'} title={name} {...tap}>{name}</span>)}
      {more(2)}
      {more(1)}
    </>
  );
}

export default function ThreadList() {
  const { folder } = useParams();
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const mail = useMail();
  const { t, formatShort } = useI18n();
  const loc = useLocation();
  const navType = useNavigationType();
  const listKey = `${folder}|${q}`;
  // Coming back to this list: what it showed when the conversation was opened.
  const [back] = useState(() => ((navType === 'POP' || loc.state?.back) ? returnTo.get(listKey) || null : null));
  const [pages, setPages] = useState(() => back?.pages || ['']); // page tokens; last is current
  // The snapshot as it is now: the conversation just read is read, and one just
  // archived or deleted from its own page is gone (the refresh that follows confirms).
  const [state, setState] = useState(() => {
    const st = back?.state;
    if (!st?.rows) return st || { key: null, rows: null, next: null, total: 0, error: '' };
    const { gone, unread } = loc.state || {};
    const rows = st.rows.filter((r) => r.id !== gone).map((r) => (r.id === back.threadId ? { ...r, unread: r.id === unread } : r));
    return { ...st, rows, total: Math.max(0, (st.total || 0) - (st.rows.length - rows.length)) };
  });
  const key = `${folder}|${q}|${pages[pages.length - 1]}`;
  const { handle } = mail;
  const viewLabel = q ? null : labelIdFor(folder); // the label every row in this view carries
  // User labels shown as chips on each row, as in Gmail.
  const labelNames = Object.fromEntries(mail.userLabels.map((l) => [l.id, l.name]));

  // fresh: the Refresh button: ask the mail server now, not from the last few seconds' copy.
  const fetchPage = useCallback(async (fresh) => {
    const pageToken = pages[pages.length - 1] || undefined;
    const labelId = labelIdFor(folder) || undefined;
    // The count after "1–50 of": the label's own total when browsing a folder, Gmail's estimate otherwise.
    const [{ ids, nextPageToken, estimate }, label] = await Promise.all([
      gmail.listThreads({ labelId, q, pageToken, max: PAGE, ...(fresh ? { fresh: true } : {}) }),
      labelId && !q ? gmail.getLabel(labelId).catch(() => null) : null,
    ]);
    const threads = await gmail.getThreadsMeta(ids);
    return { key, rows: threads.map((th) => summarize(th, mail.account)), next: nextPageToken, total: label?.threadsTotal ?? estimate ?? 0, exact: !!label, error: '' };
  }, [folder, q, pages, key, mail.account]);

  const load = useCallback((silent, fresh) => fetchPage(fresh).then(setState).catch((e) => {
    if (!handle(e) && !silent) setState({ key, rows: null, next: null, total: 0, error: e.code === 'rate-limit' ? t('rateLimited') : e.message });
  }), [fetchPage, handle, key, t]);

  useEffect(() => {
    let live = true;
    fetchPage().then((r) => { if (live) setState(r); }).catch((e) => {
      if (live && !handle(e)) setState({ key, rows: null, next: null, total: 0, error: e.code === 'rate-limit' ? t('rateLimited') : e.message });
    });
    return () => { live = false; };
  }, [fetchPage, handle, key, t]);
  // Mail moved behind the scenes (e.g. a verified ECS message rescued from Spam): reload.
  useEffect(() => {
    const on = () => load(true);
    window.addEventListener('chiaramail:changed', on);
    return () => window.removeEventListener('chiaramail:changed', on);
  }, [load]);
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
  const restored = useRef(false);
  const [flash, setFlash] = useState(back?.threadId || null);
  useLayoutEffect(() => {
    if (restored.current || !back || !rows) return;
    restored.current = true;
    window.scrollTo(0, back.scrollY || 0);
    // The list may have changed since: make sure the conversation's row is in view.
    const row = back.threadId && document.querySelector(`[data-thread="${CSS.escape(back.threadId)}"]`);
    if (row) {
      const r = row.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) row.scrollIntoView({ block: 'center' });
    }
  }, [rows, back]);
  useEffect(() => {
    if (!flash) return undefined;
    const id = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(id);
  }, [flash]);
  const remember = (threadId) => returnTo.set(listKey, { pages, state, scrollY: window.scrollY, threadId });
  const marks = useEcsMarks(rows, (mail.account || '').toLowerCase());

  // Gmail-style selection: a checkbox on each row, one in the toolbar with a
  // ▾ menu (All, None, Read, …), and icon actions for everything ticked.
  const [sel, setSel] = useState({ key: null, ids: new Set() });
  const [busyBulk, setBusyBulk] = useState(false);
  const selected = sel.key === key ? sel.ids : new Set();
  const selRows = (rows || []).filter((r) => selected.has(r.id));
  const toggle = (id) => setSel((cur) => {
    const ids = new Set(cur.key === key ? cur.ids : []);
    if (ids.has(id)) ids.delete(id); else ids.add(id);
    return { key, ids };
  });
  // Phones: a long press selects a row (and starts selection mode, where taps select too).
  const press = useRef(null);
  const startPress = (e, id) => {
    if (e.pointerType !== 'touch') { press.current = null; return; }
    const p = { x: e.clientX, y: e.clientY, fired: false, touch: true };
    p.timer = setTimeout(() => { p.fired = true; toggle(id); navigator.vibrate?.(15); }, 500);
    press.current = p;
  };
  const movePress = (e) => {
    const p = press.current;
    if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) clearTimeout(p.timer);
  };
  const endPress = () => { if (press.current && !press.current.fired) clearTimeout(press.current.timer); };
  const tapRow = (e, id) => {
    if (press.current?.fired) { e.preventDefault(); press.current = null; return; }
    if (selected.size > 0 && phone()) { e.preventDefault(); toggle(id); }
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
  // A new label from "Label as": create it in Gmail (or reuse one of that name), then apply it.
  const newLabel = async (name, ids) => {
    try {
      const l = mail.userLabels.find((x) => x.name.toLowerCase() === name.toLowerCase()) || await mail.createLabel(name);
      labelBulk([l.id], [], ids);
    } catch (e) {
      if (!handle(e)) setState((s) => ({ ...s, error: e.message }));
    }
  };
  const labelBulk = (add, remove, ids) => {
    if (add.includes('SPAM')) markSpamHandled(ids || [...selected]); // reported: never pulled back out of Spam
    return bulk((id) => gmail.modifyThread(id, add, remove), add, remove, ids);
  };
  // Star and importance marker: flip one label on one row, at once.
  const flip = async (row, label, field) => {
    const on = !row[field];
    setState((s) => ({ ...s, rows: s.rows.map((r) => (r.id === row.id ? { ...r, [field]: on, labelIds: on ? [...r.labelIds, label] : r.labelIds.filter((l) => l !== label) } : r)) }));
    try { await gmail.modifyThread(row.id, on ? [label] : [], on ? [] : [label]); } catch (e) { handle(e); load(true); }
  };
  const toggleStar = (row) => flip(row, 'STARRED', 'starred');
  // Bounce reports: copy the addresses that couldn't be reached, one per line,
  // ready to paste into a spreadsheet column.
  const [notice, setNotice] = useState('');
  const copyBounced = async (ids = [...selected]) => {
    setNotice(t('bouncedReading'));
    try {
      const found = new Set();
      for (const id of ids) {
        const th = await gmail.getThread(id);
        th.messages.forEach((m) => bouncedAddresses(m).forEach((e) => found.add(e)));
      }
      const list = [...found];
      if (!list.length) { setNotice(t('bouncedNone')); return; }
      try { await navigator.clipboard.writeText(list.join('\n')); setNotice(t('bouncedCopied', { n: list.length })); } catch {
        setNotice(t('bouncedCopyFailed'));
        window.prompt(t('bouncedCopyFailed'), list.join(', '));
      }
    } catch (e) { if (!handle(e)) setNotice(t('errorGeneric', { msg: e.message })); }
  };

  const title = q ? t('searchResults', { q }) : isSystemFolder(folder) ? t(`folder_${folder}`) : (mail.labels.find((l) => l.id === folder)?.name || folder);
  const anyUnread = selRows.some((r) => r.unread);
  const anyRead = selRows.some((r) => !r.unread);
  const has = (l) => selRows.filter((r) => r.labelIds.includes(l)).length;
  const labelState = (l) => { const n = has(l); return n === 0 ? false : n === selRows.length ? true : 'mixed'; };
  const canMove = !inFolder('trash') && !inFolder('spam');
  // "Move to" takes the conversation out of where it is now: this label if it's one you can remove, else the inbox.
  const moveFrom = viewLabel === 'INBOX' || (viewLabel && !isSystemFolder(folder)) ? viewLabel : 'INBOX';
  const moveTo = (target, ids) => labelBulk([target], target === moveFrom ? [] : [moveFrom], ids);
  const first = (pages.length - 1) * PAGE + 1;
  const last = first + (rows?.length || 0) - 1;
  // Right-click on a row (Gmail's context menu). It acts on the ticked rows when
  // the row is one of them, otherwise on that row alone.
  const nav = useNavigate();
  const [ctx, setCtx] = useState(null); // { x, y, id, labels }: labels, only the labels (from tapping one)
  const closeCtx = useCallback(() => setCtx(null), []);
  const openCtx = (e, r) => {
    if (e.shiftKey) return; // Shift + right-click: the browser's own menu
    e.preventDefault();
    if (press.current?.touch) return; // a long press on a phone selects instead
    setCtx({ x: e.clientX, y: e.clientY, id: r.id });
  };
  const openLabels = (e, r) => {
    // In selection mode on a phone, or right after a long press, a tap selects the row instead.
    if (press.current?.fired || (selected.size > 0 && phone())) return;
    e.preventDefault(); e.stopPropagation();
    const b = e.currentTarget.getBoundingClientRect();
    setCtx({ x: b.left, y: b.bottom + 4, id: r.id, labels: true });
  };
  const ctxMenu = () => {
    const row = rows?.find((r) => r.id === ctx.id);
    if (!row) return null;
    const ids = selected.has(row.id) ? [...selected] : [row.id];
    const targets = rows.filter((r) => ids.includes(r.id));
    const one = ids.length === 1;
    const n = (l) => targets.filter((r) => r.labelIds.includes(l)).length;
    const lstate = (l) => (n(l) === 0 ? false : n(l) === targets.length ? true : 'mixed');
    const compose = (mode) => nav(`/compose?thread=${row.id}&msg=${row.lastId}&mode=${mode}`);
    const sender = row.people.find((p) => p.label !== 'me') || row.people[0];
    const find = (query) => nav(`/mail/all?q=${encodeURIComponent(query)}`);
    const openUrl = `/mail/${encodeURIComponent(folder)}/${row.id}${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    if (ctx.labels) {
      return (
        <ContextMenu x={ctx.x} y={ctx.y} label={t('labelAs')} onClose={closeCtx}>
          <LabelPicker state={(l) => row.labelIds.includes(l)} onNew={(name) => newLabel(name, [row.id])}
            onToggle={(l) => (row.labelIds.includes(l.id) ? labelBulk([], [l.id], [row.id]) : labelBulk([l.id], [], [row.id]))} />
        </ContextMenu>
      );
    }
    return (
      <ContextMenu x={ctx.x} y={ctx.y} label={t('rowMenu')} onClose={closeCtx}>
        {one && row.lastId && (
          <>
            <MenuItem icon={<Icon name="reply" size={18} />} onClick={() => compose('reply')}>{t('reply')}</MenuItem>
            <MenuItem icon={<Icon name="replyAll" size={18} />} onClick={() => compose('replyAll')}>{t('replyAll')}</MenuItem>
            <MenuItem icon={<Icon name="forward" size={18} />} onClick={() => compose('forward')}>{t('forward')}</MenuItem>
            <MenuItem icon={<Icon name="attach" size={18} />} onClick={() => compose('forwardAttach')}>{t('forwardAttach')}</MenuItem>
            <MenuSep />
          </>
        )}
        {canMove && n('INBOX') > 0 && <MenuItem icon={<Icon name="archive" size={18} />} onClick={() => labelBulk([], ['INBOX'], ids)}>{t('archive')}</MenuItem>}
        {inFolder('trash')
          ? <MenuItem icon={<Icon name="restore" size={18} />} onClick={() => bulk((id) => gmail.untrashThread(id), [], ['TRASH'], ids)}>{t('restore')}</MenuItem>
          : <MenuItem icon={<Icon name="delete" size={18} />} onClick={() => bulk((id) => gmail.trashThread(id), ['TRASH'], ['INBOX'], ids)}>{t('trash')}</MenuItem>}
        {inFolder('spam') && <MenuItem icon={<Icon name="inbox" size={18} />} onClick={() => labelBulk(['INBOX'], ['SPAM'], ids)}>{t('notSpam')}</MenuItem>}
        {targets.some((r) => r.unread)
          ? <MenuItem icon={<Icon name="read" size={18} />} onClick={() => labelBulk([], ['UNREAD'], ids)}>{t('markRead')}</MenuItem>
          : <MenuItem icon={<Icon name="unread" size={18} />} onClick={() => labelBulk(['UNREAD'], [], ids)}>{t('markUnread')}</MenuItem>}
        {n('STARRED') < targets.length
          ? <MenuItem icon={<Icon name="star" size={18} />} onClick={() => labelBulk(['STARRED'], [], ids)}>{t('addStar')}</MenuItem>
          : <MenuItem icon={<Icon name="star" size={18} />} onClick={() => labelBulk([], ['STARRED'], ids)}>{t('unstar')}</MenuItem>}
        <MenuSep />
        {canMove && (
          <SubMenu label={t('moveTo')} icon={<Icon name="move" size={18} />}>
            {moveFrom !== 'INBOX' && <MenuItem onClick={() => moveTo('INBOX', ids)}>{t('folder_inbox')}</MenuItem>}
            {mail.userLabels.filter((l) => l.id !== viewLabel).map((l) => <MenuItem key={l.id} onClick={() => moveTo(l.id, ids)}>{l.name}</MenuItem>)}
            {!mail.userLabels.length && <p className="menu-note">{t('noLabels')}</p>}
          </SubMenu>
        )}
        <SubMenu label={t('labelAs')} icon={<Icon name="label" size={18} />}>
          <LabelPicker state={lstate} onNew={(name) => newLabel(name, ids)}
            onToggle={(l) => (lstate(l.id) === true ? labelBulk([], [l.id], ids) : labelBulk([l.id], [], ids))} />
        </SubMenu>
        {one && (
          <>
            <MenuSep />
            {sender && <MenuItem icon={<Icon name="search" size={18} />} onClick={() => find(`from:${sender.email}`)}>{t('findFrom', { name: sender.label === 'me' ? t('me') : sender.label })}</MenuItem>}
            {row.subject && <MenuItem icon={<Icon name="search" size={18} />} onClick={() => find(`subject:"${row.subject.replace(/"/g, '')}"`)}>{t('findSubject')}</MenuItem>}
            <MenuSep />
            <MenuItem icon={<Icon name="openNew" size={18} />} onClick={() => window.open(openUrl, '_blank', 'popup,width=960,height=840')}>{t('openNewWindow')}</MenuItem>
          </>
        )}
      </ContextMenu>
    );
  };

  const range = !rows?.length ? ''
    : !state.exact && state.next && state.total <= last ? t('rangeOfMany', { a: first, b: last })
      : t('rangeOf', { a: first, b: last, n: Math.max(state.total, last).toLocaleString() });

  return (
    <div className="threadlist">
      <div className={selected.size > 0 ? 'list-head selecting' : 'list-head'}>
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
              <IconButton label={t('clearSelection')} className="phone-only" onClick={() => setSel({ key, ids: new Set() })}><Icon name="back" /></IconButton>
              <span className="bulkcount">{t('nSelected', { n: selected.size })}</span>
              {canMove && selRows.some((r) => r.labelIds.includes('INBOX')) && (
                <IconButton label={t('archive')} disabled={busyBulk} onClick={() => labelBulk([], ['INBOX'])}><Icon name="archive" /></IconButton>
              )}
              {inFolder('spam')
                ? <IconButton label={t('notSpam')} className="desk-only" disabled={busyBulk} onClick={() => labelBulk(['INBOX'], ['SPAM'])}><Icon name="inbox" /></IconButton>
                : !inFolder('trash') && <IconButton label={t('reportSpam')} className="desk-only" disabled={busyBulk} onClick={() => labelBulk(['SPAM'], ['INBOX'])}><Icon name="report" /></IconButton>}
              {inFolder('trash')
                ? <IconButton label={t('restore')} disabled={busyBulk} onClick={() => bulk((id) => gmail.untrashThread(id), [], ['TRASH'])}><Icon name="restore" /></IconButton>
                : <IconButton label={t('trash')} disabled={busyBulk} onClick={() => bulk((id) => gmail.trashThread(id), ['TRASH'], ['INBOX'])}><Icon name="delete" /></IconButton>}
              <span className="tool-sep desk-only" aria-hidden="true" />
              {anyUnread
                ? <IconButton label={t('markRead')} disabled={busyBulk} onClick={() => labelBulk([], ['UNREAD'])}><Icon name="read" /></IconButton>
                : <IconButton label={t('markUnread')} disabled={busyBulk} onClick={() => labelBulk(['UNREAD'], [])}><Icon name="unread" /></IconButton>}
              {canMove && (
                <Menu align="right" className="desk-only" label={t('moveTo')} button={<Icon name="move" />}>
                  {moveFrom !== 'INBOX' && <MenuItem onClick={() => moveTo('INBOX')}>{t('folder_inbox')}</MenuItem>}
                  {mail.userLabels.filter((l) => l.id !== viewLabel).map((l) => <MenuItem key={l.id} onClick={() => moveTo(l.id)}>{l.name}</MenuItem>)}
                  {!mail.userLabels.length && <p className="menu-note">{t('noLabels')}</p>}
                </Menu>
              )}
              <Menu align="right" className="desk-only" label={t('labelAs')} button={<Icon name="label" />}>
                <LabelPicker state={labelState} onNew={(name) => newLabel(name)}
                  onToggle={(l) => (labelState(l.id) === true ? labelBulk([], [l.id]) : labelBulk([l.id], []))} />
              </Menu>
              <Menu align="right" label={t('moreActions')} button={<Icon name="more" />}>
                <div className="phone-only">
                  {canMove && (
                    <SubMenu label={t('moveTo')}>
                      {moveFrom !== 'INBOX' && <MenuItem onClick={() => moveTo('INBOX')}>{t('folder_inbox')}</MenuItem>}
                      {mail.userLabels.filter((l) => l.id !== viewLabel).map((l) => <MenuItem key={l.id} onClick={() => moveTo(l.id)}>{l.name}</MenuItem>)}
                      {!mail.userLabels.length && <p className="menu-note">{t('noLabels')}</p>}
                    </SubMenu>
                  )}
                  <SubMenu label={t('labelAs')}>
                    <LabelPicker state={labelState} onNew={(name) => newLabel(name)}
                      onToggle={(l) => (labelState(l.id) === true ? labelBulk([], [l.id]) : labelBulk([l.id], []))} />
                  </SubMenu>
                  {inFolder('spam')
                    ? <MenuItem onClick={() => labelBulk(['INBOX'], ['SPAM'])}>{t('notSpam')}</MenuItem>
                    : !inFolder('trash') && <MenuItem onClick={() => labelBulk(['SPAM'], ['INBOX'])}>{t('reportSpam')}</MenuItem>}
                  {!allTicked && <MenuItem onClick={() => pick(() => true)}>{t('selectAll')}</MenuItem>}
                </div>
                {anyUnread && <MenuItem onClick={() => labelBulk([], ['UNREAD'])}>{t('markRead')}</MenuItem>}
                {anyRead && <MenuItem onClick={() => labelBulk(['UNREAD'], [])}>{t('markUnread')}</MenuItem>}
                {has('IMPORTANT') < selRows.length && <MenuItem onClick={() => labelBulk(['IMPORTANT'], [])}>{t('markImportant')}</MenuItem>}
                {has('IMPORTANT') > 0 && <MenuItem onClick={() => labelBulk([], ['IMPORTANT'])}>{t('markNotImportant')}</MenuItem>}
                {has('STARRED') < selRows.length && <MenuItem onClick={() => labelBulk(['STARRED'], [])}>{t('addStar')}</MenuItem>}
                {has('STARRED') > 0 && <MenuItem onClick={() => labelBulk([], ['STARRED'])}>{t('unstar')}</MenuItem>}
                <MenuItem onClick={() => copyBounced()}>{t('copyBounced')}</MenuItem>
              </Menu>
            </div>
          ) : busyBulk ? (
            <span className="bulkcount working" role="status">{t('working')}</span>
          ) : (
            <>
              <IconButton label={t('refresh')} onClick={() => load(false, true)}><Icon name="refresh" /></IconButton>
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
      {notice && <p className="notice-line" role="status">{notice} <button type="button" className="linklike" onClick={() => setNotice('')}>×</button></p>}
      {state.error && state.key === key && <p className="error" role="alert">{state.error === t('rateLimited') ? state.error : t('errorGeneric', { msg: state.error })}</p>}
      {!rows && !(state.error && state.key === key) && <p className="loading">{t('loading')}</p>}
      {rows && rows.length === 0 && <p className="empty">{q ? t('noResults') : t('emptyFolder')}</p>}
      {rows && rows.length > 0 && (
        <ul className="msglist">
          {rows.map((r) => (
            <li key={r.id} data-thread={r.id} onContextMenu={(e) => openCtx(e, r)}
              onPointerDown={(e) => startPress(e, r.id)} onPointerMove={movePress} onPointerUp={endPress} onPointerCancel={endPress}
              className={`trow${r.unread ? ' trow-unread' : ''}${selected.has(r.id) ? ' trow-selected' : ''}${ctx?.id === r.id ? ' trow-ctx' : ''}${flash === r.id ? ' trow-back' : ''}`}>
              <input type="checkbox" className="rowcheck" checked={selected.has(r.id)} onChange={() => toggle(r.id)}
                aria-label={t('selectRow', { name: r.subject || t('noSubject') })} />
              {(() => {
                const who = r.people.find((p) => p.label !== 'me') || r.people[0];
                const name = who ? (who.label === 'me' ? t('me') : who.label) : '?';
                const on = selected.has(r.id);
                return (
                  <button type="button" className={on ? 'avatar avatar-on' : 'avatar'} aria-pressed={on}
                    aria-label={t('selectRow', { name: r.subject || t('noSubject') })} onClick={() => toggle(r.id)}
                    style={on ? undefined : { '--av': hue(who?.email || name) }}>
                    {on ? <Icon name="check" size={20} /> : name.replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase() || '?'}
                  </button>
                );
              })()}
              <button type="button" className={r.starred ? 'star star-on' : 'star'} aria-pressed={r.starred}
                aria-label={r.starred ? t('unstar') : t('star')} onClick={() => toggleStar(r)}>★</button>
              <button type="button" className={r.important ? 'imp imp-on' : 'imp'} aria-pressed={r.important}
                aria-label={r.important ? t('markNotImportant') : t('markImportant')} title={r.important ? t('importantTitle') : t('markImportant')}
                onClick={() => flip(r, 'IMPORTANT', 'important')}><Icon name="important" size={18} /></button>
              <Link to={`/mail/${encodeURIComponent(folder)}/${r.id}${q ? `?q=${encodeURIComponent(q)}` : ''}`} className="trow-link" onClick={(e) => { tapRow(e, r.id); if (!e.defaultPrevented) remember(r.id); }} draggable={false}>
                <span className="row-people">
                  {r.people.length ? r.people.map((p, i) => (
                    <span key={p.email + i}>
                      {i > 0 && ', '}
                      {p.label === 'me' ? t('me') : (
                        <PersonHover name={p.label} email={p.email}>
                          {marks.users.has(p.email) && marks.verdicts[r.id] !== 'spoof'
                            ? <span className="ecs-user" title={t('ecsUserTitle')}>{p.label}</span>
                            : p.label}
                        </PersonHover>
                      )}
                    </span>
                  )) : t('noSender')}
                  {r.count > 1 && <span className="tcount"> {r.count}</span>}
                  {r.draft && <span className="draft-tag draft-tag-inline">{t('draft')}</span>}
                </span>
                <span className="row-subject">
                  {r.live && <span className="live" title={t('liveTitle')}>{t('live')}</span>}
                  {marks.verdicts[r.id] === 'spoof' && <span className="spoof-tag">{t('spoofTag')}</span>}
                  <LabelChips ids={r.labelIds.filter((id) => id !== viewLabel && labelNames[id])} names={labelNames}
                    onOpen={(e) => openLabels(e, r)} label={t('labelAs')} />
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
      {ctx && ctxMenu()}
      {selected.size === 0 && (
        <Link to="/compose" className="fab" aria-label={t('compose')}><Icon name="edit" size={22} /><span>{t('compose')}</span></Link>
      )}
    </div>
  );
}
