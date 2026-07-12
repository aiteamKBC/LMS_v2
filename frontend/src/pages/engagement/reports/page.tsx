import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const engagementNav = roleNavMap.engagement;

interface Report {
  id: string;
  name: string;
  description: string;
  type: 'dashboard' | 'summary' | 'detailed' | 'export';
  category: string;
  lastGenerated: string;
  frequency: string;
  audience: string;
  format: string;
  size: string;
}

const REPORTS: Report[] = [
  { id: 'rep-01', name: 'Engagement Scoreboard', description: 'Overall engagement scores across all learners with risk categorization', type: 'dashboard', category: 'Overview', lastGenerated: 'Today', frequency: 'Daily', audience: 'Engagement Team', format: 'Interactive', size: 'N/A' },
  { id: 'rep-02', name: 'Attendance Risk Report', description: 'Detailed attendance analysis with intervention recommendations', type: 'detailed', category: 'Risk', lastGenerated: 'Today', frequency: 'Daily', audience: 'Coaches & Managers', format: 'PDF', size: '2.4 MB' },
  { id: 'rep-03', name: 'Weekly Absence Summary', description: 'Summary of all absences, approvals, and unreported cases', type: 'summary', category: 'Attendance', lastGenerated: 'Yesterday', frequency: 'Weekly', audience: 'Engagement Team', format: 'PDF', size: '1.8 MB' },
  { id: 'rep-04', name: 'Catch-up Recovery Report', description: 'Track catch-up session completion and hours recovered', type: 'detailed', category: 'Attendance', lastGenerated: 'Yesterday', frequency: 'Weekly', audience: 'Coaches', format: 'Excel', size: '3.2 MB' },
  { id: 'rep-05', name: 'Communication Analytics', description: 'Email, WhatsApp, and call log analytics with response rates', type: 'dashboard', category: 'Communication', lastGenerated: '8 Jun 2026', frequency: 'Weekly', audience: 'Engagement Team', format: 'Interactive', size: 'N/A' },
  { id: 'rep-06', name: 'Employer Escalation Report', description: 'Status of all employer escalations and resolutions', type: 'detailed', category: 'Employer', lastGenerated: '8 Jun 2026', frequency: 'Weekly', audience: 'Senior Leadership', format: 'PDF', size: '1.1 MB' },
  { id: 'rep-07', name: 'Points & Rewards Summary', description: 'Points awarded, redeemed, and voucher claims overview', type: 'summary', category: 'Rewards', lastGenerated: '7 Jun 2026', frequency: 'Monthly', audience: 'Engagement Team', format: 'PDF', size: '2.6 MB' },
  { id: 'rep-08', name: 'Club Activity Report', description: 'Membership, attendance, and contributions across all clubs', type: 'detailed', category: 'Clubs', lastGenerated: '7 Jun 2026', frequency: 'Monthly', audience: 'Ambassadors', format: 'Excel', size: '4.1 MB' },
  { id: 'rep-09', name: 'Event Attendance Report', description: 'Registration, attendance, and feedback for all events', type: 'detailed', category: 'Events', lastGenerated: '6 Jun 2026', frequency: 'Per event', audience: 'Engagement Team', format: 'PDF', size: '1.5 MB' },
  { id: 'rep-10', name: 'Regional Distribution Report', description: 'Learner and club distribution across UK regions', type: 'dashboard', category: 'Overview', lastGenerated: '5 Jun 2026', frequency: 'Monthly', audience: 'Senior Leadership', format: 'Interactive', size: 'N/A' },
  { id: 'rep-11', name: 'Quarterly Engagement Review', description: 'Comprehensive quarterly review for board presentation', type: 'summary', category: 'Overview', lastGenerated: '1 Jun 2026', frequency: 'Quarterly', audience: 'Board', format: 'PDF', size: '5.8 MB' },
  { id: 'rep-12', name: 'ILR-ready Export', description: 'Export engagement data for ILR and funding compliance', type: 'export', category: 'Compliance', lastGenerated: '1 Jun 2026', frequency: 'Monthly', audience: 'Compliance Team', format: 'CSV', size: '8.2 MB' },
];

const typeConfig: Record<string, { icon: string; bg: string; text: string }> = {
  dashboard: { icon: 'ri-dashboard-line', bg: 'bg-primary-100', text: 'text-primary-700' },
  summary: { icon: 'ri-file-list-line', bg: 'bg-secondary-100', text: 'text-secondary-700' },
  detailed: { icon: 'ri-file-chart-line', bg: 'bg-accent-100', text: 'text-accent-700' },
  export: { icon: 'ri-download-line', bg: 'bg-emerald-100', text: 'text-emerald-700' },
};

export default function EngagementReportsPage() {
  const navigate = useNavigate();
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const filtered = REPORTS.filter(r => {
    const matchCat = categoryFilter === 'all' || r.category === categoryFilter;
    const matchType = typeFilter === 'all' || r.type === typeFilter;
    return matchCat && matchType;
  });

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Engagement Reports" pageSubtitle="Generate comprehensive engagement reports for management review"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Engagement Reports"
          description={`${REPORTS.length} reports available. ${REPORTS.filter(r => r.type === 'dashboard').length} interactive dashboards, ${REPORTS.filter(r => r.type === 'export').length} export formats. Generate, schedule, and distribute reports across the organisation.`}
          icon="ri-bar-chart-box-line"
          imageUrl="https://readdy.ai/api/search-image?query=professional%20reports%20analytics%20dashboard%20modern%20workspace%20warm%20lighting%20data%20visualization&width=400&height=160&seq=reports-01&orientation=landscape"
          imageAlt="Engagement Reports"
          stats={[{ label: 'Reports', value: String(REPORTS.length) }, { label: 'Dashboards', value: String(REPORTS.filter(r => r.type === 'dashboard').length) }, { label: 'Exports', value: String(REPORTS.filter(r => r.type === 'export').length) }]}
        />

        {/* Quick access */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/workspace/engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-dashboard-line text-sm"></i> Dashboard
          </button>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-heart-line text-sm"></i> Learner Engagement
          </button>
          <button onClick={() => navigate('/engagement/attendance-risk')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-alert-line text-sm"></i> Attendance Risk
          </button>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {['all', 'Overview', 'Risk', 'Attendance', 'Communication', 'Employer', 'Rewards', 'Clubs', 'Events', 'Compliance'].map(cat => (
              <button key={cat} onClick={() => setCategoryFilter(cat)} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${categoryFilter === cat ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {['all', 'dashboard', 'summary', 'detailed', 'export'].map(t => (
              <button key={t} onClick={() => setTypeFilter(t)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${typeFilter === t ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                <i className={`${t === 'all' ? 'ri-list-check' : typeConfig[t]?.icon || 'ri-file-line'} text-sm`}></i>
                {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center justify-between">
            <span className="text-sm font-heading font-semibold text-foreground-900">Available Reports</span>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} reports</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(report => {
              const cfg = typeConfig[report.type] || { icon: 'ri-file-line', bg: 'bg-background-100', text: 'text-foreground-500' };
              return (
                <div key={report.id} className="p-4 flex items-center gap-4">
                  <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${cfg.bg} ${cfg.text}`}>
                    <i className={`${cfg.icon} text-sm`}></i>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[13px] font-semibold text-foreground-900">{report.name}</span>
                      <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{report.category}</span>
                    </div>
                    <p className="text-[11px] text-foreground-500">{report.description}</p>
                    <div className="flex items-center gap-3 text-[10px] text-foreground-400 mt-1">
                      <span>Frequency: {report.frequency}</span>
                      <span>Audience: {report.audience}</span>
                      <span>Format: {report.format}</span>
                      <span>Size: {report.size}</span>
                      <span>Last: {report.lastGenerated}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                      <i className="ri-play-line mr-1"></i> Generate
                    </button>
                    {report.type !== 'dashboard' && (
                      <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap">
                        <i className="ri-download-line mr-1"></i> Download
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}