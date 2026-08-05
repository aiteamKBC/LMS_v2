import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

interface ModuleQA {
  id: string;
  programme: string;
  standard: string;
  module: string;
  version: string;
  lastUpdated: string;
  status: 'Draft' | 'Review' | 'Approved' | 'Published';
  qaChecks: { label: string; status: 'pass' | 'fail' | 'pending' }[];
  author: string;
  reviewer: string;
}

const MODULE_QA_DATA: ModuleQA[] = [
  { id: 'mq-01', programme: 'Business Admin L3', standard: 'ST0070', module: 'Communication Skills', version: '2.1', lastUpdated: '5 Jun', status: 'Approved', qaChecks: [{ label: 'KSB Alignment', status: 'pass' }, { label: 'Assessment Balance', status: 'pass' }, { label: 'Accessibility', status: 'pass' }, { label: 'IfATE Mapping', status: 'pass' }], author: 'Sarah Chen', reviewer: 'Emma Clarke' },
  { id: 'mq-02', programme: 'Business Admin L3', standard: 'ST0070', module: 'Digital Skills', version: '2.0', lastUpdated: '3 Jun', status: 'Review', qaChecks: [{ label: 'KSB Alignment', status: 'pass' }, { label: 'Assessment Balance', status: 'pending' }, { label: 'Accessibility', status: 'pass' }, { label: 'IfATE Mapping', status: 'fail' }], author: 'James Whitfield', reviewer: 'Emma Clarke' },
  { id: 'mq-03', programme: 'Digital Marketing L3', standard: 'ST0094', module: 'SEO Fundamentals', version: '1.2', lastUpdated: '7 Jun', status: 'Draft', qaChecks: [{ label: 'KSB Alignment', status: 'pending' }, { label: 'Assessment Balance', status: 'pending' }, { label: 'Accessibility', status: 'pass' }, { label: 'IfATE Mapping', status: 'pending' }], author: 'Tom Whitfield', reviewer: '—' },
  { id: 'mq-04', programme: 'Digital Marketing L3', standard: 'ST0094', module: 'Social Media Strategy', version: '1.1', lastUpdated: '1 Jun', status: 'Published', qaChecks: [{ label: 'KSB Alignment', status: 'pass' }, { label: 'Assessment Balance', status: 'pass' }, { label: 'Accessibility', status: 'pass' }, { label: 'IfATE Mapping', status: 'pass' }], author: 'Rebecca Okonkwo', reviewer: 'Emma Clarke' },
  { id: 'mq-05', programme: 'Data Technician L3', standard: 'ST0118', module: 'Data Analysis', version: '1.0', lastUpdated: '8 Jun', status: 'Draft', qaChecks: [{ label: 'KSB Alignment', status: 'fail' }, { label: 'Assessment Balance', status: 'pending' }, { label: 'Accessibility', status: 'pass' }, { label: 'IfATE Mapping', status: 'fail' }], author: 'Priya Patel', reviewer: '—' },
  { id: 'mq-06', programme: 'Early Years L3', standard: 'ST0135', module: 'Child Development', version: '3.0', lastUpdated: '2 Jun', status: 'Published', qaChecks: [{ label: 'KSB Alignment', status: 'pass' }, { label: 'Assessment Balance', status: 'pass' }, { label: 'Accessibility', status: 'pass' }, { label: 'IfATE Mapping', status: 'pass' }], author: 'Dr. Amara Okafor', reviewer: 'James Whitfield' },
  { id: 'mq-07', programme: 'Software Dev L4', standard: 'ST0116', module: 'Agile Methodology', version: '1.0', lastUpdated: '6 Jun', status: 'Review', qaChecks: [{ label: 'KSB Alignment', status: 'pass' }, { label: 'Assessment Balance', status: 'fail' }, { label: 'Accessibility', status: 'pass' }, { label: 'IfATE Mapping', status: 'pass' }], author: 'David Chen', reviewer: 'Emma Clarke' },
  { id: 'mq-08', programme: 'HR Consultant L5', standard: 'ST0234', module: 'Employment Law', version: '1.0', lastUpdated: '4 Jun', status: 'Draft', qaChecks: [{ label: 'KSB Alignment', status: 'pending' }, { label: 'Assessment Balance', status: 'pending' }, { label: 'Accessibility', status: 'pending' }, { label: 'IfATE Mapping', status: 'pending' }], author: 'Aisha Patel', reviewer: '—' },
];

const statusConfig: Record<string, { bg: string; text: string }> = {
  Draft: { bg: 'bg-amber-100', text: 'text-amber-700' },
  Review: { bg: 'bg-primary-100', text: 'text-primary-700' },
  Approved: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  Published: { bg: 'bg-secondary-100', text: 'text-secondary-700' },
};

const checkConfig: Record<string, { icon: string; color: string }> = {
  pass: { icon: 'ri-check-line', color: 'text-emerald-600' },
  fail: { icon: 'ri-close-line', color: 'text-red-600' },
  pending: { icon: 'ri-time-line', color: 'text-amber-600' },
};

export default function QAModulePage() {
  const [filterStatus, setFilterStatus] = useState('All');

  const filtered = filterStatus === 'All' ? MODULE_QA_DATA : MODULE_QA_DATA.filter(m => m.status === filterStatus);

  const stats = {
    draft: MODULE_QA_DATA.filter(m => m.status === 'Draft').length,
    review: MODULE_QA_DATA.filter(m => m.status === 'Review').length,
    approved: MODULE_QA_DATA.filter(m => m.status === 'Approved').length,
    published: MODULE_QA_DATA.filter(m => m.status === 'Published').length,
  };

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="Module QA" pageSubtitle="Review and quality assure curriculum modules against IfATE standards"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Module QA"
          description={`${stats.draft} modules in draft. ${stats.review} under review. ${stats.approved} approved. ${stats.published} published and live.`}
          icon="ri-stack-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20curriculum%20module%20review%20desk%20with%20apprenticeship%20standards%20documents%20purple%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-module-hero&orientation=landscape"
          imageAlt="Module QA"
          stats={[
            { label: 'In Draft', value: String(stats.draft) },
            { label: 'Under Review', value: String(stats.review) },
            { label: 'Published', value: String(stats.published) },
          ]}
        />

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Draft', value: stats.draft, icon: 'ri-draft-line', color: 'amber' },
            { label: 'Under Review', value: stats.review, icon: 'ri-eye-line', color: 'primary' },
            { label: 'Approved', value: stats.approved, icon: 'ri-check-line', color: 'emerald' },
            { label: 'Published', value: stats.published, icon: 'ri-book-open-line', color: 'secondary' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'amber' ? 'bg-amber-100 text-amber-700' : s.color === 'primary' ? 'bg-primary-100 text-primary-700' : s.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-secondary-100 text-secondary-700'}`}>
                <AppIcon className={`${s.icon} text-sm`}></AppIcon>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-foreground-400">Status:</span>
          {['All', 'Draft', 'Review', 'Approved', 'Published'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterStatus === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
        </div>

        {/* Module Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(module => (
            <div key={module.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${statusConfig[module.status].bg} ${statusConfig[module.status].text}`}>{module.status}</span>
                  <span className="text-[9px] font-medium text-foreground-400">v{module.version}</span>
                </div>
                <span className="text-[10px] text-foreground-400">Updated {module.lastUpdated}</span>
              </div>
              <h4 className="text-sm font-semibold text-foreground-900 mb-1">{module.module}</h4>
              <div className="flex items-center gap-2 text-[11px] text-foreground-400 mb-3">
                <span>{module.programme}</span>
                <span className="text-foreground-300">&middot;</span>
                <span>{module.standard}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {module.qaChecks.map(check => (
                  <div key={check.label} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] bg-background-100`}>
                    <AppIcon className={`${checkConfig[check.status].icon} ${checkConfig[check.status].color} text-sm`}></AppIcon>
                    <span className="text-foreground-600">{check.label}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-[11px] text-foreground-400">
                <span>Author: <strong className="text-foreground-700">{module.author}</strong></span>
                <span>Reviewer: <strong className="text-foreground-700">{module.reviewer}</strong></span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}