import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as gmail from '@gmail';
import { headerMap, parseAddressList, displayName, decodeEntities } from '../gmail/mime.js';
import { useMail } from './context.jsx';
import { useI18n } from '../i18n.jsx';
import Icon from './icons.jsx';
import { IconButton } from './Menu.jsx';

// The Drafts folder: Gmail's drafts, opened in the composer to continue writing.
export default function DraftList() {
  const mail = useMail();
  const { t, formatShort } = useI18n();
  const [pages, setPages] = useState(['']);
  const [state, setState] = useState({ key: null, rows: null, next: null, error: '' });
  const key = pages[pages.length - 1];
  const { handle, refreshCounts } = mail;

  const fetchPage = useCallback(async () => {
    const { drafts, nextPageToken } = await gmail.listDrafts({ pageToken: key || undefined });
    const full = await gmail.getDraftsMeta(drafts.map((d) => d.id));
    const rows = full.map((d) => {
      const h = headerMap(d.message?.payload?.headers);
      const to = [...parseAddressList(h.to), ...parseAddressList(h.cc)];
      return {
        id: d.id,
        to: to.map(displayName).join(', '),
        subject: h.subject || '',
        snippet: decodeEntities(d.message?.snippet),
        date: d.message?.internalDate ? new Date(Number(d.message.internalDate)) : null,
      };
    });
    return { key, rows, next: nextPageToken, error: '' };
  }, [key]);

  useEffect(() => {
    let live = true;
    fetchPage().then((r) => { if (live) setState(r); })
      .catch((e) => { if (live && !handle(e)) setState({ key, rows: null, next: null, error: e.message }); });
    return () => { live = false; };
  }, [fetchPage, handle, key]);

  const rows = state.key === key ? state.rows : null;
  const [sel, setSel] = useState({ key: null, ids: new Set() });
  const selected = sel.key === key ? sel.ids : new Set();
  const toggle = (id) => { const ids = new Set(selected); if (ids.has(id)) ids.delete(id); else ids.add(id); setSel({ key, ids }); };
  const allTicked = !!rows?.length && rows.every((r) => selected.has(r.id));
  const removeSelected = async () => {
    const ids = [...selected];
    setState((s) => ({ ...s, rows: s.rows.filter((r) => !selected.has(r.id)) }));
    setSel({ key, ids: new Set() });
    try {
      for (let i = 0; i < ids.length; i += 3) await Promise.all(ids.slice(i, i + 3).map((id) => gmail.deleteDraft(id)));
      refreshCounts();
    } catch (e) { if (!handle(e)) setState((s) => ({ ...s, error: e.message })); }
  };
  const remove = async (id) => {
    setState((s) => ({ ...s, rows: s.rows.filter((r) => r.id !== id) }));
    try { await gmail.deleteDraft(id); refreshCounts(); } catch (e) { if (!handle(e)) setState((s) => ({ ...s, error: e.message })); }
  };

  return (
    <div className="threadlist">
      <div className="list-head">
        <div className="list-tools">
          {rows && rows.length > 0 && (
            <div className="selbox">
              <input type="checkbox" className="rowcheck" aria-label={t('selectAll')} title={t('selectAll')} checked={allTicked}
                ref={(el) => { if (el) el.indeterminate = selected.size > 0 && !allTicked; }}
                onChange={() => setSel({ key, ids: allTicked ? new Set() : new Set(rows.map((r) => r.id)) })} />
            </div>
          )}
          {selected.size > 0 && (
            <div className="bulkbar" role="toolbar" aria-label={t('selectedActions')}>
              <IconButton label={t('deleteSelected')} onClick={removeSelected}><Icon name="delete" /></IconButton>
              <span className="bulkcount">{t('nSelected', { n: selected.size })}</span>
            </div>
          )}
        </div>
        <div className="pager">
          <h1 className="list-title">{t('folder_drafts')}</h1>
          <IconButton label={t('newer')} disabled={pages.length < 2} onClick={() => setPages(pages.slice(0, -1))}><Icon name="left" /></IconButton>
          <IconButton label={t('older')} disabled={!state.next || state.key !== key} onClick={() => setPages([...pages, state.next])}><Icon name="right" /></IconButton>
        </div>
      </div>
      {state.error && <p className="error" role="alert">{t('errorGeneric', { msg: state.error })}</p>}
      {!rows && !state.error && <p className="loading">{t('loading')}</p>}
      {rows && rows.length === 0 && <p className="empty">{t('noDrafts')}</p>}
      {rows && rows.length > 0 && (
        <ul className="msglist">
          {rows.map((r) => (
            <li key={r.id} className={selected.has(r.id) ? 'trow trow-selected' : 'trow'}>
              <input type="checkbox" className="rowcheck" checked={selected.has(r.id)} onChange={() => toggle(r.id)}
                aria-label={t('selectRow', { name: r.subject || t('noSubject') })} />
              <Link to={`/compose?draft=${r.id}`} className="trow-link trow-draft">
                <span className="row-people"><span className="draft-tag">{t('draft')}</span> {r.to || t('noRecipients')}</span>
                <span className="row-subject">
                  <span className="subj">{r.subject || t('noSubject')}</span>
                  {r.snippet && <span className="snip"> · {r.snippet}</span>}
                </span>
                <span className="row-meta">{formatShort(r.date)}</span>
              </Link>
              <button type="button" className="rowdel" aria-label={t('deleteDraftNamed', { name: r.subject || t('noSubject') })}
                title={t('deleteDraft')} onClick={() => remove(r.id)}>🗑</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
