import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { adoptMigratedReviewBooking, bookMigratedReview, fetchCoachReviewSlots, rescheduleMigratedReview, type ReviewInstanceFormDefinition } from '@/api/reviewInstances';
import { reviewCategory } from '@/lib/reviewCategory';
import { eventIdentity, type CoachCalendarEvent } from './calendarEvents';
import { initialReviewBookingDate, initialReviewBookingDuration, loadImportedReviewForBooking } from './importedReviewBooking';
import { normalizeResolvedReview } from './resolvedReviewRows';

interface Props {
  event: CoachCalendarEvent;
  viewingAsCoach: boolean;
  onClose: () => void;
  onSaved: (event: CoachCalendarEvent, notice: string, options?: { keepOpen: boolean }) => void;
}

const fieldClass = 'mt-1 h-10 w-full rounded-lg border border-foreground-200 bg-white px-3 text-sm text-foreground-800 focus:border-primary-400';

/** The list is only an entry point. The review's current server permissions
 * and linked booking decide which operation may be submitted. */
export default function ImportedReviewBookingDialog({ event, viewingAsCoach, onClose, onSaved }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const savingRef = useRef(false);
  const activeRef = useRef(true);
  const [definition, setDefinition] = useState<ReviewInstanceFormDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [duration, setDuration] = useState(60);
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const instanceId = event.formEventKey || eventIdentity(event);
  const savedCallbackRef = useRef(onSaved);
  useEffect(() => { savedCallbackRef.current = onSaved; }, [onSaved]);

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    activeRef.current = true;
    dialog.showModal();
    return () => {
      activeRef.current = false;
      dialog.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDefinition(null);
    loadImportedReviewForBooking(instanceId, {
      viewingAsCoach, signal: controller.signal,
      onAdoptionError: error => setError(error instanceof Error ? error.message : 'Unable to link the existing meeting. Retry below.'),
      onAdopted: updated => {
        const saved = updated.booking;
        if (!saved?.booked || !saved.eventKey || !saved.scheduledDate || !saved.scheduledTime) return;
        savedCallbackRef.current(normalizeResolvedReview({
          ...event,
          status: (saved.status || updated.localStatus || updated.instance.status) as CoachCalendarEvent['status'],
          calendarEventKey: saved.eventKey, scheduledDate: saved.scheduledDate, scheduledTime: saved.scheduledTime,
          durationMinutes: saved.durationMinutes ?? undefined, meetingLink: saved.meetingLink ?? undefined,
          syncState: saved.syncState as CoachCalendarEvent['syncState'], syncWarning: undefined,
        }), 'Existing meeting linked automatically.', { keepOpen: true });
      },
    })
      .then(data => {
        if (controller.signal.aborted) return;
        setDefinition(data);
        setDate(initialReviewBookingDate(data, reviewCategory(event) === 'mcr'));
        setTime(data.booking?.scheduledTime || '09:00');
        setDuration(initialReviewBookingDuration(data));
      })
      .catch(err => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load this review booking.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [instanceId, viewingAsCoach, reload, event]);

  const booking = definition?.booking;
  const independentBooking = booking?.formRequired === false;
  const locked = viewingAsCoach || (!independentBooking && definition?.readOnly) || definition?.previewOnly
    || definition?.templateSync?.status === 'conflict' || booking?.conflict
    || Boolean(definition?.instance.completedAt)
    || ['completed', 'in-progress', 'awaiting-signature', 'cancelled'].includes(booking?.status || definition?.localStatus || definition?.instance.status || '');
  const eligible = Boolean(definition?.source === 'aptem' && (definition.migratedForm || independentBooking) && booking && !locked
    && (booking.canBook || booking.canAttach || booking.canReschedule));
  const attaching = Boolean(booking?.canAttach && !booking.canReschedule);
  const rescheduling = definition ? Boolean(booking?.canReschedule) : Boolean(event.calendarEventKey && event.status === 'scheduled');
  const reviewTitle = event.importedReviewType || (reviewCategory(event) === 'mcr' ? 'monthly coaching meeting' : 'progress review');
  const title = `${rescheduling ? 'Reschedule' : 'Schedule'} ${reviewTitle}`;
  const unavailable = viewingAsCoach || definition?.previewOnly
    ? 'This coach preview is read-only. The assigned coach can manage the booking.'
    : booking?.conflict || definition?.templateSync?.status === 'conflict'
      ? 'This review has a booking or template conflict. Open its form to review the issue before booking.'
      : definition?.noApprovedMigratedTemplate
        ? 'An approved review template is required before this review can be booked.'
        : 'Booking is not available in this review’s current state. Open its form for details, or refresh to check again.';

  useEffect(() => {
    let active = true;
    setAvailableTimes([]);
    setAvailabilityError('');
    if (!eligible || attaching || !definition || !date || !Number.isInteger(duration) || duration < 15 || duration > 480) {
      setAvailabilityLoading(false);
      return;
    }
    const controller = new AbortController();
    setAvailabilityLoading(true);
    void fetchCoachReviewSlots(definition.instance.learnerId, date, duration, {
      excludeEventKey: rescheduling ? booking?.eventKey || undefined : undefined,
      signal: controller.signal,
    }).then(times => {
      if (!active) return;
      setAvailableTimes(times);
      setTime(current => current && times.includes(current) ? current : '');
    }).catch(reason => {
      if (active) setAvailabilityError(reason instanceof Error ? reason.message : 'Could not check the coach calendar. Retry before booking.');
    }).finally(() => { if (active) setAvailabilityLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [eligible, attaching, definition?.instance.learnerId, date, duration, rescheduling, booking?.eventKey, reload, availabilityRetry]);

  const save = async () => {
    if (!eligible || !definition || !booking || savingRef.current) return;
    const slotDate = attaching ? booking.scheduledDate : date;
    const slotTime = attaching ? booking.scheduledTime : time;
    const slotDuration = attaching ? booking.durationMinutes : duration;
    if (!slotDate || !slotTime || !slotDuration || !Number.isInteger(slotDuration) || slotDuration < 15 || slotDuration > 480
        || (!attaching && (!availableTimes.includes(slotTime) || availabilityLoading || availabilityError))) return;
    const instant = new Date(`${slotDate}T${slotTime}`);
    if (Number.isNaN(instant.getTime())) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const londonOffset = (12 - Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(new Date(`${slotDate}T12:00:00Z`)))) * 60;
      const slot = { scheduledDate: slotDate, scheduledTime: slotTime, durationMinutes: slotDuration, timezoneOffsetMinutes: londonOffset };
      const updated = attaching
        ? await adoptMigratedReviewBooking(definition.instance.id)
        : booking.canReschedule
        ? await rescheduleMigratedReview(definition.instance.id, slot, booking)
        : await bookMigratedReview(definition.instance.id, slot);
      if (!activeRef.current) return;
      const saved = updated.booking;
      if (!saved?.eventKey || !saved.scheduledDate || !saved.scheduledTime) {
        throw new Error('The response did not confirm the booking details. Refresh this review before trying again.');
      }
      const synced = saved.booked && saved.syncState === 'synced';
      const notice = synced
        ? attaching ? 'Existing meeting linked.' : rescheduling ? 'Review rescheduled.' : 'Review scheduled.'
        : `Booking saved in LMS. Microsoft calendar sync ${saved.syncState === 'failed' ? 'failed' : 'is not yet confirmed'}. Open the review form to check its status before retrying.`;
      // Keep the imported row and its form identity; the calendar key may be a
      // reconciled native booking. Never replace one with the other.
      const savedEvent = normalizeResolvedReview({
        ...event,
        status: (saved.status || updated.localStatus || updated.instance.status) as CoachCalendarEvent['status'],
        calendarEventKey: saved.eventKey,
        scheduledDate: saved.scheduledDate,
        scheduledTime: saved.scheduledTime,
        durationMinutes: saved.durationMinutes ?? undefined,
        meetingLink: saved.meetingLink ?? undefined,
        graphWebLink: synced ? event.graphWebLink : undefined,
        syncState: (saved.syncState ?? undefined) as CoachCalendarEvent['syncState'],
        syncWarning: synced ? undefined : notice,
      });
      if (attaching) {
        setDefinition(updated);
        setDate(saved.scheduledDate);
        setTime(saved.scheduledTime);
        setDuration(saved.durationMinutes ?? 60);
        onSaved(savedEvent, notice, { keepOpen: true });
      } else {
        onSaved(savedEvent, notice);
      }
    } catch (err) {
      if (activeRef.current) setError(err instanceof Error ? err.message : 'Unable to save this review booking.');
    } finally {
      savingRef.current = false;
      if (activeRef.current) setSaving(false);
    }
  };

  return createPortal(
    <dialog ref={dialogRef} aria-labelledby={titleId} aria-busy={loading || saving}
      onCancel={e => { e.preventDefault(); if (!savingRef.current) onClose(); }}
      className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-[620px] overflow-y-auto rounded-2xl border border-foreground-200 bg-white p-0 shadow-2xl backdrop:bg-black/55 backdrop:backdrop-blur-sm">
      <form onSubmit={e => { e.preventDefault(); void save(); }}>
        <div className="flex items-start justify-between border-b border-foreground-100 px-5 py-4">
          <div><p className="text-xs font-semibold text-primary-600">Microsoft Teams booking</p><h2 id={titleId} className="mt-1 text-xl font-bold text-foreground-900">{title}</h2></div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close booking" className="rounded-lg px-3 py-1 text-xl text-foreground-500 disabled:opacity-50">×</button>
        </div>
        <div className="space-y-4 p-5">
          <div className="rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-900"><strong>Learner:</strong> {event.learner || 'Unknown learner'}{event.programme ? ` · ${event.programme}` : ''}</div>
          {loading ? <p role="status">Loading review booking…</p> : null}
          {(booking?.reserved || booking?.booked || rescheduling) && booking?.scheduledDate && booking.scheduledTime
            ? <p role="note" className="text-sm text-foreground-700">Current booking: {booking.scheduledDate} at {booking.scheduledTime} UK time · {booking.durationMinutes} minutes. Select an available replacement below.</p> : null}
          {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
          {!loading && definition && !eligible ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{unavailable}</p> : null}
          {eligible ? <>
            {attaching ? <p className="text-sm text-foreground-600">This review already has a meeting. Use that booking to keep its current date, time and meeting link.</p> : null}
            <fieldset disabled={saving || attaching} className="grid gap-4 sm:grid-cols-3">
              <label className="text-xs font-semibold text-foreground-700">Date<input aria-label="Date" type="date" required value={date} onChange={e => { setDate(e.target.value); setTime(''); }} className={fieldClass} /></label>
              <label className="text-xs font-semibold text-foreground-700">Time · UK time (Europe/London)<select aria-label="Time" required value={time} disabled={availabilityLoading || Boolean(availabilityError) || !availableTimes.length} onChange={e => setTime(e.target.value)} className={fieldClass}>
                <option value="">{availabilityLoading ? 'Checking availability…' : 'Select an available time'}</option>
                {availableTimes.map(value => <option key={value} value={value}>{value}</option>)}
              </select></label>
              <label className="text-xs font-semibold text-foreground-700">Duration (minutes)<input aria-label="Duration (minutes)" type="number" required min={15} max={480} step={1} value={duration} onChange={e => { setDuration(Number(e.target.value)); setTime(''); }} className={fieldClass} /></label>
            </fieldset>
            {availabilityLoading ? <p role="status" className="text-sm text-foreground-600">Checking coach working hours and calendar…</p> : null}
            {availabilityError ? <p role="alert" className="text-sm text-red-700">{availabilityError} <button type="button" onClick={() => setAvailabilityRetry(value => value + 1)} className="font-semibold underline">Retry availability</button></p> : null}
            {!availabilityLoading && !availabilityError && !availableTimes.length && !attaching ? <p role="status" className="text-sm text-foreground-600">{date ? 'No available times fit this duration. Choose another date or duration.' : 'No permitted date is available in the supported booking calendar. Choose a supported date or contact your programme team.'}</p> : null}
          </> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-foreground-100 px-5 py-4">
          <button type="button" disabled={loading || saving} onClick={() => setReload(value => value + 1)} className="rounded-lg border border-foreground-200 px-3 py-2 text-sm disabled:opacity-50">Refresh booking</button>
          <button type="button" disabled={saving} onClick={onClose} className="rounded-lg border border-foreground-200 px-3 py-2 text-sm disabled:opacity-50">Cancel</button>
          {eligible ? <button type="submit" disabled={saving || !date || !time || duration < 15 || duration > 480 || (!attaching && (availabilityLoading || Boolean(availabilityError) || !availableTimes.includes(time)))} className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : attaching ? 'Retry linking meeting' : rescheduling ? 'Save new time' : 'Confirm booking'}</button> : null}
        </div>
      </form>
    </dialog>, document.body,
  );
}
