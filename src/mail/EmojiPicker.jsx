import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n.jsx';
import { CATEGORIES, EMOJI, ALL, searchEmoji } from './emoji.js';

// The emoji picker opened from the editor's toolbar: search (English or French),
// categories, and the ones you used last. Arrow keys move around the grid,
// Enter picks, Escape closes.
const COLS = 8;
const RECENT_KEY = 'chiaramail.recentEmoji';
const RECENT_MAX = 24;

function loadRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((e) => typeof e === 'string').slice(0, RECENT_MAX) : [];
  } catch { return []; }
}
function rememberEmoji(e) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...loadRecent().filter((x) => x !== e)].slice(0, RECENT_MAX))); } catch { /* private mode */ }
}

const byChar = new Map(ALL.map((x) => [x.e, x]));
const nameOf = (x, lang) => {
  const words = (lang === 'fr' && x.fr ? x.fr : x.en).split(/\s+/);
  return words.slice(0, words.length > 3 ? 2 : 3).join(' ');
};

export default function EmojiPicker({ onPick, onClose }) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState('');
  const [recent] = useState(loadRecent);
  const root = useRef(null);
  const search = useRef(null);
  const scroller = useRef(null);

  // Phones and tablets: don't pop the on-screen keyboard up over the emoji.
  useEffect(() => {
    if (window.matchMedia?.('(pointer: fine)').matches) search.current?.focus();
    else root.current?.querySelector('.emo')?.focus();
  }, []);

  // Clicking anywhere else closes it.
  useEffect(() => {
    const down = (e) => { if (root.current && !root.current.contains(e.target) && !e.target.closest?.('.fmt-emoji')) onClose(false); };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [onClose]);

  const sections = useMemo(() => {
    if (query.trim()) return [{ id: 'results', list: searchEmoji(query) }];
    const rec = recent.map((e) => byChar.get(e) || { e, en: '', fr: '' });
    return [...(rec.length ? [{ id: 'recent', list: rec }] : []), ...CATEGORIES.map((c) => ({ id: c.id, list: EMOJI[c.id] }))];
  }, [query, recent]);

  const buttons = () => [...root.current.querySelectorAll('.emo')];
  const move = (e) => {
    const all = buttons();
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    // Rows restart at each section, so up/down move to the same column in the row above/below.
    const grid = document.activeElement.parentElement;
    const inGrid = [...grid.children];
    const j = inGrid.indexOf(document.activeElement);
    let target;
    if (e.key === 'ArrowRight') target = all[i + 1];
    else if (e.key === 'ArrowLeft') target = all[i - 1];
    else if (e.key === 'ArrowDown') {
      target = inGrid[j + COLS];
      if (!target) {
        const lastRowStart = Math.floor((inGrid.length - 1) / COLS) * COLS;
        if (j < lastRowStart) target = inGrid[inGrid.length - 1];
        else { const next = all[all.indexOf(inGrid[inGrid.length - 1]) + 1]; if (next) { const ng = [...next.parentElement.children]; target = ng[Math.min(j % COLS, ng.length - 1)]; } }
      }
    } else if (e.key === 'ArrowUp') {
      target = inGrid[j - COLS];
      if (!target) {
        const prev = all[all.indexOf(inGrid[0]) - 1];
        if (prev) { const pg = [...prev.parentElement.children]; const start = Math.floor((pg.length - 1) / COLS) * COLS; target = pg[Math.min(start + (j % COLS), pg.length - 1)]; } else { search.current?.focus(); e.preventDefault(); return; }
      }
    } else if (e.key === 'Home') target = all[0];
    else if (e.key === 'End') target = all[all.length - 1];
    else return;
    e.preventDefault();
    if (target) { target.focus(); target.scrollIntoView({ block: 'nearest' }); }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); return; }
    if (e.target === search.current) {
      if (e.key === 'ArrowDown') { e.preventDefault(); buttons()[0]?.focus(); }
      else if (e.key === 'Enter') { e.preventDefault(); const first = sections[0]?.list[0]; if (first) pick(first.e); }
      return;
    }
    if (e.target.classList?.contains('emo')) move(e);
  };

  const pick = (e) => { rememberEmoji(e); onPick(e); };
  const jump = (id) => {
    setQuery('');
    requestAnimationFrame(() => {
      const h = root.current?.querySelector(`[data-sec="${id}"]`);
      if (h && scroller.current) scroller.current.scrollTop = h.offsetTop - scroller.current.offsetTop;
    });
  };

  const title = (id) => (id === 'results' ? t('emojiResults') : id === 'recent' ? t('emojiRecent') : t(`emoji_${id}`));
  return (
    <div ref={root} className="emoji-pop" role="dialog" aria-label={t('fmtEmoji')} onKeyDown={onKeyDown}>
      <input ref={search} type="search" className="emoji-search" placeholder={t('emojiSearch')} aria-label={t('emojiSearch')}
        value={query} onChange={(e) => { setQuery(e.target.value); if (scroller.current) scroller.current.scrollTop = 0; }} />
      <div className="emoji-tabs" role="toolbar" aria-label={t('emojiCategories')}>
        {recent.length > 0 && <button type="button" className="emoji-tab" title={t('emojiRecent')} aria-label={t('emojiRecent')} onClick={() => jump('recent')}>🕘</button>}
        {CATEGORIES.map((c) => (
          <button key={c.id} type="button" className="emoji-tab" title={t(`emoji_${c.id}`)} aria-label={t(`emoji_${c.id}`)} onClick={() => jump(c.id)}>{c.icon}</button>
        ))}
      </div>
      <div ref={scroller} className="emoji-scroll">
        {sections.map((s) => (
          <section key={s.id} data-sec={s.id} aria-label={title(s.id)}>
            <h3 className="emoji-h">{title(s.id)}</h3>
            {s.list.length ? (
              <div className="emoji-grid">
                {s.list.map((x) => {
                  const name = x.en ? nameOf(x, lang) : x.e;
                  return <button key={x.e} type="button" className="emo" title={name} aria-label={name} onClick={() => pick(x.e)}>{x.e}</button>;
                })}
              </div>
            ) : <p className="emoji-none" role="status">{t('emojiNone')}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
