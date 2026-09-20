import { AppIcon } from '@/components/feature/AppIcon';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { EMPTY_VALUE, displayValue, getOtjhStatusKey, hasValue } from '../lib/format';
import type { InsightMap } from '../lib/attention';
import type { Learner, SortDirection, SortKey } from '../types';
import styles from '../caseload.module.css';

function percent(value: number | null | undefined, available = true) {
  if (!available || value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function componentPercent(learner: Learner) {
  const total = learner.componentsPlanned ?? 0;
  return total > 0 ? percent(((learner.componentsCompleted ?? 0) / total) * 100) : null;
}

function compactNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function ratio(completed: number | null | undefined, total: number | null | undefined, suffix = '') {
  const completedLabel = compactNumber(completed);
  const totalLabel = compactNumber(total);
  return completedLabel !== null && totalLabel !== null && Number(total) > 0
    ? `${completedLabel}${suffix} / ${totalLabel}${suffix}`
    : null;
}

function attendanceRatio(learner: Learner) {
  const present = learner.attendancePresent;
  const absent = learner.attendanceAbsent;
  if (present === null || present === undefined || absent === null || absent === undefined) return null;
  return ratio(present, present + absent);
}

function Progress({ label, value, detail, metric, tone }: { label: string; value: number | null; detail?: string | null; metric: string; tone?: string }) {
  return <div className={styles.miniProgress} data-metric={metric} data-tone={tone} aria-label={`${label}: ${value === null ? 'not available' : `${value}%`}`}>
    <div className={styles.miniLabel}><b>{value === null ? EMPTY_VALUE : `${value}%`}</b></div>
    <div className={styles.track}><div className={styles.fill} style={{ width: `${value ?? 0}%` }} /></div>
    <div className={styles.miniRatio} title={label === 'OTJH' ? 'Actual hours / target hours' : undefined}>{detail || EMPTY_VALUE}</div>
  </div>;
}

function DateMetric({ value, emptyLabel, detail }: { value?: string | null; emptyLabel: string; detail: string }) {
  const available = hasValue(value);
  return <div className={styles.date}>
    <strong>{available ? <><AppIcon name="ri-calendar-line" aria-hidden="true" />{displayValue(value)}</> : EMPTY_VALUE}</strong>
    <small>{available ? detail : emptyLabel}</small>
  </div>;
}

function otjhTone(status?: string | null) {
  const statusKey = getOtjhStatusKey(displayValue(status).replace(/[-_]+/g, ' '));
  if (statusKey === 'at-risk') return 'critical';
  if (statusKey === 'need-attention') return 'warning';
  if (statusKey === 'on-track') return 'positive';
  return 'neutral';
}

function bestActivity(learner: Learner) {
  if (hasValue(learner.attendanceLastSession)) return learner.attendanceLastSession;
  if (hasValue(learner.lastSubmittedEvidence)) return learner.lastSubmittedEvidence;
  if (hasValue(learner.lastContact)) return learner.lastContact;
  return EMPTY_VALUE;
}

export function LearnerTable({ learners, insights, sortKey, sortDirection, onSort, selectionMode, selectedLearnerIds, onToggleSelect, onOpenProfile }: {
  learners: Learner[];
  insights: InsightMap;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
  selectionMode: boolean;
  selectedLearnerIds: Set<string>;
  onToggleSelect: (learnerId: string) => void;
  onOpenProfile: (learner: Learner) => void;
}) {
  const sortHeader = (label: string, key: SortKey) => {
    const active = sortKey === key;
    return <button type="button" className={styles.sortButton} onClick={() => onSort(key)} aria-label={`Sort by ${label}`}>
      <span>{label}</span>
      {active ? (sortDirection === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />) : <ArrowUpDown aria-hidden="true" />}
    </button>;
  };

  return <div className={styles.tableScroll}>
    <table className={styles.table}>
      <caption className="sr-only">Learners, progress, activity and actions</caption>
      <thead>
        <tr className={styles.primaryHead}>
          {selectionMode ? <th rowSpan={2} aria-label="Select learner" /> : null}
          <th rowSpan={2} aria-sort={sortKey === 'name' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Learner', 'name')}</th><th colSpan={4}>Progress</th>
          <th rowSpan={2} aria-sort={sortKey === 'activity' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Last Activity', 'activity')}</th>
          <th rowSpan={2} aria-sort={sortKey === 'progress-review' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Last PR', 'progress-review')}</th>
          <th rowSpan={2} aria-sort={sortKey === 'monthly-coaching' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Last MCM', 'monthly-coaching')}</th>
          <th rowSpan={2}>Actions</th>
        </tr>
        <tr className={styles.progressHead}>
          <th aria-sort={sortKey === 'otjh' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortHeader('OTJH', 'otjh')}</th>
          <th aria-sort={sortKey === 'ksb' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortHeader('KSBs', 'ksb')}</th>
          <th aria-sort={sortKey === 'components' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Activities', 'components')}</th>
          <th aria-sort={sortKey === 'attendance' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Attendance', 'attendance')}</th>
        </tr>
      </thead>
      <tbody>{learners.map(learner => {
        const insight = insights.get(learner.id);
        const activity = bestActivity(learner);
        return <tr key={learner.id}>
          {selectionMode ? <td><input type="checkbox" aria-label={`Select ${learner.name}`} checked={selectedLearnerIds.has(learner.id)} onChange={() => onToggleSelect(learner.id)} /></td> : null}
          <td><div className={styles.learner}><span className={styles.avatar}>{learner.initials}</span><span><strong>{learner.name}</strong><small>{displayValue(learner.programmeName || learner.cohortName)}</small></span></div></td>
          <td className={styles.progressCell}><Progress label="OTJH" metric="otjh" tone={otjhTone(learner.otjhStatus)} value={percent(learner.overallProgress, learner.overallProgressAvailable)} detail={ratio(learner.otjhCompleted, learner.otjhTarget, 'h')} /></td>
          <td className={styles.progressCell}><Progress label="KSBs" metric="ksbs" value={percent(learner.ksbProgress, learner.ksbProgressAvailable)} detail={ratio(learner.ksbCompleted, learner.ksbTarget)} /></td>
          <td className={styles.progressCell}><Progress label="Activities" metric="activities" value={componentPercent(learner)} detail={ratio(learner.componentsCompleted, learner.componentsPlanned)} /></td>
          <td className={styles.progressCell}><Progress label="Attendance" metric="attendance" value={percent(learner.liveAttendanceRate, learner.liveAttendanceRateAvailable)} detail={attendanceRatio(learner)} /></td>
          <td><DateMetric value={activity} emptyLabel="No activity yet" detail={insight?.lastActivityDaysAgo !== null && insight?.lastActivityDaysAgo !== undefined ? `${insight.lastActivityDaysAgo} days ago` : 'Latest activity'} /></td>
          <td><DateMetric value={learner.lastProgressReview} emptyLabel="No PR yet" detail="Latest completed" /></td>
          <td><DateMetric value={learner.lastReview} emptyLabel="No MCM yet" detail="Latest completed" /></td>
          <td><div className={styles.actions}><button type="button" className={styles.profileButton} onClick={() => onOpenProfile(learner)}>View Profile</button></div></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
