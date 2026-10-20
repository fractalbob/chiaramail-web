import { useI18n } from '../i18n.jsx';

// The reader page's address on its own (no message): what this is.
export default function ReaderHome() {
  const { t } = useI18n();
  return (
    <div className="gate">
      <div className="notice">
        <p className="notice-lead">{t('readerHomeLead')}</p>
        <p>{t('readerHomeHelp')}</p>
      </div>
    </div>
  );
}
