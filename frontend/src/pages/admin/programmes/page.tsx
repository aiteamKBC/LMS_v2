import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const PROGRAMMES_DATA = [
  { id: 'p1', standard: 'ST0070', name: 'Business Administrator', level: 'Level 3', duration: '18 months', active: true, learners: 14, ksbTotal: 27, ksbMapped: 27, ofsted: 'Good', status: 'active' as const },
  { id: 'p2', standard: 'ST0118', name: 'Digital Marketer', level: 'Level 3', duration: '18 months', active: true, learners: 8, ksbTotal: 24, ksbMapped: 24, ofsted: 'Good', status: 'active' as const },
  { id: 'p3', standard: 'ST0600', name: 'Data Analyst', level: 'Level 4', duration: '24 months', active: true, learners: 6, ksbTotal: 30, ksbMapped: 28, ofsted: 'Good', status: 'active' as const },
  { id: 'p4', standard: 'ST0120', name: 'Software Developer', level: 'Level 4', duration: '24 months', active: true, learners: 5, ksbTotal: 32, ksbMapped: 30, ofsted: 'Outstanding', status: 'active' as const },
  { id: 'p5', standard: 'ST0330', name: 'Project Manager', level: 'Level 4', duration: '24 months', active: true, learners: 4, ksbTotal: 28, ksbMapped: 26, ofsted: 'Good', status: 'active' as const },
  { id: 'p6', standard: 'ST0470', name: 'Operations Manager', level: 'Level 5', duration: '30 months', active: true, learners: 3, ksbTotal: 35, ksbMapped: 32, ofsted: 'Good', status: 'active' as const },
  { id: 'p7', standard: 'ST0301', name: 'Customer Service Practitioner', level: 'Level 2', duration: '12 months', active: false, learners: 0, ksbTotal: 18, ksbMapped: 18, ofsted: 'Good', status: 'draft' as const },
  { id: 'p8', standard: 'ST0310', name: 'Team Leader / Supervisor', level: 'Level 3', duration: '18 months', active: false, learners: 0, ksbTotal: 22, ksbMapped: 20, ofsted: 'Requires Improvement', status: 'draft' as const },
];

export default function AdminProgrammesPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedProgramme, setSelectedProgramme] = useState<string | null>(null);

  const activeCount = PROGRAMMES_DATA.filter(p => p.status === 'active').length;
  const totalLearners = PROGRAMMES_DATA.reduce((a, b) => a + b.learners, 0);
  const totalKSBs = PROGRAMMES_DATA.reduce((a, b) => a + b.ksbTotal, 0);
  const mappedKSBs = PROGRAMMES_DATA.reduce((a, b) => a + b.ksbMapped, 0);

  const filtered = PROGRAMMES_DATA.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.standard.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const prog = selectedProgramme ? PROGRAMMES_DATA.find(p => p.id === selectedProgramme) : null;

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Programmes" pageSubtitle="Apprenticeship standards, KSB mapping, and programme configuration" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <AppIcon className="ri-stack-line text-white text-2xl"></AppIcon>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Programme Directory</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{PROGRAMMES_DATA.length} programmes</strong> — {activeCount} active. {totalLearners} learners enrolled. {mappedKSBs}/{totalKSBs} KSBs mapped.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{PROGRAMMES_DATA.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Programmes</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalLearners}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Learners</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{Math.round(mappedKSBs / totalKSBs * 100)}%</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">KSB Mapped</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 w-full lg:w-auto">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
            <input type="text" placeholder="Search programmes or standards..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
          </div>
          <div className="flex items-center gap-2">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
            </select>
            <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-add-line mr-1.5"></AppIcon> New Programme
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Programmes List */}
          <div className="lg:col-span-2 space-y-3">
            {filtered.map(p => {
              const statusColors = {
                active: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
                draft: 'bg-background-100 text-foreground-500 border-foreground-200/60',
              };
              const ksbPct = Math.round(p.ksbMapped / p.ksbTotal * 100);
              return (
                <div key={p.id} onClick={() => setSelectedProgramme(p.id)} className={`flex items-center gap-4 bg-background-50 rounded-xl border p-4 cursor-pointer transition-smooth ${selectedProgramme === p.id ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60 hover:border-background-300/60'}`}>
                  <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
                    <span className="text-primary-700 font-bold text-[10px]">{p.standard}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{p.name}</p>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700 border border-secondary-200/50">{p.level}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColors[p.status]}`}>{p.status}</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{p.duration} · {p.ksbMapped}/{p.ksbTotal} KSBs · Ofsted: {p.ofsted}</p>
                  </div>
                  <div className="flex items-center gap-4 text-[12px] text-foreground-500 shrink-0">
                    <span><AppIcon className="ri-graduation-cap-line mr-1"></AppIcon>{p.learners}</span>
                    <div className="w-16 h-1.5 bg-background-200 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full" style={{ width: `${ksbPct}%` }}></div>
                    </div>
                    <span className="text-[10px]">{ksbPct}%</span>
                  </div>
                  <AppIcon className={`ri-arrow-right-s-line text-foreground-300 ${selectedProgramme === p.id ? 'text-primary-500' : ''}`}></AppIcon>
                </div>
              );
            })}
          </div>

          {/* Programme Detail */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 h-fit">
            {prog ? (
              <div className="space-y-5">
                <div>
                  <div className="w-14 h-14 rounded-xl bg-primary-100 flex items-center justify-center mb-3">
                    <span className="text-primary-700 font-bold text-sm">{prog.standard}</span>
                  </div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{prog.name}</h3>
                  <p className="text-[12px] text-foreground-500 mt-1">{prog.level} · {prog.duration} · Standard {prog.standard}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{prog.learners}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Learners</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{prog.ksbTotal}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">KSBs</p>
                  </div>
                </div>
                <div>
                  <h4 className="text-[12px] font-semibold text-foreground-700 mb-2">KSB Mapping</h4>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-background-200 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full" style={{ width: `${Math.round(prog.ksbMapped / prog.ksbTotal * 100)}%` }}></div>
                    </div>
                    <span className="text-[11px] font-semibold text-foreground-700">{prog.ksbMapped}/{prog.ksbTotal}</span>
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t border-foreground-200/60">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Ofsted Rating</span>
                    <span className="text-foreground-700 font-medium">{prog.ofsted}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Status</span>
                    <span className="text-foreground-700 font-medium capitalize">{prog.status}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Edit Programme</button>
                  <button className="flex-1 px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">KSB Mapping</button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <AppIcon className="ri-stack-line text-foreground-300 text-xl"></AppIcon>
                </div>
                <p className="text-sm text-foreground-500">Select a programme to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}