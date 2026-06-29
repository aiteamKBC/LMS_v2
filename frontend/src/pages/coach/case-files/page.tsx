import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;

interface CaseFile {
  id: string;
  learner: string;
  initials: string;
  programme: string;
  employer: string;
  status: 'active' | 'at-risk' | 'completed' | 'withdrawn';
  documents: CaseDocument[];
  lastUpdated: string;
  riskLevel: string | null;
}

interface CaseDocument {
  id: string;
  name: string;
  type: string;
  date: string;
  status: 'complete' | 'pending' | 'missing';
}

const CASE_FILES: CaseFile[] = [
  { id: 'cf-1', learner: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', status: 'at-risk', lastUpdated: '8 Jun 2026', riskLevel: 'Amber', documents: [
    { id: 'd1', name: 'ILR Enrolment', type: 'Compliance', date: '12 Jan 2026', status: 'complete' },
    { id: 'd2', name: 'Initial Assessment', type: 'Assessment', date: '15 Jan 2026', status: 'complete' },
    { id: 'd3', name: 'Commitment Statement', type: 'Compliance', date: '20 Jan 2026', status: 'complete' },
    { id: 'd4', name: 'Employer Agreement', type: 'Contract', date: '22 Jan 2026', status: 'complete' },
    { id: 'd5', name: 'Training Plan', type: 'Plan', date: '1 Feb 2026', status: 'complete' },
    { id: 'd6', name: 'RPL Review', type: 'Assessment', date: 'Pending', status: 'pending' },
  ]},
  { id: 'cf-2', learner: 'James Okonkwo', initials: 'JO', programme: 'Data Analyst L4', employer: 'Medway NHS Trust', status: 'at-risk', lastUpdated: '5 Jun 2026', riskLevel: 'Red', documents: [
    { id: 'd7', name: 'ILR Enrolment', type: 'Compliance', date: '10 Jan 2026', status: 'complete' },
    { id: 'd8', name: 'Initial Assessment', type: 'Assessment', date: '14 Jan 2026', status: 'complete' },
    { id: 'd9', name: 'Commitment Statement', type: 'Compliance', date: '18 Jan 2026', status: 'complete' },
    { id: 'd10', name: 'Employer Agreement', type: 'Contract', date: 'Missing', status: 'missing' },
    { id: 'd11', name: 'Training Plan', type: 'Plan', date: '25 Jan 2026', status: 'complete' },
    { id: 'd12', name: 'Safeguarding Check', type: 'Compliance', date: 'Pending', status: 'pending' },
  ]},
  { id: 'cf-3', learner: 'Sarah Mitchell', initials: 'SM', programme: 'Business Administrator L3', employer: 'Kent County Council', status: 'active', lastUpdated: '6 Jun 2026', riskLevel: null, documents: [
    { id: 'd13', name: 'ILR Enrolment', type: 'Compliance', date: '5 Sep 2025', status: 'complete' },
    { id: 'd14', name: 'Initial Assessment', type: 'Assessment', date: '8 Sep 2025', status: 'complete' },
    { id: 'd15', name: 'Commitment Statement', type: 'Compliance', date: '10 Sep 2025', status: 'complete' },
    { id: 'd16', name: 'Training Plan', type: 'Plan', date: '15 Sep 2025', status: 'complete' },
    { id: 'd17', name: 'Progress Review 1', type: 'Review', date: '15 Dec 2025', status: 'complete' },
    { id: 'd18', name: 'Progress Review 2', type: 'Review', date: '15 Mar 2026', status: 'complete' },
  ]},
  { id: 'cf-4', learner: 'Emily Watson', initials: 'EW', programme: 'Digital Marketer L3', employer: 'Canterbury Creative', status: 'active', lastUpdated: '7 Jun 2026', riskLevel: null, documents: [
    { id: 'd19', name: 'ILR Enrolment', type: 'Compliance', date: '1 Sep 2025', status: 'complete' },
    { id: 'd20', name: 'Initial Assessment', type: 'Assessment', date: '3 Sep 2025', status: 'complete' },
    { id: 'd21', name: 'Training Plan', type: 'Plan', date: '10 Sep 2025', status: 'complete' },
    { id: 'd22', name: 'Progress Review 1', type: 'Review', date: '10 Dec 2025', status: 'complete' },
    { id: 'd23', name: 'Progress Review 2', type: 'Review', date: '10 Mar 2026', status: 'complete' },
    { id: 'd24', name: 'Gateway Readiness', type: 'Assessment', date: 'Pending', status: 'pending' },
  ]},
  { id: 'cf-5', learner: 'Maya Kapoor', initials: 'MK', programme: 'HR Consultant L5', employer: 'Southend Council', status: 'active', lastUpdated: '9 Jun 2026', riskLevel: 'Green', documents: [
    { id: 'd25', name: 'ILR Enrolment', type: 'Compliance', date: '1 May 2026', status: 'complete' },
    { id: 'd26', name: 'Initial Assessment', type: 'Assessment', date: '5 May 2026', status: 'complete' },
    { id: 'd27', name: 'Commitment Statement', type: 'Compliance', date: '8 May 2026', status: 'complete' },
    { id: 'd28', name: 'Training Plan', type: 'Plan', date: '12 May 2026', status: 'complete' },
    { id: 'd29', name: 'Onboarding Checklist', type: 'Compliance', date: '15 May 2026', status: 'complete' },
  ]},
  { id: 'cf-6', learner: 'David Chen', initials: 'DC', programme: 'Software Developer L4', employer: 'Tech Kent Ltd', status: 'active', lastUpdated: '4 Jun 2026', riskLevel: null, documents: [
    { id: 'd30', name: 'ILR Enrolment', type: 'Compliance', date: '2 Oct 2025', status: 'complete' },
    { id: 'd31', name: 'Initial Assessment', type: 'Assessment', date: '5 Oct 2025', status: 'complete' },
    { id: 'd32', name: 'Training Plan', type: 'Plan', date: '12 Oct 2025', status: 'complete' },
    { id: 'd33', name: 'Progress Review 1', type: 'Review', date: '12 Jan 2026', status: 'complete' },
    { id: 'd34', name: 'Progress Review 2', type: 'Review', date: '12 Apr 2026', status: 'complete' },
  ]},
  { id: 'cf-7', learner: 'Liam Foster', initials: 'LF', programme: 'Project Manager L4', employer: 'BAM Construction', status: 'active', lastUpdated: '7 Jun 2026', riskLevel: null, documents: [
    { id: 'd35', name: 'ILR Enrolment', type: 'Compliance', date: '1 Nov 2025', status: 'complete' },
    { id: 'd36', name: 'Initial Assessment', type: 'Assessment', date: '5 Nov 2025', status: 'complete' },
    { id: 'd37', name: 'Training Plan', type: 'Plan', date: '10 Nov 2025', status: 'complete' },
    { id: 'd38', name: 'Progress Review 1', type: 'Review', date: '10 Feb 2026', status: 'complete' },
    { id: 'd39', name: 'Progress Review 2', type: 'Review', date: '10 May 2026', status: 'complete' },
  ]},
  { id: 'cf-8', learner: 'Aisha Patel', initials: 'AP', programme: 'Accountancy L3', employer: 'Ashford Accounting', status: 'at-risk', lastUpdated: '8 Jun 2026', riskLevel: 'Amber', documents: [
    { id: 'd40', name: 'ILR Enrolment', type: 'Compliance', date: '15 Feb 2026', status: 'complete' },
    { id: 'd41', name: 'Initial Assessment', type: 'Assessment', date: '18 Feb 2026', status: 'complete' },
    { id: 'd42', name: 'Commitment Statement', type: 'Compliance', date: '20 Feb 2026', status: 'complete' },
    { id: 'd43', name: 'Employer Agreement', type: 'Contract', date: 'Missing', status: 'missing' },
    { id: 'd44', name: 'Training Plan', type: 'Plan', date: '1 Mar 2026', status: 'complete' },
  ]},
];

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  'active': { bg: 'bg-emerald-50 border-emerald-200/50', text: 'text-emerald-700', label: 'Active' },
  'at-risk': { bg: 'bg-red-50 border-red-200/50', text: 'text-red-700', label: 'At Risk' },
  'completed': { bg: 'bg-blue-50 border-blue-200/50', text: 'text-blue-700', label: 'Completed' },
  'withdrawn': { bg: 'bg-gray-50 border-gray-200/50', text: 'text-gray-700', label: 'Withdrawn' },
};

const docStatusConfig: Record<string, { icon: string; color: string; bg: string }> = {
  'complete': { icon: 'ri-check-line', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  'pending': { icon: 'ri-time-line', color: 'text-amber-600', bg: 'bg-amber-50' },
  'missing': { icon: 'ri-close-line', color: 'text-red-600', bg: 'bg-red-50' },
};

export default function CoachCaseFiles() {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>('cf-1');

  const filtered = CASE_FILES.filter(cf => {
    if (search && !cf.learner.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const completeDocs = CASE_FILES.reduce((acc, cf) => acc + cf.documents.filter(d => d.status === 'complete').length, 0);
  const pendingDocs = CASE_FILES.reduce((acc, cf) => acc + cf.documents.filter(d => d.status === 'pending').length, 0);
  const missingDocs = CASE_FILES.reduce((acc, cf) => acc + cf.documents.filter(d => d.status === 'missing').length, 0);

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Learner Case Files" pageSubtitle="Complete learner documentation and case history" userName="Med Maher" userRole="Progress Coach">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-folder-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Learner Case Files</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{CASE_FILES.length} case files</strong> with {completeDocs} complete documents, {pendingDocs} pending, {missingDocs} missing.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{completeDocs}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Complete</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-amber-300">{pendingDocs}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Pending</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-red-300">{missingDocs}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Missing</p>
              </div>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search case files..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
        </div>

        {/* Case Files */}
        <div className="space-y-3">
          {filtered.map(cf => {
            const sc = statusConfig[cf.status] || statusConfig['active'];
            const isOpen = expanded === cf.id;
            return (
              <div key={cf.id} className={`bg-background-50 rounded-xl border p-4 transition-smooth cursor-pointer ${isOpen ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60'}`} onClick={() => setExpanded(isOpen ? null : cf.id)}>
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ring-2 ${cf.status === 'at-risk' ? 'bg-red-100 text-red-700 ring-red-200' : 'bg-primary-100 text-primary-700 ring-primary-200'}`}>
                    <span className="text-sm font-bold">{cf.initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{cf.learner}</p>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
                      {cf.riskLevel && <span className="text-[9px] font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">{cf.riskLevel}</span>}
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{cf.programme} · {cf.employer}</p>
                  </div>
                  <div className="hidden lg:flex items-center gap-4 text-[11px] text-foreground-500 shrink-0">
                    <span>{cf.documents.length} documents</span>
                    <span>{cf.documents.filter(d => d.status === 'complete').length} complete</span>
                    <span>Updated: {cf.lastUpdated}</span>
                  </div>
                  <i className={`${isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-foreground-300`}></i>
                </div>
                {isOpen && (
                  <div className="mt-4 ml-14 pt-3 border-t border-background-200/30">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {cf.documents.map(doc => {
                        const dc = docStatusConfig[doc.status] || docStatusConfig['complete'];
                        return (
                          <div key={doc.id} className="flex items-center gap-3 p-3 bg-background-100/50 rounded-lg">
                            <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${dc.bg}`}>
                              <i className={`${dc.icon} ${dc.color} text-sm`}></i>
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-medium text-foreground-900 truncate">{doc.name}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-foreground-400">{doc.type}</span>
                                <span className="text-[8px] text-foreground-300">&middot;</span>
                                <span className="text-[10px] text-foreground-400">{doc.date}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-file-add-line mr-1"></i> Add Document</button>
                      <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-download-line mr-1"></i> Download All</button>
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