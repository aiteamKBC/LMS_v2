import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';
import { useToast } from '@/hooks/useToast';

const qaNav = roleNavMap.qa;

interface Sample {
  id: string;
  type: string;
  scope: string;
  total: number;
  sampled: number;
  percentage: number;
  status: 'Scheduled' | 'In Progress' | 'Completed';
  officer: string;
  startDate: string;
  endDate: string;
  methodology: string;
}

const INITIAL_SAMPLING_DATA: Sample[] = [
  { id: 'sp-01', type: 'Evidence', scope: 'All learners — Cohort B (DM)', total: 120, sampled: 18, percentage: 15, status: 'In Progress', officer: 'Emma Clarke', startDate: '1 Jun', endDate: '15 Jun', methodology: 'Stratified random — 15% of all evidence items' },
  { id: 'sp-02', type: 'OTJH', scope: 'All learners — Cohort A (BA)', total: 340, sampled: 34, percentage: 10, status: 'Scheduled', officer: '—', startDate: '15 Jun', endDate: '30 Jun', methodology: 'Systematic sampling — every 10th OTJH entry' },
  { id: 'sp-03', type: 'KSB', scope: 'High-risk learners only', total: 45, sampled: 12, percentage: 27, status: 'Completed', officer: 'QA Lead', startDate: '15 May', endDate: '31 May', methodology: 'Targeted — all high-risk KSBs' },
  { id: 'sp-04', type: 'Progress Reviews', scope: 'Cohort C (BA) — June 2026', total: 8, sampled: 3, percentage: 38, status: 'In Progress', officer: 'Emma Clarke', startDate: '5 Jun', endDate: '12 Jun', methodology: 'Random — 38% of all reviews' },
  { id: 'sp-05', type: 'Evidence', scope: 'Cohort A (BA) — Marketing Module', total: 56, sampled: 8, percentage: 14, status: 'Completed', officer: 'James Whitfield', startDate: '1 May', endDate: '15 May', methodology: 'Random — 14% of module evidence' },
  { id: 'sp-06', type: 'OTJH', scope: 'High-risk learners — Q2', total: 89, sampled: 22, percentage: 25, status: 'In Progress', officer: 'Emma Clarke', startDate: '1 Jun', endDate: '20 Jun', methodology: 'Targeted — 25% of flagged entries' },
  { id: 'sp-07', type: 'Module', scope: 'All published modules', total: 24, sampled: 6, percentage: 25, status: 'Scheduled', officer: '—', startDate: '1 Jul', endDate: '15 Jul', methodology: 'Random — 25% of curriculum modules' },
  { id: 'sp-08', type: 'Report', scope: 'Leadership reports — Q2', total: 12, sampled: 4, percentage: 33, status: 'Completed', officer: 'QA Lead', startDate: '15 May', endDate: '31 May', methodology: 'Random — 33% of quarterly reports' },
];

const statusConfig: Record<string, { bg: string; text: string; icon: string }> = {
  Scheduled: { bg: 'bg-foreground-100', text: 'text-foreground-500', icon: 'ri-calendar-line' },
  'In Progress': { bg: 'bg-primary-100', text: 'text-primary-700', icon: 'ri-loader-4-line' },
  Completed: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: 'ri-check-line' },
};

// ─── New Sample Modal ──────────────────────────────────────────────────
function NewSampleModal({ onClose, onCreate }: { onClose: () => void; onCreate: (sample: Partial<Sample>) => void }) {
  const [type, setType] = useState('');
  const [scope, setScope] = useState('');
  const [total, setTotal] = useState('100');
  const [sampled, setSampled] = useState('15');
  const [methodology, setMethodology] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const types = ['Evidence', 'OTJH', 'KSB', 'Progress Reviews', 'Module', 'Report'];
  const methods = ['Random', 'Stratified random', 'Systematic', 'Targeted', 'Convenience'];

  const handleCreate = () => {
    if (!type || !scope || !methodology) return;
    onCreate({
      type, scope,
      total: parseInt(total) || 100,
      sampled: parseInt(sampled) || 15,
      percentage: Math.round((parseInt(sampled) / parseInt(total)) * 100),
      methodology,
      startDate: startDate || '—',
      endDate: endDate || '—',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-md bg-background-50 rounded-2xl border border-foreground-200 shadow-2xl shadow-foreground-950/15 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-foreground-400/50">
          <p className="text-sm font-semibold text-foreground-900">Create New Sample</p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">Sample Type</label>
            <div className="flex flex-wrap gap-2">
              {types.map(t => (
                <button key={t} onClick={() => setType(t)} className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-smooth cursor-pointer whitespace-nowrap ${type === t ? 'bg-primary-500 text-white border-primary-500' : 'bg-background-50 text-foreground-600 border-background-200 hover:border-primary-300'}`}>{t}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">Scope / Description</label>
            <input value={scope} onChange={e => setScope(e.target.value)} placeholder="e.g. All Cohort B learners — Marketing Module" className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">Total Pool</label>
              <input type="number" value={total} onChange={e => setTotal(e.target.value)} className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-800 focus:outline-none focus:border-primary-300" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">Sample Size</label>
              <input type="number" value={sampled} onChange={e => setSampled(e.target.value)} className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-800 focus:outline-none focus:border-primary-300" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">Methodology</label>
            <select value={methodology} onChange={e => setMethodology(e.target.value)} className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-800 focus:outline-none focus:border-primary-300 cursor-pointer">
              <option value="">Select methodology...</option>
              {methods.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">Start Date</label>
              <input value={startDate} onChange={e => setStartDate(e.target.value)} placeholder="e.g. 15 Jun" className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">End Date</label>
              <input value={endDate} onChange={e => setEndDate(e.target.value)} placeholder="e.g. 30 Jun" className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 px-3 py-2.5 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
            <button onClick={handleCreate} disabled={!type || !scope || !methodology} className="flex-1 px-3 py-2.5 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-add-line mr-1"></AppIcon> Create Sample
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Start / Continue Review Modal ──────────────────────────────────────
function ReviewModal({ sample, onClose, onStart, onSubmit }: { sample: Sample; onClose: () => void; onStart: () => void; onSubmit: (findings: string) => void }) {
  const [findings, setFindings] = useState('');
  const [showFindings, setShowFindings] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-md bg-background-50 rounded-2xl border border-foreground-200 shadow-2xl shadow-foreground-950/15 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-foreground-400/50">
          <div>
            <p className="text-sm font-semibold text-foreground-900">{sample.status === 'Scheduled' ? 'Start Sampling' : 'Continue Review'}</p>
            <p className="text-[11px] text-foreground-500 mt-0.5">{sample.id} · {sample.scope}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <div><span className="text-foreground-400">Type:</span> <span className="text-foreground-700 font-medium">{sample.type}</span></div>
            <div><span className="text-foreground-400">Total Pool:</span> <span className="text-foreground-700 font-medium">{sample.total}</span></div>
            <div><span className="text-foreground-400">Sample Size:</span> <span className="text-foreground-700 font-medium">{sample.sampled} ({sample.percentage}%)</span></div>
            <div><span className="text-foreground-400">Method:</span> <span className="text-foreground-700 font-medium">{sample.methodology}</span></div>
            <div><span className="text-foreground-400">Period:</span> <span className="text-foreground-700 font-medium">{sample.startDate} — {sample.endDate}</span></div>
            <div><span className="text-foreground-400">Officer:</span> <span className="text-foreground-700 font-medium">{sample.officer === '—' ? 'Unassigned' : sample.officer}</span></div>
          </div>

          {sample.status === 'Scheduled' ? (
            <div className="bg-primary-50 rounded-lg p-3 border border-primary-200/50">
              <p className="text-[11px] font-semibold text-primary-700">Ready to begin</p>
              <p className="text-[12px] text-primary-600 mt-1">This will assign you as the officer and begin the sampling review process.</p>
            </div>
          ) : showFindings ? (
            <div>
              <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-2">Submit Findings & Conclusions</label>
              <textarea
                value={findings}
                onChange={e => setFindings(e.target.value.slice(0, 500))}
                rows={4}
                placeholder="Describe your QA findings, any issues identified, and overall conclusions..."
                className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 resize-none"
              />
              <p className="text-[10px] text-foreground-400 text-right">{findings.length}/500</p>
            </div>
          ) : (
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-200/50">
              <p className="text-[11px] font-semibold text-amber-700">Review in progress</p>
              <p className="text-[12px] text-amber-600 mt-1">Continue reviewing the {sample.sampled} sampled items. When complete, submit your findings.</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 px-3 py-2.5 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
            {sample.status === 'Scheduled' ? (
              <button onClick={onStart} className="flex-1 px-3 py-2.5 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-play-circle-line mr-1"></AppIcon> Start Sampling
              </button>
            ) : showFindings ? (
              <button
                onClick={() => findings.trim() && onSubmit(findings.trim())}
                disabled={!findings.trim()}
                className="flex-1 px-3 py-2.5 bg-emerald-500 text-white rounded-lg text-[12px] font-semibold hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap"
              >
                <AppIcon className="ri-check-double-line mr-1"></AppIcon> Submit Findings
              </button>
            ) : (
              <button onClick={onClose} className="flex-1 px-3 py-2.5 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-loader-4-line mr-1"></AppIcon> Continue Review
              </button>
            )}
          </div>

          {sample.status === 'In Progress' && !showFindings && (
            <button
              onClick={() => setShowFindings(true)}
              className="w-full px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[12px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-smooth cursor-pointer whitespace-nowrap"
            >
              <AppIcon className="ri-file-check-line mr-1"></AppIcon> Ready to Submit Findings
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── View Details Modal ─────────────────────────────────────────────────
function ViewDetailsModal({ sample, onClose }: { sample: Sample; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-sm bg-background-50 rounded-2xl border border-foreground-200 shadow-2xl shadow-foreground-950/15 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-foreground-400/50">
          <p className="text-sm font-semibold text-foreground-900">Sample Details — {sample.id}</p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button>
        </div>
        <div className="p-5 space-y-3 text-[12px]">
          <div className="flex justify-between"><span className="text-foreground-400">Type</span><span className="text-foreground-700 font-medium">{sample.type}</span></div>
          <div className="flex justify-between"><span className="text-foreground-400">Scope</span><span className="text-foreground-700 font-medium">{sample.scope}</span></div>
          <div className="flex justify-between"><span className="text-foreground-400">Total Pool</span><span className="text-foreground-700 font-medium">{sample.total} items</span></div>
          <div className="flex justify-between"><span className="text-foreground-400">Sampled</span><span className="text-foreground-700 font-medium">{sample.sampled} ({sample.percentage}%)</span></div>
          <div className="flex justify-between"><span className="text-foreground-400">Methodology</span><span className="text-foreground-700 font-medium">{sample.methodology}</span></div>
          <div className="flex justify-between"><span className="text-foreground-400">Period</span><span className="text-foreground-700 font-medium">{sample.startDate} — {sample.endDate}</span></div>
          <div className="flex justify-between"><span className="text-foreground-400">Officer</span><span className="text-foreground-700 font-medium">{sample.officer === '—' ? 'Unassigned' : sample.officer}</span></div>
          <div className="flex justify-between"><span className="text-foreground-400">Status</span><span className="font-semibold">{sample.status}</span></div>
          {sample.status === 'Completed' && (
            <div className="flex justify-between"><span className="text-foreground-400">Completion Date</span><span className="text-foreground-700 font-medium">{sample.endDate}</span></div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────
export default function QASamplingPage() {
  const { success, info } = useToast();
  const [samples, setSamples] = useState<Sample[]>(INITIAL_SAMPLING_DATA);
  const [filterStatus, setFilterStatus] = useState('All');

  // Modal state
  const [newOpen, setNewOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<Sample | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<Sample | null>(null);

  const filtered = filterStatus === 'All' ? samples : samples.filter(s => s.status === filterStatus);

  const stats = {
    scheduled: samples.filter(s => s.status === 'Scheduled').length,
    inProgress: samples.filter(s => s.status === 'In Progress').length,
    completed: samples.filter(s => s.status === 'Completed').length,
    totalSampled: samples.reduce((s, item) => s + item.sampled, 0),
  };

  const handleCreateSample = (data: Partial<Sample>) => {
    const newSample: Sample = {
      id: `sp-${String(samples.length + 1).padStart(2, '0')}`,
      type: data.type || '',
      scope: data.scope || '',
      total: data.total || 100,
      sampled: data.sampled || 15,
      percentage: data.percentage || 15,
      status: 'Scheduled',
      officer: '—',
      startDate: data.startDate || '—',
      endDate: data.endDate || '—',
      methodology: data.methodology || '',
    };
    setSamples(prev => [...prev, newSample]);
    setNewOpen(false);
    success('Sample Created', `${newSample.id} · ${newSample.type} — ${newSample.scope}`);
  };

  const handleStartSampling = () => {
    const s = reviewTarget;
    if (!s) return;
    setSamples(prev => prev.map(sp => sp.id === s.id ? { ...sp, status: 'In Progress' as const, officer: 'Emma Clarke' } : sp));
    setReviewTarget(null);
    success('Sampling Started', `${s.id} · Officer: Emma Clarke`);
  };

  const handleSubmitFindings = (findings: string) => {
    const s = reviewTarget;
    if (!s) return;
    setSamples(prev => prev.map(sp => sp.id === s.id ? { ...sp, status: 'Completed' as const } : sp));
    setReviewTarget(null);
    success('Findings Submitted', `${s.id} completed · ${findings.slice(0, 60)}...`);
  };

  const handleViewDetails = (s: Sample) => {
    setDetailsTarget(s);
  };

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="Sampling" pageSubtitle="Configure and run QA sampling across evidence, OTJH, KSB, and reviews"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Sampling"
          description={`${stats.inProgress} active. ${stats.scheduled} scheduled. ${stats.completed} completed. ${stats.totalSampled} items sampled in total.`}
          icon="ri-pie-chart-2-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20sampling%20methodology%20quality%20assurance%20audit%20sample%20selection%20purple%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-sampling-hero&orientation=landscape"
          imageAlt="Sampling"
          stats={[
            { label: 'In Progress', value: String(stats.inProgress) },
            { label: 'Scheduled', value: String(stats.scheduled) },
            { label: 'Completed', value: String(stats.completed) },
          ]}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Scheduled', value: stats.scheduled, icon: 'ri-calendar-line', color: 'foreground' },
            { label: 'In Progress', value: stats.inProgress, icon: 'ri-loader-4-line', color: 'primary' },
            { label: 'Completed', value: stats.completed, icon: 'ri-check-line', color: 'emerald' },
            { label: 'Total Sampled', value: stats.totalSampled, icon: 'ri-pie-chart-2-line', color: 'accent' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'foreground' ? 'bg-foreground-100 text-foreground-500' : s.color === 'primary' ? 'bg-primary-100 text-primary-700' : s.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-accent-100 text-accent-700'}`}>
                <AppIcon className={`${s.icon} text-sm`}></AppIcon>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-foreground-400">Status:</span>
            {['All', 'Scheduled', 'In Progress', 'Completed'].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterStatus === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
            ))}
          </div>
          <button
            onClick={() => setNewOpen(true)}
            className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
          >
            <AppIcon className="ri-add-line mr-1"></AppIcon> New Sample
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map(sample => (
            <div key={sample.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
              <div className="flex items-center justify-between mb-3">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[sample.status].bg} ${statusConfig[sample.status].text}`}>{sample.status}</span>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-accent-100 text-accent-700">{sample.type}</span>
              </div>
              <h4 className="text-sm font-semibold text-foreground-900 mb-2">{sample.scope}</h4>
              <div className="space-y-1 text-[11px] text-foreground-400 mb-2">
                <p>Total pool: <strong className="text-foreground-700">{sample.total}</strong> items</p>
                <p>Sampled: <strong className="text-foreground-700">{sample.sampled}</strong> ({sample.percentage}%)</p>
                <p>Method: <strong className="text-foreground-700">{sample.methodology}</strong></p>
                <p>Period: <strong className="text-foreground-700">{sample.startDate} — {sample.endDate}</strong></p>
                {sample.officer !== '—' && <p>Officer: <strong className="text-foreground-700">{sample.officer}</strong></p>}
              </div>
              <div className="w-full bg-background-200 rounded-full h-1.5 mb-3">
                <div className={`h-1.5 rounded-full ${sample.status === 'Completed' ? 'bg-emerald-500' : sample.status === 'In Progress' ? 'bg-primary-500' : 'bg-foreground-300'}`} style={{ width: `${sample.status === 'Completed' ? 100 : sample.status === 'In Progress' ? 60 : 10}%` }}></div>
              </div>
              <div className="flex items-center gap-2">
                {sample.status !== 'Completed' && (
                  <button
                    onClick={() => setReviewTarget(sample)}
                    className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                  >
                    {sample.status === 'In Progress' ? 'Continue Review' : 'Start Sampling'}
                  </button>
                )}
                <button
                  onClick={() => handleViewDetails(sample)}
                  className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  View Details
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modals */}
      {newOpen && <NewSampleModal onClose={() => setNewOpen(false)} onCreate={handleCreateSample} />}
      {reviewTarget && (
        <ReviewModal
          sample={reviewTarget}
          onClose={() => setReviewTarget(null)}
          onStart={handleStartSampling}
          onSubmit={handleSubmitFindings}
        />
      )}
      {detailsTarget && <ViewDetailsModal sample={detailsTarget} onClose={() => setDetailsTarget(null)} />}
    </WorkspaceShell>
  );
}