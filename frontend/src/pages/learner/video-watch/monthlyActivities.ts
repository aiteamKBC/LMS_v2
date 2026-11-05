import type { LearnerDetail, LearnerActivityEntry, LearnerComponentProgress, LearnerQuizAttempt, LearnerVideoProgress } from '@/api/learnerDetail';
import type { ExtraActivity } from '@/api/extraActivities';

type Progress = LearnerComponentProgress | LearnerQuizAttempt | LearnerVideoProgress;
export interface MonthlyActivity {
  title: string; date: string; result: string; reflection: string; ksbs: string[];
  time: string; source: string;
}

const instant = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : String(parsed);
};

// Use the business date, including BST boundaries, independently of the browser zone.
function businessDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** The reflection step and its presentation use the same completed monthly records. */
export function monthlyActivities(detail: LearnerDetail | null, month: string, extras: ExtraActivity[] = []): MonthlyActivity[] {
  const feed = detail?.activityFeed || [];
  const progress: { kind: LearnerActivityEntry['kind']; record: Progress }[] = [
    ...(detail?.quizAttempts || []).map(record => ({ kind: 'quiz' as const, record })),
    ...(detail?.videoProgress || []).map(record => ({ kind: 'video' as const, record })),
    ...(detail?.componentProgress || []).map(record => ({ kind: 'component' as const, record })),
  ];
  const matches = (entry: LearnerActivityEntry, kind: string, record: Progress) => entry.kind === kind
    && (record.kind === 'quiz_reading' ? entry.quizId != null && record.componentId.startsWith(`quiz-reading:${entry.quizId}:`)
      : entry.componentId && record.componentId ? entry.componentId === record.componentId
      : kind === 'quiz' && 'quizId' in record && entry.quizId === record.quizId)
    && instant(entry.at) === instant(record.submittedAt);
  const result: MonthlyActivity[] = [];
  const seen = new Set<string>();
  for (const { kind, record } of progress) {
    if (!record.submittedAt || record.passed === false || (kind === 'quiz' && record.passed !== true)) continue;
    const date = businessDate(record.submittedAt);
    if (!date.startsWith(month + '-')) continue;
    const key = `${kind}:${record.componentId || ('quizId' in record ? record.quizId : '')}:${instant(record.submittedAt)}:${record.attempt || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = feed.find(a => matches(a, kind, record));
    const component = detail?.components?.find(c => c.componentId === record.componentId);
    result.push({
      title: entry?.title || record.componentTitle || component?.component || (kind === 'quiz' ? `Quiz ${'quizId' in record ? record.quizId : ''}` : 'Completed activity'),
      date, result: entry?.detail || entry?.action || (kind === 'quiz' ? 'Passed quiz' : 'Completed'),
      reflection: record.feedback || '', ksbs: record.ksbs || [],
      time: record.reportedTime || record.timeTaken || 'Not recorded', source: record.timeTrackingSource || '',
    });
  }
  // Keep historical feed-only completions, but never duplicate a progress record
  // or turn a failed attempt into a completion through its feed entry.
  for (const entry of feed) {
    if (progress.some(({ kind, record }) => matches(entry, kind, record))) continue;
    const date = businessDate(entry.at);
    if (!date.startsWith(month + '-') || entry.passed === false) continue;
    if (entry.kind === 'quiz' && entry.passed !== true) continue;
    const key = `${entry.kind}:${entry.componentId || entry.quizId || entry.title}:${instant(entry.at)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ title: entry.title, date, result: entry.detail || entry.action, reflection: '', ksbs: [], time: 'Not recorded', source: '' });
  }
  for (const activity of extras) {
    if (activity.month !== month || activity.status === 'draft') continue;
    result.push({ title: activity.title, date: activity.submittedAt ? businessDate(activity.submittedAt) : '',
      result: activity.status.replaceAll('_', ' '), reflection: activity.reflection || activity.answer, ksbs: activity.ksbs,
      time: activity.hours ? `${activity.hours} claimed hours` : 'Not recorded', source: `Extra activity (${month})` });
  }
  return result.sort((a, b) => b.date.localeCompare(a.date));
}

export function monthlyActivityText(activity: MonthlyActivity): string {
  return `${activity.date} | ${activity.title}\nResult: ${activity.result}\nTime recorded: ${activity.time}${activity.source ? ` (${activity.source})` : ''}\nKSBs: ${activity.ksbs.join(', ') || 'Not recorded'}\nLearning and impact: ${activity.reflection || 'Not recorded'}`;
}
