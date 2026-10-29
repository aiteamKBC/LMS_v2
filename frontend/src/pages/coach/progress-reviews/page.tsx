import { TWELVE_WEEK_WINDOW_DAYS, displayValue, titleCaseLabel, toIsoDate, addDays, currentTimestampLabel, toneForStatus, parseTrackedMinutes, formatTrackedTime, isWithinWindow, buildTwelveWeekWindow, trainingPlanContextLabel, buildReviewActivities, buildProgressReviewSlidesDeck, type ProgressReviewActivity } from './page.helpers';
import { useEffect, useMemo, useState } from 'react';
import { reviewCategory } from '@/lib/reviewCategory';
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
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { useImportedMeetingJoin } from '../shared/useImportedMeetingJoin';
import { cn } from '@/lib/cn';
import { statusTone } from '@/lib/statusTone';
import { roleNavMap } from '@/mocks/navigation';
import { coachSessionKey, readCoachSessionCache, writeCoachSessionCache } from '@/features/coach/shared/coachSessionCache';
import type { ProgressReviewResponses } from '@/pages/shared/progressReviewForm';
import { LearnerAvatar } from '../shared/LearnerIdentity';
import { ModernDatePicker, ModernDurationPicker, ScheduleFieldLabel, ScheduleTimeInput } from '../shared/ScheduleControls';
import ProgressReviewCompletionModal from '../shared/ProgressReviewCompletionModal';
import { reviewInstancePath, reviewInstanceRouteState } from '../shared/reviewInstanceNavigation';
import { ReviewAge } from '../shared/ReviewAge';
import { ReviewCompletedDate, ReviewScheduledDate } from '../shared/ReviewDates';
import { ReviewIdentityNotice } from '../shared/ReviewIdentityNotice';
import ImportedReviewBookingDialog from '../shared/ImportedReviewBookingDialog';
import type { CoachReviewGenerationIssue } from '../shared/calendarEvents';
import {
  type CoachCalendarEvent,
  type ScheduleFormState,
  eventDisplayDate,
  eventIdentity,
  eventPeriodLabel,
  fetchCoachCalendarEvents,
  formatDateLabel,
  isAtRiskProgressReview,
  isAwaitingSignatureEvent,
  isDueSoonEvent,
  isEventInMonth,
  isInProgressEvent,
  isScheduledEvent,
  isCompletedEvent,
  latestCompletedReviewDate,
  needsScheduling,
  parseLocalDate,
  runCoachCalendarAction,
  scheduleCoachCalendarEvent,
  scheduleDefaults,
  sortEvents,
  statusLabel,
} from '../shared/calendarEvents';
import { isImportedPersonalSupportPlan, normalizeResolvedReview, normalizeResolvedReviews, reviewActionMatrix } from '../shared/resolvedReviewRows';
import {
  type ProgressReviewSlide,
  type ProgressReviewSlideListItem,
  type ProgressReviewSlidesDeck,
} from './components/ProgressReviewSlidesModal';
import ProgressReviewPptxModal from './components/ProgressReviewPptxModal';
import { slidesTargetFromEvent } from './components/slidesTarget';
import { MeetingActionsMenu } from '../monthly-coaching/components/MeetingActionsMenu';
import styles from '../monthly-coaching/monthlyCoaching.module.css';
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
    description: 'Progress reviews with a genuinely completed review workflow.',
  },
  all: {
    label: 'All',
    description: 'All progress reviews due or scheduled in the selected month.',
  },
};

const OTHER_REVIEW_DESCRIPTIONS: Record<ReviewTab, string> = {
  all: 'Other learner reviews in the selected period.',
  'needs-schedule': 'Reviews that still need a calendar booking.',
  scheduled: 'Reviews that are booked and waiting to start.',
  'in-progress': 'Reviews currently in progress.',
  'awaiting-signature': 'Reviews waiting for required signatures.',
  completed: 'Reviews with a completed workflow.',
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

export default function CoachProgressReviews({ category = 'progress-review' }: { category?: 'progress-review' | 'review' }) {
  const otherReviews = category === 'review';
  const listPath = otherReviews ? '/coach/reviews' : '/coach/progress-reviews';
  const reviewLabel = otherReviews ? 'reviews' : 'progress reviews';
  const pageTitle = otherReviews ? 'Review' : 'Progress Reviews';
  const coach = useCoachIdentity();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<ReviewTab>(() => reviewTabFromQuery(searchParams.get('filter')));
  const [currentPage, setCurrentPage] = useState(() => pageFromQuery(searchParams.get('page')));
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('q') || '');
  const [selectedMonth, setSelectedMonth] = useState(() => monthFromQuery(searchParams.get('month')));
  const [allMonths, setAllMonths] = useState(() => searchParams.get('months') === 'all');
  const cacheKey = coachSessionKey(category, coach.email, 'all-months');
  const initialCache = readCoachSessionCache<{ events: CoachCalendarEvent[]; ownerName: string; issues?: CoachReviewGenerationIssue[] }>(cacheKey);
  const [events, setEvents] = useState<CoachCalendarEvent[]>(() => initialCache?.events || []);
  const [issues, setIssues] = useState<CoachReviewGenerationIssue[]>(() => initialCache?.issues || []);
  const [ownerName, setOwnerName] = useState(() => initialCache?.ownerName || 'Coach');
  const [loading, setLoading] = useState(() => !initialCache);
  const [error, setError] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(EMPTY_SCHEDULE_FORM);
  const [scheduleModalEvent, setScheduleModalEvent] = useState<CoachCalendarEvent | null>(null);
  const [importedBookingEvent, setImportedBookingEvent] = useState<CoachCalendarEvent | null>(null);
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
    if (allMonths) {
      params.delete('month');
      params.set('months', 'all');
    } else if (monthKey(selectedMonth) === monthKey(startOfMonth())) {
      params.delete('month');
      params.delete('months');
    } else {
      params.set('month', monthKey(selectedMonth));
      params.delete('months');
    }
    setSearchParams(params, { replace: true });
    // Only the selected month belongs to this sync. Other page state is local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMonths, selectedMonth, setSearchParams]);

  useEffect(() => {
    if (!coach.isInitialized) return;
    if (!coach.email) {
      setEvents([]);
      setIssues([]);
      setOwnerName(coach.name);
      setError(`Coach access is required to load ${reviewLabel}.`);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const cached = readCoachSessionCache<{ events: CoachCalendarEvent[]; ownerName: string; issues?: CoachReviewGenerationIssue[] }>(cacheKey);
    setIssues(cached?.issues || []);

    const loadReviews = async () => {
      if (cached) {
        setEvents(cached.events);
        setOwnerName(cached.ownerName);
        setLoading(false);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const data = await fetchCoachCalendarEvents(controller.signal, {
          includeLiveSessions: false,
          includeSchedulerQueues: false,
        });
        const reviews = sortEvents(normalizeResolvedReviews((data.events || []).filter(event => reviewCategory(event) === category)));
        const nextIssues = data.reviewGenerationIssues || [];
        writeCoachSessionCache(cacheKey, { events: reviews, ownerName: data.owner?.name || coach.name, issues: nextIssues });
        setIssues(nextIssues);
        setEvents(reviews);
        setOwnerName(data.owner?.name || coach.name);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (cached) return;
        setEvents([]);
        setError(err instanceof Error ? err.message : `Unable to load ${reviewLabel}.`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    loadReviews();
    return () => controller.abort();
  }, [cacheKey, category, coach.email, coach.isInitialized, coach.name, reviewLabel]);

  const selectedMonthLabel = allMonths ? 'All months' : monthLabel(selectedMonth);
  const selectedMonthIsCurrent = !allMonths && monthKey(selectedMonth) === monthKey(startOfMonth());
  const monthTabDescription = allMonths
    ? `Past and upcoming ${reviewLabel} across all months.`
    : `${otherReviews ? 'Reviews' : 'Progress reviews'} due or scheduled in ${selectedMonthLabel}.`;
  const selectedMonthEvents = allMonths ? events : events.filter(event => isEventInMonth(event, selectedMonth));
  const learnerSuggestions = useMemo(() => Array.from(new Set(
    events.map(event => event.learner?.trim()).filter((learner): learner is string => Boolean(learner)),
  )).sort((left, right) => left.localeCompare(right)), [events]);
  const lastPrByLearner = useMemo(
    () => new Map(Array.from(new Set(events.map(event => event.learnerId).filter(Boolean))).map(learnerId => [
      learnerId!,
      latestCompletedReviewDate(events, learnerId!, 'progress-review'),
    ])),
    [events],
  );
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
  const filteredData = (normalizedSearchTerm
    ? data.filter(review => matchesReviewSearch(review, normalizedSearchTerm))
    : data
  ).slice().sort((left, right) => {
    const leftDate = parseLocalDate(eventDisplayDate(left))?.getTime() ?? 0;
    const rightDate = parseLocalDate(eventDisplayDate(right))?.getTime() ?? 0;
    return rightDate - leftDate || eventIdentity(left).localeCompare(eventIdentity(right));
  });
  const pageCount = Math.ceil(filteredData.length / REVIEWS_PER_PAGE);
  const activePage = Math.min(currentPage, Math.max(pageCount, 1));
  const paginatedReviews = filteredData.slice(
    (activePage - 1) * REVIEWS_PER_PAGE,
    activePage * REVIEWS_PER_PAGE,
  );

  const visibleReviewsKey = paginatedReviews
    .filter((review) => reviewHasLearnerReference(review) && eventDisplayDate(review))
    .map((review) => `${eventIdentity(review)}:${eventDisplayDate(review)}`)
    .join('|');

  useEffect(() => {
    if (otherReviews || !visibleReviewsKey) return;
    let cancelled = false;
    const candidates = paginatedReviews.filter((review) => !isImportedReviewEvent(review) && reviewHasLearnerReference(review) && eventDisplayDate(review));

    Promise.all(candidates.map(async (review) => {
      const learnerId = review.enrolmentId || '';
      try {
        const result = await fetchLatestRun(learnerId, eventDisplayDate(review));
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
  }, [otherReviews, visibleReviewsKey]);

  const changeTab = (nextTab: ReviewTab) => {
    setTab(nextTab);
    setCurrentPage(1);
  };

  const changeMonth = (nextMonth: Date) => {
    setAllMonths(false);
    setSelectedMonth(startOfMonth(nextMonth));
    setTab('all');
    setCurrentPage(1);
  };

  const showAllMonths = () => {
    setAllMonths(true);
    setTab('all');
    setCurrentPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const updateEvent = (updatedEvent: CoachCalendarEvent) => {
    setEvents(prevEvents => sortEvents(prevEvents.map(event => (
      eventIdentity(event) === eventIdentity(updatedEvent) ? normalizeResolvedReview(updatedEvent) : event
    ))));
    setScheduleForm(scheduleDefaults(updatedEvent));
  };

  const openScheduleModal = (event: CoachCalendarEvent) => {
    if (event.reviewSource === 'aptem' || event.aptemReviewId) {
      setActionNotice(null);
      setImportedBookingEvent(event);
      return;
    }
    setScheduleForm(scheduleDefaults(event));
    setActionError(null);
    setActionNotice(event.syncWarning || null);
    setSchedulePickerOpen(false);
    setScheduleModalEvent(event);
  };

  const schedulableReviews = selectedMonthEvents.filter(event => isImportedPersonalSupportPlan(event)
    ? Boolean(reviewActionMatrix(event).schedule)
    : event.reviewSource !== 'aptem' && !event.aptemReviewId && !['in-progress', 'completed', 'awaiting-signature'].includes(event.status));

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
    if (allMonths) query.set('months', 'all');
    else if (!selectedMonthIsCurrent) query.set('month', monthKey(selectedMonth));
    if (activePage > 1) query.set('page', String(activePage));
    const queryString = query.toString();
    return `${listPath}${queryString ? `?${queryString}` : ''}`;
  };

  const openDetails = (event: CoachCalendarEvent) => {
    navigate(`${listPath}/${encodeURIComponent(eventIdentity(event))}`, { state: { returnTo: listUrl() } });
  };

  const handleSchedule = async (event: CoachCalendarEvent) => {
    if (isImportedPersonalSupportPlan(event)) {
      setScheduleModalEvent(null);
      setImportedBookingEvent(event);
      return;
    }
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

  const handleJoin = useImportedMeetingJoin({
    contextKey: `${coach.email}:${coach.isViewingAsCoach}`, readOnly: coach.isViewingAsCoach,
    onError: setActionError,
    onStarted: joined => setEvents(current => current.map(row => row.eventKey === joined.eventKey ? { ...row, status: 'in-progress' } : row)),
  });

  const openCompletionForm = async (event: CoachCalendarEvent) => {
    setActionError(null);
    if (event.aptemReviewId && !event.reviewInstanceId) {
      navigate(reviewInstancePath(eventIdentity(event)), {
        state: reviewInstanceRouteState(event, listUrl()),
      });
      return;
    }
    if (event.reviewTemplateId) {
      setBusyEventId(eventIdentity(event));
      try {
        const instanceId = event.reviewInstanceId || (await openReviewInstanceForEvent(eventIdentity(event))).instanceId;
        const query = searchParams.toString();
        navigate(reviewInstancePath(instanceId), {
          state: reviewInstanceRouteState(
            event,
            `${listPath}${query ? `?${query}` : ''}`,
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
    if (!reviewHasLearnerReference(event) || !eventDisplayDate(event)) {
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
    const count = events.filter((event) => !isImportedReviewEvent(event) && reviewHasLearnerReference(event) && eventDisplayDate(event)).length;
    if (!count) return;
    if (!window.confirm(`Generate Progress Review PPTX decks for ${count} review(s) with a learner and review date? This may take a while.`)) return;
    setBulkGenerating(true);
    try {
      const data = await bulkGenerateProgressReviews({});
      const failed = data.results.filter((row) => row.generationStatus === 'failed').length;
      if (failed) {
        setActionError(`Bulk generation finished with ${failed} of ${data.results.length} failure(s).`);
      } else {
        setActionNotice(`Bulk generation complete — ${data.results.length} draft(s) generated. Open each review to review and save its slides.`);
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
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle={pageTitle} pageSubtitle={otherReviews ? 'Manage other learner reviews and sign-offs' : 'Manage learner progress reviews and sign-offs'} userName={ownerName} userRole="Progress Coach">
      <PageContainer className={styles.page}>
        <section className={styles.banner} aria-label={otherReviews ? 'Review support' : 'Progress review support'}>
          <span aria-hidden="true" className={styles.dots} />
          <svg aria-hidden="true" className={styles.waves} viewBox="0 0 800 200" preserveAspectRatio="none">
            <defs>
              <linearGradient id="progress-review-wave-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--banner-wave-a)" stopOpacity="0" /><stop offset="1" stopColor="var(--banner-wave-a)" stopOpacity=".28" /></linearGradient>
              <linearGradient id="progress-review-wave-b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="var(--banner-wave-b)" stopOpacity="0" /><stop offset="1" stopColor="var(--banner-wave-b)" stopOpacity=".24" /></linearGradient>
              <linearGradient id="progress-review-wave-c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="var(--banner-wave-c)" stopOpacity="0" /><stop offset="1" stopColor="var(--banner-wave-c)" stopOpacity=".22" /></linearGradient>
            </defs>
            <path d="M0 200 C 180 200 260 60 430 70 S 650 170 800 120 L 800 200 Z" fill="url(#progress-review-wave-a)" />
            <path d="M120 200 C 300 190 380 20 560 30 S 720 110 800 60 L 800 200 Z" fill="url(#progress-review-wave-b)" />
            <path d="M340 200 C 470 170 560 110 680 130 S 770 170 800 150 L 800 200 Z" fill="url(#progress-review-wave-c)" />
            <path d="M60 170 C 240 160 330 40 500 50 S 700 140 800 95" fill="none" stroke="var(--banner-wave-line)" strokeWidth="1.5" />
          </svg>
          <span aria-hidden="true" className={styles.glow} />
          <div><h2>Review. Reflect. Progress.</h2><p>Meaningful reviews help learners stay on track and achieve their goals.</p></div>
          <img src="/coach-meetings-calendar.webp" alt="" aria-hidden="true" width={312} height={312} />
        </section>
        {error ? <EmptyState variant="error" title={`Unable to load ${reviewLabel}.`} description={error} /> : null}
        <ReviewIdentityNotice issues={issues} />
        {actionNotice && !scheduleModalEvent ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{actionNotice}</p> : null}
        <section className={styles.controlsCard} aria-label={otherReviews ? 'Review filters and summary' : 'Progress review filters and summary'}>
          <div className={styles.toolbar}>
            <div className={styles.monthNav} aria-label="Review month"><button type="button" onClick={() => changeMonth(addMonths(selectedMonth, -1))} aria-label="Previous month"><AppIcon className="ri-arrow-left-s-line text-xl" /></button><span>{selectedMonthLabel}</span><button type="button" onClick={() => changeMonth(addMonths(selectedMonth, 1))} aria-label="Next month"><AppIcon className="ri-arrow-right-s-line text-xl" /></button></div>
            <button type="button" onClick={showAllMonths} aria-pressed={allMonths} className={styles.control}>All months<AppIcon className="ri-arrow-down-s-line" /></button>
            {!selectedMonthIsCurrent ? <button type="button" onClick={() => changeMonth(startOfMonth())} className={styles.control}>Today</button> : null}
            <SearchInput className={styles.search} value={searchTerm} suggestions={learnerSuggestions} onChange={handleSearchChange} placeholder="Search learners..." ariaLabel={`Search ${reviewLabel} by learner`} />
            {!otherReviews && <button type="button" onClick={handleBulkGenerateSlides} disabled={bulkGenerating} className={styles.control}><AppIcon className={bulkGenerating ? 'ri-loader-4-line animate-spin' : 'ri-stack-line'} />{bulkGenerating ? 'Generating slides...' : 'Bulk generate slides'}</button>}
            <button type="button" onClick={openSchedulePicker} disabled={schedulableReviews.length === 0} className={cn(styles.control, styles.primary)}><AppIcon className="ri-add-line text-xl" />Schedule review</button>
          </div>
          <PageTabs className={styles.tabs} items={tabItems} value={tab} onChange={(next) => changeTab(next as ReviewTab)} label={`Filter ${reviewLabel} by status`} />
          <div className={styles.listMeta}><div><h3>{filteredData.length} {otherReviews ? 'review' : 'progress review'}{filteredData.length === 1 ? '' : 's'}</h3><p>{tab === 'all' ? monthTabDescription : otherReviews ? OTHER_REVIEW_DESCRIPTIONS[tab] : FILTER_COPY[tab].description}</p></div>{normalizedSearchTerm ? <span className="text-[12px] font-semibold text-primary-700">Showing {filteredData.length} of {data.length}</span> : null}</div>
        </section>
        <div>
          {loading ? <RowsSkeleton rows={6} /> : null}
          {!loading && !error && data.length === 0 ? <EmptyState variant="empty" icon="ri-file-chart-line" title={`No ${reviewLabel} found.`} /> : null}
          {!loading && !error && data.length > 0 && filteredData.length === 0 ? <EmptyState variant="no-matches" icon="ri-user-search-line" title="No learner matches this search." /> : null}
          {!loading && filteredData.length > 0 ? (
            <div className={styles.tableScroll} role="region" aria-label={`${otherReviews ? 'Reviews' : 'Progress reviews'} table; scroll horizontally on smaller screens`} tabIndex={0}>
              <table className={`${styles.table} ${styles.prTable}`}>
                <caption className="sr-only">{otherReviews ? 'Reviews' : 'Progress reviews'} for {selectedMonthLabel}</caption>
                <colgroup><col /><col /><col /><col /><col /><col /><col /></colgroup>
                <thead><tr><th scope="col">Learner</th><th scope="col">Programme</th><th scope="col" title={otherReviews ? undefined : "Latest recorded completion across this learner's progress reviews, not just this row."} tabIndex={otherReviews ? undefined : 0}>{otherReviews ? 'Review type' : 'Last PR'}</th><th scope="col">Scheduled for (UK time)</th><th scope="col" title="When this review form was completed, not when the meeting took place." tabIndex={0}>Completed on</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
                <tbody>{paginatedReviews.map(review => {
                  const reviewKey = eventIdentity(review);
                  const isBusy = busyEventId === reviewKey;
                  const hasSlides = generatedReviewKeys.has(reviewKey);
                  const actions = reviewActionMatrix(review);
                  const statusIcon = review.status === 'completed' ? 'ri-checkbox-circle-line' : review.status === 'scheduled' ? 'ri-calendar-line' : review.status === 'awaiting-signature' ? 'ri-edit-line' : 'ri-time-line';
                  return <tr key={reviewKey} className="ui-action-row" onClick={() => openDetails(review)}>
                    <td><div className={styles.identity}><LearnerAvatar name={review.learner} tone={isAtRiskProgressReview(review) ? 'critical' : statusTone(review.status)} size="lg" /><div><strong className={styles.learnerName}>{review.learner || 'Unknown learner'}</strong><span className={styles.learnerEmail}>{review.email || (otherReviews ? 'Review' : 'Progress review')}</span></div></div></td>
                    <td>{review.programme || '--'}</td>
                    <td>{otherReviews ? (review.importedReviewType || review.reviewTypeName || review.title || 'Review') : <ReviewAge value={review.learnerId ? lastPrByLearner.get(review.learnerId) : undefined} label="PR" />}</td>
                    <td><ReviewScheduledDate event={review} /></td>
                    <td><ReviewCompletedDate event={review} /></td>
                    <td><span className={styles.status} data-status={review.status}><AppIcon className={statusIcon} />{statusLabel(review.status)}</span>{isAtRiskProgressReview(review) || isDueSoonEvent(review) ? <div className={styles.alerts}>{isAtRiskProgressReview(review) ? <StatusBadge tone="critical" label="Overdue" dot={false} size="sm" /> : null}{isDueSoonEvent(review) ? <StatusBadge tone="upcoming" label="Due Soon" dot={false} size="sm" /> : null}</div> : null}</td>
                    <td onClick={(clickEvent) => clickEvent.stopPropagation()}><div className={styles.actions}>
                      {actions.viewForm ? <button type="button" onClick={() => { void openCompletionForm(review); }} disabled={isBusy} className={cn(styles.control, styles.primary, styles.formButton)}>View form</button> : null}
                      <MeetingActionsMenu learner={review.learner || 'Unknown learner'} actions={[
                        { label: 'View details', icon: 'ri-eye-line', onSelect: () => openDetails(review) },
                        ...(!otherReviews && actions.presentation && reviewHasLearnerReference(review) ? [{ label: hasSlides ? 'View slides' : 'Create slides', icon: hasSlides ? 'ri-slideshow-2-line' : 'ri-file-ppt-line', onSelect: () => handleCreateSlides(review) }] : []),
                        ...(actions.schedule ? [{ label: actions.schedule, icon: 'ri-calendar-line', onSelect: () => openScheduleModal(review) }] : []),
                        ...(actions.join && !isBusy ? [{ label: 'Join', icon: 'ri-video-on-line', onSelect: () => handleJoin(review) }] : []),
                      ]} />
                    </div></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          ) : null}
          {!loading && filteredData.length > 0 ? <div className={styles.footer}><span>Showing {Math.min(filteredData.length, paginatedReviews.length)} of {filteredData.length} reviews</span>{pageCount > 1 ? <Pagination page={activePage} totalPages={pageCount} total={filteredData.length} pageSize={REVIEWS_PER_PAGE} onPageChange={setCurrentPage} noun="reviews" /> : null}</div> : null}
        </div>

        {importedBookingEvent ? <ImportedReviewBookingDialog
          key={`${coach.email}:${eventIdentity(importedBookingEvent)}`}
          event={importedBookingEvent}
          viewingAsCoach={coach.isViewingAsCoach}
          onClose={() => setImportedBookingEvent(null)}
          onSaved={(updated, notice, options) => {
            const nextEvents = sortEvents(events.map(event => eventIdentity(event) === eventIdentity(updated) ? updated : event));
            setEvents(nextEvents);
            writeCoachSessionCache(cacheKey, { events: nextEvents, ownerName, issues });
            setActionNotice(notice);
            if (!options?.keepOpen) setImportedBookingEvent(null);
          }}
        /> : null}
        {scheduleModalEvent ? (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={() => { if (!busyEventId) setScheduleModalEvent(null); }}>
            <div role="dialog" aria-modal="true" aria-labelledby="schedule-review-title" className="w-full max-w-[620px] rounded-2xl border border-foreground-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-start justify-between border-b border-foreground-100 px-5 py-4">
                <div><p className="text-[11px] font-semibold uppercase tracking-wide text-primary-600">Microsoft Teams booking</p><h2 id="schedule-review-title" className="mt-1 text-[20px] font-bold text-foreground-900">{`${scheduleModalEvent.status === 'scheduled' ? 'Reschedule' : 'Schedule'} ${otherReviews ? 'review' : 'progress review'}`}</h2><p className="mt-1 text-[12px] text-foreground-500">Choose the meeting details. The Teams booking will be updated after saving.</p></div>
                <button type="button" aria-label="Close schedule review" disabled={Boolean(busyEventId)} onClick={() => setScheduleModalEvent(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-400 hover:bg-foreground-50"><AppIcon className="ri-close-line text-lg" /></button>
              </div>
              <div className="space-y-4 px-5 py-5">
                {schedulePickerOpen ? <label className="block text-[12px] font-semibold text-foreground-700">Learner<select value={eventIdentity(scheduleModalEvent)} onChange={(event) => selectScheduleReview(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-foreground-200 bg-white px-3 text-[13px] font-medium text-foreground-800 outline-none focus:border-primary-400">{schedulableReviews.map(review => <option key={eventIdentity(review)} value={eventIdentity(review)}>{review.learner || 'Unknown learner'}{review.programme ? ` · ${review.programme}` : ''}</option>)}</select></label> : null}
                <div className="rounded-lg border border-primary-100 bg-primary-50/60 px-3 py-2 text-[12px] text-primary-900"><span className="font-semibold">Learner:</span> {scheduleModalEvent.learner || 'Unknown learner'}<span className="mx-2 text-primary-300">•</span><span>{scheduleModalEvent.programme || (otherReviews ? 'Review' : 'Progress review')}</span></div>
                {!isImportedPersonalSupportPlan(scheduleModalEvent) && <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div><ScheduleFieldLabel>Date</ScheduleFieldLabel><ModernDatePicker value={scheduleForm.date} onChange={(value) => setScheduleForm(prev => ({ ...prev, date: value }))} /></div>
                  <div><ScheduleFieldLabel>Time</ScheduleFieldLabel><ScheduleTimeInput value={scheduleForm.time} onChange={(value) => setScheduleForm(prev => ({ ...prev, time: value }))} /></div>
                  <div><ScheduleFieldLabel>Duration</ScheduleFieldLabel><ModernDurationPicker value={scheduleForm.durationMinutes} onChange={(durationMinutes) => setScheduleForm(prev => ({ ...prev, durationMinutes }))} /></div>
                </div>}
                {isImportedPersonalSupportPlan(scheduleModalEvent) && <p className="text-sm text-foreground-600">Continue to check the current booking and choose its date and time.</p>}
                {(actionError || actionNotice) ? <div className={cn('rounded-lg border px-3 py-2 text-[12px]', actionError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800')}>{actionError || actionNotice}</div> : null}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-foreground-100 px-5 py-4">
                <button type="button" disabled={Boolean(busyEventId)} onClick={() => setScheduleModalEvent(null)} className="h-10 rounded-lg border border-foreground-200 px-4 text-[12px] font-semibold text-foreground-700 hover:bg-foreground-50">Cancel</button>
                <button type="button" disabled={Boolean(busyEventId) || (!isImportedPersonalSupportPlan(scheduleModalEvent) && (!scheduleForm.date || !scheduleForm.time))} onClick={() => { void handleSchedule(scheduleModalEvent); }} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-700 px-4 text-[12px] font-bold text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60"><AppIcon className={busyEventId ? 'ri-loader-4-line animate-spin' : 'ri-calendar-check-line'} />{busyEventId ? 'Saving...' : isImportedPersonalSupportPlan(scheduleModalEvent) ? 'Continue to booking' : scheduleModalEvent.status === 'scheduled' ? 'Save new time' : 'Schedule review'}</button>
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
          target={pptxModalReview ? slidesTargetFromEvent(pptxModalReview) : null}
          onClose={() => setPptxModalReview(null)}
          onGenerated={() => { if (pptxModalReview) markReviewSlidesGenerated(pptxModalReview); }}
        />
      </PageContainer>
    </WorkspaceShell>
  );
}
