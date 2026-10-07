import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import * as backend from '@backend';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { parseRecipients } from '../lib.js';

export default function Compose({ editing = false }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const { id } = useParams();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [original, setOriginal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editing) return;
    let first = true;
    return backend.watchMessage(id, (m) => {
      if (!m || m.senderUid !== user.uid || m.withdrawn) { nav(`/m/${id}`, { replace: true }); return; }
      setOriginal(m);
      if (first) { setSubject(m.subject); setBody(m.body); first = false; }
    }, () => nav(`/m/${id}`, { replace: true }));
  }, [editing, id, user.uid, nav]);

  const submit = async (ev) => {
    ev.preventDefault();
    setError('');
    if (!body.trim()) return setError(t('needBody'));
    try {
      if (editing) {
        if (!original) return;
        setBusy(true);
        await backend.saveEdition(id, original, { subject: subject.trim(), body });
        nav(`/m/${id}?send=updated`);
      } else {
        const { good, bad } = parseRecipients(to);
        if (bad.length) return setError(t('badAddresses', { list: bad.join(', ') }));
        if (!good.length) return setError(t('needRecipient'));
        if (good.length > 50) return setError(t('tooMany'));
        setBusy(true);
        const newId = await backend.createMessage(user, { recipients: good, subject: subject.trim(), body });
        nav(`/m/${newId}?send=new`);
      }
    } catch (e) {
      setBusy(false);
      setError(t('errorGeneric', { msg: e.message }));
    }
  };

  if (editing && !original) return <p className="loading">{t('loading')}</p>;

  return (
    <form className="compose" onSubmit={submit}>
      <h1 className="page-title">{editing ? t('editTitle') : t('newMessage')}</h1>
      {editing && (
        <p className="note">{t('editNote')}</p>
      )}
      <div className="field">
        <label htmlFor="to">{t('to')}</label>
        {editing
          ? <p id="to" className="static">{original.recipients.join(', ')}</p>
          : (
            <>
              <input id="to" type="text" inputMode="email" autoComplete="off" value={to}
                onChange={(e) => setTo(e.target.value)} aria-describedby="to-help" />
              <p id="to-help" className="help">{t('toHelp')}</p>
            </>
          )}
      </div>
      <div className="field">
        <label htmlFor="subject">{t('subject')}</label>
        <input id="subject" type="text" maxLength={300} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="body">{t('message')}</label>
        <textarea id="body" className="letter-input" rows={14} maxLength={100000} value={body}
          onChange={(e) => setBody(e.target.value)} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? t('saving') : editing ? t('saveEdition') : t('saveAndSend')}
        </button>
        <Link to={editing ? `/m/${id}` : '/'} className="btn btn-quiet">{t('cancel')}</Link>
      </div>
    </form>
  );
}
