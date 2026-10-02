import { useEffect, useState } from 'react';
import { coachFetch } from '@/lib/coachFetch';
import { formatSystemTimestamp } from '@/lib/format';

// Assigning a tutor no longer emails them. Staff send the assignment email
// for this module from here, when they choose to (see
// curriculum_api/tutor_notifications.py).
interface TutorEmailStatus {
  tutor: { name: string; hasEmail: boolean } | null;
  lastSent: { status: string | null; at: string | null } | null;
}

const base = () => import.meta.env.VITE_API_BASE_URL || '/curriculum_api';
const url = (moduleId: string) => `${base()}/curriculum/modules/${encodeURIComponent(moduleId)}/tutor-email/`;

async function readJson(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'The tutor email could not be sent. Please try again.');
  return data;
}

export function TutorEmailButton({ moduleId, tutorName }: { moduleId: string; tutorName: string }) {
  const [status, setStatus] = useState<TutorEmailStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!moduleId) return;
    const controller = new AbortController();
    setStatus(null); setLoadError(''); setNotice(''); setError('');
    coachFetch(url(moduleId), { signal: controller.signal }).then(readJson)
      .then(data => setStatus(data))
      .catch(reason => { if (!controller.signal.aborted) setLoadError(reason.message || 'Tutor email status unavailable.'); });
    return () => controller.abort();
  // The tutor name changes when the module is reassigned; reload who would be emailed.
  }, [moduleId, tutorName]);

  if (loadError) return <p className="mt-1 text-[11px] text-foreground-500">{loadError}</p>;
  if (!status?.tutor) return null;

  const sentBefore = status.lastSent?.status === 'sent';
  const send = async () => {
    if (sending) return;
    if (sentBefore && !window.confirm(`${status.tutor!.name} has already been emailed about this module. Send it again?`)) return;
    setSending(true); setError(''); setNotice('');
    try {
      const data = await readJson(await coachFetch(url(moduleId), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }));
      setStatus(current => current ? { ...current, lastSent: data.lastSent } : current);
      setNotice(`Emailed ${data.tutor}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The tutor email could not be sent. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const last = status.lastSent;
  return (
    <span className="mt-1.5 flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void send()}
        disabled={sending || !status.tutor.hasEmail}
        title={status.tutor.hasEmail ? `Email ${status.tutor.name} the details of this module` : `${status.tutor.name} has no email address in the staff directory`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-1 text-[12px] font-medium text-primary-700 transition-smooth hover:border-primary-300 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <i className={`text-[13px] ${sending ? 'ri-loader-4-line animate-spin' : 'ri-mail-send-line'}`} aria-hidden="true" />
        {sending ? 'Sending…' : sentBefore ? 'Email tutor again' : 'Email tutor'}
      </button>
      {!status.tutor.hasEmail && <span className="text-[11px] text-foreground-500">No email address on file for {status.tutor.name}.</span>}
      {last?.at && !notice && (
        <span className="text-[11px] text-foreground-500">
          {last.status === 'sent' ? 'Last emailed' : last.status === 'failed' ? 'Last attempt failed' : 'Recorded'}{' '}
          {formatSystemTimestamp(last.at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
      {notice && <span role="status" className="text-[11px] font-medium text-emerald-700">{notice}</span>}
      {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
    </span>
  );
}
