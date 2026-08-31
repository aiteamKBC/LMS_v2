import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { LearnerProfilePanel } from '@/pages/engagement/LearnerProfilePanel';
import { useToast } from '@/hooks/useToast';
import { useOperatorIdentity } from '@/hooks/useOperatorIdentity';
import { roleNavMap } from '@/mocks/navigation';
import {
  fetchLearnerAnalytics, createAttendanceIntervention,
  type LearnerAnalyticsRow,
} from '@/api/engagement';
import { EmptyState } from '@/components/feature/EmptyState';

const engagementNav = roleNavMap.engagement;

type RiskFilter = 'all' | 'red' | 'amber' | 'green';
type SortKey = 'score' | 'attendance' | 'name' | 'missed' | 'consecutive';

// Mirrors services.ENGAGEMENT_SCORE_WEIGHTS server-side — same weighting,
// shown here purely for the breakdown UI (the score itself is server-computed).
const SCORE_WEIGHTS = [
  { key: 'attendanceRate' as const, label: 'Attendance Rate', weight: 30 },
  { key: 'ksbProgress' as const, label: 'KSB Progression', weight: 30 },
  { key: 'otjhPct' as const, label: 'OTJH Progress', weight: 20 },
  { key: 'quizAverage' as const, label: 'Quiz Average', weight: 20 },
];

function sessionAttendancePct(r: LearnerAnalyticsRow) {
  return r.totalSessions ? Math.round(((r.totalSessions - (r.sessionsMissed ?? 0)) / r.totalSessions) * 100) : null;
}

function otjhPct(r: LearnerAnalyticsRow) {
  return r.otjhTarget ? Math.min(100, Math.round((r.otjhHours / r.otjhTarget) * 100)) : null;
}

function bandColor(value: number | null) {
  if (value == null) return 'bg-background-300';
  return value >= 70 ? 'bg-emerald-500' : value >= 55 ? 'bg-amber-500' : 'bg-red-500';
}
function bandText(value: number | null) {
  if (value == null) return 'text-foreground-400';
  return value >= 70 ? 'text-emerald-600' : value >= 55 ? 'text-amber-600' : 'text-red-600';
}

const RISK_CONFIG: Record<'red' | 'amber' | 'green', { bg: string; text: string; cardBorder: string; cardBg: string; avatarBg: string; avatarText: string; icon: string; label: string }> = {
  red: { bg: 'bg-red-100', text: 'text-red-700', cardBorder: 'border-red-200/50', cardBg: 'bg-red-50/20', avatarBg: 'bg-red-100', avatarText: 'text-red-700', icon: 'ri-error-warning-line', label: 'Critical' },
  amber: { bg: 'bg-amber-100', text: 'text-amber-700', cardBorder: 'border-amber-200/50', cardBg: 'bg-amber-50/20', avatarBg: 'bg-amber-100', avatarText: 'text-amber-700', icon: 'ri-alert-line', label: 'High' },
  green: { bg: 'bg-emerald-100', text: 'text-emerald-700', cardBorder: 'border-foreground-200/60', cardBg: '', avatarBg: 'bg-emerald-100', avatarText: 'text-emerald-700', icon: 'ri-checkbox-circle-line', label: 'On track' },
};

export default function AttendanceRiskPage() {
  const navigate = useNavigate();
  const { success, warning } = useToast();
  const operator = useOperatorIdentity();
  const [learners, setLearners] = useState<LearnerAnalyticsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<RiskFilter>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<LearnerAnalyticsRow | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [actionForm, setActionForm] = useState<{ action: string; employerNotified: boolean; interventionDate: string }>({ action: '', employerNotified: false, interventionDate: '' });
  const [submittingAction, setSubmittingAction] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLearnerAnalytics()
      .then(data => { if (!cancelled) setLearners(data); })
      .catch(err => { if (!cancelled) warning('Could not load learner analytics', err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [warning]);

  const atRisk = useMemo(() => learners.filter(l => l.riskLevel === 'red' || l.riskLevel === 'amber'), [learners]);
  const criticalCount = learners.filter(l => l.riskLevel === 'red').length;
  const highCount = learners.filter(l => l.riskLevel === 'amber').length;
  const onTrackCount = learners.filter(l => l.riskLevel === 'green').length;

  const breakdownAverages = useMemo(() => {
    const values = (key: typeof SCORE_WEIGHTS[number]['key']) => atRisk
      .map(r => key === 'attendanceRate' ? r.attendanceRate : key === 'ksbProgress' ? r.ksbProgress : key === 'otjhPct' ? otjhPct(r) : r.quizAverage)
      .filter((v): v is number => v != null);
    return SCORE_WEIGHTS.map(w => {
      const vals = values(w.key);
      return { ...w, avg: vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null };
    });
  }, [atRisk]);

  const filtered = useMemo(() => {
    let list = filter === 'all' ? [...atRisk] : atRisk.filter(r => r.riskLevel === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r => r.name.toLowerCase().includes(q) || r.programme.toLowerCase().includes(q) || (r.coach ?? '').toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      let va: number | string, vb: number | string;
      switch (sortKey) {
        case 'name': va = a.name; vb = b.name; break;
        case 'missed': va = a.sessionsMissed ?? -1; vb = b.sessionsMissed ?? -1; break;
        case 'consecutive': va = a.consecutiveMissed ?? -1; vb = b.consecutiveMissed ?? -1; break;
        case 'attendance': va = a.attendanceRate ?? -1; vb = b.attendanceRate ?? -1; break;
        default: va = a.engagementScore ?? -1; vb = b.engagementScore ?? -1;
      }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === 'asc' ? va - (vb as number) : (vb as number) - va;
    });
    return list;
  }, [atRisk, filter, search, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  function openAction(risk: LearnerAnalyticsRow) {
    setActionForm({ action: risk.attendanceAction ?? '', employerNotified: risk.employerNotified, interventionDate: risk.interventionDate ?? '' });
    setSelected(risk);
  }

  async function submitAction() {
    if (!selected || !actionForm.action.trim()) return;
    setSubmittingAction(true);
    try {
      const created = await createAttendanceIntervention({
        learnerId: selected.id, learnerName: selected.name, action: actionForm.action.trim(),
        employerNotified: actionForm.employerNotified, interventionDate: actionForm.interventionDate || null,
      });
      setLearners(prev => prev.map(l => l.id === selected.id
        ? { ...l, attendanceAction: created.action, employerNotified: created.employerNotified, interventionDate: created.interventionDate }
        : l));
      success(`Intervention logged for ${selected.name}`);
      setSelected(null);
    } catch (err: any) {
      warning('Could not log intervention', err.message);
    } finally {
      setSubmittingAction(false);
    }
  }

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Attendance Risk" pageSubtitle="Real attendance signals from verified Teams sessions — track learners at risk and log interventions"
      userName={operator.name} userRole={operator.role}
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Attendance Risk Monitoring"
          description={`${criticalCount} critical, ${highCount} high-risk learners${onTrackCount ? `, ${onTrackCount} on track` : ''}.`}
          icon="ri-alert-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20workplace%20attendance%20monitoring%20dashboard%20professional%20office%20setting%20warm%20neutral%20lighting%20modern&width=400&height=160&seq=attendance-risk-01&orientation=landscape"
          imageAlt="Attendance Risk"
          stats={[{ label: 'Critical', value: String(criticalCount), variant: 'danger' }, { label: 'High', value: String(highCount) }, { label: 'On track', value: String(onTrackCount) }]}
        />

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-heart-line text-sm"></AppIcon> Learner Engagement
          </button>
        </div>

        {!loading && atRisk.length > 0 && (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 shadow-sm p-5">
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-1">Engagement Score Breakdown</h3>
            <p className="text-[11px] text-foreground-400 mb-4">Weighted composite of real signals, averaged across at-risk learners — critical &lt;55, high &lt;70</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {breakdownAverages.map(dim => (
                <div key={dim.key} className="bg-background-100/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-medium text-foreground-700">{dim.label}</span>
                    <span className="text-[10px] text-foreground-400">{dim.weight}%</span>
                  </div>
                  <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${bandColor(dim.avg)}`} style={{ width: `${dim.avg ?? 0}%` }}></div>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-foreground-400">Average</span>
                    <span className={`text-[10px] font-bold ${bandText(dim.avg)}`}>{dim.avg != null ? `${dim.avg}%` : 'No data'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-sm">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input
              type="text" placeholder="Search learner, programme, or coach..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
            {(['all', 'red', 'amber', 'green'] as const).map(f => {
              const count = f === 'all' ? atRisk.length : atRisk.filter(r => r.riskLevel === f).length;
              return (
                <button key={f} onClick={() => setFilter(f)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === f ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                  <AppIcon className={`${f === 'all' ? 'ri-list-check' : RISK_CONFIG[f].icon} text-sm`}></AppIcon>
                  {f === 'all' ? 'All' : RISK_CONFIG[f].label}
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full leading-none ${filter === f ? 'bg-background-200 text-foreground-600' : 'bg-background-200/70 text-foreground-500'}`}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className="font-semibold text-foreground-500">Sort by:</span>
          {([
            { key: 'score' as SortKey, label: 'Engagement Score' },
            { key: 'attendance' as SortKey, label: 'Attendance Rate' },
            { key: 'name' as SortKey, label: 'Name' },
            { key: 'missed' as SortKey, label: 'Sessions Missed' },
            { key: 'consecutive' as SortKey, label: 'Consecutive Missed' },
          ]).map(opt => (
            <button key={opt.key} onClick={() => handleSort(opt.key)} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition-smooth cursor-pointer whitespace-nowrap ${sortKey === opt.key ? 'bg-primary-50 text-primary-700 border border-primary-200/50' : 'text-foreground-500 hover:text-foreground-700 border border-transparent'}`}>
              {opt.label}
              {sortKey === opt.key && <AppIcon className={sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'}></AppIcon>}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {loading && <p className="text-[11px] text-foreground-400 py-8 text-center">Loading attendance analytics…</p>}
          {!loading && filtered.length === 0 && (
            <EmptyState icon="ri-search-line" title="No learners match this view" subtitle="Try clearing the search or switching the risk filter." />
          )}
          {filtered.map(risk => {
            const rc = risk.riskLevel ? RISK_CONFIG[risk.riskLevel] : RISK_CONFIG.green;
            const attendancePct = sessionAttendancePct(risk);
            return (
              <div key={risk.id} className={`bg-background-50 rounded-2xl border p-4 shadow-sm card-premium hover:-translate-y-0.5 ${rc.cardBorder} ${rc.cardBg}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <button onClick={() => setProfileId(risk.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer">
                    <div className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-bold ${rc.avatarBg} ${rc.avatarText}`}>{risk.name.charAt(0)}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground-900 hover:text-primary-600 transition-smooth">{risk.name}</p>
                      <p className="text-[10px] text-foreground-400">{risk.programme} &middot; {risk.cohort} &middot; Coach: {risk.coach ?? '—'}</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-3 text-[11px] shrink-0 flex-wrap">
                    <span className={`text-lg font-bold ${bandText(risk.engagementScore)}`}>{risk.engagementScore ?? '—'}</span>
                    <span className="text-foreground-400">score</span>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${rc.bg} ${rc.text}`}>{rc.label.toUpperCase()}</span>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                  {[
                    { label: 'Attendance', value: attendancePct, sub: risk.totalSessions ? `${risk.totalSessions - (risk.sessionsMissed ?? 0)}/${risk.totalSessions} sessions` : undefined },
                    { label: 'KSB Progression', value: risk.ksbProgress },
                    { label: 'OTJH Progress', value: otjhPct(risk) },
                    { label: 'Quiz Average', value: risk.quizAverage },
                  ].map(bar => (
                    <div key={bar.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-foreground-400">{bar.label}</span>
                        <span className="text-[10px] font-semibold text-foreground-700">{bar.value == null ? 'No data' : bar.sub ? `${bar.sub} (${bar.value}%)` : `${bar.value}%`}</span>
                      </div>
                      <div className="w-full h-1.5 bg-background-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${bandColor(bar.value)}`} style={{ width: `${bar.value ?? 0}%` }}></div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-3 gap-3 text-[11px]">
                  <div>
                    <p className="text-[10px] text-foreground-400 mb-0.5">Points</p>
                    <p className="font-semibold text-foreground-900">{risk.points.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-foreground-400 mb-0.5">Last Active</p>
                    <p className="font-semibold text-foreground-900">{risk.lastActive ? new Date(risk.lastActive).toLocaleDateString('en-GB') : '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-foreground-400 mb-0.5">Consecutive Missed</p>
                    <p className="font-semibold text-foreground-900">{risk.consecutiveMissed ?? '—'}</p>
                  </div>
                </div>

                <div className="mt-3 bg-amber-50/50 rounded-lg p-3 flex items-start gap-2">
                  <AppIcon className={`text-sm mt-0.5 ${risk.riskLevel === 'red' ? 'ri-error-warning-line text-red-600' : 'ri-alert-line text-amber-600'}`}></AppIcon>
                  <div className="flex-1">
                    {risk.attendanceAction ? (
                      <>
                        <p className="text-[11px] font-medium text-amber-800">Logged Action</p>
                        <p className="text-[11px] text-amber-700">{risk.attendanceAction}</p>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="text-[10px] text-foreground-400">{risk.employerNotified ? 'Employer notified' : 'Employer not notified'}</span>
                          {risk.interventionDate && <span className="text-[10px] text-primary-600 font-medium">Scheduled: {risk.interventionDate}</span>}
                        </div>
                      </>
                    ) : (
                      <p className="text-[11px] text-amber-700">No intervention logged yet.</p>
                    )}
                  </div>
                  <button onClick={() => openAction(risk)} className="ml-auto px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[10px] font-semibold shadow-lg shadow-amber-600/20 hover:bg-amber-700 hover:shadow-amber-600/30 transition-smooth cursor-pointer whitespace-nowrap shrink-0">
                    {risk.attendanceAction ? 'Update' : 'Take Action'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Take Action panel */}
      <RightSlidePanel isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.name} coloredHeader>
        {selected && (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Action <span className="text-red-500">*</span></label>
              <textarea value={actionForm.action} onChange={e => setActionForm(f => ({ ...f, action: e.target.value }))} rows={3} maxLength={300} placeholder="e.g. Call scheduled, escalated to employer..." className="w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Intervention Date</label>
              <input type="date" value={actionForm.interventionDate} onChange={e => setActionForm(f => ({ ...f, interventionDate: e.target.value }))} className="w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
            </div>
            <label className="flex items-center gap-2 text-[12px] text-foreground-600 cursor-pointer">
              <input type="checkbox" checked={actionForm.employerNotified} onChange={e => setActionForm(f => ({ ...f, employerNotified: e.target.checked }))} className="w-4 h-4 rounded border-background-300 accent-primary-500 cursor-pointer" />
              Employer notified
            </label>
            <button onClick={submitAction} disabled={submittingAction || !actionForm.action.trim()} className="w-full px-3 py-2 bg-amber-600 text-white rounded-lg text-[11px] font-semibold hover:bg-amber-700 transition-smooth cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              {submittingAction ? 'Logging…' : 'Log Intervention'}
            </button>
            <button onClick={() => { setSelected(null); setProfileId(selected.id); }} className="w-full px-3 py-2 border border-foreground-200/60 text-foreground-600 rounded-lg text-[11px] font-medium hover:bg-background-100 transition-smooth cursor-pointer">
              View Full Engagement Profile
            </button>
          </div>
        )}
      </RightSlidePanel>

      <LearnerProfilePanel learnerId={profileId} onClose={() => setProfileId(null)} />
    </WorkspaceShell>
  );
}
