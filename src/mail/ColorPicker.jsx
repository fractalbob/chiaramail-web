import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n.jsx';

// The colour menu opened from the editor's toolbar, laid out like Gmail's:
// background colours on the left, text colours on the right, same palette.
const PALETTE = [
  ['#000000', '#444444', '#666666', '#999999', '#cccccc', '#eeeeee', '#f3f3f3', '#ffffff'],
  ['#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#9900ff', '#ff00ff'],
  ['#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#cfe2f3', '#d9d2e9', '#ead1dc'],
  ['#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#9fc5e8', '#b4a7d6', '#d5a6bd'],
  ['#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6fa8dc', '#8e7cc3', '#c27ba0'],
  ['#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3d85c6', '#674ea7', '#a64d79'],
  ['#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#0b5394', '#351c75', '#741b47'],
];

export default function ColorPicker({ onPick, onClose }) {
  const { t } = useI18n();
  const root = useRef(null);

  useEffect(() => { root.current?.querySelector('.swatch')?.focus({ preventScroll: true }); }, []);

  // Clicking anywhere else closes it.
  useEffect(() => {
    const down = (e) => { if (root.current && !root.current.contains(e.target) && !e.target.closest?.('.fmt-color')) onClose(false); };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [onClose]);

  // Arrow keys move within a grid; Escape closes and returns to the message.
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); return; }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[e.key];
    if (!step) return;
    const grid = e.target.closest('.swatches');
    const all = grid ? [...grid.querySelectorAll('.swatch')] : [];
    const i = all.indexOf(e.target);
    if (i < 0) return;
    e.preventDefault();
    all[Math.max(0, Math.min(all.length - 1, i + step))].focus();
  };

  const grid = (kind) => (
    <div className="swatches" role="group" aria-label={t(kind === 'back' ? 'colorBack' : 'colorText')}>
      {PALETTE.flat().map((c) => (
        <button key={c} type="button" className="swatch" style={{ background: c }} title={c}
          aria-label={`${t(kind === 'back' ? 'colorBack' : 'colorText')} ${c}`}
          onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(kind, c)} />
      ))}
    </div>
  );

  return (
    <div className="color-pop" ref={root} role="dialog" aria-label={t('fmtColor')} onKeyDown={onKeyDown}>
      <div className="color-col"><p className="color-h">{t('colorBack')}</p>{grid('back')}</div>
      <div className="color-col"><p className="color-h">{t('colorText')}</p>{grid('text')}</div>
    </div>
  );
}
