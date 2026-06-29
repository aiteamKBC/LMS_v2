import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;

const MARKING_QUEUE = [
  { id: 'mk-1', learner: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive L4', module: 'Marketing Planning', title: 'Workplace Reflection — Segmentation', type: 'Reflection', submitted: '8 Jun 2026', due: '15 Jun 2026', wordCount: 1250, status: 'pending' as const, priority: 'normal' as const },
  { id: 'mk-2', learner: 'James Okonkwo', initials: 'JO', programme: 'Data Analyst L4', module: 'Data Analysis', title: 'Data Cleaning Report', type: 'Report', submitted: '7 Jun 2026', due: '14 Jun 2026', wordCount: 2800, status: 'pending' as const, priority: 'high' as const },
  { id: 'mk-3', learner: 'Aisha Patel', initials: 'AP', programme: 'Accountancy L3', module: 'Financial Accounting', title: 'Month-end Reconciliation', type: 'Workplace Evidence', submitted: '6 Jun 2026', due: '13 Jun 2026', wordCount: 800, status: 'pending' as const, priority: 'normal' as const },
  { id: 'mk-4', learner: 'Emily Watson', initials: 'EW', programme: 'Digital Marketer L3', module: 'Digital Channels', title: 'Social Media Campaign Results', type: 'Campaign Evidence', submitted: '5 Jun 2026', due: '12 Jun 2026', wordCount: 1500, status: 'in-progress' as const, priority: 'normal' as const },
  { id: 'mk-5', learner: 'Liam Foster', initials: 'LF', programme: 'Project Manager L4', module: 'Risk Management', title: 'Project Risk Register', type: 'Project Evidence', submitted: '4 Jun 2026', due: '11 Jun 2026', wordCount: 2200, status: 'pending' as const, priority: 'normal' as const },
  { id: 'mk-6', learner: 'Sarah Mitchell', initials: 'SM', programme: 'Business Administrator L3', module: 'Business Admin', title: 'Meeting Minutes — Board Prep', type: 'Workplace Evidence', submitted: '3 Jun 2026', due: '10 Jun 2026', wordCount: 600, status: 'pending' as const, priority: 'low' as const },
  { id: 'mk-7', learner: 'David Chen', initials: 'DC', programme: 'Software Developer L4', module: 'Software Development', title: 'Code Review Documentation', type: 'Documentation', submitted: '2 Jun 2026', due: '9 Jun 2026', wordCount: 1800, status: 'pending' as const, priority: 'normal' as const },
  { id: 'mk-8', learner: 'Maya Kapoor', initials: 'MK', programme: 'HR Consultant L5', module: 'HR Induction', title: 'Initial Assessment Reflection', type: 'Reflection', submitted: '1 Jun 2026', due: '8 Jun 2026', wordCount: 1000, status: 'pending' as const, priority: 'low' as const },
  { id: 'mk-9', learner: 'Oliver Thompson', initials: 'OT', programme: 'Business Admin L3', module: 'Business Communication', title: 'Email Portfolio', type: 'Portfolio', submitted: '31 May 2026', due: '7 Jun 2026', wordCount: 900, status: 'overdue' as const, priority: 'high' as const },
  { id: 'mk-10', learner: 'Grace Liu', initials: 'GL', programme: 'Data Analyst L4', module: 'Data Analysis', title: 'SQL Query Report', type: 'Report', submitted: '30 May 2026', due: '6 Jun 2026', wordCount: 1600, status: 'overdue' as const, priority: 'high' as const },
  { id: 'mk-11', learner: 'Isla Morgan', initials: 'IM', programme: 'Business Admin L3', module: 'Business Admin', title: 'Project Plan Document', type: 'Documentation', submitted: '29 May 2026', due: '5 Jun 2026', wordCount: 2000, status: 'overdue' as const, priority: 'normal' as const },
  { id: 'mk-12', learner: 'Harper Singh', initials: 'HS', programme: 'Accountancy L3', module: 'Financial Accounting', title: 'Budget Variance Analysis', type: 'Report', submitted: '28 May 2026', due: '4 Jun 2026', wordCount: 2400, status: 'overdue' as const, priority: 'high' as const },
];

export default function CoachMarkingQueue() {
  const [filter, setFilter] = useState<'all' | 'pending' | 'overdue' | 'in-progress'>('all');

  const filtered = MARKING_QUEUE.filter(m => filter === 'all' || m.status === filter);
  const pending = MARKING_QUEUE.filter(m => m.status === 'pending').length;
  const overdue = MARKING_QUEUE.filter(m => m.status === 'overdue').length;
  const inProgress = MARKING_QUEUE.filter(m => m.status === 'in-progress').length;

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Marking Queue" pageSubtitle="Review and mark learner assignments and evidence" userName="Med Maher" userRole="Progress Coach">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-edit-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Marking Queue</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{pending} pending</strong> items, {overdue} overdue, {inProgress} in progress. Oldest submission: 28 May 2026.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{MARKING_QUEUE.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Total</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-amber-300">{pending}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Pending</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-red-300">{overdue}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Overdue</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit">
          <button onClick={() => setFilter('all')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'all' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>All <span className="text-[10px] opacity-60">({MARKING_QUEUE.length})</span></button>
          <button onClick={() => setFilter('pending')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'pending' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Pending <span className="text-[10px] opacity-60">({pending})</span></button>
          <button onClick={() => setFilter('overdue')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'overdue' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Overdue <span className="text-[10px] opacity-60">({overdue})</span></button>
          <button onClick={() => setFilter('in-progress')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'in-progress' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>In Progress <span className="text-[10px] opacity-60">({inProgress})</span></button>
        </div>

        {/* Marking Table */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="grid grid-cols-[1.5fr_1fr_1.5fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
            <span>Learner</span>
            <span>Module</span>
            <span>Title</span>
            <span>Type</span>
            <span className="text-center">Submitted</span>
            <span className="text-center">Due</span>
            <span className="text-center">Words</span>
            <span className="text-center">Action</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(item => (
              <div key={item.id} className="grid grid-cols-[1.5fr_1fr_1.5fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3.5 items-center hover:bg-background-100/30 transition-smooth">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${item.status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-primary-100 text-primary-700'}`}>{item.initials}</div>
                  <div>
                    <p className="text-[12px] font-medium text-foreground-900">{item.learner}</p>
                    <p className="text-[10px] text-foreground-400">{item.programme}</p>
                  </div>
                </div>
                <span className="text-[11px] text-foreground-500">{item.module}</span>
                <span className="text-[11px] font-medium text-foreground-700 truncate">{item.title}</span>
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500 w-fit">{item.type}</span>
                <span className={`text-[11px] text-center ${item.status === 'overdue' ? 'text-red-600 font-medium' : 'text-foreground-500'}`}>{item.submitted}</span>
                <span className="text-[11px] text-foreground-500 text-center">{item.due}</span>
                <span className="text-[11px] text-foreground-500 text-center">{item.wordCount}</span>
                <div className="text-center">
                  <button className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Mark</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}