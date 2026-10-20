// Desktop app sign-in: an email address and password at any provider. The
// servers are found automatically; if that fails, or they need changing, the
// "Server settings" section shows them.
import { useState } from 'react';
import * as gmail from '@gmail';
import { useMail } from './context.jsx';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';

const blankServer = (port, security) => ({ host: '', port, security });

function ServerFields({ id, title, value, onChange }) {
  const { t } = useI18n();
  const set = (k) => (e) => onChange({ ...value, [k]: k === 'port' ? Number(e.target.value) || '' : e.target.value });
  return (
    <fieldset className="dsrv">
      <legend>{title}</legend>
      <label htmlFor={`${id}-host`}>{t('dServer')}</label>
      <input id={`${id}-host`} type="text" value={value.host} onChange={set('host')} autoCapitalize="off" spellCheck="false" required />
      <div className="dsrv-row">
        <span>
          <label htmlFor={`${id}-port`}>{t('dPort')}</label>
          <input id={`${id}-port`} type="text" inputMode="numeric" value={value.port} onChange={set('port')} required />
        </span>
        <span>
          <label htmlFor={`${id}-sec`}>{t('dSecurity')}</label>
          <select id={`${id}-sec`} value={value.security} onChange={set('security')}>
            <option value="ssl">{t('secSsl')}</option>
            <option value="starttls">{t('secStarttls')}</option>
            <option value="none">{t('secNone')}</option>
          </select>
        </span>
      </div>
    </fieldset>
  );
}

export default function DesktopSignIn() {
  const { t } = useI18n();
  const { user } = useAuth();
  const mail = useMail();
  const saved = gmail.savedAccount();
  const reconnecting = mail.status === 'reconnect' && !!saved;
  const [email, setEmail] = useState(saved?.email || '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(saved?.name || '');
  const [advanced, setAdvanced] = useState(false);
  const [userName, setUserName] = useState(saved?.user || '');
  const [imap, setImap] = useState(saved?.imap || blankServer(993, 'ssl'));
  const [smtp, setSmtp] = useState(saved?.smtp || blankServer(465, 'ssl'));
  const [shownFailure, setShownFailure] = useState(null);

  // A failed attempt brings back the settings it tried, ready to correct.
  const f = mail.failure;
  if (f && f !== shownFailure) {
    setShownFailure(f);
    if (f.settings) {
      setImap(f.settings.imap); setSmtp(f.settings.smtp);
      if (f.settings.user) setUserName(f.settings.user);
    }
    if (['notFound', 'connect', 'proton'].includes(f.code) || (f.code === 'auth' && f.settings)) setAdvanced(true);
  }

  const submit = (e) => {
    e.preventDefault();
    const useServers = advanced || reconnecting;
    mail.connect({ email, password, name, ...(useServers ? { user: userName, imap, smtp } : {}) });
  };

  const where = f?.where === 'smtp' ? t('dOutgoing') : t('dIncoming');
  const server = f?.where === 'smtp' ? smtp.host : imap.host;
  const failureText = f && (t(`e_${f.code}`) !== `e_${f.code}` ? t(`e_${f.code}`, { where, server }) : t('e_other', { msg: f.message }));

  return (
    <div className="landing">
      <section className="landing-copy">
        <p className="eyebrow">{t('mailEyebrow')}</p>
        <h1 className="hero">{t('mailTagline')}</h1>
        <p className="lede">{t('appIntro')}</p>
        <ul className="points">
          <li>{t('mailPoint1')}</li>
          <li>{t('mailPoint2')}</li>
          <li>{t('mailPoint3')}</li>
        </ul>
      </section>
      <div className="signin">
        <h2 className="signin-title">{reconnecting ? t('reconnectTitle') : t('desktopTitle')}</h2>
        <p className="help">{reconnecting ? t('reconnectDesktop', { email: saved.email }) : t('desktopHelp')}</p>
        <form className="signin-form dsignin" onSubmit={submit}>
          <label htmlFor="d-email">{t('dEmail')}</label>
          <input id="d-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            readOnly={reconnecting} autoComplete="username" autoFocus={!reconnecting} />
          <label htmlFor="d-pass">{t('dPassword')}</label>
          <input id="d-pass" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password" autoFocus={reconnecting} />
          {!reconnecting && (
            <>
              <label htmlFor="d-name">{t('dName')}</label>
              <input id="d-name" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </>
          )}
          <button type="button" className="linklike dsrv-toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
            {t('dAdvanced')} {advanced ? '▴' : '▾'}
          </button>
          {advanced && (
            <div className="dsrv-all">
              <ServerFields id="imap" title={t('dIncoming')} value={imap} onChange={setImap} />
              <ServerFields id="smtp" title={t('dOutgoing')} value={smtp} onChange={setSmtp} />
              <label htmlFor="d-user">{t('dUser')}</label>
              <input id="d-user" type="text" value={userName} onChange={(e) => setUserName(e.target.value)} autoCapitalize="off" spellCheck="false" />
            </div>
          )}
          {f && !mail.busy && (
            <div role="alert">
              <p className="error">{failureText}</p>
              {['auth', 'connect'].includes(f.code) && f.message && <p className="help dsrv-said">{t('dServerSaid', { msg: f.message })}</p>}
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={mail.busy}>{mail.busy ? t('dConnecting') : t('dConnect')}</button>
        </form>
        {(reconnecting || user) && <button type="button" className="btn btn-quiet dsignout" onClick={mail.disconnect}>{t('otherAccount')}</button>}
        <p className="fineprint">{t('desktopPrivacy')}</p>
      </div>
    </div>
  );
}
