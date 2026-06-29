import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const curriculumNav = roleNavMap.curriculum;

interface Checkpoint {
  id: string;
  title: string;
  module: string;
  programme: string;
  week: string;
  type: string;
  ksbRefs: string[];
  passRate: number;
  submissions: number;
  avgScore: number;
  status: 'active' | 'draft' | 'archived';
  lastReviewed: string;
  gatewayLink: boolean;
}

const CHECKPOINTS: Checkpoint[] = [
  { id: 'cp-01', title: 'Business Communication Fundamentals', module: 'Business Communication', programme: 'Business Admin L3', week: 'Week 4', type: 'Knowledge Check', ksbRefs: ['K1', 'K2', 'K3'], passRate: 88, submissions: 42, avgScore: 76, status: 'active', lastReviewed: '5 Jun 2026', gatewayLink: false },
  { id: 'cp-02', title: 'Written Communication Assessment', module: 'Business Communication', programme: 'Business Admin L3', week: 'Week 8', type: 'Skills Assessment', ksbRefs: ['K4', 'S3', 'S4'], passRate: 72, submissions: 38, avgScore: 68, status: 'active', lastReviewed: '3 Jun 2026', gatewayLink: false },
  { id: 'cp-03', title: 'Organisational Culture Mid-Module Check', module: 'Organisational Culture', programme: 'Business Admin L3', week: 'Week 14', type: 'Knowledge Check', ksbRefs: ['K8', 'K9'], passRate: 91, submissions: 35, avgScore: 82, status: 'active', lastReviewed: '1 Jun 2026', gatewayLink: false },
  { id: 'cp-04', title: 'Data Visualisation Competency Test', module: 'Data Visualisation', programme: 'Data Analyst L4', week: 'Week 6', type: 'Competency Test', ksbRefs: ['K10', 'S9', 'S10'], passRate: 65, submissions: 28, avgScore: 62, status: 'active', lastReviewed: '4 Jun 2026', gatewayLink: true },
  { id: 'cp-05', title: 'Statistical Methods — Hypothesis Testing', module: 'Statistical Analysis', programme: 'Data Analyst L4', week: 'Week 10', type: 'Skills Assessment', ksbRefs: ['S11', 'S12', 'S13'], passRate: 58, submissions: 22, avgScore: 55, status: 'active', lastReviewed: '2 Jun 2026', gatewayLink: false },
  { id: 'cp-06', title: 'Segmentation Strategy Checkpoint', module: 'Marketing Planning', programme: 'Marketing Exec L4', week: 'Week 5', type: 'Knowledge Check', ksbRefs: ['K5', 'S8'], passRate: 85, submissions: 30, avgScore: 78, status: 'active', lastReviewed: '28 May 2026', gatewayLink: false },
  { id: 'cp-07', title: 'Gateway — Module 2 Readiness', module: 'Business Communication', programme: 'Business Admin L3', week: 'Week 12', type: 'Gateway Check', ksbRefs: ['K1', 'K2', 'K3', 'K4', 'S1', 'S2', 'S3', 'S4', 'B1', 'B2'], passRate: 74, submissions: 40, avgScore: 71, status: 'active', lastReviewed: '5 Jun 2026', gatewayLink: true },
  { id: 'cp-08', title: 'Digital Channels Practical Assessment', module: 'Digital Channels', programme: 'Marketing Exec L4', week: 'Week 8', type: 'Practical Assessment', ksbRefs: ['K7', 'S10', 'S11'], passRate: 80, submissions: 18, avgScore: 74, status: 'draft', lastReviewed: '22 May 2026', gatewayLink: false },
];

export default function CheckpointsPage() {
  const [selectedCP, setSelectedCP] = useState<Checkpoint | null>(null);
  const [filterProgramme, setFilterProgramme] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');

  const programmes = ['all', 'Business Admin L3', 'Data Analyst L4', 'Marketing Exec L4'];
  const types = ['all', 'Knowledge Check', 'Skills Assessment', 'Competency Test', 'Gateway Check', 'Practical Assessment'];

  const filtered = CHECKPOINTS.filter(c => {
    if (filterProgramme !== 'all' && c.programme !== filterProgramme) return false;
    if (filterType !== 'all' && c.type !== filterType) return false;
    return true;
  });

  const active = CHECKPOINTS.filter(c => c.status === 'active').length;
  const avgPass = Math.round(CHECKPOINTS.reduce((s, c) => s + c.passRate, 0) / CHECKPOINTS.length);
  const totalSubs = CHECKPOINTS.reduce((s, c) => s + c.submissions, 0);
  const gatewayCPs = CHECKPOINTS.filter(c => c.gatewayLink).length;

  const typeColors: Record<string, string> = {
    'Knowledge Check': 'bg-primary-100 text-primary-700',
    'Skills Assessment': 'bg-accent-100 text-accent-700',
    'Competency Test': 'bg-rose-100 text-rose-700',
    'Gateway Check': 'bg-amber-100 text-amber-700',
    'Practical Assessment': 'bg-emerald-100 text-emerald-700',
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Checkpoint Assessments" pageSubtitle="Module checkpoint assessments — knowledge checks, skills tests and gateway readiness" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        {/* Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-check-double-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Checkpoint Assessments</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{CHECKPOINTS.length} checkpoints</strong> — {active} active. Avg pass rate: {avgPass}%. {totalSubs} total submissions. {gatewayCPs} gateway-linked.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{CHECKPOINTS.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Checkpoints</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{avgPass}%</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Pass Rate</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{totalSubs}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Submissions</p></div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {programmes.map(p => (
              <button key={p} onClick={() => setFilterProgramme(p)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filterProgramme === p ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{p === 'all' ? 'All Programmes' : p}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {types.map(t => (
              <button key={t} onClick={() => setFilterType(t)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filterType === t ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{t === 'all' ? 'All Types' : t}</button>
            ))}
          </div>
          <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-add-line mr-1"></i> New Checkpoint</button>
        </div>

        {/* Table */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_0.8fr_0.8fr_0.8fr_0.8fr_1fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
            <span>Checkpoint</span>
            <span>Type</span>
            <span className="text-center">Week</span>
            <span className="text-center">Pass Rate</span>
            <span className="text-center">Avg Score</span>
            <span className="text-center">Submissions</span>
            <span className="text-center">Status</span>
            <span className="text-center">Action</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(c => (
              <div key={c.id} onClick={() => setSelectedCP(c)} className={`grid grid-cols-[2fr_1fr_1fr_0.8fr_0.8fr_0.8fr_0.8fr_1fr] gap-3 px-4 py-3 items-center cursor-pointer transition-smooth ${selectedCP?.id === c.id ? 'bg-primary-50/40 border-l-2 border-l-primary-400' : 'hover:bg-background-100/30'}`}>
                <div className="flex items-center gap-2 min-w-0">
                  {c.gatewayLink && <i className="ri-flag-line text-amber-500 text-sm shrink-0" title="Gateway-linked"></i>}
                  <div className="min-w-0">
                    <span className="text-[12px] font-medium text-foreground-900 block truncate">{c.title}</span>
                    <span className="text-[10px] text-foreground-400">{c.module}</span>
                  </div>
                </div>
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full w-fit whitespace-nowrap ${typeColors[c.type] || 'bg-foreground-100 text-foreground-500'}`}>{c.type}</span>
                <span className="text-[11px] text-foreground-500 text-center">{c.week}</span>
                <div className="flex items-center justify-center gap-1.5">
                  <div className="w-10 bg-background-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${c.passRate >= 80 ? 'bg-emerald-500' : c.passRate >= 65 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${c.passRate}%` }}></div>
                  </div>
                  <span className={`text-[11px] font-semibold ${c.passRate >= 80 ? 'text-emerald-600' : c.passRate >= 65 ? 'text-amber-600' : 'text-red-600'}`}>{c.passRate}%</span>
                </div>
                <span className="text-[11px] text-foreground-500 text-center">{c.avgScore}</span>
                <span className="text-[11px] text-foreground-500 text-center">{c.submissions}</span>
                <div className="flex justify-center">
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${c.status === 'active' ? 'bg-emerald-100 text-emerald-700' : c.status === 'draft' ? 'bg-foreground-100 text-foreground-500' : 'bg-foreground-100 text-foreground-500'}`}>{c.status}</span>
                </div>
                <div className="flex justify-center">
                  <button className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Review</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail Panel */}
        {selectedCP && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-heading font-bold text-foreground-900">{selectedCP.title}</h3>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${typeColors[selectedCP.type]}`}>{selectedCP.type}</span>
                  {selectedCP.gatewayLink && <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Gateway</span>}
                </div>
                <p className="text-[11px] text-foreground-400">{selectedCP.module} · {selectedCP.programme} · {selectedCP.week}</p>
              </div>
              <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${selectedCP.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-500'}`}>{selectedCP.status}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
              {[
                { label: 'Pass Rate', value: `${selectedCP.passRate}%` },
                { label: 'Avg Score', value: String(selectedCP.avgScore) },
                { label: 'Submissions', value: String(selectedCP.submissions) },
                { label: 'Last Reviewed', value: selectedCP.lastReviewed },
                { label: 'KSB Refs', value: selectedCP.ksbRefs.length.toString() },
              ].map(s => (
                <div key={s.label} className="bg-background-100/50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-foreground-900">{s.value}</p>
                  <p className="text-[10px] text-foreground-400">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-edit-line mr-1"></i> Edit Checkpoint</button>
              <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-bar-chart-2-line mr-1"></i> View Analytics</button>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}