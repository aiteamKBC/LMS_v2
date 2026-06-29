import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const curriculumNav = roleNavMap.curriculum;

interface Component {
  id: string;
  title: string;
  type: string;
  module: string;
  programme: string;
  week: string;
  duration: number;
  ksbRefs: string[];
  status: 'published' | 'draft' | 'review';
  lastEdited: string;
  contentSections: number;
  quizQuestions?: number;
  hasResources: boolean;
}

const COMPONENTS: Component[] = [
  { id: 'comp-001', title: 'Welcome & Icebreaker — Cohort Induction', type: 'Live Session', module: 'Business Communication', programme: 'Business Admin L3', week: 'Week 1', duration: 60, ksbRefs: ['B1', 'B2'], status: 'published', lastEdited: '2 Jun 2026', contentSections: 4, hasResources: true },
  { id: 'comp-002', title: 'Communication Models: Shannon-Weaver & Berlo', type: 'Workshop', module: 'Business Communication', programme: 'Business Admin L3', week: 'Week 1', duration: 90, ksbRefs: ['K1', 'K2'], status: 'published', lastEdited: '1 Jun 2026', contentSections: 6, hasResources: true },
  { id: 'comp-003', title: 'Email Etiquette & Professional Standards', type: 'Live Session', module: 'Business Communication', programme: 'Business Admin L3', week: 'Week 2', duration: 60, ksbRefs: ['K4', 'S3'], status: 'published', lastEdited: '28 May 2026', contentSections: 5, hasResources: true },
  { id: 'comp-004', title: 'Business Report Structure & Drafting', type: 'Assignment', module: 'Business Communication', programme: 'Business Admin L3', week: 'Week 2', duration: 60, ksbRefs: ['K4', 'S3', 'S4'], status: 'published', lastEdited: '27 May 2026', contentSections: 8, hasResources: false },
  { id: 'comp-005', title: 'Active Listening & Non-Verbal Communication', type: 'Workshop', module: 'Business Communication', programme: 'Business Admin L3', week: 'Week 3', duration: 90, ksbRefs: ['K6', 'K7', 'S5'], status: 'draft', lastEdited: '25 May 2026', contentSections: 3, hasResources: false },
  { id: 'comp-006', title: 'Chart Selection & Data Storytelling', type: 'Live Session', module: 'Data Visualisation', programme: 'Data Analyst L4', week: 'Week 4', duration: 60, ksbRefs: ['K10', 'S9'], status: 'published', lastEdited: '3 Jun 2026', contentSections: 5, hasResources: true },
  { id: 'comp-007', title: 'Tableau Dashboard — Hands-on Workshop', type: 'Workshop', module: 'Data Visualisation', programme: 'Data Analyst L4', week: 'Week 4', duration: 120, ksbRefs: ['S9', 'S10'], status: 'published', lastEdited: '2 Jun 2026', contentSections: 7, hasResources: true },
  { id: 'comp-008', title: 'Data Cleaning & Transformation in Python', type: 'Workshop', module: 'Statistical Analysis', programme: 'Data Analyst L4', week: 'Week 5', duration: 120, ksbRefs: ['S11', 'S12'], status: 'draft', lastEdited: '20 May 2026', contentSections: 2, hasResources: false },
  { id: 'comp-009', title: 'Segmentation Principles & Application', type: 'Live Session', module: 'Marketing Planning', programme: 'Marketing Exec L4', week: 'Week 6', duration: 60, ksbRefs: ['K5', 'S8'], status: 'published', lastEdited: '4 Jun 2026', contentSections: 5, quizQuestions: 12, hasResources: true },
  { id: 'comp-010', title: 'Campaign Segmentation Worksheet', type: 'Assignment', module: 'Marketing Planning', programme: 'Marketing Exec L4', week: 'Week 6', duration: 90, ksbRefs: ['K5', 'S8', 'S9'], status: 'published', lastEdited: '3 Jun 2026', contentSections: 6, quizQuestions: 8, hasResources: false },
];

export default function ComponentBuilderPage() {
  const [selectedComp, setSelectedComp] = useState<Component | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterProgramme, setFilterProgramme] = useState<string>('all');

  const types = ['all', 'Live Session', 'Workshop', 'Assignment', 'Self-study', 'Quiz'];
  const programmes = ['all', 'Business Admin L3', 'Data Analyst L4', 'Marketing Exec L4'];

  const filtered = COMPONENTS.filter(c => {
    if (filterType !== 'all' && c.type !== filterType) return false;
    if (filterProgramme !== 'all' && c.programme !== filterProgramme) return false;
    return true;
  });

  const published = COMPONENTS.filter(c => c.status === 'published').length;
  const draft = COMPONENTS.filter(c => c.status === 'draft').length;
  const totalKSBs = [...new Set(COMPONENTS.flatMap(c => c.ksbRefs))].length;

  const typeColors: Record<string, string> = {
    'Live Session': 'bg-primary-100 text-primary-700',
    'Workshop': 'bg-accent-100 text-accent-700',
    'Assignment': 'bg-amber-100 text-amber-700',
    'Self-study': 'bg-secondary-100 text-secondary-700',
    'Quiz': 'bg-rose-100 text-rose-700',
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Component Builder" pageSubtitle="Create and manage learning components — lessons, workshops, assignments, quizzes and self-study resources" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        {/* Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-puzzle-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Component Builder</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{COMPONENTS.length} components</strong> — {published} published, {draft} in draft. Covers {totalKSBs} unique KSBs across {programmes.length - 1} programmes.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{COMPONENTS.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Components</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{published}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Published</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{totalKSBs}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">KSBs</p></div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {types.map(t => (
              <button key={t} onClick={() => setFilterType(t)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filterType === t ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{t === 'all' ? 'All Types' : t}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {programmes.map(p => (
              <button key={p} onClick={() => setFilterProgramme(p)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filterProgramme === p ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{p === 'all' ? 'All Programmes' : p}</button>
            ))}
          </div>
          <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-add-line mr-1"></i> New Component</button>
        </div>

        {/* Table */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_0.8fr_0.8fr_0.8fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
            <span>Component</span>
            <span>Type</span>
            <span>Module · Programme</span>
            <span className="text-center">KSBs</span>
            <span className="text-center">Duration</span>
            <span className="text-center">Status</span>
            <span className="text-center">Action</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(c => (
              <div key={c.id} onClick={() => setSelectedComp(c)} className={`grid grid-cols-[2fr_1fr_1fr_1fr_0.8fr_0.8fr_0.8fr] gap-3 px-4 py-3 items-center cursor-pointer transition-smooth ${selectedComp?.id === c.id ? 'bg-primary-50/40 border-l-2 border-l-primary-400' : 'hover:bg-background-100/30'}`}>
                <div>
                  <span className="text-[12px] font-medium text-foreground-900 block">{c.title}</span>
                  <span className="text-[10px] text-foreground-400">{c.week} · {c.contentSections} sections</span>
                </div>
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full w-fit ${typeColors[c.type] || 'bg-foreground-100 text-foreground-500'}`}>{c.type}</span>
                <span className="text-[11px] text-foreground-500 truncate">{c.module}</span>
                <div className="flex justify-center gap-1 flex-wrap">
                  {c.ksbRefs.map(ksb => <span key={ksb} className="text-[8px] font-semibold px-1.5 py-0.5 rounded bg-secondary-100 text-secondary-700">{ksb}</span>)}
                </div>
                <span className="text-[11px] text-foreground-500 text-center">{c.duration} min</span>
                <div className="flex justify-center">
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${c.status === 'published' ? 'bg-emerald-100 text-emerald-700' : c.status === 'review' ? 'bg-amber-100 text-amber-700' : 'bg-foreground-100 text-foreground-500'}`}>{c.status}</span>
                </div>
                <div className="flex justify-center gap-1">
                  <button className="w-7 h-7 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center hover:bg-primary-200 transition-smooth cursor-pointer"><i className="ri-edit-line text-xs"></i></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail Panel */}
        {selectedComp && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-heading font-bold text-foreground-900">{selectedComp.title}</h3>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${typeColors[selectedComp.type]}`}>{selectedComp.type}</span>
                </div>
                <p className="text-[11px] text-foreground-400">{selectedComp.module} · {selectedComp.programme} · {selectedComp.week}</p>
              </div>
              <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${selectedComp.status === 'published' ? 'bg-emerald-100 text-emerald-700' : selectedComp.status === 'review' ? 'bg-amber-100 text-amber-700' : 'bg-foreground-100 text-foreground-500'}`}>{selectedComp.status}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Duration', value: `${selectedComp.duration} min`, icon: 'ri-time-line' },
                { label: 'Content Sections', value: String(selectedComp.contentSections), icon: 'ri-stack-line' },
                { label: 'Resources', value: selectedComp.hasResources ? 'Attached' : 'None', icon: 'ri-attachment-2' },
                { label: 'Last Edited', value: selectedComp.lastEdited, icon: 'ri-edit-line' },
              ].map(stat => (
                <div key={stat.label} className="bg-background-100/50 rounded-lg p-3 text-center">
                  <i className={`${stat.icon} text-foreground-300 text-sm mb-1 block`}></i>
                  <p className="text-lg font-bold text-foreground-900">{stat.value}</p>
                  <p className="text-[10px] text-foreground-400">{stat.label}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-edit-line mr-1"></i> Edit Component</button>
              <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-eye-line mr-1"></i> Preview</button>
              <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-file-copy-line mr-1"></i> Duplicate</button>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}