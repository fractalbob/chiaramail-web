import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import * as gmail from '@gmail';
import { b64urlToB64 } from '../gmail/mime.js';
import { useI18n } from '../i18n.jsx';
import { useAlwaysImages, setAlwaysImages } from './prefs.js';

// Sanitises an HTML email and shows it in a sandboxed frame (no scripts).
// Remote images are held back until the reader asks, so senders can't track
// opens; inline (cid:) images are fetched from the message itself.
function clean(html, allowRemote, inlineSrc) {
  let blocked = 0;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (src.startsWith('cid:')) {
        const d = inlineSrc[src.slice(4)];
        if (d) node.setAttribute('src', d); else node.removeAttribute('src');
      } else if (/^https?:/i.test(src) && !allowRemote) {
        node.removeAttribute('src'); node.removeAttribute('srcset'); blocked += 1;
        node.setAttribute('alt', node.getAttribute('alt') || '');
      }
    }
    if (!allowRemote && node.hasAttribute && node.hasAttribute('style') && /url\(\s*['"]?https?:/i.test(node.getAttribute('style'))) {
      node.setAttribute('style', node.getAttribute('style').replace(/url\([^)]*\)/gi, 'none')); blocked += 1;
    }
    if (!allowRemote && node.hasAttribute && node.hasAttribute('background')) { node.removeAttribute('background'); blocked += 1; }
  });
  const out = DOMPurify.sanitize(html, { WHOLE_DOCUMENT: false, FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'], ADD_ATTR: ['target'] });
  DOMPurify.removeHook('afterSanitizeAttributes');
  return { out, blocked };
}

export default function HtmlBody({ message }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const always = useAlwaysImages();
  // Like Gmail: with "always show images" on, mail in Spam still asks first.
  const allow = shown || (always && !(message.labelIds || []).includes('SPAM'));
  const [inline, setInline] = useState({});
  const frame = useRef(null);

  useEffect(() => {
    const cids = Object.entries(message.inline);
    if (!cids.length) return;
    let live = true;
    Promise.all(cids.map(async ([cid, a]) => {
      const data = a.data || await gmail.getAttachment(message.id, a.attachmentId).catch(() => null);
      return data ? [cid, `data:${a.mimeType};base64,${b64urlToB64(data)}`] : null;
    })).then((pairs) => { if (live) setInline(Object.fromEntries(pairs.filter(Boolean))); });
    return () => { live = false; };
  }, [message]);

  const { out, blocked } = useMemo(() => clean(message.html, allow, inline), [message.html, allow, inline]);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
    html,body{margin:0;padding:0;background:#fff;color:#1d2a30;font:15px/1.5 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;overflow-wrap:anywhere}
    body{padding:4px 2px} img{max-width:100%;height:auto} table{max-width:100%} a{color:#1d58b5}
  </style></head><body>${out}</body></html>`;

  useEffect(() => {
    const f = frame.current;
    if (!f) return;
    let ro;
    const fit = () => {
      const b = f.contentDocument?.body;
      if (b) f.style.height = `${Math.max(60, b.scrollHeight + 12)}px`;
    };
    const onLoad = () => {
      fit();
      const b = f.contentDocument?.body;
      if (b && 'ResizeObserver' in window) { ro = new ResizeObserver(fit); ro.observe(b); }
    };
    f.addEventListener('load', onLoad);
    return () => { f.removeEventListener('load', onLoad); ro?.disconnect(); };
  }, [doc]);

  return (
    <div className="htmlbody">
      {blocked > 0 && !allow && (
        <p className="imgbar">
          {t('imagesHidden')}{' '}
          <button type="button" className="linklike" onClick={() => setShown(true)}>{t('showImages')}</button>
          {!always && <>{' · '}<button type="button" className="linklike" onClick={() => setAlwaysImages(true)}>{t('alwaysShowImages')}</button></>}
        </p>
      )}
      <iframe ref={frame} title={t('messageBody')} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} />
    </div>
  );
}
