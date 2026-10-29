import type {
  CurriculumLearnerKsbConsumption,
  CurriculumProgrammeAssignedLearner,
  CurriculumScopeLearnerKsbImpactResponse,
} from '@/lib/curriculumApi';
import { systemDateParts } from '@/lib/format';
import { buildProgressRows, type ProgressRow } from '../learner-module-progress/progressView';

export function learnerKey(value: string | number) {
  return String(value);
}

/**
 * The profile id progress rows are keyed on. The assignment directory hands
 * out enrolment ids; the impact roster carries the bridge between the two.
 */
export function profileKey(learner: CurriculumProgrammeAssignedLearner, roster: CurriculumProgrammeAssignedLearner[]) {
  if (learner.enrolmentId == null) return learnerKey(learner.id);
  const matches = roster.filter(row => row.enrolmentId != null && learnerKey(row.enrolmentId) === learnerKey(learner.enrolmentId!));
  return matches.length === 1 ? learnerKey(matches[0].id) : null;
}

export function percentOf(value: number, total: number): number | null {
  return total > 0 ? Math.max(0, Math.min(100, Math.round(value / total * 100))) : null;
}

/** Average of the parts that can be measured; null only when none can. */
export function averagePercent(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value != null);
  return known.length ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length) : null;
}

function rowDate(row: ProgressRow) {
  const log = 'logState' in row.activity ? row.activity.logState : undefined;
  return log?.endedAt || log?.activityDate || row.history?.submittedAt || row.activity.submittedAt || '';
}

function validDate(value: string | null | undefined): value is string {
  return Boolean(value && Number.isFinite(Date.parse(value)));
}

export function lastActivityOf(rows: ProgressRow[]) {
  return rows.map(rowDate).filter(validDate).sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

export interface LearnerProgressSummary {
  key: string | null;
  rows: ProgressRow[];
  completed: number;
  activityPercent: number | null;
  hoursAchieved: number | null;
  hoursPlanned: number;
  unallocatedRecords: number;
  hoursPercent: number | null;
  consumption?: CurriculumLearnerKsbConsumption;
  ksbComplete: number;
  ksbTotal: number;
  ksbPercent: number | null;
  overall: number | null;
  lastActivity?: string;
}

/** One learner's progress in a scope, measured the way the full progress page measures it. */
export function learnerProgressSummary(
  impact: CurriculumScopeLearnerKsbImpactResponse | null,
  key: string | null,
): LearnerProgressSummary {
  const rows = impact && key != null ? buildProgressRows(impact, key) : [];
  const completed = rows.filter(row => row.status === 'completed').length;
  const otjh = key == null ? undefined : impact?.otjhAchievement?.learners?.find(row => learnerKey(row.learnerId) === key);
  const log = key == null ? undefined : impact?.activityLogOtjh?.learners.find(row => learnerKey(row.learnerId) === key);
  const hoursAchieved = log ? log.achievedOtjh : otjh ? otjh.achievedOtjh ?? 0 : impact ? 0 : null;
  const hoursPlanned = log?.plannedOtjh ?? otjh?.plannedOtjh ?? 0;
  const consumption = key == null ? undefined : impact?.learnerKsbConsumption?.find(row => learnerKey(row.learnerId) === key);
  const ksbs = consumption?.ksbs || [];
  const ksbPercent = consumption ? percentOf(consumption.cappedConsumedWeightTotal, consumption.expectedWeightTotal) : null;
  const activityPercent = percentOf(completed, rows.length);
  const hoursPercent = hoursAchieved == null ? null : percentOf(hoursAchieved, hoursPlanned);
  return {
    key,
    rows,
    completed,
    activityPercent,
    hoursAchieved,
    hoursPlanned,
    unallocatedRecords: log?.unallocatedAcceptedRecords || 0,
    hoursPercent,
    consumption,
    ksbComplete: ksbs.filter(ksb => ksb.status === 'complete').length,
    ksbTotal: ksbs.length,
    ksbPercent,
    overall: averagePercent([hoursPercent, ksbPercent, activityPercent]),
    lastActivity: lastActivityOf(rows),
  };
}

export type ModuleStatus = 'complete' | 'attention' | 'in-progress' | 'not-started';

export interface ModuleBreakdownRow {
  id: string;
  title: string;
  percent: number | null;
  completed: number;
  total: number;
  hoursAchieved: number;
  hoursPlanned: number;
  status: ModuleStatus;
}

/** A learner's programme activity grouped back into the modules it came from. */
export function moduleBreakdown(rows: ProgressRow[]): ModuleBreakdownRow[] {
  const modules = new Map<string, { id: string; title: string; rows: ProgressRow[] }>();
  for (const row of rows) {
    const id = String(('moduleCatalogueId' in row.activity && row.activity.moduleCatalogueId) || row.activity.module || 'unassigned');
    const entry = modules.get(id) || { id, title: row.activity.module || 'Activities without a module', rows: [] };
    entry.rows.push(row);
    modules.set(id, entry);
  }
  return [...modules.values()].map(({ id, title, rows: moduleRows }) => {
    const completed = moduleRows.filter(row => row.status === 'completed').length;
    const started = completed > 0 || moduleRows.some(row => row.history);
    const status: ModuleStatus = moduleRows.length && completed === moduleRows.length ? 'complete'
      : moduleRows.some(row => row.status === 'needs-attention') ? 'attention'
        : started ? 'in-progress' : 'not-started';
    return {
      id,
      title,
      percent: percentOf(completed, moduleRows.length),
      completed,
      total: moduleRows.length,
      hoursAchieved: moduleRows.reduce((sum, row) => {
        const log = 'logState' in row.activity ? row.activity.logState : undefined;
        return sum + (log ? log.acceptedOtjh || 0 : row.history?.actualOtjh || 0);
      }, 0),
      hoursPlanned: moduleRows.reduce((sum, row) => sum + (row.activity.expectedOtjh || 0), 0),
      status,
    };
  });
}

export interface RecentActivityItem {
  id: string;
  kind: 'completed' | 'attention' | 'started' | 'evidence';
  title: string;
  detail: string;
  date: string;
}

export function recentActivity(rows: ProgressRow[], limit = 5): RecentActivityItem[] {
  const items: RecentActivityItem[] = [];
  for (const row of rows) {
    const where = [row.activity.module, row.weekTitle].filter(Boolean).join(' · ');
    const date = rowDate(row);
    if (validDate(date) && row.status !== 'not-started') {
      items.push({
        id: `activity:${row.id}`,
        kind: row.status === 'completed' ? 'completed' : row.status === 'needs-attention' ? 'attention' : 'started',
        title: row.activity.componentTitle || row.type,
        detail: where,
        date,
      });
    }
    for (const evidence of row.history?.evidence || []) {
      if (!validDate(evidence.uploadedAt)) continue;
      items.push({
        id: `evidence:${evidence.evidenceId}`,
        kind: 'evidence',
        title: `Uploaded evidence: ${evidence.fileName}`,
        detail: [row.activity.componentTitle, evidence.status].filter(Boolean).join(' · '),
        date: evidence.uploadedAt,
      });
    }
  }
  return items.sort((left, right) => Date.parse(right.date) - Date.parse(left.date)).slice(0, limit);
}

function dayNumber(value: string | Date) {
  const parts = systemDateParts(value);
  return parts ? Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000 : null;
}

/** Whole UK calendar days between a timestamp and now. */
export function daysAgo(value: string, now: Date = new Date()) {
  const then = dayNumber(value);
  const today = dayNumber(now);
  return then == null || today == null ? null : today - then;
}

/** The UK calendar date of a timestamp as yyyy-mm-dd, for comparing with date inputs. */
export function systemDay(value: string) {
  const parts = systemDateParts(value);
  return parts ? `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}` : '';
}
