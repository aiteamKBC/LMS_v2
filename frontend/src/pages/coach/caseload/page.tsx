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
//   PATCH /coach_api/coach/caseload/{id}/coach-rag
// Two requests for the whole page. Nothing is fetched per card, and the quick
// view adds no request of its own — both payloads already carry what it shows.
//
// This component owns state and wiring only. Anything that renders lives in
// ./components, anything that computes lives in ./lib.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/hooks/useAuth';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { roleNavMap } from '@/mocks/navigation';
import { coachFetch } from '@/lib/coachFetch';

import { CaseloadEmpty, CaseloadError, CaseloadLoading, CaseloadNoMatches } from './components/CaseloadStates';
import { LearnerCardGrid } from './components/LearnerCardGrid';
import { LearnerQuickViewDrawer } from './components/LearnerQuickViewDrawer';
import { LearnerStatusTabs } from './components/LearnerStatusTabs';
import { LearnerTable } from './components/LearnerTable';
import { LearnerToolbar, type CaseloadFilterState } from './components/LearnerToolbar';
import { LearnersHeaderActions } from './components/LearnersHeader';
import { Pagination } from './components/Pagination';
import { buildInsightMap, countCaseload } from './lib/attention';
import { downloadLearnersPdf } from './lib/exportPdf';
import {
  EMPTY_VALUE,
  displayValue,
  findAttendanceRecord,
  formatCoachRagValue,
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
  ViewMode,
} from './types';

const coachNav = roleNavMap.coach;

const CASELOAD_ENDPOINT = '/coach_api/coach/caseload';
const ATTENDANCE_ENDPOINT = '/coach_api/coach/attendance';
const coachRagEndpoint = (learnerId: string) => `/coach_api/coach/caseload/${learnerId}/coach-rag`;

/** Cards breathe at a dozen; the table is for working through a long list. */
const DEFAULT_PAGE_SIZE: Record<ViewMode, number> = { cards: 12, table: 50 };

const INITIAL_FILTERS: CaseloadFilterState = {
  search: '',
  cohort: 'all',
  group: 'all',
  coachRag: 'all',
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

function uniqueOptions(values: string[]): FilterOption[] {
  return [...new Set(values.filter((value) => value && value !== EMPTY_VALUE))]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));
}

const COACH_RAG_ORDER: Record<string, number> = { Red: 0, Amber: 1, Green: 2 };

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

  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE.cards);
  const [currentPage, setCurrentPage] = useState(1);

  const [quickView, setQuickView] = useState<{ learnerId: string; tab: QuickViewTab } | null>(null);
  const [savingCoachRagId, setSavingCoachRagId] = useState<string | null>(null);
  const [coachRagSaveError, setCoachRagSaveError] = useState<string | null>(null);

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
        const caseloadResponse = await coachFetch(CASELOAD_ENDPOINT, { signal: controller.signal });
        if (!caseloadResponse.ok) {
          const payload = await caseloadResponse.json().catch(() => ({})) as { detail?: string; message?: string };
          throw new Error(payload.detail || payload.message || `Request failed with status ${caseloadResponse.status}`);
        }

        const data: CaseloadApiResponse = await caseloadResponse.json();
        const attendanceLearners = await fetchAttendanceLearners(controller.signal);

        setOwnerName(data.owner?.name || authenticatedCoachName);
        setLearners((data.learners || []).map((learner) => (
          normalizeLearner(learner, findAttendanceRecord(learner, attendanceLearners))
        )));
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
    coachRag: uniqueOptions(learners.map((learner) => displayValue(learner.coachRag)))
      .sort((left, right) => (COACH_RAG_ORDER[left.value] ?? 99) - (COACH_RAG_ORDER[right.value] ?? 99)),
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
          if (insight?.tier !== 'attention') return false;
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
      if (filters.coachRag !== 'all' && displayValue(learner.coachRag) !== filters.coachRag) return false;
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
        case 'components': return learner.attendanceRateAvailable ? learner.attendanceRate : -1;
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

  const handleColumnSort = useCallback((key: SortKey) => {
    setSortKey((currentKey) => {
      if (currentKey === key) {
        setSortDir((currentDir) => (currentDir === 'asc' ? 'desc' : 'asc'));
        return currentKey;
      }
      setSortDir(key === 'name' ? 'asc' : 'desc');
      return key;
    });
    setCurrentPage(1);
  }, []);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setPageSize(DEFAULT_PAGE_SIZE[mode]);
    setCurrentPage(1);
  }, []);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
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
      state: { learnerId: learner.id, learnerName: learner.name, ...(tab ? { tab } : {}) },
    });
  }, [navigate]);

  const handleOpenProfile = useCallback((learner: Learner) => openProfile(learner), [openProfile]);

  const handleCoachRagChange = useCallback(async (learnerId: string, nextValue: string) => {
    const previousValue = learners.find((learner) => learner.id === learnerId)?.coachRag || EMPTY_VALUE;
    const applyValue = (value: string | null | undefined) => {
      setLearners((current) => current.map((learner) => (
        learner.id === learnerId ? { ...learner, coachRag: formatCoachRagValue(value) } : learner
      )));
    };

    setCoachRagSaveError(null);
    setSavingCoachRagId(learnerId);
    // Optimistic, then reconciled against whatever the server stored.
    applyValue(nextValue);

    try {
      const response = await coachFetch(coachRagEndpoint(learnerId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachRag: nextValue || null }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || `Request failed with status ${response.status}`);
      }
      applyValue(payload.coachRag);
    } catch (err) {
      console.error('Unable to save coach RAG', err);
      applyValue(previousValue);
      setCoachRagSaveError('Unable to save Coach RAG right now.');
    } finally {
      setSavingCoachRagId((current) => (current === learnerId ? null : current));
    }
  }, [learners]);

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
      <PageContainer>
        <PageHeader
          icon="ri-group-line"
          title="My Learners"
          description="Monitor learner progress, identify risks and take action."
          actions={(
            <LearnersHeaderActions
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              selectionMode={selectionMode}
              selectedCount={selectedLearners.length}
              isExporting={isExportingPdf}
              exportDisabled={sorted.length === 0}
              onExportCurrentView={handleExportCurrentView}
              onStartSelection={handleStartSelection}
              onExportSelected={handleExportSelected}
              onCancelSelection={handleCancelSelection}
            />
          )}
        />

        {!loading && !error && learners.length > 0 ? (
          <LearnerStatusTabs value={statusFilter} counts={counts} onChange={handleStatusFilterChange} />
        ) : null}

        <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {!error && learners.length > 0 ? (
            <div className="border-b border-foreground-100 p-3.5">
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
            <div className="flex flex-wrap items-center gap-2 border-b border-foreground-100 bg-primary-50/40 px-3.5 py-2.5">
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

          {coachRagSaveError ? (
            <div className="flex items-center justify-between gap-3 border-b border-red-100 bg-red-50 px-3.5 py-2 text-[12px] text-red-700">
              {coachRagSaveError}
              <button
                type="button"
                onClick={() => setCoachRagSaveError(null)}
                className="font-semibold underline-offset-2 hover:underline"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {loading ? (
            <CaseloadLoading viewMode={viewMode} />
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
          ) : viewMode === 'cards' ? (
            <div className="p-3.5">
              <LearnerCardGrid
                learners={paginated}
                insights={insights}
                selectedLearnerIds={selectedLearnerIds}
                selectionMode={selectionMode}
                onToggleSelect={handleToggleSelect}
                onQuickView={handleQuickView}
                onOpenProfile={handleOpenProfile}
              />
            </div>
          ) : (
            <LearnerTable
              learners={paginated}
              insights={insights}
              selectedLearnerIds={selectedLearnerIds}
              selectionMode={selectionMode}
              sortKey={sortKey}
              sortDir={sortDir}
              savingCoachRagId={savingCoachRagId}
              onSort={handleColumnSort}
              onToggleSelect={handleToggleSelect}
              onQuickView={handleQuickView}
              onOpenProfile={handleOpenProfile}
              onCoachRagChange={handleCoachRagChange}
            />
          )}

          {!loading && !error && sorted.length > 0 ? (
            <Pagination
              page={safePage}
              totalPages={totalPages}
              total={sorted.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={handlePageSizeChange}
            />
          ) : null}
        </section>

        {hasFiltersApplied && !loading && !error && sorted.length > 0 ? (
          <p className="px-1 text-[12px] text-foreground-400">
            Showing {sorted.length} of {learners.length} learners in your caseload.
          </p>
        ) : null}
      </PageContainer>

      <LearnerQuickViewDrawer
        learner={quickViewLearner}
        insight={quickViewLearner ? insights.get(quickViewLearner.id) ?? null : null}
        initialTab={quickView?.tab ?? 'overview'}
        savingCoachRag={savingCoachRagId === quickViewLearner?.id}
        onClose={handleCloseQuickView}
        onCoachRagChange={handleCoachRagChange}
        onOpenProfile={openProfile}
      />
    </WorkspaceShell>
  );
}
