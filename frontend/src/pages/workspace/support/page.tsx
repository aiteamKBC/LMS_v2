import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const supportConfig = roleNavMap.support;

const TICKET_STATS = [
  { label: 'Open Tickets', value: '47', icon: 'ri-ticket-line', change: '+8 today', trend: 'up', colour: 'red' },
  { label: 'In Progress', value: '23', icon: 'ri-loader-4-line', change: '12 unassigned', trend: 'neutral', colour: 'amber' },
  { label: 'Resolved (7d)', value: '142', icon: 'ri-check-double-line', change: '+18%', trend: 'up', colour: 'emerald' },
  { label: 'Avg Response', value: '38m', icon: 'ri-timer-line', change: '-4m', trend: 'down-good', colour: 'emerald' },
  { label: 'Escalated', value: '6', icon: 'ri-alert-line', change: '2 urgent', trend: 'neutral', colour: 'red' },
  { label: 'SLA Breach Risk', value: '5', icon: 'ri-error-warning-line', change: 'within 2h', trend: 'up-bad', colour: 'amber' },
];

const RECENT_TICKETS = [
  { id: 'TKT-0892', subject: 'Learner unable to submit evidence — file upload failing', requester: 'Emily Watson', role: 'Learner', tenant: 'KBC', priority: 'high', status: 'open', category: 'Technical', assignedTo: 'Ahmed Khalil', created: '10 Jun 2026 14:22', sla: '1h 38m' },
  { id: 'TKT-0891', subject: 'Coach dashboard not showing updated caseload after allocation', requester: 'Sarah Thompson', role: 'Coach', tenant: 'KBC', priority: 'high', status: 'in-progress', category: 'Bug Report', assignedTo: 'Layla Moussa', created: '10 Jun 2026 12:45', sla: '3h 15m' },
  { id: 'TKT-0890', subject: 'Employer unable to sign training plan — DocuSign error', requester: 'Mark Johnson (KCC)', role: 'Employer', tenant: 'KBC', priority: 'urgent', status: 'open', category: 'Integration', assignedTo: '—', created: '10 Jun 2026 11:08', sla: '15m' },
  { id: 'TKT-0889', subject: 'OTJH hours not accumulating correctly for Cohort B learners', requester: 'James Okonkwo', role: 'Learner', tenant: 'KBC', priority: 'medium', status: 'in-progress', category: 'Data Issue', assignedTo: 'Ahmed Khalil', created: '10 Jun 2026 09:30', sla: '5h 30m' },
  { id: 'TKT-0888', subject: 'QA sampling report not generating for April cohort', requester: 'Priya Patel', role: 'QA Officer', tenant: 'LSA', priority: 'medium', status: 'open', category: 'Reporting', assignedTo: '—', created: '10 Jun 2026 08:15', sla: '6h 45m' },
  { id: 'TKT-0887', subject: 'New tenant onboarding — programme template missing', requester: 'Admin Team', role: 'Super Admin', tenant: 'MAN', priority: 'low', status: 'resolved', category: 'Onboarding', assignedTo: 'Layla Moussa', created: '9 Jun 2026 16:40', sla: 'Resolved' },
  { id: 'TKT-0886', subject: 'WhatsApp notification templates not sending to Learner app', requester: 'Engagement Team', role: 'Engagement Manager', tenant: 'KBC', priority: 'medium', status: 'in-progress', category: 'Notifications', assignedTo: 'Ahmed Khalil', created: '9 Jun 2026 14:10', sla: '20h 50m' },
  { id: 'TKT-0885', subject: 'Complaint: AI marking incorrectly rejected valid evidence', requester: 'Rachel Okafor', role: 'Learner', tenant: 'MAN', priority: 'high', status: 'escalated', category: 'Complaint', assignedTo: 'Layla Moussa', created: '9 Jun 2026 10:55', sla: 'Escalated' },
];

const CATEGORY_BREAKDOWN = [
  { category: 'Technical', count: 18, pct: 26, color: 'bg-red-500' },
  { category: 'Bug Report', count: 14, pct: 20, color: 'bg-amber-500' },
  { category: 'Data Issue', count: 10, pct: 14, color: 'bg-orange-500' },
  { category: 'Complaint', count: 8, pct: 11, color: 'bg-red-400' },
  { category: 'Integration', count: 7, pct: 10, color: 'bg-primary-500' },
  { category: 'Reporting', count: 5, pct: 7, color: 'bg-secondary-500' },
  { category: 'Onboarding', count: 4, pct: 6, color: 'bg-accent-500' },
  { category: 'Notifications', count: 4, pct: 6, color: 'bg-emerald-500' },
];

const SUPPORT_TEAM = [
  { name: 'Ahmed Khalil', role: 'Senior Support Lead', tickets: 18, resolved7d: 47, avatar: 'AK' },
  { name: 'Layla Moussa', role: 'Support Specialist', tickets: 15, resolved7d: 52, avatar: 'LM' },
  { name: 'David Osei', role: 'Support Analyst', tickets: 12, resolved7d: 38, avatar: 'DO' },
  { name: 'Nadia Hussain', role: 'Complaints Handler', tickets: 8, resolved7d: 31, avatar: 'NH' },
];

export default function SupportDashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'queue' | 'team'>('overview');

  return (
    <WorkspaceShell
      role="support"
      roleLabel={supportConfig.label}
      navItems={supportConfig.items}
      pageTitle="Support Centre"
      pageSubtitle="Ticket management, complaints, and technical support across all tenants"
      userName="Ahmed Khalil"
      userRole="Senior Support Lead"
      workspaceLabel={supportConfig.workspaceLabel}
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {/* Hero Banner */}
        <WorkspaceHeroBanner
          title="Support Centre"
          description="Centralised ticket management, complaint handling, and technical support for all tenants, users, and integrations"
          icon="ri-customer-service-2-line"
          imageUrl="https://readdy.ai/api/search_image?width=400&height=160&seq=support-hero-2026&orientation=landscape&query=Modern professional customer support helpdesk workspace with warm ambient lighting, clean desk with dual monitors displaying ticket dashboards, soft green and teal accent tones, collaborative open-plan office environment, UK corporate aesthetic, professional editorial photography with natural light and minimal styling"
          imageAlt="Support Centre"
          stats={[
            { label: 'Open Tickets', value: '47', variant: 'danger' },
            { label: 'Resolved (7d)', value: '142', variant: 'success' },
            { label: 'Avg Response', value: '38m' },
          ]}
        />

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {TICKET_STATS.map(stat => (
            <div key={stat.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4">
              <span className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2 ${
                stat.colour === 'red' ? 'bg-red-50 text-red-600' :
                stat.colour === 'amber' ? 'bg-amber-50 text-amber-600' :
                'bg-emerald-50 text-emerald-600'
              }`}>
                <i className={`${stat.icon} text-xs`}></i>
              </span>
              <p className="text-xl md:text-2xl font-heading font-semibold text-foreground-900">{stat.value}</p>
              <p className="text-[10px] text-foreground-400 mt-1">{stat.label}</p>
              <p className={`text-[10px] font-medium mt-0.5 ${
                stat.trend === 'up' ? 'text-emerald-600' : stat.trend === 'up-bad' ? 'text-red-600' : stat.trend === 'down-good' ? 'text-emerald-600' : 'text-foreground-500'
              }`}>{stat.change}</p>
            </div>
          ))}
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 bg-background-100 rounded-full p-1 w-fit">
          {(['overview', 'queue', 'team'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-smooth whitespace-nowrap cursor-pointer ${
                activeTab === tab ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              {tab === 'overview' ? 'Overview' : tab === 'queue' ? 'Ticket Queue' : 'Support Team'}
            </button>
          ))}
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Main — Ticket Cards */}
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">
                {activeTab === 'queue' ? 'All Open Tickets' : 'Recent Tickets'}
              </h3>
              <div className="flex items-center gap-2">
                <select className="text-[11px] border border-background-200 rounded-lg px-2.5 py-1.5 bg-background-50 text-foreground-600 cursor-pointer">
                  <option>All Priorities</option>
                  <option>Urgent</option>
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
                <select className="text-[11px] border border-background-200 rounded-lg px-2.5 py-1.5 bg-background-50 text-foreground-600 cursor-pointer">
                  <option>All Categories</option>
                  <option>Technical</option>
                  <option>Bug Report</option>
                  <option>Complaint</option>
                  <option>Integration</option>
                </select>
              </div>
            </div>

            {RECENT_TICKETS.map(ticket => (
              <a key={ticket.id} href="/support/ticket-queue" className="block bg-background-50 rounded-xl border border-foreground-200/60 p-4 hover:border-background-300/60 transition-smooth cursor-pointer group">
                <div className="flex items-start gap-3">
                  {/* Priority indicator */}
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                    ticket.priority === 'urgent' ? 'bg-red-500 animate-pulse' : ticket.priority === 'high' ? 'bg-amber-500' : ticket.priority === 'medium' ? 'bg-blue-400' : 'bg-foreground-300'
                  }`}></div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-foreground-800 truncate">{ticket.subject}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-[10px] font-mono text-foreground-400">{ticket.id}</span>
                          <span className="text-[10px] text-foreground-300">·</span>
                          <span className="text-[10px] text-foreground-500">{ticket.requester}</span>
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                            ticket.role === 'Learner' ? 'bg-primary-50 text-primary-700' :
                            ticket.role === 'Coach' ? 'bg-emerald-50 text-emerald-700' :
                            ticket.role === 'Employer' ? 'bg-accent-50 text-accent-700' :
                            ticket.role === 'Super Admin' ? 'bg-red-50 text-red-700' :
                            'bg-secondary-50 text-secondary-700'
                          }`}>{ticket.role}</span>
                          <span className="text-[10px] text-foreground-300">·</span>
                          <span className="text-[10px] text-foreground-500">{ticket.tenant}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                          ticket.status === 'open' ? 'bg-red-50 text-red-700 border border-red-200/50' :
                          ticket.status === 'in-progress' ? 'bg-amber-50 text-amber-700 border border-amber-200/50' :
                          ticket.status === 'escalated' ? 'bg-red-100 text-red-800 border border-red-300/50' :
                          'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                        }`}>{ticket.status === 'in-progress' ? 'In Progress' : ticket.status === 'open' ? 'Open' : ticket.status === 'escalated' ? 'Escalated' : 'Resolved'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-background-100">
                      <span className="text-[10px] text-foreground-400 flex items-center gap-1">
                        <i className="ri-price-tag-3-line text-[9px]"></i> {ticket.category}
                      </span>
                      <span className="text-[10px] text-foreground-400 flex items-center gap-1">
                        <i className="ri-user-line text-[9px]"></i> {ticket.assignedTo === '—' ? 'Unassigned' : ticket.assignedTo}
                      </span>
                      <span className="text-[10px] text-foreground-400 flex items-center gap-1">
                        <i className="ri-time-line text-[9px]"></i> {ticket.sla}
                      </span>
                      <span className="text-[10px] text-foreground-300 ml-auto">{ticket.created}</span>
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Category Breakdown */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Categories</h3>
              <div className="space-y-2.5">
                {CATEGORY_BREAKDOWN.map(cat => (
                  <div key={cat.category}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] text-foreground-700">{cat.category}</span>
                      <span className="text-[10px] font-medium text-foreground-500">{cat.count} ({cat.pct}%)</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-background-100 overflow-hidden">
                      <div className={`h-full rounded-full ${cat.color}`} style={{ width: `${cat.pct}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Support Team */}
            {activeTab === 'team' && (
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Support Team</h3>
                <div className="space-y-3">
                  {SUPPORT_TEAM.map(member => (
                    <div key={member.name} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-background-100/60 transition-smooth cursor-pointer">
                      <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                        <span className="text-primary-700 text-[10px] font-bold">{member.avatar}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-foreground-800">{member.name}</p>
                        <p className="text-[10px] text-foreground-400">{member.role}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] font-semibold text-foreground-700">{member.tickets}</p>
                        <p className="text-[10px] text-foreground-400">active</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Actions */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Quick Actions</h3>
              <div className="space-y-1.5">
                {[
                  { label: 'Create Ticket', icon: 'ri-add-line', href: '/support/ticket-queue' },
                  { label: 'View Escalations', icon: 'ri-alert-line', href: '/support/escalations' },
                  { label: 'Resolved Today', icon: 'ri-check-double-line', href: '/support/resolved' },
                  { label: 'SLA Report', icon: 'ri-bar-chart-2-line', href: '/support/reports' },
                ].map(action => (
                  <a key={action.label} href={action.href} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer">
                    <i className={`${action.icon} text-foreground-400`}></i>
                    {action.label}
                  </a>
                ))}
              </div>
            </div>

            {/* Tenant Distribution */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Tickets by Tenant</h3>
              <div className="space-y-2.5">
                {[
                  { name: 'KBC', count: 28, pct: 52 },
                  { name: 'MAN', count: 12, pct: 22 },
                  { name: 'LSA', count: 8, pct: 15 },
                  { name: 'DEMO', count: 4, pct: 7 },
                  { name: 'BHX', count: 2, pct: 4 },
                ].map(t => (
                  <div key={t.name} className="flex items-center gap-2">
                    <span className="text-[11px] text-foreground-600 w-10">{t.name}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-background-100 overflow-hidden">
                      <div className="h-full rounded-full bg-primary-400" style={{ width: `${t.pct}%` }}></div>
                    </div>
                    <span className="text-[10px] text-foreground-400 w-12 text-right">{t.count} ({t.pct}%)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}