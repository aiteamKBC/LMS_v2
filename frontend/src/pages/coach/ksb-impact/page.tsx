import { useEffect, useMemo, useState } from 'react';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;
const API_ENDPOINT = '/coach_api/coach/caseload';
const MISSING_VALUE = '-';

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
  evidenceCount?: number;
  evidenceCountAvailable?: boolean;
  rawProgramStatus?: string;
  coachRag?: string;
  startDate?: string;
  gatewayReviewDate?: string;
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

export default function CoachKsbImpact() {
  const [filter, setFilter] = useState<FilterKey>('all');
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

  const filterOptions: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: 'all', label: 'All', count: rows.length },
    { key: 'high-risk', label: 'High Risk', count: stats.highRisk },
    { key: 'on-track', label: 'On Track', count: stats.onTrack },
    { key: 'gateway-ready', label: 'Gateway Ready', count: stats.gatewayReady },
  ];

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Monthly KSB Impact" pageSubtitle="Track Knowledge, Skills and Behaviours progress across your caseload" userName={ownerName} userRole="Progress Coach">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-bar-chart-2-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Monthly KSB Impact</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                Average KSB: Overall <strong>{stats.averageOverall}%</strong>. Knowledge {formatKsbCompleted(stats.totalKnowledgeCompleted)}, Skills {formatKsbCompleted(stats.totalSkillsCompleted)}, Behaviours {formatKsbCompleted(stats.totalBehavioursCompleted)}. {stats.highRisk} high-risk, {stats.gatewayReady} Gateway-ready.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{stats.averageOverall}%</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Overall KSB</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{formatKsbCompleted(stats.totalKnowledgeCompleted)}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Knowledge</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{formatKsbCompleted(stats.totalSkillsCompleted)}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Skills</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{formatKsbCompleted(stats.totalBehavioursCompleted)}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Behaviours</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit">
          {filterOptions.map(option => (
            <button
              key={option.key}
              onClick={() => setFilter(option.key)}
              className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === option.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}
            >
              {option.label} <span className="text-[10px] opacity-60">({option.count})</span>
            </button>
          ))}
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="grid grid-cols-[minmax(240px,1.5fr)_repeat(3,minmax(90px,0.7fr))_minmax(120px,0.8fr)_minmax(90px,0.75fr)_repeat(2,minmax(90px,0.65fr))_minmax(80px,0.5fr)_minmax(80px,0.5fr)] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
            <span>Learner</span>
            <span className="text-center">Knowledge</span>
            <span className="text-center">Skills</span>
            <span className="text-center">Behaviours</span>
            <span className="text-center">Validated</span>
            <span className="text-center">Overall</span>
            <span className="text-center">Evidenced</span>
            <span className="text-center">Applied</span>
            <span className="text-center">Trend</span>
            <span className="text-center">Action</span>
          </div>

          {loading && (
            <div className="px-4 py-12 text-center text-[12px] text-foreground-500">
              Loading live KSB data...
            </div>
          )}

          {!loading && error && (
            <div className="px-4 py-12 text-center">
              <i className="ri-error-warning-line text-red-500 text-2xl"></i>
              <p className="mt-2 text-sm font-semibold text-foreground-900">{error}</p>
            </div>
          )}

          {!loading && !error && filteredRows.length === 0 && (
            <div className="px-4 py-12 text-center text-[12px] text-foreground-500">
              No learners match this KSB filter.
            </div>
          )}

          {!loading && !error && filteredRows.length > 0 && (
            <div className="divide-y divide-background-200/30">
              {filteredRows.map(row => (
                <div key={row.id} className="grid grid-cols-[minmax(240px,1.5fr)_repeat(3,minmax(90px,0.7fr))_minmax(120px,0.8fr)_minmax(90px,0.75fr)_repeat(2,minmax(90px,0.65fr))_minmax(80px,0.5fr)_minmax(80px,0.5fr)] gap-3 px-4 py-3.5 items-center hover:bg-background-100/30 transition-smooth">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${getAvatarStyle(row.risk)}`}>{row.initials}</div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-foreground-900 truncate">{row.learner}</p>
                      <p className="text-[10px] text-foreground-400 truncate">{row.programme}</p>
                    </div>
                  </div>
                  <span className={`text-[11px] font-semibold text-center ${isNumber(row.knowledgeCompleted) ? getMetricTone(row.overall) : 'text-foreground-400'}`}>{formatKsbCompleted(row.knowledgeCompleted)}</span>
                  <span className={`text-[11px] font-semibold text-center ${isNumber(row.skillsCompleted) ? getMetricTone(row.overall) : 'text-foreground-400'}`}>{formatKsbCompleted(row.skillsCompleted)}</span>
                  <span className={`text-[11px] font-semibold text-center ${isNumber(row.behavioursCompleted) ? getMetricTone(row.overall) : 'text-foreground-400'}`}>{formatKsbCompleted(row.behavioursCompleted)}</span>
                  <span className="text-[11px] text-foreground-500 text-center">{formatKsbRatio(row.completed, row.target)}</span>
                  <span className={`text-[13px] font-bold text-center ${getMetricTone(row.overall)}`}>{row.overall}%</span>
                  <span className="text-[11px] font-semibold text-center text-foreground-400">{row.evidenceCountAvailable ? row.evidenceCount : MISSING_VALUE}</span>
                  <span className="text-[11px] font-semibold text-center text-foreground-400">{MISSING_VALUE}</span>
                  <div className="flex justify-center">
                    <span className="text-[11px] font-semibold text-foreground-400">{MISSING_VALUE}</span>
                  </div>
                  <div className="text-center">
                    <button onClick={() => setSelectedRowId(row.id)} className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">View</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <RightSlidePanel
        isOpen={selectedRow !== null}
        onClose={() => setSelectedRowId(null)}
        title={selectedRow?.learner || 'KSB Details'}
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
              <h4 className="text-xs font-heading font-semibold text-foreground-900 mb-3">Granular Breakdown</h4>
              <div className="grid grid-cols-2 gap-3 text-[11px]">
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
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="font-semibold text-foreground-500">Trend</p>
                  <p className="mt-1 text-foreground-400">{MISSING_VALUE}</p>
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
