import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const EMPLOYERS_DATA = [
  { id: 'e1', name: 'Tim Hortons UK', industry: 'Food & Beverage', size: '500+ employees', activeApprentices: 2, totalApprentices: 4, status: 'active' as const, contact: 'Lauren Mitchell', email: 'lauren.mitchell@timhortons.co.uk', phone: '+44 20 7946 0123', address: 'London, UK', contracts: ['2025-001', '2024-003'] },
  { id: 'e2', name: 'Unilever UK', industry: 'Consumer Goods', size: '5000+ employees', activeApprentices: 1, totalApprentices: 8, status: 'active' as const, contact: 'Rebecca Okonkwo', email: 'rebecca.okonkwo@unilever.co.uk', phone: '+44 20 7822 5252', address: 'London, UK', contracts: ['2025-002'] },
  { id: 'e3', name: 'Tesco PLC', industry: 'Retail', size: '10000+ employees', activeApprentices: 3, totalApprentices: 12, status: 'active' as const, contact: 'Sarah Chen', email: 'sarah.chen@tesco.co.uk', phone: '+44 800 505 555', address: 'Welwyn Garden City, UK', contracts: ['2024-001', '2025-004', '2025-005'] },
  { id: 'e4', name: 'Kent County Council', industry: 'Public Sector', size: '5000+ employees', activeApprentices: 4, totalApprentices: 14, status: 'active' as const, contact: 'James Peterson', email: 'j.peterson@kent.gov.uk', phone: '+44 300 041 4141', address: 'Maidstone, UK', contracts: ['2023-002', '2024-005', '2025-006', '2025-007'] },
  { id: 'e5', name: 'NHS Foundation Trust', industry: 'Healthcare', size: '2000+ employees', activeApprentices: 0, totalApprentices: 3, status: 'pending' as const, contact: 'Dr. Aisha Patel', email: 'a.patel@nhs.uk', phone: '+44 20 3456 7890', address: 'London, UK', contracts: [] },
  { id: 'e6', name: 'British Telecom', industry: 'Telecommunications', size: '10000+ employees', activeApprentices: 0, totalApprentices: 0, status: 'draft' as const, contact: 'Mark Thompson', email: 'm.thompson@bt.com', phone: '+44 800 800 150', address: 'London, UK', contracts: [] },
];

export default function AdminEmployersPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedEmployer, setSelectedEmployer] = useState<string | null>(null);

  const activeCount = EMPLOYERS_DATA.filter(e => e.status === 'active').length;
  const totalActiveApprentices = EMPLOYERS_DATA.reduce((a, b) => a + b.activeApprentices, 0);
  const totalContracts = EMPLOYERS_DATA.reduce((a, b) => a + b.contracts.length, 0);

  const filtered = EMPLOYERS_DATA.filter(e => {
    const matchSearch = e.name.toLowerCase().includes(search.toLowerCase()) || e.industry.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || e.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const emp = selectedEmployer ? EMPLOYERS_DATA.find(e => e.id === selectedEmployer) : null;

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Employers" pageSubtitle="Employer directory — contracting, apprentices, and contacts" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-building-2-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Employer Directory</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{EMPLOYERS_DATA.length} employers</strong> — {activeCount} active. {totalActiveApprentices} active apprentices across {totalContracts} contracts.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{EMPLOYERS_DATA.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Employers</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalActiveApprentices}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Apprentices</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalContracts}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Contracts</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 w-full lg:w-auto">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
            <input type="text" placeholder="Search employers..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
          </div>
          <div className="flex items-center gap-2">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="draft">Draft</option>
            </select>
            <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-add-line mr-1.5"></i> Add Employer
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Employers List */}
          <div className="lg:col-span-2 space-y-3">
            {filtered.map(e => {
              const statusColors = {
                active: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
                pending: 'bg-accent-50 text-accent-700 border-accent-200/50',
                draft: 'bg-background-100 text-foreground-500 border-foreground-200/60',
              };
              return (
                <div key={e.id} onClick={() => setSelectedEmployer(e.id)} className={`flex items-center gap-4 bg-background-50 rounded-xl border p-4 cursor-pointer transition-smooth ${selectedEmployer === e.id ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60 hover:border-background-300/60'}`}>
                  <div className="w-12 h-12 rounded-xl bg-accent-100 flex items-center justify-center shrink-0">
                    <span className="text-accent-700 font-bold text-sm">{e.name.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{e.name}</p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColors[e.status]}`}>{e.status}</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{e.industry} · {e.size} · {e.address}</p>
                  </div>
                  <div className="flex items-center gap-4 text-[12px] text-foreground-500 shrink-0">
                    <span><i className="ri-graduation-cap-line mr-1"></i>{e.activeApprentices}/{e.totalApprentices}</span>
                    <span><i className="ri-file-text-line mr-1"></i>{e.contracts.length}</span>
                  </div>
                  <i className={`ri-arrow-right-s-line text-foreground-300 ${selectedEmployer === e.id ? 'text-primary-500' : ''}`}></i>
                </div>
              );
            })}
          </div>

          {/* Employer Detail */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 h-fit">
            {emp ? (
              <div className="space-y-5">
                <div>
                  <div className="w-14 h-14 rounded-xl bg-accent-100 flex items-center justify-center mb-3">
                    <span className="text-accent-700 font-bold text-lg">{emp.name.charAt(0)}</span>
                  </div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{emp.name}</h3>
                  <p className="text-[12px] text-foreground-500 mt-1">{emp.industry} · {emp.size}</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[12px]">
                    <i className="ri-user-line text-foreground-400 text-xs w-4"></i>
                    <span className="text-foreground-600">{emp.contact}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[12px]">
                    <i className="ri-mail-line text-foreground-400 text-xs w-4"></i>
                    <span className="text-foreground-600">{emp.email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[12px]">
                    <i className="ri-phone-line text-foreground-400 text-xs w-4"></i>
                    <span className="text-foreground-600">{emp.phone}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[12px]">
                    <i className="ri-map-pin-line text-foreground-400 text-xs w-4"></i>
                    <span className="text-foreground-600">{emp.address}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{emp.activeApprentices}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Active</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{emp.totalApprentices}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Total</p>
                  </div>
                </div>
                {emp.contracts.length > 0 && (
                  <div>
                    <h4 className="text-[12px] font-semibold text-foreground-700 mb-2">Contracts</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {emp.contracts.map(c => (
                        <span key={c} className="text-[10px] font-semibold px-2 py-1 rounded-full bg-primary-50 text-primary-700 border border-primary-200/50">{c}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Edit</button>
                  <button className="flex-1 px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">View Apprentices</button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <i className="ri-building-2-line text-foreground-300 text-xl"></i>
                </div>
                <p className="text-sm text-foreground-500">Select an employer to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}