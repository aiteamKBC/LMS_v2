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
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useAuth } from '@/hooks/useAuth';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { roleNavMap } from '@/mocks/navigation';
import { coachFetch } from '@/lib/coachFetch';
import { fetchCoachCalendarEvents, type CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';

import { CaseloadEmpty, CaseloadError, CaseloadLoading, CaseloadNoMatches, CaseloadSummaryLoading } from './components/CaseloadStates';
import { CaseloadSummary } from './components/CaseloadSummary';
import { LearnerTable } from './components/LearnerTable';
import { LearnerQuickViewDrawer } from './components/LearnerQuickViewDrawer';
import { LearnerToolbar, type CaseloadFilterState } from './components/LearnerToolbar';
import { LearnersHeaderActions } from './components/LearnersHeader';
import { Pagination } from './components/Pagination';
import { buildInsightMap, countCaseload } from './lib/attention';
import { downloadLearnersPdf } from './lib/exportPdf';
import {
  EMPTY_VALUE,
  displayValue,
  findAttendanceRecord,
  getProgramStatusKey,
  normalizeLearner,
  parseDisplayDate,
  startOfToday,
} from './lib/format';
import type {
  AttendanceApiLearner,
  AttendanceApiResponse,
  CaseloadApiResponse,
  FilterOption,
  Learner,
  QuickViewTab,
  SortDirection,
  SortKey,
  StatusFilter,
} from './types';
import styles from './caseload.module.css';

const coachNav = roleNavMap.coach;

const CASELOAD_ENDPOINT = '/coach_api/coach/caseload?live=1';
const ATTENDANCE_ENDPOINT = '/coach_api/coach/attendance';

const PAGE_SIZE = 10;

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

export default function CoachCaseload() {
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

  const [filters, setFilters] = useState<CaseloadFilterState>(INITIAL_FILTERS);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('risk');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  const pageSize = PAGE_SIZE;
  const [currentPage, setCurrentPage] = useState(1);

  const [quickView, setQuickView] = useState<{ learnerId: string; tab: QuickViewTab } | null>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedLearnerIds, setSelectedLearnerIds] = useState<Set<string>>(() => new Set());
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // One "today" per mount. Every day-offset on the page is measured from the
  // same instant, so two rows can never disagree about how far away a date is.
  const today = useMemo(() => startOfToday(), []);

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
        const [caseloadResponse, attendanceLearners, completedReviews] = await Promise.all([
          coachFetch(CASELOAD_ENDPOINT, { signal: controller.signal }),
          fetchAttendanceLearners(controller.signal),
          fetchLastCompletedReviews(controller.signal),
        ]);
        if (!caseloadResponse.ok) {
          const payload = await caseloadResponse.json().catch(() => ({})) as { detail?: string; message?: string };
          throw new Error(payload.detail || payload.message || `Request failed with status ${caseloadResponse.status}`);
        }

        const data: CaseloadApiResponse = await caseloadResponse.json();
        if (controller.signal.aborted) return;
        setOwnerName(data.owner?.name || authenticatedCoachName);
        setLearners((data.learners || []).map((source) => {
          const normalized = normalizeLearner(source, findAttendanceRecord(source, attendanceLearners));
          const reviews = completedReviews.get(normalized.id);
          return {
            ...normalized,
            lastProgressReview: reviews?.pr || '--',
            lastReview: reviews?.mcm || '--',
          };
        }));
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
  }, [auth.account, authenticatedCoachEmail, authenticatedCoachName, isInitialized, reloadToken]);

  // --- derived data ---------------------------------------------------------

  // The one expensive computation on the page, and the only place risk is
  // decided. Keyed on the learner list, so filtering and sorting never redo it.
  const insights = useMemo(() => buildInsightMap(learners, today), [learners, today]);
  const counts = useMemo(() => countCaseload(learners, insights), [learners, insights]);

  const filterOptions = useMemo(() => ({
    cohort: [...new Map(learners.map((learner) => [learner.cohortId, displayValue(learner.cohortName)])).entries()]
      .filter(([, label]) => label !== EMPTY_VALUE)
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    group: uniqueOptions(learners.map((learner) => displayValue(learner.group))),
    programStatus: uniqueOptions(learners.map((learner) => displayValue(learner.rawProgramStatus))),
    employer: uniqueOptions(learners.map((learner) => displayValue(learner.employer))),
  }), [learners]);

  const matched = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return learners.filter((learner) => {
      const insight = insights.get(learner.id);

      switch (statusFilter) {
        case 'at-risk':
          if (insight?.tier !== 'critical') return false;
          break;
        case 'need-attention':
          if (insight?.tier !== 'attention' && insight?.tier !== 'upcoming') return false;
          break;
        case 'upcoming':
          if (insight?.tier !== 'upcoming') return false;
          break;
        case 'on-track':
          if (insight?.tier !== 'on-track') return false;
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

      if (filters.cohort !== 'all' && learner.cohortId !== filters.cohort) return false;
      if (filters.group !== 'all' && displayValue(learner.group) !== filters.group) return false;
      if (filters.programStatus !== 'all' && displayValue(learner.rawProgramStatus) !== filters.programStatus) return false;
      if (filters.employer !== 'all' && displayValue(learner.employer) !== filters.employer) return false;

      if (search) {
        // Name and email are what a coach types; cohort, group and employer stay
        // searchable because the previous page allowed them and people rely on it.
        const haystack = [
          learner.name,
          learner.email,
          learner.cohortName,
          learner.group,
          learner.employer,
          learner.programmeName,
        ];
        if (!haystack.some((field) => field?.toLowerCase().includes(search))) return false;
      }

      return true;
    });
  }, [learners, insights, statusFilter, filters]);

  const sorted = useMemo(() => {
    const direction = sortDir === 'asc' ? 1 : -1;
    const gatewayTime = (learner: Learner) => {
      const parsed = parseDisplayDate(learner.gatewayReviewDate);
      // Undated learners sort last in either direction rather than clumping at
      // the top as an epoch-zero block.
      return parsed ? parsed.getTime() : Number.POSITIVE_INFINITY;
    };

    const value = (learner: Learner): number => {
      switch (sortKey) {
        case 'risk': return insights.get(learner.id)?.urgency ?? 0;
        case 'progress': return learner.overallProgressAvailable ? learner.overallProgress : -1;
        case 'attendance': return learner.liveAttendanceRateAvailable ? learner.liveAttendanceRate ?? -1 : -1;
        case 'otjh': return learner.otjhCompleted;
        // Matches the card's Components display: completed against the whole
        // programme component total, not the to-date target.
        case 'components': return learner.componentsPlanned && learner.componentsPlanned > 0
          ? ((learner.componentsCompleted ?? 0) / learner.componentsPlanned) * 100
          : -1;
        case 'ksb': return learner.ksbProgressAvailable ? learner.ksbProgress : -1;
        case 'gateway': return gatewayTime(learner);
        default: return 0;
      }
    };

    return [...matched].sort((left, right) => {
      if (sortKey === 'name') {
        return direction * left.name.localeCompare(right.name);
      }
      const delta = value(left) - value(right);
      // Name is the tie-break everywhere, so equal rows keep a stable order.
      return delta !== 0 ? direction * delta : left.name.localeCompare(right.name);
    });
  }, [matched, insights, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = useMemo(
    () => sorted.slice((safePage - 1) * pageSize, (safePage - 1) * pageSize + pageSize),
    [sorted, safePage, pageSize],
  );

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
    setFilters((current) => ({ ...current, ...patch }));
    setCurrentPage(1);
  }, []);

  const handleStatusFilterChange = useCallback((next: StatusFilter) => {
    setStatusFilter(next);
    setCurrentPage(1);
  }, []);

  const handleClearAll = useCallback(() => {
    setFilters(INITIAL_FILTERS);
    setStatusFilter('all');
    setCurrentPage(1);
  }, []);

  const handleSortKeyChange = useCallback((next: SortKey) => {
    setSortKey(next);
    // Names read A–Z; every other column is interesting at its extreme.
    setSortDir(next === 'name' ? 'asc' : 'desc');
    setCurrentPage(1);
  }, []);

  const handleSortDirToggle = useCallback(() => {
    setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    setCurrentPage(1);
  }, []);

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
    return <Navigate to="/workspace/coach" replace />;
  }

  const needsLiveSignIn = isInitialized && !auth.account && !authenticatedCoachEmail;

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="My Learners"
      pageSubtitle="Monitor learner progress, identify risks and take action"
      userName={ownerName}
      userRole="Progress Coach"
    >
      <main className={styles.page}>
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className={styles.title}>
            <h1>My Learners</h1>
            <p>Monitor learner progress and engagement</p>
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

        {loading ? <CaseloadSummaryLoading /> : !error && learners.length > 0 ? (
          <CaseloadSummary counts={counts} value={statusFilter} onChange={handleStatusFilterChange} />
        ) : null}

        <section className={styles.panel}>
          {!error && learners.length > 0 ? (
            <div className={styles.toolbar}>
              <LearnerToolbar
                filters={filters}
                options={filterOptions}
                sortKey={sortKey}
                sortDir={sortDir}
                resultCount={sorted.length}
                onFilterChange={handleFilterChange}
                onSortKeyChange={handleSortKeyChange}
                onSortDirToggle={handleSortDirToggle}
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
              action={needsLiveSignIn ? { label: 'Sign in', onClick: () => navigate('/login', { state: { from: '/coach/caseload' } }) } : undefined}
            />
          ) : learners.length === 0 ? (
            <CaseloadEmpty />
          ) : sorted.length === 0 ? (
            <CaseloadNoMatches onClearFilters={handleClearAll} />
          ) : (
            <LearnerTable
              learners={paginated}
              insights={insights}
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
              total={sorted.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
            />
          ) : null}
        </section>

        {hasFiltersApplied && !loading && !error && sorted.length > 0 ? (
          <p className={styles.footerNote}>
            Showing {sorted.length} of {learners.length} learners in your caseload.
          </p>
        ) : null}
      </main>

      <LearnerQuickViewDrawer
        learner={quickViewLearner}
        insight={quickViewLearner ? insights.get(quickViewLearner.id) ?? null : null}
        initialTab={quickView?.tab ?? 'overview'}
        onClose={handleCloseQuickView}
        onOpenProfile={openProfile}
      />
    </WorkspaceShell>
  );
}
