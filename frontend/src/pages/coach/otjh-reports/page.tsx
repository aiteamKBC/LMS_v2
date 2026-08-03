import { useEffect, useMemo, useState } from 'react';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;
const API_ENDPOINT = '/coach_api/coach/caseload';
const ROWS_PER_PAGE = 10;

type FilterKey = 'all' | 'behind' | 'need-attention' | 'on-track';
type OtjhRowStatus = 'behind' | 'on-track' | 'ahead' | 'need-attention' | 'unknown';
type RiskTone = 'red' | 'amber' | 'green' | 'neutral';

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

function getPaceTone(pace: number): string {
  if (pace >= 75) return 'text-emerald-600';
  if (pace >= 50) return 'text-amber-600';
  return 'text-red-600';
}

function getBadgeStyle(tone: RiskTone): string {
  if (tone === 'red') return 'bg-red-50 text-red-700 border-red-200/60';
  if (tone === 'amber') return 'bg-amber-50 text-amber-700 border-amber-200/60';
  if (tone === 'green') return 'bg-emerald-50 text-emerald-700 border-emerald-200/60';
  return 'bg-background-100 text-foreground-500 border-foreground-200/60';
}

function getAvatarStyle(tone: RiskTone): string {
  if (tone === 'red') return 'bg-red-100 text-red-700';
  if (tone === 'amber') return 'bg-amber-100 text-amber-700';
  if (tone === 'green') return 'bg-emerald-100 text-emerald-700';
  return 'bg-background-200 text-foreground-500';
}

function getProgressBarStyle(tone: RiskTone): string {
  if (tone === 'red') return 'bg-red-500';
  if (tone === 'amber') return 'bg-amber-500';
  if (tone === 'green') return 'bg-emerald-500';
  return 'bg-foreground-300';
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

function OtjhMetricCard({ icon, label, value, tone }: { icon: string; label: string; value: string; tone: 'purple' | 'blue' | 'amber' | 'red' }) {
  const toneClasses = {
    purple: 'bg-violet-50 text-violet-700',
    blue: 'bg-sky-50 text-sky-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  };

  return (
    <div className="flex min-h-[92px] items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${toneClasses[tone]}`}>
        <i className={`${icon} text-xl`} />
      </span>
      <div className="min-w-0">
        <p className="text-xl font-bold leading-none text-slate-950 md:text-2xl">{value}</p>
        <p className="mt-2 truncate text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">{label}</p>
      </div>
    </div>
  );
}

function OtjhTableMessage({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="px-5 py-14 text-center">
      <i className={`${icon} text-2xl text-slate-400`} />
      <p className="mt-2 text-xs font-semibold text-slate-500">{message}</p>
    </div>
  );
}

function OtjhPagination({ currentPage, pageCount, total, onChange }: { currentPage: number; pageCount: number; total: number; onChange: (page: number) => void }) {
  const start = (currentPage - 1) * ROWS_PER_PAGE + 1;
  const end = Math.min(currentPage * ROWS_PER_PAGE, total);

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[11px] font-medium text-slate-500">
        Showing <span className="font-bold text-slate-800">{start}-{end}</span> of <span className="font-bold text-slate-800">{total}</span>
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => onChange(currentPage - 1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
            <i className="ri-arrow-left-s-line" />
          </button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).map(page => (
            <button key={page} type="button" onClick={() => onChange(page)} className={`h-8 min-w-8 rounded-lg px-2 text-[11px] font-bold transition ${currentPage === page ? 'bg-[#21003f] text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {page}
            </button>
          ))}
          <button type="button" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => onChange(currentPage + 1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
            <i className="ri-arrow-right-s-line" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function CoachOtjhReports() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [rows, setRows] = useState<OtjhRow[]>([]);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState('Med Maher');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadOtjhData() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(API_ENDPOINT, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = (await response.json()) as CaseloadApiResponse;
        setOwnerName(payload.owner?.name || 'Med Maher');
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
  }, []);

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

  const filterOptions: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: 'all', label: 'All', count: rows.length },
    { key: 'behind', label: 'At Risk', count: stats.behind },
    { key: 'need-attention', label: 'Need Attention', count: stats.needAttention },
    { key: 'on-track', label: 'On Track', count: stats.onTrack },
  ];

  const selectedRow = rows.find(row => row.id === selectedRowId) || null;

  const handleViewDetails = (row: OtjhRow) => {
    setSelectedRowId(row.id);
  };

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="OTJH Reports" pageSubtitle="Monitor Off-The-Job Hours progress and targets" userName={ownerName} userRole="Progress Coach">
      <div className="min-h-screen w-full space-y-4 bg-[#f7f6fb] p-3 md:p-5">
        <section className="rounded-2xl border border-white/10 px-5 py-6 text-white shadow-[0_14px_32px_rgba(20,4,46,0.16)] md:px-7" style={{ background: 'linear-gradient(110deg, #100021 0%, #190034 52%, #2a0752 100%)' }}>
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div>
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold text-white/55">
                <span>Coach Workspace</span>
                <i className="ri-arrow-right-s-line text-sm" />
                <span className="text-white">OTJH Reports</span>
              </div>
              <h1 className="font-heading text-2xl font-bold tracking-tight md:text-[28px]">Off-The-Job Hours</h1>
              <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-white/70">
                Monitor completed hours against each learner's target and quickly identify caseload risks.
              </p>
            </div>
            <button type="button" onClick={() => changeFilter(stats.behind ? 'behind' : 'on-track')} className="flex min-w-[190px] items-center gap-3 self-start rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-left backdrop-blur-sm transition hover:bg-white/15 md:self-auto">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${stats.behind ? 'bg-red-400/15 text-red-200' : 'bg-emerald-400/15 text-emerald-200'}`}>
                <i className={stats.behind ? 'ri-alarm-warning-line text-xl' : 'ri-checkbox-circle-line text-xl'} />
              </span>
              <span>
                <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-white/55">{stats.behind ? 'Needs attention' : 'Caseload status'}</span>
                <span className="mt-0.5 block text-sm font-bold">{stats.behind ? `${stats.behind} learner${stats.behind === 1 ? '' : 's'} at risk` : 'Everything on track'}</span>
              </span>
            </button>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <OtjhMetricCard icon="ri-checkbox-circle-line" label="Completed hours" value={formatHours(stats.totalCompleted)} tone="purple" />
          <OtjhMetricCard icon="ri-calendar-schedule-line" label="Planned hours" value={formatHours(stats.totalPlanned)} tone="blue" />
          <OtjhMetricCard icon="ri-focus-3-line" label="Target hours" value={formatHours(stats.totalTarget)} tone="amber" />
          <OtjhMetricCard icon="ri-alarm-warning-line" label="Learners at risk" value={String(stats.behind)} tone="red" />
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
          <div className="border-b border-slate-100 px-4 py-4 md:px-5">
            <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-950">Learner OTJH progress</h2>
                  <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-bold text-violet-700">{filteredRows.length} learner{filteredRows.length === 1 ? '' : 's'}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Completed, planned and remaining hours across the active caseload.</p>
              </div>
              <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
                {filterOptions.map(option => (
                  <button key={option.key} type="button" onClick={() => changeFilter(option.key)} className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-[11px] font-semibold transition ${filter === option.key ? 'bg-[#21003f] text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'}`}>
                    {option.label}
                    <span className={`ml-1.5 text-[10px] ${filter === option.key ? 'text-white/65' : 'text-slate-400'}`}>{option.count}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[1100px]">
              <div className="grid grid-cols-[minmax(250px,1.5fr)_minmax(150px,0.9fr)_repeat(4,minmax(90px,0.6fr))_minmax(180px,1fr)_minmax(90px,0.5fr)] gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-3 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                <span>Learner</span>
                <span>Programme</span>
                <span className="text-center">Planned</span>
                <span className="text-center">Target</span>
                <span className="text-center">Completed</span>
                <span className="text-center">Remaining</span>
                <span>OTJH progress</span>
                <span className="text-center">Action</span>
              </div>

              {loading && <OtjhTableMessage icon="ri-loader-4-line animate-spin" message="Loading live OTJH data..." />}
              {!loading && error && <OtjhTableMessage icon="ri-error-warning-line text-red-500" message={error} />}
              {!loading && !error && filteredRows.length === 0 && <OtjhTableMessage icon="ri-user-search-line text-violet-500" message="No learners match this OTJH filter." />}

              {!loading && !error && paginatedRows.length > 0 && (
                <div className="divide-y divide-slate-100">
                  {paginatedRows.map(row => (
                    <div key={row.id} className="grid grid-cols-[minmax(250px,1.5fr)_minmax(150px,0.9fr)_repeat(4,minmax(90px,0.6fr))_minmax(180px,1fr)_minmax(90px,0.5fr)] items-center gap-3 px-5 py-4 transition hover:bg-violet-50/30">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${getAvatarStyle(row.risk)}`}>{row.initials}</div>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-bold text-slate-900">{row.learner}</p>
                          <p className="mt-0.5 truncate text-[10px] text-slate-500">{row.employer}</p>
                        </div>
                      </div>
                      <span className="truncate text-[11px] font-medium text-slate-600">{row.programme}</span>
                      <span className="text-center text-[11px] font-semibold text-slate-600">{formatHours(row.planned)}</span>
                      <span className="text-center text-[11px] font-semibold text-slate-600">{formatHours(row.target)}</span>
                      <span className="text-center text-[12px] font-bold text-violet-700">{formatHours(row.completed)}</span>
                      <span className="text-center text-[11px] font-semibold text-slate-600">{formatHours(row.remaining)}</span>
                      <div className="min-w-0">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className={`text-[11px] font-bold ${getPaceTone(row.pace)}`}>{row.pace}%</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase ${getBadgeStyle(row.risk)}`}>{row.statusLabel}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${getProgressBarStyle(row.risk)}`} style={{ width: `${Math.min(row.pace, 100)}%` }} />
                        </div>
                      </div>
                      <div className="text-center">
                        <button type="button" onClick={() => handleViewDetails(row)} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[10px] font-bold text-violet-700 transition hover:border-violet-300 hover:bg-violet-100">Details</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {!loading && !error && filteredRows.length > 0 && (
            <OtjhPagination currentPage={activePage} pageCount={pageCount} total={filteredRows.length} onChange={setCurrentPage} />
          )}
        </section>
      </div>

      <RightSlidePanel
        isOpen={selectedRow !== null}
        onClose={() => setSelectedRowId(null)}
        title={selectedRow?.learner || 'OTJH Details'}
        width="w-[520px]"
      >
        {selectedRow && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <div className="flex items-start gap-3">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-bold shrink-0 ${getAvatarStyle(selectedRow.risk)}`}>
                  {selectedRow.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-heading font-bold text-foreground-900">{selectedRow.learner}</h3>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${getBadgeStyle(selectedRow.risk)}`}>
                      {selectedRow.statusLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-foreground-500">{selectedRow.employer}</p>
                  <p className="mt-0.5 text-[11px] text-foreground-400">{selectedRow.programme}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-foreground-200/60 bg-background-100/40 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Planned</p>
                <p className="mt-1 text-xl font-bold text-foreground-900">{formatHours(selectedRow.planned)}</p>
              </div>
              <div className="rounded-xl border border-foreground-200/60 bg-background-100/40 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Target</p>
                <p className="mt-1 text-xl font-bold text-foreground-900">{formatHours(selectedRow.target)}</p>
              </div>
              <div className="rounded-xl border border-foreground-200/60 bg-background-100/40 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Completed</p>
                <p className="mt-1 text-xl font-bold text-primary-600">{formatHours(selectedRow.completed)}</p>
              </div>
              <div className="rounded-xl border border-foreground-200/60 bg-background-100/40 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Remaining</p>
                <p className="mt-1 text-xl font-bold text-foreground-900">{formatHours(selectedRow.remaining)}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <div className="flex items-center justify-between text-[11px] text-foreground-500">
                <span>OTJH completion against Target</span>
                <span className="font-semibold text-foreground-900">{formatHours(selectedRow.completed)}/{formatHours(selectedRow.target)}</span>
              </div>
              <div className="mt-3 h-2 rounded-full bg-background-200 overflow-hidden">
                <div
                  className={`h-full rounded-full ${getProgressBarStyle(selectedRow.risk)}`}
                  style={{ width: `${Math.min(selectedRow.pace, 100)}%` }}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <h4 className="text-xs font-heading font-semibold text-foreground-900 mb-3">Learner & Programme Details</h4>
              <div className="grid grid-cols-1 gap-2 text-[11px]">
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
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-foreground-400">Planned</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{formatHours(selectedRow.planned)}</p>
                </div>
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-foreground-400">Target</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{formatHours(selectedRow.target)}</p>
                </div>
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-foreground-400">Minimum</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{formatHours(selectedRow.minimum)}</p>
                </div>
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-foreground-400">Submitted</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{formatHours(selectedRow.submitted)}</p>
                </div>
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-foreground-400">Forecast</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{formatHours(selectedRow.forecast)}</p>
                </div>
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-foreground-400">Expected</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{formatHours(selectedRow.expected)}</p>
                </div>
              </div>
              <div className="mt-3 space-y-2 text-[11px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Progress-Hours</span>
                  <span className="font-semibold text-foreground-700">{selectedRow.progressHours}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Progress variance</span>
                  <span className={`font-semibold ${selectedRow.progressVariance.startsWith('-') ? 'text-red-600' : 'text-emerald-600'}`}>{selectedRow.progressVariance}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">OTJHoursStatus</span>
                  <span className={`font-semibold px-2 py-0.5 rounded-full border ${getBadgeStyle(selectedRow.risk)}`}>{selectedRow.statusLabel}</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-heading font-semibold text-foreground-900">Completed OTJH Breakdown</h4>
                  <p className="mt-1 text-[10px] text-foreground-400">Each saved progress entry contributing to the completed hours total.</p>
                </div>
                <span className="rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-bold text-primary-700">
                  {selectedRow.completedEntries.length} entries
                </span>
              </div>

              {selectedRow.completedEntries.length > 0 ? (
                <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
                  {selectedRow.completedEntries.map(entry => (
                    <div key={entry.id} className="rounded-xl border border-foreground-200/60 bg-background-100/50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-[11px] font-bold text-foreground-900">{entry.title}</p>
                            <span className="rounded-full border border-foreground-200/70 bg-white px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-foreground-500">
                              {entry.typeLabel}
                            </span>
                          </div>
                          <p className="mt-1 text-[10px] text-foreground-500">
                            {entry.module !== '--' || entry.week !== '--'
                              ? `${entry.module} / ${entry.week}`
                              : entry.detail}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold text-primary-600">{formatHours(entry.hours)}h</p>
                          <p className="mt-1 text-[9px] text-foreground-400">{entry.completedDate}</p>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-foreground-500">
                        <span className="rounded-full bg-white px-2 py-1">Reported {entry.reportedTime}</span>
                        {entry.ksbs.length > 0 && (
                          <span className="rounded-full bg-white px-2 py-1">KSBs {entry.ksbs.join(', ')}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-foreground-200/70 bg-background-100/40 px-4 py-6 text-center text-[11px] text-foreground-500">
                  No completed OTJH entries are available for this learner yet.
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <h4 className="text-xs font-heading font-semibold text-foreground-900 mb-3">Related Progress Signals</h4>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-foreground-400">Overall</p>
                  <p className="mt-1 text-sm font-bold text-primary-600">{selectedRow.overallProgress}%</p>
                </div>
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-foreground-400">KSB</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{selectedRow.ksbProgress}%</p>
                  <p className="mt-0.5 text-[9px] text-foreground-400">{selectedRow.ksbStatus}</p>
                </div>
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-foreground-400">Evidence</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{selectedRow.evidenceCount}</p>
                </div>
              </div>
            </div>

            {(selectedRow.status === 'behind' || selectedRow.status === 'need-attention') && (
              <div className={`rounded-2xl border p-4 ${selectedRow.status === 'behind' ? 'bg-red-50 border-red-200/70' : 'bg-amber-50 border-amber-200/70'}`}>
                <div className="flex items-start gap-3">
                  <i className={`${selectedRow.status === 'behind' ? 'ri-alarm-warning-line text-red-600' : 'ri-error-warning-line text-amber-600'} text-lg`}></i>
                  <div>
                    <p className={`text-xs font-heading font-bold ${selectedRow.status === 'behind' ? 'text-red-700' : 'text-amber-700'}`}>
                      {selectedRow.statusLabel}
                    </p>
                    <p className={`mt-1 text-[11px] leading-relaxed ${selectedRow.status === 'behind' ? 'text-red-600' : 'text-amber-600'}`}>
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
