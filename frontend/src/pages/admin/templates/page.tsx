import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const TEMPLATES_DATA = [
  { id: 't1', name: 'Monthly Coaching Agenda', type: 'Document', category: 'Coaching', usage: 86, status: 'active' as const, lastUpdated: '1 Jun 2026', version: '2.1' },
  { id: 't2', name: 'Progress Review Template', type: 'Document', category: 'Reviews', usage: 42, status: 'active' as const, lastUpdated: '15 May 2026', version: '3.0' },
  { id: 't3', name: 'Welcome Email — New Learner', type: 'Email', category: 'Onboarding', usage: 124, status: 'active' as const, lastUpdated: '1 Apr 2026', version: '1.5' },
  { id: 't4', name: 'Absence Follow-up Email', type: 'Email', category: 'Attendance', usage: 34, status: 'active' as const, lastUpdated: '10 May 2026', version: '1.2' },
  { id: 't5', name: 'Evidence Feedback Template', type: 'Document', category: 'Evidence', usage: 210, status: 'active' as const, lastUpdated: '5 Jun 2026', version: '2.0' },
  { id: 't6', name: 'KSB Assessment Rubric', type: 'Document', category: 'KSB', usage: 67, status: 'active' as const, lastUpdated: '20 May 2026', version: '1.8' },
  { id: 't7', name: 'Employer Update Newsletter', type: 'Email', category: 'Employer', usage: 12, status: 'active' as const, lastUpdated: '1 Jun 2026', version: '1.0' },
  { id: 't8', name: 'Gateway Readiness Letter', type: 'Document', category: 'Gateway', usage: 8, status: 'draft' as const, lastUpdated: '1 Jun 2026', version: '0.9' },
  { id: 't9', name: 'Completion Certificate', type: 'Document', category: 'Compliance', usage: 45, status: 'active' as const, lastUpdated: '1 Jan 2026', version: '1.0' },
  { id: 't10', name: 'WhatsApp Engagement Message', type: 'Message', category: 'Engagement', usage: 340, status: 'active' as const, lastUpdated: '9 Jun 2026', version: '1.3' },
];

export default function AdminTemplatesPage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const activeCount = TEMPLATES_DATA.filter(t => t.status === 'active').length;
  const totalUsage = TEMPLATES_DATA.reduce((a, b) => a + b.usage, 0);

  const filtered = TEMPLATES_DATA.filter(t => {
    const matchSearch = t.name.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === 'all' || t.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  const template = selectedTemplate ? TEMPLATES_DATA.find(t => t.id === selectedTemplate) : null;

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Templates" pageSubtitle="Document templates, email templates, and message templates" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <AppIcon className="ri-layout-4-line text-white text-2xl"></AppIcon>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Template Library</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{TEMPLATES_DATA.length} templates</strong> — {activeCount} active. {totalUsage} total usages across all templates.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{TEMPLATES_DATA.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Templates</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalUsage}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Usages</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 w-full lg:w-auto">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
            <input type="text" placeholder="Search templates..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
          </div>
          <div className="flex items-center gap-2">
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Categories</option>
              <option value="Coaching">Coaching</option>
              <option value="Reviews">Reviews</option>
              <option value="Onboarding">Onboarding</option>
              <option value="Attendance">Attendance</option>
              <option value="Evidence">Evidence</option>
              <option value="KSB">KSB</option>
              <option value="Employer">Employer</option>
              <option value="Gateway">Gateway</option>
              <option value="Compliance">Compliance</option>
              <option value="Engagement">Engagement</option>
            </select>
            <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-add-line mr-1.5"></AppIcon> New Template
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Templates List */}
          <div className="lg:col-span-2 space-y-3">
            {filtered.map(t => {
              const typeIcons = { Document: 'ri-file-text-line', Email: 'ri-mail-line', Message: 'ri-chat-1-line' };
              const statusColors = {
                active: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
                draft: 'bg-background-100 text-foreground-500 border-foreground-200/60',
              };
              return (
                <div key={t.id} onClick={() => setSelectedTemplate(t.id)} className={`flex items-center gap-4 bg-background-50 rounded-xl border p-4 cursor-pointer transition-smooth ${selectedTemplate === t.id ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60 hover:border-background-300/60'}`}>
                  <div className="w-10 h-10 rounded-lg bg-secondary-100 flex items-center justify-center shrink-0">
                    <AppIcon className={`${typeIcons[t.type as keyof typeof typeIcons] || 'ri-file-text-line'} text-secondary-600 text-sm`}></AppIcon>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{t.name}</p>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700 border border-secondary-200/50">{t.category}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColors[t.status]}`}>{t.status}</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{t.type} · v{t.version} · Used {t.usage} times · Updated {t.lastUpdated}</p>
                  </div>
                  <AppIcon className={`ri-arrow-right-s-line text-foreground-300 ${selectedTemplate === t.id ? 'text-primary-500' : ''}`}></AppIcon>
                </div>
              );
            })}
          </div>

          {/* Template Detail */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 h-fit">
            {template ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{template.name}</h3>
                  <p className="text-[12px] text-foreground-500 mt-1">{template.type} · {template.category} · v{template.version}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{template.usage}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Usages</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{template.version}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Version</p>
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t border-foreground-200/60">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Status</span>
                    <span className="text-foreground-700 font-medium capitalize">{template.status}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Last Updated</span>
                    <span className="text-foreground-700 font-medium">{template.lastUpdated}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Edit Template</button>
                  <button className="flex-1 px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">Preview</button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <AppIcon className="ri-layout-4-line text-foreground-300 text-xl"></AppIcon>
                </div>
                <p className="text-sm text-foreground-500">Select a template to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}