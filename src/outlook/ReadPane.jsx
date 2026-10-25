import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n.jsx';
import LiveMessage from '../mail/LiveMessage.jsx';
import { escapeHtml } from '../gmail/mime.js';
import { findEcsLink } from './ecsLink.js';
import * as office from './office.js';

// Reading an email in Outlook: when it's an ECS message (it carries the reader
// link), its content, live, and for its sender the tools to edit or withdraw it.
export default function ReadPane() {
  const { t } = useI18n();
  const [found, setFound] = useState({ n: -1 }); // for email n: { status: noitem | none | ecs, id, key, link, from }
  const [n, setN] = useState(0); // bumped when the reader moves to another email

  useEffect(() => office.onItemChanged(() => setN((x) => x + 1)), []);
  useEffect(() => {
    let live = true;
    const look = office.item()
      ? office.readBodyHtml().then((html) => {
        const hit = findEcsLink(html, window.location.origin);
        return hit ? { status: 'ecs', ...hit, from: office.readFrom() } : { status: 'none' };
      }, () => ({ status: 'none' }))
      : Promise.resolve({ status: 'noitem' });
    look.then((v) => { if (live) setFound({ n, ...v }); });
    return () => { live = false; };
  }, [n]);
  const cur = found.n === n ? found : { status: 'loading' };

  const letThemKnow = useCallback(() => {
    if (cur.status !== 'ecs') return;
    office.replyAll(`<p>${escapeHtml(t('mailUpdated'))}</p><p><a href="${cur.link}">${escapeHtml(cur.link.replace(/#.*$/, ''))}</a></p>`);
  }, [cur, t]);

  if (cur.status === 'loading') return <p className="loading">{t('loading')}</p>;
  if (cur.status === 'noitem') return <p className="help">{t('ol_noItem')}</p>;
  if (cur.status === 'none') return <p className="help">{t('ol_readNone')}</p>;
  return (
    <LiveMessage key={cur.id} pointer={cur.id} message={{ key: cur.key, from: cur.from, text: '' }}
      onLetThemKnow={letThemKnow} inlineConfirm />
  );
}
