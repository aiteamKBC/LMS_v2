import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const tutorNav = roleNavMap.tutor;

interface OTJHClaim {
  id: string;
  learner: string;
  programme: string;
  weekEnding: string;
  hoursClaimed: number;
  description: string;
  category: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Amended';
  employerConfirmed: boolean;
}

const OTJH_CLAIMS: OTJHClaim[] = [
  { id: 'otj-01', learner: 'Sophie Williams', programme: 'Marketing Executive L4', weekEnding: '8 Jun 2026', hoursClaimed: 6.5, description: 'Market research project and segmentation worksheet completion', category: 'Project Work', status: 'Pending', employerConfirmed: true },
  { id: 'otj-02', learner: 'James Okonkwo', programme: 'Data Analyst L4', weekEnding: '8 Jun 2026', hoursClaimed: 4, description: 'Python data cleaning exercises and SQL practice', category: 'Technical Practice', status: 'Pending', employerConfirmed: false },
  { id: 'otj-03', learner: 'Aisha Patel', programme: 'Accountancy L3', weekEnding: '8 Jun 2026', hoursClaimed: 7, description: 'Financial statements analysis and reconciliation practice', category: 'Assignment Work', status: 'Pending', employerConfirmed: true },
  { id: 'otj-04', learner: 'Sarah Mitchell', programme: 'Business Admin L3', weekEnding: '1 Jun 2026', hoursClaimed: 6, description: 'Board meeting preparation and minute-taking practice', category: 'Workplace Activity', status: 'Approved', employerConfirmed: true },
  { id: 'otj-05', learner: 'Liam Foster', programme: 'Project Manager L4', weekEnding: '8 Jun 2026', hoursClaimed: 5.5, description: 'Risk register development and stakeholder mapping', category: 'Project Work', status: 'Pending', employerConfirmed: true },
  { id: 'otj-06', learner: 'Emily Watson', programme: 'Digital Marketer L3', weekEnding: '1 Jun 2026', hoursClaimed: 8, description: 'Social media campaign design and analytics review', category: 'Campaign Work', status: 'Approved', employerConfirmed: true },
  { id: 'otj-07', learner: 'David Chen', programme: 'Software Developer L4', weekEnding: '8 Jun 2026', hoursClaimed: 5, description: 'Code documentation and peer review participation', category: 'Technical Practice', status: 'Pending', employerConfirmed: true },
  { id: 'otj-08', learner: 'Maya Kapoor', programme: 'HR Consultant L5', weekEnding: '8 Jun 2026', hoursClaimed: 3, description: 'HR policy research and summary write-up', category: 'Research', status: 'Amended', employerConfirmed: true },
  { id: 'otj-09', learner: 'Omar Hassan', programme: 'Business Admin L3', weekEnding: '1 Jun 2026', hoursClaimed: 6.5, description: 'Office workflow documentation and process mapping', category: 'Workplace Activity', status: 'Rejected', employerConfirmed: false },
  { id: 'otj-10', learner: 'Chloe Evans', programme: 'Digital Marketer L3', weekEnding: '8 Jun 2026', hoursClaimed: 7, description: 'Email marketing campaign build and A/B test setup', category: 'Campaign Work', status: 'Pending', employerConfirmed: true },
];

export default function TutorOtjhValidationPage() {
  const [filter, setFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [amendedHours, setAmendedHours] = useState('');

  const filtered = filter === 'all' ? OTJH_CLAIMS : OTJH_CLAIMS.filter(c => c.status.toLowerCase() === filter.toLowerCase());
  const pendingCount = OTJH_CLAIMS.filter(c => c.status === 'Pending').length;
  const totalHours = OTJH_CLAIMS.reduce((s, c) => s + c.hoursClaimed, 0);
  const unconfirmed = OTJH_CLAIMS.filter(c => !c.employerConfirmed).length;

  const statusConfig: Record<string, { bg: string }> = {
    Pending: { bg: 'bg-amber-100 text-amber-700' },
    Approved: { bg: 'bg-emerald-100 text-emerald-700' },
    Rejected: { bg: 'bg-red-100 text-red-700' },
    Amended: { bg: 'bg-accent-100 text-accent-700' },
  };

  return (
    <WorkspaceShell role="tutor" roleLabel={tutorNav.label} navItems={tutorNav.items} workspaceLabel={tutorNav.workspaceLabel} pageTitle="OTJH Validation" pageSubtitle="Review and validate off-the-job training hour claims submitted by learners" userName="Rachel Myers" userRole="Business Admin Tutor">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-time-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">OTJH Validation Queue</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">{pendingCount} claims awaiting review · {totalHours} total hours claimed · {unconfirmed} employer confirmations missing</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{OTJH_CLAIMS.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Claims</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-amber-300">{pendingCount}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Pending</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{totalHours}h</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Total Hours</p></div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { l: 'Pending Review', v: String(pendingCount), i: 'ri-hourglass-line', c: 'amber' },
            { l: 'Approved This Month', v: String(OTJH_CLAIMS.filter(c => c.status === 'Approved').length), i: 'ri-check-double-line', c: 'emerald' },
            { l: 'Missing Employer OK', v: String(unconfirmed), i: 'ri-building-line', c: 'red' },
            { l: 'Avg Hours/Claim', v: `${(totalHours / OTJH_CLAIMS.length).toFixed(1)}h`, i: 'ri-bar-chart-line', c: 'primary' },
          ].map(s => (
            <div key={s.l} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 cursor-pointer">
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${s.c === 'amber' ? 'bg-amber-100 text-amber-600' : s.c === 'emerald' ? 'bg-emerald-100 text-emerald-600' : s.c === 'red' ? 'bg-red-100 text-red-600' : 'bg-primary-100 text-primary-600'}`}><i className={`${s.i} text-sm`}></i></span>
              <p className="text-[11px] text-foreground-400 mb-1">{s.l}</p>
              <p className="text-2xl font-heading font-semibold text-foreground-900">{s.v}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {['all', 'pending', 'approved', 'rejected', 'amended'].map(s => (
            <button key={s} onClick={() => setFilter(s)} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === s ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
          ))}
        </div>

        <div className="space-y-2">
          {filtered.map(claim => {
            const sc = statusConfig[claim.status];
            return (
              <div key={claim.id} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div onClick={() => setExpandedId(expandedId === claim.id ? null : claim.id)} className="p-4 flex items-center gap-4 cursor-pointer hover:bg-background-100/30 transition-smooth">
                  <span className="w-9 h-9 rounded-lg bg-primary-100 text-primary-700 flex items-center justify-center shrink-0 text-xs font-bold">{claim.hoursClaimed}h</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-foreground-900 truncate">{claim.description}</p>
                    <div className="flex items-center gap-x-2 gap-y-1 mt-0.5 flex-wrap text-[11px] text-foreground-400">
                      <span>{claim.learner}</span>
                      <span className="text-[8px] text-foreground-300">&middot;</span>
                      <span>{claim.programme}</span>
                      <span className="text-[8px] text-foreground-300">&middot;</span>
                      <span>{claim.category}</span>
                      <span className="text-[8px] text-foreground-300">&middot;</span>
                      <span>Week ending {claim.weekEnding}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!claim.employerConfirmed && <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">No Employer OK</span>}
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${sc.bg}`}>{claim.status}</span>
                    <i className={expandedId === claim.id ? 'ri-arrow-up-s-line text-foreground-300' : 'ri-arrow-down-s-line text-foreground-300'}></i>
                  </div>
                </div>
                {expandedId === claim.id && (
                  <div className="px-4 pb-4 border-t border-background-200/30 pt-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                      {[
                        { l: 'Learner', v: claim.learner },
                        { l: 'Programme', v: claim.programme },
                        { l: 'Week Ending', v: claim.weekEnding },
                        { l: 'Category', v: claim.category },
                        { l: 'Hours Claimed', v: `${claim.hoursClaimed}h` },
                        { l: 'Employer Confirmed', v: claim.employerConfirmed ? 'Yes' : 'No — pending' },
                      ].map(st => (
                        <div key={st.l} className="bg-background-100/50 rounded-lg p-2.5"><p className="text-[9px] text-foreground-400 uppercase tracking-wider">{st.l}</p><p className="text-[12px] font-medium text-foreground-900 truncate">{st.v}</p></div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <input type="number" value={amendedHours} onChange={e => setAmendedHours(e.target.value)} placeholder="Amend hours..." className="w-24 px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-900 placeholder-foreground-300 outline-none focus:border-primary-300" />
                    </div>
                    <div className="flex items-center gap-2">
                      {claim.status === 'Pending' && (
                        <>
                          <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-check-line mr-1"></i> Approve</button>
                          <button className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[10px] font-semibold hover:bg-amber-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-pencil-line mr-1"></i> Amend</button>
                          <button className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[10px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-close-line mr-1"></i> Reject</button>
                        </>
                      )}
                      {claim.status === 'Amended' && (
                        <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-check-line mr-1"></i> Approve Amended</button>
                      )}
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