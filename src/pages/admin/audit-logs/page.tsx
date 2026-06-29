import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const AUDIT_LOGS = [
  { id: 'al1', user: 'Admin User', action: 'User Role Updated', target: 'Sophie Williams', targetType: 'user', timestamp: '10 Jun 2026, 13:45', ip: '192.168.1.45', status: 'success' as const },
  { id: 'al2', user: 'Admin User', action: 'Tenant Setting Changed', target: 'Branding Primary Colour', targetType: 'setting', timestamp: '10 Jun 2026, 12:30', ip: '192.168.1.45', status: 'success' as const },
  { id: 'al3', user: 'Med Maher', action: 'Evidence Validated', target: 'Evidence #1245', targetType: 'evidence', timestamp: '10 Jun 2026, 11:20', ip: '192.168.1.62', status: 'success' as const },
  { id: 'al4', user: 'Crispin Jones', action: 'Assignment Created', target: 'Data Cleaning Module', targetType: 'assignment', timestamp: '10 Jun 2026, 10:15', ip: '192.168.1.78', status: 'success' as const },
  { id: 'al5', user: 'Sarah Mitchell', action: 'Progress Review Signed', target: 'James Okonkwo — May Review', targetType: 'review', timestamp: '10 Jun 2026, 09:50', ip: '192.168.1.33', status: 'success' as const },
  { id: 'al6', user: 'System', action: 'Automated Monthly Cycle', target: 'June Checklist', targetType: 'automation', timestamp: '10 Jun 2026, 00:00', ip: '127.0.0.1', status: 'success' as const },
  { id: 'al7', user: 'Admin User', action: 'New Form Published', target: 'Absence Report Form', targetType: 'form', timestamp: '9 Jun 2026, 16:00', ip: '192.168.1.45', status: 'success' as const },
  { id: 'al8', user: 'Engagement Bot', action: 'Attendance Alert Sent', target: 'Aisha Patel', targetType: 'notification', timestamp: '9 Jun 2026, 14:30', ip: '10.0.0.5', status: 'success' as const },
  { id: 'al9', user: 'Lauren Mitchell', action: 'Employer Confirmation', target: 'OTJH May 2026', targetType: 'confirmation', timestamp: '9 Jun 2026, 11:00', ip: '192.168.1.90', status: 'success' as const },
  { id: 'al10', user: 'QA Officer', action: 'Evidence Rejected', target: 'Evidence #1241', targetType: 'evidence', timestamp: '9 Jun 2026, 10:45', ip: '192.168.1.55', status: 'warning' as const },
  { id: 'al11', user: 'System', action: 'Failed Login Attempt', target: 'david.chen@kbc.ac.uk', targetType: 'security', timestamp: '9 Jun 2026, 08:12', ip: '203.45.67.89', status: 'failed' as const },
  { id: 'al12', user: 'Admin User', action: 'User Deactivated', target: 'Liam Foster', targetType: 'user', timestamp: '8 Jun 2026, 15:30', ip: '192.168.1.45', status: 'success' as const },
  { id: 'al13', user: 'Rebecca Okonkwo', action: 'Club Event Created', target: 'Brand Strategy Workshop', targetType: 'event', timestamp: '8 Jun 2026, 13:00', ip: '192.168.1.91', status: 'success' as const },
  { id: 'al14', user: 'System', action: 'ILR Export Generated', target: 'ILR_2026_June.xml', targetType: 'export', timestamp: '8 Jun 2026, 02:00', ip: '127.0.0.1', status: 'success' as const },
  { id: 'al15', user: 'Admin User', action: 'Permission Changed', target: 'Coach Role — Validate Evidence', targetType: 'permission', timestamp: '7 Jun 2026, 11:20', ip: '192.168.1.45', status: 'success' as const },
  { id: 'al16', user: 'System', action: 'Backup Completed', target: 'Full Tenant Backup', targetType: 'system', timestamp: '7 Jun 2026, 01:00', ip: '127.0.0.1', status: 'success' as const },
  { id: 'al17', user: 'Med Maher', action: 'Catch-up Session Scheduled', target: 'James Okonkwo — 12 Jun', targetType: 'session', timestamp: '6 Jun 2026, 16:00', ip: '192.168.1.62', status: 'success' as const },
  { id: 'al18', user: 'System', action: 'API Rate Limit Exceeded', target: 'Integration: Aptem', targetType: 'integration', timestamp: '6 Jun 2026, 09:30', ip: '10.0.0.3', status: 'warning' as const },
  { id: 'al19', user: 'Admin User', action: 'Template Updated', target: 'Welcome Email v1.6', targetType: 'template', timestamp: '5 Jun 2026, 14:00', ip: '192.168.1.45', status: 'success' as const },
  { id: 'al20', user: 'System', action: 'Data Retention Cleanup', target: '45 records archived', targetType: 'system', timestamp: '5 Jun 2026, 03:00', ip: '127.0.0.1', status: 'success' as const },
];

const ACTION_TYPES = ['all', 'user', 'evidence', 'review', 'setting', 'automation', 'security', 'system', 'notification', 'integration', 'template', 'form', 'permission'];

export default function AdminAuditLogsPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedLog, setSelectedLog] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState('7d');

  const successCount = AUDIT_LOGS.filter(l => l.status === 'success').length;
  const warningCount = AUDIT_LOGS.filter(l => l.status === 'warning').length;
  const failedCount = AUDIT_LOGS.filter(l => l.status === 'failed').length;
  const systemCount = AUDIT_LOGS.filter(l => l.user === 'System').length;

  const filtered = AUDIT_LOGS.filter(l => {
    const matchSearch = l.user.toLowerCase().includes(search.toLowerCase()) || l.action.toLowerCase().includes(search.toLowerCase()) || l.target.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === 'all' || l.targetType === typeFilter;
    const matchStatus = statusFilter === 'all' || l.status === statusFilter;
    return matchSearch && matchType && matchStatus;
  });

  const log = selectedLog ? AUDIT_LOGS.find(l => l.id === selectedLog) : null;

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'success': return 'bg-emerald-50 text-emerald-700 border-emerald-200/50';
      case 'warning': return 'bg-accent-50 text-accent-700 border-accent-200/50';
      case 'failed': return 'bg-red-50 text-red-700 border-red-200/50';
      default: return 'bg-background-100 text-foreground-500';
    }
  };

  const getTypeIcon = (type: string) => {
    const icons: Record<string, string> = {
      user: 'ri-user-line', evidence: 'ri-folder-upload-line', review: 'ri-file-chart-line',
      setting: 'ri-settings-3-line', automation: 'ri-robot-line', security: 'ri-shield-line',
      system: 'ri-server-line', notification: 'ri-notification-3-line', integration: 'ri-plug-line',
      template: 'ri-layout-4-line', form: 'ri-file-text-line', permission: 'ri-key-2-line',
      assignment: 'ri-edit-line', confirmation: 'ri-checkbox-circle-line', event: 'ri-calendar-event-line',
      export: 'ri-download-line', session: 'ri-video-line',
    };
    return icons[type] || 'ri-circle-line';
  };

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Audit Logs" pageSubtitle="Complete audit trail — user actions, system events, and security logs" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-history-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Audit Trail</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{AUDIT_LOGS.length} events</strong> — {successCount} successful, {warningCount} warnings, {failedCount} failed. {systemCount} automated.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{successCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Success</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{warningCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Warnings</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{failedCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Failed</p>
              </div>
            </div>
          </div>
        </div>

        {/* Activity Timeline Chart */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Activity Timeline</h3>
            <div className="flex items-center gap-2">
              {['24h', '7d', '30d', 'All'].map(range => (
                <button key={range} onClick={() => setDateRange(range)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer ${dateRange === range ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:bg-background-200'}`}>
                  {range}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-2 h-28 px-2">
            {[
              { label: '00:00', value: 3 }, { label: '04:00', value: 1 }, { label: '08:00', value: 5 },
              { label: '10:00', value: 7 }, { label: '12:00', value: 4 }, { label: '14:00', value: 6 },
              { label: '16:00', value: 3 }, { label: '18:00', value: 2 }, { label: '20:00', value: 1 }, { label: '22:00', value: 1 },
            ].map((bar, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full bg-primary-100 rounded-t-md relative overflow-hidden" style={{ height: `${bar.value * 12}%` }}>
                  <div className="absolute inset-0 bg-gradient-to-t from-primary-500 to-primary-400"></div>
                </div>
                <span className="text-[9px] text-foreground-400">{bar.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col xl:flex-row items-start xl:items-center gap-3">
          <div className="relative flex-1 w-full xl:w-auto">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
            <input type="text" placeholder="Search audit logs..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Types</option>
              <option value="user">User</option>
              <option value="evidence">Evidence</option>
              <option value="review">Review</option>
              <option value="setting">Setting</option>
              <option value="security">Security</option>
              <option value="system">System</option>
              <option value="integration">Integration</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Status</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
              <option value="failed">Failed</option>
            </select>
            <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-download-line mr-1.5"></i> Export CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Logs List */}
          <div className="lg:col-span-2 space-y-2">
            {filtered.map(l => (
              <div key={l.id} onClick={() => setSelectedLog(l.id)} className={`flex items-start gap-4 bg-background-50 rounded-xl border p-4 cursor-pointer transition-smooth ${selectedLog === l.id ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60 hover:border-background-300/60'}`}>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${l.status === 'success' ? 'bg-emerald-100' : l.status === 'warning' ? 'bg-accent-100' : 'bg-red-100'}`}>
                  <i className={`${getTypeIcon(l.targetType)} text-sm ${l.status === 'success' ? 'text-emerald-600' : l.status === 'warning' ? 'text-accent-600' : 'text-red-600'}`}></i>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground-900">{l.action}</p>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${getStatusStyle(l.status)}`}>{l.status}</span>
                    {l.user === 'System' && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary-100 text-secondary-700 border border-secondary-200/50">Auto</span>}
                  </div>
                  <p className="text-[11px] text-foreground-400 mt-0.5">Target: {l.target}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-foreground-400">
                    <span><i className="ri-user-line mr-1"></i>{l.user}</span>
                    <span><i className="ri-time-line mr-1"></i>{l.timestamp}</span>
                    <span><i className="ri-global-line mr-1"></i>{l.ip}</span>
                  </div>
                </div>
                <i className={`ri-arrow-right-s-line text-foreground-300 mt-1 ${selectedLog === l.id ? 'text-primary-500' : ''}`}></i>
              </div>
            ))}
          </div>

          {/* Log Detail */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 h-fit">
            {log ? (
              <div className="space-y-5">
                <div>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-3 ${log.status === 'success' ? 'bg-emerald-100' : log.status === 'warning' ? 'bg-accent-100' : 'bg-red-100'}`}>
                    <i className={`${getTypeIcon(log.targetType)} text-lg ${log.status === 'success' ? 'text-emerald-600' : log.status === 'warning' ? 'text-accent-600' : 'text-red-600'}`}></i>
                  </div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{log.action}</h3>
                  <p className="text-[12px] text-foreground-500 mt-1">{log.targetType} action</p>
                </div>
                <div className="space-y-3 pt-2 border-t border-foreground-200/60">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">User</span>
                    <span className="text-foreground-700 font-medium">{log.user}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Target</span>
                    <span className="text-foreground-700 font-medium text-right">{log.target}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Timestamp</span>
                    <span className="text-foreground-700 font-medium">{log.timestamp}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">IP Address</span>
                    <span className="text-foreground-700 font-medium">{log.ip}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Status</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${getStatusStyle(log.status)}`}>{log.status}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">View Context</button>
                  <button className="flex-1 px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">Related</button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <i className="ri-history-line text-foreground-300 text-xl"></i>
                </div>
                <p className="text-sm text-foreground-500">Select an event to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}