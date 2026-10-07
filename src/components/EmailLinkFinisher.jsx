import { useEffect, useState } from 'react';
import * as backend from '@backend';
import { useI18n } from '../i18n.jsx';

// Shown when the page was opened from a sign-in link.
export default function EmailLinkFinisher() {
  const { t } = useI18n();
  const [ask, setAsk] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [, rerender] = useState(0);

  const finish = async (addr) => {
    try {
      const r = await backend.completeEmailLink(addr);
      if (r.needsEmail) setAsk(true); else rerender((n) => n + 1);
    } catch (e) {
      setError(t('errorGeneric', { msg: e.message }));
      setAsk(true);
    }
  };
  // Try straight away with the address remembered on this device.
  useEffect(() => {
    let live = true;
    backend.completeEmailLink()
      .then((r) => { if (live) { if (r.needsEmail) setAsk(true); else rerender((n) => n + 1); } })
      .catch((e) => { if (live) { setError(e.message); setAsk(true); } });
    return () => { live = false; };
  }, []);

  if (!ask) return <p className="loading">{t('loading')}</p>;
  return (
    <div className="signin">
      <p>{t('emailLinkAsk')}</p>
      <form className="signin-form" onSubmit={(e) => { e.preventDefault(); setError(''); finish(email.trim()); }}>
        <label htmlFor="finish-email">{t('yourEmail')}</label>
        <input id="finish-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn btn-primary" type="submit">{t('emailLinkFinish')}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
