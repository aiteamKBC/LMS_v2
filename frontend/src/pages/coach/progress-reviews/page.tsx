import { useEffect, useState } from 'react';
import { fetchEvidence, type EvidenceRecord } from '@/api/evidence';
import { fetchLearnerDetail, type LearnerDetail, type LearnerKind, type LearnerQuizAttempt } from '@/api/learnerDetail';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { CardSkeleton } from '@/components/feature/Skeletons';
import { RowAction } from '@/components/ui/ActionRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterToolbar, SearchInput } from '@/components/ui/FilterToolbar';
import { MetricCard } from '@/components/ui/MetricCard';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageTabs, type PageTabItem } from '@/components/ui/PageTabs';
import { Pagination } from '@/components/ui/Pagination';
import { Panel } from '@/components/ui/Panel';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { cn } from '@/lib/cn';
import { roleNavMap } from '@/mocks/navigation';
import type { ProgressReviewResponses } from '@/pages/shared/progressReviewForm';
import { CalendarEventMeta, CalendarEventRow } from '../shared/CalendarEventRow';
import { InfoTile, ModernDatePicker, ModernDurationPicker, ScheduleFieldLabel, ScheduleTimeInput } from '../shared/ScheduleControls';
import ProgressReviewCompletionModal from '../shared/ProgressReviewCompletionModal';
import {
  type CalendarAction,
  type CoachCalendarEvent,
  type ScheduleFormState,
  canJoinMeeting,
  eventDisplayDate,
  eventIdentity,
  eventPeriodLabel,
  fetchCoachCalendarEvents,
  formatDateLabel,
  formatTimeLabel,
  isAtRiskProgressReview,
  isAwaitingSignatureEvent,
  isDueSoonEvent,
  isEventThisMonth,
  isInProgressEvent,
  isScheduledEvent,
  isCompletedEvent,
  meetingUrl,
  needsScheduling,
  parseLocalDate,
  runCoachCalendarAction,
  scheduleCoachCalendarEvent,
  scheduleDefaults,
  sortEvents,
  statusLabel,
} from '../shared/calendarEvents';
import ProgressReviewSlidesModal, {
  type ProgressReviewSlide,
  type ProgressReviewSlideListItem,
  type ProgressReviewSlidesDeck,
} from './components/ProgressReviewSlidesModal';
import {
  buildKsbProgress,
  completedComponentIds,
  formatHoursMinutes,
  gradePercent,
} from '@/utils/learnerJourney';

const coachNav = roleNavMap.coach;

type ReviewTab = 'this-month' | 'overdue' | 'due-soon' | 'needs-schedule' | 'scheduled' | 'in-progress' | 'awaiting-signature' | 'completed' | 'all';

const FILTER_COPY: Record<ReviewTab, { label: string; description: string }> = {
  'this-month': {
    label: 'This Month',
    description: 'Progress reviews with a target or scheduled date inside the current month, excluding completed reviews.',
  },
  overdue: {
    label: 'Overdue',
    description: 'Progress reviews where the target date has passed and the review is still not scheduled.',
  },
  'due-soon': {
    label: 'Due Soon',
    description: 'Progress reviews not scheduled yet and due within the next 14 days.',
  },
  'needs-schedule': {
    label: 'Not Scheduled',
    description: 'Progress reviews that still need a first calendar booking.',
  },
  scheduled: {
    label: 'Scheduled',
    description: 'Progress reviews that are booked and waiting to start.',
  },
  'in-progress': {
    label: 'In Progress',
    description: 'Progress reviews that have already been started by the coach.',
  },
  'awaiting-signature': {
    label: 'Awaiting Signature',
    description: 'Progress reviews completed by the coach and waiting for the line manager signature.',
  },
  completed: {
    label: 'Completed',
    description: 'Progress reviews marked as completed or confirmed.',
  },
  all: {
    label: 'All',
    description: 'Every generated progress review for this coach across the learner programme dates.',
  },
};

const EMPTY_SCHEDULE_FORM: ScheduleFormState = {
  date: '',
  time: '09:00',
  durationMinutes: 60,
};

const REVIEWS_PER_PAGE = 10;
const TWELVE_WEEK_WINDOW_DAYS = 84;

interface ProgressReviewActivity {
  id: string;
  at: string;
  title: string;
  module: string;
  week: string;
  kind: 'Quiz' | 'Video' | 'Activity';
  status: string;
  minutes: number;
  timeLabel: string;
  detail: string;
}

function displayValue(value?: string | number | null) {
  if (value === null || value === undefined) return '--';
  const text = String(value).trim();
  return text || '--';
}

function matchesReviewSearch(review: CoachCalendarEvent, searchTerm: string) {
  const normalizedSearch = searchTerm.trim().toLowerCase();
  if (!normalizedSearch) return true;

  const searchableText = [
    review.learner,
    review.email,
    review.programme,
    review.cohort,
    review.group,
    review.learnerId,
    eventPeriodLabel(review),
    statusLabel(review.status),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return normalizedSearch
    .split(/\s+/)
    .filter(Boolean)
    .every(token => searchableText.includes(token));
}

function titleCaseLabel(value?: string | null) {
  const normalized = String(value || '').trim().replace(/[_-]+/g, ' ');
  if (!normalized) return 'Activity';
  return normalized.replace(/\b\w/g, char => char.toUpperCase());
}

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function currentTimestampLabel() {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date()).replace(',', '');
}

function toneForStatus(value?: string | null) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === '--') return 'default' as const;
  if (
    normalized.includes('risk')
    || normalized.includes('overdue')
    || normalized.includes('rejected')
    || normalized.includes('failed')
  ) return 'danger' as const;
  if (
    normalized.includes('attention')
    || normalized.includes('pending')
    || normalized.includes('partial')
    || normalized.includes('awaiting')
  ) return 'warn' as const;
  if (
    normalized.includes('track')
    || normalized.includes('passed')
    || normalized.includes('complete')
    || normalized.includes('approved')
    || normalized.includes('active')
  ) return 'good' as const;
  return 'default' as const;
}

function parseTrackedMinutes(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return 0;

  if (text.includes(':')) {
    const [minutesPart, secondsPart] = text.split(':');
    const minutes = Number(minutesPart);
    const seconds = Number(secondsPart);
    if (Number.isFinite(minutes) && Number.isFinite(seconds)) {
      return minutes + (seconds / 60);
    }
  }

  const hourMatch = text.match(/([\d.]+)\s*(?:h|hr|hour)/i);
  if (hourMatch) return Number(hourMatch[1]) * 60;

  const minuteMatch = text.match(/([\d.]+)\s*(?:m|min|minute)/i);
  if (minuteMatch) return Number(minuteMatch[1]);

  const rawNumber = text.match(/\d+(?:\.\d+)?/);
  return rawNumber ? Number(rawNumber[0]) : 0;
}

function formatTrackedTime(primary?: string | null, secondary?: string | null) {
  const first = displayValue(primary);
  if (first !== '--') return first;
  const fallback = displayValue(secondary);
  return fallback !== '--' ? fallback : '--';
}

function isWithinWindow(value: string | null | undefined, startIso: string, endIso: string) {
  const date = parseLocalDate(value);
  const start = parseLocalDate(startIso);
  const end = parseLocalDate(endIso);
  if (!date || !start || !end) return false;
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

function buildTwelveWeekWindow(review: CoachCalendarEvent) {
  const end = parseLocalDate(eventDisplayDate(review)) || new Date();
  const start = addDays(end, -(TWELVE_WEEK_WINDOW_DAYS - 1));
  const startIso = toIsoDate(start);
  const endIso = toIsoDate(end);
  return {
    startIso,
    endIso,
    label: `${formatDateLabel(startIso)} to ${formatDateLabel(endIso)}`,
  };
}

function trainingPlanContextLabel(details?: EvidenceRecord['trainingPlanDetails'] | null) {
  const parts = [
    displayValue(details?.moduleTitle),
    displayValue(details?.weekTitle),
    displayValue(details?.componentTitle),
  ].filter(value => value !== '--');
  return parts.length ? parts.join(' / ') : '--';
}

async function fetchAnyLearnerDetail(id: string) {
  const [commercial, apprenticeship] = await Promise.allSettled([
    fetchLearnerDetail('commercial', id),
    fetchLearnerDetail('apprenticeship', id),
  ]);

  if (commercial.status === 'fulfilled') {
    return { kind: 'commercial' as const, detail: commercial.value };
  }

  if (apprenticeship.status === 'fulfilled') {
    return { kind: 'apprenticeship' as const, detail: apprenticeship.value };
  }

  const commercialMessage = commercial.status === 'rejected' && commercial.reason instanceof Error
    ? commercial.reason.message
    : null;
  const apprenticeshipMessage = apprenticeship.status === 'rejected' && apprenticeship.reason instanceof Error
    ? apprenticeship.reason.message
    : null;
  const non404 = [commercialMessage, apprenticeshipMessage].find(message => message && !message.includes('404'));

  throw new Error(non404 || commercialMessage || apprenticeshipMessage || 'Could not load learner detail.');
}

function buildReviewActivities(detail: LearnerDetail): ProgressReviewActivity[] {
  const componentById = new Map(
    (detail.components || [])
      .filter(component => component.componentId)
      .map(component => [String(component.componentId), component] as const),
  );
  const componentByQuizId = new Map(
    (detail.components || [])
      .filter(component => component.quizMeta?.quizId != null)
      .map(component => [String(component.quizMeta?.quizId), component] as const),
  );
  const activities: ProgressReviewActivity[] = [];

  for (const attempt of detail.quizAttempts || []) {
    const component = componentByQuizId.get(String(attempt.quizId));
    activities.push({
      id: `quiz-${attempt.quizId}-${attempt.submittedAt}`,
      at: attempt.submittedAt,
      title: displayValue(component?.component) !== '--' ? displayValue(component?.component) : `Quiz ${attempt.quizId}`,
      module: displayValue(component?.module),
      week: displayValue(component?.week),
      kind: 'Quiz',
      status: attempt.passed ? 'Passed' : 'Attempted',
      minutes: parseTrackedMinutes(attempt.reportedTime || attempt.timeTaken || ''),
      timeLabel: formatTrackedTime(attempt.reportedTime, attempt.timeTaken),
      detail: `${gradePercent(attempt.grade)}%${attempt.passed ? ' · Passed' : ' · Attempted'}`,
    });
  }

  for (const progress of detail.videoProgress || []) {
    const component = componentById.get(String(progress.componentId));
    activities.push({
      id: `video-${progress.componentId}-${progress.submittedAt}`,
      at: progress.submittedAt,
      title: displayValue(component?.component) !== '--' ? displayValue(component?.component) : 'Video',
      module: displayValue(component?.module),
      week: displayValue(component?.week),
      kind: 'Video',
      status: 'Completed',
      minutes: parseTrackedMinutes(progress.reportedTime || progress.timeTaken || ''),
      timeLabel: formatTrackedTime(progress.reportedTime, progress.timeTaken),
      detail: 'Video watched and recorded',
    });
  }

  for (const progress of detail.componentProgress || []) {
    const component = componentById.get(String(progress.componentId));
    activities.push({
      id: `component-${progress.componentId}-${progress.submittedAt}`,
      at: progress.submittedAt,
      title: displayValue(component?.component) !== '--'
        ? displayValue(component?.component)
        : titleCaseLabel(progress.componentType),
      module: displayValue(component?.module),
      week: displayValue(component?.week),
      kind: 'Activity',
      status: 'Completed',
      minutes: parseTrackedMinutes(progress.reportedTime || progress.timeTaken || ''),
      timeLabel: formatTrackedTime(progress.reportedTime, progress.timeTaken),
      detail: `${titleCaseLabel(progress.componentType)} completed`,
    });
  }

  return activities.sort((left, right) => right.at.localeCompare(left.at));
}

function buildProgressReviewSlidesDeck(
  review: CoachCalendarEvent,
  ownerName: string,
  kind: LearnerKind,
  detail: LearnerDetail,
  evidence: EvidenceRecord[],
): ProgressReviewSlidesDeck {
  const window = buildTwelveWeekWindow(review);
  const recentActivities = buildReviewActivities(detail).filter(activity => isWithinWindow(activity.at, window.startIso, window.endIso));
  const recentEvidence = evidence
    .filter(record => isWithinWindow(record.uploadedAt, window.startIso, window.endIso))
    .sort((left, right) => String(right.uploadedAt || '').localeCompare(String(left.uploadedAt || '')));
  const recentQuizzes = (detail.quizAttempts || [])
    .filter(attempt => isWithinWindow(attempt.submittedAt, window.startIso, window.endIso))
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));

  const recentMinutes = recentActivities.reduce((sum, activity) => sum + activity.minutes, 0);
  const modulesTouched = Array.from(new Set(recentActivities.map(activity => activity.module).filter(module => module !== '--')));
  const quizAverage = recentQuizzes.length
    ? Math.round(recentQuizzes.reduce((sum, attempt) => sum + gradePercent(attempt.grade), 0) / recentQuizzes.length)
    : null;
  const passedQuizzes = recentQuizzes.filter(attempt => attempt.passed).length;
  const approvedEvidence = recentEvidence.filter(record => record.status === 'approved').length;
  const pendingEvidence = recentEvidence.filter(record => record.status === 'pending').length;
  const rejectedEvidence = recentEvidence.filter(record => record.status === 'rejected').length;

  const ksbProgress = buildKsbProgress({
    ksbs: detail.ksbs || [],
    components: detail.components || [],
    completedComponentIds: completedComponentIds(detail),
  }).filter(ksb => ksb.totalCount > 0);
  const totalAvailableWeight = ksbProgress.reduce((sum, item) => sum + item.availableWeight, 0);
  const totalEarnedWeight = ksbProgress.reduce((sum, item) => sum + item.earnedWeight, 0);
  const ksbCoverage = totalAvailableWeight ? Math.round((totalEarnedWeight / totalAvailableWeight) * 100) : 0;
  const strongestKsbs = [...ksbProgress]
    .sort((left, right) => right.pct - left.pct || right.doneCount - left.doneCount)
    .slice(0, 5);
  const weakestKsbs = [...ksbProgress]
    .filter(item => item.pct < 100)
    .sort((left, right) => left.pct - right.pct || left.doneCount - right.doneCount)
    .slice(0, 5);

  const moduleSummary = Array.from(recentActivities.reduce((map, activity) => {
    if (activity.module === '--') return map;
    const current = map.get(activity.module) || { count: 0, minutes: 0, latestAt: '' };
    current.count += 1;
    current.minutes += activity.minutes;
    if (activity.at > current.latestAt) current.latestAt = activity.at;
    map.set(activity.module, current);
    return map;
  }, new Map<string, { count: number; minutes: number; latestAt: string }>())).map(([module, summary]) => ({
    module,
    ...summary,
  })).sort((left, right) => right.latestAt.localeCompare(left.latestAt));

  const weeklyRows = Array.from({ length: 12 }, (_, index) => {
    const bucketStart = addDays(parseLocalDate(window.startIso) || new Date(window.startIso), index * 7);
    const bucketEnd = addDays(bucketStart, 6);
    const bucketStartIso = toIsoDate(bucketStart);
    const bucketEndIso = toIsoDate(bucketEnd);
    const bucketActivities = recentActivities.filter(activity => isWithinWindow(activity.at, bucketStartIso, bucketEndIso));
    const bucketQuizzes = recentQuizzes.filter(attempt => isWithinWindow(attempt.submittedAt, bucketStartIso, bucketEndIso));
    const bucketEvidence = recentEvidence.filter(record => isWithinWindow(record.uploadedAt, bucketStartIso, bucketEndIso));
    const bucketMinutes = bucketActivities.reduce((sum, activity) => sum + activity.minutes, 0);
    return [
      `Week ${index + 1}`,
      `${formatDateLabel(bucketStartIso)} - ${formatDateLabel(bucketEndIso)}`,
      String(bucketActivities.length),
      bucketQuizzes.length ? `${bucketQuizzes.filter(attempt => attempt.passed).length}/${bucketQuizzes.length} passed` : '--',
      String(bucketEvidence.length),
      bucketMinutes ? formatHoursMinutes(bucketMinutes / 60) : '--',
    ];
  }).reverse();

  const latestActivity = recentActivities[0];
  const latestEvidence = recentEvidence[0];

  const supportItems: ProgressReviewSlideListItem[] = weakestKsbs.map((item) => ({
    title: `${item.code} · ${item.description || 'KSB focus area'}`,
    badge: `${item.pct}%`,
    tone: item.pct >= 70 ? 'warn' : 'danger',
    detail: `${item.doneCount} of ${item.totalCount} linked activities currently completed.`,
    meta: item.contributors.slice(0, 2).map(contributor => contributor.title).join(' · ') || 'No contributing activities yet.',
  }));

  if (pendingEvidence > 0) {
    supportItems.push({
      title: 'Pending evidence review',
      badge: `${pendingEvidence} item${pendingEvidence === 1 ? '' : 's'}`,
      tone: 'warn',
      detail: 'Review uploaded evidence that is still waiting for approval or feedback.',
    });
  }

  if (quizAverage !== null && quizAverage < 70) {
    supportItems.push({
      title: 'Assessment support needed',
      badge: `${quizAverage}% average`,
      tone: 'warn',
      detail: 'Discuss revision confidence, quiz retakes, and any support the learner needs before the next review cycle.',
    });
  }

  if (displayValue(detail.otjhStatus) !== '--' && toneForStatus(detail.otjhStatus) !== 'good') {
    supportItems.push({
      title: 'OTJH follow-up',
      badge: displayValue(detail.otjhStatus),
      tone: toneForStatus(detail.otjhStatus),
      detail: 'Agree a catch-up plan and confirm where recent learning time is being recorded.',
    });
  }

  const slides: ProgressReviewSlide[] = [
    {
      id: 'cover',
      title: 'Overview',
      type: 'cover',
      eyebrow: 'Progress Review Slide Deck',
      heading: `${displayValue(detail.name)} · last 12-week learner summary`,
      subheading: 'This deck is auto-generated from learner progress, evidence, quiz, and KSB data to support the current progress review.',
      details: [
        { label: 'Learner', value: displayValue(detail.name) },
        { label: 'Programme', value: displayValue(detail.programme || review.programme) },
        { label: 'Employer', value: displayValue(detail.employer) },
        { label: 'Line manager', value: displayValue(detail.lineManager) },
        { label: 'Coach', value: displayValue(ownerName) },
        { label: 'Review window', value: window.label },
        { label: 'Review status', value: statusLabel(review.status) },
        { label: 'Data source', value: kind === 'apprenticeship' ? 'Apprenticeship learner profile' : 'Commercial learner profile' },
      ],
    },
    {
      id: 'snapshot',
      title: '12-Week Snapshot',
      type: 'metrics',
      heading: '12-week snapshot',
      subheading: 'A quick summary of activity, evidence, assessment, and KSB movement recorded within the selected review window.',
      metrics: [
        { label: 'Learning activities', value: String(recentActivities.length) },
        { label: 'Recorded learning time', value: recentMinutes ? formatHoursMinutes(recentMinutes / 60) : '--' },
        { label: 'Evidence uploads', value: String(recentEvidence.length) },
        { label: 'Approved evidence', value: String(approvedEvidence), tone: approvedEvidence > 0 ? 'good' : 'default' },
        { label: 'Passed quizzes', value: recentQuizzes.length ? `${passedQuizzes}/${recentQuizzes.length}` : '--', tone: recentQuizzes.length && passedQuizzes === recentQuizzes.length ? 'good' : 'default' },
        { label: 'Quiz average', value: quizAverage !== null ? `${quizAverage}%` : '--', tone: quizAverage !== null ? (quizAverage >= 70 ? 'good' : 'warn') : 'default' },
        { label: 'KSB coverage', value: `${ksbCoverage}%`, tone: ksbCoverage >= 70 ? 'good' : ksbCoverage >= 45 ? 'warn' : 'danger' },
        { label: 'OTJH status', value: displayValue(detail.otjhStatus), tone: toneForStatus(detail.otjhStatus) },
      ],
      highlights: [
        {
          title: latestActivity ? latestActivity.title : 'No recent activity recorded',
          badge: latestActivity ? latestActivity.status : 'No activity',
          tone: latestActivity ? toneForStatus(latestActivity.status) : 'default',
          detail: latestActivity ? latestActivity.detail : 'No learner activity has been recorded inside this 12-week window yet.',
          meta: latestActivity ? `${formatDateLabel(latestActivity.at)} · ${latestActivity.module} · ${latestActivity.week}` : window.label,
        },
        {
          title: latestEvidence ? latestEvidence.filename : 'No recent evidence uploaded',
          badge: latestEvidence ? titleCaseLabel(latestEvidence.status) : 'No evidence',
          tone: latestEvidence ? toneForStatus(latestEvidence.status) : 'default',
          detail: latestEvidence ? trainingPlanContextLabel(latestEvidence.trainingPlanDetails) : 'The learner has no evidence files recorded in the selected window.',
          meta: latestEvidence?.uploadedAt ? formatDateLabel(latestEvidence.uploadedAt) : window.label,
        },
        {
          title: modulesTouched.length ? `${modulesTouched.length} active module${modulesTouched.length === 1 ? '' : 's'}` : 'No active modules found',
          detail: modulesTouched.slice(0, 4).join(' · ') || 'Recent activity has not been linked to a named module.',
          meta: displayValue(detail.programme),
        },
      ],
    },
    {
      id: 'weekly',
      title: 'Weekly Summary',
      type: 'table',
      heading: 'Weekly summary across the last 12 weeks',
      subheading: 'Each row shows the learner activity captured inside that 7-day block of the review window.',
      headers: ['Window week', 'Dates', 'Activities', 'Quizzes', 'Evidence', 'Time'],
      rows: weeklyRows,
      note: 'Recorded learning time is calculated from submitted activity times where the learner stored them. It is best used as a discussion aid rather than a signed OTJH total.',
    },
    {
      id: 'learning',
      title: 'Learning Completed',
      type: 'lists',
      heading: 'Learning completed inside the review window',
      subheading: 'Use this slide to walk through the most recent activity and the modules that have seen the most movement.',
      columns: [
        {
          title: 'Recent learner activity',
          items: recentActivities.slice(0, 6).map((activity) => ({
            title: activity.title,
            badge: activity.status,
            tone: toneForStatus(activity.status),
            detail: activity.detail,
            meta: `${formatDateLabel(activity.at)} · ${activity.module} · ${activity.week}${activity.timeLabel !== '--' ? ` · ${activity.timeLabel}` : ''}`,
          })),
        },
        {
          title: 'Modules with recent movement',
          items: moduleSummary.slice(0, 6).map((module) => ({
            title: module.module,
            badge: `${module.count} item${module.count === 1 ? '' : 's'}`,
            detail: module.minutes ? `${formatHoursMinutes(module.minutes / 60)} recorded across this module.` : 'Recent activity is recorded here without a time value.',
            meta: `Latest activity ${formatDateLabel(module.latestAt)}`,
          })),
        },
      ],
    },
    {
      id: 'evidence-assessment',
      title: 'Evidence & Assessments',
      type: 'lists',
      heading: 'Evidence uploads and assessment results',
      subheading: 'A combined view of portfolio evidence and recent quiz attempts inside the same 12-week period.',
      columns: [
        {
          title: 'Recent evidence',
          items: recentEvidence.slice(0, 6).map((record) => ({
            title: record.filename,
            badge: titleCaseLabel(record.status),
            tone: toneForStatus(record.status),
            detail: trainingPlanContextLabel(record.trainingPlanDetails),
            meta: record.uploadedAt ? `${formatDateLabel(record.uploadedAt)} · ${displayValue(record.sectionRef)}` : displayValue(record.sectionRef),
          })),
        },
        {
          title: 'Recent assessments',
          items: recentQuizzes.slice(0, 6).map((attempt: LearnerQuizAttempt) => ({
            title: `${gradePercent(attempt.grade)}% · ${attempt.passed ? 'Passed' : 'Attempted'}`,
            badge: attempt.passed ? 'Passed' : 'Attempted',
            tone: attempt.passed ? 'good' : 'warn',
            detail: `Quiz ${attempt.quizId}${attempt.achievedScore != null && attempt.totalScore != null ? ` · ${attempt.achievedScore}/${attempt.totalScore}` : ''}`,
            meta: `${formatDateLabel(attempt.submittedAt)}${displayValue(attempt.feedback) !== '--' ? ` · ${displayValue(attempt.feedback)}` : ''}`,
          })),
        },
      ],
    },
    {
      id: 'ksb-focus',
      title: 'KSB Focus',
      type: 'lists',
      heading: 'KSB strengths and support focus',
      subheading: 'This slide highlights the strongest evidence coverage and the areas worth discussing during the review.',
      columns: [
        {
          title: 'Strongest KSB coverage',
          items: strongestKsbs.map((item) => ({
            title: `${item.code} · ${item.description || 'KSB strength'}`,
            badge: `${item.pct}%`,
            tone: item.pct >= 70 ? 'good' : 'default',
            detail: `${item.doneCount} of ${item.totalCount} linked activities are already completed.`,
            meta: item.contributors.slice(0, 2).map(contributor => contributor.title).join(' · ') || 'Linked through recent learner activity.',
          })),
        },
        {
          title: 'Support focus and review prompts',
          items: supportItems.length ? supportItems : [
            {
              title: 'No immediate red flags identified',
              badge: 'On track',
              tone: 'good',
              detail: 'Use the review to confirm workplace application examples and keep recent evidence flowing.',
            },
          ],
        },
      ],
    },
  ];

  return {
    learnerName: displayValue(detail.name),
    reviewLabel: 'Progress review slides',
    generatedAt: currentTimestampLabel(),
    windowLabel: window.label,
    slides,
  };
}

export default function CoachProgressReviews() {
  const coach = useCoachIdentity();
  const [tab, setTab] = useState<ReviewTab>('this-month');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [events, setEvents] = useState<CoachCalendarEvent[]>([]);
  const [ownerName, setOwnerName] = useState('Coach');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(EMPTY_SCHEDULE_FORM);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [completionEvent, setCompletionEvent] = useState<CoachCalendarEvent | null>(null);
  const [slidesBusyEventId, setSlidesBusyEventId] = useState<string | null>(null);
  const [slidesDeck, setSlidesDeck] = useState<ProgressReviewSlidesDeck | null>(null);

  useEffect(() => {
    if (!coach.isInitialized) return;
    if (!coach.email) {
      setEvents([]);
      setOwnerName(coach.name);
      setError('Coach access is required to load progress reviews.');
      setLoading(false);
      return;
    }
    const controller = new AbortController();

    const loadReviews = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchCoachCalendarEvents(controller.signal);
        const reviews = sortEvents((data.events || []).filter(event => event.source === 'progress-review'));
        setEvents(reviews);
        setOwnerName(data.owner?.name || coach.name);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setEvents([]);
        setError(err instanceof Error ? err.message : 'Unable to load progress reviews.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    loadReviews();
    return () => controller.abort();
  }, [coach.email, coach.isInitialized, coach.name]);

  const thisMonthEvents = events.filter(event => isEventThisMonth(event));
  const overdueEvents = events.filter(event => isAtRiskProgressReview(event));
  const dueSoonEvents = events.filter(event => isDueSoonEvent(event));
  const scheduledEvents = events.filter(event => isScheduledEvent(event));
  const inProgressEvents = events.filter(event => isInProgressEvent(event));
  const awaitingSignatureEvents = events.filter(event => isAwaitingSignatureEvent(event));
  const completedEvents = events.filter(event => isCompletedEvent(event));
  const needsScheduleEvents = events.filter(needsScheduling);
  const thisMonth = thisMonthEvents.length;
  const overdue = overdueEvents.length;
  const dueSoon = dueSoonEvents.length;
  const pendingSchedule = needsScheduleEvents.length;
  const data = tab === 'this-month'
    ? thisMonthEvents
    : tab === 'overdue'
      ? overdueEvents
      : tab === 'due-soon'
        ? dueSoonEvents
        : tab === 'needs-schedule'
          ? needsScheduleEvents
          : tab === 'scheduled'
            ? scheduledEvents
            : tab === 'in-progress'
              ? inProgressEvents
              : tab === 'awaiting-signature'
                ? awaitingSignatureEvents
                : tab === 'completed'
                  ? completedEvents
                  : tab === 'all'
                    ? events
                    : [];
  const normalizedSearchTerm = searchTerm.trim();
  const filteredData = normalizedSearchTerm
    ? data.filter(review => matchesReviewSearch(review, normalizedSearchTerm))
    : data;
  const pageCount = Math.ceil(filteredData.length / REVIEWS_PER_PAGE);
  const activePage = Math.min(currentPage, Math.max(pageCount, 1));
  const paginatedReviews = filteredData.slice(
    (activePage - 1) * REVIEWS_PER_PAGE,
    activePage * REVIEWS_PER_PAGE,
  );

  const changeTab = (nextTab: ReviewTab) => {
    setTab(nextTab);
    setCurrentPage(1);
    setExpanded(null);
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
    setExpanded(null);
  };

  const updateEvent = (updatedEvent: CoachCalendarEvent) => {
    setEvents(prevEvents => sortEvents(prevEvents.map(event => (
      eventIdentity(event) === eventIdentity(updatedEvent) ? updatedEvent : event
    ))));
    setExpanded(eventIdentity(updatedEvent));
    setScheduleForm(scheduleDefaults(updatedEvent));
  };

  const toggleExpanded = (event: CoachCalendarEvent) => {
    const id = eventIdentity(event);
    setExpanded(expanded === id ? null : id);
    setScheduleForm(scheduleDefaults(event));
    setActionError(null);
    setActionNotice(event.syncWarning || null);
  };

  const handleSchedule = async (event: CoachCalendarEvent) => {
    setBusyEventId(eventIdentity(event));
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await scheduleCoachCalendarEvent(event, scheduleForm);
      updateEvent(data.event);
      if (data.warning) setActionNotice(data.warning);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to schedule review.');
    } finally {
      setBusyEventId(null);
    }
  };

  const handleAction = async (event: CoachCalendarEvent, action: CalendarAction) => {
    setBusyEventId(eventIdentity(event));
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await runCoachCalendarAction(event, action);
      updateEvent(data.event);
      if (data.warning) setActionNotice(data.warning);
      const url = meetingUrl(data.event);
      if (action === 'start' && url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update review.');
    } finally {
      setBusyEventId(null);
    }
  };

  const handleJoin = async (event: CoachCalendarEvent) => {
    if (event.status === 'scheduled') {
      await handleAction(event, 'start');
      return;
    }
    const url = meetingUrl(event);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openCompletionForm = (event: CoachCalendarEvent) => {
    setActionError(null);
    setCompletionEvent(event);
  };

  const handleCreateSlides = async (event: CoachCalendarEvent) => {
    const reviewId = eventIdentity(event);
    if (!event.learnerId) {
      setActionError('This review is missing its learner id, so slides cannot be generated yet.');
      setActionNotice(null);
      setExpanded(reviewId);
      return;
    }

    setSlidesBusyEventId(reviewId);
    setActionError(null);
    setActionNotice(null);
    try {
      const { kind, detail } = await fetchAnyLearnerDetail(event.learnerId);
      let evidence: EvidenceRecord[] = [];
      try {
        evidence = await fetchEvidence(kind, event.learnerId);
      } catch (evidenceError) {
        console.error(evidenceError);
        setActionNotice('Slides were created, but evidence records could not be loaded. The deck uses learner progress data only.');
      }
      setSlidesDeck(buildProgressReviewSlidesDeck(event, ownerName, kind, detail, evidence));
      setExpanded(reviewId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to generate slides for this learner right now.');
      setActionNotice(null);
      setExpanded(reviewId);
    } finally {
      setSlidesBusyEventId(null);
    }
  };

  const handleCompleteReview = async (responses: ProgressReviewResponses) => {
    if (!completionEvent) return;
    setBusyEventId(eventIdentity(completionEvent));
    setActionError(null);
    setActionNotice(null);
    try {
      const result = await runCoachCalendarAction(completionEvent, 'complete', { reviewResponses: responses });
      updateEvent(result.event);
      if (result.warning) setActionNotice(result.warning);
      setCompletionEvent(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to complete review.');
    } finally {
      setBusyEventId(null);
    }
  };

  const tabItems: PageTabItem[] = [
    { value: 'this-month', label: FILTER_COPY['this-month'].label, count: thisMonth },
    { value: 'overdue', label: FILTER_COPY.overdue.label, count: overdue, tone: 'critical' },
    { value: 'due-soon', label: FILTER_COPY['due-soon'].label, count: dueSoon, tone: 'upcoming' },
    { value: 'needs-schedule', label: FILTER_COPY['needs-schedule'].label, count: pendingSchedule, tone: 'caution' },
    { value: 'scheduled', label: FILTER_COPY.scheduled.label, count: scheduledEvents.length, tone: 'info' },
    { value: 'in-progress', label: FILTER_COPY['in-progress'].label, count: inProgressEvents.length, tone: 'info' },
    { value: 'awaiting-signature', label: FILTER_COPY['awaiting-signature'].label, count: awaitingSignatureEvents.length, tone: 'caution' },
    { value: 'completed', label: FILTER_COPY.completed.label, count: completedEvents.length, tone: 'positive' },
    { value: 'all', label: FILTER_COPY.all.label, count: events.length },
  ];

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Progress Reviews" pageSubtitle="Manage learner progress reviews and sign-offs" userName={ownerName} userRole="Progress Coach">
      <PageContainer>
        <PageHeader
          title="Progress Reviews"
          description={`Schedule, run and complete learner progress reviews for ${ownerName}'s active learners.`}
          icon="ri-file-chart-line"
          actions={(
            <button
              type="button"
              onClick={() => changeTab(overdue > 0 ? 'overdue' : 'this-month')}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[12px] font-semibold transition',
                overdue > 0
                  ? 'border-red-200 bg-red-50 text-red-700 hover:border-red-300'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300',
              )}
            >
              <AppIcon className={overdue > 0 ? 'ri-alarm-warning-line' : 'ri-checkbox-circle-line'}></AppIcon>
              {overdue > 0
                ? `${overdue} overdue review${overdue === 1 ? '' : 's'}`
                : 'Everything is on track'}
            </button>
          )}
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="This month" value={thisMonth} icon="ri-calendar-line" tone="neutral" active={tab === 'this-month'} onClick={() => changeTab('this-month')} />
          <MetricCard label="Overdue" value={overdue} icon="ri-alarm-warning-line" tone="critical" active={tab === 'overdue'} onClick={() => changeTab('overdue')} />
          <MetricCard label="Due soon" value={dueSoon} icon="ri-calendar-event-line" tone="upcoming" active={tab === 'due-soon'} onClick={() => changeTab('due-soon')} />
          <MetricCard label="Not scheduled" value={pendingSchedule} icon="ri-calendar-2-line" tone="caution" active={tab === 'needs-schedule'} onClick={() => changeTab('needs-schedule')} />
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-[13px] text-red-700">
            {error}
          </div>
        ) : null}

        <Panel padding="none">
          <div className="border-b border-foreground-100 p-4">
            <div className="mb-3">
              <h3 className="text-[15px] font-semibold text-foreground-900">{FILTER_COPY[tab].label} reviews</h3>
              <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-foreground-500">{FILTER_COPY[tab].description}</p>
            </div>

            <FilterToolbar
              className="mb-3 border-0 bg-transparent p-0 shadow-none"
              search={(
                <SearchInput
                  value={searchTerm}
                  onChange={handleSearchChange}
                  placeholder="Search learner name..."
                  ariaLabel="Search progress reviews by learner"
                />
              )}
              trailing={(
                <span className="whitespace-nowrap rounded-md bg-primary-50 px-3 py-1 text-[12px] font-bold text-primary-700">
                  {normalizedSearchTerm ? `${filteredData.length} of ${data.length}` : data.length} {filteredData.length === 1 ? 'review' : 'reviews'}
                </span>
              )}
            />

            <PageTabs items={tabItems} value={tab} onChange={(next) => changeTab(next as ReviewTab)} label="Filter progress reviews by status" />
          </div>

          <div className="grid gap-3 bg-background-100/55 p-3 sm:p-5 xl:grid-cols-2">
            {loading && Array.from({ length: 4 }).map((_, index) => <CardSkeleton key={index} />)}
            {!loading && !error && data.length === 0 ? (
              <div className="xl:col-span-2">
                <EmptyState variant="empty" icon="ri-file-chart-line" title="No progress reviews found." />
              </div>
            ) : null}
            {!loading && !error && data.length > 0 && filteredData.length === 0 ? (
              <div className="xl:col-span-2">
                <EmptyState variant="no-matches" icon="ri-user-search-line" title="No learner matches this search." />
              </div>
            ) : null}

            {!loading && paginatedReviews.map(review => {
              const isOpen = expanded === eventIdentity(review);
              const isBusy = busyEventId === eventIdentity(review);
              const isSlidesBusy = slidesBusyEventId === eventIdentity(review);
              const joinAvailable = canJoinMeeting(review);
              return (
                <CalendarEventRow
                  key={eventIdentity(review)}
                  event={review}
                  isOpen={isOpen}
                  onToggle={() => toggleExpanded(review)}
                  meta={(
                    <>
                      <CalendarEventMeta icon="ri-book-open-line">{review.programme || '--'}</CalendarEventMeta>
                      <CalendarEventMeta icon="ri-calendar-line">{formatDateLabel(eventDisplayDate(review))}</CalendarEventMeta>
                      <CalendarEventMeta icon="ri-time-line">{formatTimeLabel(review)}</CalendarEventMeta>
                    </>
                  )}
                  actions={(
                    <div className="hidden shrink-0 items-center gap-2 md:flex">
                      {joinAvailable ? (
                        <RowAction label="Join Meeting" icon="ri-video-on-line" emphasis="primary" disabled={isBusy} onClick={() => { handleJoin(review); }} />
                      ) : null}
                      <RowAction
                        label={isSlidesBusy ? 'Creating slides' : 'Create slides'}
                        icon={isSlidesBusy ? 'ri-loader-4-line animate-spin' : 'ri-slideshow-line'}
                        disabled={isSlidesBusy || !review.learnerId}
                        onClick={() => { void handleCreateSlides(review); }}
                      />
                      <RowAction
                        label={needsScheduling(review) ? 'Schedule' : 'Manage'}
                        emphasis="primary"
                        onClick={() => toggleExpanded(review)}
                      />
                    </div>
                  )}
                >
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                      <InfoTile label="Programme" value={review.programme || '--'} />
                      <InfoTile label="Target date" value={formatDateLabel(review.targetDate)} />
                      <InfoTile label="Scheduled date" value={review.scheduledDate ? formatDateLabel(review.scheduledDate) : '--'} />
                      <InfoTile label="Status" value={statusLabel(review.status)} />
                    </div>

                    {review.notes ? (
                      <div className="rounded-lg bg-background-100/60 p-3">
                        <p className="mb-1 text-[12px] font-semibold text-foreground-700">Coach Notes</p>
                        <p className="text-[13px] text-foreground-600">{review.notes}</p>
                      </div>
                    ) : null}

                    {(actionError || actionNotice) ? (
                      <div className={cn('rounded-lg border px-3 py-2 text-[12px]', actionError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800')}>
                        {actionError || actionNotice}
                      </div>
                    ) : null}

                    {!['completed', 'awaiting-signature'].includes(review.status) ? (
                      <div className="rounded-lg border border-background-200/60 bg-background-100/60 p-3">
                        <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-foreground-500">Schedule Review</p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <div>
                            <ScheduleFieldLabel>Date</ScheduleFieldLabel>
                            <ModernDatePicker value={scheduleForm.date} onChange={(value) => setScheduleForm(prev => ({ ...prev, date: value }))} />
                          </div>
                          <div>
                            <ScheduleFieldLabel>Time</ScheduleFieldLabel>
                            <ScheduleTimeInput value={scheduleForm.time} onChange={(value) => setScheduleForm(prev => ({ ...prev, time: value }))} />
                          </div>
                          <div>
                            <ScheduleFieldLabel>Duration</ScheduleFieldLabel>
                            <ModernDurationPicker value={scheduleForm.durationMinutes} onChange={(durationMinutes) => setScheduleForm(prev => ({ ...prev, durationMinutes }))} />
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {joinAvailable ? (
                            <RowAction label="Join Meeting" icon="ri-video-on-line" onClick={() => { handleJoin(review); }} disabled={isBusy} />
                          ) : null}
                          <RowAction
                            label={isSlidesBusy ? 'Creating slides' : 'Create slides'}
                            icon={isSlidesBusy ? 'ri-loader-4-line animate-spin' : 'ri-slideshow-line'}
                            disabled={isSlidesBusy || !review.learnerId}
                            onClick={() => { void handleCreateSlides(review); }}
                          />
                          <RowAction
                            label={review.status === 'scheduled' || review.status === 'in-progress' ? 'Reschedule' : 'Schedule'}
                            icon="ri-calendar-check-line"
                            emphasis="primary"
                            disabled={isBusy}
                            onClick={() => { handleSchedule(review); }}
                          />
                          {review.status === 'in-progress' ? (
                            <RowAction label="Submit Review" icon="ri-send-plane-line" disabled={isBusy} onClick={() => openCompletionForm(review)} />
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {review.status === 'awaiting-signature' ? (
                      <div className="flex flex-col gap-3 rounded-lg border border-violet-200 bg-violet-50 p-4 sm:flex-row sm:items-center">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                          <AppIcon className="ri-pen-nib-line"></AppIcon>
                        </span>
                        <div className="flex-1">
                          <p className="text-xs font-bold text-violet-900">Waiting for line manager signature</p>
                          <p className="mt-1 text-[12px] text-violet-700">The coach review is saved. Confirm the manager signature to finish this review.</p>
                        </div>
                        <RowAction label="Confirm Manager Signature" icon="ri-quill-pen-line" emphasis="primary" disabled={isBusy} onClick={() => { handleAction(review, 'sign'); }} />
                      </div>
                    ) : null}
                  </div>
                </CalendarEventRow>
              );
            })}

            {!loading && pageCount > 1 ? (
              <div className="xl:col-span-2">
                <Pagination
                  page={activePage}
                  totalPages={pageCount}
                  total={filteredData.length}
                  pageSize={REVIEWS_PER_PAGE}
                  onPageChange={(page) => {
                    setCurrentPage(page);
                    setExpanded(null);
                  }}
                  noun="reviews"
                />
              </div>
            ) : null}
          </div>
        </Panel>

        {completionEvent ? (
          <ProgressReviewCompletionModal
            key={eventIdentity(completionEvent)}
            event={completionEvent}
            busy={busyEventId === eventIdentity(completionEvent)}
            error={actionError}
            onClose={() => {
              if (!busyEventId) setCompletionEvent(null);
            }}
            onSubmit={handleCompleteReview}
          />
        ) : null}
        <ProgressReviewSlidesModal
          open={Boolean(slidesDeck)}
          deck={slidesDeck}
          onClose={() => setSlidesDeck(null)}
        />
      </PageContainer>
    </WorkspaceShell>
  );
}
