import { useEffect, useState } from 'react';
import { fetchEvidence, type EvidenceRecord } from '@/api/evidence';
import { fetchLearnerDetail, type LearnerDetail, type LearnerKind, type LearnerQuizAttempt } from '@/api/learnerDetail';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { roleNavMap } from '@/mocks/navigation';
import { CardSkeleton } from '@/components/feature/Skeletons';
import {
  PROGRESS_REVIEW_SECTIONS,
  REQUIRED_PROGRESS_REVIEW_RESPONSE_IDS,
  type ProgressReviewResponses,
} from '@/pages/shared/progressReviewForm';
import {
  type CalendarAction,
  type CoachCalendarEvent,
  type ScheduleFormState,
  avatarClass,
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
  initialsFor,
  isCompletedEvent,
  meetingUrl,
  needsScheduling,
  parseLocalDate,
  runCoachCalendarAction,
  scheduleCoachCalendarEvent,
  scheduleDefaults,
  sortEvents,
  statusLabel,
  statusPillClass,
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

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Progress Reviews" pageSubtitle="Manage learner progress reviews and sign-offs" userName={ownerName} userRole="Progress Coach">
      <div className="min-h-screen w-full space-y-4 bg-[#f7f6fb] p-3 md:p-5">
        <section
          className="rounded-2xl border border-white/10 px-6 py-6 text-white shadow-[0_14px_32px_rgba(20,4,46,0.16)]"
          style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] text-white/55">
                <span>Coach Workspace</span>
                <AppIcon className="ri-arrow-right-s-line"></AppIcon>
                <span className="font-semibold text-white">Progress Reviews</span>
              </div>
              <h1 className="text-2xl font-heading font-bold tracking-[-0.02em] text-white">Progress Reviews</h1>
              <p className="mt-1 max-w-xl text-[12px] leading-5 text-white/70">
                Schedule, run and complete learner progress reviews for {ownerName}'s active learners.
              </p>
            </div>
            <button
              type="button"
              onClick={() => changeTab(overdue > 0 ? 'overdue' : 'this-month')}
              className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl border border-white/15 bg-white px-4 text-[11px] font-semibold text-primary-800 shadow-sm transition hover:bg-primary-50 lg:self-center"
            >
              <AppIcon className={overdue > 0 ? 'ri-alarm-warning-line text-red-600' : 'ri-checkbox-circle-line text-emerald-600'}></AppIcon>
              {overdue > 0
                ? `${overdue} overdue review${overdue === 1 ? '' : 's'}`
                : 'Everything is on track'}
            </button>
          </div>
        </section>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="overflow-hidden rounded-3xl border border-background-200 bg-background-50 shadow-[0_12px_40px_-30px_oklch(var(--foreground-950)/0.35)]">
          <div className="border-b border-background-200 px-4 pt-5 sm:px-6">
            <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h3 className="text-base font-bold text-foreground-900">{FILTER_COPY[tab].label} reviews</h3>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-foreground-400">{FILTER_COPY[tab].description}</p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center xl:w-auto">
                <label className="relative block w-full sm:w-[320px]">
                  <span className="sr-only">Search progress reviews by learner name</span>
                  <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></AppIcon>
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(event) => handleSearchChange(event.target.value)}
                    placeholder="Search learner name..."
                    className="h-10 w-full rounded-xl border border-background-200 bg-white pl-9 pr-9 text-xs font-medium text-foreground-900 shadow-sm outline-none transition focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => handleSearchChange('')}
                      className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-foreground-400 transition hover:bg-background-100 hover:text-foreground-700"
                      aria-label="Clear learner search"
                    >
                      <AppIcon className="ri-close-line"></AppIcon>
                    </button>
                  )}
                </label>
                <span className="w-fit whitespace-nowrap rounded-full bg-primary-50 px-3 py-1 text-[11px] font-bold text-primary-700">
                  {normalizedSearchTerm ? `${filteredData.length} of ${data.length}` : data.length} {filteredData.length === 1 ? 'review' : 'reviews'}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pb-4">
              <TabButton active={tab === 'this-month'} onClick={() => changeTab('this-month')} label={FILTER_COPY['this-month'].label} count={thisMonth} description={FILTER_COPY['this-month'].description} />
              <TabButton active={tab === 'overdue'} onClick={() => changeTab('overdue')} label={FILTER_COPY.overdue.label} count={overdue} description={FILTER_COPY.overdue.description} />
              <TabButton active={tab === 'due-soon'} onClick={() => changeTab('due-soon')} label={FILTER_COPY['due-soon'].label} count={dueSoon} description={FILTER_COPY['due-soon'].description} />
              <TabButton active={tab === 'needs-schedule'} onClick={() => changeTab('needs-schedule')} label={FILTER_COPY['needs-schedule'].label} count={pendingSchedule} description={FILTER_COPY['needs-schedule'].description} />
              <TabButton active={tab === 'scheduled'} onClick={() => changeTab('scheduled')} label={FILTER_COPY.scheduled.label} count={scheduledEvents.length} description={FILTER_COPY.scheduled.description} />
              <TabButton active={tab === 'in-progress'} onClick={() => changeTab('in-progress')} label={FILTER_COPY['in-progress'].label} count={inProgressEvents.length} description={FILTER_COPY['in-progress'].description} />
              <TabButton active={tab === 'awaiting-signature'} onClick={() => changeTab('awaiting-signature')} label={FILTER_COPY['awaiting-signature'].label} count={awaitingSignatureEvents.length} description={FILTER_COPY['awaiting-signature'].description} />
              <TabButton active={tab === 'completed'} onClick={() => changeTab('completed')} label={FILTER_COPY.completed.label} count={completedEvents.length} description={FILTER_COPY.completed.description} />
              <TabButton active={tab === 'all'} onClick={() => changeTab('all')} label={FILTER_COPY.all.label} count={events.length} description={FILTER_COPY.all.description} />
            </div>
          </div>

          <div className="grid gap-3 bg-background-100/55 p-3 sm:p-5 xl:grid-cols-2">
            {loading && Array.from({ length: 4 }).map((_, index) => <CardSkeleton key={index} />)}
            {!loading && !error && data.length === 0 && <div className="xl:col-span-2"><EmptyState icon="ri-file-chart-line" title="No progress reviews found." /></div>}
            {!loading && !error && data.length > 0 && filteredData.length === 0 && <div className="xl:col-span-2"><EmptyState icon="ri-user-search-line" title="No learner matches this search." /></div>}

            {!loading && paginatedReviews.map(review => {
              const isOpen = expanded === eventIdentity(review);
              const isBusy = busyEventId === eventIdentity(review);
              const isSlidesBusy = slidesBusyEventId === eventIdentity(review);
              const joinAvailable = canJoinMeeting(review);
              return (
                <article key={eventIdentity(review)} className={`group overflow-hidden rounded-2xl border bg-background-50 transition-all duration-200 ${isOpen ? 'border-primary-300 shadow-[0_12px_32px_-22px_oklch(var(--primary-700)/0.5)] xl:col-span-2' : 'border-background-200 hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-sm'}`}>
                  <div className="flex cursor-pointer items-center gap-3 p-4 sm:gap-4 sm:p-5" onClick={() => toggleExpanded(review)}>
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-background-50 ${avatarClass(review)}`}>
                      <span className="text-sm font-bold">{initialsFor(review.learner)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-bold text-foreground-900">{review.learner || 'Unknown learner'}</p>
                        <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold ${statusPillClass(review.status)}`}>{statusLabel(review.status)}</span>
                        {isAtRiskProgressReview(review) && <span className="rounded-full bg-red-50 px-2.5 py-1 text-[9px] font-bold text-red-700">Overdue</span>}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-400">
                        <span><AppIcon className="ri-book-open-line mr-1 text-primary-500"></AppIcon>{review.programme || '--'}</span>
                        <span><AppIcon className="ri-calendar-line mr-1 text-primary-500"></AppIcon>{formatDateLabel(eventDisplayDate(review))}</span>
                        <span><AppIcon className="ri-time-line mr-1 text-primary-500"></AppIcon>{formatTimeLabel(review)}</span>
                      </div>
                    </div>
                    <div className="hidden shrink-0 items-center gap-2 md:flex">
                      {joinAvailable && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleJoin(review); }} disabled={isBusy} className="cursor-pointer whitespace-nowrap rounded-xl bg-primary-600 px-4 py-2.5 text-[11px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-700 disabled:opacity-60">
                          <AppIcon className="ri-video-on-line mr-1.5"></AppIcon>Join Meeting
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleCreateSlides(review); }}
                        disabled={isSlidesBusy || !review.learnerId}
                        title={!review.learnerId ? 'Learner id missing for this review' : 'Generate a 12-week slide deck for this learner'}
                        className="cursor-pointer whitespace-nowrap rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] font-bold text-amber-800 shadow-sm transition-smooth hover:border-amber-300 hover:bg-amber-100 hover:text-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <AppIcon className={`${isSlidesBusy ? 'ri-loader-4-line animate-spin' : 'ri-slideshow-line'} mr-1.5`}></AppIcon>
                        {isSlidesBusy ? 'Creating slides' : 'Create slides'}
                      </button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); toggleExpanded(review); }} className="cursor-pointer whitespace-nowrap rounded-xl border border-primary-600 bg-primary-600 px-4 py-2.5 text-[11px] font-bold text-white shadow-sm transition-smooth hover:border-primary-700 hover:bg-primary-700">
                        {needsScheduling(review) ? 'Schedule' : 'Manage'}
                      </button>
                    </div>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background-100 text-foreground-400 transition-transform ${isOpen ? 'rotate-180 bg-primary-50 text-primary-600' : ''}`}>
                      <AppIcon className="ri-arrow-down-s-line"></AppIcon>
                    </span>
                  </div>

                  {isOpen && (
                    <div className="space-y-4 border-t border-background-200 bg-white/60 p-4 sm:p-5 sm:pl-[9.25rem]" onClick={(e) => e.stopPropagation()}>
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <InfoBox label="Programme" value={review.programme || '--'} />
                        <InfoBox label="Target date" value={formatDateLabel(review.targetDate)} />
                        <InfoBox label="Scheduled date" value={review.scheduledDate ? formatDateLabel(review.scheduledDate) : '--'} />
                        <InfoBox label="Status" value={statusLabel(review.status)} />
                        {isAtRiskProgressReview(review) && <InfoBox label="Risk" value="Target date passed and not scheduled" />}
                      </div>
                      {review.notes && (
                        <div className="bg-background-100/60 rounded-lg p-3">
                          <p className="text-[11px] font-semibold text-foreground-700 mb-1">Coach Notes</p>
                          <p className="text-[12px] text-foreground-600">{review.notes}</p>
                        </div>
                      )}
                      {(actionError || actionNotice) && (
                        <div className={`rounded-lg border px-3 py-2 text-[11px] ${actionError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                          {actionError || actionNotice}
                        </div>
                      )}
                      {!['completed', 'awaiting-signature'].includes(review.status) && (
                        <div className="rounded-xl border border-background-200/60 bg-background-100/60 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500 mb-3">Schedule Review</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <ScheduleInput label="Date" type="date" value={scheduleForm.date} onChange={(value) => setScheduleForm(prev => ({ ...prev, date: value }))} />
                            <ScheduleInput label="Time" type="time" value={scheduleForm.time} onChange={(value) => setScheduleForm(prev => ({ ...prev, time: value }))} />
                            <label className="block">
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Duration</span>
                              <select value={scheduleForm.durationMinutes} onChange={(e) => setScheduleForm(prev => ({ ...prev, durationMinutes: Number(e.target.value) }))} className="w-full rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[11px] text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-300">
                                {[30, 45, 60, 90].map(minutes => <option key={minutes} value={minutes}>{minutes} min</option>)}
                              </select>
                            </label>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-3">
                            {joinAvailable && (
                              <button type="button" onClick={() => handleJoin(review)} disabled={isBusy} className="whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">
                                <AppIcon className="ri-video-on-line mr-1"></AppIcon>Join Meeting
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => { void handleCreateSlides(review); }}
                              disabled={isSlidesBusy || !review.learnerId}
                              title={!review.learnerId ? 'Learner id missing for this review' : 'Generate a 12-week slide deck for this learner'}
                              className="whitespace-nowrap rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800 shadow-sm transition hover:border-amber-300 hover:bg-amber-100 hover:text-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <AppIcon className={`${isSlidesBusy ? 'ri-loader-4-line animate-spin' : 'ri-slideshow-line'} mr-1`}></AppIcon>
                              {isSlidesBusy ? 'Creating slides' : 'Create slides'}
                            </button>
                            <button type="button" onClick={() => handleSchedule(review)} disabled={isBusy} className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap">
                              <AppIcon className="ri-calendar-check-line mr-1"></AppIcon>{review.status === 'scheduled' || review.status === 'in-progress' ? 'Reschedule' : 'Schedule'}
                            </button>
                            {review.status === 'in-progress' && (
                              <button type="button" onClick={() => openCompletionForm(review)} disabled={isBusy} className="px-3 py-2 bg-secondary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-secondary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap">
                                <AppIcon className="ri-send-plane-line mr-1"></AppIcon>Submit Review
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      {review.status === 'awaiting-signature' && (
                        <div className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 sm:flex-row sm:items-center">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                            <AppIcon className="ri-pen-nib-line"></AppIcon>
                          </span>
                          <div className="flex-1">
                            <p className="text-xs font-bold text-violet-900">Waiting for line manager signature</p>
                            <p className="mt-1 text-[11px] text-violet-700">The coach review is saved. Confirm the manager signature to finish this review.</p>
                          </div>
                          <button type="button" onClick={() => handleAction(review, 'sign')} disabled={isBusy} className="whitespace-nowrap rounded-xl bg-violet-700 px-4 py-2.5 text-[11px] font-bold text-white transition hover:bg-violet-800 disabled:opacity-60">
                            <AppIcon className="ri-quill-pen-line mr-1.5"></AppIcon>Confirm Manager Signature
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            {!loading && pageCount > 1 && (
              <Pagination
                currentPage={activePage}
                pageCount={pageCount}
                totalItems={filteredData.length}
                onPageChange={(page) => {
                  setCurrentPage(page);
                  setExpanded(null);
                }}
              />
            )}
          </div>
        </section>
        {completionEvent && (
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
        )}
        <ProgressReviewSlidesModal
          open={Boolean(slidesDeck)}
          deck={slidesDeck}
          onClose={() => setSlidesDeck(null)}
        />
      </div>
    </WorkspaceShell>
  );
}

function ProgressReviewCompletionModal({
  event,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  event: CoachCalendarEvent;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (responses: ProgressReviewResponses) => void;
}) {
  const [responses, setResponses] = useState<ProgressReviewResponses>(() => ({ ...(event.reviewResponses || {}) }));
  const [openSection, setOpenSection] = useState(PROGRESS_REVIEW_SECTIONS[0].id);
  const [validationError, setValidationError] = useState('');
  const answeredCount = REQUIRED_PROGRESS_REVIEW_RESPONSE_IDS.filter((id) => responses[id]?.trim()).length;
  const completionPercent = Math.round((answeredCount / REQUIRED_PROGRESS_REVIEW_RESPONSE_IDS.length) * 100);

  const updateResponse = (id: string, value: string) => {
    setResponses((current) => ({ ...current, [id]: value }));
    setValidationError('');
  };

  const submit = () => {
    const firstMissing = PROGRESS_REVIEW_SECTIONS.find((section) => (
      section.questions.some((question) => (
        (
          question.required !== false
          || (
            question.showWhen
            && responses[question.showWhen.questionId] === question.showWhen.value
          )
        )
        && !responses[question.id]?.trim()
      ))
    ));
    if (firstMissing) {
      setOpenSection(firstMissing.id);
      setValidationError('Please answer every question before submitting the review for signature.');
      return;
    }
    onSubmit(responses);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-primary-950/65 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/20 bg-background-50 shadow-2xl">
        <header className="shrink-0 border-b border-white/10 bg-gradient-to-r from-[#10021f] via-primary-950 to-[#35105e] px-5 py-5 text-white sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-lg text-secondary-200">
                <AppIcon className="ri-file-edit-line"></AppIcon>
              </span>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-secondary-200">Submit progress review</p>
                <h2 className="mt-1 text-lg font-bold text-white">{event.learner || 'Learner'} · {eventPeriodLabel(event)}</h2>
                <p className="mt-1 text-xs text-white/60">Complete the review record, then send it for the line manager signature.</p>
              </div>
            </div>
            <button type="button" onClick={onClose} disabled={busy} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-50" aria-label="Close form">
              <AppIcon className="ri-close-line text-lg"></AppIcon>
            </button>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-secondary-300 transition-all" style={{ width: `${completionPercent}%` }} />
            </div>
            <span className="text-[10px] font-bold text-white/70">{answeredCount}/{REQUIRED_PROGRESS_REVIEW_RESPONSE_IDS.length} answered</span>
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto bg-[#f7f6fb] p-4 sm:p-6">
          <div className="rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-xs leading-5 text-primary-800">
            <AppIcon className="ri-information-line mr-2"></AppIcon>
            These answers will be saved to this review and shown to the learner in their Progress Review record.
          </div>

          <div className="grid gap-3 rounded-2xl border border-background-200 bg-background-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Learner', event.learner || 'Unknown learner'],
              ['Programme', event.programme || '--'],
              ['Review period', eventPeriodLabel(event)],
              ['Meeting', `${formatDateLabel(event.scheduledDate || event.targetDate)} · ${formatTimeLabel(event)}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-background-100 px-3.5 py-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-foreground-400">{label}</p>
                <p className="mt-1 text-xs font-bold text-foreground-800">{value}</p>
              </div>
            ))}
          </div>

          {PROGRESS_REVIEW_SECTIONS.map((section, sectionIndex) => {
            const isOpen = openSection === section.id;
            const requiredQuestions = section.questions.filter((question) => question.required !== false);
            const sectionAnswered = requiredQuestions.filter((question) => responses[question.id]?.trim()).length;
            const sectionComplete = sectionAnswered === requiredQuestions.length;
            const visibleQuestions = section.questions.filter((question) => (
              !question.showWhen
              || responses[question.showWhen.questionId] === question.showWhen.value
            ));
            return (
              <section key={section.id} className={`overflow-hidden rounded-2xl border bg-background-50 transition-all ${isOpen ? 'border-primary-300 shadow-sm' : 'border-background-200'}`}>
                <button type="button" onClick={() => setOpenSection(isOpen ? '' : section.id)} className="flex w-full items-center gap-3 p-4 text-left sm:px-5">
                  <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isOpen ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-700'}`}>
                    <AppIcon className={section.icon}></AppIcon>
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-primary-900 px-1 text-[8px] font-bold text-white">{sectionIndex + 1}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-foreground-400">Review section {sectionIndex + 1} of {PROGRESS_REVIEW_SECTIONS.length}</span>
                    <span className="mt-0.5 block text-sm font-bold text-foreground-900">{section.title}</span>
                    <span className="mt-1 hidden text-[10px] text-foreground-400 sm:block">{section.description}</span>
                  </span>
                  {sectionComplete && <AppIcon className="ri-checkbox-circle-fill text-lg text-emerald-500"></AppIcon>}
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full bg-background-100 text-foreground-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}><AppIcon className="ri-arrow-down-s-line"></AppIcon></span>
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-primary-100 bg-white p-4 sm:p-5">
                    {visibleQuestions.map((question, questionIndex) => (
                      <div key={question.id} className="rounded-2xl border border-background-200 bg-background-50 p-4 transition focus-within:border-primary-300 focus-within:shadow-sm">
                        <label className="mb-2 block text-xs font-bold text-foreground-800">
                          <span className="mr-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-100 px-1 text-[9px] text-primary-700">{questionIndex + 1}</span>
                          {question.label}
                          {(question.required !== false || question.showWhen) && <span className="ml-1 text-red-500">*</span>}
                        </label>
                        {question.helpText && <p className="mb-2 text-[10px] text-foreground-400">{question.helpText}</p>}
                        {question.type === 'text' && (
                          <textarea
                            value={responses[question.id] || ''}
                            onChange={(e) => updateResponse(question.id, e.target.value)}
                            rows={3}
                            maxLength={4000}
                            placeholder={question.placeholder}
                            className="w-full resize-y rounded-xl border border-background-300 bg-white px-3.5 py-3 text-sm text-foreground-800 outline-none transition placeholder:text-foreground-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-200"
                          />
                        )}
                        {question.type === 'yes-no' && (
                          <div className="grid max-w-sm grid-cols-2 gap-2">
                            {[
                              ['Yes', 'ri-check-line'],
                              ['No', 'ri-close-line'],
                            ].map(([value, icon]) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() => updateResponse(question.id, value)}
                                className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-xs font-bold transition ${
                                  responses[question.id] === value
                                    ? value === 'Yes'
                                      ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm'
                                      : 'border-foreground-700 bg-foreground-800 text-white shadow-sm'
                                    : 'border-background-300 bg-white text-foreground-600 hover:border-primary-300 hover:bg-primary-50'
                                }`}
                              >
                                <AppIcon className={icon}></AppIcon>{value}
                              </button>
                            ))}
                          </div>
                        )}
                        {question.type === 'rating' && (
                          <div>
                            <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
                              {Array.from({ length: 10 }, (_, index) => String(index + 1)).map((rating) => (
                                <button key={rating} type="button" onClick={() => updateResponse(question.id, rating)} className={`flex h-10 min-w-0 items-center justify-center rounded-xl border text-xs font-bold transition ${responses[question.id] === rating ? 'border-primary-600 bg-primary-600 text-white shadow-sm' : 'border-background-300 bg-white text-foreground-600 hover:border-primary-300 hover:bg-primary-50'}`}>
                                  {rating}
                                </button>
                              ))}
                            </div>
                            <div className="mt-2 flex justify-between text-[9px] font-medium text-foreground-400">
                              <span>1 · Significant support needed</span>
                              <span>10 · Excellent</span>
                            </div>
                          </div>
                        )}
                        {question.type === 'select' && (
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {(question.options || []).map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() => updateResponse(question.id, option)}
                                className={`min-h-10 rounded-xl border px-3 py-2 text-left text-[11px] font-semibold transition ${
                                  responses[question.id] === option
                                    ? 'border-primary-600 bg-primary-600 text-white shadow-sm'
                                    : 'border-background-300 bg-white text-foreground-600 hover:border-primary-300 hover:bg-primary-50'
                                }`}
                              >
                                <AppIcon className={`mr-2 ${responses[question.id] === option ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'}`}></AppIcon>
                                {option}
                              </button>
                            ))}
                          </div>
                        )}
                        {question.type === 'rag' && (
                          <div className="grid max-w-lg grid-cols-3 gap-2">
                            {[
                              ['Green', 'border-emerald-500 bg-emerald-500 text-white', 'bg-emerald-50 text-emerald-700'],
                              ['Amber', 'border-amber-500 bg-amber-500 text-white', 'bg-amber-50 text-amber-700'],
                              ['Red', 'border-red-500 bg-red-500 text-white', 'bg-red-50 text-red-700'],
                            ].map(([value, activeClass, idleClass]) => (
                              <button key={value} type="button" onClick={() => updateResponse(question.id, value)} className={`rounded-xl border px-4 py-2.5 text-xs font-bold transition ${responses[question.id] === value ? activeClass : `border-transparent ${idleClass}`}`}>
                                <AppIcon className="ri-circle-fill mr-1.5 text-[8px]"></AppIcon>{value}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}

          {(validationError || error) && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
              <AppIcon className="ri-error-warning-line mr-2"></AppIcon>{validationError || error}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-xl px-4 text-xs font-semibold text-foreground-500 transition hover:bg-background-100 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60">
            <AppIcon className={busy ? 'ri-loader-4-line animate-spin' : 'ri-check-double-line'}></AppIcon>
            {busy ? 'Submitting review...' : 'Submit for Manager Signature'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, label, count, description }: { active: boolean; onClick: () => void; label: string; count: number; description: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={description}
      aria-pressed={active}
      className={`group inline-flex min-h-10 cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 py-2 text-[11px] font-semibold transition-all duration-200 ${
        active
          ? 'border-primary-900 bg-primary-900 text-white shadow-[0_8px_20px_-12px_oklch(var(--primary-900)/0.9)]'
          : 'border-background-200 bg-background-50 text-foreground-500 hover:-translate-y-0.5 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-800'
      }`}
    >
      <span>{label}</span>
      <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[9px] font-bold ${
        active
          ? 'bg-white/15 text-white'
          : 'bg-background-100 text-foreground-500 group-hover:bg-white group-hover:text-primary-700'
      }`}>
        {count}
      </span>
    </button>
  );
}

function Pagination({ currentPage, pageCount, totalItems, onPageChange }: { currentPage: number; pageCount: number; totalItems: number; onPageChange: (page: number) => void }) {
  const visiblePages = Array.from(
    new Set([1, currentPage - 1, currentPage, currentPage + 1, pageCount]),
  ).filter(page => page > 0 && page <= pageCount).sort((a, b) => a - b);

  return (
    <nav className="flex flex-col items-center justify-between gap-3 border-t border-background-200 pt-4 sm:flex-row xl:col-span-2" aria-label="Review pages">
      <p className="text-[11px] font-medium text-foreground-400">
        Showing {(currentPage - 1) * REVIEWS_PER_PAGE + 1}–{Math.min(currentPage * REVIEWS_PER_PAGE, totalItems)} of {totalItems}
      </p>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} className="flex h-9 items-center gap-1 rounded-xl border border-background-200 bg-background-50 px-3 text-[11px] font-semibold text-foreground-600 transition-smooth hover:border-primary-200 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-40">
          <AppIcon className="ri-arrow-left-s-line"></AppIcon>Previous
        </button>
        {visiblePages.map((page, index) => (
          <div key={page} className="flex items-center gap-1">
            {index > 0 && page - visiblePages[index - 1] > 1 && <span className="px-1 text-xs text-foreground-300">…</span>}
            <button type="button" onClick={() => onPageChange(page)} aria-current={currentPage === page ? 'page' : undefined} className={`h-9 min-w-9 rounded-xl px-2 text-[11px] font-bold transition-smooth ${currentPage === page ? 'bg-primary-900 text-white shadow-sm' : 'border border-background-200 bg-background-50 text-foreground-500 hover:border-primary-200 hover:bg-primary-50'}`}>
              {page}
            </button>
          </div>
        ))}
        <button type="button" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === pageCount} className="flex h-9 items-center gap-1 rounded-xl border border-background-200 bg-background-50 px-3 text-[11px] font-semibold text-foreground-600 transition-smooth hover:border-primary-200 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-40">
          Next<AppIcon className="ri-arrow-right-s-line"></AppIcon>
        </button>
      </div>
    </nav>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-background-200/70 bg-background-50 p-3.5">
      <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-foreground-300">{label}</p>
      <p className="text-xs font-semibold text-foreground-700">{value}</p>
    </div>
  );
}

function ScheduleInput({ label, type, value, onChange }: { label: string; type: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[11px] text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-300" />
    </label>
  );
}

function EmptyState({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-background-300 bg-background-50 p-12 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-500">
        <AppIcon className={`${icon} text-xl ${icon.includes('loader') ? 'animate-spin' : ''}`}></AppIcon>
      </span>
      <p className="mt-3 text-sm font-semibold text-foreground-500">{title}</p>
    </div>
  );
}
