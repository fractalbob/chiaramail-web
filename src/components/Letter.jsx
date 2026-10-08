import { useI18n } from '../i18n.jsx';
import { toParagraphs } from '../lib.js';
import EcsAttachments from './EcsAttachments.jsx';

// An ECS message, set like a letter, with its edition mark.
export default function Letter({ message, myEmail, banner, ecsKey }) {
  const { t, formatDate } = useI18n();
  const m = message;
  const recips = m.recipients.map((e) => (e === myEmail ? `${e} (${t('you')})` : e)).join(', ');
  return (
    <article className="letter">
      <header className="letter-head">
        <dl className="addr">
          <dt>{t('from')}</dt>
          <dd>{m.senderName ? `${m.senderName} <${m.senderEmail}>` : m.senderEmail}</dd>
          <dt>{t('to')}</dt>
          <dd>{recips}</dd>
        </dl>
        <h1 className="letter-subject">{m.subject || t('noSubject')}</h1>
        {!m.withdrawn && (
          <p className="edition">
            <span className={banner ? 'edition-mark edition-fresh' : 'edition-mark'}>
              {m.edition === 1 ? t('firstEdition') : t('editionN', { n: m.edition })}
            </span>
            <span className="edition-date">
              {m.edition === 1 ? t('sentOn', { date: formatDate(m.createdAt) }) : t('updatedOn', { date: formatDate(m.updatedAt) })}
            </span>
          </p>
        )}
      </header>
      {banner}
      {m.withdrawn ? null : (
        <div className="letter-body">
          {toParagraphs(m.body).map((parts, i) => (
            <p key={i}>
              {parts.map((p, j) => (p.href
                ? <a key={j} href={p.href} target="_blank" rel="noopener noreferrer nofollow">{p.href}</a>
                : <span key={j}>{p.text}</span>))}
            </p>
          ))}
        </div>
      )}
      <EcsAttachments id={m.id} message={m} ecsKey={ecsKey} />
    </article>
  );
}
