import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

interface KSBQA {
  id: string;
  learner: string;
  ksbRef: string;
  ksbTitle: string;
  type: 'Knowledge' | 'Skill' | 'Behaviour';
  evidenceCount: number;
  minRequired: number;
  status: 'Pending' | 'Under Review' | 'Validated' | 'Insufficient';
  risk: 'low' | 'medium' | 'high';
  assessor: string;
  lastUpdated: string;
}

const KSB_QA_DATA: KSBQA[] = [
  { id: 'kq-01', learner: 'James Okonkwo', ksbRef: 'S12', ksbTitle: 'Data Analysis & Interpretation', type: 'Skill', evidenceCount: 1, minRequired: 2, status: 'Insufficient', risk: 'high', assessor: 'David Chen', lastUpdated: '7 Jun' },
  { id: 'kq-02', learner: 'Aisha Patel', ksbRef: 'K8', ksbTitle: 'Financial Principles & Reporting', type: 'Knowledge', evidenceCount: 2, minRequired: 2, status: 'Validated', risk: 'low', assessor: 'Emma Clarke', lastUpdated: '6 Jun' },
  { id: 'kq-03', learner: 'Sophie Williams', ksbRef: 'B3', ksbTitle: 'Professional Ethics & Integrity', type: 'Behaviour', evidenceCount: 3, minRequired: 2, status: 'Validated', risk: 'low', assessor: 'Emma Clarke', lastUpdated: '5 Jun' },
  { id: 'kq-04', learner: 'Liam Foster', ksbRef: 'S18', ksbTitle: 'Risk Mitigation Strategies', type: 'Skill', evidenceCount: 1, minRequired: 2, status: 'Under Review', risk: 'medium', assessor: 'James Whitfield', lastUpdated: '4 Jun' },
  { id: 'kq-05', learner: 'David Chen', ksbRef: 'K15', ksbTitle: 'Software Architecture Patterns', type: 'Knowledge', evidenceCount: 2, minRequired: 2, status: 'Validated', risk: 'low', assessor: 'Emma Clarke', lastUpdated: '3 Jun' },
  { id: 'kq-06', learner: 'Emily Watson', ksbRef: 'S9', ksbTitle: 'Campaign Analytics & Reporting', type: 'Skill', evidenceCount: 4, minRequired: 3, status: 'Validated', risk: 'low', assessor: 'James Whitfield', lastUpdated: '2 Jun' },
  { id: 'kq-07', learner: 'Sarah Mitchell', ksbRef: 'B1', ksbTitle: 'Communication & Teamwork', type: 'Behaviour', evidenceCount: 2, minRequired: 2, status: 'Pending', risk: 'low', assessor: '—', lastUpdated: '1 Jun' },
  { id: 'kq-08', learner: 'Maya Kapoor', ksbRef: 'K3', ksbTitle: 'HR Legislation & Compliance', type: 'Knowledge', evidenceCount: 1, minRequired: 2, status: 'Insufficient', risk: 'high', assessor: 'Emma Clarke', lastUpdated: '31 May' },
  { id: 'kq-09', learner: 'Oliver Smith', ksbRef: 'S7', ksbTitle: 'Strategic Planning', type: 'Skill', evidenceCount: 5, minRequired: 3, status: 'Validated', risk: 'low', assessor: 'James Whitfield', lastUpdated: '30 May' },
  { id: 'kq-10', learner: 'Chloe Brown', ksbRef: 'B5', ksbTitle: 'Adaptability & Resilience', type: 'Behaviour', evidenceCount: 2, minRequired: 2, status: 'Under Review', risk: 'medium', assessor: 'Emma Clarke', lastUpdated: '29 May' },
];

const statusConfig: Record<string, { bg: string; text: string; icon: string }> = {
  Pending: { bg: 'bg-amber-100', text: 'text-amber-700', icon: 'ri-time-line' },
  'Under Review': { bg: 'bg-primary-100', text: 'text-primary-700', icon: 'ri-eye-line' },
  Validated: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: 'ri-check-line' },
  Insufficient: { bg: 'bg-red-100', text: 'text-red-700', icon: 'ri-close-line' },
};

const riskConfig: Record<string, { bg: string; text: string }> = {
  low: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-700' },
  high: { bg: 'bg-red-100', text: 'text-red-700' },
};

const typeConfig: Record<string, { bg: string; text: string }> = {
  Knowledge: { bg: 'bg-primary-100', text: 'text-primary-700' },
  Skill: { bg: 'bg-accent-100', text: 'text-accent-700' },
  Behaviour: { bg: 'bg-secondary-100', text: 'text-secondary-700' },
};

export default function QAKSBPage() {
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterType, setFilterType] = useState('All');

  const filtered = KSB_QA_DATA.filter(k => {
    const statusMatch = filterStatus === 'All' || k.status === filterStatus;
    const typeMatch = filterType === 'All' || k.type === filterType;
    return statusMatch && typeMatch;
  });

  const stats = {
    pending: KSB_QA_DATA.filter(k => k.status === 'Pending').length,
    underReview: KSB_QA_DATA.filter(k => k.status === 'Under Review').length,
    validated: KSB_QA_DATA.filter(k => k.status === 'Validated').length,
    insufficient: KSB_QA_DATA.filter(k => k.status === 'Insufficient').length,
  };

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="KSB QA" pageSubtitle="Quality assure KSB assessments and progression judgements"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="KSB QA"
          description={`${stats.pending} pending. ${stats.underReview} under review. ${stats.validated} validated. ${stats.insufficient} flagged insufficient.`}
          icon="ri-bar-chart-2-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20apprenticeship%20KSB%20knowledge%20skills%20behaviour%20assessment%20review%20chart%20purple%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-ksb-hero&orientation=landscape"
          imageAlt="KSB QA"
          stats={[
            { label: 'Pending', value: String(stats.pending) },
            { label: 'Under Review', value: String(stats.underReview) },
            { label: 'Validated', value: String(stats.validated) },
          ]}
        />

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pending', value: stats.pending, icon: 'ri-time-line', color: 'amber' },
            { label: 'Under Review', value: stats.underReview, icon: 'ri-eye-line', color: 'primary' },
            { label: 'Validated', value: stats.validated, icon: 'ri-check-line', color: 'emerald' },
            { label: 'Insufficient', value: stats.insufficient, icon: 'ri-close-line', color: 'red' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'amber' ? 'bg-amber-100 text-amber-700' : s.color === 'primary' ? 'bg-primary-100 text-primary-700' : s.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
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
          {['All', 'Pending', 'Under Review', 'Validated', 'Insufficient'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterStatus === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
          <span className="text-[12px] text-foreground-400 ml-2">Type:</span>
          {['All', 'Knowledge', 'Skill', 'Behaviour'].map(t => (
            <button key={t} onClick={() => setFilterType(t)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterType === t ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{t}</button>
          ))}
        </div>

        {/* KSB List */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="divide-y divide-background-200/30">
            {filtered.map(item => {
              const evidencePct = Math.min(100, (item.evidenceCount / item.minRequired) * 100);
              return (
                <div key={item.id} className={`p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${item.risk === 'high' ? 'bg-red-50/30' : ''}`}>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${typeConfig[item.type].bg} ${typeConfig[item.type].text}`}>
                      <AppIcon className={`${item.type === 'Knowledge' ? 'ri-book-line' : item.type === 'Skill' ? 'ri-tools-line' : 'ri-user-heart-line'} text-sm`}></AppIcon>
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium text-foreground-900">{item.ksbRef} — {item.ksbTitle}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${typeConfig[item.type].bg} ${typeConfig[item.type].text}`}>{item.type}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${riskConfig[item.risk].bg} ${riskConfig[item.risk].text}`}>{item.risk === 'low' ? 'Low' : item.risk === 'medium' ? 'Medium' : 'High'}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{item.learner} &middot; Assessor: {item.assessor} &middot; Updated {item.lastUpdated}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="w-24">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[9px] text-foreground-400">Evidence</span>
                        <span className="text-[9px] text-foreground-600 font-medium">{item.evidenceCount}/{item.minRequired}</span>
                      </div>
                      <div className="h-1.5 bg-background-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${evidencePct >= 100 ? 'bg-emerald-500' : evidencePct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${evidencePct}%` }}></div>
                      </div>
                    </div>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[item.status].bg} ${statusConfig[item.status].text}`}>{item.status}</span>
                    {item.status === 'Pending' && (
                      <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Review</button>
                    )}
                    {item.status === 'Insufficient' && (
                      <button className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[10px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap">Flag</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}