import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { eventCheckInApi, type CheckInEvent } from '@/api/eventCheckIn';

function tokenFrom(location: ReturnType<typeof useLocation>) {
  return new URLSearchParams(location.hash.replace(/^#/, '')).get('token')
    || new URLSearchParams(location.search).get('token') || '';
}

export default function EventCheckInPage() {
  const location = useLocation();
  const token = tokenFrom(location);
  const [event, setEvent] = useState<CheckInEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!token) { setError('This event check-in link is invalid.'); setLoading(false); return; }
    eventCheckInApi.event(token)
      .then(result => setEvent(result.event))
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Could not open event check-in.'))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(eventSubmit: React.FormEvent) {
    eventSubmit.preventDefault();
    setSaving(true); setError('');
    try {
      await eventCheckInApi.submit(token, name, email);
      setComplete(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not record attendance.');
    } finally { setSaving(false); }
  }

  const stateMessage = event?.state === 'not_open'
    ? `Check-in opens ${formatDateTime(event.opensAt)}.`
    : event?.state === 'closed'
      ? 'Check-in for this event has closed.'
      : event?.state === 'unavailable'
        ? 'Check-in is not available for this event.' : '';

  return <main className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-secondary-50 px-4 py-10">
    <section className="mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-foreground-200/60 bg-white shadow-xl">
      <header className="bg-[#541EA0] px-6 py-7 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-200">Kent Business College</p>
        <h1 className="mt-2 text-2xl font-bold !text-white">Event check-in</h1>
      </header>
      <div className="p-6">
        {loading && <p className="text-center text-sm text-foreground-500">Opening check-in…</p>}
        {!loading && event && <div className="mb-6 rounded-xl bg-background-100 p-4">
          <h2 className="text-base font-bold text-foreground-900">{event.title}</h2>
          <p className="mt-2 text-sm text-foreground-600">{event.date} · {event.time}</p>
          <p className="mt-1 text-sm text-foreground-600">{event.location}</p>
        </div>}
        {complete ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700"><i className="ri-check-line" /></span>
          <h2 className="mt-3 text-lg font-bold text-foreground-900">Attendance recorded</h2>
          <p className="mt-1 text-sm text-foreground-600">Thank you. If this email belongs to an LMS learner, feedback will appear in their LMS account when it is published.</p>
        </div> : event?.state === 'open' ? <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-foreground-600">Enter your name and email to confirm that you attended. You do not need to sign in.</p>
          <label className="block text-sm font-semibold text-foreground-700">Full name
            <input required minLength={2} autoComplete="name" value={name} onChange={e => setName(e.target.value)} className="mt-1.5 w-full rounded-lg border border-foreground-200 px-3 py-2.5 font-normal" />
          </label>
          <label className="block text-sm font-semibold text-foreground-700">Email address
            <input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1.5 w-full rounded-lg border border-foreground-200 px-3 py-2.5 font-normal" />
          </label>
          <p className="text-xs text-foreground-500">We use your email to match an existing learner account. The page does not disclose whether an account exists.</p>
          <button disabled={saving} className="w-full rounded-lg bg-[#541EA0] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Recording…' : 'Confirm attendance'}</button>
        </form> : !loading && event ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">{stateMessage}</p> : null}
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      </div>
    </section>
  </main>;
}

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}
