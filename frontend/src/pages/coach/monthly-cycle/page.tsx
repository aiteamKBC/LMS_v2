import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import {
  DEFAULT_COACH_EMAIL,
  type CoachCalendarEvent,
  eventDisplayDate,
  formatDateLabel,
  fetchCoachCalendarEvents,
  parseLocalDate,
} from '@/pages/coach/shared/calendarEvents';

const coachNav = roleNavMap.coach;
const CASELOAD_ENDPOINT = `/coach_api/coach/caseload?owner_email=${encodeURIComponent(DEFAULT_COACH_EMAIL)}`;

interface CaseloadLearner {
  id: string;
  name: string;
  initials: string;
  email?: string;
  cohortName?: string;
  group?: string;
  enrollmentStatus?: string;
  otjhStatus?: string;
  otjhCompleted?: number;
  otjhTarget?: number;
  evidenceCount?: number;
  ksbCompleted?: number | null;
  ksbTarget?: number | null;
}

interface CaseloadResponse {
  learners?: CaseloadLearner[];
}

type CycleStatus = 'completed' | 'in-progress' | 'scheduled';

interface CycleRow {
  id: string;
  learner: string;
  initials: string;
  programme: string;
  coachingDate: string;
  status: CycleStatus;
  otjhStatus: string;
  otjhComplete: boolean;
  reviewComplete: boolean;
  evidenceComplete: boolean;
  ksbComplete: boolean;
  otjhLabel: string;
  otjhProgress: number;
  evidenceLabel: string;
  ksbLabel: string;
  ksbProgress: number;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : `Request failed with ${response.status}`;
    throw new Error(detail);
  }
  return data as T;
}

function eventMatchesLearner(event: CoachCalendarEvent, learner: CaseloadLearner) {
  return event.learnerId === String(learner.id)
    || (!!event.email && !!learner.email && event.email.toLowerCase() === learner.email.toLowerCase());
}

function eventIsInMonth(event: CoachCalendarEvent, year: number, month: number) {
  const date = parseLocalDate(eventDisplayDate(event));
  return !!date && date.getFullYear() === year && date.getMonth() === month;
}

function buildCycleRow(learner: CaseloadLearner, events: CoachCalendarEvent[], year: number, month: number): CycleRow {
  const learnerEvents = events.filter((event) => eventMatchesLearner(event, learner) && eventIsInMonth(event, year, month));
  const coachingEvent = learnerEvents.find((event) => event.source === 'mcr' && event.status !== 'cancelled');
  const reviewEvent = learnerEvents.find((event) => event.source === 'progress-review' && event.status !== 'cancelled');
  const otjhCompleted = Number(learner.otjhCompleted || 0);
  const otjhTarget = Number(learner.otjhTarget || 0);
  const evidenceCount = Number(learner.evidenceCount || 0);
  const ksbCompleted = Number(learner.ksbCompleted || 0);
  const ksbTarget = Number(learner.ksbTarget || 0);

  const otjhComplete = otjhCompleted > 0;
  const reviewComplete = reviewEvent?.status === 'completed' || reviewEvent?.status === 'confirmed';
  const evidenceComplete = evidenceCount > 0;
  const ksbComplete = ksbCompleted > 0;
  const checks = [otjhComplete, reviewComplete, evidenceComplete, ksbComplete];
  const status: CycleStatus = checks.every(Boolean)
    ? 'completed'
    : checks.some(Boolean) || !!coachingEvent
      ? 'in-progress'
      : 'scheduled';

  return {
    id: learner.id,
    learner: learner.name,
    initials: learner.initials,
    programme: [learner.cohortName, learner.group].filter(Boolean).join(' · ') || '--',
    coachingDate: coachingEvent ? formatDateLabel(eventDisplayDate(coachingEvent)) : '--',
    status,
    otjhStatus: learner.otjhStatus || '--',
    otjhComplete,
    reviewComplete,
    evidenceComplete,
    ksbComplete,
    otjhLabel: `${otjhCompleted}/${otjhTarget} hrs`,
    otjhProgress: otjhTarget > 0 ? Math.min(100, Math.round((otjhCompleted / otjhTarget) * 100)) : 0,
    evidenceLabel: `${evidenceCount} item${evidenceCount === 1 ? '' : 's'}`,
    ksbLabel: ksbTarget > 0 ? `${ksbCompleted}/${ksbTarget}` : '--',
    ksbProgress: ksbTarget > 0 ? Math.min(100, Math.round((ksbCompleted / ksbTarget) * 100)) : 0,
  };
}

export default function CoachMonthlyCycle() {
  const navigate = useNavigate();
  const [learners, setLearners] = useState<CaseloadLearner[]>([]);
  const [events, setEvents] = useState<CoachCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const now = useMemo(() => new Date(), []);
  const monthLabel = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');

    Promise.all([
      fetch(CASELOAD_ENDPOINT, { signal: controller.signal }).then(readJson<CaseloadResponse>),
      fetchCoachCalendarEvents(controller.signal),
    ])
      .then(([caseload, timetable]) => {
        setLearners((caseload.learners || []).filter((learner) => learner.enrollmentStatus === 'active'));
        setEvents(timetable.events || []);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setLearners([]);
        setEvents([]);
        setError(requestError instanceof Error ? requestError.message : 'Unable to load monthly cycle data.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  const rows = useMemo(
    () => learners.map((learner) => buildCycleRow(learner, events, now.getFullYear(), now.getMonth())),
    [events, learners, now],
  );
  const onTrack = rows.filter((row) => row.otjhStatus.toLowerCase() === 'on track').length;
  const needAttention = rows.filter((row) => row.otjhStatus.toLowerCase().includes('attention')).length;
  const atRisk = rows.filter((row) => row.otjhStatus.toLowerCase() === 'at risk').length;

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Monthly Cycle" pageSubtitle="Track monthly coaching cycles and completion status" userName="Med Maher" userRole="Progress Coach">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-loop-left-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Monthly Cycle — {monthLabel}</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{onTrack} on track</strong>, {needAttention} need attention, {atRisk} at risk. {rows.length} active learners in this cycle.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-emerald-300">{onTrack}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">On Track</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-amber-300">{needAttention}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Need Attention</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-red-300">{atRisk}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">At Risk</p></div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit">
          <span className="px-4 py-1.5 rounded-lg text-[11px] font-semibold bg-background-50 text-foreground-900 shadow-sm">{monthLabel}</span>
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left">
              <thead className="bg-background-100/60 border-b border-foreground-200/60">
                <tr>
                  <th className="pl-5 pr-4 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Learner</th>
                  <th className="px-4 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Status</th>
                  <th className="px-4 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Last Session</th>
                  <th className="px-4 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider w-[170px]">OTJH Progress</th>
                  <th className="px-4 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Evidence</th>
                  <th className="px-4 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider w-[150px]">KSB Progress</th>
                  <th className="pl-4 pr-5 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/40">
                {loading && <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-foreground-400">Loading monthly cycle data...</td></tr>}
                {!loading && error && <tr><td colSpan={7} className="px-4 py-16 text-center"><i className="ri-error-warning-line text-red-500 text-2xl block mb-2"></i><p className="text-sm font-semibold text-red-600">Unable to load monthly cycle</p><p className="text-[11px] text-foreground-400 mt-1">{error}</p></td></tr>}
                {!loading && !error && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-foreground-400">No active learners are assigned to this coach.</td></tr>}
                {!loading && !error && rows.map((row) => (
                  <tr key={row.id} className="hover:bg-background-100/40 transition-smooth">
                    <td className="pl-5 pr-4 py-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 bg-primary-100 text-primary-700 ring-1 ring-primary-200">{row.initials}</div>
                        <div className="min-w-0"><p className="text-[12px] font-semibold text-foreground-900 truncate">{row.learner}</p><p className="text-[10px] text-foreground-400 truncate mt-0.5">{row.programme}</p></div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center"><span className={`inline-flex text-[9px] font-semibold px-2.5 py-1 rounded-full ${row.otjhStatus.toLowerCase() === 'on track' ? 'bg-emerald-100 text-emerald-700' : row.otjhStatus.toLowerCase() === 'at risk' ? 'bg-red-100 text-red-700' : row.otjhStatus.toLowerCase().includes('attention') ? 'bg-amber-100 text-amber-700' : 'bg-background-100 text-foreground-500'}`}>{row.otjhStatus}</span></td>
                    <td className="px-4 py-4 text-[11px] font-medium text-foreground-600 text-center whitespace-nowrap">{row.coachingDate}</td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-between gap-2 mb-1.5"><span className="text-[10px] font-medium text-foreground-600">{row.otjhLabel}</span><span className="text-[9px] text-foreground-400">{row.otjhProgress}%</span></div>
                      <div className="h-1.5 rounded-full bg-background-200 overflow-hidden"><div className="h-full rounded-full bg-primary-500" style={{ width: `${row.otjhProgress}%` }}></div></div>
                    </td>
                    <td className="px-4 py-4 text-center"><span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-medium ${row.evidenceComplete ? 'bg-emerald-50 text-emerald-700' : 'bg-background-100 text-foreground-500'}`}>{row.evidenceLabel}</span></td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-between gap-2 mb-1.5"><span className="text-[10px] font-medium text-foreground-600">{row.ksbLabel}</span><span className="text-[9px] text-foreground-400">{row.ksbProgress}%</span></div>
                      <div className="h-1.5 rounded-full bg-background-200 overflow-hidden"><div className="h-full rounded-full bg-accent-500" style={{ width: `${row.ksbProgress}%` }}></div></div>
                    </td>
                    <td className="pl-4 pr-5 py-4 text-center"><button onClick={() => navigate(`/coach/learner-case-file?id=${encodeURIComponent(row.id)}`)} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
