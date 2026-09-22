import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { percent, reviewDate, type TimelineModule } from './model';

export type ModuleMeasure = { label: string; value: number | null; detail: string };
const count = (value: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value);
const ratio = (done: number | null | undefined, total: number | null | undefined) =>
  done != null && total != null && total > 0 ? percent(done, total) : null;

export function moduleMeasures(module: TimelineModule, data: TrainingPlanDashboard, now = Date.now()): ModuleMeasure[] {
  const ended = [...new Map(module.sessions.filter(session => {
    if (['cancelled', 'deleted'].includes(session.status)) return false;
    const start = Date.parse(session.start);
    const explicitEnd = Date.parse(session.end || '');
    const end = Number.isFinite(explicitEnd) ? explicitEnd
      : Number.isFinite(start) ? start + Math.max(0, session.minutes || 0) * 60_000 : Number.NaN;
    return Number.isFinite(end) && end <= now;
  }).map(session => [session.id, session])).values()];
  const attended = ended.filter(session => session.attended === true).length;
  const pendingAttendance = ended.filter(session => typeof session.attended !== 'boolean').length;
  const reviews = [...new Map(data.reviews.filter(review => review.source !== 'student-support' && review.status !== 'cancelled'
    && module.start && module.end && reviewDate(review) >= module.start && reviewDate(review) <= module.end)
    .map(review => [review.eventKey, review])).values()];
  const completedReviews = reviews.filter(review => review.status === 'completed').length;
  const planned = module.detail?.total_otjh;
  const ksb = module.ksbProgress;
  return [
    { label: 'Attendance', value: ratio(attended, ended.length), detail: ended.length
      ? `${attended} / ${ended.length} ended sessions attended${pendingAttendance ? ` · ${pendingAttendance} pending` : ''}`
      : 'No ended sessions yet' },
    { label: 'Activities', value: ratio(module.done, module.activityCount), detail: module.activityCount ? `${module.done} / ${module.activityCount} completed` : 'No activities assigned' },
    { label: 'Hours', value: ratio(module.actual, planned), detail: module.actual == null ? 'Recorded hours unavailable'
      : planned == null || planned <= 0 ? `${count(module.actual)} hours recorded · target unavailable` : `${count(module.actual)} / ${count(planned)} hours` },
    { label: 'KSBs', value: ratio(ksb?.completed, ksb?.total), detail: ksb == null ? 'KSB progress unavailable'
      : ksb.total ? `${ksb.completed} / ${ksb.total} activity KSB points achieved` : 'No KSB points mapped' },
    { label: 'Reviews', value: module.start && module.end ? ratio(completedReviews, reviews.length) : null,
      detail: !module.start || !module.end ? 'Module dates needed' : reviews.length ? `${completedReviews} / ${reviews.length} completed within module dates` : 'No reviews within module dates' },
  ];
}

export function moduleProgress(module: TimelineModule, data: TrainingPlanDashboard, now = Date.now()) {
  const measures = moduleMeasures(module, data, now);
  const activities = measures.find(measure => measure.label === 'Activities');
  return { measures, available: measures.filter(measure => measure.value != null).length,
    value: activities?.value ?? null };
}
