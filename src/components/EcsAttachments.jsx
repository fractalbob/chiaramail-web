import { useState } from 'react';
import { useI18n } from '../i18n.jsx';
import { fmtSize } from '../lib.js';
import { getEcsAttachment } from '../ecs.js';

// Files stored with an ECS message's body (never in the email itself).
export default function EcsAttachments({ id, message, ecsKey }) {
  const { t } = useI18n();
  const [error, setError] = useState('');
  const list = message.attachments || [];
  if (!list.length || message.withdrawn || message.locked) return null;
  const download = async (a, i) => {
    setError('');
    try {
      const blob = await getEcsAttachment(id, i, message, ecsKey);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = a.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { setError(t('errorGeneric', { msg: e.message })); }
  };
  return (
    <>
      <ul className="attachments" aria-label={t('attachments')}>
        {list.map((a, i) => (
          <li key={i}>
            <button type="button" className="chip" onClick={() => download(a, i)}>
              📎 {a.name} <span className="chip-size">{fmtSize(a.size)}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
