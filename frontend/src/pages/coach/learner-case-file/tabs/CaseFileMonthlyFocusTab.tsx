import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Clock3, Equal, GraduationCap, Target } from 'lucide-react';
import { useCaseFileMonthFocus } from '@/features/coach/case-file/hooks/useCaseFileMonthFocus';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { dateLabel, hours, monthLabel, State } from '@/pages/learner/training-plan-timeline/presentation';
import { parseLocalDate } from '@/pages/coach/shared/calendarEvents';
import type { LearnerKind } from '@/api/learnerDetail';
import board from '@/pages/learner/training-plan-timeline/MonthlyFocusBoard.module.css';

function isoDate(value?: string | null) {
  const date = parseLocalDate(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
}

export function CaseFileMonthlyFocusTab({ startDate, endDate }: {
  kind: LearnerKind; learnerId: string; startDate?: string | null; endDate?: string | null;
}) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('month');
  const start = isoDate(startDate).slice(0, 7), end = isoDate(endDate).slice(0, 7);
  const current = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }).slice(0, 7);
  const implicit = start && current < start ? start : end && current > end ? end : current;
  const month = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : implicit;
  const state = useCaseFileMonthFocus(month, true);
  const data = state?.data;
  const shiftMonth = (step: number) => {
    const date = new Date(`${month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + step);
    const next = new URLSearchParams(params);
    next.set('month', date.toISOString().slice(0, 7));
    setParams(next);
  };
  const cells = data ? [
    { label: 'Required hours', value: data.summary.requiredHours, icon: <Target size={20} /> },
    { label: 'Achieved hours', value: data.summary.achievedHours, icon: <Clock3 size={20} /> },
    { label: 'Difference', value: data.summary.differenceHours, icon: <Equal size={20} /> },
  ] : [];
  return <section className={board.root} aria-label="Monthly study plan">
    <div className={board.header}>
      <div className={board.heading}><p>Monthly Focus</p><h2>{monthLabel(month)}</h2></div>
      <div className={board.monthNav}>
        <button type="button" onClick={() => shiftMonth(-1)} disabled={!!start && month <= start}><ChevronLeft size={15} aria-hidden="true" />Previous month</button>
        <button type="button" onClick={() => shiftMonth(1)} disabled={!!end && month >= end}>Next month<ChevronRight size={15} aria-hidden="true" /></button>
      </div>
    </div>
    {state?.error ? <div role="alert">{state.error}<button type="button" onClick={state.refresh}>Retry monthly focus</button></div>
      : !data ? <div role="status" aria-label="Loading monthly focus"><RowsSkeleton rows={5} /></div> : <>
        <section className={`${board.card} ${board.metrics}`} aria-label="Progress this month">
          {cells.map(cell => <div key={cell.label} className={board.metric}>
            <span className={board.metricRing} aria-hidden="true">{cell.icon}</span>
            <div><span>{cell.label}</span><strong>{cell.value == null ? 'Not available' : `${cell.label === 'Difference' && cell.value > 0 ? '+' : ''}${hours(cell.value)} hrs`}</strong></div>
          </div>)}
          <div className={board.metric}><span className={`${board.metricRing} ${board.metricIcon}`} aria-hidden="true"><GraduationCap size={20} /></span>
            <div><span>KSBs this month</span><strong>{data.summary.ksbCount ?? '—'}</strong></div>
          </div>
        </section>
        <div className={board.pair}>
          <section className={board.card} aria-label="Reviews this month"><h3 className={board.cardTitle}>Reviews this month</h3>
            <div className={board.reviewRows}>{data.reviews.length ? data.reviews.map(review => <article key={review.id} className={board.reviewRow}>
              <span className={board.reviewDate}>{dateLabel(review.date)}</span>
              <span className={board.reviewTime}>{review.time ? `${review.time} · UK time` : review.durationMinutes ? `${review.durationMinutes} min` : '—'}</span>
              <span className={board.reviewTitle}>{review.title}</span>
              <span className={board.reviewState}><State value={review.status.replaceAll('-', ' ')} /></span>
            </article>) : <p className={board.empty}>No reviews planned for this month.</p>}</div>
          </section>
          <section className={board.card} aria-label="Assignments this month"><h3 className={board.cardTitle}>Assignments</h3>
            <div className={board.assignments}>{data.assignments.length ? data.assignments.map(assignment => <article key={assignment.id} className={board.assignment}>
              <div className={board.assignmentHead}><div><strong>{assignment.title}</strong><small>{dateLabel(assignment.date)}</small></div><State value={assignment.status.replaceAll('-', ' ')} /></div>
            </article>) : <p className={board.empty}>No assignments found for this month.</p>}</div>
          </section>
        </div>
        <section className={board.card} aria-label="Lectures this month"><h3 className={board.cardTitle}>Lectures this month</h3>
          {data.lectures.length ? <div className={board.tableScroll}><table className={board.table}>
            <thead><tr><th scope="col">Date</th><th scope="col">Time</th><th scope="col">Session</th><th scope="col">Tutor</th><th scope="col">Duration</th></tr></thead>
            <tbody>{data.lectures.map(lecture => <tr key={lecture.id}><td>{dateLabel(lecture.date)}</td><td>{lecture.time}</td><td>{lecture.title}</td><td>{lecture.tutor}</td><td>{lecture.durationMinutes} min</td></tr>)}</tbody>
          </table></div> : <p className={board.empty}>No lectures scheduled for this month.</p>}
        </section>
      </>}
  </section>;
}
