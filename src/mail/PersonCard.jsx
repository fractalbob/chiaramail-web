import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { useIsEcsUser } from './ecsCheck.js';
import { hue, initial } from './avatar.js';
import Icon from './icons.jsx';

// Gmail's contact card: rest the mouse on a person's name for a moment and a card shows
// who they are, with quick actions. Mouse only (touch screens have no hover).
const SHOW_MS = 450;
const HIDE_MS = 250;

export default function PersonHover({ name, email, children, className }) {
  const [box, setBox] = useState(null); // the name's position when the card opened
  const anchor = useRef(null);
  const timer = useRef(0);
  const clear = () => { clearTimeout(timer.current); timer.current = 0; };
  const show = (e) => {
    if (e.pointerType !== 'mouse' || !email) return;
    clear();
    timer.current = setTimeout(() => { if (anchor.current) setBox(anchor.current.getBoundingClientRect()); }, SHOW_MS);
  };
  const hide = () => { clear(); timer.current = setTimeout(() => setBox(null), HIDE_MS); };
  useEffect(() => () => clear(), []);
  useEffect(() => {
    if (!box) return undefined;
    const close = () => setBox(null);
    const esc = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('scroll', close, true);
    document.addEventListener('keydown', esc);
    return () => { window.removeEventListener('scroll', close, true); document.removeEventListener('keydown', esc); };
  }, [box]);
  return (
    <span ref={anchor} className={className} onPointerEnter={show} onPointerLeave={hide}>
      {children}
      {box && createPortal(
        <PersonCard name={name} email={email} box={box} onEnter={clear} onLeave={hide} onDone={() => setBox(null)} />,
        document.body,
      )}
    </span>
  );
}

function PersonCard({ name, email, box, onEnter, onLeave, onDone }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const ecs = useIsEcsUser(email);
  const [copied, setCopied] = useState(false);
  const W = 320;
  const left = Math.max(8, Math.min(box.left, window.innerWidth - W - 8));
  const below = box.bottom + 230 < window.innerHeight;
  const style = { left, width: W, ...(below ? { top: box.bottom + 6 } : { bottom: window.innerHeight - box.top + 6 }) };
  const shown = name && name !== email ? name : email;
  // The card lives outside the row in the page, but React still passes its events up to the
  // row (a link): keep clicks on the card from opening the conversation.
  const stop = (e) => e.stopPropagation();
  const go = (to) => { onDone(); nav(to); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(email); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* not allowed */ }
  };
  return (
    <div className="pcard" role="dialog" aria-label={shown} style={style}
      onPointerEnter={onEnter} onPointerLeave={onLeave}
      onClick={stop} onPointerDown={stop} onPointerUp={stop} onContextMenu={stop} onMouseDown={stop}>
      <div className="pcard-top">
        <span className="pcard-avatar" style={{ '--av': hue(email) }} aria-hidden="true">{initial(shown)}</span>
        <div className="pcard-who">
          <p className="pcard-name">{shown}</p>
          {shown !== email && <p className="pcard-mail">{email}</p>}
          {ecs && <p className="pcard-ecs">{t('ecsUserTitle')}</p>}
        </div>
      </div>
      <div className="pcard-actions">
        <button type="button" className="ibtn" title={t('sendEmailTo')} aria-label={t('sendEmailTo')}
          onClick={() => go(`/compose?to=${encodeURIComponent(name && name !== email ? `${name} <${email}>` : email)}`)}><Icon name="unread" size={20} /></button>
        <button type="button" className="ibtn" title={t('findFrom', { name: shown })} aria-label={t('findFrom', { name: shown })}
          onClick={() => go(`/mail/all?q=${encodeURIComponent(`from:${email}`)}`)}><Icon name="search" size={20} /></button>
        <button type="button" className="ibtn" title={t('copyAddress')} aria-label={t('copyAddress')} onClick={copy}><Icon name="copy" size={20} /></button>
        {copied && <span className="pcard-copied" role="status">{t('copied')}</span>}
      </div>
    </div>
  );
}
