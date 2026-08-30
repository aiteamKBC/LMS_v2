import { useEffect, useMemo, useState } from 'react';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';
import { cn } from '@/lib/cn';
import { toneStyle, type StatusTone } from '@/lib/statusTone';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricCard } from '@/components/ui/MetricCard';
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
const MISSING_VALUE = '-';
const ROWS_PER_PAGE = 10;

type FilterKey = 'all' | 'high-risk' | 'on-track' | 'gateway-ready';
type RiskTone = 'red' | 'amber' | 'green';
type KsbDetailFilter = 'all' | 'knowledge' | 'skills' | 'behaviours';

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

function aggregateKsbProgress(
  completed: number | null | undefined,
  target: number | null | undefined,
): number | null {
  if (!isNumber(target) || target <= 0) return null;
  return percentage(isNumber(completed) ? completed : 0, target);
}

function getRiskTone(overall: number): RiskTone {
  if (overall < 40) return 'red';
  if (overall >= 80) return 'green';
  return 'amber';
}

/** The one place a KSB risk tone becomes a workspace-wide StatusTone. */
function riskToneOf(risk: RiskTone): StatusTone {
  if (risk === 'red') return 'critical';
  if (risk === 'green') return 'positive';
  return 'caution';
}

function ksbStatusLabel(overall: number): string {
  if (overall < 40) return 'High risk';
  if (overall >= 80) return 'Ready';
  return 'On track';
}

function getKsbTypeStyle(type?: string): string {
  const lowerType = optionalText(type).toLowerCase();
  if (lowerType.includes('skill')) return 'bg-sky-50 text-sky-700 border-sky-100';
  if (lowerType.includes('behaviour') || lowerType.includes('behavior')) return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  return 'bg-primary-50 text-primary-700 border-primary-100';
}

function ksbDetailFilterLabel(filter: KsbDetailFilter): string {
  if (filter === 'knowledge') return 'Knowledge';
  if (filter === 'skills') return 'Skills';
  if (filter === 'behaviours') return 'Behaviours';
  return 'All';
}

function ksbDetailMatchesFilter(detail: KsbCompletedDetail, filter: KsbDetailFilter): boolean {
  if (filter === 'all') return true;
  const lowerType = optionalText(detail.type).toLowerCase();
  if (filter === 'knowledge') return lowerType.includes('knowledge');
  if (filter === 'skills') return lowerType.includes('skill');
  return lowerType.includes('behaviour') || lowerType.includes('behavior');
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

/**
 * One Knowledge / Skills / Behaviours cell. The three columns share this exact
 * treatment — a mini ProgressMetric rather than a coloured number — so the KSB
 * triad reads as one comparable group instead of three separately-styled cells,
 * and the colour comes from ProgressMetric's own health-derived bar rather than
 * a page-local tone function.
 */
function KsbTriadValue({
  value,
  progress,
  label,
  onClick,
}: {
  value: number | null;
  progress: number | null;
  label: string;
  onClick?: () => void;
}) {
  const content = <ProgressMetric value={formatKsbCompleted(value)} percent={progress} />;

  if (!onClick) {
    return <div className="mx-auto w-full max-w-[108px]">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Open ${label} KSB details`}
      className="mx-auto block w-full max-w-[108px] rounded-lg p-1.5 text-left transition hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-300"
    >
      {content}
    </button>
  );
}

function KsbRatioValue({
  completed,
  target,
  label,
  onClick,
}: {
  completed: number | null | undefined;
  target: number | null | undefined;
  label: string;
  onClick?: () => void;
}) {
  const content = (
    <p className={cn('text-[12px] font-semibold tabular-nums', isNumber(target) && target > 0 ? 'text-foreground-700' : 'text-foreground-400')}>
      {formatKsbRatio(completed, target)}
    </p>
  );

  if (!onClick) {
    return <div className="text-center">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Open ${label} KSB details`}
      className="mx-auto block min-w-16 rounded-lg px-3 py-2 text-center transition hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-300"
    >
      {content}
    </button>
  );
}

export default function CoachKsbImpact() {
  const coach = useCoachIdentity();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [rows, setRows] = useState<KsbImpactRow[]>([]);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [selectedDetailFilter, setSelectedDetailFilter] = useState<KsbDetailFilter>('all');
  const [ownerName, setOwnerName] = useState('Coach');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!coach.isInitialized) return;
    if (!coach.email) {
      setRows([]);
      setOwnerName(coach.name);
      setError('Coach access is required to load KSB data.');
      setLoading(false);
      return;
    }
    const controller = new AbortController();

    async function loadKsbData() {
      setLoading(true);
      setError(null);

      try {
        const response = await coachFetch(API_ENDPOINT, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = (await response.json()) as CaseloadApiResponse;
        setOwnerName(payload.owner?.name || coach.name);
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
  }, [coach.email, coach.isInitialized, coach.name]);

  const stats = useMemo(() => {
    const totalCompleted = sumCompleted(rows.map(row => row.completed));
    const totalTarget = sumCompleted(rows.map(row => row.target));
    const averageOverall = aggregateKsbProgress(totalCompleted, totalTarget) ?? 0;
    const totalKnowledgeCompleted = sumCompleted(rows.map(row => row.knowledgeCompleted));
    const totalKnowledgeTarget = sumCompleted(rows.map(row => row.knowledgeTarget));
    const totalSkillsCompleted = sumCompleted(rows.map(row => row.skillsCompleted));
    const totalSkillsTarget = sumCompleted(rows.map(row => row.skillsTarget));
    const totalBehavioursCompleted = sumCompleted(rows.map(row => row.behavioursCompleted));
    const totalBehavioursTarget = sumCompleted(rows.map(row => row.behavioursTarget));
    const highRisk = rows.filter(row => row.overall < 40).length;
    const onTrack = rows.filter(row => row.overall >= 40 && row.overall < 80).length;
    const gatewayReady = rows.filter(row => row.overall >= 80).length;

    return {
      averageOverall,
      totalCompleted,
      totalTarget,
      totalKnowledgeCompleted,
      totalKnowledgeTarget,
      totalKnowledgeProgress: aggregateKsbProgress(totalKnowledgeCompleted, totalKnowledgeTarget),
      totalSkillsCompleted,
      totalSkillsTarget,
      totalSkillsProgress: aggregateKsbProgress(totalSkillsCompleted, totalSkillsTarget),
      totalBehavioursCompleted,
      totalBehavioursTarget,
      totalBehavioursProgress: aggregateKsbProgress(totalBehavioursCompleted, totalBehavioursTarget),
      highRisk,
      onTrack,
      gatewayReady,
    };
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
  const selectedCompletedDetails = selectedRow
    ? selectedRow.completedDetails.filter(detail => ksbDetailMatchesFilter(detail, selectedDetailFilter))
    : [];
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE));
  const activePage = Math.min(currentPage, pageCount);
  const paginatedRows = filteredRows.slice((activePage - 1) * ROWS_PER_PAGE, activePage * ROWS_PER_PAGE);

  const changeFilter = (nextFilter: FilterKey) => {
    setFilter(nextFilter);
    setCurrentPage(1);
  };

  const openKsbDetails = (rowId: string, detailFilter: KsbDetailFilter = 'all') => {
    setSelectedRowId(rowId);
    setSelectedDetailFilter(detailFilter);
  };

  const closeKsbDetails = () => {
    setSelectedRowId(null);
    setSelectedDetailFilter('all');
  };

  const filterTabItems: PageTabItem[] = [
    { value: 'all', label: 'All', count: rows.length },
    { value: 'high-risk', label: 'High Risk', count: stats.highRisk, tone: 'critical' },
    { value: 'on-track', label: 'On Track', count: stats.onTrack, tone: 'caution' },
    { value: 'gateway-ready', label: 'Gateway Ready', count: stats.gatewayReady, tone: 'positive' },
  ];

  const ksbColumns: DataColumn<KsbImpactRow>[] = [
    {
      key: 'learner',
      label: 'Learner',
      widthClass: 'min-w-[220px]',
      render: (row) => (
        <LearnerIdentity name={row.learner} programme={row.programme} tone={riskToneOf(row.risk)} />
      ),
    },
    {
      key: 'knowledge',
      label: 'Knowledge',
      align: 'center',
      widthClass: 'w-[112px] min-w-[112px]',
      render: (row) => (
        <KsbTriadValue
          value={row.knowledgeCompleted}
          progress={row.knowledgeProgress}
          label="Knowledge"
          onClick={() => openKsbDetails(row.id, 'knowledge')}
        />
      ),
    },
    {
      key: 'skills',
      label: 'Skills',
      align: 'center',
      widthClass: 'w-[112px] min-w-[112px]',
      render: (row) => (
        <KsbTriadValue
          value={row.skillsCompleted}
          progress={row.skillsProgress}
          label="Skills"
          onClick={() => openKsbDetails(row.id, 'skills')}
        />
      ),
    },
    {
      key: 'behaviours',
      label: 'Behaviours',
      align: 'center',
      widthClass: 'w-[112px] min-w-[112px]',
      render: (row) => (
        <KsbTriadValue
          value={row.behavioursCompleted}
          progress={row.behavioursProgress}
          label="Behaviours"
          onClick={() => openKsbDetails(row.id, 'behaviours')}
        />
      ),
    },
    {
      key: 'validated',
      label: 'Validated',
      align: 'center',
      widthClass: 'w-[110px] min-w-[110px]',
      render: (row) => (
        <KsbRatioValue
          completed={row.completed}
          target={row.target}
          label="Validated"
          onClick={() => openKsbDetails(row.id, 'all')}
        />
      ),
    },
    {
      key: 'overall',
      label: 'Overall progress',
      widthClass: 'w-[200px] min-w-[180px]',
      render: (row) => (
        <ProgressMetric
          value={`${row.overall}%`}
          percent={row.overall}
          note={<StatusBadge tone={riskToneOf(row.risk)} label={ksbStatusLabel(row.overall)} size="sm" />}
        />
      ),
    },
    {
      key: 'evidence',
      label: 'Evidenced',
      align: 'center',
      widthClass: 'w-[92px] min-w-[92px]',
      render: (row) => (
        <span className="text-[12px] font-semibold text-foreground-500">
          {row.evidenceCountAvailable ? row.evidenceCount : MISSING_VALUE}
        </span>
      ),
    },
    {
      key: 'action',
      label: '',
      align: 'center',
      widthClass: 'w-[100px] min-w-[100px]',
      render: (row) => (
        <RowAction label="Details" icon="ri-arrow-right-s-line" onClick={() => openKsbDetails(row.id)} />
      ),
    },
  ];

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Monthly KSB Impact" pageSubtitle="Track Knowledge, Skills and Behaviours progress across your caseload" userName={ownerName} userRole="Progress Coach">
      <PageContainer>
        <PageHeader
          title="Monthly KSB Impact"
          description="Track Knowledge, Skills and Behaviours progress across your caseload and spot learners who need support."
          icon="ri-stack-line"
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard
            label="Needs attention"
            value={stats.highRisk ? `${stats.highRisk} high-risk learner${stats.highRisk === 1 ? '' : 's'}` : 'Everything on track'}
            tone={stats.highRisk ? 'critical' : 'positive'}
            active={filter === 'high-risk'}
            onClick={() => changeFilter('high-risk')}
          />
          <MetricCard
            label="Average KSB progress"
            value={`${stats.averageOverall}%`}
            tone="brand"
            active={filter === 'on-track'}
            onClick={() => changeFilter('on-track')}
          />
          <MetricCard
            label="Validated / target"
            value={`${stats.totalCompleted ?? 0}/${stats.totalTarget ?? 0}`}
            active={filter === 'gateway-ready'}
            onClick={() => changeFilter('gateway-ready')}
          />
        </div>

        <section className="space-y-3">
          <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-end">
            <div>
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-foreground-900">
                Learner KSB progress
                <span className="text-[15px] font-semibold tabular-nums text-foreground-400">{filteredRows.length}</span>
              </h2>
              <p className="mt-0.5 text-[12px] leading-relaxed text-foreground-500">
                Live validated KSB values and supporting evidence across your caseload.
              </p>
            </div>
            <PageTabs items={filterTabItems} value={filter} onChange={(next) => changeFilter(next as FilterKey)} label="Filter learners by KSB status" />
          </div>

          <DataTable
            columns={ksbColumns}
            rows={paginatedRows}
            rowKey={(row) => row.id}
            stickyFirstColumn
            minWidthClass="min-w-[1180px]"
            caption="Learner KSB progress"
            loading={loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-12 animate-pulse rounded-lg bg-background-100" />
                ))}
              </div>
            ) : undefined}
            empty={
              error ? (
                <EmptyState variant="error" title="Unable to load KSB data" description={error} />
              ) : (
                <EmptyState variant="no-matches" title="No learners match this KSB filter." description="Try a different KSB status filter." />
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
        onClose={closeKsbDetails}
        title={selectedRow?.learner || 'KSB Details'}
        width="w-[560px]"
      >
        {selectedRow && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <div className="flex items-start gap-3">
                <LearnerAvatar name={selectedRow.learner} tone={riskToneOf(selectedRow.risk)} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-heading font-bold text-foreground-900">{selectedRow.learner}</h3>
                    <StatusBadge tone={riskToneOf(selectedRow.risk)} label={ksbStatusLabel(selectedRow.overall)} size="sm" />
                  </div>
                  <p className="mt-1 text-[12px] text-foreground-500">{selectedRow.employer}</p>
                  <p className="mt-0.5 text-[12px] text-foreground-400">{selectedRow.programme}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-foreground-200/60 bg-background-100/40 p-3 text-center">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">Overall</p>
                <p className={cn('mt-1 text-xl font-bold', toneStyle(riskToneOf(selectedRow.risk)).text)}>{selectedRow.overall}%</p>
              </div>
              <div className="rounded-lg border border-foreground-200/60 bg-background-100/40 p-3 text-center">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">Completed</p>
                <p className="mt-1 text-xl font-bold text-primary-600">{selectedRow.completed}</p>
              </div>
              <div className="rounded-lg border border-foreground-200/60 bg-background-100/40 p-3 text-center">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">Target</p>
                <p className="mt-1 text-xl font-bold text-foreground-900">{selectedRow.target || MISSING_VALUE}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <div className="flex items-center justify-between text-[12px] text-foreground-500">
                <span>KSB completion against target</span>
                <span className="font-semibold text-foreground-900">{selectedRow.completed}/{selectedRow.target || MISSING_VALUE}</span>
              </div>
              <ProgressBar percent={selectedRow.overall} height="h-2" className="mt-3" />
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <h4 className="text-xs font-heading font-semibold text-foreground-900 mb-3">Live KSB Source Values</h4>
              <div className="space-y-2 text-[12px]">
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
                  <h4 className="text-xs font-heading font-semibold text-foreground-900">
                    {ksbDetailFilterLabel(selectedDetailFilter)} KSB Breakdown
                  </h4>
                  <p className="mt-1 text-[12px] text-foreground-400">Each completed KSB and the activity that surfaced it.</p>
                </div>
                <span className="shrink-0 rounded-full bg-primary-50 px-3 py-1 text-[12px] font-bold text-primary-700">
                  {selectedCompletedDetails.length} KSB{selectedCompletedDetails.length === 1 ? '' : 's'}
                </span>
              </div>

              <PageTabs
                className="mt-4"
                items={(['all', 'knowledge', 'skills', 'behaviours'] as KsbDetailFilter[]).map((key) => ({
                  value: key,
                  label: ksbDetailFilterLabel(key),
                }))}
                value={selectedDetailFilter}
                onChange={(next) => setSelectedDetailFilter(next as KsbDetailFilter)}
                label="Filter KSB breakdown by type"
              />

              {selectedCompletedDetails.length === 0 ? (
                <EmptyState size="sm" variant="no-matches" title="No completed KSB details available yet." />
              ) : (
                <div className="mt-4 max-h-[24rem] space-y-2 overflow-y-auto pr-1">
                  {selectedCompletedDetails.map(detail => (
                    <div key={detail.code} className="rounded-2xl border border-foreground-200/70 bg-background-50 p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-lg bg-primary-100 px-2.5 py-1 text-[12px] font-bold text-primary-800">{detail.code}</span>
                            <span className={cn('rounded-full border px-2 py-0.5 text-[12px] font-bold uppercase tracking-wide', getKsbTypeStyle(detail.type))}>
                              {detail.type}
                            </span>
                          </div>
                          <p className="mt-2 text-[12px] font-semibold leading-relaxed text-foreground-800">
                            {detail.description || 'No programme description recorded for this KSB.'}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-background-100 px-2.5 py-1 text-[12px] font-bold text-foreground-500">
                          {detail.sources?.length || 0} source{detail.sources?.length === 1 ? '' : 's'}
                        </span>
                      </div>

                      <div className="mt-3 space-y-2">
                        {detail.sources && detail.sources.length > 0 ? (
                          detail.sources.map(source => (
                            <div key={source.id} className="rounded-lg border border-foreground-100 bg-background-100/60 px-3 py-2">
                              <div className="flex items-center justify-between gap-3">
                                <span className="rounded-full bg-background-50 px-2 py-0.5 text-[12px] font-bold uppercase tracking-wide text-foreground-500">
                                  {source.typeLabel}
                                </span>
                                <span className="text-[12px] font-semibold text-foreground-400">{source.completedDate}</span>
                              </div>
                              <p className="mt-1.5 truncate text-[12px] font-bold text-foreground-900">{source.title}</p>
                              <p className="mt-1 truncate text-[12px] text-foreground-500">{source.module} / {source.week}</p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {source.reportedTime && source.reportedTime !== MISSING_VALUE && (
                                  <span className="rounded-full bg-background-50 px-2 py-0.5 text-[12px] font-semibold text-foreground-500">
                                    Reported {source.reportedTime}
                                  </span>
                                )}
                                {isNumber(source.hours) && (
                                  <span className="rounded-full bg-background-50 px-2 py-0.5 text-[12px] font-semibold text-foreground-500">
                                    {source.hours}h
                                  </span>
                                )}
                                {source.detail && source.detail !== MISSING_VALUE && source.detail !== source.reportedTime && (
                                  <span className="rounded-full bg-background-50 px-2 py-0.5 text-[12px] font-semibold text-foreground-500">
                                    {source.detail}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="rounded-lg border border-dashed border-foreground-200 bg-background-100/60 px-3 py-2 text-[12px] font-semibold text-foreground-400">
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <ProgressMetric label="Knowledge %" value={formatKsbPercent(selectedRow.knowledgeProgress)} percent={selectedRow.knowledgeProgress} />
                <ProgressMetric label="Skills %" value={formatKsbPercent(selectedRow.skillsProgress)} percent={selectedRow.skillsProgress} />
                <ProgressMetric label="Behaviours %" value={formatKsbPercent(selectedRow.behavioursProgress)} percent={selectedRow.behavioursProgress} />
              </div>
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <h4 className="text-xs font-heading font-semibold text-foreground-900 mb-3">Learner Context</h4>
              <div className="space-y-2 text-[12px]">
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
