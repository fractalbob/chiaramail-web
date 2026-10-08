import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as gmail from '@gmail';
import * as backend from '@backend';
import {
  buildRaw, parseMessage, parseAddressList, isEmail, replySubject, forwardSubject,
  htmlToText, quote, bytesToB64, b64urlToB64, escapeHtml, CONTENT_POINTER, displayName,
} from '../gmail/mime.js';
import { messageUrl } from '../lib.js';
import { useAuth } from '../auth.jsx';
import { useMail } from './context.jsx';
import { useI18n } from '../i18n.jsx';
import RecipientInput from './RecipientInput.jsx';
import { cachedContacts, refreshContacts, rememberRecipients } from './contacts.js';

const MAX_TOTAL = 24 * 1024 * 1024;
// A changeable message as this reader may see it (null if they can't).
const liveInfo = (pointer) => new Promise((resolve) => {
  let unsub = () => {};
  const done = (v) => { resolve(v); setTimeout(() => unsub(), 0); };
  unsub = backend.watchMessage(pointer, (d) => done(d), () => done(null));
});
const fmtAddr = (a) => (a.name ? `${a.name} <${a.email}>` : a.email);
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
  const nav = useNavigate();
  const { user } = useAuth();
  const mail = useMail();
  const { t, formatDate } = useI18n();
  const me = (mail.account || '').toLowerCase();

  const [to, setTo] = useState(params.get('to') || '');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]); // { name, type, size, file? , fwd? }
  const [changeable, setChangeable] = useState(mode === 'new' && !note);
  const [allowFwd, setAllowFwd] = useState(false);
  const [forwardBlocked, setForwardBlocked] = useState(false);
  const [orig, setOrig] = useState(null);
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
    if (!threadParam || !msgParam) return;
    let live = true;
    gmail.getThread(threadParam).then(async (th) => {
      const raw = th.messages.find((m) => m.id === msgParam) || th.messages[th.messages.length - 1];
      const m = parseMessage(raw);
      // Quote what the reader actually saw: the live text of a changeable message.
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
        setFiles(m.attachments.map((a) => ({ name: a.filename, type: a.mimeType, size: a.size, fwd: { messageId: m.id, attachmentId: a.attachmentId, data: a.data } })));
      } else {
        const fromMe = m.from && m.from.email.toLowerCase() === me;
        let toList = fromMe ? m.to : [sender];
        let ccList = [];
        if (mode === 'replyAll') {
          toList = [...toList, ...(fromMe ? [] : m.to.filter(notMe))];
          ccList = m.cc.filter(notMe);
        }
        const dedupe = (l) => l.filter((a, i) => l.findIndex((b) => b.email.toLowerCase() === a.email.toLowerCase()) === i);
        setTo(dedupe(toList).map(fmtAddr).join(', '));
        if (ccList.length) { setCc(dedupe(ccList).map(fmtAddr).join(', ')); setShowCc(true); }
        setSubject(replySubject(m.subject));
        const intro = note === 'updated' ? `${t('updateNoteBody')}\n` : '\n';
        setBody(`${intro}\n${t('wroteOn', { date: formatDate(m.date), name: displayName(m.from) })}\n${quote(origText)}`);
      }
      setTimeout(() => { bodyRef.current?.focus(); bodyRef.current?.setSelectionRange(0, 0); }, 0);
    }).catch((e) => { if (!mail.handle(e)) setError(e.message); });
    return () => { live = false; };
  }, [threadParam, msgParam, mode, note]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = (list) => {
    // Copy the FileList now: the input is cleared right after, which empties it.
    const added = Array.from(list).map((file) => ({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, file }));
    setFiles((f) => [...f, ...added]);
  };

  const send = async (ev) => {
    ev.preventDefault();
    setError('');
    const parse = (s) => parseAddressList(s);
    const toL = parse(to); const ccL = parse(cc); const bccL = changeable ? [] : parse(bcc);
    const bad = [...toL, ...ccL, ...bccL].filter((a) => !isEmail(a.email)).map(fmtAddr);
    if (bad.length) return setError(t('badAddresses', { list: bad.join(', ') }));
    if (!toL.length && !ccL.length && !bccL.length) return setError(t('needRecipient'));
    if (changeable && !body.trim()) return setError(t('needBody'));
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > MAX_TOTAL) return setError(t('tooBig'));
    setBusy(true);
    let pointer = null;
    try {
      const attachments = await Promise.all(files.map(async (f) => ({
        filename: f.name,
        mimeType: f.type,
        base64: f.file ? await readFile(f.file) : b64urlToB64(f.fwd.data || await gmail.getAttachment(f.fwd.messageId, f.fwd.attachmentId)),
      })));
      let text = body;
      let html;
      const headers = {};
      if (changeable) {
        const recipients = [...new Set([...toL, ...ccL].map((a) => a.email.toLowerCase()))];
        if (recipients.length > 50) throw new Error(t('tooMany'));
        pointer = await backend.createMessage(user, { recipients, subject: subject.trim(), body, allowForward: allowFwd });
        headers[CONTENT_POINTER] = pointer;
        const link = messageUrl(pointer);
        text = `${t('liveFallback')}\n\n${link}\n\n${t('liveFallbackHint')}`;
        html = `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.5;color:#14313b">
<p>${escapeHtml(t('liveFallback'))}</p>
<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#14313b;color:#fbfdfe;border-radius:6px;text-decoration:none">${escapeHtml(t('liveFallbackButton'))}</a></p>
<p style="color:#587079;font-size:14px">${escapeHtml(t('liveFallbackHint'))}</p></div>`;
      }
      const isReply = (mode === 'reply' || mode === 'replyAll') && orig;
      const raw = buildRaw({
        to: toL, cc: ccL, bcc: bccL, subject: subject.trim(), text, html, attachments, headers,
        inReplyTo: isReply ? orig.messageId : undefined,
        references: isReply ? `${orig.references} ${orig.messageId}`.trim() : undefined,
      });
      const res = await gmail.sendRaw(raw, isReply ? orig.threadId : undefined);
      rememberRecipients(me, [...toL, ...ccL, ...bccL]);
      mail.refreshCounts();
      nav(`/mail/sent/${res.threadId}`, { replace: true });
    } catch (e) {
      if (pointer) backend.deleteMessage(pointer).catch(() => {});
      if (!mail.handle(e)) setError(t('errorGeneric', { msg: e.message }));
      setBusy(false);
    }
  };

  // Replies and forwards can't be sent until the original has been filled in.
  const preparing = !!(threadParam && msgParam) && !orig && !error;
  const title = { new: t('newMessage'), reply: t('reply'), replyAll: t('replyAll'), forward: t('forward') }[mode];

  return (
    <form className="compose" onSubmit={send}>
      <h1 className="page-title">{title}</h1>
      <div className="field">
        <label htmlFor="to">{t('to')}</label>
        <RecipientInput id="to" value={to} onChange={setTo} contacts={contacts} describedBy="to-help" label={t('suggestions')} />
        <p id="to-help" className="help">
          {t('separateAddresses')}{' '}
          {!showCc && <button type="button" className="linklike" onClick={() => setShowCc(true)}>{t('addCcBcc')}</button>}
        </p>
      </div>
      {showCc && (
        <>
          <div className="field">
            <label htmlFor="cc">{t('cc')}</label>
            <RecipientInput id="cc" value={cc} onChange={setCc} contacts={contacts} label={t('suggestions')} />
          </div>
          <div className="field">
            <label htmlFor="bcc">{t('bcc')}</label>
            <RecipientInput id="bcc" value={changeable ? '' : bcc} onChange={setBcc} contacts={contacts} disabled={changeable}
              describedBy={changeable ? 'bcc-help' : undefined} label={t('suggestions')} />
            {changeable && <p id="bcc-help" className="help">{t('bccNotLive')}</p>}
          </div>
        </>
      )}
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
        <button type="button" className="btn btn-quiet" onClick={() => nav(-1)}>{t('discard')}</button>
      </div>
    </form>
  );
}
