import { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import {
  formatCalendarDateTime,
  rescheduleTeamsOccurrence,
  utcIsoToCalendarParts,
  zonedNaiveToUtcIso,
  type ModuleComponent,
} from './moduleAuthoringData';

/**
 * The join link and per-session schedule of a live-session component once its
 * Teams meeting exists. The link is shown, copied and opened but never edited by
 * hand — a mistyped join URL sends a learner nowhere. The date and time can be
 * changed, but only behind a red warning: a change moves this one session in the
 * calendar (via `rescheduleTeamsOccurrence`) and overrides the module-wide time
 * the group was created with, so it must never read as a routine edit.
 *
 * `fallbackDate`/`fallbackTime` are the module schedule's own wall clock (the
 * group-creation time). They fill the fields when the component has no combined
 * instant of its own yet — a freshly created series, or one restored from the
 * bulk tab — so the start time is never blank.
 */
export function LiveSessionScheduleEditor({
  component,
  onSettingChange,
  fallbackDate = '',
  fallbackTime = '',
}: {
  component: ModuleComponent;
  onSettingChange: (key: string, value: string | number | boolean | string[]) => void;
  fallbackDate?: string;
  fallbackTime?: string;
}) {
  const settings = component.settings;
  const link = String(settings.liveSessionUrl || settings.teamsMeetingUrl || '');
  const liveSessionId = String(settings.teamsLiveSessionId || '');
  const sessionNumber = Number(settings.teamsSessionNumber || 0);
  const storedIso = String(settings.sessionDateTimeUtc || settings.teamsStartDateTimeUtc || '');
  const durationMinutes = Number(settings.durationMinutes || settings.teamsDurationMinutes || 0) || undefined;
  // A tracked occurrence is what the backend can move; without it the change is
  // only stored on the component and reaches Teams on the next module save.
  const canReschedule = Boolean(liveSessionId) && sessionNumber > 0;

  // Prefer the meeting's own UTC instant, then the schedule keys stored on the
  // component, then the module schedule's wall clock — so the fields pre-fill on
  // a freshly created or bulk-restored series instead of reading blank.
  const saved = useMemo(() => {
    const fromInstant = utcIsoToCalendarParts(storedIso);
    const date = fromInstant.date || String(settings.sessionDate || '') || fallbackDate;
    const time = fromInstant.time || String(settings.sessionTime || '').slice(0, 5) || fallbackTime;
    return { date, time };
  }, [storedIso, settings.sessionDate, settings.sessionTime, fallbackDate, fallbackTime]);

  const [date, setDate] = useState(saved.date);
  const [time, setTime] = useState(saved.time);
  const [copied, setCopied] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setDate(saved.date);
    setTime(saved.time);
  }, [saved.date, saved.time]);

  const dirty = Boolean(date && time) && (date !== saved.date || time !== saved.time);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const applyReschedule = async () => {
    if (!dirty || !date || !time) return;
    setError('');
    setNotice('');
    const startDateTimeUtc = zonedNaiveToUtcIso(`${date}T${time}`);
    // Keep the plain wall clock in step with the instant, so the schedule keys
    // stay right whether or not a tracked occurrence exists to move.
    onSettingChange('sessionDate', date);
    onSettingChange('sessionTime', time);
    if (!canReschedule) {
      onSettingChange('sessionDateTimeUtc', startDateTimeUtc);
      onSettingChange('teamsStartDateTimeUtc', startDateTimeUtc);
      setNotice('Saved on this session. Save the module to send the new time to Teams.');
      return;
    }
    setRescheduling(true);
    try {
      const result = await rescheduleTeamsOccurrence(liveSessionId, sessionNumber, { startDateTimeUtc, durationMinutes });
      const occurrence = result.occurrence;
      onSettingChange('sessionDateTimeUtc', occurrence.startDateTimeUtc);
      onSettingChange('teamsStartDateTimeUtc', occurrence.startDateTimeUtc);
      if (occurrence.joinUrl) {
        onSettingChange('liveSessionUrl', occurrence.joinUrl);
        onSettingChange('teamsMeetingUrl', occurrence.joinUrl);
      }
      if (occurrence.eventId) onSettingChange('teamsEventId', occurrence.eventId);
      setNotice(result.warnings?.[0]?.message || 'This session was moved in Teams. The other sessions are unchanged.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microsoft Teams could not move this session.');
    } finally {
      setRescheduling(false);
    }
  };

  return (
    <div className="mt-3 space-y-3">
      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-foreground-400">Teams meeting link</p>
        <div className="flex items-center gap-2 rounded-lg border border-background-200 bg-background-100/60 px-3 py-2">
          <AppIcon className="ri-links-line shrink-0 text-foreground-400"></AppIcon>
          <a href={link} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[12px] font-semibold text-primary-700 hover:underline" title={link}>
            {link}
          </a>
          <button type="button" onClick={() => void copyLink()} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-background-100 px-2 text-[10px] font-bold text-foreground-700 transition-smooth hover:bg-background-200" aria-label="Copy meeting link">
            <AppIcon className={copied ? 'ri-check-line text-emerald-600' : 'ri-file-copy-line'}></AppIcon>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
        <p className="flex items-start gap-1.5 text-[11px] font-semibold text-red-700">
          <AppIcon className="ri-error-warning-line mt-0.5 shrink-0"></AppIcon>
          <span>Editing the date or time moves <strong>this session only</strong> — not the other sessions in this module — and overwrites the default time set when the group was created.</span>
        </p>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-foreground-500">Session date</span>
            <input type="date" value={date} onChange={event => setDate(event.target.value)} className="h-9 w-full rounded-lg border border-background-200 bg-background-50 px-2.5 text-[12px] tabular-nums text-foreground-900 outline-none focus:border-primary-300" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-foreground-500">Start time</span>
            <input type="time" value={time} onChange={event => setTime(event.target.value)} className="h-9 w-full rounded-lg border border-background-200 bg-background-50 px-2.5 text-[12px] tabular-nums text-foreground-900 outline-none focus:border-primary-300" />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-semibold text-foreground-400">
            {storedIso
              ? `Currently ${formatCalendarDateTime(storedIso)}`
              : saved.date && saved.time
                ? `Currently ${saved.date} ${saved.time} (module schedule)`
                : 'No start time set yet.'}
          </p>
          <div className="flex items-center gap-2">
            {dirty && (
              <button type="button" onClick={() => { setDate(saved.date); setTime(saved.time); setError(''); setNotice(''); }} disabled={rescheduling} className="h-8 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold text-foreground-700 hover:bg-background-100 disabled:opacity-50">
                Reset
              </button>
            )}
            <button type="button" onClick={() => void applyReschedule()} disabled={!dirty || rescheduling} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-[11px] font-bold text-white shadow-sm transition-smooth hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
              <AppIcon className={rescheduling ? 'ri-loader-4-line animate-spin' : 'ri-calendar-check-line'}></AppIcon>
              {rescheduling ? 'Moving…' : 'Apply new time'}
            </button>
          </div>
        </div>
        {error && <p className="mt-2 text-[11px] font-semibold text-red-700"><AppIcon className="ri-error-warning-line mr-1"></AppIcon>{error}</p>}
        {notice && !error && <p className="mt-2 text-[11px] font-semibold text-emerald-700"><AppIcon className="ri-check-line mr-1"></AppIcon>{notice}</p>}
      </div>
    </div>
  );
}
