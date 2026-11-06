import { useEffect, useState } from 'react';
import { useI18n } from '../i18n.jsx';
import * as tl from './translate.js';

// Gmail's translation bar, done on the reader's computer. useTranslation(message, request)
// returns { bar, html, text, start }: the bar to show above the message, the translated body when
// the reader has asked for it, and start() for the ⋮ menu's "Translate message".
export function useTranslation(message) {
  const { t, lang } = useI18n();
  const [from, setFrom] = useState(null); // the message's language, once known
  const [st, setSt] = useState({ phase: 'idle' }); // idle | working | done | error
  const [showing, setShowing] = useState(false); // the translation (true) or the original
  const [dismissed, setDismissed] = useState(false);

  // Guess the language quietly (no download), to offer translation like Gmail.
  useEffect(() => {
    if (!tl.canTranslate() || message.pointer) return undefined; // ECS messages: not for now
    let live = true;
    tl.detectQuietly(tl.plainOf(message)).then(async (l) => {
      if (!live || !l || tl.sameLanguage(l, lang)) return;
      if ((await tl.pairStatus(l, lang)) !== 'unavailable' && live) setFrom(l);
    });
    return () => { live = false; };
  }, [message, lang]);

  const run = async (source) => {
    setSt({ phase: 'working', progress: null });
    try {
      let l = source || from;
      if (!l) l = await tl.detect(tl.plainOf(message), (p) => setSt({ phase: 'working', progress: p }));
      if (!l) throw Object.assign(new Error('unknown'), { code: 'unknown' });
      if (tl.sameLanguage(l, lang)) throw Object.assign(new Error('same'), { code: 'same', lang: l });
      setFrom(l);
      if ((await tl.pairStatus(l, lang)) === 'unavailable') throw Object.assign(new Error('pair'), { code: 'pair', lang: l });
      const tr = await tl.translator(l, lang, (p) => setSt({ phase: 'working', progress: p }));
      const html = message.html ? await tl.translateHtml(tr, message.html) : null;
      const text = !message.html && message.text ? await tl.translateText(tr, message.text) : null;
      tr.destroy?.();
      setSt({ phase: 'done', html, text, from: l });
      setShowing(true);
      setDismissed(false);
    } catch (e) {
      setSt({ phase: 'error', code: e.code || 'failed', lang: e.lang });
      setDismissed(false);
    }
  };

  // The menu's "Translate message".
  const start = () => {
    if (st.phase === 'done') { setShowing(true); setDismissed(false); } else if (st.phase !== 'working') run();
  };

  const name = (l) => tl.languageName(l, lang);
  const target = name(lang);
  let bar = null;
  if (st.phase === 'working') {
    bar = <p className="trbar" role="status">{st.progress != null && st.progress < 1 ? t('trDownloading', { n: Math.round(st.progress * 100) }) : t('trWorking')}</p>;
  } else if (st.phase === 'error' && !dismissed) {
    const msg = st.code === 'same' ? t('trSame', { lang: name(st.lang) })
      : st.code === 'pair' ? t('trPair', { from: name(st.lang), to: target })
        : st.code === 'unknown' ? t('trUnknown') : t('trFailed');
    bar = <p className="trbar" role="alert">{msg} <button type="button" className="linklike" onClick={() => setDismissed(true)}>{t('trDismiss')}</button></p>;
  } else if (st.phase === 'done') {
    bar = (
      <p className="trbar">
        {showing ? t('trShown', { from: name(st.from), to: target }) : t('trOffer', { lang: name(st.from) })}{' '}
        <button type="button" className="linklike" onClick={() => setShowing((v) => !v)}>{showing ? t('trOriginal') : t('trTranslate', { to: target })}</button>
      </p>
    );
  } else if (from && !dismissed) {
    bar = (
      <p className="trbar">
        {t('trOffer', { lang: name(from) })}{' '}
        <button type="button" className="linklike" onClick={() => run(from)}>{t('trTranslate', { to: target })}</button>
        {' · '}<button type="button" className="linklike" onClick={() => setDismissed(true)}>{t('trDismiss')}</button>
      </p>
    );
  }
  const on = st.phase === 'done' && showing;
  return { bar, html: on ? st.html : null, text: on ? st.text : null, start };
}
