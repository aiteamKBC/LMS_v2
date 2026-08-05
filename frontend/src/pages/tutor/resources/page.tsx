import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const tutorNav = roleNavMap.tutor;

interface Resource {
  id: string;
  title: string;
  type: string;
  module: string;
  cohort: string;
  format: string;
  size: string;
  lastUpdated: string;
  downloads: number;
  tags: string[];
}

const RESOURCES: Resource[] = [
  { id: 'r-01', title: 'Business Communication — Session Slides Week 1-4', type: 'Slide Deck', module: 'Business Communication', cohort: 'Cohort A — BA', format: 'PowerPoint', size: '4.2 MB', lastUpdated: '2 Jun 2026', downloads: 48, tags: ['slides', 'communication', 'week-1-4'] },
  { id: 'r-02', title: 'Campaign Segmentation Worksheet Template', type: 'Worksheet', module: 'Marketing Planning', cohort: 'Cohort C — BA', format: 'Word', size: '1.8 MB', lastUpdated: '28 May 2026', downloads: 32, tags: ['worksheet', 'marketing', 'segmentation'] },
  { id: 'r-03', title: 'Data Analysis — Python Exercise Pack', type: 'Exercise', module: 'Data Analysis', cohort: 'Cohort D — DT', format: 'Jupyter', size: '6.5 MB', lastUpdated: '15 May 2026', downloads: 28, tags: ['python', 'data', 'exercises'] },
  { id: 'r-04', title: 'Financial Accounting — Practice Questions Set A', type: 'Practice Questions', module: 'Financial Accounting', cohort: 'Cohort C — BA', format: 'PDF', size: '2.1 MB', lastUpdated: '10 May 2026', downloads: 56, tags: ['accounting', 'practice', 'exam-prep'] },
  { id: 'r-05', title: 'Risk Management Framework Guide', type: 'Guide', module: 'Risk Management', cohort: 'Cohort A — BA', format: 'PDF', size: '3.4 MB', lastUpdated: '1 Jun 2026', downloads: 22, tags: ['risk', 'framework', 'guide'] },
  { id: 'r-06', title: 'Business Admin — Board Meeting Role Play Script', type: 'Role Play', module: 'Business Admin Practice', cohort: 'Cohort A — BA', format: 'Word', size: '1.2 MB', lastUpdated: '20 May 2026', downloads: 38, tags: ['role-play', 'meeting', 'admin'] },
  { id: 'r-07', title: 'Software Development — Code Review Checklist', type: 'Checklist', module: 'Software Development', cohort: 'Cohort F — SWE', format: 'PDF', size: '0.8 MB', lastUpdated: '5 Jun 2026', downloads: 45, tags: ['code-review', 'checklist', 'development'] },
  { id: 'r-08', title: 'Digital Marketing — Social Media Strategy Template', type: 'Template', module: 'Digital Channels', cohort: 'Cohort B — DM', format: 'Word', size: '2.5 MB', lastUpdated: '3 Jun 2026', downloads: 41, tags: ['social-media', 'strategy', 'template'] },
  { id: 'r-09', title: 'HR Induction — Employment Law Summary', type: 'Summary', module: 'HR Induction', cohort: 'Cohort E — EYE', format: 'PDF', size: '1.9 MB', lastUpdated: '25 May 2026', downloads: 19, tags: ['hr', 'employment-law', 'induction'] },
  { id: 'r-10', title: 'Project Management — Gantt Chart Excel Template', type: 'Template', module: 'Project Management', cohort: 'Cohort A — BA', format: 'Excel', size: '0.5 MB', lastUpdated: '8 Jun 2026', downloads: 35, tags: ['gantt', 'project', 'template'] },
  { id: 'r-11', title: 'Business Communication — Presentation Rubric', type: 'Rubric', module: 'Business Communication', cohort: 'Cohort A — BA', format: 'PDF', size: '0.6 MB', lastUpdated: '12 May 2026', downloads: 62, tags: ['rubric', 'presentation', 'assessment'] },
  { id: 'r-12', title: 'Data Analysis — SQL Quick Reference Card', type: 'Reference', module: 'Data Analysis', cohort: 'Cohort D — DT', format: 'PDF', size: '0.4 MB', lastUpdated: '18 May 2026', downloads: 73, tags: ['sql', 'reference', 'cheatsheet'] },
];

const TYPE_ICONS: Record<string, string> = {
  'Slide Deck': 'ri-slideshow-3-line',
  'Worksheet': 'ri-file-text-line',
  'Exercise': 'ri-code-line',
  'Practice Questions': 'ri-question-answer-line',
  'Guide': 'ri-book-read-line',
  'Role Play': 'ri-team-line',
  'Checklist': 'ri-check-double-line',
  'Template': 'ri-layout-line',
  'Summary': 'ri-file-list-3-line',
  'Rubric': 'ri-bar-chart-line',
  'Reference': 'ri-bookmark-line',
};

export default function TutorResourcesPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = RESOURCES.filter(r => {
    if (typeFilter !== 'all' && r.type !== typeFilter) return false;
    if (search && !r.title.toLowerCase().includes(search.toLowerCase()) && !r.module.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalDownloads = RESOURCES.reduce((s, r) => s + r.downloads, 0);
  const uniqueTypes = [...new Set(RESOURCES.map(r => r.type))].length;

  return (
    <WorkspaceShell role="tutor" roleLabel={tutorNav.label} navItems={tutorNav.items} workspaceLabel={tutorNav.workspaceLabel} pageTitle="Resources" pageSubtitle="Teaching resources, lesson materials, templates and curriculum assets" userName="Rachel Myers" userRole="Business Admin Tutor">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><AppIcon className="ri-folder-line text-white text-2xl"></AppIcon></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Teaching Resources</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">{RESOURCES.length} resources across {uniqueTypes} types · {totalDownloads} total downloads · covering all your cohorts</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{RESOURCES.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Resources</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{uniqueTypes}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Types</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{totalDownloads}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Downloads</p></div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-between">
          <div className="relative flex-1 max-w-xs">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
            <input type="text" placeholder="Search resources..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-900 placeholder-foreground-300 outline-none focus:border-primary-300" />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
              {['all', ...RESOURCES.map(r => r.type).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6)].map(t => (
                <button key={t} onClick={() => setTypeFilter(t)} className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${typeFilter === t ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{t === 'all' ? 'All Types' : t}</button>
              ))}
            </div>
            <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-upload-cloud-line mr-1"></AppIcon> Upload</button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(r => (
            <div key={r.id} onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 cursor-pointer hover:border-primary-200/50 transition-smooth">
              <div className="flex items-start justify-between mb-3">
                <span className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center"><AppIcon className={`${TYPE_ICONS[r.type] || 'ri-file-line'} text-base`}></AppIcon></span>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-foreground-100 text-foreground-500">{r.format}</span>
                  <span className="text-[9px] text-foreground-400">{r.size}</span>
                </div>
              </div>
              <h4 className="text-[13px] font-semibold text-foreground-900 mb-1 leading-snug">{r.title}</h4>
              <p className="text-[11px] text-foreground-400 mb-3">{r.module} · {r.cohort}</p>
              <div className="flex items-center gap-1.5 flex-wrap mb-3">
                {r.tags.map(tag => (
                  <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-400">{tag}</span>
                ))}
              </div>
              <div className="flex items-center justify-between text-[10px] text-foreground-400">
                <span><AppIcon className="ri-download-line mr-1"></AppIcon>{r.downloads}</span>
                <span>Updated {r.lastUpdated}</span>
              </div>
              {expandedId === r.id && (
                <div className="mt-3 pt-3 border-t border-background-200/30 flex items-center gap-2">
                  <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap flex-1"><AppIcon className="ri-download-line mr-1"></AppIcon> Download</button>
                  <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-pencil-line mr-1"></AppIcon> Edit</button>
                  <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-delete-bin-line"></AppIcon></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}