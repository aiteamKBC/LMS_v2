import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;

const EVIDENCE_ITEMS = [
  { id: 'ev-1', learner: 'Sophie Williams', initials: 'SW', title: 'Workplace Reflection — Segmentation', module: 'Marketing Planning', type: 'Reflection', ksb: 'K3, K4', submitted: '8 Jun 2026', status: 'pending' as const, quality: 'good' as const, aiScore: 78 },
  { id: 'ev-2', learner: 'James Okonkwo', initials: 'JO', title: 'Data Cleaning Report', module: 'Data Analysis', type: 'Report', ksb: 'K2, S3', submitted: '7 Jun 2026', status: 'pending' as const, quality: 'needs-work' as const, aiScore: 65 },
  { id: 'ev-3', learner: 'Aisha Patel', initials: 'AP', title: 'Month-end Reconciliation', module: 'Financial Accounting', type: 'Workplace Evidence', ksb: 'S1, B2', submitted: '6 Jun 2026', status: 'pending' as const, quality: 'good' as const, aiScore: 82 },
  { id: 'ev-4', learner: 'Emily Watson', initials: 'EW', title: 'Social Media Campaign Results', module: 'Digital Channels', type: 'Campaign Evidence', ksb: 'K5, S4, B3', submitted: '5 Jun 2026', status: 'pending' as const, quality: 'excellent' as const, aiScore: 92 },
  { id: 'ev-5', learner: 'Liam Foster', initials: 'LF', title: 'Project Risk Register', module: 'Risk Management', type: 'Project Evidence', ksb: 'K6, S5', submitted: '4 Jun 2026', status: 'pending' as const, quality: 'good' as const, aiScore: 72 },
  { id: 'ev-6', learner: 'Sarah Mitchell', initials: 'SM', title: 'Meeting Minutes — Board Prep', module: 'Business Admin', type: 'Workplace Evidence', ksb: 'B1, B2', submitted: '3 Jun 2026', status: 'pending' as const, quality: 'excellent' as const, aiScore: 85 },
  { id: 'ev-7', learner: 'David Chen', initials: 'DC', title: 'Code Review Documentation', module: 'Software Development', type: 'Documentation', ksb: 'S4, S5', submitted: '2 Jun 2026', status: 'pending' as const, quality: 'good' as const, aiScore: 88 },
  { id: 'ev-8', learner: 'Maya Kapoor', initials: 'MK', title: 'Initial Assessment Reflection', module: 'HR Induction', type: 'Reflection', ksb: 'K1, B1', submitted: '1 Jun 2026', status: 'pending' as const, quality: 'good' as const, aiScore: 70 },
  { id: 'ev-9', learner: 'Oliver Thompson', initials: 'OT', title: 'Email Portfolio', module: 'Business Communication', type: 'Portfolio', ksb: 'S2, B3', submitted: '31 May 2026', status: 'pending' as const, quality: 'needs-work' as const, aiScore: 68 },
  { id: 'ev-10', learner: 'Grace Liu', initials: 'GL', title: 'SQL Query Report', module: 'Data Analysis', type: 'Report', ksb: 'K2, S3', submitted: '30 May 2026', status: 'pending' as const, quality: 'good' as const, aiScore: 75 },
  { id: 'ev-11', learner: 'Isla Morgan', initials: 'IM', title: 'Project Plan Document', module: 'Business Admin', type: 'Documentation', ksb: 'S5, B4', submitted: '29 May 2026', status: 'pending' as const, quality: 'excellent' as const, aiScore: 90 },
  { id: 'ev-12', learner: 'Harper Singh', initials: 'HS', title: 'Budget Variance Analysis', module: 'Financial Accounting', type: 'Report', ksb: 'K4, S2', submitted: '28 May 2026', status: 'pending' as const, quality: 'good' as const, aiScore: 80 },
  { id: 'ev-13', learner: 'Zara Ahmed', initials: 'ZA', title: 'HR Policy Review', module: 'HR Induction', type: 'Workplace Evidence', ksb: 'K3, B2', submitted: '27 May 2026', status: 'pending' as const, quality: 'good' as const, aiScore: 77 },
  { id: 'ev-14', learner: 'Elias Wright', initials: 'EW', title: 'Data Dashboard', module: 'Data Analysis', type: 'Project Evidence', ksb: 'S3, S4', submitted: '26 May 2026', status: 'pending' as const, quality: 'excellent' as const, aiScore: 94 },
];

export default function CoachEvidenceValidation() {
  const [filter, setFilter] = useState<'all' | 'pending' | 'validated' | 'needs-work'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = EVIDENCE_ITEMS.filter(e => filter === 'all' || e.status === filter);
  const pending = EVIDENCE_ITEMS.filter(e => e.status === 'pending').length;
  const avgScore = Math.round(EVIDENCE_ITEMS.reduce((a, b) => a + b.aiScore, 0) / EVIDENCE_ITEMS.length);
  const excellent = EVIDENCE_ITEMS.filter(e => e.quality === 'excellent').length;

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Evidence Validation" pageSubtitle="Review and validate learner evidence submissions" userName="Med Maher" userRole="Progress Coach">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-shield-check-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Evidence Validation</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{pending} items</strong> awaiting validation. Average AI score: {avgScore}%. {excellent} rated excellent.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{EVIDENCE_ITEMS.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Total</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-amber-300">{pending}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Pending</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{avgScore}%</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Avg Score</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit">
          <button onClick={() => setFilter('all')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'all' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>All <span className="text-[10px] opacity-60">({EVIDENCE_ITEMS.length})</span></button>
          <button onClick={() => setFilter('pending')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'pending' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Pending <span className="text-[10px] opacity-60">({pending})</span></button>
          <button onClick={() => setFilter('needs-work')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'needs-work' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Needs Work</button>
        </div>

        {/* Evidence Grid */}
        <div className="space-y-3">
          {filtered.map(item => {
            const isOpen = expanded === item.id;
            return (
              <div key={item.id} className={`bg-background-50 rounded-xl border p-4 transition-smooth cursor-pointer ${isOpen ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60'}`} onClick={() => setExpanded(isOpen ? null : item.id)}>
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ring-2 ${item.quality === 'excellent' ? 'bg-accent-100 text-accent-700 ring-accent-200' : item.quality === 'needs-work' ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-primary-100 text-primary-700 ring-primary-200'}`}>
                    <span className="text-sm font-bold">{item.initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{item.title}</p>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${item.quality === 'excellent' ? 'bg-accent-100 text-accent-700' : item.quality === 'needs-work' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'}`}>{item.quality}</span>
                      <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500">AI: {item.aiScore}%</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{item.learner} · {item.module} · {item.type}</p>
                  </div>
                  <div className="hidden lg:flex items-center gap-4 text-[11px] text-foreground-500 shrink-0">
                    <span>KSB: {item.ksb}</span>
                    <span>{item.submitted}</span>
                  </div>
                  <i className={`${isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-foreground-300`}></i>
                </div>
                {isOpen && (
                  <div className="mt-4 ml-14 pt-3 border-t border-background-200/30 space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-foreground-400">KSB Mapping:</span>
                      <span className="text-[11px] font-medium text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full">{item.ksb}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-check-line mr-1"></i> Validate</button>
                      <button className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[11px] font-semibold hover:bg-amber-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-refresh-line mr-1"></i> Request Resubmission</button>
                      <button className="px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-[11px] font-medium hover:bg-red-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-close-line mr-1"></i> Reject</button>
                      <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-file-search-line mr-1"></i> View Evidence</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </WorkspaceShell>
  );
}