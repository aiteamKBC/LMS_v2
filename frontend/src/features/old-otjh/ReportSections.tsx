import { Fragment, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Activity, MonthDetail, Summary } from './api';
import { displayDate, duration, groupActivities, hours, monthLabel } from './report';
import styles from './report.module.css';
import design from './design.module.css';
import { MonthBadge, RecordBadge } from './RecordDesign';
import { ActivityExpansion } from './ActivityExpansion';

export function LearnerInformation({ summary, data }: { summary: Summary; data: MonthDetail }) {
  const fields = [['Learner', summary.learner?.name], ['Programme', summary.learner?.programme], ['Coach', summary.learner?.coach_name],
    ['Start date', displayDate(data.profile?.start_date)]];
  return <section className={`${design.hero} ${design.reportHero}`} aria-label="Learner journal">
    <div className={design.reportHeroHeading}><div><p className={design.eyebrow}>Previous learning record</p>
      <h1 className="font-heading">{monthLabel(data.month)}</h1></div>
      <MonthBadge month={data} /></div>
    <dl className={design.facts}>{fields.map(([label, value]) =>
      <div key={label} className={design.fact}><dt className={design.eyebrow}>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>
  </section>;
}

export function MonthlyHours({ data }: { data: MonthDetail }) {
  return <>
    <section className={`${design.card} ${design.reportHours}`} aria-label="Monthly hours check">
      <div><h2 className={design.eyebrow}>Training plan target</h2><p className={`${design.target} tabular-nums`}>{data.training_plan_target == null ? '—' : `${hours(data.training_plan_target)} h`}</p>
        <p className={design.metricNote}>{data.training_plan_target == null ? 'No monthly target available' : 'Monthly target from your training plan'}</p></div>
      <div><p className={design.eyebrow}>Accepted actual</p><p className={`${design.actual} tabular-nums`}>{duration(data.actual_hours)}</p>
        <p className={design.metricNote}>Hours accepted on this report</p></div>
      <div className={design.unacceptedHours}>Not accepted <strong>{duration(data.not_accepted_hours)}</strong></div>
    </section>
    <section className={`${design.card} ${design.recordDetails}`} aria-label="Record details"><dl>
      {[['First evidence', displayDate(data.profile?.first_evidence_date)], ['Planned end date', displayDate(data.profile?.planned_end_date)],
        ['Activities logged', `${data.row_count} records`]].map(([label, value]) => <div key={label}><dt className={design.eyebrow}>{label}</dt><dd>{value}</dd></div>)}
    </dl></section>
  </>;
}

const badge = styles.detailBadge;
function ActivityDescription({ row, expanded, onOpen }: { row: Activity; expanded: boolean; onOpen: (documentId?: number) => void }) {
  return <div className={styles.activityDescription}><h3 className="text-[13px] font-semibold leading-relaxed text-foreground-900"><button type="button" className={styles.activityTrigger} aria-expanded={expanded} aria-controls={`activity-content-${row.id}`} onClick={() => onOpen()}>
    <AppIcon className={`${expanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} mt-0.5 shrink-0 text-primary-600`} /><span>{row.title}</span></button></h3>
    {row.group_name && <p className="text-[11px] text-foreground-500">{row.group_name}</p>}
    {row.component_name && <p className="text-[11px] text-foreground-500">Component: {row.component_name}</p>}
    {(row.duration_minutes != null || row.page_count != null || row.results.length > 0) && <div className={styles.activityBadges}>
      {row.duration_minutes != null && <span className={badge}>Duration {duration(Number(row.duration_minutes) / 60)}</span>}
      {row.page_count != null && <span className={badge}>{row.page_count} pages</span>}
      {row.results.map(result => <span key={`${result.activity_id}-${result.group_id}`} className={badge}>{result.status || 'Status not recorded'}
        {result.quiz_score != null ? ` · Score ${result.quiz_score}/${result.quiz_maximum_score ?? '—'}` : ''}
        {result.quiz_attempt_number ? ` · Attempt ${result.quiz_attempt_number}` : ''}</span>)}
    </div>}
    <div className={styles.activityNotes}>
      {row.completion_note && <p className="whitespace-pre-wrap">{row.completion_note}</p>}
      <p>Planned: {duration(row.planned_hours)}</p>
    </div>
    {row.documents.map(doc => <div key={doc.id} className={styles.document}>
      <span className={styles.documentName}><AppIcon className="ri-file-text-line shrink-0 text-foreground-400" /><span>{doc.display_name}</span></span>
      {doc.url && <span className={styles.documentActions}><button type="button" onClick={() => onOpen(doc.id)} className="text-[12px] font-medium text-primary-700 hover:underline" aria-label={`Open ${doc.display_name}`}>Open</button>
        <a href={doc.url} className="text-[12px] font-medium text-primary-700 hover:underline" aria-label={`Download ${doc.display_name}`}>Download</a></span>}
    </div>)}
  </div>;
}

export function ActivityLog({ data, aptemId }: { data: MonthDetail; aptemId?: number }) {
  const [expanded, setExpanded] = useState<{ rowId: number; documentId?: number } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const open = (rowId: number, documentId?: number) => {
    trigger.current = document.activeElement as HTMLElement;
    setExpanded(previous => previous?.rowId === rowId && documentId === undefined ? null : { rowId, documentId });
  };
  const close = () => { setExpanded(null); trigger.current?.focus({ preventScroll: true }); };
  const total = data.total_actual_hours == null ? null : duration(data.total_actual_hours);
  const subtitles: Record<string, string> = {
    Attendance: 'Sessions recorded for this month', Activities: 'Select an activity to preview its content',
    Assignments: 'Your assignments, submissions and assessment documents',
  };
  return <div className={styles.activitySections}>
    {data.rows.length === 0 ? <section className={design.card}><EmptyState title="No activities are available for this month" description="Please contact your coach." /></section> :
      groupActivities(data.rows).map(group => <section key={group.label} className={`${design.card} overflow-hidden`} aria-label={group.label}>
        <div className={design.sectionHeading}><div><h2 className="font-heading">{group.label}</h2><p>{subtitles[group.label]}</p></div>
          <RecordBadge>{group.activities.length} {group.label === 'Attendance' ? 'records' : group.label.toLowerCase()}</RecordBadge></div>
        <div className={design.sectionBody}><div className={styles.reportTableWrap}><table className={styles.activityTable} aria-label={group.label === 'Activities' ? 'Monthly activity log' : `${group.label} log`}>
        <thead><tr>{['Date', 'Category', 'Activity', 'Timestamp', 'Actual', 'KSB scope'].map(title => <th scope="col" key={title}>{title}</th>)}</tr></thead>
        <tbody>
          {group.activities.map(row => <Fragment key={row.id}><tr className={styles.activityRow}>
            <td data-label="Date"><span className="whitespace-nowrap font-mono text-[11px]">{displayDate(row.activity_date)}</span></td>
            <td data-label="Category"><span className="text-[12px] text-foreground-600">{row.category}</span></td>
            <td className={styles.activityCell}><ActivityDescription row={row} expanded={expanded?.rowId === row.id} onOpen={documentId => open(row.id, documentId)} /></td>
            <td data-label="Timestamp"><span className="font-mono text-[11px]">{row.timestamp_label || row.activity_time || '—'}</span></td>
            <td data-label="Actual"><span className="whitespace-nowrap font-mono text-[12px] font-medium">{duration(row.actual_hours)}</span>
              <span className={`mt-1 block text-[10px] ${row.accepted ? 'text-emerald-700' : 'text-foreground-500'}`}>{row.accepted ? 'Accepted' : 'Not accepted'}</span></td>
            <td data-label="KSB scope"><div className="flex flex-wrap gap-1">{row.ksb_codes?.length ? row.ksb_codes.map(code => <span key={code} className={badge}>{code}</span>) : <span className="text-foreground-400">—</span>}</div></td>
          </tr>{expanded?.rowId === row.id && <tr className={styles.expansionRow}><td colSpan={6} id={`activity-content-${row.id}`}>
            <ActivityExpansion key={`${row.id}-${expanded.documentId ?? 'content'}`} row={row} month={data.month} aptemId={aptemId} initialDocumentId={expanded.documentId} onClose={close} />
          </td></tr>}</Fragment>)}
        </tbody>
      </table></div></div></section>)}
    <div className={design.reportTotals}>
      <span>{data.rows.length} activities</span><span>Planned <strong>{duration(data.planned_hours)}</strong></span>
      {total && <span>Total actual <strong>{total}</strong></span>}<span>Accepted <strong>{duration(data.actual_hours)}</strong></span>
    </div>
  </div>;
}
