import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AuthUser } from '@/api/auth';
import { hasCoachAccess, loadCompletionNotifications, updateCompletionNotifications, type CompletionNotification } from '@/api/coachingCompletion';

export default function CompletionNotifications({ account }: { account: AuthUser | null | undefined }) {
  const [items, setItems] = useState<CompletionNotification[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const eligible = hasCoachAccess(account);
  useEffect(() => {
    setItems([]); setError('');
    if (!account || !eligible) return;
    let cancelled = false;
    setBusy(true);
    void loadCompletionNotifications(account, attempt > 0).then(value => {
      if (!cancelled) setItems(value);
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Completion reminders could not be loaded.');
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [account, eligible, attempt]);
  if (!eligible || !account) return null;
  const update = async (item: CompletionNotification, action: 'read' | 'dismiss') => {
    setBusy(true); setError('');
    try {
      await updateCompletionNotifications(account, [item.reminderId], action);
      setItems(current => action === 'dismiss' ? current.filter(row => row.id !== item.id)
        : current.map(row => row.id === item.id ? { ...row, unread: false } : row));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The reminder could not be updated.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Aptem completion reminders" className="mx-6 my-4 rounded-2xl border border-primary-200 bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-base font-semibold text-foreground-900">Complete your sessions in Aptem</h2>
        <p className="mt-1 text-xs text-foreground-600">MCM &amp; PR reminders at 24 and 72 hours. Completing the session in Aptem resolves the reminder after the source syncs.</p></div>
      <button type="button" disabled={busy} onClick={() => setAttempt(value => value + 1)} className="rounded-lg border border-primary-200 px-3 py-2 text-xs font-semibold text-primary-700 disabled:opacity-50">Refresh reminders</button>
    </div>
    {busy && <p role="status" className="mt-3 text-xs text-foreground-600">Loading reminders…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {!busy && !error && !items.length && <p className="mt-3 text-sm text-foreground-600">No verified completion reminders are currently available.</p>}
    <ul className="mt-3 divide-y divide-background-200">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1"><p className={`break-words text-sm ${item.unread ? 'font-semibold text-foreground-900' : 'text-foreground-600'}`}>{item.text}</p>
        <time className="mt-1 block text-xs text-foreground-500" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('en-GB')}</time></div>
      <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-primary-700">
        <Link to={item.link} className="rounded-lg border border-primary-200 px-3 py-2">Review meeting</Link>
        {item.unread && <button disabled={busy} type="button" onClick={() => void update(item, 'read')} className="underline disabled:opacity-50">Mark as read</button>}
        <button disabled={busy} type="button" onClick={() => void update(item, 'dismiss')} className="underline disabled:opacity-50">Dismiss reminder</button>
      </div>
    </li>)}</ul>
    {items.length > 0 && <p className="mt-2 text-xs text-foreground-500">Reading or dismissing a reminder does not complete the session in Aptem.</p>}
  </section>;
}
