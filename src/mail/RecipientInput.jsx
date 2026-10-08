import { useId, useMemo, useState } from 'react';
import { parseAddressList } from '../gmail/mime.js';
import { suggest } from './contacts.js';

// A comma-separated address field with suggestions for the address being typed
// (ARIA combobox: ↑/↓ to move, Enter or Tab to pick, Esc to close).
const fmt = (p) => (p.name ? `${p.name} <${p.email}>` : p.email);

export default function RecipientInput({ id, value, onChange, contacts, describedBy, disabled, label }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [caret, setCaret] = useState(value.length);

  // The address being typed is the text between the last separator before the caret and the caret.
  const start = Math.max(value.lastIndexOf(',', caret - 1), value.lastIndexOf(';', caret - 1)) + 1;
  const current = value.slice(start, caret);
  const already = useMemo(() => parseAddressList(value).map((a) => a.email), [value]);
  const options = useMemo(() => (open ? suggest(contacts, current, already) : []), [open, contacts, current, already]);
  const shown = open && options.length > 0;

  const pick = (p) => {
    const before = value.slice(0, start).replace(/\s*$/, '');
    const after = value.slice(caret).replace(/^[^,;]*[,;]?\s*/, '');
    const next = `${before}${before ? ' ' : ''}${fmt(p)}, ${after}`;
    onChange(next);
    setCaret(next.length - after.length);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (!shown) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + options.length) % options.length); }
    else if (e.key === 'Enter' || (e.key === 'Tab' && current.trim())) { e.preventDefault(); pick(options[Math.min(active, options.length - 1)]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className="combo">
      <input
        id={id} type="text" inputMode="email" autoComplete="off" value={value} disabled={disabled}
        role="combobox" aria-expanded={shown} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={shown ? `${listId}-${active}` : undefined} aria-describedby={describedBy}
        onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setOpen(true); setActive(0); }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => { if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) setCaret(e.target.selectionStart ?? value.length); }}
        onClick={(e) => setCaret(e.target.selectionStart ?? value.length)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {shown && (
        <ul id={listId} role="listbox" className="combo-list" aria-label={label}>
          {options.map((p, i) => (
            <li key={p.email} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              className={i === active ? 'combo-opt combo-opt-on' : 'combo-opt'}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }} onMouseEnter={() => setActive(i)}>
              {p.name && <span className="combo-name">{p.name}</span>}
              <span className="combo-email">{p.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
