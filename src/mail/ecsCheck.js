// The old ECS extension's three marks, brought back:
//   green subject   — an ECS message whose From matches the verified sender
//   red subject     — an ECS message whose From doesn't (a forgery)
//   magenta sender  — someone who uses ECS
import { useEffect, useState } from 'react';
import * as backend from '@backend';
import { useAuth } from '../auth.jsx';

// 'ok' | 'spoof' | null (can't tell: not readable by you, or not ECS)
export async function verdictFor(items) {
  if (!items?.length) return null;
  const senders = await Promise.all(items.map((i) => backend.getSender(i.pointer)));
  if (items.some((i, k) => senders[k] && senders[k] !== i.from)) return 'spoof';
  return senders.every(Boolean) ? 'ok' : null;
}

// For a page of the thread list: who uses ECS, and each thread's verdict.
export function useEcsMarks(rows, me) {
  const [marks, setMarks] = useState({ key: null, users: new Set(), verdicts: {} });
  const { user } = useAuth();
  // Checked again when the session changes (desktop: once the ECS server sign-in completes).
  const key = rows ? `${user?.uid || ''}|${rows.map((r) => r.id).join(',')}` : null;
  useEffect(() => {
    if (!rows) return;
    let live = true;
    const emails = [...new Set(rows.flatMap((r) => r.people.map((p) => p.email)))].filter((e) => e && e !== me);
    Promise.all([
      Promise.all(emails.map((e) => backend.isEcsUser(e).then((y) => (y ? e : null)))),
      Promise.all(rows.map((r) => verdictFor(r.ecs).then((v) => [r.id, v]))),
    ]).then(([users, verdicts]) => {
      if (live) setMarks({ key, users: new Set(users.filter(Boolean)), verdicts: Object.fromEntries(verdicts) });
    });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return marks.key === key ? marks : { users: new Set(), verdicts: {} };
}

export function useIsEcsUser(email) {
  const [state, setState] = useState({ email: null, yes: false });
  const { user } = useAuth();
  const e = (email || '').toLowerCase();
  useEffect(() => {
    if (!e) return;
    let live = true;
    backend.isEcsUser(e).then((yes) => { if (live) setState({ email: e, yes }); });
    return () => { live = false; };
  }, [e, user?.uid]);
  return state.email === e && state.yes;
}
