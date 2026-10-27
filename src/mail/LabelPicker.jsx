import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n.jsx';
import { useMail } from './context.jsx';
import { MenuItem } from './Menu.jsx';

// Gmail's "Label as:" menu: a title and a search box at the top, the labels in a list that
// scrolls on its own, and "Create new" always at the bottom (no scrolling to reach it).
// state(id) → true | false | 'mixed'; onToggle(label); onNew(fullName) creates and applies.
// inbox: Inbox is in the list too (Gmail's phone app does this from a tapped label), so a
// conversation can leave the Inbox or come back to it from there.
export default function LabelPicker({ state, onToggle, onNew, inbox = false }) {
  const { t } = useI18n();
  const mail = useMail();
  const [q, setQ] = useState('');
  const box = useRef(null);
  useEffect(() => { box.current?.focus({ preventScroll: true }); }, []);
  const needle = q.trim().toLowerCase();
  const shown = mail.userLabels.filter((l) => !needle || l.name.toLowerCase().includes(needle));
  const exact = needle && mail.userLabels.some((l) => l.name.toLowerCase() === needle);
  const inboxItem = { id: 'INBOX', name: t('folder_inbox') };
  const showInbox = inbox && (!needle || inboxItem.name.toLowerCase().includes(needle));
  const create = async (initial) => {
    const name = await askNewLabel(initial);
    if (name) onNew(name);
  };
  return (
    <div className="lp">
      <p className="lp-title" id="lp-title">{t('labelAsTitle')}</p>
      <div className="lp-search">
        <input ref={box} type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('searchLabels')}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (shown.length === 1) e.currentTarget.closest('.lp').querySelector('.lp-list [role^="menuitem"]')?.click();
            else if (needle && !exact) e.currentTarget.closest('.lp').querySelector('.lp-create-named')?.click();
          }} />
      </div>
      <div className="lp-list" role="group" aria-labelledby="lp-title">
        {showInbox && <MenuItem checked={state('INBOX')} onClick={() => onToggle(inboxItem)}>{inboxItem.name}</MenuItem>}
        {shown.map((l) => <MenuItem key={l.id} checked={state(l.id)} onClick={() => onToggle(l)}>{l.name}</MenuItem>)}
        {!shown.length && !needle && <p className="menu-note">{t('noLabels')}</p>}
        {needle && !exact && (
          <div className="lp-create-named"><MenuItem onClick={() => onNew(q.trim())}>{t('createNamed', { name: q.trim() })}</MenuItem></div>
        )}
      </div>
      <div className="lp-foot"><MenuItem onClick={() => create(q.trim())}>{t('createNew')}</MenuItem></div>
    </div>
  );
}

// ---- the "New label" box, shown above everything (the menu has closed by then) ----
let show = null; // set by the host
export const askNewLabel = (initial = '') => new Promise((resolve) => (show ? show({ initial, resolve }) : resolve(null)));

export function NewLabelDialogHost() {
  const { t } = useI18n();
  const mail = useMail();
  const [req, setReq] = useState(null);
  const [name, setName] = useState('');
  const [nest, setNest] = useState(false);
  const [parent, setParent] = useState('');
  const input = useRef(null);
  useEffect(() => {
    show = (r) => { setName(r.initial || ''); setNest(false); setParent(''); setReq(r); };
    return () => { show = null; };
  }, []);
  useEffect(() => {
    if (!req) return undefined;
    setTimeout(() => input.current?.focus(), 0);
    // Escape cancels wherever the focus happens to be.
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); req.resolve(null); setReq(null); } };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
  }, [req]);
  if (!req) return null;
  const close = (value) => { req.resolve(value); setReq(null); };
  const clean = name.trim().replace(/^\/+|\/+$/g, '');
  const full = nest && parent ? `${parent}/${clean}` : clean;
  return (
    <div className="dlg-back" onPointerDown={(e) => { if (e.target === e.currentTarget) close(null); }}>
      <form className="dlg" role="dialog" aria-modal="true" aria-labelledby="nl-title"
        onSubmit={(e) => { e.preventDefault(); if (clean) close(full); }}>
        <h2 id="nl-title" className="dlg-title">{t('newLabelTitle')}</h2>
        <label className="dlg-label" htmlFor="nl-name">{t('newLabelName')}</label>
        <input id="nl-name" ref={input} type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={225} autoComplete="off" />
        <label className="dlg-check">
          <input type="checkbox" checked={nest} disabled={!mail.userLabels.length}
            onChange={(e) => { setNest(e.target.checked); if (e.target.checked && !parent) setParent(mail.userLabels[0]?.name || ''); }} />
          {t('nestUnder')}
        </label>
        <select value={parent} disabled={!nest} onChange={(e) => setParent(e.target.value)} aria-label={t('nestUnder')}>
          {!nest && <option value="" />}
          {mail.userLabels.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
        </select>
        <div className="dlg-actions">
          <button type="button" className="btn btn-quiet" onClick={() => close(null)}>{t('cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={!clean}>{t('create')}</button>
        </div>
      </form>
    </div>
  );
}
