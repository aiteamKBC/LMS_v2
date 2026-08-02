import { useEffect, useMemo, useState } from 'react';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;
const API_ENDPOINT = '/coach_api/coach/caseload';
const MISSING_VALUE = '-';
const ROWS_PER_PAGE = 10;

type FilterKey = 'all' | 'high-risk' | 'on-track' | 'gateway-ready';
type RiskTone = 'red' | 'amber' | 'green';

interface CaseloadApiLearner {
  id: string;
  name: string;
  initials: string;
  employer?: string;
  cohortName?: string;
  group?: string;
  email?: string | null;
  ksbCompleted?: number;
  ksbTarget?: number;
  ksbStatus?: string;
  ksbProgress?: number;
  knowledgeCompleted?: number | null;
  knowledgeTarget?: number | null;
  knowledgeProgress?: number | null;
  skillsCompleted?: number | null;
  skillsTarget?: number | null;
  skillsProgress?: number | null;
  behavioursCompleted?: number | null;
  behavioursTarget?: number | null;
  behavioursProgress?: number | null;
  ksbCompletedDetails?: KsbCompletedDetail[];
  evidenceCount?: number;
  evidenceCountAvailable?: boolean;
  rawProgramStatus?: string;
  coachRag?: string;
  startDate?: string;
  gatewayReviewDate?: string;
}

interface KsbCompletedSource {
  id?: string;
  title?: string;
  typeLabel?: string;
  kind?: string;
  module?: string;
  week?: string;
  reportedTime?: string;
  hours?: number | null;
  completedDate?: string;
  detail?: string;
}

interface KsbCompletedDetail {
  code?: string;
  type?: string;
  description?: string;
  sources?: KsbCompletedSource[];
}

interface CaseloadApiResponse {
  owner?: {
    name?: string;
    email?: string;
  };
  learners?: CaseloadApiLearner[];
}

interface KsbImpactRow {
  id: string;
  learner: string;
  initials: string;
  employer: string;
  programme: string;
  group: string;
  email: string;
  completed: number;
  target: number;
  remaining: number;
  overall: number;
  knowledgeCompleted: number | null;
  knowledgeTarget: number | null;
  knowledgeProgress: number | null;
  skillsCompleted: number | null;
  skillsTarget: number | null;
  skillsProgress: number | null;
  behavioursCompleted: number | null;
  behavioursTarget: number | null;
  behavioursProgress: number | null;
  completedDetails: KsbCompletedDetail[];
  ksbStatus: string;
  evidenceCount: number;
  evidenceCountAvailable: boolean;
  programStatus: string;
  coachRag: string;
  startDate: string;
  gatewayReviewDate: string;
  risk: RiskTone;
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function displayText(value?: string | null): string {
  const trimmed = (value || '').trim();
  return trimmed || MISSING_VALUE;
}

function optionalText(value?: string | null): string {
  return (value || '').trim();
}

function percentage(completed: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((completed / target) * 100)));
}

function isNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function averageProgress(values: Array<number | null | undefined>): number | null {
  const validValues = values.filter(isNumber);
  if (!validValues.length) return null;
  return Math.round(validValues.reduce((total, value) => total + value, 0) / validValues.length);
}

function sumCompleted(values: Array<number | null | undefined>): number | null {
  const validValues = values.filter(isNumber);
  if (!validValues.length) return null;
  return validValues.reduce((total, value) => total + value, 0);
}

function formatKsbRatio(completed: number | null | undefined, target: number | null | undefined): string {
  if (!isNumber(target) || target <= 0) return MISSING_VALUE;
  return `${isNumber(completed) ? completed : 0}/${target}`;
}

function formatKsbPercent(progress: number | null | undefined): string {
  return isNumber(progress) ? `${progress}%` : MISSING_VALUE;
}

function formatKsbCompleted(completed: number | null | undefined): string {
  return isNumber(completed) ? String(completed) : MISSING_VALUE;
}

function getRiskTone(overall: number): RiskTone {
  if (overall < 40) return 'red';
  if (overall >= 80) return 'green';
  return 'amber';
}

function getMetricTone(value: number): string {
  if (value >= 80) return 'text-emerald-600';
  if (value >= 40) return 'text-amber-600';
  return 'text-red-600';
}

function getAvatarStyle(tone: RiskTone): string {
  if (tone === 'red') return 'bg-red-100 text-red-700';
  if (tone === 'green') return 'bg-accent-100 text-accent-700';
  return 'bg-primary-100 text-primary-700';
}

function getStatusStyle(tone: RiskTone): string {
  if (tone === 'red') return 'bg-red-50 text-red-700 border-red-200/60';
  if (tone === 'green') return 'bg-emerald-50 text-emerald-700 border-emerald-200/60';
  return 'bg-amber-50 text-amber-700 border-amber-200/60';
}

function getKsbTypeStyle(type?: string): string {
  const lowerType = optionalText(type).toLowerCase();
  if (lowerType.includes('skill')) return 'bg-sky-50 text-sky-700 border-sky-100';
  if (lowerType.includes('behaviour') || lowerType.includes('behavior')) return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  return 'bg-violet-50 text-violet-700 border-violet-100';
}

function toCompletedDetails(details?: KsbCompletedDetail[]): KsbCompletedDetail[] {
  if (!Array.isArray(details)) return [];

  return details
    .map((detail, detailIndex) => {
      const code = optionalText(detail.code);
      const sources = Array.isArray(detail.sources) ? detail.sources : [];

      return {
        code,
        type: displayText(detail.type),
        description: optionalText(detail.description),
        sources: sources.map((source, sourceIndex) => ({
          id: optionalText(source.id) || `${code || detailIndex}-${sourceIndex}`,
          title: displayText(source.title),
          typeLabel: displayText(source.typeLabel),
          kind: displayText(source.kind),
          module: displayText(source.module),
          week: displayText(source.week),
          reportedTime: displayText(source.reportedTime),
          hours: isNumber(source.hours) ? source.hours : null,
          completedDate: displayText(source.completedDate),
          detail: displayText(source.detail),
        })),
      };
    })
    .filter(detail => Boolean(detail.code));
}

function toKsbImpactRow(learner: CaseloadApiLearner): KsbImpactRow {
  const completed = Math.max(toNumber(learner.ksbCompleted), 0);
  const target = Math.max(toNumber(learner.ksbTarget), 0);
  const overall = toNumber(learner.ksbProgress) || percentage(completed, target);
  const risk = getRiskTone(overall);

  return {
    id: learner.id,
    learner: learner.name,
    initials: learner.initials,
    employer: displayText(learner.employer),
    programme: displayText(learner.cohortName),
    group: displayText(learner.group),
    email: displayText(learner.email),
    completed,
    target,
    remaining: Math.max(target - completed, 0),
    overall,
    knowledgeCompleted: isNumber(learner.knowledgeCompleted) ? learner.knowledgeCompleted : null,
    knowledgeTarget: isNumber(learner.knowledgeTarget) ? learner.knowledgeTarget : null,
    knowledgeProgress: isNumber(learner.knowledgeProgress) ? learner.knowledgeProgress : null,
    skillsCompleted: isNumber(learner.skillsCompleted) ? learner.skillsCompleted : null,
    skillsTarget: isNumber(learner.skillsTarget) ? learner.skillsTarget : null,
    skillsProgress: isNumber(learner.skillsProgress) ? learner.skillsProgress : null,
    behavioursCompleted: isNumber(learner.behavioursCompleted) ? learner.behavioursCompleted : null,
    behavioursTarget: isNumber(learner.behavioursTarget) ? learner.behavioursTarget : null,
    behavioursProgress: isNumber(learner.behavioursProgress) ? learner.behavioursProgress : null,
    completedDetails: toCompletedDetails(learner.ksbCompletedDetails),
    ksbStatus: displayText(learner.ksbStatus),
    evidenceCount: Math.max(toNumber(learner.evidenceCount), 0),
    evidenceCountAvailable: Boolean(learner.evidenceCountAvailable),
    programStatus: displayText(learner.rawProgramStatus),
    coachRag: displayText(learner.coachRag),
    startDate: displayText(learner.startDate),
    gatewayReviewDate: displayText(learner.gatewayReviewDate),
    risk,
  };
}

function KsbMetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  tone: 'purple' | 'blue' | 'amber' | 'green';
}) {
  const toneClasses = {
    purple: 'bg-violet-50 text-violet-700',
    blue: 'bg-sky-50 text-sky-700',
    amber: 'bg-amber-50 text-amber-700',
    green: 'bg-emerald-50 text-emerald-700',
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

function KsbValue({ value, progress }: { value: number | null; progress: number | null }) {
  return (
    <div className="text-center">
      <p className={`text-[12px] font-bold ${isNumber(value) ? getMetricTone(progress ?? 0) : 'text-slate-400'}`}>
        {formatKsbCompleted(value)}
      </p>
      {isNumber(progress) && <p className="mt-0.5 text-[9px] text-slate-400">{progress}%</p>}
    </div>
  );
}

function KsbTableMessage({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="px-5 py-14 text-center">
      <i className={`${icon} text-2xl text-slate-400`} />
      <p className="mt-2 text-xs font-semibold text-slate-500">{message}</p>
    </div>
  );
}

function KsbPagination({
  currentPage,
  pageCount,
  total,
  onChange,
}: {
  currentPage: number;
  pageCount: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const start = (currentPage - 1) * ROWS_PER_PAGE + 1;
  const end = Math.min(currentPage * ROWS_PER_PAGE, total);

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[11px] font-medium text-slate-500">
        Showing <span className="font-bold text-slate-800">{start}-{end}</span> of <span className="font-bold text-slate-800">{total}</span>
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={currentPage === 1}
            onClick={() => onChange(currentPage - 1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <i className="ri-arrow-left-s-line" />
          </button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).map(page => (
            <button
              key={page}
              type="button"
              onClick={() => onChange(page)}
              className={`h-8 min-w-8 rounded-lg px-2 text-[11px] font-bold transition ${
                currentPage === page ? 'bg-[#21003f] text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {page}
            </button>
          ))}
          <button
            type="button"
            aria-label="Next page"
            disabled={currentPage === pageCount}
            onClick={() => onChange(currentPage + 1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <i className="ri-arrow-right-s-line" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function CoachKsbImpact() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [rows, setRows] = useState<KsbImpactRow[]>([]);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState('Med Maher');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadKsbData() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(API_ENDPOINT, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = (await response.json()) as CaseloadApiResponse;
        setOwnerName(payload.owner?.name || 'Med Maher');
        setRows((payload.learners || []).map(toKsbImpactRow));
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setRows([]);
        setError('Unable to load live KSB data right now.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadKsbData();

    return () => controller.abort();
  }, []);

  const stats = useMemo(() => {
    const averageOverall = rows.length
      ? Math.round(rows.reduce((total, row) => total + row.overall, 0) / rows.length)
      : 0;
    const totalKnowledgeCompleted = sumCompleted(rows.map(row => row.knowledgeCompleted));
    const totalSkillsCompleted = sumCompleted(rows.map(row => row.skillsCompleted));
    const totalBehavioursCompleted = sumCompleted(rows.map(row => row.behavioursCompleted));
    const highRisk = rows.filter(row => row.overall < 40).length;
    const onTrack = rows.filter(row => row.overall >= 40 && row.overall < 80).length;
    const gatewayReady = rows.filter(row => row.overall >= 80).length;

    return { averageOverall, totalKnowledgeCompleted, totalSkillsCompleted, totalBehavioursCompleted, highRisk, onTrack, gatewayReady };
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter(row => {
      if (filter === 'high-risk') return row.overall < 40;
      if (filter === 'on-track') return row.overall >= 40 && row.overall < 80;
      if (filter === 'gateway-ready') return row.overall >= 80;
      return true;
    });
  }, [filter, rows]);

  const selectedRow = rows.find(row => row.id === selectedRowId) || null;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE));
  const activePage = Math.min(currentPage, pageCount);
  const paginatedRows = filteredRows.slice((activePage - 1) * ROWS_PER_PAGE, activePage * ROWS_PER_PAGE);

  const changeFilter = (nextFilter: FilterKey) => {
    setFilter(nextFilter);
    setCurrentPage(1);
  };

  const filterOptions: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: 'all', label: 'All', count: rows.length },
    { key: 'high-risk', label: 'High Risk', count: stats.highRisk },
    { key: 'on-track', label: 'On Track', count: stats.onTrack },
    { key: 'gateway-ready', label: 'Gateway Ready', count: stats.gatewayReady },
  ];

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Monthly KSB Impact" pageSubtitle="Track Knowledge, Skills and Behaviours progress across your caseload" userName={ownerName} userRole="Progress Coach">
      <div className="min-h-screen w-full space-y-4 bg-[#f7f6fb] p-3 md:p-5">
        <section
          className="rounded-2xl border border-white/10 px-5 py-6 text-white shadow-[0_14px_32px_rgba(20,4,46,0.16)] md:px-7"
          style={{ background: 'linear-gradient(110deg, #100021 0%, #190034 52%, #2a0752 100%)' }}
        >
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div>
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold text-white/55">
                <span>Coach Workspace</span>
                <i className="ri-arrow-right-s-line text-sm" />
                <span className="text-white">KSB Impact</span>
              </div>
              <h1 className="font-heading text-2xl font-bold tracking-tight md:text-[28px]">Monthly KSB Impact</h1>
              <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-white/70">
                Track Knowledge, Skills and Behaviours progress across your caseload and spot learners who need support.
              </p>
            </div>
            <button
              type="button"
              onClick={() => changeFilter(stats.highRisk ? 'high-risk' : 'gateway-ready')}
              className="flex min-w-[190px] items-center gap-3 self-start rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-left backdrop-blur-sm transition hover:bg-white/15 md:self-auto"
            >
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${stats.highRisk ? 'bg-red-400/15 text-red-200' : 'bg-emerald-400/15 text-emerald-200'}`}>
                <i className={stats.highRisk ? 'ri-alarm-warning-line text-xl' : 'ri-checkbox-circle-line text-xl'} />
              </span>
              <span>
                <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-white/55">
                  {stats.highRisk ? 'Needs attention' : 'Caseload status'}
                </span>
                <span className="mt-0.5 block text-sm font-bold">
                  {stats.highRisk ? `${stats.highRisk} high-risk learner${stats.highRisk === 1 ? '' : 's'}` : 'Everything on track'}
                </span>
              </span>
            </button>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KsbMetricCard icon="ri-pie-chart-line" label="Average overall" value={`${stats.averageOverall}%`} tone="purple" />
          <KsbMetricCard icon="ri-book-open-line" label="Knowledge completed" value={formatKsbCompleted(stats.totalKnowledgeCompleted)} tone="blue" />
          <KsbMetricCard icon="ri-tools-line" label="Skills completed" value={formatKsbCompleted(stats.totalSkillsCompleted)} tone="amber" />
          <KsbMetricCard icon="ri-user-heart-line" label="Behaviours completed" value={formatKsbCompleted(stats.totalBehavioursCompleted)} tone="green" />
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
          <div className="border-b border-slate-100 px-4 py-4 md:px-5">
            <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-950">Learner KSB progress</h2>
                  <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-bold text-violet-700">
                    {filteredRows.length} learner{filteredRows.length === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Live validated KSB values and supporting evidence across your caseload.</p>
              </div>
              <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
                {filterOptions.map(option => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => changeFilter(option.key)}
                    className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-[11px] font-semibold transition ${
                      filter === option.key ? 'bg-[#21003f] text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'
                    }`}
                  >
                    {option.label}
                    <span className={`ml-1.5 text-[10px] ${filter === option.key ? 'text-white/65' : 'text-slate-400'}`}>{option.count}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[1080px]">
              <div className="grid grid-cols-[minmax(240px,1.5fr)_repeat(3,minmax(90px,0.7fr))_minmax(120px,0.8fr)_minmax(150px,0.9fr)_minmax(90px,0.65fr)_minmax(90px,0.5fr)] gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-3 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                <span>Learner</span>
                <span className="text-center">Knowledge</span>
                <span className="text-center">Skills</span>
                <span className="text-center">Behaviours</span>
                <span className="text-center">Validated</span>
                <span>Overall progress</span>
                <span className="text-center">Evidenced</span>
                <span className="text-center">Action</span>
              </div>

              {loading && <KsbTableMessage icon="ri-loader-4-line animate-spin" message="Loading live KSB data..." />}

              {!loading && error && <KsbTableMessage icon="ri-error-warning-line text-red-500" message={error} />}

              {!loading && !error && filteredRows.length === 0 && (
                <KsbTableMessage icon="ri-user-search-line text-violet-500" message="No learners match this KSB filter." />
              )}

              {!loading && !error && paginatedRows.length > 0 && (
                <div className="divide-y divide-slate-100">
                  {paginatedRows.map(row => (
                    <div key={row.id} className="grid grid-cols-[minmax(240px,1.5fr)_repeat(3,minmax(90px,0.7fr))_minmax(120px,0.8fr)_minmax(150px,0.9fr)_minmax(90px,0.65fr)_minmax(90px,0.5fr)] items-center gap-3 px-5 py-4 transition hover:bg-violet-50/30">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${getAvatarStyle(row.risk)}`}>{row.initials}</div>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-bold text-slate-900">{row.learner}</p>
                          <p className="mt-0.5 truncate text-[10px] text-slate-500">{row.programme}</p>
                        </div>
                      </div>
                      <KsbValue value={row.knowledgeCompleted} progress={row.knowledgeProgress} />
                      <KsbValue value={row.skillsCompleted} progress={row.skillsProgress} />
                      <KsbValue value={row.behavioursCompleted} progress={row.behavioursProgress} />
                      <span className="text-center text-[11px] font-semibold text-slate-600">{formatKsbRatio(row.completed, row.target)}</span>
                      <div className="min-w-0">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className={`text-[12px] font-bold ${getMetricTone(row.overall)}`}>{row.overall}%</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase ${getStatusStyle(row.risk)}`}>
                            {row.overall < 40 ? 'High risk' : row.overall >= 80 ? 'Ready' : 'On track'}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${row.risk === 'red' ? 'bg-red-500' : row.risk === 'green' ? 'bg-emerald-500' : 'bg-amber-500'}`}
                            style={{ width: `${Math.min(row.overall, 100)}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-center text-[11px] font-bold text-slate-500">{row.evidenceCountAvailable ? row.evidenceCount : MISSING_VALUE}</span>
                      <div className="text-center">
                        <button
                          type="button"
                          onClick={() => setSelectedRowId(row.id)}
                          className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[10px] font-bold text-violet-700 transition hover:border-violet-300 hover:bg-violet-100"
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {!loading && !error && filteredRows.length > 0 && (
            <KsbPagination
              currentPage={activePage}
              pageCount={pageCount}
              total={filteredRows.length}
              onChange={setCurrentPage}
            />
          )}
        </section>
      </div>

      <RightSlidePanel
        isOpen={selectedRow !== null}
        onClose={() => setSelectedRowId(null)}
        title={selectedRow?.learner || 'KSB Details'}
        width="w-[560px]"
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
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${getStatusStyle(selectedRow.risk)}`}>
                      {selectedRow.overall < 40 ? 'High Risk' : selectedRow.overall >= 80 ? 'Gateway Ready' : 'On Track'}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-foreground-500">{selectedRow.employer}</p>
                  <p className="mt-0.5 text-[11px] text-foreground-400">{selectedRow.programme}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-foreground-200/60 bg-background-100/40 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Overall</p>
                <p className={`mt-1 text-xl font-bold ${getMetricTone(selectedRow.overall)}`}>{selectedRow.overall}%</p>
              </div>
              <div className="rounded-xl border border-foreground-200/60 bg-background-100/40 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Completed</p>
                <p className="mt-1 text-xl font-bold text-primary-600">{selectedRow.completed}</p>
              </div>
              <div className="rounded-xl border border-foreground-200/60 bg-background-100/40 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Target</p>
                <p className="mt-1 text-xl font-bold text-foreground-900">{selectedRow.target || MISSING_VALUE}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <div className="flex items-center justify-between text-[11px] text-foreground-500">
                <span>KSB completion against target</span>
                <span className="font-semibold text-foreground-900">{selectedRow.completed}/{selectedRow.target || MISSING_VALUE}</span>
              </div>
              <div className="mt-3 h-2 rounded-full bg-background-200 overflow-hidden">
                <div
                  className={`${selectedRow.risk === 'red' ? 'bg-red-500' : selectedRow.risk === 'green' ? 'bg-emerald-500' : 'bg-amber-500'} h-full rounded-full`}
                  style={{ width: `${Math.min(selectedRow.overall, 100)}%` }}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <h4 className="text-xs font-heading font-semibold text-foreground-900 mb-3">Live KSB Source Values</h4>
              <div className="space-y-2 text-[11px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Knowledge</span>
                  <span className="font-semibold text-foreground-700">{formatKsbRatio(selectedRow.knowledgeCompleted, selectedRow.knowledgeTarget)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Skills</span>
                  <span className="font-semibold text-foreground-700">{formatKsbRatio(selectedRow.skillsCompleted, selectedRow.skillsTarget)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Behaviours</span>
                  <span className="font-semibold text-foreground-700">{formatKsbRatio(selectedRow.behavioursCompleted, selectedRow.behavioursTarget)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">TotalCompletedKSB</span>
                  <span className="font-semibold text-foreground-700">{selectedRow.completed}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">TotalTargetKSB</span>
                  <span className="font-semibold text-foreground-700">{selectedRow.target || MISSING_VALUE}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Remaining KSBs</span>
                  <span className="font-semibold text-foreground-700">{selectedRow.remaining}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">KSBStatus</span>
                  <span className="font-semibold text-foreground-700">{selectedRow.ksbStatus}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Evidence count</span>
                  <span className="font-semibold text-foreground-700">{selectedRow.evidenceCountAvailable ? selectedRow.evidenceCount : MISSING_VALUE}</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-heading font-semibold text-foreground-900">Completed KSB Breakdown</h4>
                  <p className="mt-1 text-[11px] text-foreground-400">Each completed KSB and the activity that surfaced it.</p>
                </div>
                <span className="shrink-0 rounded-full bg-violet-50 px-3 py-1 text-[10px] font-bold text-violet-700">
                  {selectedRow.completedDetails.length} KSB{selectedRow.completedDetails.length === 1 ? '' : 's'}
                </span>
              </div>

              {selectedRow.completedDetails.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white p-4 text-center">
                  <p className="text-[11px] font-semibold text-foreground-500">No completed KSB details available yet.</p>
                </div>
              ) : (
                <div className="mt-4 max-h-[24rem] space-y-2 overflow-y-auto pr-1">
                  {selectedRow.completedDetails.map(detail => (
                    <div key={detail.code} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_5px_16px_rgba(15,23,42,0.03)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-xl bg-violet-100 px-2.5 py-1 text-[11px] font-bold text-violet-800">{detail.code}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide ${getKsbTypeStyle(detail.type)}`}>
                              {detail.type}
                            </span>
                          </div>
                          <p className="mt-2 text-[11px] font-semibold leading-relaxed text-foreground-800">
                            {detail.description || 'No programme description recorded for this KSB.'}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-slate-50 px-2.5 py-1 text-[9px] font-bold text-slate-500">
                          {detail.sources?.length || 0} source{detail.sources?.length === 1 ? '' : 's'}
                        </span>
                      </div>

                      <div className="mt-3 space-y-2">
                        {detail.sources && detail.sources.length > 0 ? (
                          detail.sources.map(source => (
                            <div key={source.id} className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2">
                              <div className="flex items-center justify-between gap-3">
                                <span className="rounded-full bg-white px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-slate-500">
                                  {source.typeLabel}
                                </span>
                                <span className="text-[9px] font-semibold text-slate-400">{source.completedDate}</span>
                              </div>
                              <p className="mt-1.5 truncate text-[11px] font-bold text-slate-900">{source.title}</p>
                              <p className="mt-1 truncate text-[10px] text-slate-500">{source.module} / {source.week}</p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {source.reportedTime && source.reportedTime !== MISSING_VALUE && (
                                  <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-semibold text-slate-500">
                                    Reported {source.reportedTime}
                                  </span>
                                )}
                                {isNumber(source.hours) && (
                                  <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-semibold text-slate-500">
                                    {source.hours}h
                                  </span>
                                )}
                                {source.detail && source.detail !== MISSING_VALUE && source.detail !== source.reportedTime && (
                                  <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-semibold text-slate-500">
                                    {source.detail}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-semibold text-slate-400">
                            This KSB is counted as complete, but no source metadata was recorded.
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <h4 className="text-xs font-heading font-semibold text-foreground-900 mb-3">Granular Breakdown</h4>
              <div className="grid grid-cols-1 gap-3 text-[11px] sm:grid-cols-3">
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="font-semibold text-foreground-500">Knowledge %</p>
                  <p className={`mt-1 ${isNumber(selectedRow.knowledgeProgress) ? getMetricTone(selectedRow.knowledgeProgress) : 'text-foreground-400'}`}>{formatKsbPercent(selectedRow.knowledgeProgress)}</p>
                </div>
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="font-semibold text-foreground-500">Skills %</p>
                  <p className={`mt-1 ${isNumber(selectedRow.skillsProgress) ? getMetricTone(selectedRow.skillsProgress) : 'text-foreground-400'}`}>{formatKsbPercent(selectedRow.skillsProgress)}</p>
                </div>
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="font-semibold text-foreground-500">Behaviours %</p>
                  <p className={`mt-1 ${isNumber(selectedRow.behavioursProgress) ? getMetricTone(selectedRow.behavioursProgress) : 'text-foreground-400'}`}>{formatKsbPercent(selectedRow.behavioursProgress)}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <h4 className="text-xs font-heading font-semibold text-foreground-900 mb-3">Learner Context</h4>
              <div className="space-y-2 text-[11px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-400">Email</span>
                  <span className="max-w-[260px] truncate font-semibold text-foreground-700">{selectedRow.email}</span>
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
                  <span className="text-foreground-400">Gateway review</span>
                  <span className="font-semibold text-foreground-700">{selectedRow.gatewayReviewDate}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </RightSlidePanel>
    </WorkspaceShell>
  );
}
