import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import { formatHoursMinutes } from '@/lib/format';

// ─────────────────── Types ───────────────────

interface LearnerRef {
  id: string;
  name: string;
  avatar: string;
  employer: string;
  startDate: string;
  progress: number;
  attendance: number;
  otjh: number;
  otjhRequired: number;
  risk: 'green' | 'amber' | 'red';
  ksbProgress: number;
  lastReview: string;
  status: 'active' | 'on-hold' | 'completed' | 'withdrawn';
}

interface GroupDetail {
  id: string;
  name: string;
  learners: LearnerRef[];
  coach: string;
  tutor: string;
  schedule: string;
  mode: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'pending' | 'completed';
  room: string;
  maxLearners: number;
  progress: number;
  attendance: number;
}

interface SessionItem {
  id: string;
  title: string;
  type: string;
  day: string;
  date: string;
  startTime: string;
  endTime: string;
  tutor: string;
  group: string;
  venue: string;
  status: string;
  module: string;
  week: number;
}

interface CohortData {
  id: string;
  name: string;
  programme: string;
  programmeId: string;
  standard: string;
  level: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'planned' | 'completed';
  totalLearners: number;
  groups: GroupDetail[];
  sessions: SessionItem[];
  progress: number;
  attendance: number;
  otjhAvg: number;
  otjhTarget: number;
  ksbAvgProgress: number;
  completionRate: number;
  modules: { name: string; progress: number; status: string }[];
}

// ─────────────────── Mock Data — Cohort A ───────────────────

const LEARNERS_A1: LearnerRef[] = [
  { id: 'l-1', name: 'Amelia Hart', avatar: 'AH', employer: 'Bright Marketing Ltd', startDate: '1 Sep 2024', progress: 78, attendance: 96, otjh: 268, otjhRequired: 360, risk: 'green', ksbProgress: 72, lastReview: '2 Jun 2026', status: 'active' },
  { id: 'l-2', name: 'Ben Carter', avatar: 'BC', employer: 'Bright Marketing Ltd', startDate: '1 Sep 2024', progress: 65, attendance: 88, otjh: 221, otjhRequired: 360, risk: 'amber', ksbProgress: 58, lastReview: '28 May 2026', status: 'active' },
  { id: 'l-3', name: 'Chloe Davis', avatar: 'CD', employer: 'Pixel Perfect Agency', startDate: '1 Sep 2024', progress: 82, attendance: 100, otjh: 290, otjhRequired: 360, risk: 'green', ksbProgress: 80, lastReview: '5 Jun 2026', status: 'active' },
  { id: 'l-4', name: 'Daniel Evans', avatar: 'DE', employer: 'Pixel Perfect Agency', startDate: '1 Sep 2024', progress: 71, attendance: 92, otjh: 252, otjhRequired: 360, risk: 'green', ksbProgress: 68, lastReview: '1 Jun 2026', status: 'active' },
];

const LEARNERS_A2: LearnerRef[] = [
  { id: 'l-5', name: 'Emma Foster', avatar: 'EF', employer: 'Social Sync Ltd', startDate: '1 Sep 2024', progress: 74, attendance: 95, otjh: 260, otjhRequired: 360, risk: 'green', ksbProgress: 71, lastReview: '4 Jun 2026', status: 'active' },
  { id: 'l-6', name: 'Felix Grant', avatar: 'FG', employer: 'Social Sync Ltd', startDate: '1 Sep 2024', progress: 58, attendance: 84, otjh: 198, otjhRequired: 360, risk: 'red', ksbProgress: 52, lastReview: '30 May 2026', status: 'active' },
  { id: 'l-7', name: 'Grace Hill', avatar: 'GH', employer: 'BrandLab Creative', startDate: '1 Sep 2024', progress: 80, attendance: 98, otjh: 276, otjhRequired: 360, risk: 'green', ksbProgress: 76, lastReview: '6 Jun 2026', status: 'active' },
  { id: 'l-8', name: 'Henry Irving', avatar: 'HI', employer: 'BrandLab Creative', startDate: '1 Sep 2024', progress: 69, attendance: 90, otjh: 241, otjhRequired: 360, risk: 'amber', ksbProgress: 63, lastReview: '3 Jun 2026', status: 'active' },
];

const COHORT_SESSIONS: SessionItem[] = [
  { id: 'cs-1', title: 'Welcome & Cohort Induction', type: 'Live Session', day: 'Mon', date: '1 Sep 2024', startTime: '09:30', endTime: '11:00', tutor: 'James Thompson', group: 'A1, A2', venue: 'Teams', status: 'completed', module: 'M1', week: 1 },
  { id: 'cs-2', title: 'Marketing Environment & PESTLE', type: 'Workshop', day: 'Wed', date: '3 Sep 2024', startTime: '09:30', endTime: '11:30', tutor: 'James Thompson', group: 'A1', venue: 'Room 302', status: 'completed', module: 'M1', week: 1 },
  { id: 'cs-3', title: 'Marketing Environment & PESTLE (A2)', type: 'Workshop', day: 'Wed', date: '3 Sep 2024', startTime: '14:00', endTime: '16:00', tutor: 'Emily Roberts', group: 'A2', venue: 'Room 305', status: 'completed', module: 'M1', week: 1 },
  { id: 'cs-4', title: 'Self-study: Marketing Frameworks', type: 'Self-study', day: 'Thu', date: '4 Sep 2024', startTime: '14:00', endTime: '15:30', tutor: 'Self-directed', group: 'A1, A2', venue: 'LMS', status: 'completed', module: 'M1', week: 1 },
  { id: 'cs-5', title: 'Weekly OTJH Log & Reflection', type: 'OTJH', day: 'Fri', date: '5 Sep 2024', startTime: '16:00', endTime: '16:30', tutor: 'Sarah Mitchell', group: 'A1, A2', venue: 'LMS', status: 'completed', module: 'M1', week: 1 },
  { id: 'cs-6', title: 'Quiz — Marketing Foundations', type: 'Quiz', day: 'Fri', date: '5 Sep 2024', startTime: '11:00', endTime: '11:30', tutor: 'Auto-marked', group: 'A1, A2', venue: 'LMS', status: 'completed', module: 'M1', week: 1 },
  { id: 'cs-7', title: 'Customer Journey Mapping', type: 'Live Session', day: 'Mon', date: '8 Sep 2024', startTime: '09:30', endTime: '11:00', tutor: 'Emily Roberts', group: 'A1, A2', venue: 'Teams', status: 'completed', module: 'M1', week: 2 },
  { id: 'cs-8', title: 'Segmentation Workshop', type: 'Workshop', day: 'Wed', date: '10 Sep 2024', startTime: '09:30', endTime: '12:00', tutor: 'Emily Roberts', group: 'A1, A2', venue: 'Room 302', status: 'completed', module: 'M1', week: 2 },
  { id: 'cs-9', title: 'Research Methods & Data Collection', type: 'Live Session', day: 'Mon', date: '29 Sep 2024', startTime: '09:30', endTime: '11:00', tutor: 'Mark Williams', group: 'A1', venue: 'Teams', status: 'completed', module: 'M2', week: 5 },
  { id: 'cs-10', title: 'Research Methods (A2)', type: 'Live Session', day: 'Mon', date: '29 Sep 2024', startTime: '14:00', endTime: '15:30', tutor: 'Emily Roberts', group: 'A2', venue: 'Teams', status: 'completed', module: 'M2', week: 5 },
  { id: 'cs-11', title: 'Survey Design Workshop', type: 'Workshop', day: 'Wed', date: '1 Oct 2024', startTime: '09:30', endTime: '11:30', tutor: 'Mark Williams', group: 'A1, A2', venue: 'Room 302', status: 'completed', module: 'M2', week: 5 },
  { id: 'cs-12', title: 'Campaign Planning Overview', type: 'Live Session', day: 'Mon', date: '27 Oct 2024', startTime: '09:30', endTime: '11:00', tutor: 'James Thompson', group: 'A1, A2', venue: 'Teams', status: 'completed', module: 'M3', week: 9 },
  { id: 'cs-13', title: 'Campaign Planning Workshop', type: 'Workshop', day: 'Wed', date: '29 Oct 2024', startTime: '09:30', endTime: '11:30', tutor: 'James Thompson', group: 'A1', venue: 'Room 302', status: 'completed', module: 'M3', week: 9 },
  { id: 'cs-14', title: 'Campaign Planning Workshop (A2)', type: 'Workshop', day: 'Wed', date: '29 Oct 2024', startTime: '14:00', endTime: '16:00', tutor: 'Emily Roberts', group: 'A2', venue: 'Room 305', status: 'completed', module: 'M3', week: 9 },
  { id: 'cs-15', title: 'Evaluation Frameworks', type: 'Live Session', day: 'Mon', date: '24 Nov 2024', startTime: '09:30', endTime: '11:00', tutor: 'Mark Williams', group: 'A1, A2', venue: 'Teams', status: 'completed', module: 'M4', week: 13 },
  { id: 'cs-16', title: 'KPI Workshop', type: 'Workshop', day: 'Wed', date: '26 Nov 2024', startTime: '09:30', endTime: '11:30', tutor: 'Mark Williams', group: 'A1, A2', venue: 'Room 302', status: 'completed', module: 'M4', week: 13 },
];

const COHORT_DATA: Record<string, CohortData> = {
  'c-A': {
    id: 'c-A',
    name: 'Cohort A',
    programme: 'Marketing Executive',
    programmeId: 'p-3',
    standard: 'ST0094',
    level: 'Level 4',
    startDate: 'Sep 2024',
    endDate: 'Mar 2026',
    status: 'active',
    totalLearners: 8,
    progress: 72,
    attendance: 94,
    otjhAvg: 251,
    otjhTarget: 360,
    ksbAvgProgress: 68,
    completionRate: 88,
    modules: [
      { name: 'Module 1 — Marketing Foundations', progress: 100, status: 'completed' },
      { name: 'Module 2 — Customer Insight', progress: 100, status: 'completed' },
      { name: 'Module 3 — Campaign Planning', progress: 68, status: 'in-progress' },
      { name: 'Module 4 — Evaluation & EPA', progress: 24, status: 'in-progress' },
    ],
    groups: [
      {
        id: 'g-A1', name: 'Group A1', learners: LEARNERS_A1, coach: 'Sarah Mitchell', tutor: 'James Thompson',
        schedule: 'Mon, Wed, Fri — 09:30', mode: 'Blended', startDate: 'Sep 2024', endDate: 'Mar 2026',
        status: 'active', room: 'Room 302 / Teams', maxLearners: 6, progress: 74, attendance: 94,
      },
      {
        id: 'g-A2', name: 'Group A2', learners: LEARNERS_A2, coach: 'David Chen', tutor: 'Emily Roberts',
        schedule: 'Tue, Thu — 13:00', mode: 'Remote', startDate: 'Sep 2024', endDate: 'Mar 2026',
        status: 'active', room: 'Teams', maxLearners: 6, progress: 70, attendance: 93,
      },
    ],
    sessions: COHORT_SESSIONS,
  },
  'c-B': {
    id: 'c-B',
    name: 'Cohort B',
    programme: 'Marketing Executive',
    programmeId: 'p-3',
    standard: 'ST0094',
    level: 'Level 4',
    startDate: 'Mar 2025',
    endDate: 'Sep 2026',
    status: 'active',
    totalLearners: 6,
    progress: 45,
    attendance: 89,
    otjhAvg: 162,
    otjhTarget: 360,
    ksbAvgProgress: 40,
    completionRate: 92,
    modules: [
      { name: 'Module 1 — Marketing Foundations', progress: 100, status: 'completed' },
      { name: 'Module 2 — Customer Insight', progress: 58, status: 'in-progress' },
      { name: 'Module 3 — Campaign Planning', progress: 0, status: 'not-started' },
      { name: 'Module 4 — Evaluation & EPA', progress: 0, status: 'not-started' },
    ],
    groups: [
      {
        id: 'g-B1', name: 'Group B1', learners: [
          { id: 'l-9', name: 'Isaac Jones', avatar: 'IJ', employer: 'Nova Digital', startDate: '1 Mar 2025', progress: 48, attendance: 91, otjh: 160, otjhRequired: 360, risk: 'amber', ksbProgress: 42, lastReview: '5 Jun 2026', status: 'active' },
          { id: 'l-10', name: 'Jade Kelly', avatar: 'JK', employer: 'Nova Digital', startDate: '1 Mar 2025', progress: 52, attendance: 93, otjh: 175, otjhRequired: 360, risk: 'green', ksbProgress: 48, lastReview: '3 Jun 2026', status: 'active' },
          { id: 'l-11', name: 'Kai Lewis', avatar: 'KL', employer: 'Spark Media', startDate: '1 Mar 2025', progress: 38, attendance: 82, otjh: 138, otjhRequired: 360, risk: 'red', ksbProgress: 32, lastReview: '28 May 2026', status: 'active' },
        ],
        coach: 'Sarah Mitchell', tutor: 'James Thompson', schedule: 'Mon, Wed — 09:30', mode: 'Blended',
        startDate: 'Mar 2025', endDate: 'Sep 2026', status: 'active', room: 'Room 302 / Teams', maxLearners: 6, progress: 46, attendance: 89,
      },
      {
        id: 'g-B2', name: 'Group B2', learners: [
          { id: 'l-12', name: 'Lara Moss', avatar: 'LM', employer: 'Horizon Brands', startDate: '1 Mar 2025', progress: 45, attendance: 90, otjh: 155, otjhRequired: 360, risk: 'amber', ksbProgress: 40, lastReview: '4 Jun 2026', status: 'active' },
          { id: 'l-13', name: 'Marcus North', avatar: 'MN', employer: 'Horizon Brands', startDate: '1 Mar 2025', progress: 50, attendance: 94, otjh: 170, otjhRequired: 360, risk: 'green', ksbProgress: 44, lastReview: '2 Jun 2026', status: 'active' },
          { id: 'l-14', name: 'Nina Owen', avatar: 'NO', employer: 'Peak Creative', startDate: '1 Mar 2025', progress: 40, attendance: 85, otjh: 148, otjhRequired: 360, risk: 'amber', ksbProgress: 36, lastReview: '30 May 2026', status: 'active' },
        ],
        coach: 'Lisa Park', tutor: 'Mark Williams', schedule: 'Tue, Thu — 09:30', mode: 'In-person',
        startDate: 'Mar 2025', endDate: 'Sep 2026', status: 'active', room: 'Room 310', maxLearners: 6, progress: 44, attendance: 90,
      },
    ],
    sessions: COHORT_SESSIONS.slice(0, 10).map(s => ({ ...s, id: s.id + '-b' })),
  },
  'c-C': {
    id: 'c-C',
    name: 'Cohort C',
    programme: 'Marketing Executive',
    programmeId: 'p-3',
    standard: 'ST0094',
    level: 'Level 4',
    startDate: 'Sep 2025',
    endDate: 'Mar 2027',
    status: 'planned',
    totalLearners: 0,
    progress: 0,
    attendance: 0,
    otjhAvg: 0,
    otjhTarget: 360,
    ksbAvgProgress: 0,
    completionRate: 0,
    modules: [
      { name: 'Module 1 — Marketing Foundations', progress: 0, status: 'not-started' },
      { name: 'Module 2 — Customer Insight', progress: 0, status: 'not-started' },
      { name: 'Module 3 — Campaign Planning', progress: 0, status: 'not-started' },
      { name: 'Module 4 — Evaluation & EPA', progress: 0, status: 'not-started' },
    ],
    groups: [
      {
        id: 'g-C1', name: 'Group C1', learners: [],
        coach: 'Unassigned', tutor: 'Unassigned', schedule: 'TBD', mode: 'Blended',
        startDate: 'Sep 2025', endDate: 'Mar 2027', status: 'pending', room: 'TBD', maxLearners: 6, progress: 0, attendance: 0,
      },
    ],
    sessions: [],
  },
};

// ─────────────────── Colour maps ───────────────────

const typeColors: Record<string, string> = {
  'Live Session': 'bg-primary-100 text-primary-700',
  'Workshop': 'bg-accent-100 text-accent-700',
  'Self-study': 'bg-secondary-100 text-secondary-700',
  'Assignment': 'bg-amber-100 text-amber-700',
  'Quiz': 'bg-rose-100 text-rose-700',
  'OTJH': 'bg-emerald-100 text-emerald-700',
  'Collaboration': 'bg-violet-100 text-violet-700',
  'Review': 'bg-sky-100 text-sky-700',
};

const riskColors: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
  amber: 'bg-amber-50 text-amber-700 border-amber-200/50',
  red: 'bg-red-50 text-red-700 border-red-200/50',
};

const riskDots: Record<string, string> = {
  green: 'bg-emerald-400',
  amber: 'bg-amber-400',
  red: 'bg-red-400',
};

const statusColors: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
  pending: 'bg-amber-50 text-amber-700 border-amber-200/50',
  completed: 'bg-sky-50 text-sky-700 border-sky-200/50',
  planned: 'bg-accent-50 text-accent-700 border-accent-200/50',
};

const modStatus: Record<string, string> = {
  'completed': 'bg-emerald-50 text-emerald-700',
  'in-progress': 'bg-primary-50 text-primary-700',
  'not-started': 'bg-foreground-100 text-foreground-500',
};

// ─────────────────── Component ───────────────────

export default function CohortDetailPage() {
  const { id } = useParams();
  const cohortId = id || 'c-A';
  const data = COHORT_DATA[cohortId] || COHORT_DATA['c-A'];

  const [tab, setTab] = useState<'overview' | 'groups' | 'schedule' | 'modules' | 'staff'>('overview');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(data.groups[0]?.id || null);
  const [scheduleView, setScheduleView] = useState<'list' | 'calendar'>('list');
  const [selectedLearner, setSelectedLearner] = useState<LearnerRef | null>(null);

  const allLearners = data.groups.flatMap(g => g.learners);
  const atRiskCount = allLearners.filter(l => l.risk === 'red').length;
  const amberCount = allLearners.filter(l => l.risk === 'amber').length;

  const tabs = [
    { key: 'overview' as const, label: 'Overview', icon: 'ri-dashboard-line' },
    { key: 'groups' as const, label: 'Groups & Learners', icon: 'ri-team-line', count: data.groups.length },
    { key: 'schedule' as const, label: 'Schedule', icon: 'ri-calendar-line', count: data.sessions.length },
    { key: 'modules' as const, label: 'Module Progress', icon: 'ri-stack-line', count: data.modules.length },
    { key: 'staff' as const, label: 'Staff', icon: 'ri-user-settings-line' },
  ];

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle={`${data.name} — ${data.programme}`} pageSubtitle={`${data.standard} · ${data.level} · ${data.startDate} — ${data.endDate} · ${data.totalLearners} learners`} userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="min-h-full bg-background-100 p-4 sm:p-5 lg:p-6 space-y-4">
        {/* ── Breadcrumb ── */}
        <div className="flex items-center gap-2 text-[12px] text-foreground-400">
          <Link to="/curriculum/programmes" className="hover:text-foreground-700 transition-smooth">Programmes</Link>
          <AppIcon className="ri-arrow-right-s-line text-[10px]"></AppIcon>
          <Link to={`/curriculum/programmes/${data.programmeId}`} className="hover:text-foreground-700 transition-smooth">{data.programme} {data.level}</Link>
          <AppIcon className="ri-arrow-right-s-line text-[10px]"></AppIcon>
          <span className="text-foreground-900 font-medium">{data.name}</span>
        </div>

        {/* ── Cohort Header Card ── */}
        <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${statusColors[data.status]}`}>{data.status}</span>
                <span className="text-[11px] text-foreground-400">{data.startDate} — {data.endDate}</span>
              </div>
              <h1 className="text-xl font-heading font-bold text-foreground-900">{data.name}</h1>
              <p className="text-[13px] text-foreground-500 mt-1">{data.programme} {data.level} · {data.groups.length} groups · {data.totalLearners} learners</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button className="px-4 py-2.5 bg-background-50 border border-background-200 rounded-xl text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-edit-line mr-1"></AppIcon> Edit Cohort
              </button>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mt-5 pt-4 border-t border-foreground-200/60">
            <StatCard icon="ri-graduation-cap-line" value={data.totalLearners} label="Learners" color="primary" />
            <StatCard icon="ri-team-line" value={data.groups.length} label="Groups" color="accent" />
            <StatCard icon="ri-bar-chart-2-line" value={`${data.progress}%`} label="Avg Progress" color="secondary" />
            <StatCard icon="ri-check-double-line" value={`${data.attendance}%`} label="Attendance" color="emerald" />
            <StatCard icon="ri-time-line" value={formatHoursMinutes(data.otjhAvg)} label="Avg OTJH" color="amber" />
            <StatCard icon="ri-pie-chart-line" value={`${data.ksbAvgProgress}%`} label="KSB Progress" color="sky" />
            <StatCard icon="ri-alert-line" value={atRiskCount} label="At Risk" color="red" sub={amberCount > 0 ? `+${amberCount} amber` : undefined} />
            <StatCard icon="ri-trophy-line" value={`${data.completionRate}%`} label="Completion" color="emerald" />
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer shrink-0 ${tab === t.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
              <AppIcon className={`${t.icon} text-[13px]`}></AppIcon>
              {t.label}
              {t.count !== undefined && <span className="text-[9px] bg-foreground-200/50 px-1 rounded-full">{t.count}</span>}
            </button>
          ))}
        </div>

        {/* ═══════════════ TAB: Overview ═══════════════ */}
        {tab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Groups Summary */}
            <div className="lg:col-span-1 space-y-3">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Groups</h3>
              {data.groups.map(g => (
                <div key={g.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13px] font-semibold text-foreground-900">{g.name}</p>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusColors[g.status]}`}>{g.status}</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-foreground-400"><AppIcon className="ri-graduation-cap-line mr-1"></AppIcon>Learners</span>
                      <span className="font-semibold text-foreground-700">{g.learners.length}/{g.maxLearners}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-foreground-400"><AppIcon className="ri-heart-line mr-1"></AppIcon>Coach</span>
                      <span className="text-foreground-700">{g.coach}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-foreground-400"><AppIcon className="ri-user-settings-line mr-1"></AppIcon>Tutor</span>
                      <span className="text-foreground-700">{g.tutor}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-foreground-400">Progress</span>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-background-200 rounded-full overflow-hidden">
                          <div className="h-full bg-primary-500 rounded-full" style={{ width: `${g.progress}%` }}></div>
                        </div>
                        <span className="font-semibold text-foreground-700">{g.progress}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Learner Risk Summary */}
            <div className="lg:col-span-2 space-y-3">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Learner Status</h3>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
                <div className="space-y-2">
                  {allLearners.map(l => (
                    <button key={l.id} onClick={() => setSelectedLearner(selectedLearner?.id === l.id ? null : l)} className="w-full flex items-center gap-3 p-3 rounded-lg bg-background-100/50 border border-background-200/30 hover:bg-background-100 transition-smooth text-left cursor-pointer">
                      <span className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-[11px] font-bold shrink-0">{l.avatar}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-foreground-900">{l.name}</p>
                        <p className="text-[10px] text-foreground-400">{l.employer}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <p className="text-[11px] font-semibold text-foreground-700">{l.progress}%</p>
                          <p className="text-[9px] text-foreground-400">progress</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] font-semibold text-foreground-700">{l.attendance}%</p>
                          <p className="text-[9px] text-foreground-400">att.</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] font-semibold text-foreground-700">{l.otjh}h</p>
                          <p className="text-[9px] text-foreground-400">OTJH</p>
                        </div>
                        <span className={`w-2 h-2 rounded-full ${riskDots[l.risk]}`}></span>
                      </div>
                      <AppIcon className={`ri-arrow-down-s-line text-foreground-300 transition-smooth ${selectedLearner?.id === l.id ? 'rotate-180' : ''}`}></AppIcon>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Selected Learner Detail */}
            {selectedLearner && (
              <div className="lg:col-span-3 bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-[13px] font-bold">{selectedLearner.avatar}</span>
                    <div>
                      <p className="text-sm font-semibold text-foreground-900">{selectedLearner.name}</p>
                      <p className="text-[11px] text-foreground-400">{selectedLearner.employer} · Started {selectedLearner.startDate}</p>
                    </div>
                  </div>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${riskColors[selectedLearner.risk]}`}>{selectedLearner.risk === 'green' ? 'On Track' : selectedLearner.risk === 'amber' ? 'Needs Attention' : 'At Risk'}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <MiniBar label="Progress" value={selectedLearner.progress} color="primary" />
                  <MiniBar label="Attendance" value={selectedLearner.attendance} color="emerald" />
                  <MiniBar label="KSB Progress" value={selectedLearner.ksbProgress} color="accent" />
                  <MiniBar label="OTJH" value={Math.round(selectedLearner.otjh / selectedLearner.otjhRequired * 100)} color="amber" suffix={`${formatHoursMinutes(selectedLearner.otjh)} / ${formatHoursMinutes(selectedLearner.otjhRequired)}`} />
                </div>
                <p className="text-[11px] text-foreground-400 mt-3">Last Review: {selectedLearner.lastReview} · Status: {selectedLearner.status}</p>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ TAB: Groups & Learners ═══════════════ */}
        {tab === 'groups' && (
          <div className="space-y-4">
            {data.groups.map(g => (
              <div key={g.id} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <button onClick={() => setExpandedGroup(expandedGroup === g.id ? null : g.id)} className="w-full flex items-center gap-4 p-4 text-left cursor-pointer hover:bg-background-100/30 transition-smooth">
                  <span className="w-10 h-10 rounded-xl bg-secondary-50 flex items-center justify-center shrink-0">
                    <AppIcon className={`ri-arrow-down-s-line text-secondary-600 transition-smooth ${expandedGroup === g.id ? 'rotate-180' : ''}`}></AppIcon>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground-900">{g.name}</p>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${statusColors[g.status]}`}>{g.status}</span>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] text-foreground-500 mt-0.5 flex-wrap">
                      <span><AppIcon className="ri-graduation-cap-line mr-1 text-[10px]"></AppIcon>{g.learners.length}/{g.maxLearners} learners</span>
                      <span><AppIcon className="ri-heart-line mr-1 text-[10px]"></AppIcon>Coach: {g.coach}</span>
                      <span><AppIcon className="ri-user-settings-line mr-1 text-[10px]"></AppIcon>Tutor: {g.tutor}</span>
                      <span><AppIcon className="ri-calendar-line mr-1 text-[10px]"></AppIcon>{g.schedule}</span>
                      <span className="text-[10px] bg-background-100 px-2 py-0.5 rounded">{g.mode} · {g.room}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-[13px] font-bold text-foreground-900">{g.progress}%</p>
                      <p className="text-[9px] text-foreground-400">progress</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px] font-bold text-foreground-900">{g.attendance}%</p>
                      <p className="text-[9px] text-foreground-400">attendance</p>
                    </div>
                  </div>
                </button>

                {expandedGroup === g.id && (
                  <div className="px-4 pb-4 border-t border-background-200/30">
                    {g.learners.length === 0 ? (
                      <div className="p-6 text-center">
                        <AppIcon className="ri-user-search-line text-3xl text-foreground-300 mb-2 block"></AppIcon>
                        <p className="text-[12px] text-foreground-400">No learners assigned to this group yet.</p>
                        <p className="text-[11px] text-foreground-400 mt-1">Learners appear here once the enrolment team assigns them to this group.</p>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_0.5fr] gap-3 px-3 py-2 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                          <span>Learner</span>
                          <span className="text-center">Progress</span>
                          <span className="text-center">Attendance</span>
                          <span className="text-center">OTJH</span>
                          <span className="text-center">KSBs</span>
                          <span className="text-center">Risk</span>
                          <span></span>
                        </div>
                        {g.learners.map(l => (
                          <div key={l.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_0.5fr] gap-3 px-3 py-2.5 items-center rounded-lg bg-background-100/50 border border-background-200/30 hover:bg-background-100 transition-smooth">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-[9px] font-bold shrink-0">{l.avatar}</span>
                              <div className="min-w-0">
                                <p className="text-[11px] font-medium text-foreground-900 truncate">{l.name}</p>
                                <p className="text-[9px] text-foreground-400 truncate">{l.employer}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 justify-center">
                              <div className="w-12 h-1.5 bg-background-200 rounded-full overflow-hidden">
                                <div className="h-full bg-primary-500 rounded-full" style={{ width: `${l.progress}%` }}></div>
                              </div>
                              <span className="text-[10px] font-semibold text-foreground-600">{l.progress}%</span>
                            </div>
                            <span className="text-[11px] text-foreground-500 text-center">{l.attendance}%</span>
                            <span className="text-[11px] text-foreground-500 text-center">{l.otjh}/{l.otjhRequired}h</span>
                            <span className="text-[11px] text-foreground-500 text-center">{l.ksbProgress}%</span>
                            <div className="flex justify-center">
                              <span className={`w-2 h-2 rounded-full ${riskDots[l.risk]}`}></span>
                            </div>
                            <button className="w-7 h-7 rounded-lg bg-background-50 border border-background-200 flex items-center justify-center hover:bg-background-200 transition-smooth cursor-pointer">
                              <AppIcon className="ri-more-2-fill text-foreground-400 text-xs"></AppIcon>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-background-200/30">
                      <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                        <AppIcon className="ri-edit-line mr-1"></AppIcon> Edit Group
                      </button>
                      <span className="text-[10px] text-foreground-400">Learner placements are managed by the enrolment team.</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <button type="button" className="block w-full p-4 border-2 border-dashed border-background-200 rounded-xl text-center hover:border-primary-300 hover:bg-primary-50/30 transition-smooth cursor-pointer">
              <AppIcon className="ri-add-line text-foreground-400 text-lg mb-1 block"></AppIcon>
              <p className="text-[12px] font-medium text-foreground-500">Add New Group</p>
            </button>
          </div>
        )}

        {/* ═══════════════ TAB: Schedule ═══════════════ */}
        {tab === 'schedule' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1">
                <button onClick={() => setScheduleView('list')} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${scheduleView === 'list' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500'}`}>
                  <AppIcon className="ri-list-check mr-1"></AppIcon> List
                </button>
                <button onClick={() => setScheduleView('calendar')} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${scheduleView === 'calendar' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500'}`}>
                  <AppIcon className="ri-calendar-2-line mr-1"></AppIcon> Calendar
                </button>
              </div>
              <Link to="/curriculum/session-calendar" className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-calendar-schedule-line mr-1"></AppIcon> Full Calendar
              </Link>
            </div>

            {scheduleView === 'list' ? (
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="grid grid-cols-[2fr_0.8fr_0.8fr_1fr_1fr_1fr_0.8fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                  <span>Session</span>
                  <span className="text-center">Type</span>
                  <span className="text-center">Day</span>
                  <span className="text-center">Time</span>
                  <span className="text-center">Group</span>
                  <span className="text-center">Tutor</span>
                  <span className="text-center">Status</span>
                </div>
                <div className="divide-y divide-background-200/30">
                  {data.sessions.map(s => (
                    <div key={s.id} className="grid grid-cols-[2fr_0.8fr_0.8fr_1fr_1fr_1fr_0.8fr] gap-3 px-4 py-3 items-center hover:bg-background-100/30 transition-smooth">
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium text-foreground-900 truncate">{s.title}</p>
                        <p className="text-[10px] text-foreground-400">{s.date} · {s.module} W{s.week}</p>
                      </div>
                      <div className="flex justify-center">
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${typeColors[s.type] || 'bg-foreground-100 text-foreground-500'}`}>{s.type}</span>
                      </div>
                      <span className="text-[11px] text-foreground-500 text-center">{s.day}</span>
                      <span className="text-[11px] text-foreground-500 text-center">{s.startTime}—{s.endTime}</span>
                      <span className="text-[11px] text-foreground-500 text-center">{s.group}</span>
                      <span className="text-[11px] text-foreground-500 text-center">{s.tutor}</span>
                      <div className="flex justify-center">
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${s.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{s.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <CohortCalendar sessions={data.sessions} />
            )}
          </div>
        )}

        {/* ═══════════════ TAB: Module Progress ═══════════════ */}
        {tab === 'modules' && (
          <div className="space-y-4">
            {data.modules.map((m, i) => (
              <div key={i} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
                      <AppIcon className="ri-stack-line text-sm"></AppIcon>
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-foreground-900">{m.name}</p>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${modStatus[m.status]}`}>{m.status.replace('-', ' ')}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-2 bg-background-200 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full" style={{ width: `${m.progress}%` }}></div>
                    </div>
                    <span className="text-[12px] font-bold text-foreground-700">{m.progress}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══════════════ TAB: Staff ═══════════════ */}
        {tab === 'staff' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.groups.map(g => (
                <div key={g.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                  <h3 className="text-sm font-semibold text-foreground-900 mb-3">{g.name}</h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-[11px] font-bold shrink-0">
                        {g.coach.split(' ').map(n => n[0]).join('')}
                      </span>
                      <div>
                        <p className="text-[12px] font-semibold text-foreground-900">{g.coach}</p>
                        <p className="text-[10px] text-foreground-400">Coach</p>
                      </div>
                      <button className="ml-auto px-2.5 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Change</button>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-full bg-accent-100 text-accent-700 flex items-center justify-center text-[11px] font-bold shrink-0">
                        {g.tutor.split(' ').map(n => n[0]).join('')}
                      </span>
                      <div>
                        <p className="text-[12px] font-semibold text-foreground-900">{g.tutor}</p>
                        <p className="text-[10px] text-foreground-400">Tutor</p>
                      </div>
                      <button className="ml-auto px-2.5 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Change</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

// ─────────────────── Helper Components ───────────────────

function StatCard({ icon, value, label, color, sub }: { icon: string; value: number | string; label: string; color: string; sub?: string }) {
  const colorMap: Record<string, string> = {
    primary: 'bg-primary-50 text-primary-700',
    accent: 'bg-accent-50 text-accent-700',
    secondary: 'bg-secondary-50 text-secondary-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-600',
    sky: 'bg-sky-50 text-sky-700',
  };
  return (
    <div className="coach-metric-card">
      <div className="flex items-center gap-2 mb-1">
        <AppIcon className={`${icon} ${colorMap[color] || 'text-foreground-400'} text-xs`}></AppIcon>
        <span className="text-[10px] text-foreground-400 uppercase">{label}</span>
      </div>
      <p className="text-lg font-bold text-foreground-900">{value}</p>
      {sub && <p className="text-[9px] text-foreground-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function MiniBar({ label, value, color, suffix }: { label: string; value: number; color: string; suffix?: string }) {
  const colorMap: Record<string, string> = {
    primary: 'bg-primary-500',
    emerald: 'bg-emerald-500',
    accent: 'bg-accent-500',
    amber: 'bg-amber-500',
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-foreground-400 uppercase">{label}</span>
        <span className="text-[11px] font-semibold text-foreground-700">{value}%</span>
      </div>
      <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colorMap[color] || 'bg-primary-500'}`} style={{ width: `${value}%` }}></div>
      </div>
      {suffix && <p className="text-[9px] text-foreground-400 mt-0.5">{suffix}</p>}
    </div>
  );
}

function CohortCalendar({ sessions }: { sessions: SessionItem[] }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const timeSlots = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];

  const sessionTypeBg: Record<string, string> = {
    'Live Session': 'bg-primary-100 border-primary-300 text-primary-800',
    'Workshop': 'bg-accent-100 border-accent-300 text-accent-800',
    'Self-study': 'bg-secondary-100 border-secondary-300 text-secondary-800',
    'Assignment': 'bg-amber-100 border-amber-300 text-amber-800',
    'Quiz': 'bg-rose-100 border-rose-300 text-rose-800',
    'OTJH': 'bg-emerald-100 border-emerald-300 text-emerald-800',
    'Collaboration': 'bg-violet-100 border-violet-300 text-violet-800',
    'Review': 'bg-sky-100 border-sky-300 text-sky-800',
  };

  const getSessionForSlot = (day: string, hour: string) => {
    return sessions.filter(s => {
      const startH = s.startTime.split(':')[0];
      return s.day === day && startH === hour.split(':')[0];
    });
  };

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
      <div className="grid grid-cols-[80px_1fr_1fr_1fr_1fr_1fr] border-b border-foreground-300/50">
        <div className="py-2 px-3 text-[10px] font-semibold text-foreground-400 uppercase"></div>
        {days.map(d => (
          <div key={d} className="py-2 px-3 text-center text-[10px] font-semibold text-foreground-400 uppercase border-l border-background-200/30">{d}</div>
        ))}
      </div>
      <div className="max-h-[500px] overflow-y-auto">
        {timeSlots.map(hour => (
          <div key={hour} className="grid grid-cols-[80px_1fr_1fr_1fr_1fr_1fr] border-b border-background-200/20">
            <div className="py-3 px-3 text-[10px] text-foreground-400 font-medium">{hour}</div>
            {days.map(day => {
              const slotSessions = getSessionForSlot(day, hour);
              return (
                <div key={day} className="py-1 px-1 border-l border-background-200/20 min-h-[48px]">
                  {slotSessions.map(s => (
                    <div key={s.id} className={`p-1.5 rounded-md border text-[9px] leading-tight mb-0.5 cursor-pointer ${sessionTypeBg[s.type] || 'bg-foreground-100 border-foreground-200'}`}>
                      <p className="font-semibold truncate">{s.title}</p>
                      <p className="opacity-70">{s.startTime}—{s.endTime} · {s.group}</p>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
