import { useEffect, useLayoutEffect, useRef, useState } from 'react';

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
          onClick={(e) => { const it = e.target.closest('[role^="menuitem"]'); if (it && !it.hasAttribute('aria-haspopup')) setOpen(false); }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, children, checked, disabled, icon }) {
  const box = checked !== undefined;
  return (
    <button type="button" role={box ? 'menuitemcheckbox' : 'menuitem'} aria-checked={box ? checked : undefined}
      className="menu-item" onClick={onClick} disabled={disabled}>
      {box && <span className="menu-check" aria-hidden="true">{checked === true ? '☑' : checked === 'mixed' ? '▣' : '☐'}</span>}
      {icon}
      {children}
    </button>
  );
}

/** A right-click menu at (x, y), kept inside the window; closes on pick, outside click, Escape, scroll or resize. */
export function ContextMenu({ x, y, label, onClose, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, flip: false });
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8));
    setPos({ left, top, flip: left + r.width + 220 > window.innerWidth });
  }, [x, y]);
  useEffect(() => {
    ref.current?.querySelector('[role^="menuitem"]')?.focus();
    const off = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    const away = () => onClose();
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', esc);
    // Close when the user scrolls (not on scrolls the page makes by itself, e.g. after a reload).
    const wheel = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    window.addEventListener('resize', away);
    window.addEventListener('wheel', wheel, { passive: true });
    window.addEventListener('touchmove', wheel, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', off);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', away);
      window.removeEventListener('wheel', wheel);
      window.removeEventListener('touchmove', wheel);
    };
  }, [onClose]);
  const keys = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...ref.current.querySelectorAll(':scope > [role^="menuitem"], :scope > .submenu > [role^="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return (
    <div ref={ref} className={`menu ctxmenu${pos.flip ? ' ctx-flip' : ''}`} role="menu" aria-label={label} style={{ left: pos.left, top: pos.top }}
      onKeyDown={keys} onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => { const it = e.target.closest('[role^="menuitem"]'); if (it && !it.hasAttribute('aria-haspopup')) onClose(); }}>
      {children}
    </div>
  );
}

/** A menu item that opens a side menu (Move to ▸, Label as ▸) on hover or click. */
export function SubMenu({ label, icon, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="submenu" onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(true); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOpen(false); }}>
      <button type="button" role="menuitem" className="menu-item" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} onKeyDown={(e) => { if (e.key === 'ArrowRight') setOpen(true); }}>
        {icon}{label}<span className="menu-arrow" aria-hidden="true">▸</span>
      </button>
      {open && <div className="menu submenu-panel" role="menu" aria-label={label}>{children}</div>}
    </div>
  );
}

export const MenuSep = () => <div className="menu-sep" role="separator" />;
