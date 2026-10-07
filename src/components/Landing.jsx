import { useLocation } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import SignIn from './SignIn.jsx';

export default function Landing() {
  const { t } = useI18n();
  const loc = useLocation();
  return (
    <div className="landing">
      <section className="landing-copy">
        <h1 className="hero">{t('tagline')}</h1>
        <p className="lede">{t('intro')}</p>
        <ol className="how">
          <li>{t('how1')}</li>
          <li>{t('how2')}</li>
          <li>{t('how3')}</li>
        </ol>
      </section>
      <SignIn returnPath={loc.pathname} />
    </div>
  );
}
