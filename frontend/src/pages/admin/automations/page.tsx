import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const AUTOMATIONS_DATA = [
  { id: 'a1', name: 'New Learner Welcome Sequence', trigger: 'Learner Enrolled', actions: 4, runs: 124, status: 'active' as const, lastRun: '10 Jun 2026', nextRun: '11 Jun 2026' },
  { id: 'a2', name: 'Absence Alert to Coach', trigger: 'Absence Reported', actions: 3, runs: 34, status: 'active' as const, lastRun: '9 Jun 2026', nextRun: 'On trigger' },
  { id: 'a3', name: 'Monthly OTJH Reminder', trigger: 'Monthly (1st)', actions: 2, runs: 86, status: 'active' as const, lastRun: '1 Jun 2026', nextRun: '1 Jul 2026' },
  { id: 'a4', name: 'Progress Review Due Alert', trigger: 'Review Date -7d', actions: 3, runs: 42, status: 'active' as const, lastRun: '8 Jun 2026', nextRun: '15 Jun 2026' },
  { id: 'a5', name: 'Evidence Validation Reminder', trigger: 'Evidence Pending 48h', actions: 2, runs: 67, status: 'active' as const, lastRun: '7 Jun 2026', nextRun: 'On trigger' },
  { id: 'a6', name: 'Gateway Readiness Check', trigger: 'Gateway -90d', actions: 5, runs: 12, status: 'active' as const, lastRun: '5 Jun 2026', nextRun: 'On trigger' },
  { id: 'a7', name: 'Employer Monthly Update', trigger: 'Monthly (15th)', actions: 2, runs: 28, status: 'active' as const, lastRun: '15 May 2026', nextRun: '15 Jun 2026' },
  { id: 'a8', name: 'KSB Amber Alert', trigger: 'KSB Status = Amber', actions: 3, runs: 8, status: 'active' as const, lastRun: '3 Jun 2026', nextRun: 'On trigger' },
  { id: 'a9', name: 'Low Attendance Escalation', trigger: 'Attendance < 85%', actions: 4, runs: 5, status: 'paused' as const, lastRun: '1 Jun 2026', nextRun: 'On trigger' },
  { id: 'a10', name: 'Completion Certificate Auto-Issue', trigger: 'Gateway Complete', actions: 3, runs: 0, status: 'draft' as const, lastRun: '-', nextRun: 'On trigger' },
];

export default function AdminAutomationsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedAutomation, setSelectedAutomation] = useState<string | null>(null);

  const activeCount = AUTOMATIONS_DATA.filter(a => a.status === 'active').length;
  const totalRuns = AUTOMATIONS_DATA.reduce((a, b) => a + b.runs, 0);

  const filtered = AUTOMATIONS_DATA.filter(a => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || a.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const auto = selectedAutomation ? AUTOMATIONS_DATA.find(a => a.id === selectedAutomation) : null;

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Automations" pageSubtitle="Workflow automation, triggers, and scheduled actions" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-settings-4-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Automation Workflows</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{AUTOMATIONS_DATA.length} automations</strong> — {activeCount} active. {totalRuns} total runs executed.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{AUTOMATIONS_DATA.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Workflows</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalRuns}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Total Runs</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 w-full lg:w-auto">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
            <input type="text" placeholder="Search automations..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
          </div>
          <div className="flex items-center gap-2">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="draft">Draft</option>
            </select>
            <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-add-line mr-1.5"></i> New Workflow
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Automations List */}
          <div className="lg:col-span-2 space-y-3">
            {filtered.map(a => {
              const statusColors = {
                active: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
                paused: 'bg-accent-50 text-accent-700 border-accent-200/50',
                draft: 'bg-background-100 text-foreground-500 border-foreground-200/60',
              };
              return (
                <div key={a.id} onClick={() => setSelectedAutomation(a.id)} className={`flex items-center gap-4 bg-background-50 rounded-xl border p-4 cursor-pointer transition-smooth ${selectedAutomation === a.id ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60 hover:border-background-300/60'}`}>
                  <div className="w-10 h-10 rounded-lg bg-secondary-100 flex items-center justify-center shrink-0">
                    <i className="ri-settings-4-line text-secondary-600 text-sm"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{a.name}</p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColors[a.status]}`}>{a.status}</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Trigger: {a.trigger} · {a.actions} actions · Last run: {a.lastRun}</p>
                  </div>
                  <div className="text-[12px] text-foreground-500 shrink-0">
                    <span><i className="ri-play-line mr-1"></i>{a.runs} runs</span>
                  </div>
                  <i className={`ri-arrow-right-s-line text-foreground-300 ${selectedAutomation === a.id ? 'text-primary-500' : ''}`}></i>
                </div>
              );
            })}
          </div>

          {/* Automation Detail */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 h-fit">
            {auto ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{auto.name}</h3>
                  <p className="text-[12px] text-foreground-500 mt-1">Trigger: {auto.trigger}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{auto.runs}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Runs</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{auto.actions}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Actions</p>
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t border-foreground-200/60">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Status</span>
                    <span className="text-foreground-700 font-medium capitalize">{auto.status}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Last Run</span>
                    <span className="text-foreground-700 font-medium">{auto.lastRun}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Next Run</span>
                    <span className="text-foreground-700 font-medium">{auto.nextRun}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Edit Workflow</button>
                  <button className="flex-1 px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">Run History</button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <i className="ri-settings-4-line text-foreground-300 text-xl"></i>
                </div>
                <p className="text-sm text-foreground-500">Select a workflow to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}