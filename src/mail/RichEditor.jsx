import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n.jsx';
import { sanitizeRich } from '../richtext.js';
import { escapeHtml } from '../gmail/mime.js';

// The emoji list is only downloaded the first time someone opens the picker.
const EmojiPicker = lazy(() => import('./EmojiPicker.jsx'));

// A message editor with a small formatting toolbar: bold, italic, underline,
// lists, links, emoji. `value` and `onChange` carry HTML (see richtext.js).
const CMDS = [
  { cmd: 'bold', key: 'fmtBold', label: 'B', cls: 'fmt-b', kbd: 'B' },
  { cmd: 'italic', key: 'fmtItalic', label: 'I', cls: 'fmt-i', kbd: 'I' },
  { cmd: 'underline', key: 'fmtUnderline', label: 'U', cls: 'fmt-u', kbd: 'U' },
  { cmd: 'insertUnorderedList', key: 'fmtBullets', label: '•', cls: 'fmt-list' },
  { cmd: 'insertOrderedList', key: 'fmtNumbers', label: '1.', cls: 'fmt-list' },
];
const exec = (cmd, arg) => document.execCommand(cmd, false, arg);
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function focusStart(el) {
  if (!el) return;
  el.focus();
  const r = document.createRange();
  r.setStart(el, 0); r.collapse(true);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}

export default function RichEditor({ id, label, value, onChange, editorRef, minRows = 14, labelClass }) {
  const { t } = useI18n();
  const el = useRef(null);
  const last = useRef(null);
  const [active, setActive] = useState({});
  const [emojiOpen, setEmojiOpen] = useState(false);
  const caret = useRef(null);

  // Outside changes (a reply being prefilled, a draft loading) replace the content.
  useLayoutEffect(() => {
    if (el.current && value !== last.current) { el.current.innerHTML = value || ''; last.current = value; }
  }, [value]);
  useEffect(() => { if (editorRef) editorRef.current = el.current; });

  const emit = () => { const v = el.current.innerHTML; last.current = v; onChange(v); };
  const refresh = useCallback(() => {
    if (!el.current || !el.current.contains(window.getSelection()?.anchorNode)) return;
    const st = {};
    CMDS.forEach((c) => { try { st[c.cmd] = document.queryCommandState(c.cmd); } catch { st[c.cmd] = false; } });
    setActive(st);
  }, []);
  useEffect(() => {
    document.addEventListener('selectionchange', refresh);
    return () => document.removeEventListener('selectionchange', refresh);
  }, [refresh]);

  const run = (cmd, arg) => { el.current.focus(); exec('styleWithCSS', false); exec(cmd, arg); emit(); refresh(); };

  const addLink = () => {
    const sel = window.getSelection();
    const range = sel.rangeCount && el.current.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    let url = window.prompt(t('linkPrompt'), 'https://');
    if (!url || /^https?:\/\/$/.test(url.trim())) return;
    url = url.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)) url = `mailto:${url}`;
    else if (!/^(https?:|mailto:)/i.test(url)) url = `https://${url}`;
    el.current.focus();
    if (range) { sel.removeAllRanges(); sel.addRange(range); }
    if (range && !range.collapsed) run('createLink', url);
    else run('insertHTML', `<a href="${escapeHtml(url)}">${escapeHtml(url.replace(/^mailto:/i, ''))}</a>&nbsp;`);
  };

  // Emoji go where the cursor was when the picker opened (or at the end, if the
  // cursor wasn't in the message); the picker stays open for picking several.
  const openEmoji = () => {
    if (emojiOpen) { setEmojiOpen(false); return; }
    const sel = window.getSelection();
    caret.current = sel.rangeCount && el.current.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    setEmojiOpen(true);
  };
  const insertEmoji = (emoji) => {
    const back = document.activeElement; // the emoji just picked, so the next one is a keypress away
    const sel = window.getSelection();
    el.current.focus({ preventScroll: true });
    let r = caret.current;
    if (!r) { r = document.createRange(); r.selectNodeContents(el.current); r.collapse(false); }
    sel.removeAllRanges(); sel.addRange(r);
    run('insertText', emoji);
    caret.current = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    if (back?.closest?.('.emoji-pop')) back.focus({ preventScroll: true });
  };
  const closeEmoji = useCallback((refocus) => {
    setEmojiOpen(false);
    if (refocus && el.current) {
      el.current.focus();
      const r = caret.current;
      if (r) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    }
  }, []);

  const onKeyDown = (e) => {
    if (!(isMac ? e.metaKey : e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'k') { e.preventDefault(); addLink(); return; }
    const c = CMDS.find((x) => x.kbd && x.kbd.toLowerCase() === k && !e.shiftKey);
    if (c) { e.preventDefault(); run(c.cmd); }
  };

  // Pasted text keeps its basic formatting but nothing else (no fonts, colours, scripts).
  const onPaste = (e) => {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    e.preventDefault();
    if (html) run('insertHTML', sanitizeRich(html));
    else if (text.includes('\n')) run('insertHTML', text.replace(/\r\n/g, '\n').split('\n').map(escapeHtml).join('<br>'));
    else run('insertText', text);
  };

  const mod = isMac ? '⌘' : 'Ctrl+';
  return (
    <div className="rich">
      <label id={`${id}-label`} className={labelClass} onClick={() => el.current?.focus()}>{label}</label>
      <div className="rich-box">
        <div className="rich-bar" role="toolbar" aria-label={t('formatting')} aria-controls={id}>
          {CMDS.map((c) => (
            <button key={c.cmd} type="button" className={`fmt ${c.cls}`} aria-pressed={!!active[c.cmd]}
              title={c.kbd ? `${t(c.key)} (${mod}${c.kbd})` : t(c.key)} aria-label={t(c.key)}
              onMouseDown={(e) => e.preventDefault()} onClick={() => run(c.cmd)}>{c.label}</button>
          ))}
          <button type="button" className="fmt fmt-link" title={`${t('fmtLink')} (${mod}K)`} aria-label={t('fmtLink')}
            onMouseDown={(e) => e.preventDefault()} onClick={addLink}>🔗</button>
          <button type="button" className="fmt fmt-clear" title={t('fmtClear')} aria-label={t('fmtClear')}
            onMouseDown={(e) => e.preventDefault()} onClick={() => { run('removeFormat'); run('unlink'); }}>T̸</button>
          <button type="button" className="fmt fmt-emoji" title={t('fmtEmoji')} aria-label={t('fmtEmoji')}
            aria-haspopup="dialog" aria-expanded={emojiOpen}
            onMouseDown={(e) => e.preventDefault()} onClick={openEmoji}>☺</button>
        </div>
        {emojiOpen && (
          <Suspense fallback={<div className="emoji-pop emoji-loading" role="status">…</div>}>
            <EmojiPicker onPick={insertEmoji} onClose={closeEmoji} />
          </Suspense>
        )}
        <div id={id} ref={el} className="letter-input rich-input" contentEditable suppressContentEditableWarning
          role="textbox" aria-multiline="true" aria-labelledby={`${id}-label`} spellCheck
          style={{ minHeight: `${minRows * 1.65}em` }}
          onInput={emit} onKeyDown={onKeyDown} onPaste={onPaste} onFocus={() => exec('defaultParagraphSeparator', 'div')} />
      </div>
    </div>
  );
}
