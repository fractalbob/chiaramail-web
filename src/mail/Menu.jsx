import { useEffect, useRef, useState } from 'react';

/** Gmail-style toolbar button: an icon with a tooltip. */
export function IconButton({ label, children, className = '', ...rest }) {
  return (
    <button type="button" className={`ibtn ${className}`} aria-label={label} title={label} {...rest}>{children}</button>
  );
}

/** A button that opens a small dropdown menu; closes on pick, outside click or Escape. */
export function Menu({ label, button, children, align = 'left', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className={`menu-wrap ${className}`} ref={ref}>
      <IconButton label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{button}</IconButton>
      {open && (
        <div className={`menu menu-${align}`} role="menu" aria-label={label}
          onClick={(e) => { if (e.target.closest('[role^="menuitem"]')) setOpen(false); }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, children, checked, disabled }) {
  const box = checked !== undefined;
  return (
    <button type="button" role={box ? 'menuitemcheckbox' : 'menuitem'} aria-checked={box ? checked : undefined}
      className="menu-item" onClick={onClick} disabled={disabled}>
      {box && <span className="menu-check" aria-hidden="true">{checked === true ? '☑' : checked === 'mixed' ? '▣' : '☐'}</span>}
      {children}
    </button>
  );
}
