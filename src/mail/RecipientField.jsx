import { useId, useMemo, useRef, useState } from 'react';
import { parseAddressList, isEmail } from '../gmail/mime.js';
import { suggest } from './contacts.js';
import { useI18n } from '../i18n.jsx';

// Gmail-style recipient row: each address is a chip (avatar, name, address, ×);
// typing shows suggestions (↑/↓, Enter or Tab to pick, Esc to close).
// Enter, Tab, comma, semicolon or leaving the field turns typed text into chips.

const HUES = [210, 340, 160, 25, 270, 120, 190, 0, 300, 45];
export function avatarColor(email) {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${HUES[h % HUES.length]} 55% 38%)`;
}
export function Avatar({ person, size = 28 }) {
  const ch = (person.name || person.email || '?').trim().charAt(0).toUpperCase();
  return (
    <span className="avatar" aria-hidden="true"
      style={{ background: avatarColor(person.email || ''), width: size, height: size, fontSize: size * 0.46 }}>
      {ch}
    </span>
  );
}

export default function RecipientField({ id, label, recipients, onChange, contacts, extra, disabled, describedBy }) {
  const { t } = useI18n();
  const listId = useId();
  const input = useRef(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const emails = useMemo(() => recipients.map((r) => r.email.toLowerCase()), [recipients]);
  const options = useMemo(() => (open ? suggest(contacts, text, emails) : []), [open, contacts, text, emails]);
  const shown = open && options.length > 0 && !disabled;

  const known = (email) => contacts.find((c) => c.email === email.toLowerCase());
  const add = (list) => {
    const out = [...recipients];
    list.forEach((a) => {
      const email = a.email.trim();
      if (!email || out.some((r) => r.email.toLowerCase() === email.toLowerCase())) return;
      out.push({ name: a.name || known(email)?.name || '', email });
    });
    onChange(out);
  };
  const commit = (raw = text) => {
    const parts = parseAddressList(raw);
    if (parts.length) add(parts);
    setText('');
    setOpen(false);
  };
  const pick = (p) => { add([p]); setText(''); setOpen(false); input.current?.focus(); };
  const remove = (i) => { onChange(recipients.filter((_, j) => j !== i)); input.current?.focus(); };
  const edit = (i) => {
    const r = recipients[i];
    onChange(recipients.filter((_, j) => j !== i));
    setText(r.name ? `${r.name} <${r.email}>` : r.email);
    setTimeout(() => input.current?.focus(), 0);
  };

  const onKeyDown = (e) => {
    if (shown && e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % options.length); return; }
    if (shown && e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + options.length) % options.length); return; }
    if (e.key === 'Escape' && shown) { e.preventDefault(); setOpen(false); return; }
    if (e.key === 'Enter' || (e.key === 'Tab' && text.trim())) {
      if (shown) { e.preventDefault(); pick(options[Math.min(active, options.length - 1)]); return; }
      if (text.trim()) { e.preventDefault(); commit(); return; }
      if (e.key === 'Enter') e.preventDefault(); // never submit the form from here
      return;
    }
    if ((e.key === ',' || e.key === ';') && text.trim()) { e.preventDefault(); commit(); return; }
    if (e.key === 'Backspace' && !text && recipients.length) { e.preventDefault(); remove(recipients.length - 1); }
  };

  const onPaste = (e) => {
    const pasted = e.clipboardData.getData('text');
    if (/[,;\n]/.test(pasted) || (pasted.match(/@/g) || []).length > 1) { e.preventDefault(); commit(`${text} ${pasted}`); }
  };

  return (
    <div className={disabled ? 'rfield rfield-disabled' : 'rfield'} onMouseDown={(e) => {
      if (e.target === e.currentTarget || e.target.classList.contains('chips')) { e.preventDefault(); input.current?.focus(); }
    }}>
      <label htmlFor={id} className="rfield-label">{label}</label>
      <ul className="chips" aria-label={t('recipientsOf', { field: label })}>
        {recipients.map((r, i) => {
          const bad = !isEmail(r.email);
          return (
            <li key={r.email + i} className={bad ? 'chip rchip rchip-bad' : 'chip rchip'}
              title={bad ? t('notAnAddress') : r.email} onDoubleClick={() => !disabled && edit(i)}>
              <Avatar person={r} size={22} />
              <span className="rchip-text">{r.name ? <>{r.name} <span className="rchip-addr">({r.email})</span></> : r.email}</span>
              {!disabled && (
                <button type="button" className="chip-x" aria-label={t('removeRecipient', { name: r.name || r.email })}
                  onClick={() => remove(i)}>×</button>
              )}
            </li>
          );
        })}
        <li className="rfield-input">
          <input
            ref={input} id={id} type="text" inputMode="email" autoComplete="off" value={text} disabled={disabled}
            role="combobox" aria-expanded={shown} aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={shown ? `${listId}-${active}` : undefined} aria-describedby={describedBy}
            onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
            onKeyDown={onKeyDown} onPaste={onPaste}
            onBlur={() => { if (text.trim()) commit(); else setOpen(false); }}
          />
        </li>
      </ul>
      {extra && <span className="rfield-extra">{extra}</span>}
      {shown && (
        <ul id={listId} role="listbox" className="combo-list" aria-label={t('suggestions')}>
          {options.map((p, i) => (
            <li key={p.email} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              className={i === active ? 'combo-opt combo-opt-on' : 'combo-opt'}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }} onMouseEnter={() => setActive(i)}>
              <Avatar person={p} size={34} />
              <span className="combo-who">
                <span className="combo-name">{p.name || p.email}</span>
                <span className="combo-email">{p.email}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
