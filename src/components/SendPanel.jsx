import { useState } from 'react';
import { useI18n } from '../i18n.jsx';
import { composeLinks, invitation } from '../lib.js';

// Hands the email to the sender's own mail program, with the link in it.
export default function SendPanel({ message, updated, onDone }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const body = invitation(t, { id: message.id, updated });
  const subject = message.subject || t('noSubject');
  const links = composeLinks({ to: message.recipients, subject, body });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* clipboard blocked */ }
  };

  return (
    <section className="sendpanel" aria-labelledby="sendpanel-title">
      <h2 id="sendpanel-title">{updated ? t('sendPanelEditTitle') : t('sendPanelTitle')}</h2>
      {!updated && <p>{t('sendPanelHelp')}</p>}
      <pre className="preview">{body}</pre>
      <div className="actions">
        <a className="btn btn-primary" href={links.mailto}>{t('openMailApp')}</a>
        <a className="btn" href={links.gmail} target="_blank" rel="noopener noreferrer">{t('openGmail')}</a>
        <a className="btn" href={links.outlook} target="_blank" rel="noopener noreferrer">{t('openOutlook')}</a>
        <button type="button" className="btn" onClick={copy} aria-live="polite">
          {copied ? t('copied') : t('copyText')}
        </button>
        {onDone && <button type="button" className="btn btn-quiet" onClick={onDone}>{t('done')}</button>}
      </div>
    </section>
  );
}
