import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { kbcTenant, demoProviderTenant, tenants } from '@/mocks/tenant';
import { kbcUsers, allRoles } from '@/mocks/users';

const adminNav = roleNavMap.admin;

// ---- Dashboard-level mock data for SaaS command centre ----

const integrationHealth = [
  { id: 'int-aptem', name: 'Aptem', type: 'MIS Sync', status: 'healthy', lastSync: '2 min ago', icon: 'ri-refresh-line' },
  { id: 'int-teams', name: 'Microsoft Teams', type: 'Sessions', status: 'healthy', lastSync: 'Real-time', icon: 'ri-video-line' },
  { id: 'int-outlook', name: 'Outlook Calendar', type: 'Calendar', status: 'healthy', lastSync: '5 min ago', icon: 'ri-calendar-check-line' },
  { id: 'int-powerbi', name: 'Power BI', type: 'Reporting', status: 'degraded', lastSync: '2 hrs ago', icon: 'ri-bar-chart-box-line', issue: 'Dataset refresh pending' },
  { id: 'int-docusign', name: 'DocuSign', type: 'Signatures', status: 'healthy', lastSync: 'Real-time', icon: 'ri-pen-nib-line' },
  { id: 'int-email', name: 'Email Gateway', type: 'Notifications', status: 'healthy', lastSync: 'Real-time', icon: 'ri-mail-line' },
  { id: 'int-storage', name: 'Cloud Storage', type: 'Evidence', status: 'healthy', lastSync: 'Real-time', icon: 'ri-cloud-line' },
  { id: 'int-crm', name: 'CRM Bridge', type: 'Employer Data', status: 'warning', lastSync: '6 hrs ago', icon: 'ri-building-line', issue: 'Auth token expiring' },
];

const automationActivity = [
  { id: 'auto-1', name: 'Monthly Cycle Reminders', trigger: '28th of month', lastRun: '28 May 2026 06:00', status: 'success', recipients: 184 },
  { id: 'auto-2', name: 'Attendance Flag Escalation', trigger: '< 80% attendance', lastRun: '10 Jun 2026 08:00', status: 'success', recipients: 3 },
  { id: 'auto-3', name: 'OTJH Under-target Alert', trigger: '< 24 hrs/month', lastRun: '10 Jun 2026 07:00', status: 'success', recipients: 7 },
  { id: 'auto-4', name: 'Document Signature Reminder', trigger: '72 hrs pending', lastRun: '10 Jun 2026 09:00', status: 'partial', recipients: 4, issue: '2 emails bounced' },
  { id: 'auto-5', name: 'Progress Review Due Alert', trigger: '7 days before due', lastRun: '9 Jun 2026 06:00', status: 'success', recipients: 22 },
  { id: 'auto-6', name: 'Employer Review Nudge', trigger: '5 days overdue', lastRun: '10 Jun 2026 08:30', status: 'success', recipients: 5 },
];

const recentAuditEntries = [
  { id: 'aud-1', action: 'Tenant settings updated', target: 'Kent Business College', user: 'admin@kbc.ac.uk', timestamp: '10 Jun 2026 14:22', severity: 'info' },
  { id: 'aud-2', action: 'Role permission modified', target: 'Enrolment Officer — Evidence Packs', user: 'superadmin@platform.io', timestamp: '10 Jun 2026 13:45', severity: 'warning' },
  { id: 'aud-3', action: 'AI settings disabled', target: 'NATC Trial Tenant', user: 'superadmin@platform.io', timestamp: '10 Jun 2026 11:30', severity: 'warning' },
  { id: 'aud-4', action: 'User account suspended', target: 'j.bloggs@external.co.uk', user: 'admin@kbc.ac.uk', timestamp: '10 Jun 2026 10:15', severity: 'critical' },
  { id: 'aud-5', action: 'Integration token refreshed', target: 'CRM Bridge', user: 'superadmin@platform.io', timestamp: '10 Jun 2026 09:48', severity: 'info' },
  { id: 'aud-6', action: 'New organisation created', target: 'Ashford Accounting LLP — KBC', user: 'admin@kbc.ac.uk', timestamp: '9 Jun 2026 16:20', severity: 'info' },
  { id: 'aud-7', action: 'Automation rule modified', target: 'Document Signature Reminder', user: 'superadmin@platform.io', timestamp: '9 Jun 2026 14:05', severity: 'warning' },
  { id: 'aud-8', action: 'Admin override — evidence approved', target: 'Learner: Mia Robinson — OTJH evidence', user: 'admin@kbc.ac.uk', timestamp: '9 Jun 2026 11:12', severity: 'critical' },
];

const notificationStats = {
  emailDelivered: 1247,
  emailFailed: 8,
  smsDelivered: 0,
  smsFailed: 0,
  whatsappDelivered: 0,
  whatsappFailed: 0,
  last24h: 342,
  queueBacklog: 0,
};

export default function AdminDashboard() {
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);
  const [globalAiKilled, setGlobalAiKilled] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [killSwitchTenants, setKillSwitchTenants] = useState<string[]>([]);
  const [showKillNotification, setShowKillNotification] = useState(false);
  const [auditEntries, setAuditEntries] = useState(recentAuditEntries);

  const allTenants = tenants;
  const totalUsers = kbcUsers.length;
  const activeUsers = kbcUsers.filter(u => u.status === 'active').length;
  const roleCount = allRoles.length;
  const totalOrgs = allTenants.reduce((sum, t) => sum + t.organisations.length, 0);
  const employerCount = allTenants.reduce((sum, t) => sum + t.organisations.filter(o => o.type === 'employer').length, 0);
  const programmeCount = 8;
  const cohortCount = 6;
  const aiEnabledTenants = allTenants.filter(t => t.config.ai.enabled).length;
  const healthyIntegrations = integrationHealth.filter(i => i.status === 'healthy').length;
  const totalIntegrations = integrationHealth.length;
  const auditCriticalCount = recentAuditEntries.filter(a => a.severity === 'critical').length;

  return (
    <WorkspaceShell
      role="admin"
      roleLabel={adminNav.label}
      navItems={adminNav.items}
      workspaceLabel={adminNav.workspaceLabel}
      pageTitle="Super Admin Workspace"
      pageSubtitle={`Enterprise SaaS Control Centre · ${allTenants.length} tenants · ${totalUsers} platform users`}
      userName="Platform Admin"
      userRole="Super Administrator"
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {/* ================================================================ */}
        {/* Compact Page Header                                              */}
        {/* ================================================================ */}
        <div className="relative rounded-2xl overflow-hidden h-36 md:h-40" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute top-0 left-0 right-0 h-px bg-white/10"></div>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-black/10"></div>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute opacity-20" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute opacity-10" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
          </div>
          <div className="relative h-full flex flex-col justify-center px-6 md:px-8">
            <h2 className="text-2xl md:text-3xl font-heading font-bold text-white tracking-tight mb-1.5">Super Admin Command Centre</h2>
            <p className="text-[13px] text-white/50">
              {allTenants.length} tenants &middot; {totalOrgs} organisations &middot; {totalUsers} platform users
            </p>
          </div>
        </div>

        {/* ================================================================ */}
        {/* Global AI Kill Switch — Platform-wide override                     */}
        {/* ================================================================ */}
        {!globalAiKilled ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-4 md:p-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
                <AppIcon className="ri-robot-line text-primary-600 text-xl"></AppIcon>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Global AI Control</h3>
                <p className="text-[12px] text-foreground-500 mt-1">
                  AI is currently <span className="text-primary-600 font-medium">enabled</span> across tenants. You can disable all AI features platform-wide — this will force every tenant into Manual Mode and hide all AI buttons, suggestions, and features.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setShowKillConfirm(true)}
                  className="px-4 py-2.5 bg-red-500 text-white rounded-xl text-[13px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-1.5 shadow-sm shadow-red-500/20"
                >
                  <AppIcon className="ri-shut-down-line"></AppIcon> Disable AI Globally
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-red-50/90 rounded-2xl border-2 border-red-300 p-4 md:p-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center shrink-0 animate-pulse-slow">
                <AppIcon className="ri-shut-down-line text-red-600 text-xl"></AppIcon>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-heading font-semibold text-red-900">AI DISABLED GLOBALLY</h3>
                <p className="text-[12px] text-red-700 mt-1">
                  All AI features have been forcibly disabled across <strong>{killSwitchTenants.length || tenants.length} tenants</strong>. Every tenant is now in Manual Mode. AI buttons, suggestions, and features are hidden platform-wide. All workflows remain fully functional in manual mode.
                </p>
                {killSwitchTenants.length > 0 && (
                  <p className="text-[10px] text-red-500 mt-1">
                    Affected tenants: {killSwitchTenants.map(t => tenants.find(tt => tt.id === t)?.name || t).join(', ')}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setGlobalAiKilled(false);
                  setKillSwitchTenants([]);
                  setAuditEntries(prev => [{
                    id: `aud-${Date.now()}`,
                    action: 'GLOBAL AI KILL SWITCH DEACTIVATED',
                    target: 'All tenants — AI re-enabled',
                    user: 'superadmin@platform.io',
                    timestamp: new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                    severity: 'warning',
                  }, ...prev]);
                }}
                className="px-4 py-2.5 bg-emerald-500 text-white rounded-xl text-[13px] font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-1.5 shadow-sm shadow-emerald-500/20 shrink-0"
              >
                <AppIcon className="ri-restart-line"></AppIcon> Re-enable AI Globally
              </button>
            </div>
          </div>
        )}

        {/* Kill Switch Activated Notification Toast */}
        {showKillNotification && (
          <div className="fixed top-4 right-4 z-[100] animate-slide-in-right max-w-md w-full">
            <div className="bg-red-600 rounded-2xl shadow-2xl shadow-red-600/30 border border-red-500 p-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-700 flex items-center justify-center shrink-0">
                <AppIcon className="ri-shut-down-line text-white text-lg"></AppIcon>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                  <p className="text-[13px] font-bold text-white">Global AI Kill Switch Activated</p>
                </div>
                <p className="text-[11px] text-red-100 mt-1">
                  All AI features disabled across {killSwitchTenants.length > 0 ? killSwitchTenants.length : tenants.length} tenant(s). Audit log entry created.
                </p>
                <p className="text-[10px] text-red-200 mt-1.5">
                  <AppIcon className="ri-history-line mr-1"></AppIcon> Logged in audit trail · All tenants forced to Manual Mode
                </p>
              </div>
              <button onClick={() => setShowKillNotification(false)} className="text-red-200 hover:text-white transition-smooth cursor-pointer shrink-0">
                <AppIcon className="ri-close-line"></AppIcon>
              </button>
            </div>
          </div>
        )}
        {showKillConfirm && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowKillConfirm(false)}>
            <div className="bg-background-50 rounded-2xl border border-background-200 max-w-lg w-full p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                  <AppIcon className="ri-error-warning-line text-red-600 text-2xl"></AppIcon>
                </div>
                <div>
                  <h3 className="text-base font-heading font-semibold text-red-900">Disable AI Globally?</h3>
                  <p className="text-[12px] text-red-600 mt-0.5">This is a platform-wide irreversible action</p>
                </div>
              </div>

              <div className="bg-red-50/80 rounded-xl border border-red-200/50 p-4 mb-4 space-y-2">
                <p className="text-[12px] font-semibold text-red-800">This will immediately:</p>
                <ul className="space-y-1.5">
                  <li className="text-[11px] text-red-700 flex items-start gap-2">
                    <AppIcon className="ri-close-circle-line text-red-500 mt-0.5"></AppIcon>
                    Disable AI across <strong>all {tenants.length} tenants</strong> simultaneously
                  </li>
                  <li className="text-[11px] text-red-700 flex items-start gap-2">
                    <AppIcon className="ri-close-circle-line text-red-500 mt-0.5"></AppIcon>
                    Force every tenant into <strong>Manual Mode</strong> — no AI suggestions, no AI marking, no AI features
                  </li>
                  <li className="text-[11px] text-red-700 flex items-start gap-2">
                    <AppIcon className="ri-close-circle-line text-red-500 mt-0.5"></AppIcon>
                    Hide all AI buttons and UI elements from <strong>every user</strong>
                  </li>
                  <li className="text-[11px] text-red-700 flex items-start gap-2">
                    <AppIcon className="ri-close-circle-line text-red-500 mt-0.5"></AppIcon>
                    Log this action in the <strong>audit trail</strong>
                  </li>
                </ul>
              </div>

              <div className="mb-4">
                <label className="block text-[11px] font-semibold text-foreground-600 mb-2">Select tenants to apply (or leave all unchecked for all tenants)</label>
                <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
                  {tenants.map(tenant => (
                    <label key={tenant.id} className="flex items-center gap-2 cursor-pointer py-1">
                      <input
                        type="checkbox"
                        checked={killSwitchTenants.includes(tenant.id)}
                        onChange={() => setKillSwitchTenants(prev => prev.includes(tenant.id) ? prev.filter(t => t !== tenant.id) : [...prev, tenant.id])}
                        className="rounded border-background-300 cursor-pointer"
                      />
                      <span className="text-[12px] text-foreground-700">{tenant.name} <span className="text-foreground-400">({tenant.type})</span></span>
                    </label>
                  ))}
                </div>
                <p className="text-[10px] text-foreground-300 mt-1">
                  {killSwitchTenants.length === 0 ? 'No tenants selected = all tenants will be affected' : `${killSwitchTenants.length} tenant(s) selected`}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setGlobalAiKilled(true);
                    setShowKillConfirm(false);
                    setShowKillNotification(true);
                    const selectedTenantNames = killSwitchTenants.length > 0
                      ? killSwitchTenants.map(t => tenants.find(tt => tt.id === t)?.name || t).join(', ')
                      : 'All tenants';
                    setAuditEntries(prev => [{
                      id: `aud-${Date.now()}`,
                      action: 'GLOBAL AI KILL SWITCH ACTIVATED',
                      target: selectedTenantNames,
                      user: 'superadmin@platform.io',
                      timestamp: new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                      severity: 'critical',
                    }, ...prev]);
                    setTimeout(() => setShowKillNotification(false), 6000);
                  }}
                  className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-xl text-[13px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  <AppIcon className="ri-shut-down-line mr-1.5"></AppIcon> Confirm — Disable AI
                </button>
                <button
                  onClick={() => { setShowKillConfirm(false); setKillSwitchTenants([]); }}
                  className="flex-1 px-4 py-2.5 bg-background-100 border border-background-200 rounded-xl text-[13px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* Platform Alerts                                                    */}
        {/* ================================================================ */}
        <div className="space-y-2">
          <div className="bg-red-50 border border-red-200/60 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-start gap-3 cursor-pointer" onClick={() => setExpandedAlert(expandedAlert === 'critical' ? null : 'critical')}>
            <span className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0"><AppIcon className="ri-error-warning-fill text-red-600 text-sm"></AppIcon></span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-900">Critical: {auditCriticalCount} audit events require platform review</p>
              <p className="text-[11px] text-red-700 mt-1 line-clamp-2">User account suspended (j.bloggs@external.co.uk), admin override on evidence approval (Mia Robinson). Review immediately in Audit Logs.</p>
              {expandedAlert === 'critical' && (
                <div className="mt-2 space-y-1 text-[11px] text-red-700">
                  <p><strong>10 Jun 14:22 —</strong> Tenant settings updated on KBC (admin@kbc.ac.uk)</p>
                  <p><strong>10 Jun 10:15 —</strong> User account suspended: j.bloggs@external.co.uk — reason: security review</p>
                  <p><strong>9 Jun 11:12 —</strong> Admin override: evidence manually approved for Mia Robinson — OTJH evidence bypassed validation</p>
                </div>
              )}
            </div>
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 shrink-0 whitespace-nowrap">2 critical</span>
          </div>

          <div className="bg-amber-50 border border-amber-200/60 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-start gap-3 cursor-pointer" onClick={() => setExpandedAlert(expandedAlert === 'warning' ? null : 'warning')}>
            <span className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0"><AppIcon className="ri-alert-line text-amber-600 text-sm"></AppIcon></span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">Configuration Attention: 3 items need review</p>
              <p className="text-[11px] text-amber-700 mt-1 line-clamp-2">Power BI dataset refresh delayed, CRM Bridge auth token expiring in 48h, automation rule modified — Document Signature Reminder.</p>
              {expandedAlert === 'warning' && (
                <div className="mt-2 space-y-1 text-[11px] text-amber-700">
                  <p><strong>Power BI —</strong> Dataset refresh pending for 2 hours. Last successful: 10 Jun 12:22.</p>
                  <p><strong>CRM Bridge —</strong> Authentication token expires 12 Jun 2026. Renew before expiry to avoid data sync gap.</p>
                  <p><strong>Automation —</strong> Document Signature Reminder rule modified on 9 Jun. Verify new trigger conditions.</p>
                </div>
              )}
            </div>
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0 whitespace-nowrap">3 warnings</span>
          </div>
        </div>

        {/* ================================================================ */}
        {/* SaaS Quick Stat Cards (8)                                          */}
        {/* ================================================================ */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          <MiniStat label="Platform Users" value={String(totalUsers)} sub={`${activeUsers} active`} icon="ri-user-line" color="primary" />
          <MiniStat label="Roles Defined" value={String(roleCount)} sub="global + tenant" icon="ri-shield-user-line" color="secondary" />
          <MiniStat label="Tenants" value={String(allTenants.length)} sub={`${aiEnabledTenants} AI-enabled`} icon="ri-building-4-line" color="primary" />
          <MiniStat label="Organisations" value={String(totalOrgs)} sub={`${employerCount} employers`} icon="ri-building-line" color="secondary" />
          <MiniStat label="Programmes" value={String(programmeCount)} sub="across tenants" icon="ri-stack-line" color="accent" />
          <MiniStat label="Cohorts" value={String(cohortCount)} sub="active cohorts" icon="ri-group-2-line" color="accent" />
          <MiniStat label="Integrations" value={`${healthyIntegrations}/${totalIntegrations}`} sub="healthy" icon="ri-plug-2-line" color="primary" />
          <MiniStat label="Notifications/24h" value={String(notificationStats.last24h)} sub={`${notificationStats.emailFailed} failed`} icon="ri-notification-3-line" color="secondary" />
        </div>

        {/* ================================================================ */}
        {/* Main Content Grid — Tenant Health + User Overview                  */}
        {/* ================================================================ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Left 2/3: Tenant Health + User/Access */}
          <div className="lg:col-span-2 space-y-4 md:space-y-6">
            {/* Tenant Health Cards */}
            <section>
              <div className="flex items-center justify-between mb-3 md:mb-4">
                <h2 className="text-base font-heading font-semibold text-foreground-900">Tenant Health Overview</h2>
                <a href="/admin/tenants" className="text-[12px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">Manage Tenants <AppIcon className="ri-arrow-right-line text-[10px] ml-0.5"></AppIcon></a>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {allTenants.map(tenant => {
                  const tenantUsers = kbcUsers.filter(u => u.tenantId === tenant.id || tenant.id === 't_kbc_001');
                  const tenantOrgs = tenant.organisations.length;
                  const aiOn = tenant.config.ai.enabled;
                  const ofstedReady = tenant.config.compliance.ofstedReadyMode;
                  return (
                    <a key={tenant.id} href="/admin/tenants" className="block bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5 card-premium cursor-pointer group">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tenant.status === 'active' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                            <AppIcon className="ri-building-4-line text-lg"></AppIcon>
                          </span>
                          <div>
                            <p className="text-sm font-heading font-semibold text-foreground-900">{tenant.name}</p>
                            <p className="text-[11px] text-foreground-400 capitalize">{tenant.type.replace(/-/g, ' ')}</p>
                          </div>
                        </div>
                        <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${
                          tenant.status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50' : 'bg-amber-50 text-amber-700 border border-amber-200/50'
                        }`}>
                          {tenant.status === 'active' ? 'Active' : 'Trial'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${tenantUsers.length > 0 ? 'bg-emerald-500' : 'bg-foreground-300'}`}></span>
                          <span className="text-foreground-500">Users:</span>
                          <span className="font-medium text-foreground-800">{tenantUsers.length}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${tenantOrgs > 0 ? 'bg-emerald-500' : 'bg-foreground-300'}`}></span>
                          <span className="text-foreground-500">Orgs:</span>
                          <span className="font-medium text-foreground-800">{tenantOrgs}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${aiOn ? 'bg-primary-400' : 'bg-foreground-300'}`}></span>
                          <span className="text-foreground-500">AI Mode:</span>
                          <span className={`font-medium ${aiOn ? 'text-primary-700' : 'text-foreground-500'}`}>{aiOn ? 'Enabled' : 'Disabled'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${ofstedReady ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                          <span className="text-foreground-500">Ofsted:</span>
                          <span className={`font-medium ${ofstedReady ? 'text-emerald-700' : 'text-amber-700'}`}>{ofstedReady ? 'Ready' : 'Pending'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 col-span-2">
                          <span className="text-foreground-500">Retention:</span>
                          <span className="font-medium text-foreground-800">{tenant.config.compliance.dataRetentionMonths} months</span>
                          <span className="text-foreground-500 ml-2">Rewards:</span>
                          <span className={`font-medium ${tenant.config.rewards.enabled ? 'text-emerald-700' : 'text-foreground-500'}`}>{tenant.config.rewards.enabled ? 'On' : 'Off'}</span>
                        </div>
                      </div>
                    </a>
                  );
                })}
              </div>
            </section>

            {/* User & Access Overview */}
            <section>
              <div className="flex items-center justify-between mb-3 md:mb-4">
                <h2 className="text-base font-heading font-semibold text-foreground-900">User & Access Summary</h2>
                <a href="/admin/users" className="text-[12px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">View All Users <AppIcon className="ri-arrow-right-line text-[10px] ml-0.5"></AppIcon></a>
              </div>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px] md:text-[13px]">
                    <thead>
                      <tr className="border-b border-foreground-400/50">
                        <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">User</th>
                        <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Email</th>
                        <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Roles</th>
                        <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Status</th>
                        <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Tenant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kbcUsers.slice(0, 7).map(user => {
                        const roleNames = user.roles.map(rId => allRoles.find(r => r.id === rId)?.name || rId).join(', ');
                        return (
                          <tr key={user.id} className="border-b border-background-100/50 hover:bg-background-50/80 transition-smooth cursor-pointer">
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center shrink-0 ring-1 ring-primary-200/50">
                                  <span className="text-primary-700 text-[10px] font-semibold">{user.fullName.charAt(0)}</span>
                                </div>
                                <span className="font-medium text-foreground-800 whitespace-nowrap">{user.fullName}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-foreground-500 text-[11px]">{user.email}</td>
                            <td className="px-4 py-2.5 text-foreground-600 text-[11px] max-w-[180px] truncate">{roleNames}</td>
                            <td className="px-4 py-2.5">
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                                user.status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50' : 'bg-background-100 text-foreground-500'
                              }`}>{user.status}</span>
                            </td>
                            <td className="px-4 py-2.5 text-foreground-500 text-[11px] whitespace-nowrap">KBC</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {kbcUsers.length > 7 && (
                  <div className="px-4 py-2.5 border-t border-background-100/50">
                    <a href="/admin/users" className="text-[12px] text-primary-600 hover:text-primary-700 font-medium cursor-pointer">
                      + {kbcUsers.length - 7} more users
                    </a>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Right 1/3: Integration Health + AI/Manual Mode */}
          <div className="space-y-4 md:space-y-6">
            {/* Integration Health Panel */}
            <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Integration Health</h3>
                <a href="/admin/integrations" className="text-[11px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">Configure</a>
              </div>
              <div className="space-y-2.5">
                {integrationHealth.map(int => (
                  <div key={int.id} className="flex items-center gap-3">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      int.status === 'healthy' ? 'bg-emerald-100 text-emerald-600'
                        : int.status === 'degraded' ? 'bg-amber-100 text-amber-600'
                        : 'bg-red-100 text-red-600'
                    }`}>
                      <AppIcon className={`${int.icon} text-xs`}></AppIcon>
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[12px] font-medium text-foreground-800 truncate">{int.name}</p>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          int.status === 'healthy' ? 'bg-emerald-500' : int.status === 'degraded' ? 'bg-amber-500' : 'bg-red-500'
                        }`}></span>
                      </div>
                      <p className="text-[10px] text-foreground-400">{int.type} · {int.lastSync}</p>
                      {int.issue && <p className="text-[10px] text-amber-600 mt-0.5">{int.issue}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* AI / Manual Mode Status */}
            <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">
                AI & Manual Mode Status
                {globalAiKilled && <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">GLOBALLY DISABLED</span>}
              </h3>
              {globalAiKilled ? (
                <div className="bg-red-50 rounded-lg p-4 text-center">
                  <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-2">
                    <AppIcon className="ri-forbid-line text-red-500 text-lg"></AppIcon>
                  </div>
                  <p className="text-[12px] font-semibold text-red-800">AI Disabled Globally</p>
                  <p className="text-[10px] text-red-600 mt-1">All {tenants.length} tenants forced into Manual Mode</p>
                </div>
              ) : (
                <div className="space-y-3">
                {allTenants.map(tenant => {
                  const aiEnabled = tenant.config.ai.enabled;
                  const aiFeatures = Object.entries(tenant.config.ai).filter(([k, v]) => k !== 'enabled' && v === true).length;
                  return (
                    <div key={tenant.id} className="bg-background-100/70 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[12px] font-medium text-foreground-800">{tenant.name}</p>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                          aiEnabled ? 'bg-primary-50 text-primary-700 border border-primary-200/50' : 'bg-background-100 text-foreground-500 border border-foreground-200/60'
                        }`}>
                          {aiEnabled ? `AI On · ${aiFeatures} features` : 'Manual Mode'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px]">
                        <span className="text-foreground-400">Features: {aiFeatures} active</span>
                        <span className={`${tenant.config.ai.requireHumanApproval ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {tenant.config.ai.requireHumanApproval ? 'Human approval req.' : 'Auto-approval on'}
                        </span>
                        <span className={`${tenant.config.ai.auditTrailEnabled ? 'text-emerald-600' : 'text-foreground-400'}`}>
                          {tenant.config.ai.auditTrailEnabled ? 'Audit on' : 'Audit off'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
              <div className="mt-3 pt-3 border-t border-foreground-200/60 flex gap-2">
                <a href="/admin/ai-settings" className="text-[11px] text-primary-600 hover:text-primary-700 font-medium cursor-pointer">AI Settings</a>
                <span className="text-foreground-300">·</span>
                <a href="/admin/manual-mode" className="text-[11px] text-primary-600 hover:text-primary-700 font-medium cursor-pointer">Manual Mode</a>
              </div>
            </section>

            {/* System Health Gauge */}
            <section className="bg-emerald-50/80 rounded-xl border border-emerald-200/50 p-4 md:p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm shadow-emerald-500/20">
                  <AppIcon className="ri-check-line text-white text-sm"></AppIcon>
                </div>
                <div>
                  <p className="text-sm font-heading font-semibold text-emerald-900">Platform Healthy</p>
                  <p className="text-[11px] text-emerald-600">All core systems operational</p>
                </div>
              </div>
              <div className="space-y-2">
                <HealthBar label="Tenant Availability" pct={100} />
                <HealthBar label="Integration Uptime" pct={Math.round((healthyIntegrations / totalIntegrations) * 100)} />
                <HealthBar label="Notification Delivery" pct={Math.round((notificationStats.emailDelivered / (notificationStats.emailDelivered + notificationStats.emailFailed)) * 100)} />
                <HealthBar label="Audit Trail Coverage" pct={100} />
                <HealthBar label="Backup Status" pct={100} />
              </div>
            </section>
          </div>
        </div>

        {/* ================================================================ */}
        {/* Bottom Row — Automations, Notifications, Audit Logs               */}
        {/* ================================================================ */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Automation Activity */}
          <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Automation Activity</h3>
              <a href="/admin/automations" className="text-[11px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">Manage</a>
            </div>
            <div className="space-y-2.5">
              {automationActivity.map(auto => (
                <div key={auto.id} className="flex items-start gap-2.5">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                    auto.status === 'success' ? 'bg-emerald-500' : auto.status === 'partial' ? 'bg-amber-500' : 'bg-red-500'
                  }`}></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-foreground-800">{auto.name}</p>
                    <p className="text-[10px] text-foreground-400">Last: {auto.lastRun} · {auto.recipients} recipients</p>
                    {auto.issue && <p className="text-[10px] text-amber-600">{auto.issue}</p>}
                  </div>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap ${
                    auto.status === 'success' ? 'bg-emerald-50 text-emerald-700' : auto.status === 'partial' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                  }`}>{auto.status}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Notification Delivery Stats */}
          <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Notification Delivery</h3>
              <a href="/admin/notifications" className="text-[11px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">Configure</a>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-background-100/70 rounded-lg p-3 text-center">
                  <p className="text-2xl font-heading font-bold text-emerald-600">{notificationStats.emailDelivered.toLocaleString()}</p>
                  <p className="text-[10px] text-foreground-400 mt-0.5">Emails Delivered (30d)</p>
                </div>
                <div className="bg-background-100/70 rounded-lg p-3 text-center">
                  <p className="text-2xl font-heading font-bold text-red-600">{notificationStats.emailFailed}</p>
                  <p className="text-[10px] text-foreground-400 mt-0.5">Emails Failed (30d)</p>
                </div>
                <div className="bg-background-100/70 rounded-lg p-3 text-center">
                  <p className="text-2xl font-heading font-bold text-foreground-800">{notificationStats.last24h}</p>
                  <p className="text-[10px] text-foreground-400 mt-0.5">Last 24 Hours</p>
                </div>
                <div className="bg-background-100/70 rounded-lg p-3 text-center">
                  <p className="text-2xl font-heading font-bold text-emerald-600">{notificationStats.queueBacklog}</p>
                  <p className="text-[10px] text-foreground-400 mt-0.5">Queue Backlog</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-[10px] text-foreground-400 justify-center">
                <span>SMS: {notificationStats.smsDelivered} delivered</span>
                <span>WhatsApp: {notificationStats.whatsappDelivered} delivered</span>
              </div>
            </div>
          </section>

          {/* Recent Audit Log Entries */}
          <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Recent Audit Trail</h3>
              <a href="/admin/audit-logs" className="text-[11px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">Full Log</a>
            </div>
            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {auditEntries.map(entry => (
                <div key={entry.id} className="flex items-start gap-2.5 py-1.5 border-b border-background-100/50 last:border-0">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                    entry.severity === 'critical' ? 'bg-red-500' : entry.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500'
                  }`}></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-foreground-800 truncate">{entry.action}</p>
                    <p className="text-[10px] text-foreground-400">{entry.target}</p>
                    <p className="text-[10px] text-foreground-300">{entry.user} · {entry.timestamp}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </WorkspaceShell>
  );
}

/* ======================================================================== */
/* Hero KPI Card                                                             */
/* ======================================================================== */
function HeroKpiCard({ icon, label, value, total, color, delay }: { icon: string; label: string; value: number; total: number; color: 'accent' | 'primary' | 'secondary'; delay: string }) {
  const colorMap = { accent: 'bg-accent-500', primary: 'bg-primary-500', secondary: 'bg-secondary-500' };
  const iconColorMap = { accent: 'text-accent-400', primary: 'text-primary-400', secondary: 'text-secondary-400' };
  const percentage = Math.round((value / total) * 100);

  return (
    <div className={`flex items-center gap-3 px-3 md:px-4 py-2.5 md:py-3 rounded-xl bg-black/30 backdrop-blur-md border border-white/10 ${delay} animate-hero-fade-in-up-small`}>
      <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
        <AppIcon className={`${icon} ${iconColorMap[color]} text-sm`}></AppIcon>
      </div>
      <div className="w-20 md:w-24">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] md:text-[10px] text-white/50 font-medium uppercase tracking-wider">{label}</span>
          <span className="text-[9px] md:text-[10px] text-white/70 font-semibold">{value}/{total}</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div className={`h-full rounded-full ${colorMap[color]} transition-all duration-1000 ease-out`} style={{ width: `${percentage}%` }} />
        </div>
      </div>
    </div>
  );
}

/* ======================================================================== */
/* Mini Stat Card                                                            */
/* ======================================================================== */
function MiniStat({ label, value, sub, icon, color }: { label: string; value: string; sub: string; icon: string; color: string }) {
  const bgMap: Record<string, string> = {
    primary: 'bg-primary-100 text-primary-600',
    secondary: 'bg-secondary-100 text-secondary-600',
    accent: 'bg-accent-50 text-accent-700',
  };
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4 card-premium">
      <span className={`w-7 md:w-8 h-7 md:h-8 rounded-lg flex items-center justify-center ${bgMap[color] || bgMap.primary} mb-2 md:mb-3`}>
        <AppIcon className={`${icon} text-xs md:text-sm`}></AppIcon>
      </span>
      <p className="text-xl md:text-2xl font-heading font-semibold text-foreground-900">{value}</p>
      <p className="text-[10px] md:text-[11px] text-foreground-400 mt-1">{label}</p>
      <p className="text-[10px] text-foreground-300">{sub}</p>
    </div>
  );
}

/* ======================================================================== */
/* Health Bar                                                                */
/* ======================================================================== */
function HealthBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-emerald-700 w-24 md:w-28 whitespace-nowrap">{label}</span>
      <div className="flex-1 h-1.5 bg-emerald-200/70 rounded-full overflow-hidden">
        <div className="h-full bg-emerald-500 rounded-full transition-smooth" style={{ width: `${pct}%` }}></div>
      </div>
      <span className="text-[10px] font-semibold text-emerald-700">{pct}%</span>
    </div>
  );
}