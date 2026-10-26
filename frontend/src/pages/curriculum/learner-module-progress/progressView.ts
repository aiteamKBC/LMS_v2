import type {
  CurriculumLearnerActivity,
  CurriculumLearnerActivityPlanItem,
  CurriculumProgrammeAssignedLearner,
  CurriculumScopeLearnerKsbImpactResponse,
} from '@/lib/curriculumApi';

export type ActivityLike = CurriculumLearnerActivity | CurriculumLearnerActivityPlanItem;
export type ActivityStatus = 'completed' | 'in-progress' | 'not-started' | 'needs-attention';
export type ActivityType = 'Attendance' | 'Quiz' | 'Reading' | 'Assignment' | 'Audio' | 'Video' | 'Activity';

export interface ProgressRow {
  id: string;
  activity: ActivityLike;
  history: CurriculumLearnerActivity | null;
  type: ActivityType;
  status: ActivityStatus;
  weekId: string;
  weekTitle: string;
  order: number;
  ksbs: string[];
  plannedPoints: number | null;
}

export function resolveProgressLearner(
  roster: CurriculumProgrammeAssignedLearner[],
  learnerId: string,
  enrolmentId: string,
) {
  // These are independent ID namespaces. An enrolment link must never match
  // a profile with a coincidentally equal primary key.
  const matches = roster.filter(learner => enrolmentId
    ? learner.enrolmentId != null && String(learner.enrolmentId) === enrolmentId
    : String(learner.id) === learnerId);
  const unique = new Map(matches.map(learner => [String(learner.id), learner]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}

export function activityType(activity: ActivityLike): ActivityType {
  const value = (activity.componentType || ('kind' in activity ? activity.kind : '') || '').toLowerCase();
  if (value.includes('quiz')) return 'Quiz';
  if (value.includes('assignment')) return 'Assignment';
  if (value.includes('audio') || value.includes('podcast')) return 'Audio';
  if (value.includes('video')) return 'Video';
  if (value.includes('attendance') || value.includes('session') || value.includes('lecture')) return 'Attendance';
  if (value.includes('reading') || value.includes('document') || value.includes('pdf') || value.includes('presentation')) return 'Reading';
  return 'Activity';
}

function activityStatus(activity: ActivityLike, history: CurriculumLearnerActivity | null): ActivityStatus {
  if ('displayStatus' in activity) {
    if (activity.displayStatus === 'not_started') return 'not-started';
    if (activity.displayStatus === 'completed') return 'completed';
  }
  if (history?.progressStatus === 'failed' || history?.passed === false) return 'needs-attention';
  if (history?.progressStatus === 'achieved' || history?.passed === true) return 'completed';
  return 'in-progress';
}

export function buildProgressRows(data: CurriculumScopeLearnerKsbImpactResponse, learnerId: string, weekOrder: readonly string[] = []): ProgressRow[] {
  const history = (data.learnerActivities || []).filter(row => String(row.learnerId) === learnerId
    && (!row.scopeStatus || row.scopeStatus === 'in_scope'));
  const byProgressId = new Map(history.map(row => [String(row.progressId), row]));
  const plan = (data.learnerActivityPlan || []).filter(row => String(row.learnerId) === learnerId);
  // The assigned list, including rows with no history, is the display base.
  // History is enrichment; it must never remove unstarted activities.
  const base: ActivityLike[] = data.learnerActivityPlan !== undefined ? plan : history;
  const seen = new Set<string>();
  const weekRanks = new Map(weekOrder.map((id, index) => [id, index]));
  // Preserve activities whose week is no longer in the authored structure.
  // They follow the known weeks in their existing order, without merging titles.
  return base.flatMap((activity, index) => {
    const planned = 'activityPlanId' in activity;
    const id = planned ? activity.activityPlanId : `progress:${activity.progressId}`;
    if (seen.has(id)) return [];
    seen.add(id);
    const record = planned ? byProgressId.get(String(activity.progressId)) || null : activity;
    const mappedCodes = (data.coverage?.items || []).filter(item => item.mappings?.some(mapping =>
      String(mapping.component_id || mapping.componentId || '') === String(activity.componentId),
    )).map(item => item.code);
    const ksbs = [...new Set([...mappedCodes, ...(record?.ksbSnapshot || []).map(item => item.code)])].sort();
    const weekId = planned ? activity.weekId || 'unallocated' : activity.week || 'unallocated';
    if (!weekRanks.has(weekId)) weekRanks.set(weekId, weekRanks.size);
    return [{
      id, activity, history: record, type: activityType(activity), status: activityStatus(activity, record),
      weekId,
      weekTitle: activity.week || 'Activities without a week',
      order: planned ? activity.displayOrder : index,
      ksbs, plannedPoints: planned ? activity.points : null,
    }];
  }).sort((left, right) => (weekRanks.get(left.weekId)! - weekRanks.get(right.weekId)!) || left.order - right.order);
}

export function ratioPercent(value: number, total: number): number | null {
  return total > 0 ? Math.round(value / total * 100) : null;
}

export function recordedHours(rows: ProgressRow[]): number | null {
  if (rows.every(row => 'logState' in row.activity && row.activity.logState)) {
    return rows.reduce((sum, row) => sum + ('logState' in row.activity ? row.activity.logState?.acceptedOtjh || 0 : 0), 0);
  }
  const recorded = rows.filter(row => row.history);
  if (!recorded.length) return 0;
  if (recorded.some(row => row.history?.actualOtjh == null)) return null;
  return recorded.reduce((sum, row) => sum + (row.history?.actualOtjh || 0), 0);
}

export function overallPercent(oth: number | null, ksb: number | null, activities: number | null): number | null {
  return oth == null || ksb == null || activities == null ? null : Math.round((oth + ksb + activities) / 3);
}

export function plannedPoints(rows: ProgressRow[]): number | null {
  return rows.some(row => row.plannedPoints == null) ? null
    : rows.reduce((sum, row) => sum + (row.plannedPoints || 0), 0);
}
