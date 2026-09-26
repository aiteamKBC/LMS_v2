// ============================================================================
// My Learners — the coach's caseload workspace.
//
// This page answers six questions in the order a coach asks them: how many
// learners do I have, who needs me, why, what is coming, who is fine, and what
// do I open first. The layout is that order top to bottom, and the risk model in
// lib/attention.ts is what makes the "why" a fact rather than a guess.
//
// Data contract, unchanged from before the redesign:
//   GET   /coach_api/coach/caseload            — the caseload itself
//   GET   /coach_api/coach/attendance          — live attendance, joined on id/email/name
//   GET   /engagement_api/learner-analytics/ â€” Engagement-derived status
// Three requests for the whole page. Nothing is fetched per card, and the quick
// view adds no request of its own — both payloads already carry what it shows.
//
// This component owns state and wiring only. Anything that renders lives in
// ./components, anything that computes lives in ./lib.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { useListQueryState } from '@/hooks/useListQueryState';
import { coachFetch } from '@/lib/coachFetch';
import { fetchCoachCalendarEvents, type CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';

import { CaseloadEmpty, CaseloadError, CaseloadLoading, CaseloadNoMatches } from './components/CaseloadStates';
import { LearnerTable } from './components/LearnerTable';
import { LearnerQuickViewDrawer } from './components/LearnerQuickViewDrawer';
import { LearnerToolbar, type CaseloadFilterState } from './components/LearnerToolbar';
import { LearnersHeaderActions } from './components/LearnersHeader';
import { Pagination } from './components/Pagination';
import { buildInsightMap } from './lib/attention';
import { downloadLearnersPdf } from './lib/exportPdf';
import {
  EMPTY_VALUE,
  displayValue,
  findAttendanceRecord,
  getProgramStatusKey,
  hasValue,
  normalizeLearner,
  startOfToday,
} from './lib/format';
import type {
  AttendanceApiLearner,
  AttendanceApiResponse,
  CaseloadApiLearner,
  CaseloadApiResponse,
  FilterOption,
  Learner,
  QuickViewTab,
  SortDirection,
  SortKey,
  StatusFilter,
} from './types';
import styles from './caseload.module.css';

const CASELOAD_ENDPOINT = '/coach_api/coach/caseload';
const ATTENDANCE_ENDPOINT = '/coach_api/coach/attendance';

const PAGE_SIZE = 10;
const QUERY_DEFAULTS = {
  search: '', cohort: 'all', group: 'all', programmeStatus: 'all', employer: 'all',
  view: 'all', sort: 'risk', direction: 'desc', page: 1,
};

const INITIAL_FILTERS: CaseloadFilterState = {
  search: '',
  cohort: 'all',
  group: 'all',
  programStatus: 'all',
  employer: 'all',
};

/**
 * Attendance is a separate endpoint from the caseload, and a coach whose
 * attendance data is unavailable should still get their learners. A failure here
 * degrades the attendance column, it does not fail the page.
 */
async function fetchAttendanceLearners(signal: AbortSignal): Promise<AttendanceApiLearner[]> {
  try {
    const response = await coachFetch(ATTENDANCE_ENDPOINT, { signal });
    if (!response.ok) return [];
    const data: AttendanceApiResponse = await response.json();
    return data.learners || [];
  } catch (error) {
    if (signal.aborted) throw error;
    console.warn('Unable to load live attendance for the caseload', error);
    return [];
  }
}

function reviewDate(event: CoachCalendarEvent): string | null {
  const raw = event.scheduledDate || event.date || event.targetDate;
  if (!raw) return null;
  const date = new Date(`${raw.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

async function fetchLastCompletedReviews(signal: AbortSignal): Promise<Map<string, { pr?: string; mcm?: string }>> {
  try {
    const response = await fetchCoachCalendarEvents(signal);
    const latest = new Map<string, { pr?: { time: number; value: string }; mcm?: { time: number; value: string } }>();
    (response.events || []).forEach((event) => {
      if (event.status !== 'completed' || !event.learnerId || (event.source !== 'progress-review' && event.source !== 'mcr')) return;
      const value = reviewDate(event);
      const time = Date.parse(event.scheduledDate || event.date || event.targetDate || '');
      if (!value || Number.isNaN(time)) return;
      const current = latest.get(String(event.learnerId)) || {};
      const key = event.source === 'progress-review' ? 'pr' : 'mcm';
      if (!current[key] || time > current[key]!.time) current[key] = { time, value };
      latest.set(String(event.learnerId), current);
    });
    return new Map([...latest].map(([id, value]) => [id, { pr: value.pr?.value, mcm: value.mcm?.value }]));
  } catch (error) {
    if (signal.aborted) throw error;
    console.warn('Unable to load completed PR/MCM sessions for the caseload');
    return new Map();
  }
}

function uniqueOptions(values: string[]): FilterOption[] {
  return [...new Set(values.filter((value) => value && value !== EMPTY_VALUE))]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));
}

function normalizedPerformanceStatus(value?: string | null): string {
  return displayValue(value).toLowerCase().replace(/[\s_]+/g, '-');
}

function hasAuthoritativePerformanceStatus(value?: string | null): boolean {
  return ['at-risk', 'on-track', 'high', 'new-starter'].includes(normalizedPerformanceStatus(value));
}

export function CoachCaseloadContent({ embedded = false }: { embedded?: boolean; embeddedLearners?: unknown[] }) {
  const navigate = useNavigate();
  const { auth, isInitialized } = useAuth();
  // Whose caseload this is: the signed-in coach, or the coach an administrator
  // opened the workspace as.
  const coach = useCoachIdentity();
  const authenticatedCoachEmail = coach.email;
  const authenticatedCoachName = coach.name;

  const [ownerName, setOwnerName] = useState('Coach');
  const [learners, setLearners] = useState<Learner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(0);
  const [serverFilterOptions, setServerFilterOptions] = useState<{
    cohort: FilterOption[]; group: FilterOption[]; programStatus: FilterOption[]; employer: FilterOption[];
  } | null>(null);

  const { state: query, setValues: setQueryValues, reset: resetQuery } = useListQueryState(QUERY_DEFAULTS);
  const filters: CaseloadFilterState = useMemo(() => ({
    search: String(query.search), cohort: String(query.cohort), group: String(query.group),
    programStatus: String(query.programmeStatus), employer: String(query.employer),
  }), [query.cohort, query.employer, query.group, query.programmeStatus, query.search]);
  const statusFilter = String(query.view) as StatusFilter;
  const sortKey = String(query.sort) as SortKey;
  const sortDirection = String(query.direction) as SortDirection;
  const currentPage = Number(query.page);

  const [quickView, setQuickView] = useState<{ learnerId: string; tab: QuickViewTab } | null>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedLearnerIds, setSelectedLearnerIds] = useState<Set<string>>(() => new Set());
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // One "today" per mount. Every day-offset on the page is measured from the
  // same instant, so two rows can never disagree about how far away a date is.
  const today = useMemo(() => startOfToday(), []);
  const caseloadUrl = useMemo(() => {
    const query = new URLSearchParams({ page: String(currentPage), page_size: String(PAGE_SIZE) });
    if (filters.search.trim()) query.set('search', filters.search.trim());
    if (filters.cohort !== 'all') query.set('cohort', filters.cohort);
    if (filters.group !== 'all') query.set('group', filters.group);
    if (filters.programStatus !== 'all') query.set('status', filters.programStatus);
    // Computed risk states cannot be applied before canonical enrichment. Keep
    // them in the request identity so changing the tab still refreshes page 1,
    // while the returned page is filtered with the unchanged canonical rule.
    if (statusFilter !== 'all') query.set('view_status', statusFilter);
    if (sortKey === 'name') {
      query.set('sort', 'name');
      query.set('direction', sortDirection);
    }
    return `${CASELOAD_ENDPOINT}?${query}`;
  }, [currentPage, filters.cohort, filters.group, filters.programStatus, filters.search, sortDirection, sortKey, statusFilter]);

  useEffect(() => {
    if (!isInitialized) return;
    const controller = new AbortController();

    async function loadCaseload() {
      setLoading(true);
      setError(null);

      if (!authenticatedCoachEmail) {
        setOwnerName(authenticatedCoachName);
        setLearners([]);
        setError(
          auth.account
            ? 'Coach access is required to load this caseload.'
            : 'Sign in with a coach account to load live learner data. Preview mode does not have a server session.',
        );
        setLoading(false);
        return;
      }

      try {
        const caseloadResponse = await coachFetch(caseloadUrl, { signal: controller.signal });
        if (!caseloadResponse.ok) {
          const payload = await caseloadResponse.json().catch(() => ({})) as { detail?: string; message?: string };
          throw new Error(payload.detail || payload.message || `Request failed with status ${caseloadResponse.status}`);
        }

        const data: CaseloadApiResponse = await caseloadResponse.json();
        if (controller.signal.aborted) return;
        setOwnerName(data.owner?.name || authenticatedCoachName);
        const pageResults = data.results || data.learners || [];
        setLearners(pageResults.map((source) => normalizeLearner({
          ...source,
          lastProgressReview: source.lastProgressReview || source.lastPr || undefined,
          lastReview: source.lastReview || source.lastMcm || undefined,
        }, source.attendanceRateAvailable ? {
          id: source.id, learner: source.name || '', attendance: source.attendanceRate,
          hasAttendance: true, sessions: source.attendanceSessions, present: source.attendancePresent,
          absent: source.attendanceAbsent, lastSession: source.attendanceLastSession,
          lastSessionDate: source.attendanceLastSessionDate,
        } : null)));
        setServerTotal(data.pagination?.total ?? pageResults.length);
        setServerTotalPages(data.pagination?.totalPages ?? (pageResults.length ? 1 : 0));
        setServerFilterOptions(data.filterOptions || null);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('Unable to load coach caseload', err);
        setError('Unable to load live learner data right now.');
        setLearners([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadCaseload();
    return () => controller.abort();
  }, [authenticatedCoachEmail, authenticatedCoachName, caseloadUrl, isInitialized, reloadToken]);

  // --- derived data ---------------------------------------------------------

  // The one expensive computation on the page, and the only place risk is
  // decided. Keyed on the learner list, so filtering and sorting never redo it.
  const insights = useMemo(() => buildInsightMap(learners, today), [learners, today]);
  const filterOptions = useMemo(() => serverFilterOptions || ({
    cohort: [...new Map(learners.map((learner) => [learner.cohortId, displayValue(learner.cohortName)])).entries()]
      .filter(([, label]) => label !== EMPTY_VALUE)
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    group: uniqueOptions(learners.map((learner) => displayValue(learner.group))),
    programStatus: uniqueOptions(learners.map((learner) => displayValue(learner.rawProgramStatus))),
    employer: uniqueOptions(learners.map((learner) => displayValue(learner.employer))),
  }), [learners, serverFilterOptions]);

  const matched = useMemo(() => {
    return learners.filter((learner) => {
      const insight = insights.get(learner.id);
      const performanceStatus = normalizedPerformanceStatus(learner.status);
      const useApiStatus = hasAuthoritativePerformanceStatus(learner.status);

      switch (statusFilter) {
        case 'at-risk':
          if (useApiStatus ? performanceStatus !== 'at-risk' : insight?.tier !== 'critical') return false;
          break;
        case 'need-attention':
          if (insight?.tier !== 'attention' && insight?.tier !== 'upcoming') return false;
          break;
        case 'upcoming':
          if (insight?.tier !== 'upcoming') return false;
          break;
        case 'on-track':
          if (useApiStatus
            ? performanceStatus !== 'on-track' && performanceStatus !== 'high'
            : insight?.tier !== 'on-track') return false;
          break;
        case 'needs-action':
          if (insight?.tier !== 'critical' && insight?.tier !== 'attention' && insight?.tier !== 'upcoming') return false;
          break;
        case 'break':
          if (getProgramStatusKey(learner.rawProgramStatus) !== 'break') return false;
          break;
        default:
          break;
      }

      // Search and stable placement filters have already been applied by the server.
      if (filters.employer !== 'all' && displayValue(learner.employer) !== filters.employer) return false;

      return true;
    });
  }, [learners, insights, statusFilter, filters]);

  const sorted = useMemo(() => {
    const numeric = (value: number | null | undefined, available = true) => available && Number.isFinite(value) ? Number(value) : null;
    const date = (value: string | null | undefined) => {
      if (!hasValue(value)) return null;
      const timestamp = Date.parse(value!);
      return Number.isNaN(timestamp) ? null : timestamp;
    };
    const valueFor = (learner: Learner): number | string | null => {
      switch (sortKey) {
        case 'name': return learner.name;
        case 'otjh': return numeric(learner.overallProgress, learner.overallProgressAvailable);
        case 'ksb': return numeric(learner.ksbProgress, learner.ksbProgressAvailable);
        case 'components': return learner.componentsPlanned ? numeric(((learner.componentsCompleted ?? 0) / learner.componentsPlanned) * 100) : null;
        case 'attendance': return numeric(learner.liveAttendanceRate, learner.liveAttendanceRateAvailable);
        case 'activity': return date([learner.lastActivity, learner.attendanceLastSession, learner.lastSubmittedEvidence, learner.lastContact].find(hasValue));
        case 'progress-review': return date(learner.lastProgressReview);
        case 'monthly-coaching': return date(learner.lastReview);
        default: return insights.get(learner.id)?.urgency ?? 0;
      }
    };
    const direction = sortDirection === 'asc' ? 1 : -1;
    return [...matched].sort((left, right) => {
      const leftValue = valueFor(left);
      const rightValue = valueFor(right);
      if (leftValue === null && rightValue === null) return left.name.localeCompare(right.name);
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      const delta = typeof leftValue === 'string'
        ? leftValue.localeCompare(String(rightValue), undefined, { sensitivity: 'base' })
        : leftValue - Number(rightValue);
      return (delta * direction) || left.name.localeCompare(right.name);
    });
  }, [matched, insights, sortDirection, sortKey]);

  const handleSort = useCallback((key: SortKey) => {
    setQueryValues({
      sort: key,
      direction: sortKey === key ? (sortDirection === 'asc' ? 'desc' : 'asc') : 'asc',
    }, { resetPage: true });
  }, [setQueryValues, sortDirection, sortKey]);

  const totalPages = Math.max(1, serverTotalPages);
  const safePage = Math.min(currentPage, totalPages);
  const paginated = sorted;

  const matchedIdKey = useMemo(() => sorted.map((learner) => learner.id).join(','), [sorted]);

  // A selection that survives filtering would export learners the coach can no
  // longer see, so it is narrowed to what is currently matched.
  useEffect(() => {
    const visible = new Set(matchedIdKey ? matchedIdKey.split(',') : []);
    setSelectedLearnerIds((current) => {
      if (current.size === 0) return current;
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [matchedIdKey]);

  const selectedLearners = useMemo(
    () => sorted.filter((learner) => selectedLearnerIds.has(learner.id)),
    [sorted, selectedLearnerIds],
  );

  const quickViewLearner = useMemo(
    () => (quickView ? learners.find((learner) => learner.id === quickView.learnerId) ?? null : null),
    [quickView, learners],
  );

  // --- handlers ------------------------------------------------------------

  const handleFilterChange = useCallback((patch: Partial<CaseloadFilterState>) => {
    setQueryValues({
      ...(patch.search !== undefined ? { search: patch.search } : {}),
      ...(patch.cohort !== undefined ? { cohort: patch.cohort } : {}),
      ...(patch.group !== undefined ? { group: patch.group } : {}),
      ...(patch.programStatus !== undefined ? { programmeStatus: patch.programStatus } : {}),
      ...(patch.employer !== undefined ? { employer: patch.employer } : {}),
    }, { resetPage: true });
  }, [setQueryValues]);

  const handleStatusFilterChange = useCallback((next: StatusFilter) => {
    setQueryValues({ view: next }, { resetPage: true });
  }, [setQueryValues]);

  const handleClearAll = useCallback(() => {
    resetQuery(['search', 'cohort', 'group', 'programmeStatus', 'employer', 'view', 'page']);
  }, [resetQuery]);

  const handleToggleSelect = useCallback((learnerId: string) => {
    setSelectedLearnerIds((current) => {
      const next = new Set(current);
      if (next.has(learnerId)) next.delete(learnerId);
      else next.add(learnerId);
      return next;
    });
  }, []);

  const handleQuickView = useCallback((learner: Learner, tab: QuickViewTab = 'overview') => {
    setQuickView({ learnerId: learner.id, tab });
  }, []);

  const handleCloseQuickView = useCallback(() => setQuickView(null), []);

  const openProfile = useCallback((learner: Learner, tab?: string) => {
    navigate('/coach/learner-case-file', {
      state: {
        learnerId: learner.id,
        learnerName: learner.name,
        ...(learner.learnerType ? { kind: learner.learnerType } : {}),
        ...(learner.enrolmentId ? { enrolmentId: learner.enrolmentId } : {}),
        ...(tab ? { tab } : {}),
      },
    });
  }, [navigate]);

  const handleOpenProfile = useCallback((learner: Learner) => openProfile(learner), [openProfile]);

  const runExport = useCallback((rows: Learner[]) => {
    if (rows.length === 0) return;
    setIsExportingPdf(true);
    // Deferred a tick so the spinner paints before jsPDF blocks the thread.
    window.setTimeout(() => {
      try {
        downloadLearnersPdf(rows, ownerName, insights);
      } finally {
        setIsExportingPdf(false);
        setSelectionMode(false);
        setSelectedLearnerIds(new Set());
      }
    }, 0);
  }, [insights, ownerName]);

  const handleExportCurrentView = useCallback(() => runExport(sorted), [runExport, sorted]);
  const handleExportSelected = useCallback(() => runExport(selectedLearners), [runExport, selectedLearners]);

  const handleStartSelection = useCallback(() => setSelectionMode(true), []);
  const handleCancelSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedLearnerIds(new Set());
  }, []);

  const handleSelectAllMatched = useCallback(() => {
    setSelectedLearnerIds(new Set(sorted.map((learner) => learner.id)));
  }, [sorted]);

  const handleSelectPage = useCallback(() => {
    setSelectedLearnerIds((current) => {
      const next = new Set(current);
      const allSelected = paginated.every((learner) => next.has(learner.id));
      paginated.forEach((learner) => {
        if (allSelected) next.delete(learner.id);
        else next.add(learner.id);
      });
      return next;
    });
  }, [paginated]);

  const handleRetry = useCallback(() => setReloadToken((token) => token + 1), []);

  // --- render --------------------------------------------------------------

  const hasFiltersApplied = statusFilter !== 'all'
    || Object.entries(filters).some(([key, value]) => value !== INITIAL_FILTERS[key as keyof CaseloadFilterState]);
  const allPageSelected = paginated.length > 0 && paginated.every((learner) => selectedLearnerIds.has(learner.id));

  // A super-admin cannot read an arbitrary coach caseload until a coach has
  // been selected. Reuse the existing directory picker instead of showing a
  // misleading empty/error state when a deep link lands here first.
  if (isInitialized && coach.canChooseCoach && !coach.isViewingAsCoach) {
    return embedded ? null : <Navigate to="/workspace/coach#learner-caseload" replace />;
  }

  const needsLiveSignIn = isInitialized && !auth.account && !authenticatedCoachEmail;

  return (
    <>
      <section className={`${styles.page} ${embedded ? styles.embedded : ''}`} aria-label="Coach learner caseload">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className={styles.title}>
            <h1>{embedded ? 'All Learners' : 'My Learners'}</h1>
            {!embedded ? <p>Monitor learner progress and engagement</p> : null}
          </div>
          <LearnersHeaderActions
            selectionMode={selectionMode}
            selectedCount={selectedLearners.length}
            isExporting={isExportingPdf}
            exportDisabled={sorted.length === 0}
            onExportCurrentView={handleExportCurrentView}
            onStartSelection={handleStartSelection}
            onExportSelected={handleExportSelected}
            onCancelSelection={handleCancelSelection}
          />
        </header>

        <section className={styles.panel}>
          {!error && learners.length > 0 ? (
            <div className={styles.toolbar}>
              <LearnerToolbar
                filters={filters}
                options={filterOptions}
                statusFilter={statusFilter}
                onFilterChange={handleFilterChange}
                onStatusFilterChange={handleStatusFilterChange}
                onClearAll={handleClearAll}
              />
            </div>
          ) : null}

          {selectionMode && !loading && !error && sorted.length > 0 ? (
            <div className={styles.selection}>
              <span className="text-[12px] font-semibold text-primary-800">
                {selectedLearners.length} selected
              </span>
              <span className="text-foreground-300">·</span>
              <button
                type="button"
                onClick={handleSelectPage}
                className="text-[12px] font-semibold text-primary-700 underline-offset-2 transition hover:underline"
              >
                {allPageSelected ? `Clear this page (${paginated.length})` : `Select this page (${paginated.length})`}
              </button>
              <button
                type="button"
                onClick={handleSelectAllMatched}
                disabled={selectedLearners.length === sorted.length}
                className="text-[12px] font-semibold text-primary-700 underline-offset-2 transition hover:underline disabled:opacity-40 disabled:hover:no-underline"
              >
                Select all {sorted.length} matching
              </button>
              {selectedLearners.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelectedLearnerIds(new Set())}
                  className="text-[12px] font-semibold text-foreground-500 underline-offset-2 transition hover:underline"
                >
                  Clear selection
                </button>
              ) : null}
              <span className="ml-auto text-[12px] text-foreground-500">
                Selections stay active while you move between pages.
              </span>
            </div>
          ) : null}

          {loading ? (
            <CaseloadLoading />
          ) : error ? (
            <CaseloadError
              message={error}
              onRetry={handleRetry}
              action={needsLiveSignIn ? { label: 'Sign in', onClick: () => navigate('/login', { state: { from: '/workspace/coach#learner-caseload' } }) } : undefined}
            />
          ) : learners.length === 0 ? (
            <CaseloadEmpty />
          ) : sorted.length === 0 ? (
            <CaseloadNoMatches onClearFilters={handleClearAll} />
          ) : (
            <LearnerTable
              learners={paginated}
              insights={insights}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={handleSort}
              selectedLearnerIds={selectedLearnerIds}
              selectionMode={selectionMode}
              onToggleSelect={handleToggleSelect}
              onOpenProfile={handleOpenProfile}
            />
          )}

          {!loading && !error && sorted.length > 0 ? (
            <Pagination
              page={safePage}
              totalPages={totalPages}
              total={serverTotal}
              pageSize={PAGE_SIZE}
              onPageChange={(nextPage) => setQueryValues({ page: nextPage }, { replace: false })}
            />
          ) : null}
        </section>

        {hasFiltersApplied && !loading && !error && sorted.length > 0 ? (
          <p className={styles.footerNote}>
            Showing {sorted.length} learners on this page from {serverTotal} matching learners.
          </p>
        ) : null}
      </section>

      <LearnerQuickViewDrawer
        learner={quickViewLearner}
        insight={quickViewLearner ? insights.get(quickViewLearner.id) ?? null : null}
        initialTab={quickView?.tab ?? 'overview'}
        onClose={handleCloseQuickView}
        onOpenProfile={openProfile}
      />
    </>
  );
}

/** The former standalone page now has one canonical home on the coach dashboard. */
export default function CoachCaseload() {
  return <Navigate to="/workspace/coach#learner-caseload" replace />;
}
