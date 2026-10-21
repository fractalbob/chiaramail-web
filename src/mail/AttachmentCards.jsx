import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n.jsx';
import { fmtSize } from '../lib.js';
import Icon from './icons.jsx';

// Attachments as Gmail shows them: a card each (a thumbnail for pictures);
// clicking a card opens it in a viewer (pictures, PDFs, text) with Download
// and Print, and, in the desktop app, "Open with" the computer's own app.
// The download button on the card saves it straight away.
// items: [{ name, type, size, load: () => Promise<Blob> }]

const THUMB_MAX = 8 * 1024 * 1024; // thumbnails only for pictures up to this size
const extOf = (name) => (/\.([a-z0-9]{1,8})$/i.exec(name || '')?.[1] || '').toLowerCase();
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'];
const TEXT_EXT = ['txt', 'csv', 'md', 'log', 'json', 'xml', 'ics', 'vcf'];
export function kindOf(name, type) {
  const t = (type || '').toLowerCase(); const e = extOf(name);
  if (t === 'image/svg+xml' || e === 'svg') return 'other'; // can carry scripts: not previewed
  if (t.startsWith('image/') || IMAGE_EXT.includes(e)) return 'image';
  if (t === 'application/pdf' || e === 'pdf') return 'pdf';
  if (t.startsWith('text/') || TEXT_EXT.includes(e)) return 'text';
  return 'other';
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', pdf: 'application/pdf' };
// A Blob of the right type for showing it (stored ECS files have none).
const typed = (blob, name, type) => {
  const want = (type && type !== 'application/octet-stream' ? type : MIME[extOf(name)]) || blob.type || 'application/octet-stream';
  return blob.type === want ? blob : new Blob([blob], { type: want });
};

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name || 'attachment'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Thumb({ item, k }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (kindOf(item.name, item.type) !== 'image' || item.size > THUMB_MAX) return undefined;
    let live = true; let u = null;
    item.load().then((b) => { if (live) { u = URL.createObjectURL(typed(b, item.name, item.type)); setUrl(u); } }).catch(() => {});
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps -- the same file while k is the same
  if (url) return <img className="acard-thumb" src={url} alt="" />;
  return <span className="acard-icon"><Icon name="file" size={40} /><span className="acard-ext">{extOf(item.name).toUpperCase() || '—'}</span></span>;
}

function Viewer({ item, onClose, onError }) {
  const { t } = useI18n();
  const [view, setView] = useState({ status: 'loading' });
  const frame = useRef(null);
  const kind = kindOf(item.name, item.type);
  const desktop = window.chiaramailDesktop?.downloads;
  useEffect(() => {
    let live = true; let u = null;
    item.load().then(async (b) => {
      if (!live) return;
      const blob = typed(b, item.name, item.type);
      u = URL.createObjectURL(blob);
      setView({ status: 'ok', blob, url: u, text: kind === 'text' ? await blob.text() : null });
    }).catch((e) => { if (live) setView({ status: 'error', error: e.message }); });
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [item.k]); // eslint-disable-line react-hooks/exhaustive-deps -- the same file while k is the same
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const download = () => view.blob && saveBlob(view.blob, item.name);
  const print = () => {
    if (!view.blob) return;
    if (kind === 'pdf' && frame.current?.contentWindow) { frame.current.contentWindow.print(); return; }
    // Pictures and text: a page holding just the file, printed from a hidden frame.
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-1000px';
    document.body.appendChild(f);
    const d = f.contentDocument;
    if (kind === 'image') {
      const img = d.createElement('img'); img.src = view.url; img.style.cssText = 'max-width:100%;max-height:100vh';
      d.body.style.margin = '0'; d.body.appendChild(img);
      img.onload = () => { f.contentWindow.print(); setTimeout(() => f.remove(), 1000); };
    } else {
      const pre = d.createElement('pre'); pre.textContent = view.text || ''; pre.style.cssText = 'white-space:pre-wrap;font:12px/1.4 monospace';
      d.body.appendChild(pre); f.contentWindow.print(); setTimeout(() => f.remove(), 1000);
    }
  };
  const openWith = async () => {
    if (!view.blob) return;
    const r = await desktop.openWith(item.name, new Uint8Array(await view.blob.arrayBuffer()));
    if (r?.error) onError?.(r.error.message);
  };

  return (
    <div className="aview" role="dialog" aria-modal="true" aria-label={item.name} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="aview-bar">
        <span className="aview-name"><Icon name="file" /> {item.name} <span className="aview-size">{fmtSize(item.size)}</span></span>
        <span className="aview-tools">
          <button type="button" className="aview-btn" onClick={download} disabled={!view.blob} title={t('attDownload')} aria-label={t('attDownload')}><Icon name="download" /></button>
          {kind !== 'other' && <button type="button" className="aview-btn" onClick={print} disabled={!view.blob} title={t('attPrint')} aria-label={t('attPrint')}><Icon name="print" /></button>}
          {desktop?.openWith && <button type="button" className="aview-btn aview-open" onClick={openWith} disabled={!view.blob}>{t('attOpenWith')}</button>}
          <button type="button" className="aview-btn" onClick={onClose} title={t('attClose')} aria-label={t('attClose')}><Icon name="close" /></button>
        </span>
      </div>
      <div className="aview-body" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {view.status === 'loading' && <p className="aview-msg">{t('loading')}</p>}
        {view.status === 'error' && <p className="aview-msg">{t('errorGeneric', { msg: view.error })}</p>}
        {view.status === 'ok' && kind === 'image' && <img className="aview-img" src={view.url} alt={item.name} />}
        {view.status === 'ok' && kind === 'pdf' && <iframe ref={frame} className="aview-pdf" title={item.name} src={view.url} />}
        {view.status === 'ok' && kind === 'text' && <pre className="aview-text">{view.text}</pre>}
        {view.status === 'ok' && kind === 'other' && (
          <div className="aview-none">
            <p>{t('attNoPreview')}</p>
            <button type="button" className="btn btn-primary" onClick={download}>{t('attDownload')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AttachmentCards({ items, label }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  // Each file is fetched (and decrypted) once, for the thumbnail, the viewer and downloads.
  const cache = useRef(new Map());
  if (!items.length) return null;
  const keyOf = (it, i) => it.key ?? `${i}|${it.name}|${it.size}`;
  const cached = (it, i) => {
    const k = keyOf(it, i);
    return {
      ...it, k,
      load: () => {
        if (!cache.current.has(k)) cache.current.set(k, it.load().catch((e) => { cache.current.delete(k); throw e; }));
        return cache.current.get(k);
      },
    };
  };
  const list = items.map(cached);
  const download = async (it) => {
    setError('');
    try { saveBlob(await it.load(), it.name); } catch (e) { setError(t('errorGeneric', { msg: e.message })); }
  };
  return (
    <>
      <ul className="acards" aria-label={label || t('attachments')}>
        {list.map((it) => (
          <li key={it.k} className="acard">
            <button type="button" className="acard-open" onClick={() => { setError(''); setOpen(it); }} title={t('attOpen', { name: it.name })}>
              <Thumb item={it} k={it.k} />
              <span className="acard-label"><span className="acard-name">{it.name}</span><span className="acard-size">{fmtSize(it.size)}</span></span>
            </button>
            <button type="button" className="acard-dl" onClick={() => download(it)} title={t('attDownload')} aria-label={t('attDownloadNamed', { name: it.name })}><Icon name="download" /></button>
          </li>
        ))}
      </ul>
      {error && <p className="error" role="alert">{error}</p>}
      {open && <Viewer key={open.k} item={list.find((x) => x.k === open.k) || open} onClose={() => setOpen(null)} onError={(m) => setError(t('errorGeneric', { msg: m }))} />}
    </>
  );
}
