import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as gmail from '@gmail';
import * as backend from '@backend';
import {
  buildRaw, parseMessage, parseAddressList, isEmail, replySubject, forwardSubject,
  htmlToText, quote, bytesToB64, b64ToBytes, b64urlToB64, escapeHtml, CONTENT_POINTER, displayName,
} from '../gmail/mime.js';
import { messageUrl } from '../lib.js';
import { useAuth } from '../auth.jsx';
import { useMail } from './context.jsx';
import { useI18n } from '../i18n.jsx';
import RecipientField from './RecipientField.jsx';
import { cachedContacts, refreshContacts, rememberRecipients } from './contacts.js';

const MAX_TOTAL = 24 * 1024 * 1024;
// An ECS message's content as this reader may see it (null if they can't).
const liveInfo = (pointer) => new Promise((resolve) => {
  let unsub = () => {};
  const done = (v) => { resolve(v); setTimeout(() => unsub(), 0); };
  unsub = backend.watchMessage(pointer, (d) => done(d), () => done(null));
});
const fmtAddr = (a) => (a.name ? `${a.name} <${a.email}>` : a.email);
const DRAFT_CHANGEABLE = 'X-ChiaraMail-Changeable'; // header name kept so existing drafts still load
const DRAFT_ALLOW_FWD = 'X-ChiaraMail-Allow-Forward';
const AUTOSAVE_MS = 2000;
const readFile = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(bytesToB64(new Uint8Array(r.result)));
  r.onerror = () => reject(r.error);
  r.readAsArrayBuffer(file);
});

export default function Composer() {
  const [params] = useSearchParams();
  const mode = params.get('mode') || 'new';
  const threadParam = params.get('thread');
  const msgParam = params.get('msg');
  const note = params.get('note');
  const draftParam = params.get('draft');
  const nav = useNavigate();
  const { user } = useAuth();
  const mail = useMail();
  const { t, formatDate } = useI18n();
  const me = (mail.account || '').toLowerCase();

  const [to, setTo] = useState(() => parseAddressList(params.get('to') || ''));
  const [cc, setCc] = useState([]);
  const [bcc, setBcc] = useState([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]); // { name, type, size, file? , fwd? }
  const [changeable, setChangeable] = useState(mode === 'new' && !note);
  const [allowFwd, setAllowFwd] = useState(false);
  const [forwardBlocked, setForwardBlocked] = useState(false);
  const [orig, setOrig] = useState(null);
  const [thread, setThread] = useState(null); // { threadId, inReplyTo, references } when replying
  const [draftLoaded, setDraftLoaded] = useState(!draftParam);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const draftIdRef = useRef(draftParam);
  const doneRef = useRef(false); // sent or discarded: stop saving
  const baselineRef = useRef(null);
  const lastSavedRef = useRef(null);
  const chainRef = useRef(Promise.resolve());
  const b64Ref = useRef(new WeakMap());
  const latestRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bodyRef = useRef(null);
  const [contacts, setContacts] = useState(() => cachedContacts(me));

  // Load suggestions from Gmail in the background (cached for a few hours).
  useEffect(() => {
    let live = true;
    refreshContacts(me).then((c) => { if (live) setContacts(c); }).catch(() => {});
    return () => { live = false; };
  }, [me]);

  // Prefill replies and forwards from the original message.
  useEffect(() => {
    if (!threadParam || !msgParam || draftParam) return;
    let live = true;
    gmail.getThread(threadParam).then(async (th) => {
      const raw = th.messages.find((m) => m.id === msgParam) || th.messages[th.messages.length - 1];
      const m = parseMessage(raw);
      // Quote what the reader actually saw: the current content of an ECS message.
      const info = m.pointer ? await liveInfo(m.pointer) : null;
      const current = info && !info.withdrawn ? info.body : null;
      if (!live) return;
      if (mode === 'forward' && info && info.senderUid !== user.uid && (info.withdrawn || info.allowForward !== true)) {
        setForwardBlocked(true);
      }
      setOrig(m);
      const origText = current ?? (m.text || htmlToText(m.html));
      const notMe = (a) => a.email.toLowerCase() !== me;
      const sender = m.replyTo[0] || m.from;
      if (mode === 'forward') {
        setSubject(forwardSubject(m.subject));
        setBody(`\n\n${t('fwdHeader')}\n${t('from')}: ${m.from ? fmtAddr(m.from) : ''}\n${t('date')}: ${formatDate(m.date)}\n${t('subject')}: ${m.subject}\n${t('to')}: ${m.to.map(fmtAddr).join(', ')}\n\n${origText}`);
        const stored = info && !info.withdrawn ? (info.attachments || []) : [];
        setFiles([
          ...m.attachments.map((a) => ({ name: a.filename, type: a.mimeType, size: a.size, fwd: { messageId: m.id, attachmentId: a.attachmentId, data: a.data } })),
          ...stored.map((a, i) => ({ name: a.name, type: a.type, size: a.size, ecs: { id: m.pointer, i } })),
        ]);
      } else {
        const fromMe = m.from && m.from.email.toLowerCase() === me;
        let toList = fromMe ? m.to : [sender];
        let ccList = [];
        if (mode === 'replyAll') {
          toList = [...toList, ...(fromMe ? [] : m.to.filter(notMe))];
          ccList = m.cc.filter(notMe);
        }
        const dedupe = (l) => l.filter((a, i) => l.findIndex((b) => b.email.toLowerCase() === a.email.toLowerCase()) === i);
        setTo(dedupe(toList));
        if (ccList.length) { setCc(dedupe(ccList)); setShowCc(true); }
        setThread({ threadId: m.threadId, inReplyTo: m.messageId, references: `${m.references} ${m.messageId}`.trim() });
        setSubject(replySubject(m.subject));
        const intro = note === 'updated' ? `${t('updateNoteBody')}\n` : '\n';
        setBody(`${intro}\n${t('wroteOn', { date: formatDate(m.date), name: displayName(m.from) })}\n${quote(origText)}`);
      }
      setTimeout(() => { bodyRef.current?.focus(); bodyRef.current?.setSelectionRange(0, 0); }, 0);
    }).catch((e) => { if (!mail.handle(e)) setError(e.message); });
    return () => { live = false; };
  }, [threadParam, msgParam, mode, note]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resume a draft: recipients, text, settings, attachments and reply threading.
  useEffect(() => {
    if (!draftParam) return;
    let live = true;
    gmail.getDraft(draftParam).then(async (d) => {
      const m = parseMessage(d.message);
      const files = await Promise.all(m.attachments.map(async (a) => ({
        name: a.filename, type: a.mimeType, size: a.size,
        base64: b64urlToB64(a.data || await gmail.getAttachment(m.id, a.attachmentId)),
      })));
      if (!live) return;
      setTo(m.to); setCc(m.cc); setBcc(m.bcc);
      if (m.cc.length) setShowCc(true);
      if (m.bcc.length) setShowBcc(true);
      setSubject(m.subject);
      setBody(m.text || htmlToText(m.html));
      setFiles(files);
      setChangeable(m.headers[DRAFT_CHANGEABLE.toLowerCase()] === '1');
      setAllowFwd(m.headers[DRAFT_ALLOW_FWD.toLowerCase()] === '1');
      if (m.inReplyTo) setThread({ threadId: m.threadId, inReplyTo: m.inReplyTo, references: m.references });
      setDraftLoaded(true);
    }).catch((e) => { if (!mail.handle(e)) { setError(e.status === 404 ? t('draftGone') : e.message); } });
    return () => { live = false; };
  }, [draftParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const ensureB64 = async (f) => {
    if (f.base64) return f.base64;
    if (b64Ref.current.has(f)) return b64Ref.current.get(f);
    const v = f.file ? await readFile(f.file)
      : f.ecs ? bytesToB64(new Uint8Array(await (await backend.getAttachment(f.ecs.id, f.ecs.i)).arrayBuffer()))
        : b64urlToB64(f.fwd.data || await gmail.getAttachment(f.fwd.messageId, f.fwd.attachmentId));
    b64Ref.current.set(f, v);
    return v;
  };

  // ---- auto-save to Gmail Drafts ------------------------------------------------
  const snapshot = useMemo(() => JSON.stringify({
    to, cc, bcc, subject, body, changeable, allowFwd, files: files.map((f) => [f.name, f.size]),
  }), [to, cc, bcc, subject, body, changeable, allowFwd, files]);
  useEffect(() => { latestRef.current = { to, cc, bcc, subject, body, changeable, allowFwd, files, thread, snapshot }; });

  const saveDraft = () => {
    chainRef.current = chainRef.current.then(async () => {
      const v = latestRef.current;
      if (doneRef.current || v.snapshot === lastSavedRef.current) return;
      if (v.files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL) return;
      setSaveState('saving');
      try {
        const attachments = await Promise.all(v.files.map(async (f) => ({ filename: f.name, mimeType: f.type, base64: await ensureB64(f) })));
        const ok = (l) => l.filter((a) => isEmail(a.email));
        const raw = buildRaw({
          to: ok(v.to), cc: ok(v.cc), bcc: v.changeable ? [] : ok(v.bcc), subject: v.subject, text: v.body, attachments,
          headers: { [DRAFT_CHANGEABLE]: v.changeable ? '1' : '0', [DRAFT_ALLOW_FWD]: v.allowFwd ? '1' : '0' },
          inReplyTo: v.thread?.inReplyTo || undefined, references: v.thread?.references || undefined,
        });
        if (doneRef.current) return;
        const res = draftIdRef.current
          ? await gmail.updateDraft(draftIdRef.current, raw, v.thread?.threadId)
          : await gmail.createDraft(raw, v.thread?.threadId);
        draftIdRef.current = res.id;
        lastSavedRef.current = v.snapshot;
        setSaveState('saved');
        // Keep the draft in the address, so a reload resumes it.
        const u = new URL(window.location.href);
        if (u.searchParams.get('draft') !== res.id) { u.searchParams.set('draft', res.id); window.history.replaceState(window.history.state, '', u.pathname + u.search); }
        mail.refreshCounts();
      } catch (e) {
        if (!mail.handle(e)) setSaveState('error');
      }
    });
    return chainRef.current;
  };

  const ready = draftLoaded && !(threadParam && msgParam && !draftParam && !orig);
  useEffect(() => {
    if (!ready || doneRef.current) return;
    if (baselineRef.current === null) { baselineRef.current = snapshot; lastSavedRef.current = draftParam ? snapshot : null; return; }
    if (snapshot === lastSavedRef.current || (snapshot === baselineRef.current && !draftIdRef.current)) return;
    const timer = setTimeout(saveDraft, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [snapshot, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Leaving the page with unsaved changes: save them.
  useEffect(() => () => {
    const v = latestRef.current;
    if (!doneRef.current && baselineRef.current !== null && v.snapshot !== lastSavedRef.current
      && (v.snapshot !== baselineRef.current || draftIdRef.current)) saveDraft();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const discard = async () => {
    doneRef.current = true;
    await chainRef.current;
    if (draftIdRef.current) { await gmail.deleteDraft(draftIdRef.current).catch(() => {}); mail.refreshCounts(); }
    if (mountedRef.current) nav(-1); // unless the writer has already gone elsewhere
  };

  const addFiles = (list) => {
    // Copy the FileList now: the input is cleared right after, which empties it.
    const added = Array.from(list).map((file) => ({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, file }));
    setFiles((f) => [...f, ...added]);
  };

  const send = async (ev) => {
    ev.preventDefault();
    setError('');
    const toL = to; const ccL = cc; const bccL = changeable ? [] : bcc;
    const bad = [...toL, ...ccL, ...bccL].filter((a) => !isEmail(a.email)).map(fmtAddr);
    if (bad.length) return setError(t('badAddresses', { list: bad.join(', ') }));
    if (!toL.length && !ccL.length && !bccL.length) return setError(t('needRecipient'));
    if (changeable && !body.trim()) return setError(t('needBody'));
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > MAX_TOTAL) return setError(t('tooBig'));
    setBusy(true);
    doneRef.current = true;
    await chainRef.current; // let any draft save in progress finish first
    let pointer = null;
    try {
      let attachments = await Promise.all(files.map(async (f) => ({ filename: f.name, mimeType: f.type, base64: await ensureB64(f) })));
      let text = body;
      let html;
      const headers = {};
      if (changeable) {
        // ECS: the body and attachments go to ChiaraMail; the email carries only the envelope.
        const recipients = [...new Set([...toL, ...ccL].map((a) => a.email.toLowerCase()))];
        if (recipients.length > 50) throw new Error(t('tooMany'));
        pointer = await backend.createMessage(user, {
          recipients, subject: subject.trim(), body, allowForward: allowFwd,
          attachments: files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
        });
        if (attachments.length) {
          await backend.uploadAttachments(pointer, attachments.map((a) => ({ name: a.filename, type: a.mimeType, bytes: b64ToBytes(a.base64) })));
        }
        attachments = [];
        headers[CONTENT_POINTER] = pointer;
        const link = messageUrl(pointer);
        text = `${t('liveFallback')}\n\n${link}\n\n${t('liveFallbackHint')}`;
        html = `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.5;color:#14313b">
<p>${escapeHtml(t('liveFallback'))}</p>
<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#14313b;color:#fbfdfe;border-radius:6px;text-decoration:none">${escapeHtml(t('liveFallbackButton'))}</a></p>
<p style="color:#587079;font-size:14px">${escapeHtml(t('liveFallbackHint'))}</p></div>`;
      }
      const raw = buildRaw({
        to: toL, cc: ccL, bcc: bccL, subject: subject.trim(), text, html, attachments, headers,
        inReplyTo: thread?.inReplyTo || undefined,
        references: thread?.references || undefined,
      });
      const res = await gmail.sendRaw(raw, thread?.threadId);
      if (draftIdRef.current) await gmail.deleteDraft(draftIdRef.current).catch(() => {});
      rememberRecipients(me, [...toL, ...ccL, ...bccL]);
      mail.refreshCounts();
      nav(`/mail/sent/${res.threadId}`, { replace: true });
    } catch (e) {
      if (pointer) backend.deleteMessage(pointer, files.length).catch(() => {});
      if (!mail.handle(e)) setError(t('errorGeneric', { msg: e.message }));
      doneRef.current = false;
      setBusy(false);
    }
  };

  // Replies, forwards and drafts can't be sent until they've been filled in.
  const preparing = !ready && !error;
  const title = draftParam ? t('draft') : { new: t('newMessage'), reply: t('reply'), replyAll: t('replyAll'), forward: t('forward') }[mode];

  return (
    <form className="compose" onSubmit={send}>
      <h1 className="page-title">{title}</h1>
      <div className="rfields">
        <RecipientField id="to" label={t('to')} recipients={to} onChange={setTo} contacts={contacts}
          extra={(!showCc || !showBcc) && (
            <>
              {!showCc && <button type="button" className="linklike" onClick={() => setShowCc(true)}>{t('cc')}</button>}
              {!showBcc && <button type="button" className="linklike" onClick={() => setShowBcc(true)}>{t('bcc')}</button>}
            </>
          )} />
        {showCc && <RecipientField id="cc" label={t('cc')} recipients={cc} onChange={setCc} contacts={contacts} />}
        {showBcc && (
          <RecipientField id="bcc" label={t('bcc')} recipients={changeable ? [] : bcc} onChange={setBcc} contacts={contacts}
            disabled={changeable} describedBy={changeable ? 'bcc-help' : undefined} />
        )}
      </div>
      {showBcc && changeable && <p id="bcc-help" className="help">{t('bccNotLive')}</p>}
      <div className="field">
        <label htmlFor="subject">{t('subject')}</label>
        <input id="subject" type="text" maxLength={300} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="body">{t('message')}</label>
        <textarea id="body" ref={bodyRef} className="letter-input" rows={14} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>

      <label className={changeable ? 'livetoggle livetoggle-on' : 'livetoggle'}>
        <input type="checkbox" checked={changeable} onChange={(e) => setChangeable(e.target.checked)} />
        <span>
          <strong>{t('changeableLabel')}</strong>
          <span className="help">{t('changeableHelp')}</span>
        </span>
      </label>
      {changeable && (
        <label className="subtoggle">
          <input type="checkbox" checked={allowFwd} onChange={(e) => setAllowFwd(e.target.checked)} />
          <span>
            {t('allowForwardLabel')}
            <span className="help">{t('allowForwardHelp')}</span>
          </span>
        </label>
      )}

      <div className="field">
        <span className="field-label">{t('attachments')}</span>
        {files.length > 0 && (
          <ul className="attachments">
            {files.map((f, i) => (
              <li key={i} className="chip">
                📎 {f.name}
                <button type="button" className="chip-x" aria-label={t('removeAttachment', { name: f.name })}
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
              </li>
            ))}
          </ul>
        )}
        <label className="btn filebtn">
          {t('attachFiles')}
          <input type="file" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        </label>
      </div>

      {forwardBlocked && <p className="error" role="alert">{t('forwardBlocked')}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || preparing || forwardBlocked}>{busy ? t('sending') : preparing ? t('loading') : t('send')}</button>
        <button type="button" className="btn btn-quiet" onClick={discard}>{t('discard')}</button>
        <span className="savestate" role="status" aria-live="polite">
          {saveState === 'saving' && t('draftSaving')}
          {saveState === 'saved' && t('draftSaved')}
          {saveState === 'error' && t('draftSaveFailed')}
        </span>
      </div>
    </form>
  );
}
