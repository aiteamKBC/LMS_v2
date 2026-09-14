import { CalendarDays, CalendarOff, Video } from 'lucide-react';
import type { PlanCurriculumSlot, PlanSession } from '@/api/trainingPlanDashboard';
import { buildCurriculumTimeline, groupCurriculumTimeline } from './model';
import { dateLabel, monthLabel, sessionTime } from './presentation';
import layout from './CurriculumTimeline.module.css';

/**
 * The learner's view of the module curriculum, in the curriculum's own order.
 *
 * Built entirely from the scheduler's slot spine, so this is the same timeline
 * the Curriculum Module Builder shows: the taught slots on the dates they are
 * actually delivered, and the delivery days a cohort holiday closed still
 * present as Reading Weeks rather than silently missing. A learner who only
 * ever saw session dates had no way to tell a holiday from a mistake.
 *
 * A Reading Week states the holiday behind it — its name, its date, its type
 * and any note the GOV.UK feed carried — because "there is no session that week"
 * is not an answer a learner can act on, and "the college is closed for the
 * Early May bank holiday" is.
 */
export function CurriculumTimeline({
  slots,
  sessions,
  title = 'Module schedule',
  limit,
}: {
  slots: PlanCurriculumSlot[] | undefined;
  sessions: PlanSession[];
  title?: string;
  /** Show at most this many rows, with a count of the rest. Omit to show all. */
  limit?: number;
}) {
  const rows = buildCurriculumTimeline(slots, sessions);
  if (!rows.length) return null;
  const shown = limit && rows.length > limit ? rows.slice(0, limit) : rows;
  const hidden = rows.length - shown.length;
  const readingWeeks = rows.filter(row => row.kind === 'reading-week').length;
  const taught = rows.length - readingWeeks;

  return <div className={layout.root} data-testid="curriculum-timeline">
    <h4 className={layout.heading}>
      {title}
      <span>{taught} {taught === 1 ? 'session' : 'sessions'}{readingWeeks ? ` · ${readingWeeks} reading ${readingWeeks === 1 ? 'week' : 'weeks'}` : ''}</span>
    </h4>
    {groupCurriculumTimeline(shown).map(group => <section key={group.key} className={layout.month}>
      <h5 className={layout.monthLabel}>{monthLabel(group.key)}</h5>
      <ol className={layout.rows}>
        {group.rows.map(row => row.kind === 'reading-week'
          ? <li key={`slot-${row.slotNumber}`} className={layout.readingWeek} data-testid="learner-reading-week">
            <CalendarOff size={15} aria-hidden="true" />
            <div>
              <p className={layout.rowTitle}>
                <span className={layout.weekNumber}>Week {row.slotNumber}</span>
                <span className={layout.rowDate}>{dateLabel(row.date)}</span>
                <span className={layout.readingBadge}>Reading Week</span>
              </p>
              {row.holidays.map((holiday, index) => <p key={`${holiday.id || holiday.label}-${index}`} className={layout.holiday}>
                <strong>Holiday:</strong> {holiday.label || 'Holiday'}
                {' · '}{dateLabel(holiday.startDate)}
                {holiday.endDate && holiday.endDate !== holiday.startDate ? ` – ${dateLabel(holiday.endDate)}` : ''}
                {holiday.type ? ` · ${holiday.type}` : ''}
                {holiday.notes ? ` · ${holiday.notes}` : ''}
              </p>)}
              {!row.holidays.length && <p className={layout.holiday}><strong>Holiday</strong> closure on this delivery day.</p>}
              <p className={layout.noSession}>No live session scheduled</p>
            </div>
          </li>
          : <li key={`slot-${row.slotNumber}`} className={layout.session}>
            {row.start ? <Video size={15} aria-hidden="true" /> : <CalendarDays size={15} aria-hidden="true" />}
            <div>
              <p className={layout.rowTitle}>
                <span className={layout.weekNumber}>Week {row.slotNumber}</span>
                <span className={layout.rowDate}>{dateLabel(row.date)}</span>
                <strong>{row.title}</strong>
              </p>
              <p className={layout.detail}>
                {row.start ? `${sessionTime(row.start)} · UK time` : 'Time to be confirmed'}
                {row.minutes ? ` · ${row.minutes} min` : ''}
                {row.attended === true ? ' · Attended' : row.attended === false ? ' · Not attended' : ''}
              </p>
            </div>
          </li>)}
      </ol>
    </section>)}
    {hidden > 0 && <p className={layout.more}>{hidden} more {hidden === 1 ? 'week' : 'weeks'} in this module.</p>}
  </div>;
}
