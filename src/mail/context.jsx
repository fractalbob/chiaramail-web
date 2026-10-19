import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as gmail from '@gmail';
import * as backend from '@backend';
import { refreshContacts } from './contacts.js';
import { useAuth } from '../auth.jsx';
import { CATEGORIES } from './folders.js';
import { summarize } from '../gmail/mime.js';
import { verdictFor } from './ecsCheck.js';
import { markSpamHandled, spamHandled } from './prefs.js';

// Spam filters distrust ECS emails (short, mostly a link). ChiaraMail can do
// better: an ECS message whose sender it has verified is moved back to the
// Inbox. Forgeries, and anything the user reported themselves, stay in Spam.
async function rescueVerifiedEcs(me) {
  const { ids } = await gmail.listThreads({ labelId: 'SPAM', q: '"ECS message"', max: 20 });
  const todo = ids.filter((id) => !spamHandled(id));
  if (!todo.length) return 0;
  let moved = 0;
  for (const th of await gmail.getThreadsMeta(todo)) {
    const row = summarize(th, me);
    if (!row.ecs.length || (await verdictFor(row.ecs)) !== 'ok') continue;
    await gmail.modifyThread(th.id, ['INBOX'], ['SPAM']);
    markSpamHandled([th.id]);
    moved += 1;
  }
  return moved;
}

const MailCtx = createContext(null);

// status: 'checking' | 'disconnected' | 'reconnect' | 'connected'
export function MailProvider({ children }) {
  const { user } = useAuth();
  const [account, setAccount] = useState(() => gmail.restore());
  const [expired, setExpired] = useState(false);
  const [labels, setLabels] = useState([]);
  const [unread, setUnread] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [grantFor, setGrantFor] = useState(null); // account signed in without Gmail access
  const [failure, setFailure] = useState(null); // desktop app: why the last sign-in failed (code, settings…)

  let status = 'checking';
  if (user !== undefined) {
    if (account && user && user.email === account && !expired) status = 'connected';
    else if (user) status = 'reconnect';
    else status = 'disconnected';
  }

  const cats = useRef([]); // the inbox categories this account has
  const fetchCounts = () => Promise.all([gmail.getLabel('INBOX'), gmail.getLabel('SPAM'), gmail.getLabel('DRAFT'),
    ...cats.current.map((c) => gmail.getLabel(c.label).catch(() => null))])
    .then(([inbox, spam, drafts, ...catLabels]) => ({
      inbox: inbox.threadsUnread || 0, spam: spam.threadsUnread || 0, drafts: drafts.messagesTotal || 0,
      ...Object.fromEntries(cats.current.map((c, i) => [c.key, catLabels[i]?.threadsUnread || 0])),
    }));
  const onErr = (e) => { if (e.code === 'reconnect') setExpired(true); };
  const refreshCounts = useCallback(() => fetchCounts().then(setUnread).catch(onErr), []); // eslint-disable-line react-hooks/exhaustive-deps
  const rescue = useCallback(() => rescueVerifiedEcs(account).then((n) => { if (n) { refreshCounts(); window.dispatchEvent(new Event('chiaramail:changed')); } }).catch(onErr), [account, refreshCounts]);

  // List this address in the ECS directory, so others see it uses ECS.
  useEffect(() => {
    if (status === 'connected') backend.registerEcsUser(user);
  }, [status, user]);

  // Build the recipient suggestions in the background as soon as Gmail is
  // connected, so they're ready by the time someone writes a message.
  useEffect(() => {
    if (status !== 'connected' || !account) return;
    // Let the inbox load first.
    const t = setTimeout(() => refreshContacts(account.toLowerCase()).catch(() => {}), 3000);
    return () => clearTimeout(t);
  }, [status, account]);

  useEffect(() => {
    if (status !== 'connected') return;
    let live = true;
    gmail.listLabels().then((l) => {
      if (!live) return;
      setLabels(l);
      cats.current = CATEGORIES.filter((c) => l.some((x) => x.id === c.label));
      fetchCounts().then((c) => { if (live) setUnread(c); }).catch(onErr);
    }).catch(onErr);
    rescue();
    const reloadLabels = () => gmail.listLabels().then((l) => { if (live) setLabels(l); }).catch(() => {});
    const t = setInterval(() => { refreshCounts(); rescue(); reloadLabels(); }, 60_000);
    // Labels created or renamed in Gmail show up when the window comes back into focus.
    const onFocus = () => { if (document.visibilityState === 'visible') reloadLabels(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => { live = false; clearInterval(t); document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus); };
  }, [status, refreshCounts, rescue]);

  const value = useMemo(() => ({
    status,
    account,
    labels,
    userLabels: labels.filter((l) => l.type === 'user').sort((a, b) => a.name.localeCompare(b.name)),
    unread,
    busy,
    error,
    grantFor,
    refreshCounts,
    connect: async (arg) => {
      setBusy(true); setError(''); setGrantFor(null); setFailure(null);
      try { const email = await gmail.connect(arg); setAccount(email); setExpired(false); } catch (e) {
        if (gmail.mode === 'desktop') { setFailure(e); return; }
        const quiet = ['popup_closed', 'popup_failed_to_open', 'access_denied'];
        if (e.code === 'scope-denied') { setError(e.email ? 'scopeDeniedFor' : 'scopeDenied'); setGrantFor(e.email || ''); }
        else if (e.code === 'popup_failed_to_open') setError('popupBlocked');
        else if (!quiet.includes(e.code)) setError(e.message);
      } finally { setBusy(false); }
    },
    disconnect: async () => { await gmail.disconnect(); setAccount(null); setLabels([]); setFailure(null); setExpired(false); },
    // Creates a label in Gmail (or finds the one with that name) and adds it to the lists.
    createLabel: async (name) => {
      const l = await gmail.createLabel(name);
      setLabels((prev) => (prev.some((x) => x.id === l.id) ? prev : [...prev, { ...l, type: l.type || 'user' }]));
      return l;
    },
    // Call with any error from a Gmail call; returns true if it was handled.
    handle: (e) => { if (e?.code === 'reconnect') { setExpired(true); return true; } return false; },
    failure,
  }), [status, account, labels, unread, busy, error, grantFor, failure, refreshCounts]);

  return <MailCtx.Provider value={value}>{children}</MailCtx.Provider>;
}

export const useMail = () => useContext(MailCtx);
