import { useState } from 'react';
import * as backend from '@backend';
import { useI18n } from '../i18n.jsx';
import { isEmail } from '../lib.js';

// The reader page: a 6-digit code emailed to the address (backend/reader.js).
function CodeSignIn({ initialEmail = '' }) {
  const { t } = useI18n();
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(null); // { email, from }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fail = (e) => setError(e.code === 'bad-code' ? t('codeWrong') : e.code === 'rate-limit' ? t('codeTooMany') : t('errorGeneric', { msg: e.message }));

  const ask = async (ev) => {
    ev?.preventDefault();
    const to = (sent?.email || email).trim();
    if (!isEmail(to) || busy) return;
    setError(''); setBusy(true);
    try {
      const r = await backend.sendCode(to);
      setSent({ email: to, from: (r.from || '').replace(/^.*<(.+)>.*$/, '$1') || 'ChiaraMail' });
      setCode('');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const verify = async (ev) => {
    ev.preventDefault();
    if (code.replace(/\D/g, '').length !== 6 || busy) return;
    setError(''); setBusy(true);
    try { await backend.verifyCode(sent.email, code.replace(/\D/g, '')); } catch (e) { fail(e); setBusy(false); }
  };

  return (
    <div className="signin">
      <h2 className="signin-title">{t('signInTitle')}</h2>
      {!sent ? (
        <form onSubmit={ask} className="signin-form">
          <p>{t('codeIntro')}</p>
          <label htmlFor="signin-email">{t('yourEmail')}</label>
          <input id="signin-email" type="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="btn" disabled={busy || !isEmail(email)}>{busy ? t('codeSending') : t('codeSend')}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="signin-form">
          <p role="status">{t('codeSent', { email: sent.email, from: sent.from })}</p>
          <label htmlFor="signin-code">{t('codeLabel')}</label>
          <input id="signin-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required value={code}
            onChange={(e) => setCode(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={busy || code.replace(/\D/g, '').length !== 6}>{t('codeVerify')}</button>
          <p className="signin-more">
            <button type="button" className="linklike" onClick={() => ask()} disabled={busy}>{t('codeAgain')}</button>
            {' · '}
            <button type="button" className="linklike" onClick={() => { setSent(null); setError(''); }}>{t('codeOther')}</button>
          </p>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

export default function SignIn({ returnPath = '/', email = '' }) {
  if (backend.mode === 'reader') return <CodeSignIn initialEmail={email} />;
  return <WebSignIn returnPath={returnPath} />;
}

function WebSignIn({ returnPath }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | sent
  const [error, setError] = useState('');

  const [googleBusy, setGoogleBusy] = useState(false);
  const google = async () => {
    if (googleBusy) return;
    setError(''); setGoogleBusy(true);
    try { await backend.signInWithGoogle(); } catch (e) {
      const quiet = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'];
      if (e?.code === 'auth/popup-blocked') setError(t('popupBlocked'));
      else if (!quiet.includes(e?.code)) setError(t('errorGeneric', { msg: e.message }));
    } finally { setGoogleBusy(false); }
  };
  const sendLink = async (ev) => {
    ev.preventDefault();
    if (!isEmail(email)) return;
    setError(''); setState('sending');
    try {
      await backend.sendSignInLink(email.trim(), returnPath);
      setState('sent');
    } catch (e) {
      setState('idle'); setError(t('errorGeneric', { msg: e.message }));
    }
  };

  if (state === 'sent' && backend.mode !== 'mock') {
    return <div className="signin" role="status"><p>{t('emailLinkSent', { email })}</p></div>;
  }
  return (
    <div className="signin">
      <h2 className="signin-title">{t('signInTitle')}</h2>
      <button type="button" className="btn btn-google" onClick={google} disabled={googleBusy}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        {t('signInWithGoogle')}
      </button>
      <p className="or"><span>{t('or')}</span></p>
      <form onSubmit={sendLink} className="signin-form">
        <label htmlFor="signin-email">{t('yourEmail')}</label>
        <input id="signin-email" type="email" autoComplete="email" required value={email}
          onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" className="btn" disabled={state === 'sending' || !isEmail(email)}>
          {t('emailLinkSend')}
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
