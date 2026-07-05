import { useEffect, useMemo, useState } from 'react';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;
const API_ENDPOINT = '/api/coach/caseload';

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
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
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
  const minimum = Math.max(toNumber(learner.otjhMinimum), 0);
  const planned = Math.max(toNumber(learner.otjhPlanned ?? learner.otjhTarget), 0);
  const completed = Math.max(toNumber(learner.otjhCompleted), 0);
  const denominator = planned > 0 ? planned : Math.max(toNumber(learner.otjhTarget), 1);
  const statusFromDb = normalizeOtjhStatus(learner.otjhStatus);
  const status = statusFromDb === 'unknown' && planned > 0 && completed > planned ? 'ahead' : statusFromDb;
  const pace = denominator > 0 ? Math.round((completed / denominator) * 100) : 0;

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
    minimum,
    planned,
    submitted: Math.max(toNumber(learner.otjhSubmitted), 0),
    completed,
    forecast: Math.max(toNumber(learner.otjhForecast), 0),
    expected: Math.max(toNumber(learner.otjhExpected), 0),
    progressHours: displayText(learner.otjhProgressHours),
    remaining: Math.max(planned - completed, 0),
    pace,
    ksbStatus: displayText(learner.ksbStatus),
    ksbProgress: Math.max(toNumber(learner.ksbProgress), 0),
    evidenceCount: Math.max(toNumber(learner.evidenceCount), 0),
    overallProgress: Math.max(toNumber(learner.overallProgress), 0),
    status,
    statusLabel: getStatusLabel(status),
    risk: getRiskTone(status),
  };
}

export default function CoachOtjhReports() {
  const [filter, setFilter] = useState<FilterKey>('all');
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
    const totalPlanned = rows.reduce((total, row) => total + row.planned, 0);
    const totalCompleted = rows.reduce((total, row) => total + row.completed, 0);
    const behind = rows.filter(row => row.status === 'behind').length;
    const onTrack = rows.filter(row => row.status === 'on-track').length;
    const needAttention = rows.filter(row => row.status === 'need-attention').length;
    const completion = totalPlanned > 0 ? Math.round((totalCompleted / totalPlanned) * 100) : 0;

    return { totalPlanned, totalCompleted, behind, onTrack, needAttention, completion };
  }, [rows]);

  const filteredRows = useMemo(
    () => rows.filter(row => filter === 'all' || row.status === filter),
    [filter, rows],
  );

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
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="OTJH Reports" pageSubtitle="Monitor Off-The-Job Hours progress and pace" userName={ownerName} userRole="Progress Coach">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-time-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">OTJH Reports</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                Total caseload: <strong>{stats.totalCompleted}/{stats.totalPlanned} hours</strong> ({stats.completion}%). {stats.behind} at risk, {stats.needAttention} need attention, {stats.onTrack} on track.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{stats.totalCompleted}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Completed hrs</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{stats.totalPlanned}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Planned hrs</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-red-300">{stats.behind}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">At risk</p>
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
          <div className="grid grid-cols-[minmax(260px,1.7fr)_minmax(150px,1fr)_repeat(4,minmax(95px,0.65fr))_minmax(125px,0.8fr)_minmax(90px,0.5fr)] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
            <span>Learner</span>
            <span>Programme</span>
            <span className="text-center">Planned</span>
            <span className="text-center">Completed</span>
            <span className="text-center">Remaining</span>
            <span className="text-center">Pace</span>
            <span className="text-center">OTJH Status</span>
            <span className="text-center">Action</span>
          </div>

          {loading && (
            <div className="px-4 py-12 text-center text-[12px] text-foreground-500">
              Loading live OTJH data...
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
              No learners match this OTJH filter.
            </div>
          )}

          {!loading && !error && filteredRows.length > 0 && (
            <div className="divide-y divide-background-200/30">
              {filteredRows.map(row => (
                <div key={row.id} className="grid grid-cols-[minmax(260px,1.7fr)_minmax(150px,1fr)_repeat(4,minmax(95px,0.65fr))_minmax(125px,0.8fr)_minmax(90px,0.5fr)] gap-3 px-4 py-3.5 items-center hover:bg-background-100/30 transition-smooth">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${getAvatarStyle(row.risk)}`}>{row.initials}</div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-foreground-900 truncate">{row.learner}</p>
                      <p className="text-[10px] text-foreground-400 truncate">{row.employer}</p>
                    </div>
                  </div>
                  <span className="text-[11px] text-foreground-500 truncate">{row.programme}</span>
                  <span className="text-[11px] text-foreground-500 text-center">{row.planned}</span>
                  <span className="text-[11px] font-semibold text-primary-600 text-center">{row.completed}</span>
                  <span className="text-[11px] text-foreground-500 text-center">{row.remaining}</span>
                  <span className={`text-[11px] font-semibold text-center ${getPaceTone(row.pace)}`}>{row.pace}%</span>
                  <div className="flex justify-center">
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${getBadgeStyle(row.risk)}`}>{row.statusLabel}</span>
                  </div>
                  <div className="text-center">
                    <button onClick={() => handleViewDetails(row)} className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Details</button>
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
                <p className="mt-1 text-xl font-bold text-foreground-900">{selectedRow.planned}</p>
              </div>
              <div className="rounded-xl border border-foreground-200/60 bg-background-100/40 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Completed</p>
                <p className="mt-1 text-xl font-bold text-primary-600">{selectedRow.completed}</p>
              </div>
              <div className="rounded-xl border border-foreground-200/60 bg-background-100/40 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Remaining</p>
                <p className="mt-1 text-xl font-bold text-foreground-900">{selectedRow.remaining}</p>
              </div>
              <div className="rounded-xl border border-foreground-200/60 bg-background-100/40 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Pace</p>
                <p className={`mt-1 text-xl font-bold ${getPaceTone(selectedRow.pace)}`}>{selectedRow.pace}%</p>
              </div>
            </div>

            <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              <div className="flex items-center justify-between text-[11px] text-foreground-500">
                <span>OTJH completion against Planned</span>
                <span className="font-semibold text-foreground-900">{selectedRow.completed}/{selectedRow.planned}</span>
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
              <h4 className="text-xs font-heading font-semibold text-foreground-900 mb-3">Aptem OTJH Source Values</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-foreground-400">Minimum</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{selectedRow.minimum}</p>
                </div>
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-foreground-400">Submitted</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{selectedRow.submitted}</p>
                </div>
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-foreground-400">Forecast</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{selectedRow.forecast}</p>
                </div>
                <div className="rounded-xl bg-background-100/60 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-foreground-400">Expected</p>
                  <p className="mt-1 text-sm font-bold text-foreground-900">{selectedRow.expected}</p>
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
                      This learner is behind the planned OTJH pace. Current variance is {selectedRow.progressVariance}, with {selectedRow.progressHours} recorded in Progress-Hours.
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
