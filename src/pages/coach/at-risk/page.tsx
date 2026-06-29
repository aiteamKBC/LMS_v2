import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import { COHORTS } from '@/mocks/coach-charts';
import { AtRiskLearner, InterventionModal, EscalateModal, ContactEmployerModal } from './components/AtRiskModals';

const coachNav = roleNavMap.coach;

type EnrollmentStatus = 'all' | 'active' | 'break' | 'withdrawn';
type RiskLevel = 'all' | 'high' | 'medium' | 'low';

const AT_RISK_LEARNERS: AtRiskLearner[] = [
  { id: '1', name: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', cohortId: 'coh-001', cohortName: 'MKT-L4-2025A', group: 'Group A', riskLevel: 'high', enrollmentStatus: 'active', riskFlags: ['Attendance 86%', 'OTJH behind pace', 'KSB Amber', '3 weeks no evidence'], overallProgress: 42, attendanceRate: 86, otjhCompleted: 74, otjhTarget: 120, ksbProgress: 38, lastIntervention: '7 Jun 2026', interventionCount: 4, assignedCoach: 'Med Maher', daysSinceFlag: 28, escalationStatus: 'escalated' },
  { id: '2', name: 'James Okonkwo', initials: 'JO', programme: 'Data Analyst L4', employer: 'Medway NHS Trust', cohortId: 'coh-003', cohortName: 'DA-L4-2025A', group: 'Group A', riskLevel: 'high', enrollmentStatus: 'active', riskFlags: ['Attendance 78%', 'Evidence overdue', 'OTJH Red', 'Missed last 2 sessions'], overallProgress: 28, attendanceRate: 78, otjhCompleted: 22, otjhTarget: 100, ksbProgress: 25, lastIntervention: '5 Jun 2026', interventionCount: 5, assignedCoach: 'Sarah Khan', daysSinceFlag: 35, escalationStatus: 'escalated' },
  { id: '3', name: 'Aisha Patel', initials: 'AP', programme: 'Accountancy L3', employer: 'Ashford Accounting', cohortId: 'coh-010', cohortName: 'ACC-L3-2025A', group: 'Group A', riskLevel: 'medium', enrollmentStatus: 'active', riskFlags: ['KSB stagnant', 'Low engagement', '3 weeks no evidence'], overallProgress: 31, attendanceRate: 83, otjhCompleted: 30, otjhTarget: 100, ksbProgress: 22, lastIntervention: '8 Jun 2026', interventionCount: 3, assignedCoach: 'David Osei', daysSinceFlag: 21, escalationStatus: 'pending' },
  { id: '4', name: 'Noah Bennett', initials: 'NB', programme: 'Marketing Executive L4', employer: 'Canterbury Creative', cohortId: 'coh-002', cohortName: 'MKT-L4-2025B', group: 'Group B', riskLevel: 'medium', enrollmentStatus: 'active', riskFlags: ['Attendance 82%', 'Attendance dropping'], overallProgress: 35, attendanceRate: 82, otjhCompleted: 38, otjhTarget: 120, ksbProgress: 32, lastIntervention: '8 Jun 2026', interventionCount: 2, assignedCoach: 'Med Maher', daysSinceFlag: 14, escalationStatus: 'none' },
  { id: '5', name: 'Finn Murphy', initials: 'FM', programme: 'Project Manager L4', employer: 'BAM Construction', cohortId: 'coh-004', cohortName: 'PM-L4-2025A', group: 'Group A', riskLevel: 'high', enrollmentStatus: 'active', riskFlags: ['OTJH behind', 'Low evidence', '2 months behind'], overallProgress: 33, attendanceRate: 85, otjhCompleted: 34, otjhTarget: 100, ksbProgress: 28, lastIntervention: '5 Jun 2026', interventionCount: 4, assignedCoach: 'Med Maher', daysSinceFlag: 42, escalationStatus: 'escalated' },
  { id: '6', name: 'Lucas Graham', initials: 'LG', programme: 'Software Developer L4', employer: 'Tech Kent Ltd', cohortId: 'coh-008', cohortName: 'SD-L4-2025A', group: 'Group A', riskLevel: 'medium', enrollmentStatus: 'break', riskFlags: ['Attendance 80%'], overallProgress: 30, attendanceRate: 80, otjhCompleted: 28, otjhTarget: 110, ksbProgress: 26, lastIntervention: '5 Jun 2026', interventionCount: 2, assignedCoach: 'Sarah Khan', daysSinceFlag: 10, escalationStatus: 'none' },
  { id: '7', name: 'Harper Singh', initials: 'HS', programme: 'Accountancy L3', employer: 'Kent Accountants', cohortId: 'coh-010', cohortName: 'ACC-L3-2025A', group: 'Group A', riskLevel: 'low', enrollmentStatus: 'active', riskFlags: ['OTJH slightly behind', '1 evidence overdue'], overallProgress: 55, attendanceRate: 91, otjhCompleted: 62, otjhTarget: 110, ksbProgress: 56, lastIntervention: '9 Jun 2026', interventionCount: 1, assignedCoach: 'David Osei', daysSinceFlag: 7, escalationStatus: 'none' },
  { id: '8', name: 'Zara Ahmed', initials: 'ZA', programme: 'HR Consultant L5', employer: 'Canterbury NHS', cohortId: 'coh-009', cohortName: 'HR-L5-2025A', group: 'Group A', riskLevel: 'low', enrollmentStatus: 'active', riskFlags: ['KSB pace concern'], overallProgress: 58, attendanceRate: 93, otjhCompleted: 66, otjhTarget: 120, ksbProgress: 56, lastIntervention: '10 Jun 2026', interventionCount: 1, assignedCoach: 'Med Maher', daysSinceFlag: 5, escalationStatus: 'none' },
  { id: '9', name: 'Tom Richards', initials: 'TR', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', cohortId: 'coh-001', cohortName: 'MKT-L4-2025A', group: 'Group A', riskLevel: 'high', enrollmentStatus: 'withdrawn', riskFlags: ['Attendance 79%', 'OTJH Red', 'Missed coaching session'], overallProgress: 25, attendanceRate: 79, otjhCompleted: 18, otjhTarget: 100, ksbProgress: 20, lastIntervention: '4 Jun 2026', interventionCount: 3, assignedCoach: 'Sarah Khan', daysSinceFlag: 30, escalationStatus: 'escalated' },
];

const PROGRAMMES = [...new Set(AT_RISK_LEARNERS.map(l => l.programme))].sort();
const GROUPS = [...new Set(AT_RISK_LEARNERS.map(l => l.group))].sort();

const PAGE_SIZE = 10;

const riskConfig: Record<string, { bg: string; text: string; border: string; label: string }> = {
  high: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200/50', label: 'High Risk' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200/50', label: 'Medium Risk' },
  low: { bg: 'bg-foreground-100', text: 'text-foreground-600', border: 'border-foreground-200/60', label: 'Low Risk' },
};

const enrollmentConfig: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: 'bg-emerald-50 border-emerald-200/50', text: 'text-emerald-700', label: 'Active' },
  break: { bg: 'bg-amber-50 border-amber-200/50', text: 'text-amber-700', label: 'Break' },
  withdrawn: { bg: 'bg-foreground-100 border-foreground-200/50', text: 'text-foreground-500', label: 'Withdrawn' },
};

function DonutChart({ percentage, size = 72, strokeWidth = 6, color = 'primary' }: { percentage: number; size?: number; strokeWidth?: number; color?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  const colorMap: Record<string, { stroke: string; text: string }> = {
    primary: { stroke: 'stroke-primary-500', text: 'text-primary-700' },
    accent: { stroke: 'stroke-accent-500', text: 'text-accent-700' },
    emerald: { stroke: 'stroke-emerald-500', text: 'text-emerald-700' },
    amber: { stroke: 'stroke-amber-500', text: 'text-amber-700' },
    red: { stroke: 'stroke-red-500', text: 'text-red-700' },
    secondary: { stroke: 'stroke-secondary-500', text: 'text-secondary-700' },
  };

  const c = colorMap[color] || colorMap.primary;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="stroke-background-200" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className={`${c.stroke} transition-all duration-700`} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-sm font-bold ${c.text}`}>{percentage}%</span>
      </div>
    </div>
  );
}

export default function CoachAtRisk() {
  const navigate = useNavigate();
  const { success, warning, info } = useToast();

  const [learners, setLearners] = useState<AtRiskLearner[]>(AT_RISK_LEARNERS);
  const [search, setSearch] = useState('');
  const [cohortFilter, setCohortFilter] = useState('all');
  const [programmeFilter, setProgrammeFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [enrollmentStatusFilter, setEnrollmentStatusFilter] = useState<EnrollmentStatus>('all');
  const [riskLevelFilter, setRiskLevelFilter] = useState<RiskLevel>('all');
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'name' | 'progress' | 'attendance' | 'ksb' | 'otjh' | 'daysSinceFlag'>('daysSinceFlag');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [showEmployerDropdown, setShowEmployerDropdown] = useState(false);

  const [interventionTarget, setInterventionTarget] = useState<AtRiskLearner | null>(null);
  const [escalateTarget, setEscalateTarget] = useState<AtRiskLearner | null>(null);
  const [contactTarget, setContactTarget] = useState<AtRiskLearner | null>(null);

  const selectedLearner = learners.find(l => l.id === selectedLearnerId) || null;

  const filtered = useMemo(() => {
    let list = [...learners];
    if (riskLevelFilter !== 'all') list = list.filter(l => l.riskLevel === riskLevelFilter);
    if (enrollmentStatusFilter !== 'all') list = list.filter(l => l.enrollmentStatus === enrollmentStatusFilter);
    if (cohortFilter !== 'all') list = list.filter(l => l.cohortId === cohortFilter);
    if (programmeFilter !== 'all') list = list.filter(l => l.programme === programmeFilter);
    if (groupFilter !== 'all') list = list.filter(l => l.group === groupFilter);
    if (search) list = list.filter(l => l.name.toLowerCase().includes(search.toLowerCase()) || l.programme.toLowerCase().includes(search.toLowerCase()) || l.employer.toLowerCase().includes(search.toLowerCase()));
    list.sort((a, b) => {
      let va: number | string = 0, vb: number | string = 0;
      switch (sortKey) {
        case 'name': va = a.name; vb = b.name; break;
        case 'progress': va = a.overallProgress; vb = b.overallProgress; break;
        case 'attendance': va = a.attendanceRate; vb = b.attendanceRate; break;
        case 'ksb': va = a.ksbProgress; vb = b.ksbProgress; break;
        case 'otjh': va = a.otjhCompleted / a.otjhTarget; vb = b.otjhCompleted / b.otjhTarget; break;
        case 'daysSinceFlag': va = a.daysSinceFlag; vb = b.daysSinceFlag; break;
      }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return list;
  }, [riskLevelFilter, enrollmentStatusFilter, cohortFilter, programmeFilter, groupFilter, search, sortKey, sortDir, learners]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  const high = learners.filter(l => l.riskLevel === 'high').length;
  const medium = learners.filter(l => l.riskLevel === 'medium').length;
  const low = learners.filter(l => l.riskLevel === 'low').length;
  const escalated = learners.filter(l => l.escalationStatus === 'escalated').length;
  const activeCount = learners.filter(l => l.enrollmentStatus === 'active').length;
  const breakCount = learners.filter(l => l.enrollmentStatus === 'break').length;
  const withdrawnCount = learners.filter(l => l.enrollmentStatus === 'withdrawn').length;

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); } else { setSortKey(key); setSortDir('asc'); }
  };

  const handleLogIntervention = (learner: AtRiskLearner, data: { type: string; notes: string; followUp: string }) => {
    setLearners(prev => prev.map(l => l.id === learner.id ? { ...l, interventionCount: l.interventionCount + 1, lastIntervention: '20 Jun 2026' } : l));
    setInterventionTarget(null);
    success(`Intervention logged for ${learner.name}`, `${data.type}${data.followUp ? ` · Follow-up: ${data.followUp}` : ''}`);
  };

  const handleEscalate = (learner: AtRiskLearner, reason: string) => {
    setLearners(prev => prev.map(l => l.id === learner.id ? { ...l, escalationStatus: 'escalated' } : l));
    setEscalateTarget(null);
    warning(`${learner.name} has been escalated`, reason);
  };

  const handleContactEmployer = (learner: AtRiskLearner) => {
    setContactTarget(null);
    setShowEmployerDropdown(false);
    info(`Message sent to ${learner.employer}`, `Re: ${learner.name} — ${learner.programme}`);
  };

  const handleViewProfile = (learner: AtRiskLearner) => {
    navigate(`/coach/learner-case-file?id=${learner.id}`);
    success(`Opening profile`, learner.name);
  };

  const handleSendMessage = () => {
    if (!selectedLearner) return;
    const threadId = `th-risk-${selectedLearner.id}`;
    navigate(`/coach/messages?thread=${threadId}`);
  };

  const handleEmailEmployer = () => {
    if (!selectedLearner) return;
    window.open(`mailto:hr@${selectedLearner.employer.toLowerCase().replace(/\s+/g, '')}.co.uk`, '_blank');
    setShowEmployerDropdown(false);
  };

  const handleZoomCall = () => {
    if (!selectedLearner) return;
    window.open('https://zoom.us/start/videomeeting', '_blank');
    setShowEmployerDropdown(false);
  };

  const handleOutlookCall = () => {
    if (!selectedLearner) return;
    window.open('https://outlook.office.com/calendar/deeplink/compose', '_blank');
    setShowEmployerDropdown(false);
  };

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="At-risk Learners" pageSubtitle="Monitor and intervene with learners flagged for attendance, progress, or engagement risks" userName="Med Maher" userRole="Progress Coach">
      <div className="p-3 md:p-6 space-y-4 md:space-y-5">

        {/* ═══════ Hero Banner ═══════ */}
        <section className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800">
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute animate-liquid-blob-1 opacity-20" style={{ width: '55%', height: '30%', left: '-8%', top: '-8%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(55px)' }} />
            <div className="absolute animate-liquid-blob-2 opacity-12" style={{ width: '60%', height: '35%', right: '-12%', top: '20%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(50px)' }} />
          </div>
          <div className="relative p-5 md:p-7 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-alert-line text-white text-xl"></i>
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                <span className="text-[10px] font-semibold text-accent-300/80 uppercase tracking-wider bg-accent-400/10 px-2 py-0.5 rounded-md border border-accent-400/15">At-risk Monitor</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-400/10 text-red-300/80 border border-red-400/15">{high} High &middot; {medium} Medium &middot; {low} Low</span>
              </div>
              <h1 className="text-base md:text-lg font-heading font-bold text-white tracking-tight mb-1">At-risk Learners</h1>
              <p className="text-[12px] text-white/40">
                <strong className="text-white/60">{learners.length} learners flagged</strong> &middot; {escalated} escalated &middot; {activeCount} active &middot; {breakCount} on break &middot; {withdrawnCount} withdrawn
              </p>
            </div>
          </div>
        </section>

        {/* ═══════ Stats Cards ═══════ */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-3">
          <MiniStatCard label="Total At Risk" value={String(learners.length)} icon="ri-user-line" color="red" />
          <MiniStatCard label="High Risk" value={String(high)} icon="ri-error-warning-line" color="red" />
          <MiniStatCard label="Medium Risk" value={String(medium)} icon="ri-alert-line" color="amber" />
          <MiniStatCard label="Low Risk" value={String(low)} icon="ri-information-line" color="foreground" />
          <MiniStatCard label="Escalated" value={String(escalated)} icon="ri-arrow-up-circle-line" color="red" />
          <MiniStatCard label="Interventions" value="18" icon="ri-chat-smile-2-line" color="primary" />
        </div>

        {/* ═══════ Escalation Alert ═══════ */}
        {escalated > 0 && (
          <div className="bg-red-50 border border-red-200/50 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
              <i className="ri-alarm-warning-line text-red-600 text-base"></i>
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-800">{escalated} learners have been escalated</p>
              <p className="text-[12px] text-red-600 mt-0.5">These cases require DSL review and may need external referral</p>
            </div>
          </div>
        )}

        {/* ═══════ Filters Bar ═══════ */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4">
          <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3 flex-wrap">
            {/* Search */}
            <div className="w-full lg:w-auto lg:min-w-[240px] lg:max-w-[280px]">
              <div className="relative">
                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
                <input type="text" value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} placeholder="Search learners..." className="w-full pl-9 pr-3 py-2 bg-background-100 border border-foreground-200 rounded-lg text-[12px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
              </div>
            </div>

            <div className="w-px h-6 bg-background-200/70 hidden lg:block"></div>

            {/* Dropdown Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <FilterDropdown label="Cohort" value={cohortFilter} onChange={(v) => { setCohortFilter(v); setCurrentPage(1); }} options={COHORTS.map(c => ({ value: c.id, label: c.name }))} />
              <FilterDropdown label="Programme" value={programmeFilter} onChange={(v) => { setProgrammeFilter(v); setCurrentPage(1); }} options={PROGRAMMES.map(p => ({ value: p, label: p }))} />
              <FilterDropdown label="Group" value={groupFilter} onChange={(v) => { setGroupFilter(v); setCurrentPage(1); }} options={GROUPS.map(g => ({ value: g, label: g }))} />
              <FilterDropdown label="Risk Level" allLabel="All Risk Level" value={riskLevelFilter} onChange={(v) => { setRiskLevelFilter(v as RiskLevel); setCurrentPage(1); }} options={[
                { value: 'high', label: `High Risk (${high})` },
                { value: 'medium', label: `Medium Risk (${medium})` },
                { value: 'low', label: `Low Risk (${low})` },
              ]} />
              <FilterDropdown label="Status" allLabel="All Status" value={enrollmentStatusFilter} onChange={(v) => { setEnrollmentStatusFilter(v as EnrollmentStatus); setCurrentPage(1); }} options={[
                { value: 'active', label: `Active (${activeCount})` },
                { value: 'break', label: `Break (${breakCount})` },
                { value: 'withdrawn', label: `Withdrawn (${withdrawnCount})` },
              ]} />
            </div>
          </div>
        </div>

        {/* ═══════ Data Table ═══════ */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-foreground-200/60">
                  <ThSort label="Learner" sortKey="name" current={sortKey} dir={sortDir} onClick={() => handleSort('name')} className="pl-4 pr-3 py-3" />
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Programme</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Cohort</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Group</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Enrol. Status</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Risk Level</th>
                  <ThSort label="Att." sortKey="attendance" current={sortKey} dir={sortDir} onClick={() => handleSort('attendance')} />
                  <ThSort label="Progress" sortKey="progress" current={sortKey} dir={sortDir} onClick={() => handleSort('progress')} />
                  <ThSort label="KSB" sortKey="ksb" current={sortKey} dir={sortDir} onClick={() => handleSort('ksb')} />
                  <ThSort label="Days Flag" sortKey="daysSinceFlag" current={sortKey} dir={sortDir} onClick={() => handleSort('daysSinceFlag')} />
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Interventions</th>
                  <th className="pr-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/30">
                {paginated.map(learner => {
                  const rc = riskConfig[learner.riskLevel] || riskConfig.low;
                  const ec = enrollmentConfig[learner.enrollmentStatus] || enrollmentConfig.active;
                  const isSel = selectedLearnerId === learner.id;
                  return (
                    <tr key={learner.id} onClick={() => setSelectedLearnerId(isSel ? null : learner.id)} className={`transition-smooth cursor-pointer ${isSel ? 'bg-primary-50/30' : 'hover:bg-background-100/50'}`}>
                      <td className="pl-4 pr-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ring-1.5 ${learner.riskLevel === 'high' ? 'bg-red-100 text-red-700 ring-red-200' : learner.riskLevel === 'medium' ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-foreground-100 text-foreground-600 ring-background-200'}`}>
                            <span className="text-[11px] font-bold">{learner.initials}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-foreground-900 truncate">{learner.name}</p>
                            <p className="text-[10px] text-foreground-400 truncate">{learner.employer}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-foreground-600 whitespace-nowrap max-w-[140px] truncate">{learner.programme}</td>
                      <td className="px-3 py-2.5"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500 whitespace-nowrap">{learner.cohortName}</span></td>
                      <td className="px-3 py-2.5 text-[11px] text-foreground-500 whitespace-nowrap">{learner.group}</td>
                      <td className="px-3 py-2.5"><span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${ec.bg} ${ec.text} whitespace-nowrap`}>{ec.label}</span></td>
                      <td className="px-3 py-2.5"><span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${rc.bg} ${rc.text} whitespace-nowrap`}>{rc.label}</span></td>
                      <td className="px-3 py-2.5"><span className={`text-[11px] font-semibold ${learner.attendanceRate >= 90 ? 'text-emerald-600' : learner.attendanceRate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{learner.attendanceRate}%</span></td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="w-10 bg-background-200 rounded-full h-1.5"><div className={`h-1.5 rounded-full ${learner.riskLevel === 'high' ? 'bg-red-500' : learner.riskLevel === 'medium' ? 'bg-amber-500' : 'bg-foreground-400'}`} style={{ width: `${learner.overallProgress}%` }}></div></div>
                          <span className="text-[11px] font-semibold text-foreground-700 w-7 text-right">{learner.overallProgress}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5"><span className="text-[11px] font-semibold text-foreground-700">{learner.ksbProgress}%</span></td>
                      <td className="px-3 py-2.5"><span className={`text-[11px] font-semibold ${learner.daysSinceFlag > 30 ? 'text-red-600' : learner.daysSinceFlag > 14 ? 'text-amber-600' : 'text-foreground-700'}`}>{learner.daysSinceFlag}</span></td>
                      <td className="px-3 py-2.5"><span className="text-[11px] font-semibold text-foreground-700">{learner.interventionCount}</span></td>
                      <td className="pr-4 py-2.5"><i className={`text-foreground-300 text-sm ${isSel ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`}></i></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <div className="py-12 text-center">
              <i className="ri-search-line text-foreground-300 text-3xl mb-2 block"></i>
              <p className="text-sm text-foreground-400">No at-risk learners match your filters</p>
              <button onClick={() => { setEnrollmentStatusFilter('all'); setRiskLevelFilter('all'); setCohortFilter('all'); setProgrammeFilter('all'); setGroupFilter('all'); setSearch(''); setCurrentPage(1); }} className="mt-2 text-[11px] font-medium text-primary-600 hover:text-primary-700 cursor-pointer">Clear all filters</button>
            </div>
          )}

          {/* Pagination */}
          {filtered.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-foreground-200/60 bg-background-100/30">
              <span className="text-[11px] text-foreground-400">Showing <strong className="text-foreground-700">{Math.min((safePage - 1) * PAGE_SIZE + 1, filtered.length)}&ndash;{Math.min(safePage * PAGE_SIZE, filtered.length)}</strong> of <strong className="text-foreground-700">{filtered.length}</strong> learners</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage <= 1} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-500 hover:bg-background-200/50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-smooth"><i className="ri-arrow-left-s-line text-sm"></i></button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <button key={page} onClick={() => setCurrentPage(page)} className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-semibold cursor-pointer transition-smooth ${safePage === page ? 'bg-primary-500 text-white' : 'text-foreground-500 hover:bg-background-200/50'}`}>{page}</button>
                ))}
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-500 hover:bg-background-200/50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-smooth"><i className="ri-arrow-right-s-line text-sm"></i></button>
              </div>
              <span className="text-[11px] text-foreground-400">Page {safePage} of {totalPages}</span>
            </div>
          )}
        </div>

        {/* ═══════ Right Slide Panel ═══════ */}
        <RightSlidePanel isOpen={selectedLearner !== null} onClose={() => { setSelectedLearnerId(null); setShowEmployerDropdown(false); }} title={selectedLearner?.name || 'Learner Detail'} width="w-[520px]">
          {selectedLearner && (
            <div className="space-y-5">
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 ring-3 ${selectedLearner.riskLevel === 'high' ? 'bg-red-100 text-red-700 ring-red-200' : selectedLearner.riskLevel === 'medium' ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-foreground-100 text-foreground-600 ring-background-200'}`}>
                  <span className="text-lg font-bold">{selectedLearner.initials}</span>
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${enrollmentConfig[selectedLearner.enrollmentStatus].bg} ${enrollmentConfig[selectedLearner.enrollmentStatus].text}`}>{enrollmentConfig[selectedLearner.enrollmentStatus].label}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${riskConfig[selectedLearner.riskLevel].bg} ${riskConfig[selectedLearner.riskLevel].text}`}>{riskConfig[selectedLearner.riskLevel].label}</span>
                    {selectedLearner.escalationStatus === 'escalated' && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Escalated</span>}
                    {selectedLearner.escalationStatus === 'pending' && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Pending</span>}
                  </div>
                  <p className="text-[12px] text-foreground-400">{selectedLearner.programme}</p>
                  <p className="text-[12px] text-foreground-400">{selectedLearner.employer} &middot; Coach: {selectedLearner.assignedCoach}</p>
                  <p className="text-[11px] text-foreground-300 mt-0.5">{selectedLearner.cohortName} &middot; {selectedLearner.group}</p>
                </div>
              </div>

              {selectedLearner.riskFlags.length > 0 && (
                <div className="bg-red-50/50 rounded-xl border border-red-200/30 p-4">
                  <h4 className="text-[11px] font-semibold text-red-700 mb-2 flex items-center gap-1.5"><i className="ri-alert-line"></i> Risk Flags</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedLearner.riskFlags.map(flag => <span key={flag} className="text-[10px] font-medium px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200/50">{flag}</span>)}
                  </div>
                  <p className="text-[11px] text-red-500 mt-2">Flagged {selectedLearner.daysSinceFlag} days ago</p>
                </div>
              )}

              {/* ═══════ Donut Charts Grid ═══════ */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                  <DonutChart percentage={selectedLearner.overallProgress} size={64} color="red" />
                  <div>
                    <p className="text-[10px] text-foreground-400">Overall Progress</p>
                    <p className="text-lg font-bold text-foreground-900">{selectedLearner.overallProgress}%</p>
                    <p className="text-[9px] text-foreground-300">{selectedLearner.overallProgress >= 70 ? 'On Track' : 'Needs Support'}</p>
                  </div>
                </div>
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                  <DonutChart percentage={selectedLearner.attendanceRate} size={64} color={selectedLearner.attendanceRate >= 90 ? 'emerald' : selectedLearner.attendanceRate >= 80 ? 'amber' : 'red'} />
                  <div>
                    <p className="text-[10px] text-foreground-400">Attendance</p>
                    <p className="text-lg font-bold text-foreground-900">{selectedLearner.attendanceRate}%</p>
                    <p className="text-[9px] text-foreground-300">{selectedLearner.attendanceRate >= 90 ? 'Excellent' : selectedLearner.attendanceRate >= 80 ? 'Good' : 'At Risk'}</p>
                  </div>
                </div>
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                  <DonutChart percentage={Math.round((selectedLearner.otjhCompleted / selectedLearner.otjhTarget) * 100)} size={64} color={selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.7 ? 'emerald' : selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.4 ? 'amber' : 'red'} />
                  <div>
                    <p className="text-[10px] text-foreground-400">OTJH</p>
                    <p className="text-lg font-bold text-foreground-900">{selectedLearner.otjhCompleted}<span className="text-sm text-foreground-400">/{selectedLearner.otjhTarget}</span></p>
                    <p className="text-[9px] text-foreground-300">{Math.round((selectedLearner.otjhCompleted / selectedLearner.otjhTarget) * 100)}% of target</p>
                  </div>
                </div>
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                  <DonutChart percentage={selectedLearner.ksbProgress} size={64} color={selectedLearner.ksbProgress >= 70 ? 'emerald' : selectedLearner.ksbProgress >= 40 ? 'primary' : 'red'} />
                  <div>
                    <p className="text-[10px] text-foreground-400">KSB Progress</p>
                    <p className="text-lg font-bold text-foreground-900">{selectedLearner.ksbProgress}%</p>
                    <p className="text-[9px] text-foreground-300">{selectedLearner.ksbProgress >= 70 ? 'On pace' : 'Needs Support'}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]"><span className="text-foreground-400">Interventions</span><span className="text-foreground-900 font-medium">{selectedLearner.interventionCount}</span></div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]"><span className="text-foreground-400">Last Intervention</span><span className="text-foreground-900 font-medium">{selectedLearner.lastIntervention}</span></div>
                <div className="flex justify-between py-2 text-[12px]"><span className="text-foreground-400">Days Since Flag</span><span className={`font-medium ${selectedLearner.daysSinceFlag > 30 ? 'text-red-600' : selectedLearner.daysSinceFlag > 14 ? 'text-amber-600' : 'text-foreground-900'}`}>{selectedLearner.daysSinceFlag}</span></div>
              </div>

              {/* ═══════ Actions ═══════ */}
              <div className="flex flex-col gap-2 pt-2">
                <button onClick={() => setInterventionTarget(selectedLearner)} className="w-full px-4 py-2.5 bg-primary-500 text-white rounded-lg text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-chat-smile-2-line mr-1.5"></i> Log Intervention</button>
                {selectedLearner.escalationStatus !== 'escalated' ? (
                  <button onClick={() => setEscalateTarget(selectedLearner)} className="w-full px-4 py-2.5 bg-amber-600 text-white rounded-lg text-[13px] font-semibold hover:bg-amber-700 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-arrow-up-circle-line mr-1.5"></i> Escalate</button>
                ) : (
                  <span className="w-full px-4 py-2.5 bg-red-100 text-red-700 rounded-lg text-[13px] font-semibold text-center whitespace-nowrap"><i className="ri-arrow-up-circle-fill mr-1.5"></i> Already Escalated</span>
                )}
                <button onClick={() => handleViewProfile(selectedLearner)} className="w-full px-4 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center"><i className="ri-file-chart-line mr-1.5"></i> View Full Profile</button>
                <button onClick={handleSendMessage} className="w-full px-4 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center"><i className="ri-mail-line mr-1.5"></i> Send Message</button>
                <div className="relative">
                  <button onClick={() => setShowEmployerDropdown(!showEmployerDropdown)} className="w-full px-4 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1">
                    <i className="ri-building-2-line mr-1.5"></i> Contact Employer
                    <i className={`ri-arrow-down-s-line text-xs transition-transform ${showEmployerDropdown ? 'rotate-180' : ''}`}></i>
                  </button>
                  {showEmployerDropdown && (
                    <div className="absolute bottom-full left-0 right-0 mb-1 bg-background-50 rounded-xl border border-background-200 shadow-xl overflow-hidden z-50">
                      <button onClick={handleSendMessage} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer">
                        <span className="w-7 h-7 rounded-lg bg-primary-100 flex items-center justify-center text-primary-600"><i className="ri-message-3-line text-xs"></i></span>
                        <div>
                          <p className="font-medium">Send Message</p>
                          <p className="text-[10px] text-foreground-400">Open in-app chat</p>
                        </div>
                      </button>
                      <button onClick={handleEmailEmployer} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer border-t border-background-200/30">
                        <span className="w-7 h-7 rounded-lg bg-accent-100 flex items-center justify-center text-accent-600"><i className="ri-mail-send-line text-xs"></i></span>
                        <div>
                          <p className="font-medium">Email</p>
                          <p className="text-[10px] text-foreground-400">hr@employer.co.uk</p>
                        </div>
                      </button>
                      <button onClick={handleZoomCall} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer border-t border-background-200/30">
                        <span className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600"><i className="ri-video-line text-xs"></i></span>
                        <div>
                          <p className="font-medium">Call via Zoom</p>
                          <p className="text-[10px] text-foreground-400">Start video meeting</p>
                        </div>
                      </button>
                      <button onClick={handleOutlookCall} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer border-t border-background-200/30">
                        <span className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600"><i className="ri-calendar-event-line text-xs"></i></span>
                        <div>
                          <p className="font-medium">Schedule via Outlook</p>
                          <p className="text-[10px] text-foreground-400">Book calendar meeting</p>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </RightSlidePanel>

      </div>

      {/* Modals */}
      {interventionTarget && <InterventionModal learner={interventionTarget} onClose={() => setInterventionTarget(null)} onSubmit={(data) => handleLogIntervention(interventionTarget, data)} />}
      {escalateTarget && <EscalateModal learner={escalateTarget} onClose={() => setEscalateTarget(null)} onConfirm={(reason) => handleEscalate(escalateTarget, reason)} />}
      {contactTarget && <ContactEmployerModal learner={contactTarget} onClose={() => setContactTarget(null)} onSend={() => handleContactEmployer(contactTarget)} />}
    </WorkspaceShell>
  );
}

/* ═══════ Sub-components ═══════ */

function MiniStatCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    primary: { bg: 'bg-primary-100', text: 'text-primary-600' },
    accent: { bg: 'bg-accent-50', text: 'text-accent-700' },
    secondary: { bg: 'bg-secondary-100', text: 'text-secondary-600' },
    red: { bg: 'bg-red-100', text: 'text-red-600' },
    amber: { bg: 'bg-amber-100', text: 'text-amber-600' },
    emerald: { bg: 'bg-emerald-100', text: 'text-emerald-600' },
    foreground: { bg: 'bg-foreground-100', text: 'text-foreground-500' },
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 card-premium cursor-pointer">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-foreground-400 font-medium">{label}</span>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${c.bg} ${c.text}`}><i className={`${icon} text-xs`}></i></span>
      </div>
      <p className="text-lg font-heading font-bold text-foreground-900 mt-1">{value}</p>
    </div>
  );
}

function FilterDropdown({ label, value, onChange, options, allLabel }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; allLabel?: string }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} className="appearance-none pl-2.5 pr-7 py-1.5 bg-background-100 border border-foreground-200 rounded-lg text-[11px] font-medium text-foreground-700 cursor-pointer focus:outline-none focus:border-primary-300">
        <option value="all">{allLabel || `All ${label}s`}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <i className="ri-arrow-down-s-line absolute right-1.5 top-1/2 -translate-y-1/2 text-foreground-400 text-[10px] pointer-events-none"></i>
    </div>
  );
}

function ThSort({ label, sortKey, current, dir, onClick, className = '' }: { label: string; sortKey: string; current: string; dir: string; onClick: () => void; className?: string }) {
  return (
    <th className={`px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-foreground-600 transition-smooth ${className}`} onClick={onClick}>
      <span className="flex items-center gap-1">
        {label}
        <i className={`text-[8px] ${current === sortKey ? (dir === 'asc' ? 'ri-arrow-up-line text-primary-500' : 'ri-arrow-down-line text-primary-500') : 'ri-arrow-up-down-line text-foreground-300'}`}></i>
      </span>
    </th>
  );
}