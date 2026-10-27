import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { convertToEcs, undoConvert, convertError } from './convert.js';
import * as prefs from './prefs.js';

// Where Outlook runs the add-in by itself (installed by an administrator), the
// message is converted when Send is pressed, and this pane only says whether it
// will be. Elsewhere (installed by the person), the button here converts it.
export default function ComposePane() {
  const { t } = useI18n();
  const [auto, setAuto] = useState(null); // null while checking
  useEffect(() => {
    let live = true;
    prefs.autoActive().then((a) => { if (live) setAuto(a); });
    return () => { live = false; };
  }, []);
  if (auto === null) return <p className="loading">{t('loading')}</p>;
  return auto ? <AutoPane /> : <ManualPane />;
}

function AutoPane() {
  const { t } = useI18n();
  const [ecs, setEcs] = useState(null);
  const [fwd, setFwd] = useState(false);
  const [byDefault, setByDefault] = useState(prefs.ecsByDefault);
  useEffect(() => {
    let live = true;
    Promise.all([prefs.wantsEcs(), prefs.allowsForward()]).then(([e, f]) => { if (live) { setEcs(e); setFwd(f); } });
    return () => { live = false; };
  }, []);
  if (ecs === null) return <p className="loading">{t('loading')}</p>;

  const changeEcs = async (on) => { setEcs(on); await prefs.setWantsEcs(on); await prefs.showEcsBar(t, on); };
  const changeFwd = async (on) => { setFwd(on); await prefs.setAllowsForward(on); };
  const changeDefault = async (on) => { setByDefault(on); await prefs.setEcsByDefault(on); };

  return (
    <section className="ol-section">
      <h2 className="ol-title">{t('ol_composeTitle')}</h2>
      <label className="subtoggle">
        <input type="checkbox" checked={ecs} onChange={(e) => changeEcs(e.target.checked)} />
        <span>{t('ol_autoThis')}</span>
      </label>
      <p className="help">{ecs ? t('ol_autoOn') : t('ol_autoOff')}</p>
      {ecs && (
        <label className="subtoggle">
          <input type="checkbox" checked={fwd} onChange={(e) => changeFwd(e.target.checked)} />
          <span>{t('ol_allowForward')}</span>
        </label>
      )}
      <hr className="ol-rule" />
      <label className="subtoggle">
        <input type="checkbox" checked={byDefault} onChange={(e) => changeDefault(e.target.checked)} />
        <span>{t('ol_autoDefault')}</span>
      </label>
    </section>
  );
}

function ManualPane() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [allowFwd, setAllowFwd] = useState(false);
  const [state, setState] = useState('idle'); // idle | working | ready | undoing | undone
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const undoRef = useRef(null); // { id, html, files } to put the message back as it was

  const convert = async () => {
    setError(''); setState('working'); setProgress(null);
    try {
      undoRef.current = await convertToEcs({ user, t, allowForward: allowFwd, onProgress: (p) => setProgress(Math.round(p * 100)) });
      setState('ready');
    } catch (e) {
      setError(convertError(t, e));
      setState('idle');
    } finally { setProgress(null); }
  };

  const undo = async () => {
    const r = undoRef.current;
    if (!r) return;
    setError(''); setState('undoing');
    try {
      await undoConvert(r);
      undoRef.current = null;
      setState('undone');
    } catch (e) {
      setError(t('errorGeneric', { msg: e.message }));
      setState('ready');
    }
  };

  if (state === 'ready' || state === 'undoing') {
    return (
      <section className="ol-section" aria-live="polite">
        <h2 className="ol-title">{t('ol_composeTitle')}</h2>
        <p className="ol-done" role="status">✓ {t('ol_ready')}</p>
        <p className="help">{t('ol_readyNote')}</p>
        <button type="button" className="btn btn-quiet" disabled={state === 'undoing'} onClick={undo}>{t('ol_undo')}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <section className="ol-section">
      <h2 className="ol-title">{t('ol_composeTitle')}</h2>
      {state === 'undone' && <p className="note" role="status">{t('ol_undone')}</p>}
      <p className="help">{t('ol_composeHelp')}</p>
      <label className="subtoggle">
        <input type="checkbox" checked={allowFwd} onChange={(e) => setAllowFwd(e.target.checked)} />
        <span>{t('ol_allowForward')}</span>
      </label>
      <button type="button" className="btn btn-primary ol-convert" disabled={state === 'working'} onClick={convert}>
        {state === 'working' ? (progress !== null && progress < 100 ? t('uploading', { n: progress }) : t('ol_converting')) : t('ol_convert')}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
