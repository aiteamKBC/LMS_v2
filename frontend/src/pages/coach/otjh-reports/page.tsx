import { useEffect, useMemo, useRef, useState } from 'react';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';
import { cn } from '@/lib/cn';
import { type StatusTone } from '@/lib/statusTone';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { CompactMetric } from '@/components/ui/MetricCard';
import { PageTabs, type PageTabItem } from '@/components/ui/PageTabs';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ProgressBar, ProgressMetric } from '@/components/ui/ProgressMetric';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { RowAction } from '@/components/ui/ActionRow';
import { LearnerAvatar, LearnerIdentity } from '@/pages/coach/shared/LearnerIdentity';

const coachNav = roleNavMap.coach;
const API_ENDPOINT = '/coach_api/coach/caseload';
const ROWS_PER_PAGE = 10;

type FilterKey = 'all' | 'behind' | 'need-attention' | 'on-track';
type OtjhRowStatus = 'behind' | 'on-track' | 'ahead' | 'need-attention' | 'unknown';
type RiskTone = 'red' | 'amber' | 'green' | 'neutral';
type OtjhDetailFocus = 'summary' | 'planned' | 'target' | 'completed' | 'remaining';

interface CaseloadApiLearner {
  id: string;
  name: string;
  initials: string;
  email?: string | null;
  employer?: string;
  employerEmail?: string | null;
  cohortName?: string;
  group?: string;
  rawProgramStatus?: string;
  coachRag?: string;
  progressVariance?: string;
  startDate?: string;
  plannedEndDate?: string;
  gatewayReviewDate?: string;
  otjhCompleted?: number;
  otjhMinimum?: number;
  otjhPlanned?: number;
  otjhSubmitted?: number;
  otjhForecast?: number;
  otjhExpected?: number;
  otjhProgressHours?: string;
  otjhTarget?: number;
  otjhStatus?: string;
  ksbStatus?: string;
  ksbProgress?: number;
  evidenceCount?: number;
  overallProgress?: number;
  otjhCompletedEntries?: Array<{
    id?: string;
    title?: string;
    typeLabel?: string;
    kind?: string;
    module?: string;
    week?: string;
    reportedTime?: string;
    hours?: number;
    completedAt?: string;
    completedDate?: string;
    detail?: string;
    ksbs?: string[];
  }>;
}

interface CaseloadApiResponse {
  owner?: {
    name?: string;
    email?: string;
  };
  learners?: CaseloadApiLearner[];
}

interface OtjhRow {
  id: string;
  learner: string;
  initials: string;
  email: string;
  programme: string;
  group: string;
  employer: string;
  employerEmail: string;
  programStatus: string;
  coachRag: string;
  progressVariance: string;
  startDate: string;
  plannedEndDate: string;
  gatewayReviewDate: string;
  target: number;
  minimum: number;
  planned: number;
  submitted: number;
  completed: number;
  forecast: number;
  expected: number;
  progressHours: string;
  remaining: number;
  pace: number;
  ksbStatus: string;
  ksbProgress: number;
  evidenceCount: number;
  overallProgress: number;
  status: OtjhRowStatus;
  statusLabel: string;
  risk: RiskTone;
  completedEntries: Array<{
    id: string;
    title: string;
    typeLabel: string;
    kind: string;
    module: string;
    week: string;
    reportedTime: string;
    hours: number;
    completedAt: string;
    completedDate: string;
    detail: string;
    ksbs: string[];
  }>;
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatHours(value: number): string {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value);
}

function displayText(value?: string | null): string {
  const trimmed = (value || '').trim();
  return trimmed || '--';
}

function normalizeOtjhStatus(status?: string): OtjhRowStatus {
  const normalized = (status || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (normalized === 'atrisk') return 'behind';
  if (normalized === 'ontrack') return 'on-track';
  if (normalized === 'ahead') return 'ahead';
  if (normalized === 'needattention') return 'need-attention';
  return 'unknown';
}

function getStatusLabel(status: OtjhRowStatus): string {
  if (status === 'behind') return 'At Risk';
  if (status === 'on-track') return 'On Track';
  if (status === 'ahead') return 'Ahead';
  if (status === 'need-attention') return 'Need Attention';
  return '--';
}

function getRiskTone(status: OtjhRowStatus): RiskTone {
  if (status === 'behind') return 'red';
  if (status === 'need-attention') return 'amber';
  if (status === 'on-track' || status === 'ahead') return 'green';
  return 'neutral';
}

/** The one place an OTJH risk tone becomes a workspace-wide StatusTone. */
function riskToneOf(risk: RiskTone): StatusTone {
  if (risk === 'red') return 'critical';
  if (risk === 'amber') return 'caution';
  if (risk === 'green') return 'positive';
  return 'neutral';
}

function getFocusCardStyle(focus: OtjhDetailFocus, activeFocus: OtjhDetailFocus): string {
  return focus === activeFocus
    ? 'border-primary-300 bg-primary-50/70 ring-2 ring-primary-200'
    : 'border-foreground-200/60 bg-background-100/40';
}

function toOtjhRow(learner: CaseloadApiLearner): OtjhRow {
  const target = Math.max(toNumber(learner.otjhTarget), 0);
  const minimum = Math.max(toNumber(learner.otjhMinimum), 0);
  const planned = Math.max(toNumber(learner.otjhPlanned), 0);
  const completed = Math.max(toNumber(learner.otjhCompleted), 0);
  const denominator = target > 0 ? target : Math.max(planned, 1);
  const statusFromDb = normalizeOtjhStatus(learner.otjhStatus);
  const status = statusFromDb === 'unknown' && denominator > 0 && completed > denominator ? 'ahead' : statusFromDb;
  const pace = denominator > 0 ? Math.round((completed / denominator) * 100) : 0;
  const completedEntries = Array.isArray(learner.otjhCompletedEntries)
    ? learner.otjhCompletedEntries.map((entry, index) => ({
        id: String(entry.id || `completed-entry-${learner.id}-${index}`),
        title: displayText(entry.title),
        typeLabel: displayText(entry.typeLabel || entry.kind),
        kind: displayText(entry.kind),
        module: displayText(entry.module),
        week: displayText(entry.week),
        reportedTime: displayText(entry.reportedTime),
        hours: Math.max(toNumber(entry.hours), 0),
        completedAt: displayText(entry.completedAt),
        completedDate: displayText(entry.completedDate),
        detail: displayText(entry.detail),
        ksbs: Array.isArray(entry.ksbs) ? entry.ksbs.map(code => displayText(code)).filter(code => code !== '--') : [],
      }))
    : [];

  return {
    id: learner.id,
    learner: learner.name,
    initials: learner.initials,
    email: displayText(learner.email),
    programme: displayText(learner.cohortName),
    group: displayText(learner.group),
    employer: displayText(learner.employer),
    employerEmail: displayText(learner.employerEmail),
    programStatus: displayText(learner.rawProgramStatus),
    coachRag: displayText(learner.coachRag),
    progressVariance: displayText(learner.progressVariance),
    startDate: displayText(learner.startDate),
    plannedEndDate: displayText(learner.plannedEndDate),
    gatewayReviewDate: displayText(learner.gatewayReviewDate),
    target,
    minimum,
    planned,
    submitted: Math.max(toNumber(learner.otjhSubmitted), 0),
    completed,
    forecast: Math.max(toNumber(learner.otjhForecast), 0),
    expected: Math.max(toNumber(learner.otjhExpected), 0),
    progressHours: displayText(learner.otjhProgressHours),
    remaining: Math.max(denominator - completed, 0),
    pace,
    ksbStatus: displayText(learner.ksbStatus),
    ksbProgress: Math.max(toNumber(learner.ksbProgress), 0),
    evidenceCount: Math.max(toNumber(learner.evidenceCount), 0),
    overallProgress: Math.max(toNumber(learner.overallProgress), 0),
    status,
    statusLabel: getStatusLabel(status),
    risk: getRiskTone(status),
    completedEntries,
  };
}

/**
 * One planned / target / completed / remaining cell. `emphasis` bolds the
 * headline figure by weight only — colour stays for risk, never for "this is
 * the important number".
 */
function OtjhValueButton({
  value,
  label,
  emphasis = false,
  onClick,
}: {
  value: number;
  label: string;
  emphasis?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Open ${label} OTJH details`}
      className="mx-auto block min-w-16 rounded-lg px-3 py-2 text-center transition hover:bg-primary-50 hover:ring-1 hover:ring-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-300"
    >
      <span className={cn('text-[12px] font-bold tabular-nums', emphasis ? 'text-foreground-900' : 'text-foreground-600')}>
        {formatHours(value)}
      </span>
    </button>
  );
}

export default function CoachOtjhReports() {
  const coach = useCoachIdentity();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [rows, setRows] = useState<OtjhRow[]>([]);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [selectedDetailFocus, setSelectedDetailFocus] = useState<OtjhDetailFocus>('summary');
  const [ownerName, setOwnerName] = useState('Coach');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const completedBreakdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!coach.isInitialized) return;
    if (!coach.email) {
      setRows([]);
      setOwnerName(coach.name);
      setError('Coach access is required to load OTJH data.');
      setLoading(false);
      return;
    }
    const controller = new AbortController();

    async function loadOtjhData() {
      setLoading(true);
      setError(null);

      try {
        const response = await coachFetch(API_ENDPOINT, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = (await response.json()) as CaseloadApiResponse;
        setOwnerName(payload.owner?.name || coach.name);
        setRows((payload.learners || []).map(toOtjhRow));
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setRows([]);
        setError('Unable to load live OTJH data right now.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadOtjhData();

    return () => controller.abort();
  }, [coach.email, coach.isInitialized, coach.name]);

  const stats = useMemo(() => {
    const totalTarget = rows.reduce((total, row) => total + row.target, 0);
    const totalPlanned = rows.reduce((total, row) => total + row.planned, 0);
    const totalCompleted = rows.reduce((total, row) => total + row.completed, 0);
    const behind = rows.filter(row => row.status === 'behind').length;
    const onTrack = rows.filter(row => row.status === 'on-track').length;
    const needAttention = rows.filter(row => row.status === 'need-attention').length;
    const completion = totalTarget > 0 ? Math.round((totalCompleted / totalTarget) * 100) : 0;

    return { totalTarget, totalPlanned, totalCompleted, behind, onTrack, needAttention, completion };
  }, [rows]);

  const filteredRows = useMemo(
    () => rows.filter(row => filter === 'all' || row.status === filter),
    [filter, rows],
  );
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE));
  const activePage = Math.min(currentPage, pageCount);
  const paginatedRows = filteredRows.slice((activePage - 1) * ROWS_PER_PAGE, activePage * ROWS_PER_PAGE);

  const changeFilter = (nextFilter: FilterKey) => {
    setFilter(nextFilter);
    setCurrentPage(1);
  };

  const filterTabItems: PageTabItem[] = [
    { value: 'all', label: 'All', count: rows.length },
    { value: 'behind', label: 'At Risk', count: stats.behind, tone: 'critical' },
    { value: 'need-attention', label: 'Need Attention', count: stats.needAttention, tone: 'caution' },
    { value: 'on-track', label: 'On Track', count: stats.onTrack, tone: 'positive' },
  ];

  const selectedRow = rows.find(row => row.id === selectedRowId) || null;

  useEffect(() => {
    if (!selectedRow || selectedDetailFocus !== 'completed') return;

    const timer = window.setTimeout(() => {
      completedBreakdownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [selectedRow, selectedDetailFocus]);

  const handleViewDetails = (row: OtjhRow, focus: OtjhDetailFocus = 'summary') => {
    setSelectedRowId(row.id);
    setSelectedDetailFocus(focus);
  };

  const closeDetails = () => {
    setSelectedRowId(null);
    setSelectedDetailFocus('summary');
  };

  const otjhColumns: DataColumn<OtjhRow>[] = [
    {
      key: 'learner',
      label: 'Learner',
      widthClass: 'min-w-[220px]',
      render: (row) => (
        <LearnerIdentity name={row.learner} meta={row.employer} tone={riskToneOf(row.risk)} />
      ),
    },
    {
      key: 'programme',
      label: 'Programme',
      widthClass: 'w-[160px] min-w-[150px]',
      render: (row) => (
        <span className="truncate text-[12px] font-medium text-foreground-600">{row.programme}</span>
      ),
    },
    {
      key: 'planned',
      label: 'Planned',
      align: 'center',
      widthClass: 'w-[100px] min-w-[100px]',
      render: (row) => <OtjhValueButton value={row.planned} label="Planned" onClick={() => handleViewDetails(row, 'planned')} />,
    },
    {
      key: 'target',
      label: 'Target',
      align: 'center',
      widthClass: 'w-[100px] min-w-[100px]',
      render: (row) => <OtjhValueButton value={row.target} label="Target" onClick={() => handleViewDetails(row, 'target')} />,
    },
    {
      key: 'completed',
      label: 'Completed',
      align: 'center',
      widthClass: 'w-[100px] min-w-[100px]',
      render: (row) => <OtjhValueButton value={row.completed} label="Completed" emphasis onClick={() => handleViewDetails(row, 'completed')} />,
    },
    {
      key: 'remaining',
      label: 'Remaining',
      align: 'center',
      widthClass: 'w-[100px] min-w-[100px]',
      render: (row) => <OtjhValueButton value={row.remaining} label="Remaining" onClick={() => handleViewDetails(row, 'remaining')} />,
    },
    {
      key: 'progress',
      label: 'OTJH progress',
      widthClass: 'w-[200px] min-w-[180px]',
      render: (row) => (
        <ProgressMetric
          value={`${row.pace}%`}
          percent={row.pace}
          note={<StatusBadge tone={riskToneOf(row.risk)} label={row.statusLabel} size="sm" />}
        />
      ),
    },
    {
      key: 'action',
      label: '',
      align: 'center',
      widthClass: 'w-[100px] min-w-[100px]',
      render: (row) => (
        <RowAction label="Details" icon="ri-arrow-right-s-line" onClick={() => handleViewDetails(row)} />
      ),
    },
  ];

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="OTJH Reports" pageSubtitle="Monitor Off-The-Job Hours progress and targets" userName={ownerName} userRole="Progress Coach">
      <PageContainer>
        <PageHeader
          title="Off-The-Job Hours"
          description="Monitor completed hours against each learner's target and quickly identify caseload risks."
          icon="ri-time-line"
          meta={
            <>
              <CompactMetric
                label={stats.behind ? 'Needs attention' : 'Caseload status'}
                value={stats.behind ? `${stats.behind} learner${stats.behind === 1 ? '' : 's'} at risk` : 'Everything on track'}
                tone={stats.behind ? 'critical' : 'positive'}
              />
              <CompactMetric label="Overall completion" value={`${stats.completion}%`} tone="brand" />
              <CompactMetric label="Completed / target hrs" value={`${formatHours(stats.totalCompleted)}/${formatHours(stats.totalTarget)}`} />
            </>
          }
        />

        <section className="space-y-3">
          <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-end">
            <div>
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-foreground-900">
                Learner OTJH progress
                <span className="text-[15px] font-semibold tabular-nums text-foreground-400">{filteredRows.length}</span>
              </h2>
              <p className="mt-0.5 text-[12px] leading-relaxed text-foreground-500">
                Completed, planned and remaining hours across the active caseload.
              </p>
            </div>
            <PageTabs items={filterTabItems} value={filter} onChange={(next) => changeFilter(next as FilterKey)} label="Filter learners by OTJH status" />
          </div>

          <DataTable
            columns={otjhColumns}
            rows={paginatedRows}
            rowKey={(row) => row.id}
            stickyFirstColumn
            minWidthClass="min-w-[1180px]"
            caption="Learner OTJH progress"
            loading={loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-12 animate-pulse rounded-lg bg-background-100" />
                ))}
              </div>
            ) : undefined}
            empty={
              error ? (
                <EmptyState variant="error" title="Unable to load OTJH data" description={error} />
              ) : (
                <EmptyState variant="no-matches" title="No learners match this OTJH filter." description="Try a different OTJH status filter." />
              )
            }
          />

          {!loading && !error && filteredRows.length > 0 ? (
            <Pagination
              page={activePage}
              totalPages={pageCount}
              total={filteredRows.length}
              pageSize={ROWS_PER_PAGE}
              onPageChange={setCurrentPage}
              noun="learners"
            />
          ) : null}
        </section>
      </PageContainer>

      <RightSlidePanel
        isOpen={selectedRow !== null}
        onClose={closeDetails}
        title={selectedRow?.learner || 'OTJH Details'}
        width="w-[520px]"
      >
        {selectedRow && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <div className="flex items-start gap-3">
                <LearnerAvatar name={selectedRow.learner} tone={riskToneOf(selectedRow.risk)} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-heading font-bold text-foreground-900">{selectedRow.learner}</h3>
                    <StatusBadge tone={riskToneOf(selectedRow.risk)} label={selectedRow.statusLabel} size="sm" />
                  </div>
                  <p className="mt-1 text-[12px] text-foreground-500">{selectedRow.employer}</p>
                  <p className="mt-0.5 text-[12px] text-foreground-400">{selectedRow.programme}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className={cn('rounded-lg border p-3 text-center transition', getFocusCardStyle('planned', selectedDetailFocus))}>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">Planned</p>
                <p className="mt-1 text-xl font-bold text-foreground-900">{formatHours(selectedRow.planned)}</p>
              </div>
              <div className={cn('rounded-lg border p-3 text-center transition', getFocusCardStyle('target', selectedDetailFocus))}>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">Target</p>
                <p className="mt-1 text-xl font-bold text-foreground-900">{formatHours(selectedRow.target)}</p>
              </div>
              <div className={cn('rounded-lg border p-3 text-center transition', getFocusCardStyle('completed', selectedDetailFocus))}>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">Completed</p>
                <p className="mt-1 text-xl font-bold text-primary-600">{formatHours(selectedRow.completed)}</p>
              </div>
              <div className={cn('rounded-lg border p-3 text-center transition', getFocusCardStyle('remaining', selectedDetailFocus))}>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">Remaining</p>
                <p className="mt-1 text-xl font-bold text-foreground-900">{formatHours(selectedRow.remaining)}</p>
              </div>
            </div>

            <div ref={completedBreakdownRef} className="scroll-mt-4 rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <div className="flex items-center justify-between text-[12px] text-foreground-500">
                <span>OTJH completion against Target</span>
                <span className="font-semibold text-foreground-900">{formatHours(selectedRow.completed)}/{formatHours(selectedRow.target)}</span>
              </div>
              <ProgressBar percent={selectedRow.pace} height="h-2" className="mt-3" />
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <h4 className="text-xs font-heading font-semibold text-foreground-900 mb-3">Learner & Programme Details</h4>
              <div className="grid grid-cols-1 gap-2 text-[12px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Learner email</span>
                  <span className="max-w-[260px] truncate font-semibold text-foreground-700">{selectedRow.email}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Employer email</span>
                  <span className="max-w-[260px] truncate font-semibold text-foreground-700">{selectedRow.employerEmail}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Group</span>
                  <span className="max-w-[260px] truncate font-semibold text-foreground-700">{selectedRow.group}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Program status</span>
                  <span className="font-semibold text-foreground-700">{selectedRow.programStatus}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Coach RAG</span>
                  <span className="font-semibold text-foreground-700">{selectedRow.coachRag}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Start date</span>
                  <span className="font-semibold text-foreground-700">{selectedRow.startDate}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Planned end</span>
                  <span className="font-semibold text-foreground-700">{selectedRow.plannedEndDate}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Gateway review</span>
                  <span className="font-semibold text-foreground-700">{selectedRow.gatewayReviewDate}</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <h4 className="text-xs font-heading font-semibold text-foreground-900 mb-3">OTJH Source Values</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-background-100/60 p-3">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">Planned</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{formatHours(selectedRow.planned)}</p>
                </div>
                <div className="rounded-lg bg-background-100/60 p-3">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">Target</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{formatHours(selectedRow.target)}</p>
                </div>
                <div className="rounded-lg bg-background-100/60 p-3">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">Minimum</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{formatHours(selectedRow.minimum)}</p>
                </div>
                <div className="rounded-lg bg-background-100/60 p-3">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">Submitted</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{formatHours(selectedRow.submitted)}</p>
                </div>
                <div className="rounded-lg bg-background-100/60 p-3">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">Forecast</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{formatHours(selectedRow.forecast)}</p>
                </div>
                <div className="rounded-lg bg-background-100/60 p-3">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">Expected</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{formatHours(selectedRow.expected)}</p>
                </div>
              </div>
              <div className="mt-3 space-y-2 text-[12px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Progress-Hours</span>
                  <span className="font-semibold text-foreground-700">{selectedRow.progressHours}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Progress variance</span>
                  <span className={cn('font-semibold', selectedRow.progressVariance.startsWith('-') ? 'text-red-600' : 'text-emerald-600')}>{selectedRow.progressVariance}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">OTJHoursStatus</span>
                  <StatusBadge tone={riskToneOf(selectedRow.risk)} label={selectedRow.statusLabel} size="sm" />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-heading font-semibold text-foreground-900">Completed OTJH Breakdown</h4>
                  <p className="mt-1 text-[12px] text-foreground-400">Each saved progress entry contributing to the completed hours total.</p>
                </div>
                <span className="rounded-full bg-primary-50 px-2.5 py-1 text-[12px] font-bold text-primary-700">
                  {selectedRow.completedEntries.length} entries
                </span>
              </div>

              {selectedRow.completedEntries.length > 0 ? (
                <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
                  {selectedRow.completedEntries.map(entry => (
                    <div key={entry.id} className="rounded-lg border border-foreground-200/60 bg-background-100/50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-[12px] font-bold text-foreground-900">{entry.title}</p>
                            <span className="rounded-full border border-foreground-200/70 bg-background-50 px-2 py-0.5 text-[12px] font-bold uppercase tracking-wide text-foreground-500">
                              {entry.typeLabel}
                            </span>
                          </div>
                          <p className="mt-1 text-[12px] text-foreground-500">
                            {entry.module !== '--' || entry.week !== '--'
                              ? `${entry.module} / ${entry.week}`
                              : entry.detail}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold text-primary-600">{formatHours(entry.hours)}h</p>
                          <p className="mt-1 text-[12px] text-foreground-400">{entry.completedDate}</p>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[12px] text-foreground-500">
                        <span className="rounded-full bg-background-50 px-2 py-1">Reported {entry.reportedTime}</span>
                        {entry.ksbs.length > 0 && (
                          <span className="rounded-full bg-background-50 px-2 py-1">KSBs {entry.ksbs.join(', ')}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState size="sm" variant="empty" title="No completed OTJH entries are available for this learner yet." />
              )}
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <h4 className="text-xs font-heading font-semibold text-foreground-900 mb-3">Related Progress Signals</h4>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-background-100/60 p-3">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">Overall</p>
                  <p className="mt-1 text-sm font-bold text-primary-600">{selectedRow.overallProgress}%</p>
                </div>
                <div className="rounded-lg bg-background-100/60 p-3">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">KSB</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{selectedRow.ksbProgress}%</p>
                  <p className="mt-0.5 text-[12px] text-foreground-400">{selectedRow.ksbStatus}</p>
                </div>
                <div className="rounded-lg bg-background-100/60 p-3">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">Evidence</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{selectedRow.evidenceCount}</p>
                </div>
              </div>
            </div>

            {(selectedRow.status === 'behind' || selectedRow.status === 'need-attention') && (
              <div className={cn('rounded-2xl border p-4', selectedRow.status === 'behind' ? 'bg-red-50 border-red-200/70' : 'bg-amber-50 border-amber-200/70')}>
                <div className="flex items-start gap-3">
                  <AppIcon className={cn(selectedRow.status === 'behind' ? 'ri-alarm-warning-line text-red-600' : 'ri-error-warning-line text-amber-600', 'text-lg')}></AppIcon>
                  <div>
                    <p className={cn('text-xs font-heading font-bold', selectedRow.status === 'behind' ? 'text-red-700' : 'text-amber-700')}>
                      {selectedRow.statusLabel}
                    </p>
                    <p className={cn('mt-1 text-[12px] leading-relaxed', selectedRow.status === 'behind' ? 'text-red-600' : 'text-amber-600')}>
                      This learner is behind the current OTJH target. Current variance is {selectedRow.progressVariance}, with {selectedRow.progressHours} recorded in Progress-Hours.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </RightSlidePanel>
    </WorkspaceShell>
  );
}
