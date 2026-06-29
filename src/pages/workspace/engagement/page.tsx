import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';

const engagementNav = roleNavMap.engagement;

type TabKey = 'overview' | 'attendance' | 'absence' | 'engagement';

interface EngagementLearner {
  name: string;
  programme: string;
  cohort: string;
  engagementScore: number;
  attendanceRate: number;
  lastActive: string;
  riskLevel: string;
  trend: string;
  flags: string[];
}

const ENGAGEMENT_LEARNERS: EngagementLearner[] = [
  { name: 'Sophie Williams', programme: 'Marketing Executive L4', cohort: 'Cohort C', engagementScore: 62, attendanceRate: 86, lastActive: '2 days ago', riskLevel: 'amber', trend: 'down', flags: ['OTJH pace', 'KSB stagnant'] },
  { name: 'James Okonkwo', programme: 'Data Analyst L4', cohort: 'Cohort D', engagementScore: 28, attendanceRate: 78, lastActive: '5 days ago', riskLevel: 'red', trend: 'down', flags: ['Attendance', 'Overdue evidence', 'No Teams login'] },
  { name: 'Aisha Patel', programme: 'Accountancy L3', cohort: 'Cohort C', engagementScore: 35, attendanceRate: 83, lastActive: '3 days ago', riskLevel: 'amber', trend: 'down', flags: ['Low engagement', '3 weeks no evidence'] },
  { name: 'Sarah Mitchell', programme: 'Business Admin L3', cohort: 'Cohort A', engagementScore: 88, attendanceRate: 94, lastActive: '1 day ago', riskLevel: 'green', trend: 'up', flags: [] },
  { name: 'Emily Watson', programme: 'Digital Marketer L3', cohort: 'Cohort B', engagementScore: 95, attendanceRate: 100, lastActive: 'Today', riskLevel: 'green', trend: 'up', flags: [] },
  { name: 'David Chen', programme: 'Software Developer L4', cohort: 'Cohort F', engagementScore: 72, attendanceRate: 94, lastActive: '2 days ago', riskLevel: 'green', trend: 'stable', flags: [] },
  { name: 'Liam Foster', programme: 'Project Manager L4', cohort: 'Cohort A', engagementScore: 78, attendanceRate: 91, lastActive: '1 day ago', riskLevel: 'green', trend: 'stable', flags: [] },
  { name: 'Maya Kapoor', programme: 'HR Consultant L5', cohort: 'Cohort E', engagementScore: 45, attendanceRate: 100, lastActive: 'Today', riskLevel: 'amber', trend: 'stable', flags: ['New starter', 'Evidence pace slow'] },
];

const ATTENDANCE_RISK = [
  { name: 'James Okonkwo', rate: 78, missed: 8, trend: 'deteriorating', action: 'Intervention required — call employer', lastSession: 'Missed 5 Jun', coach: 'Med Maher' },
  { name: 'Aisha Patel', rate: 83, missed: 6, trend: 'declining', action: 'Monitor — possible pattern', lastSession: 'Attended 6 Jun', coach: 'Med Maher' },
  { name: 'Sophie Williams', rate: 86, missed: 5, trend: 'fluctuating', action: 'Check work commitment clashes', lastSession: 'Attended 4 Jun', coach: 'Med Maher' },
  { name: 'Daniel Walsh', rate: 68, missed: 12, trend: 'deteriorating', action: 'Formal attendance warning', lastSession: 'Missed 9 Jun', coach: 'Sarah Chen' },
];

const ABSENCE_QUEUE = [
  { learner: 'James Okonkwo', date: '5 Jun 2026', session: 'Data Visualisation', reason: 'Illness', reported: 'Late (2 days)', status: 'pending' as const, risk: 'high' },
  { learner: 'Sophie Williams', date: '2 Jun 2026', session: 'Marketing Environment', reason: 'Work commitment', reported: 'On time', status: 'approved' as const, risk: 'low' },
  { learner: 'Aisha Patel', date: '1 Jun 2026', session: 'Taxation Module', reason: 'Annual leave', reported: 'On time', status: 'pending' as const, risk: 'medium' },
  { learner: 'Daniel Walsh', date: '9 Jun 2026', session: 'Business Communication', reason: 'Not reported', reported: 'Not reported', status: 'unreported' as const, risk: 'high' },
  { learner: 'Liam Foster', date: '28 May 2026', session: 'Project Planning', reason: 'Medical appointment', reported: 'On time', status: 'approved' as const, risk: 'low' },
  { learner: 'Maya Kapoor', date: '7 Jun 2026', session: 'HR Policy Workshop', reason: 'IT issues', reported: 'Late (1 day)', status: 'pending' as const, risk: 'medium' },
  { learner: 'David Chen', date: '3 Jun 2026', session: 'Code Review', reason: 'Family emergency', reported: 'On time', status: 'approved' as const, risk: 'low' },
];

const ENGAGEMENT_STATS = {
  totalLearners: 59,
  activeThisWeek: 48,
  averageEngagement: 72,
  redRisk: 2,
  amberRisk: 4,
  greenLearners: 53,
  totalAbsencesThisMonth: 18,
  unreportedAbsences: 2,
  catchUpOverdue: 9,
};

const ATTENDANCE_TREND_DATA = [
  { week: 'Wk 1', attendance: 88, target: 90 },
  { week: 'Wk 2', attendance: 84, target: 90 },
  { week: 'Wk 3', attendance: 86, target: 90 },
  { week: 'Wk 4', attendance: 82, target: 90 },
  { week: 'Wk 5', attendance: 79, target: 90 },
  { week: 'Wk 6', attendance: 81, target: 90 },
  { week: 'Wk 7', attendance: 85, target: 90 },
  { week: 'Wk 8', attendance: 77, target: 90 },
  { week: 'Wk 9', attendance: 80, target: 90 },
  { week: 'Wk 10', attendance: 83, target: 90 },
];

const ENGAGEMENT_DISTRIBUTION = [
  { range: '0-20%', count: 1, fill: '#ef4444' },
  { range: '21-40%', count: 2, fill: '#f97316' },
  { range: '41-60%', count: 4, fill: '#eab308' },
  { range: '61-80%', count: 12, fill: '#22c55e' },
  { range: '81-100%', count: 6, fill: '#10b981' },
];

const OTJH_PROGRESS_DATA = [
  { name: 'On Track', value: 38, color: '#22c55e' },
  { name: 'Slightly Behind', value: 12, color: '#eab308' },
  { name: 'Significantly Behind', value: 6, color: '#f97316' },
  { name: 'At Risk', value: 3, color: '#ef4444' },
];

const CLUB_ACTIVITY_DATA = [
  { subject: 'Attendance', Marketing: 85, Leadership: 78, AI: 92, Career: 70, Sustainability: 65, Project: 80, British: 75 },
  { subject: 'Contributions', Marketing: 90, Leadership: 82, AI: 88, Career: 75, Sustainability: 60, Project: 85, British: 70 },
  { subject: 'New Members', Marketing: 75, Leadership: 65, AI: 80, Career: 70, Sustainability: 55, Project: 72, British: 68 },
  { subject: 'Events Held', Marketing: 80, Leadership: 70, AI: 85, Career: 60, Sustainability: 50, Project: 75, British: 65 },
  { subject: 'Points Earned', Marketing: 95, Leadership: 88, AI: 90, Career: 72, Sustainability: 58, Project: 82, British: 74 },
];

const CLUB_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];

export default function EngagementDashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  const pendingAbsence = ABSENCE_QUEUE.filter(a => a.status === 'pending' || a.status === 'unreported').length;
  const redRiskCount = ENGAGEMENT_LEARNERS.filter(l => l.riskLevel === 'red').length;
  const amberRiskCount = ENGAGEMENT_LEARNERS.filter(l => l.riskLevel === 'amber').length;

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Engagement Command Centre" pageSubtitle="Learner engagement monitoring, attendance risk tracking, and absence reporting management"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <WorkspaceHeroBanner
          title="Engagement Command Centre"
          description={`${ENGAGEMENT_STATS.activeThisWeek}/${ENGAGEMENT_STATS.totalLearners} active this week. ${redRiskCount} red-risk, ${amberRiskCount} amber-risk learners. ${pendingAbsence} absence reports pending. Average engagement: ${ENGAGEMENT_STATS.averageEngagement}%.`}
          icon="ri-heart-pulse-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20learner%20engagement%20group%20collaboration%20team%20discussion%20apprenticeship%20purple%20gold%20accent%20editorial%20photography%20modern%20office%20warm%20welcoming%20atmosphere&width=400&height=160&seq=engagement-hero-01&orientation=landscape"
          imageAlt="Engagement Command Centre"
          stats={[
            { label: 'Active', value: String(ENGAGEMENT_STATS.activeThisWeek) },
            { label: 'Red Risk', value: String(redRiskCount), variant: 'danger' },
            { label: 'Absences', value: String(pendingAbsence) },
          ]}
        />

        {/* Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <EngagementStatCard label="Engagement Score" value={`${ENGAGEMENT_STATS.averageEngagement}%`} sub={`${ENGAGEMENT_STATS.activeThisWeek}/${ENGAGEMENT_STATS.totalLearners} active`} icon="ri-heart-line" color="primary" />
          <EngagementStatCard label="At Risk Learners" value={String(redRiskCount + amberRiskCount)} sub={`${redRiskCount} red · ${amberRiskCount} amber`} icon="ri-alert-line" color="accent" />
          <EngagementStatCard label="Attendance Risk" value={String(ATTENDANCE_RISK.length)} sub="deteriorating patterns" icon="ri-calendar-check-line" color="secondary" />
          <EngagementStatCard label="Absence Queue" value={String(pendingAbsence)} sub={`${ENGAGEMENT_STATS.unreportedAbsences} unreported`} icon="ri-error-warning-line" color="primary" />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {([
            { key: 'overview' as TabKey, label: 'Engagement Overview', icon: 'ri-heart-line' },
            { key: 'attendance' as TabKey, label: 'Attendance Risk', icon: 'ri-alert-line', badge: ATTENDANCE_RISK.length },
            { key: 'absence' as TabKey, label: 'Absence Queue', icon: 'ri-error-warning-line', badge: pendingAbsence },
            { key: 'engagement' as TabKey, label: 'Learner Engagement', icon: 'ri-bar-chart-2-line' },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                activeTab === tab.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              <i className={`${tab.icon} text-sm`}></i>
              {tab.label}
              {tab.badge != null && tab.badge > 0 && (
                <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Engagement Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {ENGAGEMENT_LEARNERS.map((l, i) => (
                <div key={i} className={`bg-background-50 rounded-xl border p-4 card-premium ${
                  l.riskLevel === 'red' ? 'border-red-200/50 bg-red-50/20' :
                  l.riskLevel === 'amber' ? 'border-amber-200/50 bg-amber-50/20' :
                  'border-foreground-200/60'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${
                        l.riskLevel === 'red' ? 'bg-red-100 text-red-700' :
                        l.riskLevel === 'amber' ? 'bg-amber-100 text-amber-700' :
                        'bg-emerald-100 text-emerald-700'
                      }`}>{l.name.charAt(0)}</div>
                      <div>
                        <p className="text-[13px] font-semibold text-foreground-900">{l.name}</p>
                        <p className="text-[10px] text-foreground-400">{l.programme}</p>
                      </div>
                    </div>
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      l.riskLevel === 'red' ? 'bg-red-500' :
                      l.riskLevel === 'amber' ? 'bg-amber-500' :
                      'bg-emerald-500'
                    }`}></span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-foreground-400">Engagement</span>
                      <span className={`font-semibold ${l.engagementScore >= 70 ? 'text-emerald-600' : l.engagementScore >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{l.engagementScore}%</span>
                    </div>
                    <div className="w-full bg-background-200 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${l.engagementScore >= 70 ? 'bg-emerald-500' : l.engagementScore >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${l.engagementScore}%` }}></div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-foreground-400">
                      <span>Attendance: {l.attendanceRate}%</span>
                      <span>Last active: {l.lastActive}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px]">
                      <span className="text-foreground-400">Trend:</span>
                      <span className={`font-medium ${
                        l.trend === 'up' ? 'text-emerald-600' : l.trend === 'down' ? 'text-red-600' : 'text-foreground-500'
                      }`}>
                        <i className={`${l.trend === 'up' ? 'ri-arrow-up-line' : l.trend === 'down' ? 'ri-arrow-down-line' : 'ri-subtract-line'} text-[9px] mr-0.5`}></i>
                        {l.trend}
                      </span>
                    </div>
                  </div>
                  {l.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {l.flags.map(flag => (
                        <span key={flag} className="text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">{flag}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Attendance Trends */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Attendance Trends</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Weekly attendance rate vs 90% target</p>
                  </div>
                  <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">Last 10 weeks</span>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={ATTENDANCE_TREND_DATA} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--background-200)" />
                    <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} axisLine={{ stroke: 'var(--background-200)' }} tickLine={false} />
                    <YAxis domain={[60, 100]} tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--background-200)', fontSize: '11px', background: 'var(--background-50)' }} />
                    <Line type="monotone" dataKey="target" stroke="var(--foreground-300)" strokeDasharray="5 5" strokeWidth={1.5} dot={false} name="Target 90%" />
                    <Line type="monotone" dataKey="attendance" stroke="oklch(var(--primary-500))" strokeWidth={2.5} dot={{ r: 3, fill: 'oklch(var(--primary-500))' }} activeDot={{ r: 5 }} name="Attendance" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Engagement Score Distribution */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Engagement Score Distribution</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Learners by engagement score range</p>
                  </div>
                  <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{ENGAGEMENT_DISTRIBUTION.reduce((s, d) => s + d.count, 0)} learners</span>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={ENGAGEMENT_DISTRIBUTION} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--background-200)" />
                    <XAxis dataKey="range" tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} axisLine={{ stroke: 'var(--background-200)' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--background-200)', fontSize: '11px', background: 'var(--background-50)' }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Learners">
                      {ENGAGEMENT_DISTRIBUTION.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Charts Row 2 - OTJH Pie + Club Radar */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* OTJH Progress Pie Chart */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">OTJH Progress</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Learners by off-the-job training progress status</p>
                  </div>
                  <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">59 learners</span>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={OTJH_PROGRESS_DATA}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={4}
                      dataKey="value"
                      stroke="none"
                    >
                      {OTJH_PROGRESS_DATA.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--background-200)', fontSize: '11px', background: 'var(--background-50)' }} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Club Activity Radar Chart */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Club Activity</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Performance across learner clubs by dimension</p>
                  </div>
                  <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">7 clubs</span>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <RadarChart data={CLUB_ACTIVITY_DATA} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                    <PolarGrid stroke="var(--background-200)" />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: 'var(--foreground-400)' }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9, fill: 'var(--foreground-400)' }} />
                    <Radar name="Marketing" dataKey="Marketing" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={1.5} />
                    <Radar name="Leadership" dataKey="Leadership" stroke="#f97316" fill="#f97316" fillOpacity={0.1} strokeWidth={1.5} />
                    <Radar name="AI" dataKey="AI" stroke="#eab308" fill="#eab308" fillOpacity={0.1} strokeWidth={1.5} />
                    <Radar name="Career" dataKey="Career" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} strokeWidth={1.5} />
                    <Radar name="Sustainability" dataKey="Sustainability" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={1.5} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--background-200)', fontSize: '11px', background: 'var(--background-50)' }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* Attendance Risk */}
        {activeTab === 'attendance' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Attendance Risk Monitoring</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Learners with attendance below 90% or deteriorating patterns</p>
              </div>
              <span className="text-[10px] text-foreground-400 bg-red-50 text-red-600 px-2 py-0.5 rounded-full">{ATTENDANCE_RISK.length} at risk</span>
            </div>
            <div className="space-y-3">
              {ATTENDANCE_RISK.map((l, i) => (
                <div key={i} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                        l.rate < 70 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>{l.name.charAt(0)}</div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground-900">{l.name}</p>
                        <p className="text-[11px] text-foreground-400">Coach: {l.coach}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] shrink-0 flex-wrap">
                      <span className={`text-lg font-bold ${l.rate < 70 ? 'text-red-600' : 'text-amber-600'}`}>{l.rate}%</span>
                      <span className="text-foreground-400">{l.missed} missed</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        l.trend === 'deteriorating' ? 'bg-red-100 text-red-700' :
                        l.trend === 'declining' ? 'bg-amber-100 text-amber-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>{l.trend}</span>
                      <span className="text-foreground-400">{l.lastSession}</span>
                    </div>
                  </div>
                  <div className="mt-3 bg-amber-50/50 rounded-lg p-3 flex items-start gap-2">
                    <i className="ri-alert-line text-amber-600 text-sm mt-0.5"></i>
                    <div>
                      <p className="text-[11px] font-medium text-amber-800">Recommended Action</p>
                      <p className="text-[11px] text-amber-700">{l.action}</p>
                    </div>
                    <button className="ml-auto px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[10px] font-semibold hover:bg-amber-700 transition-smooth cursor-pointer whitespace-nowrap shrink-0">
                      Take Action
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Absence Queue */}
        {activeTab === 'absence' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Absence Reporting Queue</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">All absence reports requiring review and action</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{ABSENCE_QUEUE.length} total</span>
                <span className="text-[10px] text-foreground-400 bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">{pendingAbsence} pending</span>
              </div>
            </div>
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {ABSENCE_QUEUE.map((a, i) => (
                  <div key={i} className={`p-4 flex flex-col sm:flex-row sm:items-center gap-4 ${a.risk === 'high' ? 'bg-red-50/30' : ''}`}>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        a.status === 'approved' ? 'bg-emerald-100 text-emerald-600' :
                        a.status === 'unreported' ? 'bg-red-100 text-red-600' :
                        'bg-amber-100 text-amber-600'
                      }`}>
                        <i className={`${
                          a.status === 'approved' ? 'ri-check-line' :
                          a.status === 'unreported' ? 'ri-close-circle-line' :
                          'ri-time-line'
                        } text-sm`}></i>
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-foreground-900">{a.learner}</p>
                        <p className="text-[11px] text-foreground-400 mt-0.5">{a.date} — {a.session}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] shrink-0 flex-wrap">
                      <span className="text-foreground-400">Reason: {a.reason}</span>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${a.reported === 'Not reported' || a.reported.startsWith('Late') ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{a.reported}</span>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        a.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                        a.status === 'unreported' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>{a.status}</span>
                      {a.status !== 'approved' && (
                        <>
                          <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap">
                            Approve
                          </button>
                          <button className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-semibold hover:bg-red-700 transition-smooth cursor-pointer whitespace-nowrap">
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Learner Engagement Detail */}
        {activeTab === 'engagement' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Learner Engagement Detail</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Comprehensive engagement scores based on attendance, evidence, OTJH, and activity</p>
              </div>
              <button className="text-[12px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap">
                <i className="ri-download-line mr-1"></i> Export Report
              </button>
            </div>
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {ENGAGEMENT_LEARNERS.map((l, i) => (
                  <div key={i} className={`p-4 flex flex-col sm:flex-row sm:items-center gap-4 ${l.riskLevel === 'red' ? 'bg-red-50/20' : l.riskLevel === 'amber' ? 'bg-amber-50/20' : ''}`}>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                        l.riskLevel === 'red' ? 'bg-red-100 text-red-700' :
                        l.riskLevel === 'amber' ? 'bg-amber-100 text-amber-700' :
                        'bg-emerald-100 text-emerald-700'
                      }`}>{l.name.charAt(0)}</div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground-900">{l.name}</p>
                        <p className="text-[11px] text-foreground-400">{l.programme} · {l.cohort}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] shrink-0 flex-wrap">
                      <div className="flex items-center gap-1">
                        <span className="text-foreground-400">Score:</span>
                        <span className={`font-bold text-sm ${l.engagementScore >= 70 ? 'text-emerald-600' : l.engagementScore >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{l.engagementScore}%</span>
                      </div>
                      <span className="text-foreground-400">Att: {l.attendanceRate}%</span>
                      <span className="text-foreground-400">{l.lastActive}</span>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        l.riskLevel === 'red' ? 'bg-red-100 text-red-700' :
                        l.riskLevel === 'amber' ? 'bg-amber-100 text-amber-700' :
                        'bg-emerald-100 text-emerald-700'
                      }`}>{l.riskLevel.toUpperCase()}</span>
                      {l.flags.length > 0 && l.riskLevel !== 'green' && (
                        <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                          <i className="ri-phone-line mr-1"></i> Contact
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Quick Actions */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Call Logs', icon: 'ri-phone-line', path: '/engagement/call-logs' },
            { label: 'WhatsApp Logs', icon: 'ri-whatsapp-line', path: '/engagement/whatsapp-logs' },
            { label: 'Email Logs', icon: 'ri-mail-line', path: '/engagement/email-logs' },
            { label: 'Employer Escalations', icon: 'ri-building-2-line', path: '/engagement/employer-escalations' },
            { label: 'Catch-up Overdue', icon: 'ri-timer-line', path: '/engagement/catchup-overdue' },
            { label: 'Communication Centre', icon: 'ri-message-2-line', path: '/engagement/communication' },
            { label: 'Points Rules', icon: 'ri-gift-2-line', path: '/engagement/points-rules' },
            { label: 'Rewards Shop', icon: 'ri-shopping-bag-3-line', path: '/engagement/rewards-shop' },
            { label: 'Voucher Claims', icon: 'ri-coupon-line', path: '/engagement/voucher-claims' },
            { label: 'Events', icon: 'ri-calendar-event-line', path: '/engagement/events' },
            { label: 'Learner Clubs', icon: 'ri-team-line', path: '/engagement/clubs' },
            { label: 'Recognition', icon: 'ri-thumb-up-line', path: '/engagement/recognition' },
          ].map(link => (
            <button
              key={link.label}
              onClick={() => navigate(link.path)}
              className="flex items-center gap-2 px-3 py-2.5 bg-background-50 rounded-xl border border-foreground-200/60 text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-700 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap"
            >
              <i className={`${link.icon} text-sm`}></i>
              {link.label}
            </button>
          ))}
        </section>
      </div>
    </WorkspaceShell>
  );
}

function EngagementStatCard({ label, value, sub, icon, color }: { label: string; value: string; sub: string; icon: string; color: string }) {
  const iconBg = color === 'primary' ? 'bg-primary-100 text-primary-600'
    : color === 'accent' ? 'bg-accent-50 text-accent-700'
    : 'bg-secondary-100 text-secondary-600';

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconBg}`}>
          <i className={`${icon} text-sm`}></i>
        </span>
      </div>
      <p className="text-[11px] text-foreground-400 mb-1">{label}</p>
      <p className="text-2xl font-heading font-semibold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400 mt-1">{sub}</p>
    </div>
  );
}