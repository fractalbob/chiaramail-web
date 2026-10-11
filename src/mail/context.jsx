import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as gmail from '@gmail';
import * as backend from '@backend';
import { refreshContacts } from './contacts.js';
import { useAuth } from '../auth.jsx';

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

  let status = 'checking';
  if (user !== undefined) {
    if (account && user && user.email === account && !expired) status = 'connected';
    else if (user) status = 'reconnect';
    else status = 'disconnected';
  }

  const fetchCounts = () => Promise.all([gmail.getLabel('INBOX'), gmail.getLabel('SPAM'), gmail.getLabel('DRAFT')])
    .then(([inbox, spam, drafts]) => ({ inbox: inbox.threadsUnread || 0, spam: spam.threadsUnread || 0, drafts: drafts.messagesTotal || 0 }));
  const onErr = (e) => { if (e.code === 'reconnect') setExpired(true); };
  const refreshCounts = useCallback(() => fetchCounts().then(setUnread).catch(onErr), []);

  // List this address in the ECS directory, so others see it uses ECS.
  useEffect(() => {
    if (status === 'connected') backend.registerEcsUser(user);
  }, [status, user]);

  // Build the recipient suggestions in the background as soon as Gmail is
  // connected, so they're ready by the time someone writes a message.
  useEffect(() => {
    if (status !== 'connected' || !account) return;
    // Let the inbox load first.
    const t = setTimeout(() => refreshContacts(account.toLowerCase()).catch(() => {}), 8000);
    return () => clearTimeout(t);
  }, [status, account]);

  useEffect(() => {
    if (status !== 'connected') return;
    let live = true;
    gmail.listLabels().then((l) => { if (live) setLabels(l); }).catch(onErr);
    fetchCounts().then((c) => { if (live) setUnread(c); }).catch(onErr);
    const t = setInterval(refreshCounts, 60_000);
    return () => { live = false; clearInterval(t); };
  }, [status, refreshCounts]);

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
      setBusy(true); setError(''); setGrantFor(null);
      try { const email = await gmail.connect(arg); setAccount(email); setExpired(false); } catch (e) {
        const quiet = ['popup_closed', 'popup_failed_to_open', 'access_denied'];
        if (e.code === 'scope-denied') { setError(e.email ? 'scopeDeniedFor' : 'scopeDenied'); setGrantFor(e.email || ''); }
        else if (e.code === 'popup_failed_to_open') setError('popupBlocked');
        else if (!quiet.includes(e.code)) setError(e.message);
      } finally { setBusy(false); }
    },
    disconnect: async () => { await gmail.disconnect(); setAccount(null); setLabels([]); },
    // Call with any error from a Gmail call; returns true if it was handled.
    handle: (e) => { if (e?.code === 'reconnect') { setExpired(true); return true; } return false; },
  }), [status, account, labels, unread, busy, error, grantFor, refreshCounts]);

  return <MailCtx.Provider value={value}>{children}</MailCtx.Provider>;
}

export const useMail = () => useContext(MailCtx);
