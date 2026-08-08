import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

// ---- Access log mock data ----

interface AccessEntry {
  id: string;
  user: string;
  email: string;
  role: string;
  tenant: string;
  tenantCode: string;
  action: string;
  resource: string;
  resourceType: 'page' | 'api' | 'data' | 'file' | 'admin';
  ip: string;
  userAgent: string;
  timestamp: string;
  duration: string;
  status: 'success' | 'denied' | 'error';
  location: string;
}

const accessLogs: AccessEntry[] = [
  { id: 'al-001', user: 'James Wilson', email: 'j.wilson@kbc.ac.uk', role: 'Coach', tenant: 'KBC', tenantCode: 'KBC', action: 'Viewed caseload page', resource: '/coach/caseload', resourceType: 'page', ip: '81.145.32.18', userAgent: 'Chrome 125 / Windows', timestamp: '11 Jun 2026 09:42', duration: '8m 22s', status: 'success', location: 'Canterbury, UK' },
  { id: 'al-002', user: 'Sarah Khan', email: 's.khan@kbc.ac.uk', role: 'Tutor', tenant: 'KBC', tenantCode: 'KBC', action: 'Opened learner case file', resource: '/coach/learner-case-file', resourceType: 'data', ip: '81.145.32.24', userAgent: 'Edge 125 / Windows', timestamp: '11 Jun 2026 09:41', duration: '12m 05s', status: 'success', location: 'Maidstone, UK' },
  { id: 'al-003', user: 'Platform Admin', email: 'superadmin@platform.io', role: 'Super Admin', tenant: 'Platform', tenantCode: 'SYS', action: 'Modified tenant settings', resource: '/admin/tenants', resourceType: 'admin', ip: '185.24.76.12', userAgent: 'Firefox 127 / macOS', timestamp: '11 Jun 2026 09:38', duration: '3m 14s', status: 'success', location: 'London, UK' },
  { id: 'al-004', user: 'Emma Richards', email: 'e.richards@lsa.ac.uk', role: 'Enrolment Officer', tenant: 'LSA', tenantCode: 'LSA', action: 'Downloaded ILR export', resource: '/compliance/ilr', resourceType: 'file', ip: '212.56.89.44', userAgent: 'Chrome 125 / Windows', timestamp: '11 Jun 2026 09:35', duration: '45s', status: 'success', location: 'London, UK' },
  { id: 'al-005', user: 'David Okafor', email: 'd.okafor@man.ac.uk', role: 'Coach', tenant: 'MAN', tenantCode: 'MAN', action: 'Attempted admin settings access', resource: '/admin/settings', resourceType: 'admin', ip: '86.12.45.78', userAgent: 'Chrome 125 / Windows', timestamp: '11 Jun 2026 09:32', duration: '2s', status: 'denied', location: 'Manchester, UK' },
  { id: 'al-006', user: 'Lisa Thompson', email: 'l.thompson@kbc.ac.uk', role: 'QA Officer', tenant: 'KBC', tenantCode: 'KBC', action: 'Reviewed evidence sample', resource: '/qa/evidence', resourceType: 'data', ip: '81.145.32.33', userAgent: 'Safari 17 / macOS', timestamp: '11 Jun 2026 09:28', duration: '22m 40s', status: 'success', location: 'Ashford, UK' },
  { id: 'al-007', user: 'Michael Chen', email: 'm.chen@kbc.ac.uk', role: 'Leadership', tenant: 'KBC', tenantCode: 'KBC', action: 'Viewed cohort performance', resource: '/leadership/cohort-performance', resourceType: 'page', ip: '81.145.32.15', userAgent: 'Chrome 125 / macOS', timestamp: '11 Jun 2026 09:25', duration: '6m 18s', status: 'success', location: 'Canterbury, UK' },
  { id: 'al-008', user: 'Platform Admin', email: 'superadmin@platform.io', role: 'Super Admin', tenant: 'Platform', tenantCode: 'SYS', action: 'Suspended user account', resource: '/admin/users', resourceType: 'admin', ip: '185.24.76.12', userAgent: 'Firefox 127 / macOS', timestamp: '11 Jun 2026 09:20', duration: '1m 52s', status: 'success', location: 'London, UK' },
  { id: 'al-009', user: 'Rachel Adams', email: 'r.adams@demo.ac.uk', role: 'Enrolment Officer', tenant: 'DEMO', tenantCode: 'DEMO', action: 'Viewed enrolment review', resource: '/compliance/enrolment-review', resourceType: 'page', ip: '194.34.56.90', userAgent: 'Chrome 125 / Windows', timestamp: '11 Jun 2026 09:18', duration: '4m 33s', status: 'success', location: 'Birmingham, UK' },
  { id: 'al-010', user: 'Tom Harrison', email: 't.harrison@man.ac.uk', role: 'MIS Operations', tenant: 'MAN', tenantCode: 'MAN', action: 'Updated learner allocation', resource: '/mis/learner-allocation', resourceType: 'data', ip: '86.12.45.90', userAgent: 'Chrome 124 / Windows', timestamp: '11 Jun 2026 09:15', duration: '15m 10s', status: 'success', location: 'Manchester, UK' },
  { id: 'al-011', user: 'Natalie Green', email: 'n.green@lsa.ac.uk', role: 'Coach', tenant: 'LSA', tenantCode: 'LSA', action: 'Attempted learner record access', resource: '/coach/learner-case-file', resourceType: 'data', ip: '212.56.89.55', userAgent: 'Chrome 125 / Windows', timestamp: '11 Jun 2026 09:10', duration: '1s', status: 'denied', location: 'London, UK' },
  { id: 'al-012', user: 'Platform Admin', email: 'superadmin@platform.io', role: 'Super Admin', tenant: 'Platform', tenantCode: 'SYS', action: 'API key rotation', resource: '/admin/integrations', resourceType: 'admin', ip: '185.24.76.12', userAgent: 'Firefox 127 / macOS', timestamp: '11 Jun 2026 09:05', duration: '48s', status: 'success', location: 'London, UK' },
  { id: 'al-013', user: 'Dr. Patel', email: 'a.patel@kbc.ac.uk', role: 'Leadership', tenant: 'KBC', tenantCode: 'KBC', action: 'Exported SAR report', resource: '/leadership/sar-qip', resourceType: 'file', ip: '81.145.32.20', userAgent: 'Safari 17 / macOS', timestamp: '11 Jun 2026 08:58', duration: '2m 10s', status: 'success', location: 'Canterbury, UK' },
  { id: 'al-014', user: 'Sam Burton', email: 's.burton@kbc.ac.uk', role: 'Tutor', tenant: 'KBC', tenantCode: 'KBC', action: 'Submitted assignment marks', resource: '/tutor/assignment-marking', resourceType: 'api', ip: '81.145.32.27', userAgent: 'Edge 125 / Windows', timestamp: '11 Jun 2026 08:52', duration: '18m 05s', status: 'success', location: 'Dover, UK' },
  { id: 'al-015', user: 'Platform Admin', email: 'superadmin@platform.io', role: 'Super Admin', tenant: 'Platform', tenantCode: 'SYS', action: 'Reviewed audit logs', resource: '/admin/audit-logs', resourceType: 'page', ip: '185.24.76.12', userAgent: 'Firefox 127 / macOS', timestamp: '11 Jun 2026 08:45', duration: '5m 22s', status: 'success', location: 'London, UK' },
  { id: 'al-016', user: 'Anonymous Scanner', email: '—', role: '—', tenant: 'Unknown', tenantCode: '—', action: 'Brute force login attempt', resource: '/login', resourceType: 'api', ip: '103.45.178.23', userAgent: 'Python requests / Linux', timestamp: '11 Jun 2026 08:40', duration: '12s', status: 'denied', location: 'Hanoi, VN' },
];

const resourceTypeColors: Record<string, string> = {
  page: 'bg-blue-50 text-blue-700 border-blue-200/50',
  api: 'bg-purple-50 text-purple-700 border-purple-200/50',
  data: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
  file: 'bg-amber-50 text-amber-700 border-amber-200/50',
  admin: 'bg-red-50 text-red-700 border-red-200/50',
};

const statusColors: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
  denied: 'bg-red-50 text-red-700 border-red-200/50',
  error: 'bg-amber-50 text-amber-700 border-amber-200/50',
};

export default function AccessLogsPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tenantFilter, setTenantFilter] = useState('all');
  const [selectedLog, setSelectedLog] = useState<string | null>(null);

  const filtered = accessLogs.filter(log => {
    const matchSearch = !search || log.user.toLowerCase().includes(search.toLowerCase()) || log.email.toLowerCase().includes(search.toLowerCase()) || log.resource.toLowerCase().includes(search.toLowerCase()) || log.ip.includes(search);
    const matchType = typeFilter === 'all' || log.resourceType === typeFilter;
    const matchStatus = statusFilter === 'all' || log.status === statusFilter;
    const matchTenant = tenantFilter === 'all' || log.tenantCode === tenantFilter;
    return matchSearch && matchType && matchStatus && matchTenant;
  });

  const uniqueTenants = [...new Set(accessLogs.map(l => l.tenantCode))];
  const deniedCount = accessLogs.filter(l => l.status === 'denied').length;
  const todayCount = accessLogs.length;
  const uniqueIps = [...new Set(accessLogs.map(l => l.ip))].length;
  const adminActions = accessLogs.filter(l => l.resourceType === 'admin').length;

  const selected = selectedLog ? accessLogs.find(l => l.id === selectedLog) : null;

  return (
    <WorkspaceShell
      role="admin"
      roleLabel={adminNav.label}
      navItems={adminNav.items}
      workspaceLabel={adminNav.workspaceLabel}
      pageTitle="Access Logs"
      pageSubtitle={`Role-based access logging across all tenants · ${todayCount} entries today · ${deniedCount} denied`}
      userName="Platform Admin"
      userRole="Super Administrator"
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {/* ================================================================ */}
        {/* Hero Banner */}
        {/* ================================================================ */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)' }}></div>
          <div className="relative z-10 p-5 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-accent-500 shadow-lg shadow-accent-500/20 flex items-center justify-center shrink-0">
              <AppIcon className="ri-door-lock-line text-foreground-950 text-2xl"></AppIcon>
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Access Logs</h2>
              <p className="text-[13px] text-white/60 leading-relaxed max-w-2xl">
                Cross-tenant session activity — who accessed what, from where, and when. All access attempts logged in real-time across every tenant and workspace.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/8 rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{todayCount}</p>
                <p className="text-[10px] text-white/40 uppercase tracking-wide">Today</p>
              </div>
              <div className="bg-red-500/15 rounded-xl px-4 py-3 text-center border border-red-500/20">
                <p className="text-2xl font-bold text-red-300">{deniedCount}</p>
                <p className="text-[10px] text-red-300/70 uppercase tracking-wide">Denied</p>
              </div>
              <div className="bg-white/8 rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{uniqueIps}</p>
                <p className="text-[10px] text-white/40 uppercase tracking-wide">Unique IPs</p>
              </div>
            </div>
          </div>
        </div>

        {/* ================================================================ */}
        {/* Filters */}
        {/* ================================================================ */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 w-full lg:w-auto">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
            <input
              type="text"
              placeholder="Search by user, email, resource, or IP..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Types</option>
              <option value="page">Page Access</option>
              <option value="api">API Call</option>
              <option value="data">Data Access</option>
              <option value="file">File Download</option>
              <option value="admin">Admin Action</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Status</option>
              <option value="success">Success</option>
              <option value="denied">Denied</option>
              <option value="error">Error</option>
            </select>
            <select value={tenantFilter} onChange={e => setTenantFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Tenants</option>
              {uniqueTenants.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="px-3 py-2.5 bg-background-50 border border-background-200 rounded-xl text-[12px] font-medium text-foreground-500 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-download-line mr-1"></AppIcon> Export
            </button>
          </div>
        </div>

        {/* ================================================================ */}
        {/* Access Summary Cards */}
        {/* ================================================================ */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Object.entries(resourceTypeColors).map(([type, colorClass]) => {
            const count = accessLogs.filter(l => l.resourceType === type).length;
            const colorKey = type === 'api' ? 'purple' : type === 'page' ? 'blue' : type === 'data' ? 'emerald' : type === 'file' ? 'amber' : 'red';
            return (
              <button
                key={type}
                onClick={() => setTypeFilter(typeFilter === type ? 'all' : type)}
                className={`bg-background-50 rounded-xl border p-3 cursor-pointer transition-smooth text-left ${typeFilter === type ? `border-${colorKey}-300 ring-1 ring-${colorKey}-200/50` : 'border-foreground-200/60 hover:border-background-300/60'}`}
              >
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2 bg-${colorKey}-100 text-${colorKey}-600`}>
                  <AppIcon className={`${type === 'page' ? 'ri-globe-line' : type === 'api' ? 'ri-terminal-box-line' : type === 'data' ? 'ri-database-2-line' : type === 'file' ? 'ri-file-download-line' : 'ri-shield-keyhole-line'} text-xs`}></AppIcon>
                </span>
                <p className="text-lg font-heading font-semibold text-foreground-900">{count}</p>
                <p className="text-[10px] text-foreground-400 capitalize">{type} access</p>
              </button>
            );
          })}
        </div>

        {/* ================================================================ */}
        {/* Table + Detail Panel */}
        {/* ================================================================ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Table */}
          <div className="lg:col-span-2 bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-background-50 z-10">
                  <tr className="border-b border-foreground-400/50">
                    <th className="text-left px-3 py-2.5 text-foreground-400 font-medium text-[9px] uppercase tracking-wider">Time</th>
                    <th className="text-left px-3 py-2.5 text-foreground-400 font-medium text-[9px] uppercase tracking-wider">User</th>
                    <th className="text-left px-3 py-2.5 text-foreground-400 font-medium text-[9px] uppercase tracking-wider">Tenant</th>
                    <th className="text-left px-3 py-2.5 text-foreground-400 font-medium text-[9px] uppercase tracking-wider">Action</th>
                    <th className="text-left px-3 py-2.5 text-foreground-400 font-medium text-[9px] uppercase tracking-wider">Type</th>
                    <th className="text-left px-3 py-2.5 text-foreground-400 font-medium text-[9px] uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(log => (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(selectedLog === log.id ? null : log.id)}
                      className={`border-b border-background-50 hover:bg-background-50/60 transition-smooth cursor-pointer ${selectedLog === log.id ? 'bg-primary-50/30' : ''}`}
                    >
                      <td className="px-3 py-2 text-foreground-400 whitespace-nowrap">{log.timestamp.slice(-5)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                            <span className="text-primary-700 text-[7px] font-bold">{log.user.charAt(0)}</span>
                          </div>
                          <span className="text-foreground-800 font-medium truncate max-w-[110px]">{log.user}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-secondary-100 text-secondary-700 whitespace-nowrap">{log.tenantCode}</span>
                      </td>
                      <td className="px-3 py-2 text-foreground-600 truncate max-w-[160px]">{log.action}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-full uppercase ${resourceTypeColors[log.resourceType]}`}>{log.resourceType}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-full ${statusColors[log.status]}`}>{log.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && (
              <div className="text-center py-12">
                <div className="w-10 h-10 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-2">
                  <AppIcon className="ri-search-line text-foreground-300"></AppIcon>
                </div>
                <p className="text-sm text-foreground-400">No matching access logs found</p>
              </div>
            )}
          </div>

          {/* Detail Panel */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5 h-fit sticky top-4">
            {selected ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
                    <span className="text-primary-700 font-bold text-sm">{selected.user.charAt(0)}</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">{selected.user}</h3>
                    <p className="text-[11px] text-foreground-400">{selected.email}</p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <DetailRow label="Role" value={selected.role} />
                  <DetailRow label="Tenant" value={`${selected.tenant} (${selected.tenantCode})`} />
                  <DetailRow label="Action" value={selected.action} />
                  <DetailRow label="Resource" value={selected.resource} />
                  <DetailRow label="Type">
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full uppercase ${resourceTypeColors[selected.resourceType]}`}>{selected.resourceType}</span>
                  </DetailRow>
                  <DetailRow label="Status">
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${statusColors[selected.status]}`}>{selected.status}</span>
                  </DetailRow>
                </div>

                <div className="border-t border-background-100 pt-3 space-y-2">
                  <DetailRow label="IP Address" value={selected.ip} />
                  <DetailRow label="Location" value={selected.location} />
                  <DetailRow label="Device" value={selected.userAgent} />
                  <DetailRow label="Timestamp" value={selected.timestamp} />
                  <DetailRow label="Duration" value={selected.duration} />
                </div>

                {selected.status === 'denied' && (
                  <div className="bg-red-50 border border-red-200/50 rounded-lg p-3 flex items-start gap-2">
                    <AppIcon className="ri-error-warning-line text-red-600 text-sm mt-0.5"></AppIcon>
                    <div>
                      <p className="text-[11px] font-semibold text-red-800">Access Denied</p>
                      <p className="text-[10px] text-red-600">This user does not have permission to access this resource. Flag for review if repeated.</p>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Investigate</button>
                  <button className="px-3 py-2 border border-background-200 rounded-lg text-[11px] text-foreground-500 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                    <AppIcon className="ri-file-copy-line"></AppIcon>
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <AppIcon className="ri-file-search-line text-foreground-300 text-xl"></AppIcon>
                </div>
                <p className="text-sm text-foreground-500">Select an access log entry</p>
                <p className="text-[11px] text-foreground-300 mt-1">View full details including IP, location, device, and session duration</p>
              </div>
            )}
          </div>
        </div>

        {/* ================================================================ */}
        {/* Access stats footer */}
        {/* ================================================================ */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-emerald-50/80 rounded-xl border border-emerald-200/50 p-4 text-center">
            <p className="text-2xl font-heading font-bold text-emerald-700">{accessLogs.filter(l => l.status === 'success').length}</p>
            <p className="text-[10px] text-emerald-600 uppercase tracking-wide">Successful Accesses</p>
          </div>
          <div className="bg-red-50/80 rounded-xl border border-red-200/50 p-4 text-center">
            <p className="text-2xl font-heading font-bold text-red-700">{deniedCount}</p>
            <p className="text-[10px] text-red-600 uppercase tracking-wide">Access Denials</p>
          </div>
          <div className="bg-primary-50/80 rounded-xl border border-primary-200/50 p-4 text-center">
            <p className="text-2xl font-heading font-bold text-primary-700">{adminActions}</p>
            <p className="text-[10px] text-primary-600 uppercase tracking-wide">Admin Actions</p>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}

function DetailRow({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 text-[11px]">
      <span className="text-foreground-400 shrink-0">{label}</span>
      {children ? children : <span className="text-foreground-800 text-right break-all">{value}</span>}
    </div>
  );
}