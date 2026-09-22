import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { fetchAbsenceReports, type LearnerAbsenceReport } from '@/api/absenceReports';
import { fetchLearnerCalendarEvents, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import { useMyLearner } from '@/hooks/useMyLearner';
import styles from '../attendance.module.css';

const METHODS = {
  alternative: { label: 'Another group session', icon: 'ri-team-line' },
  'catch-up': { label: 'Coach catch-up', icon: 'ri-calendar-event-line' },
  recorded: { label: 'Watch the recording', icon: 'ri-video-line' },
} as const;

function displayDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function recoveryEventKey(report: LearnerAbsenceReport) {
  if (report.recoveryMethod === 'recorded') return `absence-recording:${report.id}`;
  if (report.recoveryMethod === 'alternative') return `absence-alternative:${report.id}`;
  return report.catchupEventKey || '';
}

export default function RecoveryPlansDialog() {
  const learner = useMyLearner();
  const [reports, setReports] = useState<LearnerAbsenceReport[]>([]);
  const [events, setEvents] = useState<LearnerCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [absenceData, calendarData] = await Promise.all([
        fetchAbsenceReports(learner.kind, learner.id),
        fetchLearnerCalendarEvents(learner.kind, learner.id, { revalidate: true }),
      ]);
      setReports(absenceData.results.filter(report => Boolean(report.recoveryMethod)));
      setEvents(calendarData.events);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load your recovery plans.');
    } finally {
      setLoading(false);
    }
  }, [learner.id, learner.kind]);

  useEffect(() => { void load(); }, [load]);

  const eventsByKey = useMemo(() => new Map(events.map(event => [event.eventKey, event])), [events]);

  if (loading) return <div className={styles.recoveryPlansLoading} role="status"><AppIcon className="ri-loader-4-line animate-spin" />Loading recovery plans…</div>;
  if (error) return <div className={styles.recoveryPlansError} role="alert"><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></div>;
  if (!reports.length) return <EmptyState size="sm" icon="ri-calendar-todo-line" title="No recovery plans yet" description="The recovery method you choose when reporting an absence will appear here." />;

  return <div className={styles.recoveryPlans}>
    <div className={styles.recoveryPlansSummary}>
      <div><strong>{reports.length}</strong><span>{reports.length === 1 ? 'recovery plan' : 'recovery plans'}</span></div>
      <p>Your selected plans are confirmed immediately and kept together here.</p>
    </div>
    <ul className={styles.recoveryPlanList}>
      {reports.map(report => {
        const method = METHODS[report.recoveryMethod as keyof typeof METHODS];
        if (!method) return null;
        const eventKey = recoveryEventKey(report);
        const event = eventsByKey.get(eventKey);
        const recoveryDate = event?.scheduledDate || report.alternativeSession?.dateIso || '';
        const recoveryTime = event?.scheduledTime || report.alternativeSession?.startTime || '';
        const joinUrl = report.alternativeSession?.joinUrl || event?.meetingLink || '';
        const calendarParams = new URLSearchParams({ kind: learner.kind, learner: learner.id });
        if (eventKey) calendarParams.set('event', eventKey);
        const confirmed = report.status.trim().toLowerCase() === 'approved';
        return <li key={report.id} className={styles.recoveryPlanCard}>
          <div className={styles.recoveryPlanTop}>
            <span className={styles.recoveryPlanIcon}><AppIcon className={method.icon} /></span>
            <div className={styles.recoveryPlanIdentity}>
              <p>{method.label}</p>
              <h3>{report.sessionTitle}</h3>
              <span>Missed session: {displayDate(report.sessionDate)}{report.sessionTime ? ` at ${report.sessionTime}` : ''}</span>
            </div>
            <span className={styles.recoveryPlanStatus} data-confirmed={confirmed}>{confirmed ? 'Confirmed' : report.status}</span>
          </div>
          <div className={styles.recoveryPlanSchedule}>
            <AppIcon className="ri-calendar-check-line" />
            <div><span>Recovery schedule</span><strong>{recoveryDate ? `${displayDate(recoveryDate)}${recoveryTime ? ` at ${recoveryTime}` : ''}` : 'Open calendar for details'}</strong></div>
          </div>
          <div className={styles.recoveryPlanActions}>
            <Link to={`/learner/calendar?${calendarParams.toString()}`}><AppIcon className="ri-calendar-line" />View in calendar</Link>
            {joinUrl && <a href={joinUrl} target="_blank" rel="noreferrer"><AppIcon className="ri-video-on-line" />Join session</a>}
          </div>
        </li>;
      })}
    </ul>
  </div>;
}
