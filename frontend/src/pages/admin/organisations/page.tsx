import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const ORGS_DATA = [
  { id: 'o1', name: 'Kent Business College', type: 'provider' as const, parent: null, users: 45, learners: 32, departments: ['Business School', 'Tech Academy', 'Health & Social'] },
  { id: 'o2', name: 'Business School', type: 'department' as const, parent: 'Kent Business College', users: 18, learners: 14, departments: [] },
  { id: 'o3', name: 'Tech Academy', type: 'department' as const, parent: 'Kent Business College', users: 12, learners: 10, departments: [] },
  { id: 'o4', name: 'Health & Social Care', type: 'department' as const, parent: 'Kent Business College', users: 8, learners: 6, departments: [] },
  { id: 'o5', name: 'Tim Hortons UK', type: 'employer' as const, parent: null, users: 3, learners: 2, departments: ['Operations', 'Marketing'] },
  { id: 'o6', name: 'Unilever UK', type: 'employer' as const, parent: null, users: 2, learners: 1, departments: ['Marketing'] },
  { id: 'o7', name: 'Tesco PLC', type: 'employer' as const, parent: null, users: 4, learners: 3, departments: ['HR', 'Retail'] },
  { id: 'o8', name: 'Kent County Council', type: 'employer' as const, parent: null, users: 5, learners: 4, departments: ['IT', 'Admin'] },
];

export default function AdminOrganisationsPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);

  const providerCount = ORGS_DATA.filter(o => o.type === 'provider').length;
  const deptCount = ORGS_DATA.filter(o => o.type === 'department').length;
  const employerCount = ORGS_DATA.filter(o => o.type === 'employer').length;
  const totalLearners = ORGS_DATA.reduce((a, b) => a + b.learners, 0);

  const filtered = ORGS_DATA.filter(o => {
    const matchSearch = o.name.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === 'all' || o.type === typeFilter;
    return matchSearch && matchType;
  });

  const org = selectedOrg ? ORGS_DATA.find(o => o.id === selectedOrg) : null;

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Organisations" pageSubtitle="Organisation hierarchy — providers, departments, and employers" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <AppIcon className="ri-building-line text-white text-2xl"></AppIcon>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Organisation Structure</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{ORGS_DATA.length} organisations</strong> — {providerCount} providers, {deptCount} departments, {employerCount} employers. {totalLearners} learners linked.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{providerCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Providers</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{deptCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Depts</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{employerCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Employers</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 w-full lg:w-auto">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
            <input type="text" placeholder="Search organisations..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
          </div>
          <div className="flex items-center gap-2">
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Types</option>
              <option value="provider">Providers</option>
              <option value="department">Departments</option>
              <option value="employer">Employers</option>
            </select>
            <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-add-line mr-1.5"></AppIcon> Add Organisation
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Orgs List */}
          <div className="lg:col-span-2 space-y-3">
            {filtered.map(o => {
              const typeIcons = { provider: 'ri-building-4-line', department: 'ri-stack-line', employer: 'ri-building-2-line' };
              const typeColors = { provider: 'bg-primary-100 text-primary-600', department: 'bg-secondary-100 text-secondary-600', employer: 'bg-accent-100 text-accent-600' };
              const typeLabels = { provider: 'Provider', department: 'Department', employer: 'Employer' };
              return (
                <div key={o.id} onClick={() => setSelectedOrg(o.id)} className={`flex items-center gap-4 bg-background-50 rounded-xl border p-4 cursor-pointer transition-smooth ${selectedOrg === o.id ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60 hover:border-background-300/60'}`}>
                  <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${typeColors[o.type]}`}>
                    <AppIcon className={`${typeIcons[o.type]} text-sm`}></AppIcon>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{o.name}</p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${typeColors[o.type].replace('bg-', 'bg-').replace('text-', 'text-').split(' ')[0].replace('bg-', 'bg-').replace('100', '50')} ${typeColors[o.type].split(' ')[1]} border-current opacity-30`}>{typeLabels[o.type]}</span>
                    </div>
                    {o.parent && <p className="text-[11px] text-foreground-400 mt-0.5">Parent: {o.parent}</p>}
                    {!o.parent && o.departments.length > 0 && <p className="text-[11px] text-foreground-400 mt-0.5">{o.departments.length} sub-units</p>}
                  </div>
                  <div className="flex items-center gap-4 text-[12px] text-foreground-500 shrink-0">
                    <span><AppIcon className="ri-user-line mr-1"></AppIcon>{o.users}</span>
                    <span><AppIcon className="ri-graduation-cap-line mr-1"></AppIcon>{o.learners}</span>
                  </div>
                  <AppIcon className={`ri-arrow-right-s-line text-foreground-300 ${selectedOrg === o.id ? 'text-primary-500' : ''}`}></AppIcon>
                </div>
              );
            })}
          </div>

          {/* Org Detail */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 h-fit">
            {org ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{org.name}</h3>
                  <p className="text-[12px] text-foreground-500 mt-1 capitalize">{org.type}{org.parent ? ` · Under ${org.parent}` : ''}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{org.users}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Users</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{org.learners}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Learners</p>
                  </div>
                </div>
                {org.departments.length > 0 && (
                  <div>
                    <h4 className="text-[12px] font-semibold text-foreground-700 mb-2">Sub-units</h4>
                    <div className="space-y-1">
                      {org.departments.map(d => (
                        <div key={d} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-background-100 text-[12px] text-foreground-600">
                          <AppIcon className="ri-stack-line text-foreground-400 text-xs"></AppIcon>
                          {d}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Edit</button>
                  <button className="flex-1 px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">View Users</button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <AppIcon className="ri-building-line text-foreground-300 text-xl"></AppIcon>
                </div>
                <p className="text-sm text-foreground-500">Select an organisation to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}