import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const INTEGRATIONS = [
  { id: 'i1', name: 'Aptem', category: 'LMS', status: 'connected' as const, lastSync: '10 Jun 2026, 06:00', nextSync: '11 Jun 2026, 06:00', syncFreq: 'Daily', health: 98, description: 'Learner management system integration for enrolment and progression data sync.', endpoints: ['Enrolments', 'Progress Reviews', 'ILR Data'] },
  { id: 'i2', name: 'DAS (Digital Apprenticeship Service)', category: 'Funding', status: 'connected' as const, lastSync: '10 Jun 2026, 04:00', nextSync: '10 Jun 2026, 16:00', syncFreq: 'Twice daily', health: 100, description: 'ESFA funding and apprenticeship commitment management.', endpoints: ['Commitments', 'Payments', 'Data Lock'] },
  { id: 'i3', name: 'Microsoft Teams', category: 'Communication', status: 'connected' as const, lastSync: 'Real-time', nextSync: 'Real-time', syncFreq: 'Real-time', health: 100, description: 'Video conferencing and session scheduling integration.', endpoints: ['Calendar Sync', 'Session Links', 'Attendance'] },
  { id: 'i4', name: 'SMTP Email Service', category: 'Communication', status: 'connected' as const, lastSync: '10 Jun 2026, 13:45', nextSync: 'On demand', syncFreq: 'On demand', health: 100, description: 'Transactional and bulk email delivery via SMTP relay.', endpoints: ['Send Mail', 'Track Opens', 'Bounce Handling'] },
  { id: 'i5', name: 'WhatsApp Business API', category: 'Communication', status: 'connected' as const, lastSync: '10 Jun 2026, 14:30', nextSync: 'On demand', syncFreq: 'On demand', health: 96, description: 'Engagement messaging and absence follow-up via WhatsApp.', endpoints: ['Send Message', 'Message Status', 'Templates'] },
  { id: 'i6', name: 'Zapier', category: 'Automation', status: 'disconnected' as const, lastSync: 'Never', nextSync: '-', syncFreq: 'Event-driven', health: 0, description: 'Third-party automation and webhook connections.', endpoints: ['Webhooks', 'Actions', 'Triggers'] },
  { id: 'i7', name: 'Slack', category: 'Communication', status: 'disconnected' as const, lastSync: 'Never', nextSync: '-', syncFreq: 'Real-time', health: 0, description: 'Team notifications and alerts channel integration.', endpoints: ['Channel Post', 'Direct Message', 'Bot Commands'] },
  { id: 'i8', name: 'Google Calendar', category: 'Calendar', status: 'connected' as const, lastSync: '10 Jun 2026, 10:00', nextSync: 'Real-time', syncFreq: 'Real-time', health: 100, description: 'Coach and tutor calendar synchronisation for session scheduling.', endpoints: ['Calendar Read', 'Event Create', 'Availability'] },
  { id: 'i9', name: 'Ofsted Portal', category: 'Compliance', status: 'connected' as const, lastSync: '1 Apr 2026, 00:00', nextSync: '1 Jul 2026, 00:00', syncFreq: 'Quarterly', health: 100, description: 'Evidence pack submission and compliance status sync.', endpoints: ['Evidence Pack', 'SAR Upload', 'QIP Update'] },
  { id: 'i10', name: 'Stripe', category: 'Payment', status: 'disconnected' as const, lastSync: 'Never', nextSync: '-', syncFreq: 'On demand', health: 0, description: 'Employer invoicing and payment processing.', endpoints: ['Invoices', 'Payments', 'Subscriptions'] },
];

export default function AdminIntegrationsPage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(null);

  const connectedCount = INTEGRATIONS.filter(i => i.status === 'connected').length;
  const disconnectedCount = INTEGRATIONS.filter(i => i.status === 'disconnected').length;
  const avgHealth = Math.round(INTEGRATIONS.filter(i => i.status === 'connected').reduce((a, b) => a + b.health, 0) / connectedCount);

  const filtered = INTEGRATIONS.filter(i => {
    const matchSearch = i.name.toLowerCase().includes(search.toLowerCase()) || i.description.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === 'all' || i.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  const integration = selectedIntegration ? INTEGRATIONS.find(i => i.id === selectedIntegration) : null;

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Integrations" pageSubtitle="Third-party connectors, API keys, and webhook management" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-plug-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Integration Hub</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{INTEGRATIONS.length} integrations</strong> — {connectedCount} connected, {disconnectedCount} disconnected. {avgHealth}% average health.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{connectedCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Connected</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{disconnectedCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Disconnected</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{avgHealth}%</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Health</p>
              </div>
            </div>
          </div>
        </div>

        {/* Health Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {INTEGRATIONS.filter(i => i.status === 'connected').map(i => (
            <div key={i.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-foreground-600 truncate">{i.name}</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-background-200 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${i.health}%` }}></div>
                </div>
                <span className="text-[10px] font-semibold text-foreground-600">{i.health}%</span>
              </div>
              <p className="text-[10px] text-foreground-400 mt-1">{i.lastSync}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 w-full lg:w-auto">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
            <input type="text" placeholder="Search integrations..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
          </div>
          <div className="flex items-center gap-2">
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Categories</option>
              <option value="LMS">LMS</option>
              <option value="Funding">Funding</option>
              <option value="Communication">Communication</option>
              <option value="Automation">Automation</option>
              <option value="Calendar">Calendar</option>
              <option value="Compliance">Compliance</option>
              <option value="Payment">Payment</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Integrations List */}
          <div className="lg:col-span-2 space-y-3">
            {filtered.map(i => {
              const statusColors = {
                connected: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
                disconnected: 'bg-background-100 text-foreground-500 border-foreground-200/60',
                error: 'bg-red-50 text-red-700 border-red-200/50',
              };
              const categoryIcons: Record<string, string> = {
                LMS: 'ri-book-2-line', Funding: 'ri-money-pound-circle-line', Communication: 'ri-chat-1-line',
                Automation: 'ri-settings-4-line', Calendar: 'ri-calendar-line', Compliance: 'ri-shield-check-line', Payment: 'ri-bank-card-line',
              };
              return (
                <div key={i.id} onClick={() => setSelectedIntegration(i.id)} className={`flex items-center gap-4 bg-background-50 rounded-xl border p-4 cursor-pointer transition-smooth ${selectedIntegration === i.id ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60 hover:border-background-300/60'}`}>
                  <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
                    <i className={`${categoryIcons[i.category] || 'ri-plug-line'} text-primary-600 text-lg`}></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground-900">{i.name}</p>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700 border border-secondary-200/50">{i.category}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColors[i.status]}`}>{i.status}</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5 line-clamp-1">{i.description}</p>
                  </div>
                  <div className="text-[12px] text-foreground-500 shrink-0 text-right">
                    <p>{i.syncFreq}</p>
                    <p className="text-[10px] text-foreground-400">{i.lastSync}</p>
                  </div>
                  <i className={`ri-arrow-right-s-line text-foreground-300 ${selectedIntegration === i.id ? 'text-primary-500' : ''}`}></i>
                </div>
              );
            })}
          </div>

          {/* Integration Detail */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 h-fit">
            {integration ? (
              <div className="space-y-5">
                <div>
                  <div className="w-14 h-14 rounded-xl bg-primary-100 flex items-center justify-center mb-3">
                    <i className="ri-plug-line text-primary-600 text-2xl"></i>
                  </div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{integration.name}</h3>
                  <p className="text-[12px] text-foreground-500 mt-1">{integration.category}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{integration.health}%</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Health</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{integration.endpoints.length}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Endpoints</p>
                  </div>
                </div>
                <div>
                  <h4 className="text-[12px] font-semibold text-foreground-700 mb-2">API Endpoints</h4>
                  <div className="space-y-1">
                    {integration.endpoints.map(ep => (
                      <div key={ep} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-background-100 text-[12px] text-foreground-600">
                        <i className="ri-link text-foreground-400 text-xs"></i>
                        {ep}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t border-foreground-200/60">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Last Sync</span>
                    <span className="text-foreground-700 font-medium">{integration.lastSync}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Next Sync</span>
                    <span className="text-foreground-700 font-medium">{integration.nextSync}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Frequency</span>
                    <span className="text-foreground-700 font-medium">{integration.syncFreq}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className={`flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${integration.status === 'connected' ? 'bg-accent-500 text-white hover:bg-accent-600' : 'bg-primary-500 text-white hover:bg-primary-600'}`}>
                    {integration.status === 'connected' ? 'Disconnect' : 'Connect'}
                  </button>
                  <button className="flex-1 px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">Configure</button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <i className="ri-plug-line text-foreground-300 text-xl"></i>
                </div>
                <p className="text-sm text-foreground-500">Select an integration to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}