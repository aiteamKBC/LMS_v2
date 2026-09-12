import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonBlock } from '@/components/feature/Skeletons';
import { duration, hours, monthLabel, monthStatus } from '@/features/old-otjh/report';
import type { LogMonth, LogPerspective, LogSummary } from './api';
import styles from './monthlyLogs.module.css';

export function MonthList({ summary, base, perspective }: { summary: LogSummary; base: string; perspective: LogPerspective }) {
  const [year, setYear] = useState('all');
  const [pendingOnly, setPendingOnly] = useState(false);
  const signature = perspective === 'learner' ? 'student_signature' : 'coach_signature';
  const years = [...new Set(summary.months.map(item => item.month.slice(0, 4)))];
  const selectedYear = years.includes(year) ? year : 'all';
  const yearMonths = summary.months.filter(item => selectedYear === 'all' || item.month.startsWith(selectedYear));
  const pending = yearMonths.filter(item => !item[signature]);
  const visible = pendingOnly ? pending : yearMonths;
  const groups = new Map<string, LogMonth[]>();
  visible.forEach(item => {
    const key = item.month.slice(0, 4);
    groups.set(key, [...(groups.get(key) || []), item]);
  });
  const signed = summary.months.filter(item => item[signature]).length;
  const total = summary.months.length;
  const percent = total ? Math.round(signed / total * 100) : 0;
  const signer = perspective === 'learner' ? 'Learner' : 'Coach';

  return <div className={styles.index}>
    <header className={styles.indexHeader}>
      <div className={styles.identity}><p className={styles.eyebrow}>Monthly learning record</p>
        <h1>{summary.learner?.name}</h1>
        <div className={styles.learnerMeta}><span>{summary.learner?.programme}</span><span>Coach: {summary.learner?.coach_name || 'Unassigned'}</span></div>
      </div>
      <div className={styles.completion}>
        <div><span>{signer} signatures</span><strong>{signed}<span> / {total}</span></strong></div>
        <div className={styles.progress} role="progressbar" aria-label={`${signer} signatures saved`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>
        <p>{total - signed ? `${total - signed} ${total - signed === 1 ? 'month awaits' : 'months await'} a signature` : total ? 'All signatures saved' : 'No months recorded yet'}</p>
      </div>
    </header>
    {!total ? <EmptyState title="No monthly logs yet" description="Your recorded activities will appear here at the end of the month, ready to review and sign." /> : <>
      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="Filter monthly logs">
          <button type="button" aria-pressed={!pendingOnly} onClick={() => setPendingOnly(false)}>All months<span>{yearMonths.length}</span></button>
          <button type="button" aria-pressed={pendingOnly} onClick={() => setPendingOnly(true)}>Awaiting signature<span>{pending.length}</span></button>
        </div>
        <label className={styles.yearFilter}><AppIcon className="ri-calendar-2-line" /><span className="sr-only">Filter by year</span>
          <select value={selectedYear} onChange={event => setYear(event.target.value)}><option value="all">All years</option>{years.map(value => <option key={value} value={value}>{value}</option>)}</select>
        </label>
      </div>
      {!visible.length ? <div className={styles.noResults}><AppIcon className="ri-checkbox-circle-line" /><h2>All signatures saved{selectedYear !== 'all' ? ` for ${selectedYear}` : ''}</h2><p>There are no months awaiting a {perspective} signature in this view.</p><button type="button" onClick={() => setPendingOnly(false)}>View all months</button></div>
        : <div className={styles.years}>{[...groups].map(([value, months]) => <section key={value} className={styles.yearGroup} aria-label={`${value} monthly logs`}>
          <header className={styles.yearHeading}><h2>{value}</h2><span>{months.length} {months.length === 1 ? 'month' : 'months'}</span></header>
          <div className={styles.months}>{months.map(item => <article key={item.month} className={styles.month}>
            <div className={styles.monthIdentity}><span className={styles.monthIcon}><AppIcon className="ri-file-text-line" /></span><div><h3>{monthLabel(item.month)}</h3><p>{item.row_count} {item.row_count === 1 ? 'activity' : 'activities'}</p></div></div>
            <dl className={styles.hours}><div><dt>Accepted hours</dt><dd>{duration(item.actual_hours)}</dd></div><div><dt>Target hours</dt><dd>{item.training_plan_target == null ? '—' : `${hours(item.training_plan_target)} h`}</dd></div></dl>
            <div className={styles.signatures}><SignatureState role="Learner" signed={!!item.student_signature} /><SignatureState role="Coach" signed={!!item.coach_signature} /></div>
            <span className={`${styles.status} ${item.status === 'complete' ? styles.complete : ''}`}><AppIcon className={item.status === 'complete' ? 'ri-check-line' : 'ri-time-line'} />{monthStatus(item)}</span>
            <Link className={styles.openMonth} to={`${base}/${item.month}`} aria-label={`Review month: ${monthLabel(item.month)}`}><span>View report</span><AppIcon className="ri-arrow-right-line" /></Link>
          </article>)}</div>
        </section>)}</div>}
    </>}
    <p className={styles.scheduleNote}><AppIcon className="ri-information-line" />New months appear here after month-end with your recorded activities, ready to review and sign.</p>
  </div>;
}

function SignatureState({ role, signed }: { role: string; signed: boolean }) {
  return <span className={signed ? styles.signed : styles.unsigned}><AppIcon className={signed ? 'ri-checkbox-circle-line' : 'ri-time-line'} />{role}<span className="sr-only">: {signed ? 'Signed' : 'Awaiting signature'}</span></span>;
}

export function MonthIndexSkeleton() {
  return <div className={styles.index} role="status" aria-label="Loading monthly records" aria-busy="true"><span className="sr-only">Loading monthly records…</span><div aria-hidden="true">
    <div className={styles.indexHeader}><div className="space-y-3"><SkeletonBlock className="h-3 w-36" /><SkeletonBlock className="h-7 w-56 max-w-full" /><SkeletonBlock className="h-3 w-64 max-w-full" /></div></div>
    <div className={styles.toolbar}><SkeletonBlock className="h-9 w-64 max-w-full" /></div>
    <div className={styles.yearGroup}><div className={styles.yearHeading}><SkeletonBlock className="h-5 w-16" /></div>{[0, 1, 2, 3].map(item => <div key={item} className={styles.skeletonRow}><SkeletonBlock className="h-10 w-10 rounded-lg" /><SkeletonBlock className="h-4 w-40 max-w-full" /><SkeletonBlock className="ml-auto h-4 w-24" /></div>)}</div>
  </div></div>;
}
