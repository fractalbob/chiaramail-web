import { useEffect, useState } from 'react';
import { useI18n } from '../i18n.jsx';

// Desktop app: attachments save straight to the Downloads folder (no dialog),
// so each one is announced, with Open and Show in folder.
export default function DownloadNote() {
  const { t } = useI18n();
  const bridge = window.chiaramailDesktop?.downloads;
  const [last, setLast] = useState(null); // { id, name }
  useEffect(() => bridge?.onSaved((d) => setLast(d)), [bridge]);
  useEffect(() => {
    if (!last) return undefined;
    const timer = setTimeout(() => setLast(null), 15_000);
    return () => clearTimeout(timer);
  }, [last]);
  if (!bridge || !last) return null;
  return (
    <div className="download-note" role="status">
      <span>{t('dlSaved', { name: last.name })}</span>
      <button type="button" className="btn btn-quiet" onClick={() => bridge.open(last.id)}>{t('dlOpen')}</button>
      <button type="button" className="btn btn-quiet" onClick={() => bridge.show(last.id)}>{t('dlShow')}</button>
      <button type="button" className="chip-x" aria-label={t('dlClose')} onClick={() => setLast(null)}>×</button>
    </div>
  );
}
