import { useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type EvidenceRecord } from '@/api/evidence';
import { isImportedReviewEvent } from '@/api/coachImportedReviews';
import { type LearnerDetail, type LearnerKind, type LearnerQuizAttempt } from '@/api/learnerDetail';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchInput } from '@/components/ui/FilterToolbar';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageTabs, type PageTabItem } from '@/components/ui/PageTabs';
import { Pagination } from '@/components/ui/Pagination';
import { Panel } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { cn } from '@/lib/cn';
import { statusTone } from '@/lib/statusTone';
import { roleNavMap } from '@/mocks/navigation';
import type { ProgressReviewResponses } from '@/pages/shared/progressReviewForm';
import { LearnerAvatar } from '../shared/LearnerIdentity';
import { ModernDatePicker, ModernDurationPicker, ScheduleFieldLabel, ScheduleTimeInput } from '../shared/ScheduleControls';
import ProgressReviewCompletionModal from '../shared/ProgressReviewCompletionModal';
import { reviewInstancePath, reviewInstanceRouteState } from '../shared/reviewInstanceNavigation';
import {
  type CoachCalendarEvent,
  type ScheduleFormState,
  canJoinMeeting,
  eventDisplayDate,
  eventIdentity,
  eventPeriodLabel,
  eventTargetDate,
  fetchCoachCalendarEvents,
  formatDateLabel,
  formatTimeLabel,
  isAtRiskProgressReview,
  isAwaitingSignatureEvent,
  isDueSoonEvent,
  isEventInMonth,
  isInProgressEvent,
  hasScheduledSlot,
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
import {
  type ProgressReviewSlide,
  type ProgressReviewSlideListItem,
  type ProgressReviewSlidesDeck,
} from './components/ProgressReviewSlidesModal';
import ProgressReviewPptxModal from './components/ProgressReviewPptxModal';
import { bulkGenerateProgressReviews, fetchLatestRun } from '@/api/progressReviews';
import { openReviewInstanceForEvent } from '@/api/reviewInstances';
import {
  buildKsbProgress,
  completedComponentIds,
  formatHoursMinutes,
  gradePercent,
} from '@/utils/learnerJourney';

const coachNav = roleNavMap.coach;

type ReviewTab = 'needs-schedule' | 'scheduled' | 'in-progress' | 'awaiting-signature' | 'completed' | 'all';

const FILTER_COPY: Record<ReviewTab, { label: string; description: string }> = {
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
    description: 'All progress reviews due or scheduled in the selected month.',
  },
};

function reviewTabFromQuery(value: string | null): ReviewTab {
  return value && value in FILTER_COPY ? value as ReviewTab : 'all';
}

function pageFromQuery(value: string | null) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

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

function cleanOptionalText(value?: string | number | null) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// Only enrolmentId counts: the slides API keys on the enrolment record, and falling
// back to the profile id would silently resolve to a different learner.
function reviewHasLearnerReference(review: CoachCalendarEvent) {
  return Boolean(cleanOptionalText(review.enrolmentId));
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
    review.enrolmentId,
    review.learnerType,
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

function startOfMonth(value = new Date()) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function monthKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

function monthFromQuery(value: string | null) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return startOfMonth();
  const [year, month] = value.split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return startOfMonth();
  return new Date(year, month - 1, 1);
}

function addMonths(value: Date, offset: number) {
  return new Date(value.getFullYear(), value.getMonth() + offset, 1);
}

function monthLabel(value: Date) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(value);
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

export function buildProgressReviewSlidesDeck(
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

  const learnerName = displayValue(detail.name);
  const programmeName = displayValue(detail.programme || review.programme);
  const employerName = displayValue(detail.employer);
  const managerName = displayValue(detail.lineManager);
  const priorityKsbs = weakestKsbs.length ? weakestKsbs : strongestKsbs.slice(0, 4);
  const activityByMonth = Array.from(recentActivities.reduce((map, activity) => {
    const date = parseLocalDate(activity.at);
    const key = date
      ? new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(date)
      : 'Undated activity';
    const current = map.get(key) || { count: 0, minutes: 0, items: [] as ProgressReviewActivity[] };
    current.count += 1;
    current.minutes += activity.minutes;
    current.items.push(activity);
    map.set(key, current);
    return map;
  }, new Map<string, { count: number; minutes: number; items: ProgressReviewActivity[] }>())).slice(0, 4);
  const actionPlanItems: ProgressReviewSlideListItem[] = [
    {
      title: 'Close evidence admin',
      badge: pendingEvidence ? `${pendingEvidence} pending` : 'Check',
      tone: pendingEvidence ? 'warn' : 'default',
      detail: 'Review pending uploads, confirm naming, and map useful artefacts to the right plan areas.',
      meta: 'Owner: coach and learner',
    },
    {
      title: 'Agree workplace evidence project',
      badge: priorityKsbs.length ? `${priorityKsbs.length} KSBs` : 'Optional',
      tone: priorityKsbs.length ? 'warn' : 'good',
      detail: 'Choose one live workplace project that can evidence planning, delivery, stakeholder input, and impact.',
      meta: 'Owner: learner and manager',
    },
    {
      title: 'Protect learning time',
      badge: displayValue(detail.otjhStatus),
      tone: toneForStatus(detail.otjhStatus),
      detail: 'Confirm the learner has a practical routine for completing activities and recording learning time.',
      meta: window.label,
    },
  ];

  slides.splice(
    2,
    0,
    {
      id: 'closure-next-phase',
      title: 'Closure & Next Phase',
      type: 'lists',
      heading: 'Progress review closure and next learning phase',
      subheading: 'Confirm what is being closed today and what the learner should focus on next.',
      columns: [
        {
          title: 'Position today',
          items: [
            { title: 'Review status', badge: statusLabel(review.status), tone: toneForStatus(review.status), detail: `Current review window: ${window.label}.` },
            { title: 'Programme position', badge: `${ksbCoverage}% KSB`, tone: ksbCoverage >= 70 ? 'good' : ksbCoverage >= 45 ? 'warn' : 'danger', detail: `${recentActivities.length} activities and ${recentEvidence.length} evidence items found.` },
            { title: 'OTJ position', badge: displayValue(detail.otjhStatus), tone: toneForStatus(detail.otjhStatus), detail: displayValue(detail.completedHours) !== '--' ? displayValue(detail.completedHours) : 'Confirm recorded OTJ hours during the review.' },
          ],
        },
        {
          title: 'Next phase prompts',
          items: [
            { title: 'Learning focus', detail: modulesTouched.slice(0, 3).join(' - ') || 'Agree the next released module or learning activity.' },
            { title: 'Evidence focus', detail: priorityKsbs.slice(0, 3).map(item => item.code).join(', ') || 'Confirm the next evidence opportunity.' },
            { title: 'Manager input', detail: 'Confirm the manager can verify contribution and workplace impact.' },
          ],
        },
      ],
    },
    {
      id: 'progress-otj-lms',
      title: 'Progress, OTJ & LMS',
      type: 'metrics',
      heading: 'Programme progress, OTJ and LMS',
      subheading: 'A practical dashboard slide for discussing progress position and admin gaps.',
      metrics: [
        { label: 'KSB coverage', value: `${ksbCoverage}%`, tone: ksbCoverage >= 70 ? 'good' : ksbCoverage >= 45 ? 'warn' : 'danger' },
        { label: 'OTJ status', value: displayValue(detail.otjhStatus), tone: toneForStatus(detail.otjhStatus) },
        { label: 'Recorded time', value: recentMinutes ? formatHoursMinutes(recentMinutes / 60) : '--' },
        { label: 'Active modules', value: String(modulesTouched.length) },
        { label: 'Evidence uploads', value: String(recentEvidence.length) },
        { label: 'Approved evidence', value: String(approvedEvidence), tone: approvedEvidence ? 'good' : 'default' },
        { label: 'Quiz average', value: quizAverage !== null ? `${quizAverage}%` : '--', tone: quizAverage !== null && quizAverage < 70 ? 'warn' : 'good' },
        { label: 'Review status', value: statusLabel(review.status), tone: toneForStatus(review.status) },
      ],
      highlights: actionPlanItems,
    },
    {
      id: 'epa-readiness',
      title: 'EPA Readiness',
      type: 'lists',
      heading: 'EPA readiness and evidence admin',
      subheading: 'Frame portfolio quality, evidence mapping, and next evidence-building decisions.',
      columns: [
        {
          title: 'Current readiness',
          items: [
            { title: 'Portfolio position', badge: approvedEvidence ? 'Evidence present' : 'Needs review', tone: approvedEvidence ? 'good' : 'warn', detail: `${approvedEvidence} approved, ${pendingEvidence} pending, and ${rejectedEvidence} rejected evidence items.` },
            { title: 'Assessment position', badge: quizAverage !== null ? `${quizAverage}%` : 'No quiz data', tone: quizAverage !== null && quizAverage >= 70 ? 'good' : 'warn', detail: recentQuizzes.length ? `${passedQuizzes}/${recentQuizzes.length} recent quizzes passed.` : 'No recent quiz attempts found.' },
            { title: 'KSB position', badge: `${ksbCoverage}%`, tone: ksbCoverage >= 70 ? 'good' : ksbCoverage >= 45 ? 'warn' : 'danger', detail: 'Use priority KSB slides to agree evidence depth and manager verification.' },
          ],
        },
        {
          title: 'Evidence admin',
          items: [
            { title: 'Naming and mapping', detail: 'Confirm files are named clearly and linked to the right module, week, component, or KSB.' },
            { title: 'Manager verification', detail: 'Agree what the manager can verify and whether a witness statement is needed.' },
            { title: 'Reflection quality', detail: 'Check evidence shows context, personal action, outcome, and reflection.' },
          ],
        },
      ],
    },
  );

  slides.splice(
    8,
    0,
    ...activityByMonth.map(([month, summary], index): ProgressReviewSlide => ({
      id: `activity-${index + 1}`,
      title: `${month} Evidence`,
      type: 'lists',
      heading: `${month} workplace evidence`,
      subheading: 'Auto-filled from recent activity. Edit this into a narrative evidence spotlight.',
      columns: [
        {
          title: 'Strongest evidence',
          items: summary.items.slice(0, 5).map(activity => ({
            title: activity.title,
            badge: activity.status,
            tone: toneForStatus(activity.status),
            detail: activity.detail,
            meta: `${activity.module} - ${activity.week}`,
          })),
        },
        {
          title: 'Portfolio value',
          items: [
            { title: 'Activity count', badge: `${summary.count}`, detail: `${summary.count} learning activities were found in ${month}.` },
            { title: 'Recorded time', badge: summary.minutes ? formatHoursMinutes(summary.minutes / 60) : '--', detail: 'Use this only as a discussion aid unless the OTJ record is signed.' },
            { title: 'Evidence prompt', detail: 'Add artefacts, screenshots, outputs, manager comments, and a short reflection.' },
          ],
        },
      ],
    })),
  );

  slides.push(
    {
      id: 'workplace-impact',
      title: 'Workplace Impact',
      type: 'lists',
      heading: `Workplace application and impact at ${employerName}`,
      subheading: 'A structured slide for discussing value delivered through the programme.',
      columns: [
        {
          title: 'Impact themes',
          items: [
            { title: 'Quality and consistency', detail: 'What improved in learner output, process, or professional judgement?' },
            { title: 'Efficiency and ownership', detail: 'Where has the learner taken more ownership or reduced friction for the team?' },
            { title: 'Insight and evaluation', detail: 'What evidence shows the learner using data, feedback, or reflection to improve work?' },
          ],
        },
        {
          title: 'Evidence to retain',
          items: [
            { title: 'Before and after', detail: 'Capture baseline, final output, and what changed because of the learner contribution.' },
            { title: 'Stakeholder voice', detail: 'Capture manager, colleague, customer, or stakeholder feedback where available.' },
            { title: 'Measurable result', detail: 'Add performance data, quality checks, time saved, or decision records.' },
          ],
        },
      ],
    },
    {
      id: 'ksbs-to-strengthen',
      title: 'KSBs To Strengthen',
      type: 'lists',
      heading: 'KSBs to strengthen next',
      subheading: 'These are evidence-building opportunities, not performance concerns.',
      columns: [
        {
          title: 'Priority KSBs',
          items: priorityKsbs.slice(0, 6).map(item => ({
            title: `${item.code} - ${item.description || 'KSB focus area'}`,
            badge: `${item.pct}%`,
            tone: item.pct >= 70 ? 'default' : item.pct >= 45 ? 'warn' : 'danger',
            detail: `${item.doneCount} of ${item.totalCount} linked activities completed.`,
            meta: item.contributors.slice(0, 2).map(contributor => contributor.title).join(' - ') || 'Agree a workplace evidence route.',
          })),
        },
        {
          title: 'Evidence ideas',
          items: [
            { title: 'Live project', detail: 'Use one authentic workplace project with clear objective, owner, deadline, and output.' },
            { title: 'Evidence pack', detail: 'Retain brief, plan, drafts, approvals, screenshots, results, and reflection.' },
            { title: 'Manager verification', detail: 'Ask the manager to verify personal contribution and workplace impact.' },
          ],
        },
      ],
    },
    {
      id: 'next-actions',
      title: 'Next Actions',
      type: 'lists',
      heading: 'Next actions: learning evidence opportunities',
      subheading: 'Agree specific evidence actions, owners, and dates before closing the meeting.',
      columns: [
        { title: 'Action plan', items: actionPlanItems },
        {
          title: 'Decision prompts',
          items: [
            { title: 'Project or activity', detail: 'Which upcoming work can the learner contribute to meaningfully?' },
            { title: 'Evidence owner', detail: 'Who will provide artefacts, manager comments, or verification?' },
            { title: 'Deadline', detail: 'Agree the upload deadline and the next review checkpoint.' },
          ],
        },
      ],
    },
    {
      id: 'smart-targets',
      title: 'SMART Targets',
      type: 'lists',
      heading: 'SMART targets and action plan',
      subheading: 'Turn the review into measurable next steps.',
      columns: [
        {
          title: 'Learning and portfolio',
          items: [
            { title: 'Specific', detail: 'Complete the agreed learning activity or project evidence pack.' },
            { title: 'Measurable', detail: 'Evidence includes outputs, dates, mapped KSBs, and manager verification.' },
            { title: 'Time-bound', detail: 'Set a clear deadline before the next progress review.' },
          ],
        },
        {
          title: 'Success measures',
          items: [
            { title: 'Evidence uploaded', detail: 'Files are named, mapped, and supported by reflection.' },
            { title: 'Manager verified', detail: 'Manager confirms learner contribution and impact.' },
            { title: 'Progress reviewed', detail: 'Coach reviews and updates support plan if needed.' },
          ],
        },
      ],
    },
    {
      id: 'professional-responsibilities',
      title: 'Professional Duties',
      type: 'lists',
      heading: 'Professional responsibilities and EPA brief',
      subheading: 'A closing reminder covering safeguarding, British Values, and EPA evidence quality.',
      columns: [
        {
          title: 'Professional responsibilities',
          items: [
            { title: 'Safeguarding', detail: 'Recognise, respond, report, record, and refer concerns through the correct route.' },
            { title: 'British Values', detail: 'Democracy, rule of law, individual liberty, mutual respect, and tolerance.' },
            { title: 'Ethical practice', detail: 'Keep data, consent, accessibility, inclusion, and approvals in view.' },
          ],
        },
        {
          title: 'EPA evidence quality',
          items: [
            { title: 'Context', detail: 'Explain the workplace situation and learner responsibility.' },
            { title: 'Action and outcome', detail: 'Show what the learner did and what changed as a result.' },
            { title: 'Reflection', detail: 'Capture what the learner learned and what they would improve.' },
          ],
        },
      ],
    },
    {
      id: 'manager-questions',
      title: 'Manager Questions',
      type: 'lists',
      heading: 'Manager questions: workplace impact check',
      subheading: `Questions for ${managerName !== '--' ? managerName : 'the learner manager'} to confirm impact, support, and evidence.`,
      columns: [
        {
          title: 'Questions',
          items: [
            'What improvements have you seen in confidence, independence, or professional judgement?',
            'Which workplace examples best show applied learning rather than routine activity?',
            'Which upcoming project can create strong evidence for the priority KSBs?',
            'What evidence can you verify for portfolio and EPA readiness?',
            'Are there any concerns, barriers, or support needs to address before the next review?',
          ].map((question, index) => ({ title: `${index + 1}. ${question}`, detail: 'Coach to capture notes during the review.' })),
        },
        {
          title: 'Manager notes',
          items: [
            { title: 'Impact observed', detail: 'Add notes here.' },
            { title: 'Support agreed', detail: 'Add notes here.' },
            { title: 'Evidence project', detail: 'Project / role / evidence to upload / review date.' },
          ],
        },
      ],
    },
  );

  while (slides.length < 18) {
    slides.splice(slides.length - 5, 0, {
      id: `evidence-planning-${slides.length}`,
      title: 'Evidence Planning',
      type: 'lists',
      heading: `${learnerName} evidence planning`,
      subheading: `Editable planning slide for ${programmeName}.`,
      columns: [
        {
          title: 'Evidence opportunity',
          items: [
            { title: 'Workplace task', detail: 'Describe the live work, learner responsibility, and intended outcome.' },
            { title: 'KSB mapping', detail: priorityKsbs.slice(0, 4).map(item => item.code).join(', ') || 'Add target KSBs.' },
            { title: 'Verification', detail: `Manager: ${managerName}. Add witness notes and sign-off route.` },
          ],
        },
      ],
    });
  }

  if (slides.length > 18) slides.splice(18);

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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<ReviewTab>(() => reviewTabFromQuery(searchParams.get('filter')));
  const [currentPage, setCurrentPage] = useState(() => pageFromQuery(searchParams.get('page')));
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('q') || '');
  const [selectedMonth, setSelectedMonth] = useState(() => monthFromQuery(searchParams.get('month')));
  const [events, setEvents] = useState<CoachCalendarEvent[]>([]);
  const [ownerName, setOwnerName] = useState('Coach');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(EMPTY_SCHEDULE_FORM);
  const [scheduleModalEvent, setScheduleModalEvent] = useState<CoachCalendarEvent | null>(null);
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [completionEvent, setCompletionEvent] = useState<CoachCalendarEvent | null>(null);
  const [pptxModalReview, setPptxModalReview] = useState<CoachCalendarEvent | null>(null);
  const [generatedReviewKeys, setGeneratedReviewKeys] = useState<Set<string>>(new Set());
  const [bulkGenerating, setBulkGenerating] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (monthKey(selectedMonth) === monthKey(startOfMonth())) {
      params.delete('month');
    } else {
      params.set('month', monthKey(selectedMonth));
    }
    setSearchParams(params, { replace: true });
    // Only the selected month belongs to this sync. Other page state is local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, setSearchParams]);

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

  const selectedMonthLabel = monthLabel(selectedMonth);
  const selectedMonthIsCurrent = monthKey(selectedMonth) === monthKey(startOfMonth());
  const monthTabDescription = `Progress reviews due or scheduled in ${selectedMonthLabel}.`;
  const selectedMonthEvents = events.filter(event => isEventInMonth(event, selectedMonth));
  const scheduledEvents = selectedMonthEvents.filter(event => isScheduledEvent(event));
  const inProgressEvents = selectedMonthEvents.filter(event => isInProgressEvent(event));
  const awaitingSignatureEvents = selectedMonthEvents.filter(event => isAwaitingSignatureEvent(event));
  const completedEvents = selectedMonthEvents.filter(event => isCompletedEvent(event));
  const needsScheduleEvents = selectedMonthEvents.filter(needsScheduling);
  const pendingSchedule = needsScheduleEvents.length;
  const data = tab === 'needs-schedule'
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
                    ? selectedMonthEvents
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

  const visibleReviewsKey = paginatedReviews
    .filter((review) => reviewHasLearnerReference(review) && eventTargetDate(review))
    .map((review) => `${eventIdentity(review)}:${eventTargetDate(review)}`)
    .join('|');

  useEffect(() => {
    if (!visibleReviewsKey) return;
    let cancelled = false;
    const candidates = paginatedReviews.filter((review) => !isImportedReviewEvent(review) && reviewHasLearnerReference(review) && eventTargetDate(review));

    Promise.all(candidates.map(async (review) => {
      const learnerId = review.enrolmentId || '';
      try {
        const result = await fetchLatestRun(learnerId, eventTargetDate(review));
        return result.exists && result.generationStatus === 'completed' ? eventIdentity(review) : null;
      } catch {
        return null;
      }
    })).then((keys) => {
      if (cancelled) return;
      const found = keys.filter((key): key is string => Boolean(key));
      if (!found.length) return;
      setGeneratedReviewKeys((prev) => {
        const next = new Set(prev);
        found.forEach((key) => next.add(key));
        return next;
      });
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleReviewsKey]);

  const changeTab = (nextTab: ReviewTab) => {
    setTab(nextTab);
    setCurrentPage(1);
  };

  const changeMonth = (nextMonth: Date) => {
    setSelectedMonth(startOfMonth(nextMonth));
    setTab('all');
    setCurrentPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const updateEvent = (updatedEvent: CoachCalendarEvent) => {
    setEvents(prevEvents => sortEvents(prevEvents.map(event => (
      eventIdentity(event) === eventIdentity(updatedEvent) ? updatedEvent : event
    ))));
    setScheduleForm(scheduleDefaults(updatedEvent));
  };

  const openScheduleModal = (event: CoachCalendarEvent) => {
    setScheduleForm(scheduleDefaults(event));
    setActionError(null);
    setActionNotice(event.syncWarning || null);
    setSchedulePickerOpen(false);
    setScheduleModalEvent(event);
  };

  const schedulableReviews = selectedMonthEvents.filter(event => !['in-progress', 'completed', 'awaiting-signature'].includes(event.status));

  const openSchedulePicker = () => {
    const preferred = schedulableReviews.find(needsScheduling) || schedulableReviews[0];
    if (!preferred) return;
    setScheduleForm(scheduleDefaults(preferred));
    setActionError(null);
    setActionNotice(preferred.syncWarning || null);
    setSchedulePickerOpen(true);
    setScheduleModalEvent(preferred);
  };

  const selectScheduleReview = (eventKey: string) => {
    const selected = schedulableReviews.find(event => eventIdentity(event) === eventKey);
    if (!selected) return;
    setScheduleForm(scheduleDefaults(selected));
    setActionError(null);
    setActionNotice(selected.syncWarning || null);
    setScheduleModalEvent(selected);
  };

  const listUrl = () => {
    const query = new URLSearchParams();
    if (tab !== 'all') query.set('filter', tab);
    if (searchTerm.trim()) query.set('q', searchTerm.trim());
    if (!selectedMonthIsCurrent) query.set('month', monthKey(selectedMonth));
    if (activePage > 1) query.set('page', String(activePage));
    const queryString = query.toString();
    return `/coach/progress-reviews${queryString ? `?${queryString}` : ''}`;
  };

  const openDetails = (event: CoachCalendarEvent) => {
    if (isImportedReviewEvent(event)) {
      const params = new URLSearchParams({ tab: 'reviews' });
      if (event.learnerId) params.set('id', event.learnerId);
      if (event.learnerType) params.set('kind', event.learnerType);
      if (event.enrolmentId) params.set('enrolmentId', event.enrolmentId);
      navigate(`/coach/learner-case-file?${params.toString()}`, { state: { learnerId: event.learnerId, learnerName: event.learner, kind: event.learnerType, enrolmentId: event.enrolmentId, tab: 'reviews' } });
      return;
    }
    navigate(`/coach/progress-reviews/${encodeURIComponent(eventIdentity(event))}`, { state: { returnTo: listUrl() } });
  };

  const handleSchedule = async (event: CoachCalendarEvent) => {
    setBusyEventId(eventIdentity(event));
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await scheduleCoachCalendarEvent(event, scheduleForm);
      updateEvent(data.event);
      setScheduleModalEvent(null);
      if (data.warning) setActionNotice(data.warning);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to schedule review.');
    } finally {
      setBusyEventId(null);
    }
  };

  const handleJoin = (event: CoachCalendarEvent) => {
    const url = meetingUrl(event);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openCompletionForm = async (event: CoachCalendarEvent) => {
    setActionError(null);
    if (event.reviewTemplateId) {
      setBusyEventId(eventIdentity(event));
      try {
        const instanceId = event.reviewInstanceId || (await openReviewInstanceForEvent(eventIdentity(event))).instanceId;
        const query = searchParams.toString();
        navigate(reviewInstancePath(instanceId), {
          state: reviewInstanceRouteState(
            event,
            `/coach/progress-reviews${query ? `?${query}` : ''}`,
          ),
        });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Unable to open this review form.');
      } finally {
        setBusyEventId(null);
      }
      return;
    }
    setCompletionEvent(event);
  };

  const handleCreateSlides = (event: CoachCalendarEvent) => {
    if (!reviewHasLearnerReference(event) || !eventTargetDate(event)) {
      setActionError('This review is missing its learner id or review date, so slides cannot be generated yet.');
      setActionNotice(null);
      return;
    }
    setActionError(null);
    setActionNotice(null);
    setPptxModalReview(event);
  };

  const markReviewSlidesGenerated = (event: CoachCalendarEvent) => {
    setGeneratedReviewKeys((prev) => {
      const next = new Set(prev);
      next.add(eventIdentity(event));
      return next;
    });
  };

  const handleBulkGenerateSlides = async () => {
    const count = events.filter((event) => !isImportedReviewEvent(event) && reviewHasLearnerReference(event) && eventTargetDate(event)).length;
    if (!count) return;
    if (!window.confirm(`Generate Progress Review PPTX decks for ${count} review(s) with a learner and review date? This may take a while.`)) return;
    setBulkGenerating(true);
    try {
      const data = await bulkGenerateProgressReviews({});
      const failed = data.results.filter((row) => row.generationStatus === 'failed').length;
      if (failed) {
        setActionError(`Bulk generation finished with ${failed} of ${data.results.length} failure(s).`);
      } else {
        setActionNotice(`Bulk generation complete — ${data.results.length} deck(s) generated.`);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to run bulk generation.');
    } finally {
      setBulkGenerating(false);
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
    { value: 'all', label: FILTER_COPY.all.label, count: selectedMonthEvents.length },
    { value: 'needs-schedule', label: FILTER_COPY['needs-schedule'].label, count: pendingSchedule, tone: 'caution' },
    { value: 'scheduled', label: FILTER_COPY.scheduled.label, count: scheduledEvents.length, tone: 'info' },
    { value: 'in-progress', label: FILTER_COPY['in-progress'].label, count: inProgressEvents.length, tone: 'info' },
    { value: 'awaiting-signature', label: FILTER_COPY['awaiting-signature'].label, count: awaitingSignatureEvents.length, tone: 'upcoming' },
    { value: 'completed', label: FILTER_COPY.completed.label, count: completedEvents.length, tone: 'positive' },
  ];

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Progress Reviews" pageSubtitle="Manage learner progress reviews and sign-offs" userName={ownerName} userRole="Progress Coach">
      <PageContainer>
        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-[13px] text-red-700">
            {error}
          </div>
        ) : null}

        <Panel padding="none">
          <div className="border-b border-foreground-100 px-4 py-5 md:px-5">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-2" aria-label="Review month">
                  <button type="button" onClick={() => changeMonth(addMonths(selectedMonth, -1))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary-100 bg-white text-primary-700 shadow-sm transition hover:bg-primary-50" aria-label="Previous month"><AppIcon className="ri-arrow-left-s-line text-lg" /></button>
                  <span className="min-w-36 text-center text-[14px] font-bold text-primary-900">{selectedMonthLabel}</span>
                  <button type="button" onClick={() => changeMonth(addMonths(selectedMonth, 1))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary-100 bg-white text-primary-700 shadow-sm transition hover:bg-primary-50" aria-label="Next month"><AppIcon className="ri-arrow-right-s-line text-lg" /></button>
                </div>
                {!selectedMonthIsCurrent ? <button type="button" onClick={() => changeMonth(startOfMonth())} className="h-9 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[12px] font-semibold text-primary-700 transition hover:bg-primary-100">Today</button> : null}
              </div>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
                <div className="w-full sm:w-56"><SearchInput value={searchTerm} onChange={handleSearchChange} placeholder="Search learner name..." ariaLabel="Search progress reviews by learner" /></div>
                <button type="button" onClick={handleBulkGenerateSlides} disabled={bulkGenerating} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-primary-100 bg-white px-3 text-[12px] font-semibold text-primary-700 shadow-sm transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"><AppIcon className={bulkGenerating ? 'ri-loader-4-line animate-spin' : 'ri-stack-line'} />{bulkGenerating ? 'Generating slides...' : 'Bulk generate slides'}</button>
                <button type="button" onClick={openSchedulePicker} disabled={schedulableReviews.length === 0} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-700 px-4 text-[12px] font-bold text-white shadow-sm transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60"><AppIcon className="ri-add-line text-lg" />Schedule review</button>
              </div>
            </div>
            <div className="mt-5 border-t border-foreground-100 pt-4">
              <PageTabs items={tabItems} value={tab} onChange={(next) => changeTab(next as ReviewTab)} label="Filter progress reviews by status" />
            </div>
          </div>

          <div className="bg-background-100/55 p-3 sm:p-5">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-[16px] font-bold text-primary-900">{filteredData.length} progress review{filteredData.length === 1 ? '' : 's'}</h3>
                <p className="text-[12px] text-foreground-500">{tab === 'all' ? monthTabDescription : FILTER_COPY[tab].description}</p>
              </div>
              {normalizedSearchTerm ? <span className="text-[12px] font-semibold text-primary-700">Showing {filteredData.length} of {data.length}</span> : null}
            </div>
            {loading ? <RowsSkeleton rows={6} /> : null}
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

            {!loading && filteredData.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-primary-100 bg-white shadow-sm">
                <table className="w-full min-w-[1120px] border-collapse text-left">
                  <caption className="sr-only">Progress reviews for {selectedMonthLabel}</caption>
                  <thead>
                    <tr className="bg-primary-50/70 text-[11px] font-bold uppercase tracking-wide text-primary-800">
                      <th className="whitespace-nowrap px-4 py-3 align-middle">Learner</th>
                      <th className="whitespace-nowrap px-4 py-3 align-middle">Programme</th>
                      <th className="whitespace-nowrap px-4 py-3 align-middle">Date &amp; time</th>
                      <th className="whitespace-nowrap px-4 py-3 text-center align-middle">Status</th>
                      <th className="whitespace-nowrap px-4 py-3 align-middle">Schedule</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right align-middle">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedReviews.map(review => {
                      const reviewKey = eventIdentity(review);
                      const imported = isImportedReviewEvent(review);
                      const isBusy = busyEventId === reviewKey;
                      const hasSlides = generatedReviewKeys.has(reviewKey);
                      const joinAvailable = canJoinMeeting(review);
                      const viewOnly = imported || review.status === 'completed' || review.status === 'awaiting-signature';
                      const canSchedule = !['in-progress', 'completed', 'awaiting-signature'].includes(review.status);
                      return (
                        <tr key={reviewKey} className="ui-action-row border-t border-primary-100/70 transition hover:bg-primary-50/35" onClick={() => openDetails(review)}>
                          <td className="px-4 py-3 align-middle">
                            <div className="flex items-center gap-3">
                              <LearnerAvatar name={review.learner} tone={isAtRiskProgressReview(review) ? 'critical' : statusTone(review.status)} />
                              <div className="min-w-0">
                                <strong className="block text-[13px] font-bold text-primary-900">{review.learner || 'Unknown learner'}</strong>
                                <span className="block text-[11px] text-foreground-500">{review.email || 'Progress review'}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 align-middle text-[12px] text-foreground-700"><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><AppIcon className="ri-book-open-line text-primary-500" />{review.programme || '--'}</span></td>
                          <td className="whitespace-nowrap px-4 py-3 align-middle text-[12px] text-foreground-700"><span className="inline-flex min-w-[150px] flex-col gap-1"><span className="flex items-center gap-1.5 whitespace-nowrap"><AppIcon className="ri-calendar-line shrink-0 text-primary-500" />{formatDateLabel(eventDisplayDate(review))}</span><span className="flex items-center gap-1.5 whitespace-nowrap text-foreground-500"><AppIcon className="ri-time-line shrink-0 text-primary-500" />{formatTimeLabel(review)}</span></span></td>
                          <td className="px-4 py-3 text-center align-middle"><div className="flex flex-wrap justify-center gap-1.5"><StatusBadge tone={statusTone(review.status)} label={statusLabel(review.status)} size="sm" />{isAtRiskProgressReview(review) ? <StatusBadge tone="critical" label="Overdue" dot={false} size="sm" /> : null}{isDueSoonEvent(review) ? <StatusBadge tone="upcoming" label="Due Soon" dot={false} size="sm" /> : null}</div></td>
                          <td className="px-4 py-3 align-middle" onClick={(clickEvent) => clickEvent.stopPropagation()}>{canSchedule ? <button type="button" onClick={() => openScheduleModal(review)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary-100 bg-white px-3 text-[12px] font-semibold text-primary-700 shadow-sm transition hover:bg-primary-50"><AppIcon className="ri-calendar-schedule-line" />{hasScheduledSlot(review) ? 'Reschedule' : 'Schedule'}</button> : null}</td>
                          <td className="min-w-[320px] px-4 py-3 align-middle" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                            <div className="flex justify-end gap-1.5">
                              {!viewOnly && (review.status === 'scheduled' || review.status === 'in-progress') ? <button type="button" onClick={() => { void openCompletionForm(review); }} disabled={isBusy} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary-100 bg-white px-3 text-[12px] font-semibold text-primary-700 shadow-sm transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"><AppIcon className="ri-file-edit-line" />Form</button> : null}
                              {!viewOnly ? <button type="button" onClick={() => { handleCreateSlides(review); }} disabled={!reviewHasLearnerReference(review)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary-100 bg-white px-3 text-[12px] font-semibold text-primary-700 shadow-sm transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"><AppIcon className={hasSlides ? 'ri-slideshow-2-line' : 'ri-file-ppt-line'} />{hasSlides ? 'View Slides' : 'Create Slides'}</button> : null}
                              <button type="button" onClick={() => openDetails(review)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary-100 bg-white px-3 text-[12px] font-semibold text-primary-700 shadow-sm transition hover:bg-primary-50"><AppIcon className="ri-eye-line" />View</button>
                              {!viewOnly && joinAvailable ? <button type="button" onClick={() => { handleJoin(review); }} disabled={isBusy} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[12px] font-semibold text-primary-700 shadow-sm transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"><AppIcon className="ri-video-on-line" />Join</button> : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            {!loading && pageCount > 1 ? (
              <div className="mt-4 xl:col-span-2">
                <Pagination
                  page={activePage}
                  totalPages={pageCount}
                  total={filteredData.length}
                  pageSize={REVIEWS_PER_PAGE}
                  onPageChange={(page) => {
                    setCurrentPage(page);
                  }}
                  noun="reviews"
                />
              </div>
            ) : null}
          </div>
        </Panel>

        {scheduleModalEvent ? (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={() => { if (!busyEventId) setScheduleModalEvent(null); }}>
            <div role="dialog" aria-modal="true" aria-labelledby="schedule-review-title" className="w-full max-w-[620px] rounded-2xl border border-foreground-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-start justify-between border-b border-foreground-100 px-5 py-4">
                <div><p className="text-[11px] font-semibold uppercase tracking-wide text-primary-600">Microsoft Teams booking</p><h2 id="schedule-review-title" className="mt-1 text-[20px] font-bold text-foreground-900">{scheduleModalEvent.status === 'scheduled' ? 'Reschedule progress review' : 'Schedule progress review'}</h2><p className="mt-1 text-[12px] text-foreground-500">Choose the meeting details. The Teams booking will be updated after saving.</p></div>
                <button type="button" aria-label="Close schedule review" disabled={Boolean(busyEventId)} onClick={() => setScheduleModalEvent(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-400 hover:bg-foreground-50"><AppIcon className="ri-close-line text-lg" /></button>
              </div>
              <div className="space-y-4 px-5 py-5">
                {schedulePickerOpen ? <label className="block text-[12px] font-semibold text-foreground-700">Learner<select value={eventIdentity(scheduleModalEvent)} onChange={(event) => selectScheduleReview(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-foreground-200 bg-white px-3 text-[13px] font-medium text-foreground-800 outline-none focus:border-primary-400">{schedulableReviews.map(review => <option key={eventIdentity(review)} value={eventIdentity(review)}>{review.learner || 'Unknown learner'}{review.programme ? ` · ${review.programme}` : ''}</option>)}</select></label> : null}
                <div className="rounded-lg border border-primary-100 bg-primary-50/60 px-3 py-2 text-[12px] text-primary-900"><span className="font-semibold">Learner:</span> {scheduleModalEvent.learner || 'Unknown learner'}<span className="mx-2 text-primary-300">•</span><span>{scheduleModalEvent.programme || 'Progress review'}</span></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div><ScheduleFieldLabel>Date</ScheduleFieldLabel><ModernDatePicker value={scheduleForm.date} onChange={(value) => setScheduleForm(prev => ({ ...prev, date: value }))} /></div>
                  <div><ScheduleFieldLabel>Time</ScheduleFieldLabel><ScheduleTimeInput value={scheduleForm.time} onChange={(value) => setScheduleForm(prev => ({ ...prev, time: value }))} /></div>
                  <div><ScheduleFieldLabel>Duration</ScheduleFieldLabel><ModernDurationPicker value={scheduleForm.durationMinutes} onChange={(durationMinutes) => setScheduleForm(prev => ({ ...prev, durationMinutes }))} /></div>
                </div>
                {(actionError || actionNotice) ? <div className={cn('rounded-lg border px-3 py-2 text-[12px]', actionError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800')}>{actionError || actionNotice}</div> : null}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-foreground-100 px-5 py-4">
                <button type="button" disabled={Boolean(busyEventId)} onClick={() => setScheduleModalEvent(null)} className="h-10 rounded-lg border border-foreground-200 px-4 text-[12px] font-semibold text-foreground-700 hover:bg-foreground-50">Cancel</button>
                <button type="button" disabled={Boolean(busyEventId) || !scheduleForm.date || !scheduleForm.time} onClick={() => { void handleSchedule(scheduleModalEvent); }} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-700 px-4 text-[12px] font-bold text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60"><AppIcon className={busyEventId ? 'ri-loader-4-line animate-spin' : 'ri-calendar-check-line'} />{busyEventId ? 'Saving...' : scheduleModalEvent.status === 'scheduled' ? 'Save new time' : 'Schedule review'}</button>
              </div>
            </div>
          </div>
        ) : null}

        {completionEvent && !completionEvent.reviewInstanceId ? (
          // Legacy path for an occurrence scheduled before this migration.
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
        <ProgressReviewPptxModal
          open={Boolean(pptxModalReview)}
          review={pptxModalReview}
          onClose={() => setPptxModalReview(null)}
          onGenerated={markReviewSlidesGenerated}
        />
      </PageContainer>
    </WorkspaceShell>
  );
}
