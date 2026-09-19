import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { coachFetch } from '@/lib/coachFetch';
import { openReviewInstanceForEvent } from '@/api/reviewInstances';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { ModernDatePicker, ModernDurationPicker, ScheduleFieldLabel, ScheduleTimeInput } from '@/pages/coach/shared/ScheduleControls';
import { reviewInstancePath, reviewInstanceRouteState } from '@/pages/coach/shared/reviewInstanceNavigation';
import ProgressReviewPptxModal from '@/pages/coach/progress-reviews/components/ProgressReviewPptxModal';
import { eventIdentity, scheduleCoachCalendarEvent, scheduleDefaults, type CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import styles from './dashboard.module.css';

export function DashboardMeetingActions({ event, onUpdated, onScheduleNotice }: { event: CoachCalendarEvent; onUpdated: (event: CoachCalendarEvent) => void; onScheduleNotice: (message: string) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const coach = useCoachIdentity();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [form, setForm] = useState(() => scheduleDefaults(event));
  const [presentationOpen, setPresentationOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const [reminderSent, setReminderSent] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isReview = event.source === 'progress-review';
  const hasForm = Boolean(event.reviewInstanceId || event.reviewTemplateId || event.source === 'mcr' || isReview);
  const canWrite = !coach.isViewingAsCoach;
  const canRemind = ['scheduled', 'confirmed'].includes(event.status) && ['mcr', 'progress-review', 'catch-up', 'student-support'].includes(event.source || '');
  const identity = eventIdentity(event);

  useEffect(() => {
    if (scheduleOpen) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [scheduleOpen]);

  async function perform(action: string, work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(action); setError(''); setNotice('');
    try { await work(); }
    catch (err) { setError(err instanceof Error ? err.message : 'The action could not be completed.'); }
    finally { busyRef.current = false; setBusy(''); }
  }

  const writeReason = canWrite ? undefined : 'Viewing as a coach is read-only.';
  return <>
    <td><button className={styles.textButton} type="button" disabled={!canWrite || Boolean(busy) || !event.eventKey} title={writeReason}
      onClick={() => { setForm(scheduleDefaults(event)); setError(''); setScheduleOpen(true); }}><AppIcon name="ri-calendar-line" />Reschedule</button></td>
    <td><button className={`${styles.textButton} ${styles.primaryButton}`} type="button" disabled={!canWrite || !canRemind || Boolean(busy) || reminderSent || !event.eventKey} title={writeReason || (!canRemind ? 'Reminders are available for scheduled or confirmed coaching, review and support meetings.' : undefined)}
      onClick={() => void perform('reminder', async () => {
        const response = await coachFetch(`/coach_api/coach/timetable/events/${encodeURIComponent(identity)}/reminder`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok || result.sent !== true) throw new Error(result.detail || result.error || 'Reminder delivery could not be confirmed.');
        setReminderSent(true);
        const deliveryDetail = result.detail || 'Reminder email accepted for delivery.';
        const sentOnceNote = result.alreadySent
          ? 'Reminder was already sent once for this meeting.'
          : 'Reminder sent once for this meeting.';
        setNotice(`${deliveryDetail} ${sentOnceNote}`);
      })}><AppIcon name="ri-send-plane-line" />{busy === 'reminder' ? 'Sending...' : reminderSent ? 'Reminder sent' : 'Send Reminder'}</button>
      {!scheduleOpen && (notice || error) && <p className={styles.actionMessage} role={error ? 'alert' : 'status'}>{error || notice}</p>}</td>
    <td>{isReview ? <button className={styles.textButton} type="button" disabled={Boolean(busy)}
      onClick={() => setPresentationOpen(true)}><AppIcon name="ri-file-ppt-line" />Generate Presentation</button> : <span className={styles.subtle}>Not available for this meeting</span>}</td>
    <td>{hasForm ? <button className={styles.textButton} type="button" disabled={Boolean(busy) || (!canWrite && !event.reviewInstanceId)} title={!event.reviewInstanceId ? writeReason : undefined}
      onClick={() => void perform('form', async () => {
        if (event.reviewInstanceId) {
          navigate(reviewInstancePath(event.reviewInstanceId), {
            state: reviewInstanceRouteState(event, `${location.pathname}${location.search}`),
          });
          return;
        }
        if (event.reviewTemplateId) {
          const { instanceId } = await openReviewInstanceForEvent(identity);
          const linked = { ...event, reviewInstanceId: instanceId };
          onUpdated(linked);
          navigate(reviewInstancePath(instanceId), {
            state: reviewInstanceRouteState(linked, `${location.pathname}${location.search}`),
          });
          return;
        }
        navigate(`/coach/${isReview ? 'progress-reviews' : 'meetings'}/${encodeURIComponent(identity)}`);
      })}><AppIcon name="ri-file-text-line" />View Form</button> : <span className={styles.subtle}>No review form</span>}
      <dialog ref={dialogRef} className={styles.scheduleDialog} onCancel={cancel => { if (busyRef.current) cancel.preventDefault(); else setScheduleOpen(false); }}>
        <form onSubmit={submit => { submit.preventDefault(); void perform('schedule', async () => {
          const result = await scheduleCoachCalendarEvent(event, form);
          onScheduleNotice(result.warning || result.event.syncWarning || 'Meeting rescheduled.');
          onUpdated(result.event); setReminderSent(false); setScheduleOpen(false);
        }); }}>
          <h2>Reschedule meeting</h2><p>{event.learner || event.title}</p>
          <div className={styles.scheduleFields}>
            <div><ScheduleFieldLabel>Meeting date</ScheduleFieldLabel><ModernDatePicker value={form.date} onChange={date => setForm(current => ({ ...current, date }))} /></div>
            <div><ScheduleFieldLabel>Start time</ScheduleFieldLabel><ScheduleTimeInput value={form.time} onChange={time => setForm(current => ({ ...current, time }))} /></div>
            <div><ScheduleFieldLabel>Duration</ScheduleFieldLabel><ModernDurationPicker value={form.durationMinutes} onChange={durationMinutes => setForm(current => ({ ...current, durationMinutes }))} /></div>
          </div>
          {error && <p role="alert" className={styles.actionMessage}>{error}</p>}
          <div className={styles.dialogActions}><button type="button" className={styles.textButton} disabled={Boolean(busy)} onClick={() => setScheduleOpen(false)}>Cancel</button>
            <button type="submit" className={`${styles.textButton} ${styles.primaryButton}`} disabled={Boolean(busy) || !form.date || !form.time}>{busy === 'schedule' ? 'Saving...' : 'Save new time'}</button></div>
        </form>
      </dialog>
      {presentationOpen && <ProgressReviewPptxModal open review={event} onClose={() => setPresentationOpen(false)} />}
    </td>
  </>;
}
