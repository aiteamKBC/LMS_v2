import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const curriculumNav = roleNavMap.curriculum;

interface KSBFramework {
  id: string;
  name: string;
  standard: string;
  ifateRef: string;
  level: number;
  totalKsbs: number;
  knowledgeCount: number;
  skillCount: number;
  behaviourCount: number;
  modulesCount: number;
  status: 'draft' | 'review' | 'published' | 'archived';
  lastModified: string;
  modifiedBy: string;
  version: string;
  programmes: string[];
}

const FRAMEWORKS: KSBFramework[] = [
  { id: 'ksb-01', name: 'Marketing Executive', standard: 'Marketing Executive', ifateRef: 'ST0738', level: 4, totalKsbs: 34, knowledgeCount: 14, skillCount: 13, behaviourCount: 7, modulesCount: 12, status: 'published', lastModified: '5 Jun 2026', modifiedBy: 'Emma Walsh', version: 'v2.1', programmes: ['Marketing Executive L4', 'Digital Marketer L3'] },
  { id: 'ksb-02', name: 'Business Administrator', standard: 'Business Administrator', ifateRef: 'ST0070', level: 3, totalKsbs: 37, knowledgeCount: 16, skillCount: 14, behaviourCount: 7, modulesCount: 14, status: 'published', lastModified: '3 Jun 2026', modifiedBy: 'James Carter', version: 'v3.0', programmes: ['Business Administrator L3'] },
  { id: 'ksb-03', name: 'Data Analyst', standard: 'Data Analyst', ifateRef: 'ST0593', level: 4, totalKsbs: 29, knowledgeCount: 12, skillCount: 11, behaviourCount: 6, modulesCount: 10, status: 'published', lastModified: '1 Jun 2026', modifiedBy: 'Emma Walsh', version: 'v1.5', programmes: ['Data Analyst L4'] },
  { id: 'ksb-04', name: 'Software Developer', standard: 'Software Developer', ifateRef: 'ST0116', level: 4, totalKsbs: 32, knowledgeCount: 13, skillCount: 13, behaviourCount: 6, modulesCount: 12, status: 'review', lastModified: '8 Jun 2026', modifiedBy: 'James Carter', version: 'v2.0-draft', programmes: ['Software Developer L4'] },
  { id: 'ksb-05', name: 'Accountancy / Taxation Professional', standard: 'Accountancy / Taxation Professional', ifateRef: 'ST0001', level: 3, totalKsbs: 28, knowledgeCount: 11, skillCount: 11, behaviourCount: 6, modulesCount: 9, status: 'published', lastModified: '28 May 2026', modifiedBy: 'Emma Walsh', version: 'v2.3', programmes: ['Accountancy L3'] },
  { id: 'ksb-06', name: 'Project Manager', standard: 'Project Manager', ifateRef: 'ST0411', level: 4, totalKsbs: 31, knowledgeCount: 13, skillCount: 12, behaviourCount: 6, modulesCount: 11, status: 'published', lastModified: '25 May 2026', modifiedBy: 'James Carter', version: 'v1.8', programmes: ['Project Manager L4'] },
  { id: 'ksb-07', name: 'HR Consultant / Partner', standard: 'HR Consultant / Partner', ifateRef: 'ST0477', level: 5, totalKsbs: 36, knowledgeCount: 15, skillCount: 14, behaviourCount: 7, modulesCount: 13, status: 'review', lastModified: '9 Jun 2026', modifiedBy: 'Emma Walsh', version: 'v1.0-draft', programmes: ['HR Consultant L5'] },
  { id: 'ksb-08', name: 'Digital Marketer', standard: 'Digital Marketer', ifateRef: 'ST0122', level: 3, totalKsbs: 30, knowledgeCount: 13, skillCount: 12, behaviourCount: 5, modulesCount: 10, status: 'published', lastModified: '20 May 2026', modifiedBy: 'James Carter', version: 'v2.0', programmes: ['Digital Marketer L3'] },
  { id: 'ksb-09', name: 'Customer Service Practitioner', standard: 'Customer Service Practitioner', ifateRef: 'ST0074', level: 2, totalKsbs: 24, knowledgeCount: 10, skillCount: 9, behaviourCount: 5, modulesCount: 8, status: 'archived', lastModified: '15 Mar 2026', modifiedBy: 'Emma Walsh', version: 'v1.2', programmes: ['Customer Service L2'] },
];

export default function CurriculumKsbFrameworks() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = FRAMEWORKS.filter(f => {
    if (search && !f.name.toLowerCase().includes(search.toLowerCase()) && !f.standard.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && f.status !== statusFilter) return false;
    return true;
  });

  const published = FRAMEWORKS.filter(f => f.status === 'published').length;
  const inReview = FRAMEWORKS.filter(f => f.status === 'review').length;
  const drafts = FRAMEWORKS.filter(f => f.status === 'draft').length;

  const statusConfig: Record<string, { bg: string; text: string; icon: string; label: string }> = {
    published: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'ri-check-double-line', label: 'Published' },
    review: { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'ri-search-eye-line', label: 'In Review' },
    draft: { bg: 'bg-foreground-100', text: 'text-foreground-600', icon: 'ri-draft-line', label: 'Draft' },
    archived: { bg: 'bg-foreground-50', text: 'text-foreground-400', icon: 'ri-archive-line', label: 'Archived' },
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="KSB Frameworks" pageSubtitle="Build and manage Knowledge, Skills and Behaviours frameworks aligned to IfATE apprenticeship standards" userName="Emma Walsh" userRole="Curriculum Lead">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-bar-chart-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">KSB Frameworks</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{FRAMEWORKS.length} frameworks</strong> · {published} published · {inReview} in review · {drafts} drafts</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-emerald-300">{published}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Published</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{inReview}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">In Review</p></div>
            </div>
            <button className="px-4 py-2.5 bg-white text-primary-700 rounded-lg text-[12px] font-semibold hover:bg-white/90 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-add-line mr-1"></i> New Framework</button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search frameworks or standards..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {[{ key: 'all', label: 'All' }, { key: 'published', label: 'Published' }, { key: 'review', label: 'In Review' }, { key: 'draft', label: 'Draft' }, { key: 'archived', label: 'Archived' }].map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {filtered.map(fw => {
            const sc = statusConfig[fw.status] || statusConfig.draft;
            const isOpen = expanded === fw.id;
            return (
              <div key={fw.id} className={`bg-background-50 rounded-xl border p-4 transition-smooth cursor-pointer ${isOpen ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60'}`} onClick={() => setExpanded(isOpen ? null : fw.id)}>
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${fw.status === 'published' ? 'bg-emerald-100 text-emerald-700' : fw.status === 'review' ? 'bg-amber-100 text-amber-700' : 'bg-foreground-100 text-foreground-400'}`}>
                    <span className="text-sm font-bold">{fw.level}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground-900">{fw.name}</p>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
                      <span className="text-[10px] text-foreground-400">v{fw.version}</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">IfATE: {fw.ifateRef} · {fw.totalKsbs} KSBs ({fw.knowledgeCount} K · {fw.skillCount} S · {fw.behaviourCount} B) · {fw.modulesCount} modules</p>
                  </div>
                  <div className="hidden lg:flex items-center gap-4 text-[11px] text-foreground-500 shrink-0">
                    <span>Modified: {fw.lastModified}</span>
                    <span>By: {fw.modifiedBy}</span>
                  </div>
                  <i className={`${isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-foreground-300`}></i>
                </div>
                {isOpen && (
                  <div className="mt-4 ml-14 space-y-3 pt-3 border-t border-background-200/30">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="bg-primary-50 rounded-lg p-3 text-center">
                        <p className="text-[10px] text-primary-500 mb-1">Knowledge</p>
                        <p className="text-xl font-bold text-primary-700">{fw.knowledgeCount}</p>
                        <p className="text-[10px] text-primary-400">statements</p>
                      </div>
                      <div className="bg-accent-50 rounded-lg p-3 text-center">
                        <p className="text-[10px] text-accent-600 mb-1">Skills</p>
                        <p className="text-xl font-bold text-accent-700">{fw.skillCount}</p>
                        <p className="text-[10px] text-accent-500">statements</p>
                      </div>
                      <div className="bg-secondary-50 rounded-lg p-3 text-center">
                        <p className="text-[10px] text-secondary-600 mb-1">Behaviours</p>
                        <p className="text-xl font-bold text-secondary-700">{fw.behaviourCount}</p>
                        <p className="text-[10px] text-secondary-500">statements</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-background-100 text-foreground-500">IfATE: {fw.ifateRef}</span>
                      <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-background-100 text-foreground-500">Level {fw.level}</span>
                      <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-background-100 text-foreground-500">{fw.modulesCount} modules</span>
                      {fw.programmes.map(p => <span key={p} className="text-[10px] font-medium px-2 py-1 rounded-full bg-primary-50 text-primary-600">{p}</span>)}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-edit-line mr-1"></i> Edit Framework</button>
                      <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-link mr-1"></i> View KSB Mapping</button>
                      <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-file-copy-line mr-1"></i> Duplicate</button>
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