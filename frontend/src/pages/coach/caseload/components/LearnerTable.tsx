import { AppIcon } from '@/components/feature/AppIcon';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import {
  EMPTY_VALUE,
  daysBetween,
  displayValue,
  getOtjhStatusOverride,
  hasValue,
  otjhProgressAsOfToday,
  parseDisplayDate,
  startOfToday,
} from '../lib/format';
import type { InsightMap } from '../lib/attention';
import type { Learner, SortDirection, SortKey } from '../types';
import { StatusPill } from './primitives';
import styles from '../caseload.module.css';

function percent(value: number | null | undefined, available = true, preservePrecision = false) {
  if (!available || value === null || value === undefined || !Number.isFinite(value)) return null;
  const bounded = Math.max(0, Math.min(100, value));
  return preservePrecision ? bounded : Math.round(bounded);
}

function componentPercent(learner: Learner) {
  if (learner.activityProgressAvailable) return percent(learner.activityProgress, true, true);
  const total = learner.componentsPlanned ?? 0;
  return total > 0 ? percent(((learner.componentsCompleted ?? 0) / total) * 100) : null;
}

function compactNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function ratio(completed: number | null | undefined, total: number | null | undefined, suffix = '') {
  const completedLabel = compactNumber(completed);
  const totalLabel = compactNumber(total);
  return completedLabel !== null && totalLabel !== null && Number(total) > 0
    ? `${completedLabel}${suffix} / ${totalLabel}${suffix}`
    : null;
}

function otjhRatio(completed: number | null | undefined, total: number | null | undefined) {
  const completedLabel = compactNumber(completed);
  if (completedLabel === null) return null;
  const totalLabel = compactNumber(total);
  return `${completedLabel}h / ${totalLabel !== null ? `${totalLabel}h` : EMPTY_VALUE}`;
}

function Progress({ label, value, detail, metric, tone }: { label: string; value: number | null; detail?: string | null; metric: string; tone?: string }) {
  return <div className={styles.miniProgress} data-metric={metric} data-tone={tone} aria-label={`${label}: ${value === null ? 'not available' : `${value}%`}`}>
    <div className={styles.miniLabel}><b>{value === null ? EMPTY_VALUE : `${value}%`}</b></div>
    <div className={styles.track}><div className={styles.fill} style={{ width: `${value ?? 0}%` }} /></div>
    {detail !== null && detail !== undefined
      ? <div className={styles.miniRatio} title={label === 'OTJH' ? 'Actual hours / target hours as of today' : undefined}>{detail}</div>
      : null}
  </div>;
}

type DateTone = 'warning' | 'critical' | undefined;

function overdueTone(daysAgo: number | null, warningAfterDays: number, criticalAfterDays: number): DateTone {
  if (daysAgo === null || daysAgo <= warningAfterDays) return undefined;
  return daysAgo > criticalAfterDays ? 'critical' : 'warning';
}

function dateAgeInDays(value: string | null | undefined, fallback: string | null | undefined, today: Date): number | null {
  const parsed = parseDisplayDate(hasValue(value) ? value : fallback);
  return parsed ? Math.max(0, -daysBetween(today, parsed)) : null;
}

function DateMetric({ value, emptyLabel, detail, metric, tone }: {
  value?: string | null;
  emptyLabel: string;
  detail?: string;
  metric?: 'activity' | 'progress-review' | 'monthly-coaching';
  tone?: DateTone;
}) {
  const available = hasValue(value);
  return <div className={styles.date} data-metric={metric} data-tone={tone}>
    <strong>{available ? <><AppIcon name="ri-calendar-line" aria-hidden="true" />{displayValue(value)}</> : EMPTY_VALUE}</strong>
    {available
      ? (detail ? <small>{detail}</small> : null)
      : <small>{emptyLabel}</small>}
  </div>;
}

function otjhTone(learner: Learner) {
  const statusKey = otjhProgressAsOfToday(learner).status;
  if (statusKey === 'at-risk') return 'critical';
  if (statusKey === 'need-attention') return 'warning';
  if (statusKey === 'on-track') return 'positive';
  return 'neutral';
}

function bestActivity(learner: Learner) {
  if (hasValue(learner.lastActivity)) return learner.lastActivity;
  if (hasValue(learner.attendanceLastSession)) return learner.attendanceLastSession;
  if (hasValue(learner.lastSubmittedEvidence)) return learner.lastSubmittedEvidence;
  if (hasValue(learner.lastContact)) return learner.lastContact;
  return EMPTY_VALUE;
}

export function LearnerTable({ learners, insights, sortKey, sortDirection, onSort, selectionMode, selectedLearnerIds, onToggleSelect, onOpenProfile, today = startOfToday() }: {
  learners: Learner[];
  insights: InsightMap;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
  selectionMode: boolean;
  selectedLearnerIds: Set<string>;
  onToggleSelect: (learnerId: string) => void;
  onOpenProfile: (learner: Learner) => void;
  today?: Date;
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
          <th rowSpan={2} aria-sort={sortKey === 'name' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Learner', 'name')}</th>
          {/* Programme status (Active, Withdrawn, On break...) from the learner record --
              not the risk tier, which the Progress tones already convey. */}
          <th rowSpan={2}>Status</th><th colSpan={3}>Progress</th>
          <th rowSpan={2} aria-sort={sortKey === 'start-date' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Start Date', 'start-date')}</th>
          <th rowSpan={2} aria-sort={sortKey === 'activity' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Last Activity', 'activity')}</th>
          <th rowSpan={2} aria-sort={sortKey === 'progress-review' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Last PR', 'progress-review')}</th>
          <th rowSpan={2} aria-sort={sortKey === 'monthly-coaching' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Last MCM', 'monthly-coaching')}</th>
          <th rowSpan={2}>Actions</th>
        </tr>
        <tr className={styles.progressHead}>
          <th aria-sort={sortKey === 'otjh' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortHeader('OTJH', 'otjh')}</th>
          <th aria-sort={sortKey === 'components' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Activities', 'components')}</th>
          <th aria-sort={sortKey === 'attendance' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Attendance', 'attendance')}</th>
        </tr>
      </thead>
      <tbody>{learners.map(learner => {
        const insight = insights.get(learner.id);
        const activity = bestActivity(learner);
        const otjhProgress = otjhProgressAsOfToday(learner);
        const targetHours = otjhProgress.targetHours;
        const otjhStatusOverride = getOtjhStatusOverride(learner.rawProgramStatus)
          ?? getOtjhStatusOverride(learner.enrollmentStatus);
        const targetProgress = otjhProgress.percent === null ? null : percent(otjhProgress.percent);
        const activityTone = overdueTone(insight?.lastActivityDaysAgo ?? null, 7, 14);
        const progressReviewTone = overdueTone(dateAgeInDays(learner.lastProgressReview, learner.startDate, today), 70, 84);
        const monthlyCoachingTone = overdueTone(dateAgeInDays(learner.lastReview, learner.startDate, today), 21, 28);
        return <tr key={learner.id}>
          {selectionMode ? <td><input type="checkbox" aria-label={`Select ${learner.name}`} checked={selectedLearnerIds.has(learner.id)} onChange={() => onToggleSelect(learner.id)} /></td> : null}
          <td><div className={styles.learner}><span className={styles.avatar}>{learner.initials}</span><span><strong>{learner.name}</strong><small>{displayValue(learner.programmeName)}</small></span></div></td>
          <td>{hasValue(learner.rawProgramStatus) ? <StatusPill value={learner.rawProgramStatus} /> : EMPTY_VALUE}</td>
          <td className={styles.progressCell}>{otjhStatusOverride
            ? <StatusPill value={otjhStatusOverride} />
            : <Progress label="OTJH" metric="otjh" tone={otjhTone(learner)} value={targetProgress} detail={otjhRatio(learner.otjhCompleted, targetHours)} />}
          </td>
          <td className={styles.progressCell}><Progress label="Activities" metric="activities" value={componentPercent(learner)} detail={ratio(learner.componentsCompleted, learner.componentsPlanned)} /></td>
          <td className={styles.progressCell}><Progress label="Attendance" metric="attendance" value={percent(learner.liveAttendanceRate, learner.liveAttendanceRateAvailable, true)} /></td>
          <td><DateMetric value={learner.startDate} emptyLabel="No start date" /></td>
          <td><DateMetric value={activity} emptyLabel="No activity yet" detail={insight?.lastActivityDaysAgo !== null && insight?.lastActivityDaysAgo !== undefined ? `${insight.lastActivityDaysAgo} days ago` : displayValue(learner.lastActivityLabel) !== EMPTY_VALUE ? displayValue(learner.lastActivityLabel) : 'Latest activity'} metric="activity" tone={activityTone} /></td>
          <td><DateMetric value={learner.lastProgressReview} emptyLabel="No PR yet" detail="Latest completed" metric="progress-review" tone={progressReviewTone} /></td>
          <td><DateMetric value={learner.lastReview} emptyLabel="No MCM yet" detail="Latest completed" metric="monthly-coaching" tone={monthlyCoachingTone} /></td>
          <td><div className={styles.actions}><button type="button" className={styles.profileButton} onClick={() => onOpenProfile(learner)}>View Profile</button></div></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
