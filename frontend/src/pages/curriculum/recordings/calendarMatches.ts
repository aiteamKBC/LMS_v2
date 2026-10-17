import { useEffect, useState } from 'react';
import { learningFetch } from '@/lib/personalLearning';

export interface CalendarMatches {
  status: 'choose' | 'verified'; start: string; end: string; timeZone: string; mailbox: string; accounts: string[];
  matched: { occurrenceId: string; moduleId: string; title: string }[];
  unmatched: { title: string; date: string; startTime: string; endTime: string; cancelled: boolean; reason: string; recordingsReference?: string }[];
}
const STORAGE_KEY = 'lms-recordings-calendar-account';
function savedMailbox() {
  try { return window.localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}
export async function loadCalendarMatches(start: string, end: string, timeZone: string, mailbox: string, signal: AbortSignal) {
  const query = new URLSearchParams({ start, end, timeZone, mailbox });
  const response = await learningFetch(`/curriculum_api/curriculum/session-recordings/calendar-matches/?${query}`, { credentials: 'include', cache: 'no-store', signal });
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Calendar comparison is unavailable. The matching backend route must be running.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Teams calendar could not be checked.');
  if (data.start !== start || data.end !== end || data.timeZone !== timeZone) throw new Error('The calendar comparison returned a different period.');
  if (mailbox && data.mailbox !== mailbox.trim().toLowerCase()) throw new Error('The calendar comparison returned a different account.');
  return data as CalendarMatches;
}
export function useCalendarMatches(start: string, end: string, timeZone: string, enabled: boolean) {
  const [mailbox, setMailbox] = useState(savedMailbox);
  const [data, setData] = useState<CalendarMatches | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setData(null); setError('');
    void loadCalendarMatches(start, end, timeZone, mailbox, controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Calendar comparison failed.');
    });
    return () => controller.abort();
  }, [start, end, timeZone, mailbox, enabled, revision]);
  return { data, error, chooseMailbox: (value: string) => {
    setData(null); setError(''); setMailbox(value);
    try { window.localStorage.setItem(STORAGE_KEY, value); } catch { /* Browser storage can be disabled. */ }
  }, retry: () => setRevision(value => value + 1) };
}
