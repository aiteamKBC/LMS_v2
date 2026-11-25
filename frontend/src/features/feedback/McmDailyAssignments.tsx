import { useEffect, useId, useState } from 'react';
import { feedbackApi, type FeedbackDailyFilters, type FeedbackDailyRecipients } from '@/api/feedback';
import { AppIcon } from '@/components/feature/AppIcon';
import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import styles from './McmRecipients.module.css';

const dateLabel = (value: string) => new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/London',
}).format(new Date(`${value}T12:00:00Z`));
const timeLabel = (value: string | null) => value ? new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
}).format(new Date(value)) : 'Not recorded';

export function McmDailyAssignments({ formId }: { formId: number }) {
  const prefix = useId();
  const [filters, setFilters] = useState<FeedbackDailyFilters>({ period: '7days', from: '', to: '', search: '', coach: '', day: '', dayPage: 1, page: 1 });
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<FeedbackDailyRecipients | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const invalidDates = filters.period === 'custom' && (!filters.from || !filters.to || filters.from > filters.to);

  const changeFilters = (changes: Partial<FeedbackDailyFilters>) => {
    setFilters(current => ({ ...current, day: '', dayPage: 1, page: 1, ...changes }));
    setData(null); setError(''); setLoading(true);
  };
  useEffect(() => {
    let active = true;
    if (invalidDates) { setLoading(false); return; }
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      feedbackApi.recipientsByDay(formId, filters).then(result => {
        if (active) setData(result);
      }).catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load daily assignments.');
      }).finally(() => { if (active) setLoading(false); });
    }, filters.search ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [formId, filters, revision, invalidDates]);

  const selectDay = (day: string) => { setLoading(true); setFilters(current => ({ ...current, day, page: 1 })); };
  return <section aria-label="Daily MCM assignments">
    <p className={styles.intro}>See who was assigned feedback each day. Dates use UK time and the feedback assignment date, rather than the meeting date.</p>
    <div className={styles.dailyFilters}>
      <label><span id={`${prefix}-period`}>Assignment period</span><select aria-labelledby={`${prefix}-period`} value={filters.period} onChange={event => changeFilters({
        period: event.target.value as FeedbackDailyFilters['period'], from: data?.from || filters.from, to: data?.to || filters.to,
      })}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7days">Last 7 days</option><option value="custom">Custom dates</option></select></label>
      <label><span id={`${prefix}-coach`}>Current coach</span><select aria-labelledby={`${prefix}-coach`} value={filters.coach} onChange={event => changeFilters({ coach: event.target.value })}>
        <option value="">All coaches</option>
        {filters.coach && !data?.coaches.some(coach => coach.key === filters.coach) && <option value={filters.coach}>{filters.coach.startsWith('email:') ? filters.coach.slice(6) : filters.coach === 'unlinked' ? 'Coach not linked' : 'No coach assigned'}</option>}
        {data?.coaches.map(coach => <option key={coach.key} value={coach.key}>{coach.name}{coach.email ? ` — ${coach.email}` : ''}</option>)}
      </select></label>
      {filters.period === 'custom' && <>
        <label>From date<input type="date" value={filters.from} max={filters.to || undefined} onChange={event => changeFilters({ from: event.target.value })} /></label>
        <label>To date<input type="date" value={filters.to} min={filters.from || undefined} onChange={event => changeFilters({ to: event.target.value })} /></label>
      </>}
    </div>
    <div className={styles.toolbar}>
      <label className={styles.search}><span>Find a learner or review</span><input type="search" placeholder="Search name, email, programme or review…" value={filters.search} onChange={event => changeFilters({ search: event.target.value })} /></label>
      <button type="button" className={styles.refresh} disabled={loading || invalidDates} onClick={() => setRevision(value => value + 1)}>Refresh</button>
    </div>
    {invalidDates && <p role="status" className={styles.error}>Choose both dates, with From on or before To.</p>}
    {error && <div role="alert" className={styles.error}>{error}<button type="button" onClick={() => setRevision(value => value + 1)}>Try again</button></div>}
    {!invalidDates && (loading && !data ? <LoadingSkeleton label="Loading daily assignments…" variant="rows" /> : data && <>
      <p className={styles.pageHint}>{dateLabel(data.from)} – {dateLabel(data.to)} · {data.totalLearners} unique students in this period · {data.totalAssignments} assignments. Daily student counts exclude repeats.</p>
      {data.undatedCount > 0 && <p role="status" className={styles.error}>{data.undatedCount} matching assignments have no recorded assignment date and cannot be included in a day.</p>}
      {!data.days.length && !error && <p role="status" className={styles.empty}>No MCM feedback assignments match this period and filters.</p>}
      <div className={styles.groups} aria-busy={loading}>
        {data.days.map((day, index) => {
          const expanded = filters.day === day.date;
          const panelId = `${prefix}-day-${index}`;
          return <div className={styles.group} key={day.date}>
            <button type="button" className={styles.dayHeading} aria-expanded={expanded} aria-controls={expanded ? panelId : undefined} onClick={() => selectDay(expanded ? '' : day.date)}>
              <span className={styles.avatar} aria-hidden="true"><AppIcon name="ri-calendar-line" /></span>
              <strong>{dateLabel(day.date)}</strong><span className={styles.dayCounts}><b>{day.learnerCount}</b> {day.learnerCount === 1 ? 'student' : 'students'} <span>·</span> <b>{day.assignmentCount}</b> {day.assignmentCount === 1 ? 'assignment' : 'assignments'}</span>
              <AppIcon className={styles.chevron} name={expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
            </button>
            {expanded && <div id={panelId} className={styles.dayDetails} role="region" aria-label={`${dateLabel(day.date)} assignments`}>
              {error ? null : loading || data.day !== filters.day ? <LoadingSkeleton label="Loading this day’s assignments…" variant="rows" /> : <>
                <p className={styles.pageHint}>Showing {data.assignments.length ? (data.page - 1) * data.pageSize + 1 : 0}–{Math.min(data.page * data.pageSize, data.selectedTotal)} of {data.selectedTotal} assignments · Current response status</p>
                <div className={styles.dailyTableScroll} role="region" aria-label="Scroll daily assignment details" tabIndex={0}>
                  <table className={styles.dailyTable} aria-label="Assigned learners for selected day">
                    <thead><tr>{['Student', 'Current coach', 'Review', 'Assigned (UK)', 'Response'].map(title => <th key={title} scope="col">{title}</th>)}</tr></thead>
                    <tbody>{data.assignments.map(assignment => <tr key={assignment.key}>
                      <td><strong>{assignment.learnerName}</strong><small>{assignment.programme}</small><small>{assignment.email}</small></td>
                      <td><span>{assignment.coachName}</span><small>{assignment.coachEmail}</small></td>
                      <td><span>{assignment.sourceTitle || 'Monthly coaching review'}</span><small>Form v{assignment.formVersion}</small></td>
                      <td><time dateTime={assignment.assignedAt || undefined}>{timeLabel(assignment.assignedAt)}</time></td>
                      <td><span className={styles.status} data-status={assignment.responseStatus}>{assignment.responseStatus === 'completed' ? 'Completed' : assignment.responseStatus === 'in_progress' ? 'In progress' : assignment.responseStatus === 'not_started' ? 'Not started' : assignment.responseStatus.replaceAll('_', ' ')}</span></td>
                    </tr>)}</tbody>
                  </table>
                </div>
                {data.pages > 1 && <nav aria-label="Assignment pages" className={styles.pagination}>
                  <button type="button" disabled={data.page <= 1} onClick={() => { setLoading(true); setFilters(current => ({ ...current, page: data.page - 1 })); }}>Previous</button>
                  <span>Page {data.page} of {data.pages}</span>
                  <button type="button" disabled={data.page >= data.pages} onClick={() => { setLoading(true); setFilters(current => ({ ...current, page: data.page + 1 })); }}>Next</button>
                </nav>}
              </>}
            </div>}
          </div>;
        })}
      </div>
      {data.dayPages > 1 && <nav aria-label="Day pages" className={styles.pagination}>
        <button type="button" disabled={data.dayPage <= 1 || loading} onClick={() => changeFilters({ dayPage: data.dayPage - 1 })}>Newer days</button>
        <span>Page {data.dayPage} of {data.dayPages} · {data.totalDays} days with assignments</span>
        <button type="button" disabled={data.dayPage >= data.dayPages || loading} onClick={() => changeFilters({ dayPage: data.dayPage + 1 })}>Older days</button>
      </nav>}
    </>)}
  </section>;
}
