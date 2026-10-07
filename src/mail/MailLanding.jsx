import { useState } from 'react';
import * as gmail from '@gmail';
import { useMail } from './context.jsx';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';

export default function MailLanding() {
  const { t } = useI18n();
  const { user } = useAuth();
  const mail = useMail();
  const [testAddr, setTestAddr] = useState('');
  const reconnecting = mail.status === 'reconnect' && user;
  const isMock = gmail.mode === 'mock-gmail';

  return (
    <div className="landing">
      <section className="landing-copy">
        <h1 className="hero">{t('mailTagline')}</h1>
        <p className="lede">{t('appIntro')}</p>
        <ul className="points">
          <li>{t('mailPoint1')}</li>
          <li>{t('mailPoint2')}</li>
          <li>{t('mailPoint3')}</li>
        </ul>
      </section>
      <div className="signin">
        <h2 className="signin-title">{reconnecting ? t('reconnectTitle') : t('connectTitle')}</h2>
        <p className="help">{reconnecting ? t('reconnectHelp', { email: user.email }) : t('connectHelp')}</p>
        {isMock ? (
          <form className="signin-form" onSubmit={(e) => { e.preventDefault(); mail.connect(testAddr); }}>
            <label htmlFor="test-addr">{t('testAddress')}</label>
            <input id="test-addr" type="email" required value={testAddr} onChange={(e) => setTestAddr(e.target.value)} />
            <button className="btn btn-primary" type="submit" disabled={mail.busy}>{t('connectGmail')}</button>
          </form>
        ) : (
          <button type="button" className="btn btn-google" onClick={() => mail.connect()} disabled={mail.busy}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            {reconnecting ? t('reconnectGmail') : t('connectGmail')}
          </button>
        )}
        {reconnecting && <button type="button" className="btn btn-quiet" onClick={mail.disconnect}>{t('signOut')}</button>}
        {mail.error && <p className="error" role="alert">{t(mail.error) === mail.error ? t('errorGeneric', { msg: mail.error }) : t(mail.error)}</p>}
        <p className="fineprint">{t('privacyNote')}</p>
      </div>
    </div>
  );
}
