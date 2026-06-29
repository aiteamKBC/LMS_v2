import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const tutorNav = roleNavMap.tutor;

interface EvidenceItem {
  id: string;
  learner: string;
  title: string;
  type: string;
  programme: string;
  submitted: string;
  ksbRefs: string[];
  wordCount?: number;
  fileType: string;
  status: 'pending' | 'reviewed' | 'approved' | 'returned';
  score?: number;
  feedback?: string;
}

const EVIDENCE: EvidenceItem[] = [
  { id: 'ev-01', learner: 'Sophie Williams', title: 'Workplace Reflection — Campaign Segmentation', type: 'Reflection', programme: 'Marketing Exec L4', submitted: '8 Jun 2026', ksbRefs: ['K5', 'K6', 'S8'], wordCount: 450, fileType: 'PDF', status: 'pending' },
  { id: 'ev-02', learner: 'James Okonkwo', title: 'Data Cleaning & Transformation Report', type: 'Report', programme: 'Data Analyst L4', submitted: '7 Jun 2026', ksbRefs: ['K10', 'S12'], wordCount: 1800, fileType: 'DOCX', status: 'pending' },
  { id: 'ev-03', learner: 'Aisha Patel', title: 'Financial Reconciliation Evidence', type: 'Workplace Evidence', programme: 'Business Admin L3', submitted: '6 Jun 2026', ksbRefs: ['K8', 'S6'], fileType: 'XLSX', status: 'pending' },
  { id: 'ev-04', learner: 'Sarah Mitchell', title: 'Board Meeting Minutes & Reflection', type: 'Workplace Evidence', programme: 'Business Admin L3', submitted: '3 Jun 2026', ksbRefs: ['K3', 'S4', 'B2'], wordCount: 620, fileType: 'PDF', status: 'reviewed', score: 85, feedback: 'Excellent detail, well mapped to KSBs. Minor: add date to header.' },
  { id: 'ev-05', learner: 'Emily Watson', title: 'Social Media Campaign Analysis', type: 'Campaign Evidence', programme: 'Digital Marketer L3', submitted: '5 Jun 2026', ksbRefs: ['K7', 'S10', 'S11'], wordCount: 1200, fileType: 'PDF', status: 'pending' },
  { id: 'ev-06', learner: 'Liam Foster', title: 'Project Risk Register — Q2', type: 'Project Evidence', programme: 'Project Manager L4', submitted: '4 Jun 2026', ksbRefs: ['K14', 'S18'], fileType: 'XLSX', status: 'pending' },
  { id: 'ev-07', learner: 'David Chen', title: 'Code Documentation — Auth Module', type: 'Documentation', programme: 'Software Dev L4', submitted: '2 Jun 2026', ksbRefs: ['K18', 'S22'], wordCount: 800, fileType: 'MD', status: 'approved', score: 92, feedback: 'Comprehensive documentation. Well-structured with examples.' },
  { id: 'ev-08', learner: 'Maya Kapoor', title: 'HR Policy Compliance Checklist', type: 'Workplace Evidence', programme: 'HR Consultant L5', submitted: '1 Jun 2026', ksbRefs: ['K22', 'S26'], fileType: 'PDF', status: 'returned', feedback: 'Missing page 3. Please re-upload complete document.' },
  { id: 'ev-09', learner: 'Sophie Williams', title: 'Segmentation Strategy — Final Version', type: 'Assignment', programme: 'Marketing Exec L4', submitted: '5 Jun 2026', ksbRefs: ['K5', 'S8', 'S9'], wordCount: 950, fileType: 'PDF', status: 'reviewed', score: 78, feedback: 'Good analysis. Needs more data to support segmentation choices.' },
  { id: 'ev-10', learner: 'Aisha Patel', title: 'Month-End Reconciliation — May', type: 'Workplace Evidence', programme: 'Business Admin L3', submitted: '31 May 2026', ksbRefs: ['K8', 'S6', 'S7'], fileType: 'PDF', status: 'approved', score: 90, feedback: 'Accurate and well-presented. All KSBs covered.' },
];

export default function EvidenceReviewPage() {
  const [selectedEv, setSelectedEv] = useState<EvidenceItem | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('pending');
  const [filterProgramme, setFilterProgramme] = useState<string>('all');

  const programmes = ['all', 'Business Admin L3', 'Data Analyst L4', 'Marketing Exec L4', 'Digital Marketer L3', 'Project Manager L4', 'Software Dev L4', 'HR Consultant L5'];

  const filtered = EVIDENCE.filter(e => {
    if (filterStatus !== 'all' && e.status !== filterStatus) return false;
    if (filterProgramme !== 'all' && e.programme !== filterProgramme) return false;
    return true;
  });

  const pending = EVIDENCE.filter(e => e.status === 'pending').length;
  const reviewed = EVIDENCE.filter(e => e.status === 'reviewed' || e.status === 'approved').length;
  const returned = EVIDENCE.filter(e => e.status === 'returned').length;

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    reviewed: 'bg-primary-100 text-primary-700',
    approved: 'bg-emerald-100 text-emerald-700',
    returned: 'bg-red-100 text-red-700',
  };

  return (
    <WorkspaceShell role="tutor" roleLabel={tutorNav.label} navItems={tutorNav.items} workspaceLabel={tutorNav.workspaceLabel} pageTitle="Evidence Review" pageSubtitle="Review and validate learner evidence against KSB criteria" userName="Rachel Myers" userRole="Business Admin Tutor">
      <div className="p-6 space-y-6">
        {/* Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-file-search-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Evidence Review</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{EVIDENCE.length} items</strong> — {pending} pending, {reviewed} reviewed/approved, {returned} returned.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{EVIDENCE.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Total</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{pending}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">To Review</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{reviewed}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Reviewed</p></div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap justify-between">
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {(['all', 'pending', 'reviewed', 'approved', 'returned'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filterStatus === s ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
          <select value={filterProgramme} onChange={e => setFilterProgramme(e.target.value)} className="text-[10px] px-3 py-1.5 rounded-lg border border-background-200 bg-background-50 text-foreground-600 cursor-pointer">
            {programmes.map(p => <option key={p} value={p}>{p === 'all' ? 'All Programmes' : p}</option>)}
          </select>
        </div>

        <div className="flex gap-6">
          {/* List */}
          <div className="flex-1 min-w-0">
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {filtered.map(e => (
                  <div key={e.id} onClick={() => setSelectedEv(e)} className={`p-3.5 flex items-center gap-3 cursor-pointer transition-smooth ${selectedEv?.id === e.id ? 'bg-primary-50/40 border-l-2 border-l-primary-400' : 'hover:bg-background-100/30'}`}>
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${statusColors[e.status]}`}><i className={`${e.status === 'approved' ? 'ri-checkbox-circle-line' : e.status === 'returned' ? 'ri-close-circle-line' : e.status === 'reviewed' ? 'ri-eye-line' : 'ri-file-search-line'} text-sm`}></i></span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-foreground-900 truncate">{e.title}</p>
                      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap mt-0.5 text-[10px] text-foreground-400">
                        <span>{e.learner}</span>
                        <span className="text-[8px] text-foreground-300">&middot;</span>
                        <span className="font-medium text-foreground-500">{e.type}</span>
                        <span className="text-[8px] text-foreground-300">&middot;</span>
                        <span>{e.fileType}</span>
                        {e.wordCount && <><span className="text-[8px] text-foreground-300">&middot;</span><span>{e.wordCount} words</span></>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-foreground-400">{e.submitted}</span>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusColors[e.status]}`}>{e.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Detail Panel */}
          {selectedEv && (
            <div className="w-[360px] shrink-0">
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium sticky top-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-heading font-bold text-foreground-900">{selectedEv.title}</h4>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusColors[selectedEv.status]}`}>{selectedEv.status}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {[
                    { l: 'Learner', v: selectedEv.learner },
                    { l: 'Type', v: selectedEv.type },
                    { l: 'Programme', v: selectedEv.programme },
                    { l: 'Submitted', v: selectedEv.submitted },
                    { l: 'File', v: selectedEv.fileType },
                    { l: 'Words', v: selectedEv.wordCount ? String(selectedEv.wordCount) : 'N/A' },
                  ].map(s => (
                    <div key={s.l} className="bg-background-100/50 rounded-lg p-2.5"><p className="text-[9px] text-foreground-400 uppercase tracking-wider">{s.l}</p><p className="text-[12px] font-medium text-foreground-900">{s.v}</p></div>
                  ))}
                </div>
                <div className="mb-3">
                  <p className="text-[10px] text-foreground-400 uppercase tracking-wider mb-1">KSB References</p>
                  <div className="flex items-center gap-1 flex-wrap">
                    {selectedEv.ksbRefs.map(k => <span key={k} className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-secondary-100 text-secondary-700">{k}</span>)}
                  </div>
                </div>
                {selectedEv.score && (
                  <div className="mb-3">
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wider mb-1">Score</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-background-200 rounded-full h-2">
                        <div className={`h-2 rounded-full ${selectedEv.score >= 85 ? 'bg-emerald-500' : selectedEv.score >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${selectedEv.score}%` }}></div>
                      </div>
                      <span className="text-sm font-bold text-foreground-900">{selectedEv.score}%</span>
                    </div>
                  </div>
                )}
                {selectedEv.feedback && (
                  <div className="mb-3 p-3 bg-background-100/50 rounded-lg">
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wider mb-1">Feedback</p>
                    <p className="text-[11px] text-foreground-600">{selectedEv.feedback}</p>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {selectedEv.status === 'pending' && (
                    <>
                      <button className="flex-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-check-line mr-1"></i> Approve</button>
                      <button className="flex-1 px-3 py-1.5 bg-red-500 text-white rounded-lg text-[10px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-close-line mr-1"></i> Return</button>
                    </>
                  )}
                  <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-download-line mr-1"></i> Download</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}