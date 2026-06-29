import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const engagementNav = roleNavMap.engagement;

interface LearnerEngagement {
  id: string;
  name: string;
  programme: string;
  cohort: string;
  engagementScore: number;
  lastLogin: string;
  sessionsAttended: number;
  totalSessions: number;
  evidenceSubmitted: number;
  evidenceTarget: number;
  otjhHours: number;
  otjhTarget: number;
  clubActivity: number;
  messageResponse: number;
  trend: 'up' | 'down' | 'stable';
  riskLevel: 'green' | 'amber' | 'red';
}

const LEARNERS: LearnerEngagement[] = [
  { id: 'le-01', name: 'Emily Watson', programme: 'Digital Marketer L3', cohort: 'Cohort B', engagementScore: 94, lastLogin: 'Today', sessionsAttended: 18, totalSessions: 20, evidenceSubmitted: 12, evidenceTarget: 14, otjhHours: 156, otjhTarget: 180, clubActivity: 8, messageResponse: 100, trend: 'up', riskLevel: 'green' },
  { id: 'le-02', name: 'Sarah Mitchell', programme: 'Business Admin L3', cohort: 'Cohort A', engagementScore: 88, lastLogin: '1 day ago', sessionsAttended: 17, totalSessions: 20, evidenceSubmitted: 11, evidenceTarget: 14, otjhHours: 142, otjhTarget: 180, clubActivity: 6, messageResponse: 95, trend: 'up', riskLevel: 'green' },
  { id: 'le-03', name: 'David Chen', programme: 'Software Developer L4', cohort: 'Cohort F', engagementScore: 76, lastLogin: '2 days ago', sessionsAttended: 15, totalSessions: 20, evidenceSubmitted: 9, evidenceTarget: 14, otjhHours: 128, otjhTarget: 180, clubActivity: 4, messageResponse: 80, trend: 'stable', riskLevel: 'green' },
  { id: 'le-04', name: 'Liam Foster', programme: 'Project Manager L4', cohort: 'Cohort A', engagementScore: 72, lastLogin: '1 day ago', sessionsAttended: 16, totalSessions: 20, evidenceSubmitted: 8, evidenceTarget: 14, otjhHours: 115, otjhTarget: 180, clubActivity: 3, messageResponse: 75, trend: 'stable', riskLevel: 'green' },
  { id: 'le-05', name: 'Maya Kapoor', programme: 'HR Consultant L5', cohort: 'Cohort E', engagementScore: 45, lastLogin: 'Today', sessionsAttended: 12, totalSessions: 20, evidenceSubmitted: 5, evidenceTarget: 14, otjhHours: 98, otjhTarget: 180, clubActivity: 2, messageResponse: 45, trend: 'stable', riskLevel: 'amber' },
  { id: 'le-06', name: 'Sophie Williams', programme: 'Marketing Executive L4', cohort: 'Cohort C', engagementScore: 62, lastLogin: '2 days ago', sessionsAttended: 14, totalSessions: 20, evidenceSubmitted: 7, evidenceTarget: 14, otjhHours: 105, otjhTarget: 180, clubActivity: 5, messageResponse: 60, trend: 'down', riskLevel: 'amber' },
  { id: 'le-07', name: 'Aisha Patel', programme: 'Accountancy L3', cohort: 'Cohort C', engagementScore: 35, lastLogin: '3 days ago', sessionsAttended: 10, totalSessions: 20, evidenceSubmitted: 4, evidenceTarget: 14, otjhHours: 72, otjhTarget: 180, clubActivity: 1, messageResponse: 30, trend: 'down', riskLevel: 'amber' },
  { id: 'le-08', name: 'James Okonkwo', programme: 'Data Analyst L4', cohort: 'Cohort D', engagementScore: 28, lastLogin: '5 days ago', sessionsAttended: 8, totalSessions: 20, evidenceSubmitted: 3, evidenceTarget: 14, otjhHours: 58, otjhTarget: 180, clubActivity: 0, messageResponse: 15, trend: 'down', riskLevel: 'red' },
  { id: 'le-09', name: 'Daniel Walsh', programme: 'Business Admin L3', cohort: 'Cohort A', engagementScore: 41, lastLogin: '4 days ago', sessionsAttended: 11, totalSessions: 20, evidenceSubmitted: 5, evidenceTarget: 14, otjhHours: 88, otjhTarget: 180, clubActivity: 2, messageResponse: 40, trend: 'down', riskLevel: 'amber' },
  { id: 'le-10', name: 'Olivia Park', programme: 'Marketing Executive L4', cohort: 'Cohort B', engagementScore: 81, lastLogin: '1 day ago', sessionsAttended: 16, totalSessions: 20, evidenceSubmitted: 10, evidenceTarget: 14, otjhHours: 138, otjhTarget: 180, clubActivity: 7, messageResponse: 88, trend: 'up', riskLevel: 'green' },
];

const ENGAGEMENT_BREAKDOWN = [
  { label: 'Session Attendance', weight: 30, avg: 82 },
  { label: 'Evidence Submission', weight: 25, avg: 68 },
  { label: 'OTJH Progress', weight: 20, avg: 72 },
  { label: 'Club Activity', weight: 10, avg: 45 },
  { label: 'Message Response', weight: 10, avg: 78 },
  { label: 'Last Login Recency', weight: 5, avg: 85 },
];

export default function LearnerEngagementPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<'all' | 'green' | 'amber' | 'red'>('all');
  const filtered = LEARNERS.filter(l => {
    const matchSearch = l.name.toLowerCase().includes(search.toLowerCase()) || l.programme.toLowerCase().includes(search.toLowerCase());
    const matchRisk = riskFilter === 'all' || l.riskLevel === riskFilter;
    return matchSearch && matchRisk;
  });
  const greenCount = LEARNERS.filter(l => l.riskLevel === 'green').length;
  const amberCount = LEARNERS.filter(l => l.riskLevel === 'amber').length;
  const redCount = LEARNERS.filter(l => l.riskLevel === 'red').length;
  const avgScore = Math.round(LEARNERS.reduce((s, l) => s + l.engagementScore, 0) / LEARNERS.length);

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Learner Engagement" pageSubtitle="Monitor engagement scores, participation metrics, and interaction patterns across all learners"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Learner Engagement Analytics"
          description={`Average engagement score: ${avgScore}%. ${greenCount} learners green, ${amberCount} amber, ${redCount} red risk. Monitor 6 engagement dimensions across all active learners.`}
          icon="ri-heart-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20apprentice%20learners%20engaged%20in%20collaborative%20learning%20workshop%20modern%20professional%20setting%20warm%20lighting&width=400&height=160&seq=engagement-learner-01&orientation=landscape"
          imageAlt="Learner Engagement"
          stats={[{ label: 'Avg Score', value: `${avgScore}%` }, { label: 'At Risk', value: String(amberCount + redCount), variant: 'danger' }, { label: 'Active', value: String(greenCount) }]}
        />

        {/* Related Pages Navigation */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/attendance-risk')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-alert-line text-sm"></i> Attendance Risk
          </button>
          <button onClick={() => navigate('/engagement/call-logs')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-phone-line text-sm"></i> Call Logs
          </button>
          <button onClick={() => navigate('/engagement/catchup-overdue')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-timer-line text-sm"></i> Catch-up Overdue
          </button>
          <button onClick={() => navigate('/engagement/communication')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-message-2-line text-sm"></i> Communication
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" placeholder="Search learners..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1">
            {(['all', 'green', 'amber', 'red'] as const).map(f => (
              <button key={f} onClick={() => setRiskFilter(f)} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${riskFilter === f ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {f === 'all' ? 'All' : f === 'green' ? 'Green' : f === 'amber' ? 'Amber' : 'Red'}
              </button>
            ))}
          </div>
        </div>

        {/* Engagement Breakdown */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Engagement Score Breakdown</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ENGAGEMENT_BREAKDOWN.map(dim => (
              <div key={dim.label} className="bg-background-100/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium text-foreground-700">{dim.label}</span>
                  <span className="text-[10px] text-foreground-400">{dim.weight}%</span>
                </div>
                <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${dim.avg >= 80 ? 'bg-emerald-500' : dim.avg >= 60 ? 'bg-primary-500' : 'bg-amber-500'}`} style={{ width: `${dim.avg}%` }}></div>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-foreground-400">Average</span>
                  <span className={`text-[10px] font-bold ${dim.avg >= 80 ? 'text-emerald-600' : dim.avg >= 60 ? 'text-primary-600' : 'text-amber-600'}`}>{dim.avg}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Learner List */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center justify-between">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Learner Engagement Scores</h3>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} learners</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(learner => (
              <div key={learner.id} className={`p-4 flex flex-col sm:flex-row sm:items-center gap-4 ${learner.riskLevel === 'red' ? 'bg-red-50/20' : learner.riskLevel === 'amber' ? 'bg-amber-50/20' : ''}`}>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${learner.riskLevel === 'red' ? 'bg-red-100 text-red-700' : learner.riskLevel === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{learner.name.charAt(0)}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground-900">{learner.name}</p>
                    <p className="text-[10px] text-foreground-400">{learner.programme} &middot; {learner.cohort}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] shrink-0 flex-wrap">
                  <div className="flex items-center gap-1">
                    <span className="text-foreground-400">Score:</span>
                    <span className={`font-bold text-sm ${learner.engagementScore >= 70 ? 'text-emerald-600' : learner.engagementScore >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{learner.engagementScore}%</span>
                  </div>
                  <span className="text-foreground-400">Att: {learner.sessionsAttended}/{learner.totalSessions}</span>
                  <span className="text-foreground-400">Evd: {learner.evidenceSubmitted}/{learner.evidenceTarget}</span>
                  <span className="text-foreground-400">OTJH: {learner.otjhHours}h</span>
                  <span className="text-foreground-400">{learner.lastLogin}</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${learner.riskLevel === 'red' ? 'bg-red-100 text-red-700' : learner.riskLevel === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{learner.riskLevel.toUpperCase()}</span>
                  <span className={`text-[10px] font-medium ${learner.trend === 'up' ? 'text-emerald-600' : learner.trend === 'down' ? 'text-red-600' : 'text-foreground-400'}`}>
                    <i className={`${learner.trend === 'up' ? 'ri-arrow-up-line' : learner.trend === 'down' ? 'ri-arrow-down-line' : 'ri-subtract-line'} mr-0.5`}></i>
                    {learner.trend}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}