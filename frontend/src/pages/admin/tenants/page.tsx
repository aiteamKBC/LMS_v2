import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const TENANTS_DATA = [
  { id: 't1', name: 'Kent Business College', code: 'KBC', status: 'active' as const, plan: 'Enterprise', users: 45, learners: 32, orgs: 3, created: 'Sep 2023', expiry: 'Sep 2026', features: ['AI', 'Manual Mode', 'Compliance', 'QA', 'Engagement', 'Finance'] },
  { id: 't2', name: 'Demo Training Provider', code: 'DEMO', status: 'trial' as const, plan: 'Trial', users: 8, learners: 6, orgs: 1, created: 'May 2026', expiry: 'Aug 2026', features: ['AI', 'Compliance'] },
  { id: 't3', name: 'London Skills Academy', code: 'LSA', status: 'active' as const, plan: 'Professional', users: 28, learners: 20, orgs: 2, created: 'Jan 2024', expiry: 'Jan 2027', features: ['AI', 'Manual Mode', 'Compliance', 'Engagement'] },
  { id: 't4', name: 'Birmingham Apprenticeships', code: 'BHX', status: 'suspended' as const, plan: 'Standard', users: 0, learners: 0, orgs: 0, created: 'Mar 2024', expiry: 'Mar 2025', features: ['Compliance'] },
  { id: 't5', name: 'Manchester Tech College', code: 'MAN', status: 'active' as const, plan: 'Enterprise', users: 62, learners: 48, orgs: 4, created: 'Jun 2023', expiry: 'Jun 2026', features: ['AI', 'Manual Mode', 'Compliance', 'QA', 'Engagement', 'Finance', 'Curriculum'] },
];

export default function AdminTenantsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);

  const activeCount = TENANTS_DATA.filter(t => t.status === 'active').length;
  const trialCount = TENANTS_DATA.filter(t => t.status === 'trial').length;
  const totalUsers = TENANTS_DATA.reduce((a, b) => a + b.users, 0);
  const totalLearners = TENANTS_DATA.reduce((a, b) => a + b.learners, 0);

  const filtered = TENANTS_DATA.filter(t => {
    const matchSearch = t.name.toLowerCase().includes(search.toLowerCase()) || t.code.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const tenant = selectedTenant ? TENANTS_DATA.find(t => t.id === selectedTenant) : null;

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Tenants" pageSubtitle="Manage tenant instances, billing, and feature access" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <AppIcon className="ri-building-4-line text-white text-2xl"></AppIcon>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Tenant Management</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{TENANTS_DATA.length} tenants</strong> — {activeCount} active, {trialCount} on trial. {totalUsers} users, {totalLearners} learners across all tenants.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{TENANTS_DATA.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Tenants</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{activeCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Active</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalLearners}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Learners</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 w-full lg:w-auto">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
            <input type="text" placeholder="Search tenants..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
          </div>
          <div className="flex items-center gap-2">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="trial">Trial</option>
              <option value="suspended">Suspended</option>
            </select>
            <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-add-line mr-1.5"></AppIcon> New Tenant
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Tenants List */}
          <div className="lg:col-span-2 space-y-3">
            {filtered.map(t => {
              const statusColors = {
                active: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
                trial: 'bg-accent-50 text-accent-700 border-accent-200/50',
                suspended: 'bg-red-50 text-red-700 border-red-200/50',
              };
              return (
                <div key={t.id} onClick={() => setSelectedTenant(t.id)} className={`flex items-center gap-4 bg-background-50 rounded-xl border p-4 cursor-pointer transition-smooth ${selectedTenant === t.id ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60 hover:border-background-300/60'}`}>
                  <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
                    <span className="text-primary-700 font-bold text-sm">{t.code}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{t.name}</p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColors[t.status]}`}>{t.status}</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700 border border-secondary-200/50">{t.plan}</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Created {t.created} · Expires {t.expiry} · {t.orgs} organisations</p>
                  </div>
                  <div className="flex items-center gap-4 text-[12px] text-foreground-500 shrink-0">
                    <span><AppIcon className="ri-user-line mr-1"></AppIcon>{t.users}</span>
                    <span><AppIcon className="ri-graduation-cap-line mr-1"></AppIcon>{t.learners}</span>
                  </div>
                  <AppIcon className={`ri-arrow-right-s-line text-foreground-300 ${selectedTenant === t.id ? 'text-primary-500' : ''}`}></AppIcon>
                </div>
              );
            })}
          </div>

          {/* Tenant Detail */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 h-fit">
            {tenant ? (
              <div className="space-y-5">
                <div>
                  <div className="w-14 h-14 rounded-xl bg-primary-100 flex items-center justify-center mb-3">
                    <span className="text-primary-700 font-bold text-lg">{tenant.code}</span>
                  </div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{tenant.name}</h3>
                  <p className="text-[12px] text-foreground-500 mt-1">{tenant.plan} Plan · {tenant.status}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{tenant.users}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Users</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{tenant.learners}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Learners</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{tenant.orgs}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Orgs</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{tenant.features.length}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Features</p>
                  </div>
                </div>
                <div>
                  <h4 className="text-[12px] font-semibold text-foreground-700 mb-2">Enabled Features</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {tenant.features.map(f => (
                      <span key={f} className="text-[10px] font-semibold px-2 py-1 rounded-full bg-primary-50 text-primary-700 border border-primary-200/50">{f}</span>
                    ))}
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t border-foreground-200/60">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Created</span>
                    <span className="text-foreground-700 font-medium">{tenant.created}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Expires</span>
                    <span className="text-foreground-700 font-medium">{tenant.expiry}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Manage</button>
                  <button className="flex-1 px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">Suspend</button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <AppIcon className="ri-building-4-line text-foreground-300 text-xl"></AppIcon>
                </div>
                <p className="text-sm text-foreground-500">Select a tenant to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}