import { useState, useEffect, useRef, useCallback } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useToast } from '@/hooks/useToast';

const auditorConfig = roleNavMap.auditor;

type EvidenceStatus = 'Validated' | 'Flagged' | 'In Review' | 'Rejected' | 'Pending';

interface EvidenceSample {
  id: string;
  learner: string;
  programme: string;
  cohort: string;
  type: 'Reflection' | 'OTJH Log' | 'Assignment' | 'Work Product' | 'Video Evidence' | 'Observation' | 'Witness Statement' | 'Professional Discussion';
  submittedDate: string;
  validator: string;
  status: EvidenceStatus;
  ksbRef: string;
  description: string;
  score?: number;
  rejectionReason?: string;
  flagNote?: string;
}

interface UndoAction {
  evidenceId: string;
  previousStatus: EvidenceStatus;
  previousRejectionReason?: string;
  timer: number;
  timerId?: ReturnType<typeof setInterval>;
}

const INITIAL_SAMPLES: EvidenceSample[] = [
  { id: 'EV-2881', learner: 'Sophie Williams', programme: 'Marketing Executive L4', cohort: 'ME-L4 May 2026', type: 'Reflection', submittedDate: '09 Jun 2026', validator: 'Helen Curtis', status: 'Validated', ksbRef: 'K12, S4, B2', description: 'Quarterly reflection on campaign management and stakeholder communication strategies', score: 92 },
  { id: 'EV-2874', learner: 'Daniel Walsh', programme: 'Business Admin L3', cohort: 'BA-L3 Jun 2026', type: 'OTJH Log', submittedDate: '09 Jun 2026', validator: 'Martin Reeves', status: 'Flagged', ksbRef: 'S7', description: 'Monthly OTJH log showing 22 hours — employer confirmation missing for 6 hours' },
  { id: 'EV-2868', learner: 'Aisha Patel', programme: 'Software Dev L4', cohort: 'SD-L4 Sep 2024', type: 'Assignment', submittedDate: '08 Jun 2026', validator: 'Rachel Oduya', status: 'Validated', ksbRef: 'K8, S12', description: 'Code review and refactoring assignment — demonstrated SOLID principles', score: 88 },
  { id: 'EV-2855', learner: 'Mia Okonkwo', programme: 'Marketing Executive L4', cohort: 'ME-L4 May 2026', type: 'Work Product', submittedDate: '08 Jun 2026', validator: 'Helen Curtis', status: 'In Review', ksbRef: 'S9, K6', description: 'Email marketing campaign analytics dashboard with A/B test results' },
  { id: 'EV-2849', learner: 'Oliver Grant', programme: 'Business Admin L3', cohort: 'BA-L3 Jun 2026', type: 'Video Evidence', submittedDate: '07 Jun 2026', validator: 'Crispin Jones', status: 'Validated', ksbRef: 'B3, S5', description: 'Recorded team meeting facilitation — 12-minute video with commentary', score: 95 },
  { id: 'EV-2842', learner: 'Liam Brooks', programme: 'Data Analyst L4', cohort: 'DA-L4 Apr 2026', type: 'Work Product', submittedDate: '07 Jun 2026', validator: 'Rachel Oduya', status: 'Rejected', ksbRef: 'K14, S8', description: 'Power BI dashboard — rejected due to missing data source documentation', score: 40 },
  { id: 'EV-2836', learner: 'Zara Iqbal', programme: 'HR Consultant L5', cohort: 'HR-L5 Mar 2025', type: 'Witness Statement', submittedDate: '06 Jun 2026', validator: 'Daniel Foster', status: 'Validated', ksbRef: 'S15, B4', description: 'Witness statement from line manager confirming employee relations case handling', score: 91 },
  { id: 'EV-2829', learner: 'Harvey Dunn', programme: 'Marketing Executive L4', cohort: 'ME-L4 May 2026', type: 'Professional Discussion', submittedDate: '06 Jun 2026', validator: 'Helen Curtis', status: 'Pending', ksbRef: 'K10, S11, B1', description: 'Audio recording of professional discussion on brand strategy and market positioning' },
  { id: 'EV-2822', learner: 'Chloe Zhang', programme: 'Project Manager L4', cohort: 'PM-L4 Feb 2026', type: 'Observation', submittedDate: '05 Jun 2026', validator: 'Crispin Jones', status: 'In Review', ksbRef: 'S3, K5', description: 'Tutor observation of learner leading a project stand-up — 25 minutes' },
  { id: 'EV-2815', learner: 'Ethan Cross', programme: 'Software Dev L4', cohort: 'SD-L4 Sep 2024', type: 'Reflection', submittedDate: '04 Jun 2026', validator: 'Sarah Collins', status: 'Validated', ksbRef: 'K18, B5', description: 'Reflection on agile team practices and continuous improvement contributions', score: 87 },
  { id: 'EV-2808', learner: 'Amara Obi', programme: 'Business Admin L3', cohort: 'BA-L3 Jun 2026', type: 'OTJH Log', submittedDate: '03 Jun 2026', validator: 'Martin Reeves', status: 'Validated', ksbRef: 'S1', description: 'OTJH log fully confirmed by employer — 28 hours across admin tasks and CPD', score: 90 },
  { id: 'EV-2801', learner: 'Noah Patel', programme: 'Software Dev L4', cohort: 'SD-L4 Sep 2024', type: 'Assignment', submittedDate: '02 Jun 2026', validator: 'Rachel Oduya', status: 'Flagged', ksbRef: 'K8, S12, S14', description: 'Database design assignment — partially AI-generated content detected' },
];

const typeColour = (t: EvidenceSample['type']) => {
  switch (t) {
    case 'Reflection': return 'bg-primary-100 text-primary-700';
    case 'OTJH Log': return 'bg-accent-100 text-accent-700';
    case 'Assignment': return 'bg-secondary-100 text-secondary-700';
    case 'Work Product': return 'bg-emerald-100 text-emerald-700';
    case 'Video Evidence': return 'bg-rose-100 text-rose-700';
    case 'Observation': return 'bg-amber-100 text-amber-700';
    case 'Witness Statement': return 'bg-cyan-100 text-cyan-700';
    case 'Professional Discussion': return 'bg-violet-100 text-violet-700';
    default: return 'bg-foreground-100 text-foreground-500';
  }
};

const statusColour = (s: EvidenceStatus) => {
  switch (s) {
    case 'Validated': return 'bg-emerald-100 text-emerald-700';
    case 'Flagged': return 'bg-red-100 text-red-700';
    case 'In Review': return 'bg-amber-100 text-amber-700';
    case 'Rejected': return 'bg-rose-100 text-rose-700';
    case 'Pending': return 'bg-foreground-100 text-foreground-500';
    default: return '';
  }
};

// ─── Reject Modal ─────────────────────────────────────────────────────
function RejectModal({ evidence, onClose, onConfirm }: {
  evidence: EvidenceSample;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [custom, setCustom] = useState('');
  const reasons = [
    'Insufficient detail — does not meet KSB requirements',
    'Missing employer confirmation/signature',
    'Evidence predates apprenticeship start',
    'Suspected AI-generated content',
    'Plagiarism detected',
    'Not relevant to stated KSB references',
    'Poor quality / unreadable submission',
  ];
  const finalReason = reason === 'custom' ? custom : reason;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-sm bg-background-50 rounded-2xl border border-foreground-200 shadow-2xl shadow-foreground-950/15 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-5">
          <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center mx-auto mb-3">
            <i className="ri-close-circle-line text-red-600 text-xl"></i>
          </div>
          <h3 className="text-sm font-bold text-foreground-900 text-center mb-1">Reject {evidence.id}?</h3>
          <p className="text-[12px] text-foreground-500 text-center mb-4">Select a rejection reason for the learner record.</p>
          <div className="space-y-3">
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {reasons.map(r => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-[12px] border transition-smooth cursor-pointer ${reason === r ? 'bg-red-50 text-red-700 border-red-300' : 'bg-background-50 text-foreground-700 border-background-200 hover:border-red-200'}`}
                >
                  {r}
                </button>
              ))}
              <button
                onClick={() => setReason('custom')}
                className={`w-full text-left px-3 py-2 rounded-lg text-[12px] border transition-smooth cursor-pointer ${reason === 'custom' ? 'bg-red-50 text-red-700 border-red-300' : 'bg-background-50 text-foreground-700 border-background-200 hover:border-red-200'}`}
              >
                Other (custom reason)
              </button>
            </div>
            {reason === 'custom' && (
              <textarea
                value={custom}
                onChange={e => setCustom(e.target.value.slice(0, 300))}
                rows={3}
                placeholder="Describe the rejection reason..."
                className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:border-red-400 resize-none"
              />
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={onClose} className="flex-1 px-3 py-2.5 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
            <button
              onClick={() => finalReason && onConfirm(finalReason)}
              disabled={!finalReason}
              className="flex-1 px-3 py-2.5 bg-red-500 text-white rounded-lg text-[12px] font-semibold hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap"
            >
              Reject Evidence
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Flag Modal ───────────────────────────────────────────────────────
function FlagModal({ evidence, onClose, onConfirm }: {
  evidence: EvidenceSample;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-sm bg-background-50 rounded-2xl border border-foreground-200 shadow-2xl shadow-foreground-950/15 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-5">
          <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center mx-auto mb-3">
            <i className="ri-flag-line text-amber-600 text-xl"></i>
          </div>
          <h3 className="text-sm font-bold text-foreground-900 text-center mb-1">Flag {evidence.id} for Review</h3>
          <p className="text-[12px] text-foreground-500 text-center mb-4">Add a note explaining why this evidence is flagged.</p>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value.slice(0, 500))}
            rows={4}
            placeholder="Describe the concern or issue with this evidence..."
            className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[13px] text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:border-amber-400 resize-none mb-1"
          />
          <p className="text-[10px] text-foreground-400 text-right mb-4">{note.length}/500</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-3 py-2.5 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
            <button
              onClick={() => note.trim() && onConfirm(note.trim())}
              disabled={!note.trim()}
              className="flex-1 px-3 py-2.5 bg-amber-500 text-white rounded-lg text-[12px] font-semibold hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap"
            >
              <i className="ri-flag-line mr-1"></i> Flag Evidence
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Request Sample Modal ─────────────────────────────────────────────
function RequestSampleModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: () => void }) {
  const [programme, setProgramme] = useState('');
  const [type, setType] = useState('');
  const [count, setCount] = useState('5');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-sm bg-background-50 rounded-2xl border border-foreground-200 shadow-2xl shadow-foreground-950/15 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-foreground-400/50">
          <p className="text-sm font-semibold text-foreground-900">Request Evidence Sample</p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"><i className="ri-close-line"></i></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">Programme</label>
            <select value={programme} onChange={e => setProgramme(e.target.value)} className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[13px] text-foreground-800 focus:outline-none focus:border-primary-300 cursor-pointer">
              <option value="">All Programmes</option>
              <option>Marketing Executive L4</option>
              <option>Business Admin L3</option>
              <option>Data Analyst L4</option>
              <option>Software Dev L4</option>
              <option>HR Consultant L5</option>
              <option>Project Manager L4</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">Evidence Type</label>
            <select value={type} onChange={e => setType(e.target.value)} className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[13px] text-foreground-800 focus:outline-none focus:border-primary-300 cursor-pointer">
              <option value="">All Types</option>
              <option>Reflection</option>
              <option>OTJH Log</option>
              <option>Assignment</option>
              <option>Work Product</option>
              <option>Video Evidence</option>
              <option>Observation</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">Sample Size</label>
            <div className="flex gap-2">
              {['5', '10', '15', '20'].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  className={`flex-1 py-2 rounded-lg text-[12px] font-semibold border transition-smooth cursor-pointer ${count === n ? 'bg-primary-500 text-white border-primary-500' : 'bg-background-50 text-foreground-600 border-background-200 hover:border-primary-300'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 px-3 py-2.5 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
            <button onClick={onSubmit} className="flex-1 px-3 py-2.5 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-add-line mr-1"></i> Request {count} Samples
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Undo Banner ──────────────────────────────────────────────────────
function UndoBanner({ action, onUndo, seconds }: { action: string; onUndo: () => void; seconds: number }) {
  return (
    <div className="bg-foreground-900 rounded-xl p-3 px-4 flex items-center gap-3 shadow-lg animate-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <i className="ri-check-line text-white text-xs"></i>
        </div>
        <span className="text-[13px] text-white font-medium truncate">{action}</span>
      </div>
      <button
        onClick={onUndo}
        className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-foreground-900 bg-white hover:bg-white/90 transition-smooth cursor-pointer whitespace-nowrap"
      >
        Undo ({seconds}s)
      </button>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────
export default function AuditorEvidencePage() {
  const { success, error, warning, info } = useToast();

  const [samples, setSamples] = useState<EvidenceSample[]>(INITIAL_SAMPLES);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterType, setFilterType] = useState<string>('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Undo state
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearInterval(undoTimerRef.current);
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    };
  }, []);

  const clearUndoTimers = () => {
    if (undoTimerRef.current) { clearInterval(undoTimerRef.current); undoTimerRef.current = null; }
    if (undoTimeoutRef.current) { clearTimeout(undoTimeoutRef.current); undoTimeoutRef.current = null; }
  };

  const startUndo = (evidenceId: string, previousStatus: EvidenceStatus, previousRejectionReason?: string) => {
    clearUndoTimers();
    const timer = 5;

    const newUndo: UndoAction = { evidenceId, previousStatus, previousRejectionReason, timer };
    setUndoAction(newUndo);

    // Countdown
    undoTimerRef.current = setInterval(() => {
      setUndoAction(prev => {
        if (!prev || prev.timer <= 1) return null;
        return { ...prev, timer: prev.timer - 1 };
      });
    }, 1000);

    // Auto-dismiss
    undoTimeoutRef.current = setTimeout(() => {
      setUndoAction(null);
    }, timer * 1000);
  };

  const performUndo = () => {
    if (!undoAction) return;
    const { evidenceId, previousStatus, previousRejectionReason } = undoAction;
    setSamples(prev => prev.map(s => s.id === evidenceId ? { ...s, status: previousStatus, rejectionReason: previousRejectionReason } : s));
    clearUndoTimers();
    setUndoAction(null);
    info('Action Undone', `Reverted to ${previousStatus}`);
  };

  // Modal state
  const [rejectTarget, setRejectTarget] = useState<EvidenceSample | null>(null);
  const [flagTarget, setFlagTarget] = useState<EvidenceSample | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);

  const filtered = samples.filter(e => {
    const matchSearch = e.learner.toLowerCase().includes(search.toLowerCase()) || e.id.toLowerCase().includes(search.toLowerCase()) || e.programme.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'All' || e.status === filterStatus;
    const matchType = filterType === 'All' || e.type === filterType;
    return matchSearch && matchStatus && matchType;
  });

  const totalSamples = samples.length;
  const validatedCount = samples.filter(e => e.status === 'Validated').length;
  const flaggedCount = samples.filter(e => e.status === 'Flagged').length;
  const scoredSamples = samples.filter(e => e.score !== undefined);
  const avgScore = scoredSamples.length > 0 ? Math.round(scoredSamples.reduce((s, e) => s + (e.score || 0), 0) / scoredSamples.length) : 0;

  const allTypes = [...new Set(INITIAL_SAMPLES.map(e => e.type))];

  // Handlers
  const handleValidate = (ev: EvidenceSample) => {
    const previousStatus = ev.status;
    startUndo(ev.id, previousStatus);
    setSamples(prev => prev.map(s => s.id === ev.id ? { ...s, status: 'Validated' as EvidenceStatus, rejectionReason: undefined } : s));
    setExpandedId(null);
    success(`${ev.id} Validated`, `${ev.learner} · ${ev.type} · Click Undo to reverse`);
  };

  const handleReject = (ev: EvidenceSample, reason: string) => {
    const previousStatus = ev.status;
    startUndo(ev.id, previousStatus, ev.rejectionReason);
    setSamples(prev => prev.map(s => s.id === ev.id ? { ...s, status: 'Rejected' as EvidenceStatus, rejectionReason: reason } : s));
    setRejectTarget(null);
    setExpandedId(null);
    error(`${ev.id} Rejected`, `${reason.slice(0, 60)} · Click Undo to reverse`);
  };

  const handleFlag = (ev: EvidenceSample, note: string) => {
    setSamples(prev => prev.map(s => s.id === ev.id ? { ...s, status: 'Flagged' as EvidenceStatus, flagNote: note } : s));
    setFlagTarget(null);
    warning(`${ev.id} Flagged for Review`, note.slice(0, 60));
  };

  const handleDownload = (ev: EvidenceSample) => {
    info(`Downloading ${ev.id}`, `${ev.learner} · ${ev.type}`);
  };

  const handleRequestSample = () => {
    setRequestOpen(false);
    success('Sample request submitted', 'Samples will appear in your queue shortly');
  };

  return (
    <WorkspaceShell role="auditor" roleLabel={auditorConfig.label} navItems={auditorConfig.items} workspaceLabel={auditorConfig.workspaceLabel} pageTitle="Evidence Sample" pageSubtitle="Request, review and validate evidence samples across all programmes and learners" userName="Patricia Stone" userRole="External Auditor">
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Samples', value: String(totalSamples), icon: 'ri-folder-open-line', colour: 'primary' },
            { label: 'Validated', value: String(validatedCount), icon: 'ri-check-double-line', colour: 'emerald' },
            { label: 'Flagged', value: String(flaggedCount), icon: 'ri-flag-line', colour: 'red' },
            { label: 'Avg Score', value: `${avgScore}%`, icon: 'ri-bar-chart-2-line', colour: 'accent' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.colour === 'primary' ? 'bg-primary-100 text-primary-600' : s.colour === 'accent' ? 'bg-accent-100 text-accent-700' : s.colour === 'red' ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
                <i className={`${s.icon} text-sm`}></i>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Undo Banner */}
        {undoAction && (
          <UndoBanner
            action={`"${undoAction.evidenceId}" ${samples.find(s => s.id === undoAction.evidenceId)?.status === 'Validated' ? 'validated' : 'rejected'}. You can undo this action.`}
            onUndo={performUndo}
            seconds={undoAction.timer}
          />
        )}

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search evidence ID, learner, programme..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-400 focus:outline-none focus:border-primary-400" />
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:border-primary-400 cursor-pointer">
              <option>All</option>
              <option>Validated</option>
              <option>Flagged</option>
              <option>In Review</option>
              <option>Rejected</option>
              <option>Pending</option>
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:border-primary-400 cursor-pointer">
              <option>All Types</option>
              {allTypes.map(t => <option key={t}>{t}</option>)}
            </select>
            <button
              onClick={() => setRequestOpen(true)}
              className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              <i className="ri-add-line mr-1"></i> Request Sample
            </button>
          </div>
        </div>

        {/* Evidence list */}
        <div className="space-y-2">
          {filtered.map(e => {
            const isExpanded = expandedId === e.id;
            return (
              <div key={e.id} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${statusColour(e.status)}`}>
                      <i className="ri-folder-open-line text-sm"></i>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground-900">{e.id}</p>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${typeColour(e.type)}`}>{e.type}</span>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${statusColour(e.status)}`}>{e.status}</span>
                        {e.score !== undefined && (
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${e.score >= 80 ? 'bg-emerald-100 text-emerald-700' : e.score >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>Score: {e.score}</span>
                        )}
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{e.learner} &middot; {e.programme} &middot; {e.cohort}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-[11px] text-foreground-400">
                    <span>Validator: {e.validator}</span>
                    <span>{e.submittedDate}</span>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : e.id)}
                      className="w-7 h-7 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 transition-colors cursor-pointer"
                    >
                      <i className={isExpanded ? 'ri-arrow-up-s-line text-foreground-500' : 'ri-arrow-down-s-line text-foreground-500'}></i>
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-foreground-200/60 bg-background-100/50 p-4">
                    {/* Rejection / Flag note */}
                    {e.status === 'Rejected' && e.rejectionReason && (
                      <div className="mb-4 px-3 py-2.5 bg-red-50 border border-red-200/50 rounded-lg">
                        <p className="text-[11px] font-semibold text-red-700 mb-0.5">Rejection Reason</p>
                        <p className="text-[12px] text-red-600">{e.rejectionReason}</p>
                      </div>
                    )}
                    {e.status === 'Flagged' && e.flagNote && (
                      <div className="mb-4 px-3 py-2.5 bg-amber-50 border border-amber-200/50 rounded-lg">
                        <p className="text-[11px] font-semibold text-amber-700 mb-0.5">Flag Note</p>
                        <p className="text-[12px] text-amber-600">{e.flagNote}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Details</p>
                        <div className="space-y-1.5 text-[12px]">
                          <p><span className="text-foreground-400">Learner:</span> <strong className="text-foreground-800">{e.learner}</strong></p>
                          <p><span className="text-foreground-400">Programme:</span> <strong className="text-foreground-800">{e.programme}</strong></p>
                          <p><span className="text-foreground-400">Cohort:</span> <strong className="text-foreground-800">{e.cohort}</strong></p>
                          <p><span className="text-foreground-400">KSB Reference:</span> <strong className="text-foreground-800">{e.ksbRef}</strong></p>
                          <p><span className="text-foreground-400">Submitted:</span> <strong className="text-foreground-800">{e.submittedDate}</strong></p>
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Description</p>
                        <p className="text-[12px] text-foreground-700 bg-background-50 rounded-lg p-3 border border-background-200/30">{e.description}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-background-200/30 flex-wrap">
                      {e.status !== 'Validated' && (
                        <button
                          onClick={() => handleValidate(e)}
                          className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-600 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <i className="ri-check-line mr-1"></i> Validate
                        </button>
                      )}
                      {e.status !== 'Rejected' && (
                        <button
                          onClick={() => setRejectTarget(e)}
                          className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[11px] font-semibold hover:bg-red-600 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <i className="ri-close-line mr-1"></i> Reject
                        </button>
                      )}
                      {e.status !== 'Flagged' && e.status !== 'Rejected' && (
                        <button
                          onClick={() => setFlagTarget(e)}
                          className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[11px] font-semibold hover:bg-amber-600 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <i className="ri-flag-line mr-1"></i> Flag
                        </button>
                      )}
                      {e.status === 'Validated' && (
                        <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[11px] font-semibold whitespace-nowrap">
                          <i className="ri-check-double-line mr-1"></i> Validated
                        </span>
                      )}
                      <button
                        onClick={() => handleDownload(e)}
                        className="px-3 py-1.5 border border-background-300 bg-background-50 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 cursor-pointer whitespace-nowrap ml-auto"
                      >
                        <i className="ri-download-line mr-1"></i> Download
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="w-14 h-14 bg-background-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <i className="ri-folder-open-line text-foreground-300 text-2xl"></i>
            </div>
            <p className="text-sm font-medium text-foreground-600">No evidence samples found</p>
            <p className="text-[12px] text-foreground-400 mt-1">Try adjusting your filters</p>
          </div>
        )}
      </div>

      {/* Modals */}
      {rejectTarget && (
        <RejectModal
          evidence={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onConfirm={(reason) => handleReject(rejectTarget, reason)}
        />
      )}
      {flagTarget && (
        <FlagModal
          evidence={flagTarget}
          onClose={() => setFlagTarget(null)}
          onConfirm={(note) => handleFlag(flagTarget, note)}
        />
      )}
      {requestOpen && (
        <RequestSampleModal
          onClose={() => setRequestOpen(false)}
          onSubmit={handleRequestSample}
        />
      )}
    </WorkspaceShell>
  );
}