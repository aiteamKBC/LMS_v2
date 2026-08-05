import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

// ---- Cross-tenant analytics mock data ----

const tenants = [
  { id: 't_kbc_001', name: 'Kent Business College', code: 'KBC', plan: 'Enterprise', learners: 156, users: 48, orgs: 8, programmes: 6, cohorts: 12, created: 'Sep 2023', aiEnabled: true, features: 17, auditEvents30d: 1247, growth: '+12%' },
  { id: 't_natc_001', name: 'Demo Training Provider', code: 'DEMO', plan: 'Trial', learners: 8, users: 12, orgs: 1, programmes: 3, cohorts: 2, created: 'May 2026', aiEnabled: true, features: 8, auditEvents30d: 89, growth: 'N/A' },
  { id: 't_lsa_001', name: 'London Skills Academy', code: 'LSA', plan: 'Professional', learners: 72, users: 31, orgs: 3, programmes: 5, cohorts: 7, created: 'Jan 2024', aiEnabled: true, features: 14, auditEvents30d: 632, growth: '+8%' },
  { id: 't_bhx_001', name: 'Birmingham Apprenticeships', code: 'BHX', plan: 'Standard', learners: 0, users: 0, orgs: 0, programmes: 1, cohorts: 1, created: 'Mar 2024', aiEnabled: false, features: 1, auditEvents30d: 0, growth: 'Suspended' },
  { id: 't_man_001', name: 'Manchester Tech College', code: 'MAN', plan: 'Enterprise', learners: 203, users: 62, orgs: 11, programmes: 8, cohorts: 18, created: 'Jun 2023', aiEnabled: true, features: 18, auditEvents30d: 1891, growth: '+15%' },
];

const userGrowthData = [
  { month: 'Jan', users: 98, learners: 72, staff: 26 },
  { month: 'Feb', users: 104, learners: 78, staff: 26 },
  { month: 'Mar', users: 118, learners: 90, staff: 28 },
  { month: 'Apr', users: 127, learners: 97, staff: 30 },
  { month: 'May', users: 141, learners: 108, staff: 33 },
  { month: 'Jun', users: 153, learners: 117, staff: 36 },
];

const featureAdoption = [
  { name: 'AI Marking', adoption: 78, trend: 'up', icon: 'ri-robot-line' },
  { name: 'Evidence Validation', adoption: 92, trend: 'up', icon: 'ri-shield-check-line' },
  { name: 'Attendance Tracking', adoption: 85, trend: 'up', icon: 'ri-calendar-check-line' },
  { name: 'OTJH Logging', adoption: 71, trend: 'up', icon: 'ri-time-line' },
  { name: 'KSB Mapping', adoption: 65, trend: 'up', icon: 'ri-bar-chart-2-line' },
  { name: 'Progress Reviews', adoption: 88, trend: 'stable', icon: 'ri-file-chart-line' },
  { name: 'Digital Signatures', adoption: 53, trend: 'up', icon: 'ri-pen-nib-line' },
  { name: 'Employer Engagement', adoption: 47, trend: 'up', icon: 'ri-building-2-line' },
  { name: 'Rewards & Recognition', adoption: 38, trend: 'down', icon: 'ri-trophy-line' },
  { name: 'Gateway & EPA', adoption: 42, trend: 'up', icon: 'ri-flag-line' },
  { name: 'Club Participation', adoption: 31, trend: 'up', icon: 'ri-team-line' },
  { name: 'Manual Mode', adoption: 22, trend: 'stable', icon: 'ri-tools-line' },
];

const auditTrends = [
  { month: 'Jan', critical: 2, warnings: 8, info: 145 },
  { month: 'Feb', critical: 1, warnings: 11, info: 162 },
  { month: 'Mar', critical: 4, warnings: 14, info: 198 },
  { month: 'Apr', critical: 2, warnings: 9, info: 210 },
  { month: 'May', critical: 3, warnings: 12, info: 237 },
  { month: 'Jun', critical: 5, warnings: 16, info: 289 },
];

const topAuditActions = [
  { action: 'User login', count: 3847, pct: 34 },
  { action: 'Evidence submitted', count: 2156, pct: 19 },
  { action: 'Progress review created', count: 1342, pct: 12 },
  { action: 'Attendance recorded', count: 1189, pct: 10 },
  { action: 'Settings changed', count: 587, pct: 5 },
  { action: 'Document signed', count: 489, pct: 4 },
  { action: 'Permission modified', count: 312, pct: 3 },
  { action: 'Tenant config change', count: 203, pct: 2 },
];

const monthlyActiveUsers = [
  { tenant: 'KBC', mau: 48, trend: '+4' },
  { tenant: 'DEMO', mau: 10, trend: '+2' },
  { tenant: 'LSA', mau: 28, trend: '+1' },
  { tenant: 'BHX', mau: 0, trend: '—' },
  { tenant: 'MAN', mau: 58, trend: '+6' },
];

export default function PlatformReportPage() {
  const [timeRange, setTimeRange] = useState('6m');
  const totalLearners = tenants.reduce((s, t) => s + t.learners, 0);
  const totalUsers = tenants.reduce((s, t) => s + t.users, 0);
  const aiTenants = tenants.filter(t => t.aiEnabled).length;
  const totalAudit = auditTrends.reduce((s, m) => s + m.critical + m.warnings + m.info, 0);
  const maxUserGrowth = Math.max(...userGrowthData.map(d => d.users));

  return (
    <WorkspaceShell
      role="admin"
      roleLabel={adminNav.label}
      navItems={adminNav.items}
      workspaceLabel={adminNav.workspaceLabel}
      pageTitle="Platform-wide Reports"
      pageSubtitle={`Cross-tenant analytics · ${tenants.length} tenants · ${totalUsers} users · ${totalLearners} learners`}
      userName="Platform Admin"
      userRole="Super Administrator"
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {/* ================================================================ */}
        {/* Hero Banner */}
        {/* ================================================================ */}
        <div className="relative rounded-2xl overflow-hidden min-h-[200px] md:min-h-[220px] isolate">
          <img
            src="https://readdy.ai/api/search-image?query=Premium%20dark%20enterprise%20analytics%20dashboard%20with%20glowing%20data%20visualizations%2C%20holographic-style%20bar%20charts%20and%20line%20graphs%20displayed%20on%20large%20curved%20wall%20monitors%2C%20sleek%20corporate%20server%20room%20ambiance%20with%20subtle%20blue%20and%20teal%20accent%20lighting%2C%20modern%20minimalist%20command%20centre%20interior%20with%20reflective%20dark%20surfaces%20and%20ambient%20glow%2C%20cinematic%20wide-angle%20view%2C%20professional%20enterprise%20SaaS%20aesthetic&width=1600&height=420&seq=platform-report-hero-2026&orientation=landscape"
            alt="Platform analytics"
            className="absolute inset-0 w-full h-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-primary-950 via-primary-900 to-primary-800" />
          <div className="absolute inset-0 bg-gradient-to-t from-primary-950/70 via-transparent to-primary-800/40" />

          <div className="relative z-10 p-5 sm:p-8 flex flex-col min-h-[200px] md:min-h-[220px]">
            <div className="flex items-start gap-4 mb-3">
              <div className="w-14 h-14 rounded-2xl bg-accent-500 flex items-center justify-center shrink-0 shadow-lg shadow-accent-500/20">
                <AppIcon className="ri-bar-chart-box-line text-foreground-950 text-2xl"></AppIcon>
              </div>
              <div className="min-w-0">
                <h2 className="text-2xl sm:text-3xl font-heading font-bold text-white tracking-tight leading-tight">
                  Platform-wide Analytics
                </h2>
                <p className="text-[13px] text-white/55 leading-relaxed max-w-xl mt-2">
                  Cross-tenant user growth, feature adoption, and audit intelligence.
                  <br />
                  <span className="text-accent-400 font-medium">{tenants.length} tenants</span> ·{' '}
                  <span className="text-primary-400 font-medium">{totalUsers} users</span> ·{' '}
                  <span className="text-secondary-400 font-medium">{totalAudit.toLocaleString()} audit events</span>
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-auto pt-6 flex-wrap">
              <HeroKpi icon="ri-building-4-line" label="Total Tenants" value={tenants.length} sub={`${tenants.filter(t => t.plan === 'Enterprise').length} Enterprise`} />
              <HeroKpi icon="ri-user-line" label="Platform Users" value={totalUsers} sub={`${totalLearners} learners`} />
              <HeroKpi icon="ri-robot-line" label="AI-Enabled" value={aiTenants} sub={`${tenants.length - aiTenants} manual`} />
            </div>
          </div>
        </div>

        {/* ================================================================ */}
        {/* Quick Stats Row */}
        {/* ================================================================ */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <QuickStat label="Total Learners" value={totalLearners.toLocaleString()} icon="ri-graduation-cap-line" color="primary" />
          <QuickStat label="Total Users" value={totalUsers.toLocaleString()} icon="ri-user-line" color="secondary" />
          <QuickStat label="Active Tenants" value={tenants.filter(t => t.learners > 0).length} icon="ri-building-4-line" color="accent" />
          <QuickStat label="Programmes" value={tenants.reduce((s, t) => s + t.programmes, 0)} icon="ri-stack-line" color="primary" />
          <QuickStat label="Audit Events" value={`${(totalAudit / 1000).toFixed(1)}k`} icon="ri-history-line" color="secondary" />
          <QuickStat label="Growth Rate" value="+9.4%" icon="ri-line-chart-line" color="accent" />
        </div>

        {/* ================================================================ */}
        {/* Tenant Health Score Widget                                        */}
        {/* ================================================================ */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="px-4 md:px-5 py-3 border-b border-background-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <AppIcon className="ri-heart-pulse-line text-emerald-600 text-sm"></AppIcon>
              </div>
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Tenant Health Score</h3>
                <p className="text-[10px] text-foreground-400">Composite health rating across 8 dimensions per tenant</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-foreground-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Excellent (85+)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"></span> Fair (65-84)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"></span> At Risk (&lt;65)</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 p-4 md:p-5">
            {[
              { name: 'Kent Business College', code: 'KBC', score: 92, dimensions: { users: 95, data: 90, compliance: 88, engagement: 94, delivery: 91, integrations: 89, audit: 93, growth: 96 }, trend: '+2', status: 'excellent' },
              { name: 'Manchester Tech College', code: 'MAN', score: 88, dimensions: { users: 91, data: 85, compliance: 86, engagement: 90, delivery: 88, integrations: 87, audit: 84, growth: 93 }, trend: '+4', status: 'excellent' },
              { name: 'London Skills Academy', code: 'LSA', score: 76, dimensions: { users: 78, data: 72, compliance: 80, engagement: 74, delivery: 77, integrations: 75, audit: 73, growth: 79 }, trend: '+1', status: 'fair' },
              { name: 'Demo Training Provider', code: 'DEMO', score: 68, dimensions: { users: 62, data: 70, compliance: 65, engagement: 72, delivery: 58, integrations: 71, audit: 66, growth: 80 }, trend: '+6', status: 'fair' },
              { name: 'Birmingham Apprenticeships', code: 'BHX', score: 31, dimensions: { users: 25, data: 30, compliance: 28, engagement: 20, delivery: 35, integrations: 22, audit: 40, growth: 48 }, trend: '-5', status: 'at-risk' },
            ].map(tenant => (
              <div key={tenant.code} className={`rounded-xl border p-4 ${tenant.status === 'excellent' ? 'border-emerald-200/60 bg-emerald-50/40' : tenant.status === 'fair' ? 'border-amber-200/60 bg-amber-50/30' : 'border-red-200/60 bg-red-50/30'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${tenant.status === 'excellent' ? 'bg-emerald-100 text-emerald-700' : tenant.status === 'fair' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                      <span className="text-[9px] font-bold">{tenant.code}</span>
                    </div>
                    <span className="text-[12px] font-semibold text-foreground-800 truncate max-w-[120px]">{tenant.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-lg font-heading font-bold ${tenant.status === 'excellent' ? 'text-emerald-700' : tenant.status === 'fair' ? 'text-amber-700' : 'text-red-700'}`}>{tenant.score}</span>
                    <span className={`text-[10px] font-medium ${tenant.trend.startsWith('+') ? 'text-emerald-600' : 'text-red-600'}`}>{tenant.trend}</span>
                  </div>
                </div>

                {/* Circular health gauge */}
                <div className="flex items-center justify-center mb-3">
                  <div className="relative w-[72px] h-[72px]">
                    <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                      <circle cx="40" cy="40" r="32" fill="none" stroke="currentColor" strokeWidth="6" className="text-background-100" />
                      <circle cx="40" cy="40" r="32" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round"
                        className={tenant.status === 'excellent' ? 'text-emerald-500' : tenant.status === 'fair' ? 'text-amber-500' : 'text-red-500'}
                        strokeDasharray={`${(tenant.score / 100) * 201} 201`}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`text-[15px] font-heading font-bold ${tenant.status === 'excellent' ? 'text-emerald-700' : tenant.status === 'fair' ? 'text-amber-700' : 'text-red-700'}`}>{tenant.score}</span>
                    </div>
                  </div>
                </div>

                {/* Dimension mini-bars */}
                <div className="space-y-1.5">
                  {Object.entries(tenant.dimensions).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <span className="text-[9px] text-foreground-400 w-16 truncate capitalize">{key}</span>
                      <div className="flex-1 h-1 rounded-full bg-background-100 overflow-hidden">
                        <div className={`h-full rounded-full ${val >= 85 ? 'bg-emerald-500' : val >= 65 ? 'bg-amber-500' : 'bg-red-400'}`} style={{ width: `${val}%` }}></div>
                      </div>
                      <span className="text-[9px] font-medium text-foreground-500 w-6 text-right">{val}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 pt-2.5 border-t border-background-100 flex items-center justify-between">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tenant.status === 'excellent' ? 'bg-emerald-100 text-emerald-700' : tenant.status === 'fair' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                    {tenant.status === 'excellent' ? 'Excellent' : tenant.status === 'fair' ? 'Fair' : 'At Risk'}
                  </span>
                  <a href="/admin/tenants" className="text-[10px] text-foreground-400 hover:text-foreground-600 cursor-pointer">
                    Details <AppIcon className="ri-arrow-right-line text-[9px]"></AppIcon>
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ================================================================ */}
        {/* User Growth Chart */}
        {/* ================================================================ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          <div className="lg:col-span-2 bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Platform User Growth</h3>
              <div className="flex items-center gap-1">
                {['3m', '6m', '12m'].map(r => (
                  <button key={r} onClick={() => setTimeRange(r)} className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${timeRange === r ? 'bg-primary-100 text-primary-700' : 'text-foreground-400 hover:text-foreground-600'}`}>{r}</button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-[10px] text-foreground-400 mb-2">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-primary-500"></span> Learners</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-secondary-500"></span> Staff</span>
              </div>
              <div className="flex items-end gap-2 md:gap-4 h-[200px]">
                {userGrowthData.map(d => (
                  <div key={d.month} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                    <div className="flex flex-col items-center gap-0.5 w-full">
                      <span className="text-[9px] font-semibold text-foreground-700">{d.users}</span>
                      <div className="w-full max-w-[40px] flex flex-col justify-end gap-[2px]" style={{ height: `${(d.users / maxUserGrowth) * 160}px` }}>
                        <div className="w-full bg-secondary-500 rounded-t-sm" style={{ height: `${((d.staff / d.users) * 100)}%` }}></div>
                        <div className="w-full bg-primary-500 rounded-b-sm" style={{ height: `${((d.learners / d.users) * 100)}%` }}></div>
                      </div>
                    </div>
                    <span className="text-[9px] text-foreground-400">{d.month}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* MAU by Tenant */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Monthly Active Users by Tenant</h3>
            <div className="space-y-3">
              {monthlyActiveUsers.map(t => (
                <div key={t.tenant} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-foreground-700 font-medium">{t.tenant}</span>
                    <span className="text-foreground-500">{t.mau} MAU</span>
                  </div>
                  <div className="h-2 rounded-full bg-background-100 overflow-hidden">
                    <div className="h-full rounded-full bg-primary-500 transition-smooth" style={{ width: `${(t.mau / 58) * 100}%` }}></div>
                  </div>
                  <span className={`text-[9px] ${t.trend.startsWith('+') ? 'text-emerald-600' : t.trend === '—' ? 'text-foreground-400' : 'text-red-600'}`}>{t.trend}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ================================================================ */}
        {/* Feature Adoption + Audit Trends */}
        {/* ================================================================ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          {/* Feature Adoption */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Feature Adoption Across Tenants</h3>
            <div className="space-y-2.5">
              {featureAdoption.map(f => (
                <div key={f.name} className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-lg bg-secondary-100 flex items-center justify-center shrink-0">
                    <AppIcon className={`${f.icon} text-secondary-600 text-[11px]`}></AppIcon>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-foreground-800">{f.name}</span>
                      <span className="text-[10px] font-semibold text-foreground-700">{f.adoption}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-background-100 overflow-hidden">
                      <div className={`h-full rounded-full transition-smooth ${f.adoption >= 70 ? 'bg-emerald-500' : f.adoption >= 40 ? 'bg-amber-500' : 'bg-red-400'}`} style={{ width: `${f.adoption}%` }}></div>
                    </div>
                  </div>
                  <span className="text-[9px]">
                    {f.trend === 'up' ? <AppIcon className="ri-arrow-up-line text-emerald-500"></AppIcon> : f.trend === 'down' ? <AppIcon className="ri-arrow-down-line text-red-500"></AppIcon> : <AppIcon className="ri-subtract-line text-foreground-300"></AppIcon>}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Audit Trends */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Audit Event Trends</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-[10px] text-foreground-400 mb-2">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500"></span> Critical</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500"></span> Warnings</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400"></span> Info</span>
              </div>
              <div className="h-[140px] flex items-end gap-2">
                {auditTrends.map(d => {
                  const maxH = 140;
                  const total = d.critical + d.warnings + d.info;
                  const maxTotal = Math.max(...auditTrends.map(x => x.critical + x.warnings + x.info));
                  const scale = maxH / maxTotal;
                  return (
                    <div key={d.month} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                      <div className="w-full max-w-[24px] flex flex-col justify-end gap-[1px]" style={{ height: `${total * scale}px` }}>
                        <div className="w-full bg-blue-400 rounded-t-[1px]" style={{ height: `${(d.info / total) * 100}%` }}></div>
                        <div className="w-full bg-amber-500" style={{ height: `${(d.warnings / total) * 100}%` }}></div>
                        <div className="w-full bg-red-500 rounded-b-[1px]" style={{ height: `${(d.critical / total) * 100}%` }}></div>
                      </div>
                      <span className="text-[9px] text-foreground-400">{d.month}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-background-100">
              <h4 className="text-[11px] font-semibold text-foreground-700 mb-2">Top Audit Actions</h4>
              <div className="space-y-1.5">
                {topAuditActions.map(a => (
                  <div key={a.action} className="flex items-center gap-2 text-[10px]">
                    <span className="text-foreground-500 flex-1 truncate">{a.action}</span>
                    <span className="text-foreground-700 font-medium">{a.count.toLocaleString()}</span>
                    <span className="text-foreground-300 w-10 text-right">{a.pct}%</span>
                    <div className="w-16 h-1 bg-background-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-400 rounded-full" style={{ width: `${a.pct}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ================================================================ */}
        {/* Tenant Comparison Table */}
        {/* ================================================================ */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="px-4 md:px-5 py-3 border-b border-background-100">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Tenant Comparison Matrix</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-background-100">
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Tenant</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Plan</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Learners</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Users</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Orgs</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Programmes</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Cohorts</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">AI</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Features</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Audit (30d)</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Growth</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map(t => (
                  <tr key={t.id} className="border-b border-background-50 hover:bg-background-50/60 transition-smooth cursor-pointer">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-primary-100 flex items-center justify-center">
                          <span className="text-primary-700 text-[9px] font-bold">{t.code}</span>
                        </div>
                        <span className="font-medium text-foreground-800 text-[11px] whitespace-nowrap">{t.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                        t.plan === 'Enterprise' ? 'bg-primary-50 text-primary-700 border border-primary-200/50'
                          : t.plan === 'Professional' ? 'bg-secondary-50 text-secondary-700 border border-secondary-200/50'
                          : t.plan === 'Trial' ? 'bg-accent-50 text-accent-700 border border-accent-200/50'
                          : 'bg-background-100 text-foreground-500'
                      }`}>{t.plan}</span>
                    </td>
                    <td className="px-4 py-2.5 text-foreground-700 font-medium text-[11px]">{t.learners}</td>
                    <td className="px-4 py-2.5 text-foreground-500 text-[11px]">{t.users}</td>
                    <td className="px-4 py-2.5 text-foreground-500 text-[11px]">{t.orgs}</td>
                    <td className="px-4 py-2.5 text-foreground-500 text-[11px]">{t.programmes}</td>
                    <td className="px-4 py-2.5 text-foreground-500 text-[11px]">{t.cohorts}</td>
                    <td className="px-4 py-2.5">{t.aiEnabled ? <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/50">On</span> : <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-400">Off</span>}</td>
                    <td className="px-4 py-2.5 text-foreground-500 text-[11px]">{t.features}</td>
                    <td className="px-4 py-2.5 text-foreground-500 text-[11px]">{t.auditEvents30d.toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-semibold ${t.growth.startsWith('+') ? 'text-emerald-600' : t.growth === 'Suspended' ? 'text-red-500' : 'text-foreground-400'}`}>{t.growth}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ================================================================ */}
        {/* Export Actions */}
        {/* ================================================================ */}
        <div className="flex items-center gap-3 pt-1">
          <button className="px-4 py-2 bg-primary-500 text-white rounded-xl text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-download-line mr-1.5"></AppIcon> Export Full Report
          </button>
          <button className="px-4 py-2 bg-background-50 border border-background-200 rounded-xl text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-file-pdf-line mr-1.5"></AppIcon> Download as PDF
          </button>
        </div>
      </div>
    </WorkspaceShell>
  );
}

function HeroKpi({ icon, label, value, sub }: { icon: string; label: string; value: number; sub: string }) {
  return (
    <div className="flex items-center gap-3 px-3 md:px-4 py-2.5 md:py-3 rounded-xl bg-black/25 backdrop-blur-md border border-white/10">
      <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
        <AppIcon className={`${icon} text-accent-400 text-sm`}></AppIcon>
      </div>
      <div>
        <p className="text-lg md:text-xl font-heading font-bold text-white leading-none">{value}</p>
        <p className="text-[9px] text-white/50 uppercase tracking-wider">{label}</p>
        <p className="text-[9px] text-white/35">{sub}</p>
      </div>
    </div>
  );
}

function QuickStat({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  const bgMap: Record<string, string> = { primary: 'bg-primary-100 text-primary-600', secondary: 'bg-secondary-100 text-secondary-600', accent: 'bg-accent-100 text-accent-700' };
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4">
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${bgMap[color]} mb-2`}>
        <AppIcon className={`${icon} text-xs`}></AppIcon>
      </span>
      <p className="text-lg md:text-xl font-heading font-semibold text-foreground-900">{value}</p>
      <p className="text-[10px] text-foreground-400 mt-1">{label}</p>
    </div>
  );
}