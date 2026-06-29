import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const tutorNav = roleNavMap.tutor;

interface KSBClaim {
  id: string;
  learner: string;
  programme: string;
  ksbCode: string;
  ksbTitle: string;
  evidenceCount: number;
  submittedDate: string;
  status: 'Ready' | 'Insufficient' | 'Exceeds' | 'Approved' | 'Rejected';
  type: 'K' | 'S' | 'B';
  assignedTo: string;
}

const KSB_CLAIMS: KSBClaim[] = [
  { id: 'ksb-01', learner: 'Sophie Williams', programme: 'Marketing Executive L4', ksbCode: 'K5', ksbTitle: 'Segmentation Principles', evidenceCount: 2, submittedDate: '8 Jun', status: 'Ready', type: 'K', assignedTo: 'Rachel Myers' },
  { id: 'ksb-02', learner: 'James Okonkwo', programme: 'Data Analyst L4', ksbCode: 'S12', ksbTitle: 'Data Analysis Tools', evidenceCount: 1, submittedDate: '7 Jun', status: 'Insufficient', type: 'S', assignedTo: 'Rachel Myers' },
  { id: 'ksb-03', learner: 'Aisha Patel', programme: 'Accountancy L3', ksbCode: 'K8', ksbTitle: 'Financial Principles', evidenceCount: 2, submittedDate: '6 Jun', status: 'Ready', type: 'K', assignedTo: 'Rachel Myers' },
  { id: 'ksb-04', learner: 'Sarah Mitchell', programme: 'Business Admin L3', ksbCode: 'S4', ksbTitle: 'Business Communication', evidenceCount: 3, submittedDate: '5 Jun', status: 'Ready', type: 'S', assignedTo: 'Rachel Myers' },
  { id: 'ksb-05', learner: 'Liam Foster', programme: 'Project Manager L4', ksbCode: 'S18', ksbTitle: 'Risk Mitigation', evidenceCount: 1, submittedDate: '4 Jun', status: 'Insufficient', type: 'S', assignedTo: 'Rachel Myers' },
  { id: 'ksb-06', learner: 'Emily Watson', programme: 'Digital Marketer L3', ksbCode: 'B5', ksbTitle: 'Professional Development', evidenceCount: 4, submittedDate: '3 Jun', status: 'Exceeds', type: 'B', assignedTo: 'Rachel Myers' },
  { id: 'ksb-07', learner: 'David Chen', programme: 'Software Developer L4', ksbCode: 'K10', ksbTitle: 'Software Architecture', evidenceCount: 2, submittedDate: '9 Jun', status: 'Ready', type: 'K', assignedTo: 'Rachel Myers' },
  { id: 'ksb-08', learner: 'Maya Kapoor', programme: 'HR Consultant L5', ksbCode: 'B2', ksbTitle: 'Ethical Practice', evidenceCount: 1, submittedDate: '8 Jun', status: 'Insufficient', type: 'B', assignedTo: 'Rachel Myers' },
  { id: 'ksb-09', learner: 'Chloe Evans', programme: 'Digital Marketer L3', ksbCode: 'S10', ksbTitle: 'Social Media Strategy', evidenceCount: 3, submittedDate: '7 Jun', status: 'Approved', type: 'S', assignedTo: 'Rachel Myers' },
  { id: 'ksb-10', learner: 'Omar Hassan', programme: 'Business Admin L3', ksbCode: 'K3', ksbTitle: 'Business Structures', evidenceCount: 2, submittedDate: '6 Jun', status: 'Ready', type: 'K', assignedTo: 'Rachel Myers' },
  { id: 'ksb-11', learner: 'Sophie Williams', programme: 'Marketing Executive L4', ksbCode: 'S8', ksbTitle: 'Campaign Planning', evidenceCount: 1, submittedDate: '5 Jun', status: 'Rejected', type: 'S', assignedTo: 'Rachel Myers' },
  { id: 'ksb-12', learner: 'James Okonkwo', programme: 'Data Analyst L4', ksbCode: 'B4', ksbTitle: 'Team Collaboration', evidenceCount: 2, submittedDate: '4 Jun', status: 'Ready', type: 'B', assignedTo: 'Rachel Myers' },
];

export default function TutorKsbValidationPage() {
  const [filter, setFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState('');

  const filtered = filter === 'all' ? KSB_CLAIMS : KSB_CLAIMS.filter(c => c.status.toLowerCase() === filter.toLowerCase());
  const readyCount = KSB_CLAIMS.filter(c => c.status === 'Ready').length;
  const insufficientCount = KSB_CLAIMS.filter(c => c.status === 'Insufficient').length;
  const approvedCount = KSB_CLAIMS.filter(c => c.status === 'Approved').length;

  const statusConfig: Record<string, { bg: string; text: string; icon: string }> = {
    Ready: { bg: 'bg-emerald-100 text-emerald-700', text: 'Ready', icon: 'ri-check-line' },
    Insufficient: { bg: 'bg-red-100 text-red-700', text: 'Insufficient', icon: 'ri-close-line' },
    Exceeds: { bg: 'bg-accent-100 text-accent-700', text: 'Exceeds', icon: 'ri-star-line' },
    Approved: { bg: 'bg-emerald-100 text-emerald-700', text: 'Approved', icon: 'ri-check-double-line' },
    Rejected: { bg: 'bg-red-100 text-red-700', text: 'Rejected', icon: 'ri-arrow-go-back-line' },
  };

  return (
    <WorkspaceShell role="tutor" roleLabel={tutorNav.label} navItems={tutorNav.items} workspaceLabel={tutorNav.workspaceLabel} pageTitle="KSB Validation" pageSubtitle="Validate knowledge, skills, and behaviour evidence against apprenticeship standards" userName="Rachel Myers" userRole="Business Admin Tutor">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-checkbox-circle-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">KSB Validation Queue</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">{readyCount} ready for validation · {insufficientCount} need more evidence · {approvedCount} approved this month</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{KSB_CLAIMS.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Total</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-emerald-300">{readyCount}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Ready</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-red-300">{insufficientCount}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Insufficient</p></div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { l: 'Knowledge (K)', v: KSB_CLAIMS.filter(c => c.type === 'K').length, i: 'ri-book-open-line', c: 'primary' },
            { l: 'Skills (S)', v: KSB_CLAIMS.filter(c => c.type === 'S').length, i: 'ri-tools-line', c: 'accent' },
            { l: 'Behaviours (B)', v: KSB_CLAIMS.filter(c => c.type === 'B').length, i: 'ri-user-heart-line', c: 'secondary' },
            { l: 'Approved This Month', v: String(approvedCount), i: 'ri-check-double-line', c: 'emerald' },
          ].map(s => (
            <div key={s.l} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 cursor-pointer">
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${s.c === 'primary' ? 'bg-primary-100 text-primary-600' : s.c === 'accent' ? 'bg-accent-100 text-accent-700' : s.c === 'secondary' ? 'bg-secondary-100 text-secondary-600' : 'bg-emerald-100 text-emerald-600'}`}><i className={`${s.i} text-sm`}></i></span>
              <p className="text-[11px] text-foreground-400 mb-1">{s.l}</p>
              <p className="text-2xl font-heading font-semibold text-foreground-900">{s.v}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {['all', 'ready', 'insufficient', 'exceeds', 'approved', 'rejected'].map(s => (
            <button key={s} onClick={() => setFilter(s)} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === s ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
          ))}
        </div>

        <div className="space-y-2">
          {filtered.map(claim => {
            const sc = statusConfig[claim.status];
            return (
              <div key={claim.id} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div onClick={() => setExpandedId(expandedId === claim.id ? null : claim.id)} className="p-4 flex items-center gap-4 cursor-pointer hover:bg-background-100/30 transition-smooth">
                  <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-[10px] font-bold ${claim.type === 'K' ? 'bg-primary-100 text-primary-700' : claim.type === 'S' ? 'bg-accent-100 text-accent-700' : 'bg-secondary-100 text-secondary-700'}`}>{claim.ksbCode}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-foreground-900">{claim.ksbTitle}</p>
                    <div className="flex items-center gap-x-2 gap-y-1 mt-0.5 flex-wrap text-[11px] text-foreground-400">
                      <span>{claim.learner}</span>
                      <span className="text-[8px] text-foreground-300">&middot;</span>
                      <span>{claim.programme}</span>
                      <span className="text-[8px] text-foreground-300">&middot;</span>
                      <span>{claim.evidenceCount} evidence item{claim.evidenceCount > 1 ? 's' : ''}</span>
                      <span className="text-[8px] text-foreground-300">&middot;</span>
                      <span>Submitted {claim.submittedDate}</span>
                    </div>
                  </div>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${sc.bg}`}>{sc.text}</span>
                  <i className={expandedId === claim.id ? 'ri-arrow-up-s-line text-foreground-300' : 'ri-arrow-down-s-line text-foreground-300'}></i>
                </div>
                {expandedId === claim.id && (
                  <div className="px-4 pb-4 border-t border-background-200/30 pt-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                      {[
                        { l: 'Learner', v: claim.learner },
                        { l: 'Programme', v: claim.programme },
                        { l: 'KSB Type', v: claim.type === 'K' ? 'Knowledge' : claim.type === 'S' ? 'Skill' : 'Behaviour' },
                        { l: 'Evidence Items', v: String(claim.evidenceCount) },
                        { l: 'Submitted', v: claim.submittedDate },
                        { l: 'Assigned To', v: claim.assignedTo },
                      ].map(st => (
                        <div key={st.l} className="bg-background-100/50 rounded-lg p-2.5"><p className="text-[9px] text-foreground-400 uppercase tracking-wider">{st.l}</p><p className="text-[12px] font-medium text-foreground-900 truncate">{st.v}</p></div>
                      ))}
                    </div>
                    <textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)} placeholder="Add validation feedback..." className="w-full px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-900 placeholder-foreground-300 outline-none focus:border-primary-300 resize-none mb-3" rows={2} />
                    <div className="flex items-center gap-2">
                      {claim.status === 'Ready' && (
                        <>
                          <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-check-line mr-1"></i> Approve</button>
                          <button className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[10px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-close-line mr-1"></i> Reject</button>
                        </>
                      )}
                      {claim.status === 'Insufficient' && (
                        <button className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[10px] font-semibold hover:bg-amber-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-file-add-line mr-1"></i> Request More Evidence</button>
                      )}
                      <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-eye-line mr-1"></i> View Evidence</button>
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