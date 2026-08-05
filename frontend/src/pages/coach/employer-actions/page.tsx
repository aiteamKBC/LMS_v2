import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;

const EMPLOYER_ACTIONS = [
  { id: 'ea-1', employer: 'Tim Hortons UK', contact: 'Lauren Mitchell', email: 'lauren.mitchell@timhortons.co.uk', action: 'OTJH Sign-off Required', learner: 'Sophie Williams', due: '15 Jun 2026', status: 'pending' as const, priority: 'high' as const, notes: 'Monthly OTJH confirmation overdue by 5 days' },
  { id: 'ea-2', employer: 'Medway NHS Trust', contact: 'Dr. Sarah Owens', email: 's.owens@medway.nhs.uk', action: 'Employer Agreement Missing', learner: 'James Okonkwo', due: '20 Jun 2026', status: 'pending' as const, priority: 'high' as const, notes: 'Contract still not signed after 3 reminders' },
  { id: 'ea-3', employer: 'Kent County Council', contact: 'Mark Davies', email: 'm.davies@kent.gov.uk', action: 'Progress Review Sign-off', learner: 'Sarah Mitchell', due: '22 Jun 2026', status: 'completed' as const, priority: 'normal' as const, notes: 'Signed and returned on time' },
  { id: 'ea-4', employer: 'Canterbury Creative', contact: 'Amy Chen', email: 'amy@canterburycreative.com', action: 'Progress Review Sign-off', learner: 'Emily Watson', due: '20 Jun 2026', status: 'completed' as const, priority: 'normal' as const, notes: 'Signed and returned on time' },
  { id: 'ea-5', employer: 'BAM Construction', contact: 'Peter Walsh', email: 'p.walsh@bam.co.uk', action: 'Workplace Mentor Check', learner: 'Liam Foster', due: '25 Jun 2026', status: 'pending' as const, priority: 'normal' as const, notes: 'Awaiting mentor availability confirmation' },
  { id: 'ea-6', employer: 'Tech Kent Ltd', contact: 'Rachel Kim', email: 'rachel@techkent.co.uk', action: 'OTJH Sign-off Required', learner: 'David Chen', due: '18 Jun 2026', status: 'pending' as const, priority: 'normal' as const, notes: 'Monthly OTJH confirmation pending' },
];

export default function CoachEmployerActions() {
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');

  const filtered = EMPLOYER_ACTIONS.filter(a => filter === 'all' || a.status === filter);
  const pending = EMPLOYER_ACTIONS.filter(a => a.status === 'pending').length;
  const completed = EMPLOYER_ACTIONS.filter(a => a.status === 'completed').length;
  const highPriority = EMPLOYER_ACTIONS.filter(a => a.priority === 'high').length;

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Employer Actions" pageSubtitle="Track employer commitments and required actions" userName="Med Maher" userRole="Progress Coach">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <AppIcon className="ri-building-2-line text-white text-2xl"></AppIcon>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Employer Actions</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{pending} pending</strong> actions, {completed} completed. {highPriority} high priority items requiring escalation.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{EMPLOYER_ACTIONS.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Total</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-amber-300">{pending}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Pending</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-red-300">{highPriority}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">High Priority</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit">
          <button onClick={() => setFilter('all')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'all' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>All <span className="text-[10px] opacity-60">({EMPLOYER_ACTIONS.length})</span></button>
          <button onClick={() => setFilter('pending')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'pending' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Pending <span className="text-[10px] opacity-60">({pending})</span></button>
          <button onClick={() => setFilter('completed')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'completed' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Completed <span className="text-[10px] opacity-60">({completed})</span></button>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          {filtered.map(action => (
            <div key={action.id} className={`bg-background-50 rounded-xl border p-4 card-premium transition-smooth ${action.status === 'pending' ? 'border-amber-200/50' : 'border-foreground-200/60'}`}>
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ring-2 ${action.priority === 'high' ? 'bg-red-100 text-red-700 ring-red-200' : 'bg-primary-100 text-primary-700 ring-primary-200'}`}>
                  <AppIcon className="ri-building-2-line text-sm"></AppIcon>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground-900">{action.action}</p>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${action.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{action.status}</span>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${action.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-primary-100 text-primary-700'}`}>{action.priority}</span>
                  </div>
                  <p className="text-[11px] text-foreground-400 mt-0.5">{action.employer} · {action.learner} · Due: {action.due}</p>
                </div>
                <div className="hidden lg:flex items-center gap-4 text-[11px] text-foreground-500 shrink-0">
                  <span>{action.contact}</span>
                  <span>{action.email}</span>
                </div>
              </div>
              <div className="ml-14 mt-2 flex items-center gap-2">
                <span className="text-[11px] text-foreground-400"><AppIcon className="ri-information-line mr-1"></AppIcon>{action.notes}</span>
              </div>
              <div className="ml-14 mt-3 flex items-center gap-2">
                {action.status === 'pending' && (
                  <>
                    <button className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-check-line mr-1"></AppIcon> Mark Complete</button>
                    <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-mail-line mr-1"></AppIcon> Send Reminder</button>
                    <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-phone-line mr-1"></AppIcon> Call Employer</button>
                  </>
                )}
                {action.status === 'completed' && (
                  <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-file-search-line mr-1"></AppIcon> View Record</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}