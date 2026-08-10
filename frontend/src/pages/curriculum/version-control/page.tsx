import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const curriculumNav = roleNavMap.curriculum;

interface VersionRecord {
  id: string;
  framework: string;
  version: string;
  changeType: 'major' | 'minor' | 'patch';
  changeSummary: string;
  author: string;
  date: string;
  status: 'current' | 'previous' | 'archived';
  ksbChanges: { added: number; removed: number; modified: number };
  reviewStatus: 'approved' | 'pending' | 'rejected';
  approvedBy: string;
}

const VERSIONS: VersionRecord[] = [
  { id: 'ver-01', framework: 'Marketing Executive L4', version: 'v2.1', changeType: 'minor', changeSummary: 'Updated K4 - Digital Marketing Analytics to include AI-driven campaign analysis. Added B7 - Ethical Marketing Practice as new behaviour statement.', author: 'Emma Walsh', date: '5 Jun 2026', status: 'current', ksbChanges: { added: 1, removed: 0, modified: 1 }, reviewStatus: 'approved', approvedBy: 'James Carter' },
  { id: 'ver-02', framework: 'Marketing Executive L4', version: 'v2.0', changeType: 'major', changeSummary: 'Major restructure following IfATE standard revision ST0738 v1.2. Restructured Knowledge section. Added 3 new skill statements for digital campaign management. Removed deprecated K12.', author: 'Emma Walsh', date: '15 May 2026', status: 'previous', ksbChanges: { added: 3, removed: 1, modified: 4 }, reviewStatus: 'approved', approvedBy: 'James Carter' },
  { id: 'ver-03', framework: 'Marketing Executive L4', version: 'v1.5', changeType: 'patch', changeSummary: 'Corrected typo in S7 - Campaign Planning. Updated IfATE reference link.', author: 'James Carter', date: '2 Apr 2026', status: 'archived', ksbChanges: { added: 0, removed: 0, modified: 1 }, reviewStatus: 'approved', approvedBy: 'Emma Walsh' },
  { id: 'ver-04', framework: 'Business Administrator L3', version: 'v3.0', changeType: 'major', changeSummary: 'Full curriculum redesign aligning with new EPA assessment plan for ST0070. Restructured all three KSB domains. Now 37 total KSBs (previously 32).', author: 'James Carter', date: '3 Jun 2026', status: 'current', ksbChanges: { added: 5, removed: 0, modified: 8 }, reviewStatus: 'approved', approvedBy: 'Emma Walsh' },
  { id: 'ver-05', framework: 'Business Administrator L3', version: 'v2.4', changeType: 'minor', changeSummary: 'Incorporated employer feedback on B3 - Professionalism. Updated evidence requirements for S5 - Document Production.', author: 'Emma Walsh', date: '20 Apr 2026', status: 'previous', ksbChanges: { added: 0, removed: 0, modified: 2 }, reviewStatus: 'approved', approvedBy: 'James Carter' },
  { id: 'ver-06', framework: 'Data Analyst L4', version: 'v1.5', changeType: 'minor', changeSummary: 'Added K11 - Data Ethics and Governance following Data Protection Act updates. Modified S8 to include Python-based analysis methods.', author: 'Emma Walsh', date: '1 Jun 2026', status: 'current', ksbChanges: { added: 1, removed: 0, modified: 1 }, reviewStatus: 'approved', approvedBy: 'James Carter' },
  { id: 'ver-07', framework: 'Software Developer L4', version: 'v2.0-draft', changeType: 'major', changeSummary: 'Draft major revision incorporating modern development practices. Added cloud deployment, CI/CD pipeline, and cybersecurity KSBs. Under QA review.', author: 'James Carter', date: '8 Jun 2026', status: 'current', ksbChanges: { added: 4, removed: 1, modified: 6 }, reviewStatus: 'pending', approvedBy: '—' },
  { id: 'ver-08', framework: 'Accountancy L3', version: 'v2.3', changeType: 'patch', changeSummary: 'Updated regulatory references to 2026 Finance Act. Minor corrections to K3 - Taxation Principles.', author: 'Emma Walsh', date: '28 May 2026', status: 'current', ksbChanges: { added: 0, removed: 0, modified: 1 }, reviewStatus: 'approved', approvedBy: 'James Carter' },
  { id: 'ver-09', framework: 'Accountancy L3', version: 'v2.2', changeType: 'minor', changeSummary: 'Added software competency statements for cloud accounting platforms. Updated B4 - Ethical Standards.', author: 'James Carter', date: '10 Apr 2026', status: 'previous', ksbChanges: { added: 2, removed: 0, modified: 1 }, reviewStatus: 'approved', approvedBy: 'Emma Walsh' },
  { id: 'ver-10', framework: 'HR Consultant L5', version: 'v1.0-draft', changeType: 'major', changeSummary: 'Initial draft of HR Consultant L5 framework. All KSBs mapped to ST0477. Awaiting internal QA review before employer consultation.', author: 'Emma Walsh', date: '9 Jun 2026', status: 'current', ksbChanges: { added: 36, removed: 0, modified: 0 }, reviewStatus: 'pending', approvedBy: '—' },
  { id: 'ver-11', framework: 'Digital Marketer L3', version: 'v2.0', changeType: 'major', changeSummary: 'Major update reflecting social media platform changes and new digital advertising regulations (ASA 2026). Restructured S3 and S4.', author: 'James Carter', date: '20 May 2026', status: 'current', ksbChanges: { added: 2, removed: 1, modified: 5 }, reviewStatus: 'approved', approvedBy: 'Emma Walsh' },
  { id: 'ver-12', framework: 'Project Manager L4', version: 'v1.8', changeType: 'minor', changeSummary: 'Added agile project management methodologies to K5. Updated risk management KSBs to include digital project risks.', author: 'Emma Walsh', date: '25 May 2026', status: 'current', ksbChanges: { added: 1, removed: 0, modified: 2 }, reviewStatus: 'approved', approvedBy: 'James Carter' },
];

function versionMarker(version: VersionRecord) {
  if (version.status === 'archived') return { icon: 'ri-folder-archive-line', title: 'Archived version', tone: 'border-foreground-300 bg-foreground-100 text-foreground-500' };
  if (version.status === 'previous') return { icon: 'ri-history-line', title: 'Previous version', tone: 'border-background-300 bg-background-50 text-foreground-500' };
  if (version.reviewStatus === 'pending') return { icon: 'ri-time-line', title: 'Current version pending review', tone: 'border-amber-300 bg-amber-100 text-amber-700' };
  if (version.reviewStatus === 'rejected') return { icon: 'ri-close-circle-line', title: 'Current version rejected', tone: 'border-red-300 bg-red-100 text-red-700' };
  return { icon: 'ri-checkbox-circle-line', title: 'Current approved version', tone: 'border-emerald-200 bg-emerald-100 text-emerald-700' };
}

export default function CurriculumVersionControl() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [frameworkFilter, setFrameworkFilter] = useState<string>('all');

  const filtered = VERSIONS.filter(v => {
    if (search && !v.framework.toLowerCase().includes(search.toLowerCase()) && !v.changeSummary.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && v.status !== statusFilter) return false;
    if (frameworkFilter !== 'all' && v.framework !== frameworkFilter) return false;
    return true;
  });

  const frameworks = [...new Set(VERSIONS.map(v => v.framework))];
  const pendingReview = VERSIONS.filter(v => v.reviewStatus === 'pending').length;
  const currentVersions = VERSIONS.filter(v => v.status === 'current').length;

  const changeConfig: Record<string, { bg: string; text: string; label: string }> = {
    major: { bg: 'bg-accent-50', text: 'text-accent-700', label: 'Major' },
    minor: { bg: 'bg-primary-50', text: 'text-primary-700', label: 'Minor' },
    patch: { bg: 'bg-foreground-100', text: 'text-foreground-500', label: 'Patch' },
  };

  const reviewConfig: Record<string, { bg: string; text: string }> = {
    approved: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
    pending: { bg: 'bg-amber-100', text: 'text-amber-700' },
    rejected: { bg: 'bg-red-100', text: 'text-red-700' },
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Version Control" pageSubtitle="Track curriculum changes with full version history and rollback capability" userName="Emma Walsh" userRole="Curriculum Lead">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><AppIcon className="ri-git-branch-line text-white text-2xl"></AppIcon></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Version Control</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{VERSIONS.length} versions</strong> across {frameworks.length} frameworks · {currentVersions} current · {pendingReview} pending review</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
          <div className="relative sm:max-w-xs">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search versions..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
          <div className="relative">
            <select value={frameworkFilter} onChange={e => setFrameworkFilter(e.target.value)} className="px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-900 focus:outline-none focus:border-primary-300 cursor-pointer">
              <option value="all">All Frameworks</option>
              {frameworks.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {[{ key: 'all', label: 'All' }, { key: 'current', label: 'Current' }, { key: 'previous', label: 'Previous' }, { key: 'archived', label: 'Archived' }].map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
            ))}
          </div>
        </div>

        <div className="relative pl-8 space-y-0 before:absolute before:left-[15px] before:top-0 before:bottom-0 before:w-0.5 before:bg-background-200">
          {filtered.map((ver, idx) => {
            const cc = changeConfig[ver.changeType];
            const rc = reviewConfig[ver.reviewStatus];
            const marker = versionMarker(ver);
            const isCurrent = ver.status === 'current';
            return (
              <div key={ver.id} className="relative pb-6 last:pb-0">
                <div title={marker.title} aria-label={marker.title} className={`absolute -left-[30px] top-0 z-10 flex h-8 w-8 items-center justify-center rounded-lg border-2 shadow-sm ${marker.tone}`}>
                  <AppIcon name={marker.icon} size={16}></AppIcon>
                </div>
                <div className={`bg-background-50 rounded-xl border p-4 ml-6 ${isCurrent ? 'border-primary-200/50 bg-primary-50/20' : 'border-foreground-200/60'}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <p className="text-sm font-semibold text-foreground-900">{ver.framework}</p>
                        <span className="text-[11px] font-mono font-semibold text-foreground-700 bg-background-100 px-2 py-0.5 rounded">{ver.version}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${cc.bg} ${cc.text}`}>{cc.label}</span>
                        {isCurrent && <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Current</span>}
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${rc.bg} ${rc.text}`}>{ver.reviewStatus === 'approved' ? 'Approved' : ver.reviewStatus === 'pending' ? 'Pending' : 'Rejected'}</span>
                      </div>
                      <p className="text-[12px] text-foreground-500 mb-2">{ver.changeSummary}</p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-foreground-400">
                        <span className="inline-flex items-center gap-1"><AppIcon name="ri-user-line" size={13}></AppIcon> {ver.author}</span>
                        <span className="inline-flex items-center gap-1"><AppIcon name="ri-calendar-line" size={13}></AppIcon> {ver.date}</span>
                        {ver.reviewStatus === 'approved' && <span className="inline-flex items-center gap-1"><AppIcon name="ri-check-double-line" size={13} className="text-emerald-500"></AppIcon> Approved by {ver.approvedBy}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {(ver.ksbChanges.added > 0 || ver.ksbChanges.removed > 0 || ver.ksbChanges.modified > 0) && (
                        <div className="flex items-center gap-1.5 text-[10px]">
                          {ver.ksbChanges.added > 0 && <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">+{ver.ksbChanges.added}</span>}
                          {ver.ksbChanges.removed > 0 && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">-{ver.ksbChanges.removed}</span>}
                          {ver.ksbChanges.modified > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">~{ver.ksbChanges.modified}</span>}
                        </div>
                      )}
                      <button className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-medium text-foreground-600 transition-smooth hover:bg-background-100 cursor-pointer whitespace-nowrap"><AppIcon name="ri-file-search-line" size={14}></AppIcon> View Diff</button>
                      {ver.status === 'previous' && <button className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-3 text-[11px] font-semibold text-white transition-smooth hover:bg-primary-600 cursor-pointer whitespace-nowrap"><AppIcon name="ri-history-line" size={14}></AppIcon> Rollback</button>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </WorkspaceShell>
  );
}
