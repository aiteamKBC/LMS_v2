import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;

const MONTHLY_CYCLES = [
  {
    month: 'June 2026',
    learners: [
      { learner: 'Sophie Williams', initials: 'SW', status: 'completed' as const, coachingDate: '18 Jun', otjhSigned: true, reviewPrep: true, evidenceReview: true, ksbCheck: true, notes: 'All tasks completed. OTJH signed off.' },
      { learner: 'James Okonkwo', initials: 'JO', status: 'in-progress' as const, coachingDate: '12 Jun', otjhSigned: false, reviewPrep: false, evidenceReview: true, ksbCheck: false, notes: 'Intervention session scheduled. OTJH pending sign-off.' },
      { learner: 'Aisha Patel', initials: 'AP', status: 'in-progress' as const, coachingDate: '14 Jun', otjhSigned: false, reviewPrep: false, evidenceReview: false, ksbCheck: false, notes: 'Urgent intervention needed. No evidence for 3 weeks.' },
      { learner: 'Sarah Mitchell', initials: 'SM', status: 'completed' as const, coachingDate: '13 Jun', otjhSigned: true, reviewPrep: true, evidenceReview: true, ksbCheck: true, notes: 'All tasks completed on schedule.' },
      { learner: 'Emily Watson', initials: 'EW', status: 'completed' as const, coachingDate: '11 Jun', otjhSigned: true, reviewPrep: true, evidenceReview: true, ksbCheck: true, notes: 'High performer. Early EPA discussion held.' },
      { learner: 'David Chen', initials: 'DC', status: 'scheduled' as const, coachingDate: '16 Jun', otjhSigned: false, reviewPrep: false, evidenceReview: false, ksbCheck: false, notes: 'Coaching session scheduled.' },
      { learner: 'Liam Foster', initials: 'LF', status: 'scheduled' as const, coachingDate: '15 Jun', otjhSigned: false, reviewPrep: false, evidenceReview: false, ksbCheck: false, notes: 'Coaching session scheduled.' },
      { learner: 'Maya Kapoor', initials: 'MK', status: 'scheduled' as const, coachingDate: '17 Jun', otjhSigned: false, reviewPrep: false, evidenceReview: false, ksbCheck: false, notes: 'Onboarding coaching scheduled.' },
    ],
  },
  {
    month: 'May 2026',
    learners: [
      { learner: 'Sophie Williams', initials: 'SW', status: 'completed' as const, coachingDate: '21 May', otjhSigned: true, reviewPrep: true, evidenceReview: true, ksbCheck: true, notes: 'All completed.' },
      { learner: 'James Okonkwo', initials: 'JO', status: 'completed' as const, coachingDate: '15 May', otjhSigned: true, reviewPrep: true, evidenceReview: true, ksbCheck: true, notes: 'Completed but attendance concern noted.' },
      { learner: 'Sarah Mitchell', initials: 'SM', status: 'completed' as const, coachingDate: '16 May', otjhSigned: true, reviewPrep: true, evidenceReview: true, ksbCheck: true, notes: 'All completed.' },
      { learner: 'Emily Watson', initials: 'EW', status: 'completed' as const, coachingDate: '14 May', otjhSigned: true, reviewPrep: true, evidenceReview: true, ksbCheck: true, notes: 'All completed. Gateway readiness discussed.' },
    ],
  },
];

export default function CoachMonthlyCycle() {
  const [activeMonth, setActiveMonth] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const cycle = MONTHLY_CYCLES[activeMonth];
  const completed = cycle.learners.filter(l => l.status === 'completed').length;
  const inProgress = cycle.learners.filter(l => l.status === 'in-progress').length;
  const scheduled = cycle.learners.filter(l => l.status === 'scheduled').length;

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Monthly Cycle" pageSubtitle="Track monthly coaching cycles and completion status" userName="Med Maher" userRole="Progress Coach">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-loop-left-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Monthly Cycle — {cycle.month}</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{completed} completed</strong>, {inProgress} in progress, {scheduled} scheduled. {cycle.learners.length} learners in this cycle.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{completed}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Completed</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-amber-300">{inProgress}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">In Progress</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{scheduled}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Scheduled</p>
              </div>
            </div>
          </div>
        </div>

        {/* Month Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit">
          {MONTHLY_CYCLES.map((m, i) => (
            <button key={m.month} onClick={() => setActiveMonth(i)} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${activeMonth === i ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
              {m.month}
            </button>
          ))}
        </div>

        {/* Cycle Table */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
            <span>Learner</span>
            <span className="text-center">Status</span>
            <span className="text-center">Coaching</span>
            <span className="text-center">OTJH</span>
            <span className="text-center">Review</span>
            <span className="text-center">Evidence</span>
            <span className="text-center">KSB</span>
            <span className="text-center">Action</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {cycle.learners.map(row => (
              <div key={row.initials} className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3.5 items-center hover:bg-background-100/30 transition-smooth">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${row.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : row.status === 'in-progress' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'}`}>{row.initials}</div>
                  <span className="text-[12px] font-medium text-foreground-900">{row.learner}</span>
                </div>
                <div className="flex justify-center">
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${row.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : row.status === 'in-progress' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'}`}>{row.status}</span>
                </div>
                <span className="text-[11px] text-foreground-500 text-center">{row.coachingDate}</span>
                <div className="flex justify-center">
                  <i className={`${row.otjhSigned ? 'ri-check-line text-emerald-500' : 'ri-close-line text-red-400'} text-sm`}></i>
                </div>
                <div className="flex justify-center">
                  <i className={`${row.reviewPrep ? 'ri-check-line text-emerald-500' : 'ri-close-line text-red-400'} text-sm`}></i>
                </div>
                <div className="flex justify-center">
                  <i className={`${row.evidenceReview ? 'ri-check-line text-emerald-500' : 'ri-close-line text-red-400'} text-sm`}></i>
                </div>
                <div className="flex justify-center">
                  <i className={`${row.ksbCheck ? 'ri-check-line text-emerald-500' : 'ri-close-line text-red-400'} text-sm`}></i>
                </div>
                <div className="text-center">
                  <button className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">View</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}