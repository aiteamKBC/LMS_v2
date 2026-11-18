import { useEffect, useRef, useState } from 'react';
import { feedbackApi, type FeedbackResponse, type FeedbackResponseEmail, type FeedbackResponseEmailContext } from '@/api/feedback';
import { notifyQualityTicketClosed } from './qualityTicketEvents';

const button = 'rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50';
const field = 'mt-1 w-full rounded-lg border border-foreground-200 bg-white p-2 text-sm';
const statusLabel: Record<FeedbackResponseEmail['status'], string> = {
  sent: 'Accepted for sending', failed: 'Failed', sending: 'Sending — check Sent Items before retrying',
  unknown: 'Sending not confirmed — check Sent Items',
};
const date = (value: string) => new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London',
}).format(new Date(value));

export function ResponseEmailPanel({ response, onDirtyChange, onSendingChange, onClose }: {
  response: FeedbackResponse; onDirtyChange: (dirty: boolean) => void; onSendingChange: (sending: boolean) => void;
  onClose?: () => void;
}) {
  const [context, setContext] = useState<FeedbackResponseEmailContext | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [subject, setSubject] = useState(`Following up on your feedback — ${response.sessionTitle || response.formTitle}`.slice(0, 255));
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [reload, setReload] = useState(0);
  const [closingTicket, setClosingTicket] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const subjectInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    feedbackApi.responseEmails(response.id).then(data => {
      if (active) { setContext(data); setLoadError(''); }
    }).catch(reason => {
      if (active) setLoadError(reason instanceof Error ? reason.message : 'Could not load email details.');
    });
    return () => { active = false; };
  }, [response.id, reload]);
  useEffect(() => { if (context?.canSend) subjectInput.current?.focus(); }, [context?.canSend]);

  const updateDraft = (nextSubject: string, nextBody: string) => {
    setSubject(nextSubject); setBody(nextBody); setNotice(''); setError('');
    requestId.current = null;
    onDirtyChange(true);
  };
  const recordEmail = (email: FeedbackResponseEmail) => {
    setContext(current => current ? { ...current, emails: [email, ...current.emails.filter(item => item.id !== email.id)] } : current);
    if (email.qualityTicket?.status === 'closed') notifyQualityTicketClosed(response.id);
  };
  const retryTicketClose = async (emailId: string) => {
    if (closingTicket) return;
    setClosingTicket(emailId); setError('');
    try {
      const { email } = await feedbackApi.retryEmailTicketClose(response.id, emailId);
      recordEmail(email);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not confirm ticket closure. Refresh history before retrying.');
      setReload(value => value + 1);
    } finally { setClosingTicket(null); }
  };
  const send = async () => {
    if (!context?.recipient || sending) return;
    requestId.current ||= crypto.randomUUID();
    setSending(true); onSendingChange(true); setError(''); setNotice('');
    try {
      const { email } = await feedbackApi.sendResponseEmail(response.id, {
        requestId: requestId.current, subject, body, expectedRecipient: context.recipient.email,
      });
      recordEmail(email);
      setUncertain(email.status === 'unknown' || email.status === 'sending');
      if (email.status === 'sent') {
        setNotice('Your email was accepted for sending. Replies go to Quality Support.');
        setBody(''); setPreview(false); requestId.current = null; onDirtyChange(false);
      } else if (email.status === 'failed') {
        setError(email.error); requestId.current = null;
      } else setError(email.error || statusLabel[email.status]);
    } catch (reason) {
      const status = reason && typeof reason === 'object' && 'status' in reason ? Number(reason.status) : 0;
      const message = reason instanceof Error ? reason.message : 'Could not confirm sending.';
      if (status >= 400 && status < 500) {
        setError(message); setUncertain(false); setPreview(false);
      } else {
        setError(`${message} Retry this request to check its result; do not start a duplicate message.`);
        setUncertain(true);
      }
      setReload(value => value + 1);
    } finally {
      setSending(false); onSendingChange(false);
    }
  };

  return <section aria-label="Email respondent" className="mb-5 rounded-xl border border-primary-200 bg-primary-50/40 p-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-semibold text-primary-900">Email respondent</h3>
      {onClose && <button type="button" aria-label="Close email panel" disabled={sending} onClick={onClose} className={`${button} shrink-0 border border-primary-200 bg-white text-primary-700`}>Close</button>}
    </div>
    {loadError && <p role="alert" className="mt-3 text-xs text-rose-700">{loadError} <button type="button" className="underline" onClick={() => setReload(value => value + 1)}>Reload email details</button></p>}
    {!context && !loadError && <p role="status" className="mt-3 text-xs">Loading email details…</p>}
    {context && <>
      {!context.canSend ? <p className="mt-3 text-sm">{context.reason}</p> : <>
        <dl className="my-3 space-y-1 break-words text-xs">
          <div><dt className="inline font-semibold">From: </dt><dd className="inline">{context.sender}</dd></div>
          <div><dt className="inline font-semibold">To: </dt><dd className="inline">{context.recipient?.name} &lt;{context.recipient?.email}&gt;</dd></div>
          <div><dt className="inline font-semibold">Reply to: </dt><dd className="inline">{context.replyTo}</dd></div>
        </dl>
        {preview ? <div aria-label="Email preview" className="rounded-lg border border-foreground-200 bg-white p-4 text-sm">
          <p className="font-semibold">{subject}</p><p className="mt-3 whitespace-pre-wrap break-words">{body}</p>
          <p className="mt-4 border-t pt-3 text-xs text-foreground-500">You can reply to this email to contact {context.replyTo}.</p>
          <p className="mt-3 text-xs text-foreground-500">Review the recipient and message before sending.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={sending || uncertain} onClick={() => setPreview(false)} className={`${button} border bg-white`}>Edit message</button>
            <button type="button" disabled={sending || Boolean(loadError)} onClick={() => void send()} className={`${button} bg-primary-600 text-white`}>{sending ? 'Sending…' : uncertain ? 'Check sending result' : 'Send email'}</button>
          </div>
        </div> : <form onSubmit={event => { event.preventDefault(); setPreview(true); }}>
          <label className="block text-xs font-semibold">Message template<select defaultValue="" className={field} onChange={event => {
            const templates: Record<string, string> = {
              thanks: 'Thank you for sharing your feedback. We appreciate your time and will use your comments to improve your learning experience.',
              details: 'Thank you for your feedback. Could you share a little more detail about your experience so we can help?',
              followup: 'Thank you for raising your concerns. Our Quality Team is reviewing your feedback and would like to follow up with you.',
            };
            if (event.target.value) updateDraft(subject, `Hello ${context.recipient?.name || 'there'},\n\n${templates[event.target.value]}\n\nKind regards,\nQuality Support\nKent Business College`);
          }}><option value="">Write your own message</option><option value="thanks">Thank you</option><option value="details">Request more details</option><option value="followup">Follow up on a concern</option></select></label>
          <label className="mt-3 block text-xs font-semibold">Subject<input ref={subjectInput} required maxLength={255} className={field} value={subject} onChange={event => updateDraft(event.target.value, body)} /></label>
          <label className="mt-3 block text-xs font-semibold">Message<textarea required maxLength={10000} rows={7} className={field} value={body} onChange={event => updateDraft(subject, event.target.value)} /></label>
          <button type="submit" disabled={!subject.trim() || !body.trim() || Boolean(loadError)} className={`${button} mt-3 bg-primary-600 text-white`}>Preview email</button>
        </form>}
      </>}
      {notice && <p role="status" className="mt-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
      {context.canSend && <div className="mt-5 border-t border-primary-200 pt-4">
        <div className="flex items-center justify-between"><h4 className="text-sm font-semibold">Email history</h4><button type="button" disabled={sending} className={`${button} text-primary-700`} onClick={() => setReload(value => value + 1)}>Refresh history</button></div>
        <p className="mb-3 text-xs text-foreground-500">Outbound messages only. Replies are received in the Quality Support mailbox. Times shown in UK time.</p>
        {!context.emails.length ? <p className="text-xs text-foreground-500">No emails sent for this response.</p> : <ul className="space-y-3">{context.emails.map(email => <li key={email.id} className="rounded-lg border border-foreground-200 bg-white p-3 text-xs">
          <strong>{email.subject}</strong><p className="mt-1">{statusLabel[email.status]} · {date(email.sentAt || email.createdAt)} · {email.sentBy}</p>
          <p className="mt-1 break-words">From: {email.from} · To: {email.to}</p>
          {email.error && <p className="mt-1 text-rose-700">{email.error}</p>}
          {email.qualityTicket?.status === 'closed' && <p className="mt-2 text-emerald-800">Quality ticket: Closed in LMS and technicalsupport</p>}
          {email.status === 'sent' && ['pending', 'failed'].includes(email.qualityTicket?.status || '') && <div className="mt-2">
            <p role="alert" className="text-rose-700">{email.qualityTicket?.error || 'Email accepted for sending. Quality ticket closure is pending.'}</p>
            <button type="button" disabled={sending || closingTicket !== null} className={`${button} mt-2 border text-primary-700`} onClick={() => void retryTicketClose(email.id)}>{closingTicket === email.id ? 'Closing ticket…' : 'Retry ticket closure'}</button>
          </div>}
          <details className="mt-2"><summary className="cursor-pointer text-primary-700">View message</summary><p className="mt-2 whitespace-pre-wrap break-words">{email.body}</p></details>
        </li>)}</ul>}
      </div>}
    </>}
  </section>;
}
