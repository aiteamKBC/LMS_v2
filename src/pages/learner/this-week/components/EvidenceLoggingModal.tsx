import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface EvidenceFile {
  id: string;
  name: string;
  size: string;
  type: string;
}

interface EvidenceLoggingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    reflection: string;
    ksbExplanations: Record<string, string>;
    confidenceBefore: Record<string, number>;
    confidenceAfter: Record<string, number>;
    applicationType: string;
    applicationText: string;
    files: EvidenceFile[];
    evidenceDescription: string;
    hasConsent: boolean;
    selectedBenefits: string[];
    benefitExplanation: string;
    otjhPaid: string;
    otjhActual: number;
    dateCompleted: string;
  }) => void;
  title: string;
  componentType: string;
  weekNumber: number;
  moduleName: string;
  ksbCodes: string[];
  ksbLabels: string;
  plannedOTJH: number;
  points: number;
  isReferred?: boolean;
  referralReason?: string | null;
  requiredActions?: string | null;
}

const TABS = [
  { id: 'learning', label: 'Learning', icon: 'ri-lightbulb-line' },
  { id: 'ksbs', label: 'KSBs', icon: 'ri-focus-3-line' },
  { id: 'apply', label: 'Apply', icon: 'ri-briefcase-line' },
  { id: 'evidence', label: 'Evidence', icon: 'ri-folder-upload-line' },
  { id: 'benefit', label: 'Benefit', icon: 'ri-building-line' },
  { id: 'otjh', label: 'OTJH', icon: 'ri-time-line' },
  { id: 'review', label: 'Review', icon: 'ri-shield-check-line' },
] as const;

const BENEFIT_TAGS = [
  'Improved Productivity', 'Better Customer Service', 'Improved Marketing Performance',
  'Improved Planning', 'Improved Communication', 'Improved Data Usage',
  'Reduced Errors', 'Improved Compliance', 'Cost Saving',
  'Improved Quality', 'Improved Teamwork', 'Innovation',
];

export function EvidenceLoggingModal({
  isOpen, onClose, onSubmit, title, componentType, weekNumber, moduleName,
  ksbCodes, ksbLabels, plannedOTJH, points, isReferred, referralReason, requiredActions,
}: EvidenceLoggingModalProps) {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['id']>('learning');
  const [submitted, setSubmitted] = useState(false);

  /* ── Tab 1: Learning ── */
  const [reflection, setReflection] = useState('');
  const [wordCount, setWordCount] = useState(0);
  const MIN_WORDS = 100;
  const [aiWriting, setAiWriting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);

  /* ── Tab 2: KSBs ── */
  const [ksbExplanations, setKsbExplanations] = useState<Record<string, string>>();
  const [confidenceBefore, setConfidenceBefore] = useState<Record<string, number>>();
  const [confidenceAfter, setConfidenceAfter] = useState<Record<string, number>>();

  /* ── Tab 3: Apply ── */
  const [applicationType, setApplicationType] = useState('');
  const [applicationText, setApplicationText] = useState('');

  /* ── Tab 4: Evidence ── */
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [evidenceDescription, setEvidenceDescription] = useState('');
  const [hasConsent, setHasConsent] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── Tab 5: Benefit ── */
  const [selectedBenefits, setSelectedBenefits] = useState<string[]>([]);
  const [benefitExplanation, setBenefitExplanation] = useState('');

  /* ── Tab 6: OTJH ── */
  const [otjhPaid, setOtjhPaid] = useState('');
  const [otjhActual, setOtjhActual] = useState(plannedOTJH);
  const [dateCompleted, setDateCompleted] = useState('');
  const [otjhConfirmed, setOtjhConfirmed] = useState(false);

  /* ── Tab 7: Review ── */
  const [aiCheckRun, setAiCheckRun] = useState(false);
  const [aiChecks, setAiChecks] = useState<Record<string, boolean>>();

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setActiveTab('learning');
      setSubmitted(false);
      setReflection('');
      setWordCount(0);
      setAiWriting(false);
      setRecording(false);
      setDraftSaved(false);
      setKsbExplanations({});
      setConfidenceBefore({});
      setConfidenceAfter({});
      setApplicationType('');
      setApplicationText('');
      setFiles([]);
      setEvidenceDescription('');
      setHasConsent(false);
      setSelectedBenefits([]);
      setBenefitExplanation('');
      setOtjhPaid('');
      setOtjhActual(plannedOTJH);
      setDateCompleted(new Date().toISOString().split('T')[0]);
      setOtjhConfirmed(false);
      setAiCheckRun(false);
      setAiChecks({});
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen, plannedOTJH]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen && !submitted) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, submitted]);

  /* ── Word count ── */
  useEffect(() => {
    const words = reflection.trim().split(/\s+/).filter(Boolean).length;
    setWordCount(words);
  }, [reflection]);

  /* ── AI writing assistant ── */
  const runAiWriting = () => {
    setAiWriting(true);
    setTimeout(() => {
      const draft = `From this ${componentType.toLowerCase()}, I have learned how to apply segmentation principles to real marketing scenarios. The key concepts covered include demographic, geographic, psychographic, and behavioural segmentation bases, and how these combine to create effective targeting strategies.

I now understand how the STP framework connects to campaign planning decisions. The practical examples from Tim Hortons showed how occasion-based segmentation can drive different promotional strategies for morning versus afternoon customers. This directly relates to my work where I can now apply similar thinking to our customer base.

The learning has strengthened my understanding of KSB K5 (customer segmentation) and K6 (marketing planning frameworks). I can now describe how segmentation data informs targeting decisions and positioning strategy in a way that translates to measurable campaign outcomes.`;
      setReflection(draft);
      setAiWriting(false);
    }, 2000);
  };

  /* ── File handling ── */
  const handleFileSelect = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles: EvidenceFile[] = Array.from(fileList).map((f, i) => ({
      id: `file-${Date.now()}-${i}`,
      name: f.name,
      size: formatFileSize(f.size),
      type: f.type || 'Unknown',
    }));
    setFiles(prev => [...prev, ...newFiles]);
  }, []);

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const getFileIcon = (type: string) => {
    if (type.includes('pdf')) return 'ri-file-pdf-line';
    if (type.includes('word') || type.includes('document')) return 'ri-file-word-line';
    if (type.includes('excel') || type.includes('sheet')) return 'ri-file-excel-line';
    if (type.includes('presentation')) return 'ri-file-ppt-line';
    if (type.includes('image')) return 'ri-image-line';
    if (type.includes('video')) return 'ri-video-line';
    if (type.includes('audio')) return 'ri-music-line';
    return 'ri-file-line';
  };

  /* ── AI Quality Check ── */
  const runAiCheck = () => {
    setAiCheckRun(true);
    setTimeout(() => {
      setAiChecks({
        reflection: reflection.trim().length > 50,
        wordCount: wordCount >= MIN_WORDS,
        ksbs: Object.keys(ksbExplanations).length > 0,
        application: applicationText.trim().length > 20,
        otjh: otjhConfirmed && otjhActual > 0,
        benefit: selectedBenefits.length > 0,
        evidence: files.length > 0 || evidenceDescription.trim().length > 0,
      });
    }, 1500);
  };

  /* ── Progress calculation ── */
  const tabProgress = TABS.findIndex(t => t.id === activeTab);
  const progressPct = ((tabProgress + 1) / TABS.length) * 100;

  const ksbColor = (code: string) => {
    if (code.startsWith('K')) return 'bg-primary-100 text-primary-700 border-primary-200';
    if (code.startsWith('S')) return 'bg-accent-100 text-accent-700 border-accent-200';
    return 'bg-secondary-100 text-secondary-700 border-secondary-200';
  };

  const toggleBenefit = (tag: string) => {
    setSelectedBenefits(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  /* ── Submit ── */
  const handleSubmit = () => {
    onSubmit({
      reflection,
      ksbExplanations,
      confidenceBefore,
      confidenceAfter,
      applicationType,
      applicationText,
      files,
      evidenceDescription,
      hasConsent,
      selectedBenefits,
      benefitExplanation,
      otjhPaid,
      otjhActual,
      dateCompleted,
    });
    setSubmitted(true);
  };

  const canSubmit = reflection.trim().length > 50 && otjhConfirmed && (files.length > 0 || evidenceDescription.trim().length > 0);

  const isTabComplete = (tabId: string) => {
    switch (tabId) {
      case 'learning': return wordCount >= MIN_WORDS;
      case 'ksbs': return Object.keys(ksbExplanations).length > 0;
      case 'apply': return applicationType !== '' && applicationText.trim().length > 20;
      case 'evidence': return files.length > 0 || evidenceDescription.trim().length > 0;
      case 'benefit': return selectedBenefits.length > 0;
      case 'otjh': return otjhConfirmed && otjhActual > 0;
      case 'review': return aiCheckRun;
      default: return false;
    }
  };

  if (!mounted) return null;

  return createPortal(
    <>
      <div
        onClick={() => { if (!submitted) onClose(); }}
        className={`fixed inset-0 z-[60] bg-foreground-950/50 backdrop-blur-sm transition-opacity duration-300 ease-out ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <div
        className={`fixed inset-0 z-[61] flex flex-col transition-all duration-300 ease-out ${
          isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        <div className="flex-1 bg-background-50 flex flex-col overflow-hidden">

          {/* ════════════════════════════════════════
              HEADER — Professional Redesign
              ════════════════════════════════════════ */}
          <div className="shrink-0 bg-background-50 border-b border-foreground-200">
            {/* Top strip — week context */}
            <div className="px-5 md:px-8 py-2.5 border-b border-background-100/60 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-foreground-400 uppercase tracking-widest">
                Week {weekNumber} &middot; {moduleName} &middot; {componentType}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-foreground-400">{Math.round(progressPct)}% Complete</span>
                <div className="w-20 h-1 bg-background-200 rounded-full overflow-hidden">
                  <div className="h-full bg-primary-500 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            </div>

            {/* Main header */}
            <div className="px-5 md:px-8 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
                    <i className="ri-folder-upload-line text-primary-600 text-lg"></i>
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-heading font-bold text-foreground-900 leading-tight">My Learning Evidence &amp; Reflection</h2>
                    <p className="text-sm text-foreground-500 mt-0.5 leading-snug">{title}</p>
                    <p className="text-[11px] text-foreground-400 mt-1">{componentType === 'Evidence' ? 'Upload Workplace Project Evidence' : 'Upload Learning Activity Evidence'}</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer shrink-0 mt-0.5"
                >
                  <i className="ri-close-line text-lg"></i>
                </button>
              </div>

              {/* Meta bar */}
              <div className="flex items-center gap-4 md:gap-6 mt-3 flex-wrap text-[11px] text-foreground-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-accent-100 flex items-center justify-center shrink-0 text-[9px] font-bold text-accent-600">SW</span>
                  Sophie Williams
                </span>
                <span className="text-foreground-200">|</span>
                <span className="flex items-center gap-1.5"><i className="ri-graduation-cap-line text-foreground-300"></i> Marketing Executive</span>
                <span className="text-foreground-200">|</span>
                <span className="flex items-center gap-1.5"><i className="ri-time-line text-foreground-300"></i> {plannedOTJH}h OTJH</span>
                <span className="text-foreground-200">|</span>
                <span className="flex items-center gap-1.5">
                  <i className="ri-focus-3-line text-foreground-300"></i>
                  <span className="flex items-center gap-1">
                    {ksbCodes.map(k => (
                      <span key={k} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${ksbColor(k)}`}>{k}</span>
                    ))}
                  </span>
                </span>
                <span className="text-foreground-200">|</span>
                <span className="flex items-center gap-1.5"><i className="ri-award-line text-foreground-300"></i> {points} pts</span>
              </div>
            </div>
          </div>

          {/* ════════════════════════════════════════
              PROGRESS STEPPER — Redesigned
              ════════════════════════════════════════ */}
          <div className="shrink-0 bg-background-100/40 px-5 md:px-8 py-3 border-b border-background-200/40">
            <div className="flex items-center">
              {TABS.map((tab, i) => {
                const isActive = activeTab === tab.id;
                const isCompleted = isTabComplete(tab.id);
                const isPast = TABS.findIndex(t => t.id === activeTab) > i;
                return (
                  <div key={tab.id} className="flex items-center">
                    <button
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 cursor-pointer whitespace-nowrap ${
                        isActive
                          ? 'bg-primary-500 text-white shadow-sm shadow-primary-500/20'
                          : isCompleted || isPast
                            ? 'text-emerald-600 hover:bg-emerald-50/50'
                            : 'text-foreground-400 hover:bg-background-200/40'
                      }`}
                    >
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : isCompleted || isPast
                            ? 'bg-emerald-100 text-emerald-600'
                            : 'bg-background-200 text-foreground-300'
                      }`}>
                        {isCompleted || isPast ? (
                          <i className="ri-check-line text-[9px]"></i>
                        ) : (
                          <i className={`${tab.icon} text-[9px]`}></i>
                        )}
                      </span>
                      {tab.label}
                    </button>
                    {i < TABS.length - 1 && (
                      <div className={`mx-1 w-3 h-px shrink-0 ${
                        isCompleted || isPast ? 'bg-emerald-300' : 'bg-background-200'
                      }`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ════════════════════════════════════════
              SUBMITTED STATE
              ════════════════════════════════════════ */}
          {submitted ? (
            <div className="flex-1 overflow-y-auto flex items-center justify-center p-8">
              <div className="max-w-md w-full text-center">
                <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-5">
                  <i className="ri-check-double-line text-emerald-600 text-3xl"></i>
                </div>
                <h2 className="text-xl font-heading font-bold text-foreground-900 mb-2">Evidence Submitted!</h2>
                <p className="text-sm text-foreground-500 mb-6">
                  Your evidence and reflection have been submitted for coach review. You will receive feedback within 3 working days.
                </p>

                {/* Review workflow */}
                <div className="bg-background-100 rounded-xl p-4 mb-6 text-left">
                  <p className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-3">Review Workflow</p>
                  <div className="space-y-2">
                    {[
                      { label: 'Evidence Submitted', status: 'complete', icon: 'ri-check-line' },
                      { label: 'Coach Review', status: 'pending', icon: 'ri-time-line' },
                      { label: 'Coach Approved', status: 'pending', icon: 'ri-time-line' },
                      { label: 'Quality Assurance Review', status: 'pending', icon: 'ri-time-line' },
                      { label: 'QA Approved', status: 'pending', icon: 'ri-time-line' },
                      { label: 'Completed', status: 'pending', icon: 'ri-time-line' },
                    ].map((step, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[9px] ${
                          step.status === 'complete' ? 'bg-emerald-500 text-white' : 'bg-background-200 text-foreground-400'
                        }`}>
                          <i className={step.icon}></i>
                        </span>
                        <span className={`text-sm ${step.status === 'complete' ? 'text-emerald-700 font-semibold' : 'text-foreground-400'}`}>{step.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Summary */}
                <div className="bg-background-100 rounded-xl p-4 mb-6 text-left">
                  <p className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-3">Submission Summary</p>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-foreground-400">Reflection</span><span className="font-medium">{wordCount} words</span></div>
                    <div className="flex justify-between"><span className="text-foreground-400">KSBs explained</span><span className="font-medium">{Object.keys(ksbExplanations).length} of {ksbCodes.length}</span></div>
                    <div className="flex justify-between"><span className="text-foreground-400">Files uploaded</span><span className="font-medium">{files.length}</span></div>
                    <div className="flex justify-between"><span className="text-foreground-400">Benefits selected</span><span className="font-medium">{selectedBenefits.length}</span></div>
                    <div className="flex justify-between"><span className="text-foreground-400">OTJH declared</span><span className="font-medium">{otjhActual}h</span></div>
                    <div className="flex justify-between"><span className="text-foreground-400">Status</span><span className="font-medium text-primary-600">Submitted For Review</span></div>
                  </div>
                </div>

                <button
                  onClick={onClose}
                  className="px-6 py-2.5 rounded-xl bg-secondary-500 text-background-50 dark:text-foreground-950 text-sm font-semibold hover:bg-secondary-600 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* ════════════════════════════════════════
                  TAB CONTENT
                  ════════════════════════════════════════ */}
              <div className="flex-1 overflow-y-auto px-5 md:px-8 py-6">
                <div className="max-w-[900px] mx-auto">

                  {/* Referral banner — improved */}
                  {isReferred && referralReason && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-6">
                      <div className="flex items-start gap-3">
                        <span className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
                          <i className="ri-arrow-go-back-line text-red-600 text-sm"></i>
                        </span>
                        <div className="flex-1">
                          <h3 className="text-sm font-semibold text-red-800 mb-1">Previous Submission Referred</h3>
                          <p className="text-sm text-red-700 leading-relaxed">{referralReason}</p>
                          {requiredActions && (
                            <div className="mt-3 pt-3 border-t border-red-200/40">
                              <p className="text-xs text-red-500 uppercase tracking-wider font-semibold mb-2">Required Actions</p>
                              <div className="text-sm text-red-700 leading-relaxed whitespace-pre-line">{requiredActions}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── TAB 1: LEARNING ── */}
                  {activeTab === 'learning' && (
                    <div className="space-y-5">
                      <div className="bg-background-100/50 rounded-xl p-5 border border-background-200/50">
                        <h3 className="text-[15px] font-heading font-semibold text-foreground-900 mb-1">What have you learned from this activity?</h3>
                        <p className="text-sm text-foreground-500 mb-4">Explain the key concepts, models, methods or techniques you learned. <span className="font-semibold text-foreground-700">Minimum: {MIN_WORDS} words.</span></p>

                        {/* Toolbar — improved */}
                        <div className="flex items-center gap-2 mb-3">
                          <button
                            onClick={() => setRecording(!recording)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-smooth cursor-pointer whitespace-nowrap shadow-sm ${
                              recording ? 'bg-red-50 text-red-600 border border-red-300' : 'text-foreground-500 hover:bg-background-100 border border-foreground-200'
                            }`}
                          >
                            <i className={`${recording ? 'ri-mic-fill animate-pulse' : 'ri-mic-line'} text-sm`}></i>
                            {recording ? 'Recording...' : 'Voice Record'}
                          </button>
                          <button
                            onClick={runAiWriting}
                            disabled={aiWriting}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-smooth cursor-pointer whitespace-nowrap border border-foreground-200 shadow-sm text-foreground-500 hover:bg-background-100 ${
                              aiWriting ? 'opacity-60' : ''
                            }`}
                          >
                            <i className={`${aiWriting ? 'ri-loader-4-line animate-spin' : 'ri-sparkling-line'} text-sm`}></i>
                            {aiWriting ? 'Writing...' : 'AI Writing Assistant'}
                          </button>
                          <button
                            onClick={() => setDraftSaved(true)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-smooth cursor-pointer whitespace-nowrap border border-foreground-200 shadow-sm text-foreground-500 hover:bg-background-100"
                          >
                            <i className="ri-save-line text-sm"></i>
                            {draftSaved ? 'Draft Saved' : 'Save Draft'}
                          </button>
                          <span className={`ml-auto text-xs font-semibold px-2 py-1 rounded-md ${wordCount >= MIN_WORDS ? 'bg-emerald-100 text-emerald-700' : 'bg-background-100 text-foreground-400'}`}>
                            {wordCount} / {MIN_WORDS} words
                          </span>
                        </div>

                        <textarea
                          value={reflection}
                          onChange={(e) => setReflection(e.target.value)}
                          placeholder="Describe what you learned from this activity, the key concepts and models you explored, and how they connect to your programme learning outcomes..."
                          rows={12}
                          className="w-full rounded-xl border border-foreground-200 bg-white px-4 py-3 text-sm text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100/50 resize-none transition-smooth shadow-sm"
                        />

                        {wordCount < MIN_WORDS && wordCount > 0 && (
                          <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                            <i className="ri-alert-line"></i>
                            You need at least {MIN_WORDS} words. Currently: {wordCount}.
                          </p>
                        )}
                        {wordCount >= MIN_WORDS && (
                          <p className="text-xs text-emerald-600 mt-2 flex items-center gap-1">
                            <i className="ri-check-line"></i> Minimum word count met
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── TAB 2: KSBs ── */}
                  {activeTab === 'ksbs' && (
                    <div className="space-y-5">
                      <div className="bg-background-100/50 rounded-xl p-5 border border-background-200/50">
                        <h3 className="text-[15px] font-heading font-semibold text-foreground-900 mb-1">KSB Development</h3>
                        <p className="text-sm text-foreground-500 mb-4">These KSBs are mapped to this component. Explain how this activity helped develop each one, and rate your confidence before and after.</p>

                        <div className="space-y-4">
                          {ksbCodes.map(code => {
                            const label = ksbLabels.split(',').find(l => {
                              if (code === 'K5') return l.includes('segmentation');
                              if (code === 'K6') return l.includes('planning');
                              if (code === 'S7') return l.includes('persona');
                              if (code === 'S8') return l.includes('campaign');
                              if (code === 'B1') return l.includes('apply');
                              return true;
                            }) || ksbLabels;
                            return (
                              <div key={code} className="rounded-xl border border-foreground-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center gap-2 mb-3">
                                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${ksbColor(code)}`}>{code}</span>
                                  <span className="text-sm font-medium text-foreground-800">{label.trim()}</span>
                                  <span className="text-[10px] text-foreground-400 bg-background-100 px-1.5 py-0.5 rounded border border-foreground-200">Pre-mapped</span>
                                </div>

                                <p className="text-sm text-foreground-600 mb-3">How did this activity help develop this KSB?</p>
                                <textarea
                                  value={ksbExplanations[code] || ''}
                                  onChange={(e) => setKsbExplanations(prev => ({ ...prev, [code]: e.target.value }))}
                                  placeholder={`Describe how this activity contributed to your understanding of ${code}...`}
                                  rows={3}
                                  className="w-full rounded-xl border border-foreground-200 bg-white px-4 py-3 text-sm text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100/50 resize-none transition-smooth shadow-sm mb-4"
                                />

                                <div className="grid grid-cols-2 gap-4">
                                  <div className="bg-background-100/40 rounded-lg p-3">
                                    <p className="text-xs text-foreground-400 mb-2">Confidence Before</p>
                                    <input
                                      type="range"
                                      min="1"
                                      max="10"
                                      value={confidenceBefore[code] || 5}
                                      onChange={(e) => setConfidenceBefore(prev => ({ ...prev, [code]: parseInt(e.target.value) }))}
                                      className="w-full accent-primary-500"
                                    />
                                    <div className="flex justify-between text-xs text-foreground-400 mt-1">
                                      <span>Low</span>
                                      <span className="font-semibold text-primary-600">{confidenceBefore[code] || 5}/10</span>
                                      <span>High</span>
                                    </div>
                                  </div>
                                  <div className="bg-background-100/40 rounded-lg p-3">
                                    <p className="text-xs text-foreground-400 mb-2">Confidence After</p>
                                    <input
                                      type="range"
                                      min="1"
                                      max="10"
                                      value={confidenceAfter[code] || 5}
                                      onChange={(e) => setConfidenceAfter(prev => ({ ...prev, [code]: parseInt(e.target.value) }))}
                                      className="w-full accent-accent-500"
                                    />
                                    <div className="flex justify-between text-xs text-foreground-400 mt-1">
                                      <span>Low</span>
                                      <span className="font-semibold text-accent-600">{confidenceAfter[code] || 5}/10</span>
                                      <span>High</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── TAB 3: APPLY ── */}
                  {activeTab === 'apply' && (
                    <div className="space-y-5">
                      <div className="bg-background-100/50 rounded-xl p-5 border border-background-200/50">
                        <h3 className="text-[15px] font-heading font-semibold text-foreground-900 mb-1">How can this learning be applied in your workplace?</h3>
                        <p className="text-sm text-foreground-500 mb-4">Select one option and describe your workplace application plan.</p>

                        <div className="space-y-3 mb-5">
                          {[
                            { value: 'already', label: 'I have already applied this learning' },
                            { value: 'plan', label: 'I plan to apply this learning' },
                            { value: 'unsure', label: 'I am unsure and need support' },
                          ].map(opt => (
                            <label
                              key={opt.value}
                              className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-smooth shadow-sm ${
                                applicationType === opt.value
                                  ? 'border-primary-300 bg-primary-50/40'
                                  : 'border-foreground-200 bg-white hover:border-primary-300'
                              }`}
                            >
                              <input
                                type="radio"
                                name="application"
                                value={opt.value}
                                checked={applicationType === opt.value}
                                onChange={() => setApplicationType(opt.value)}
                                className="mt-0.5 accent-primary-500"
                              />
                              <span className="text-sm text-foreground-700">{opt.label}</span>
                            </label>
                          ))}
                        </div>

                        {applicationType !== '' && (
                          <div className="rounded-xl border border-foreground-200 bg-white p-5 shadow-sm">
                            <p className="text-sm font-semibold text-foreground-800 mb-3">Workplace Application Plan</p>
                            <div className="space-y-2 mb-4">
                              <ul className="text-sm text-foreground-500 space-y-1.5 list-none">
                                <li className="flex items-start gap-2"><i className="ri-question-line text-foreground-300 mt-0.5 text-xs"></i><span>What will you do?</span></li>
                                <li className="flex items-start gap-2"><i className="ri-question-line text-foreground-300 mt-0.5 text-xs"></i><span>When will you do it?</span></li>
                                <li className="flex items-start gap-2"><i className="ri-question-line text-foreground-300 mt-0.5 text-xs"></i><span>Who will be involved?</span></li>
                                <li className="flex items-start gap-2"><i className="ri-question-line text-foreground-300 mt-0.5 text-xs"></i><span>What outcome do you expect?</span></li>
                              </ul>
                            </div>
                            <textarea
                              value={applicationText}
                              onChange={(e) => setApplicationText(e.target.value)}
                              placeholder="Describe your workplace application plan..."
                              rows={6}
                              className="w-full rounded-xl border border-foreground-200 bg-white px-4 py-3 text-sm text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100/50 resize-none transition-smooth shadow-sm"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── TAB 4: EVIDENCE ── */}
                  {activeTab === 'evidence' && (
                    <div className="space-y-5">
                      <div className="bg-background-100/50 rounded-xl p-5 border border-background-200/50">
                        <h3 className="text-[15px] font-heading font-semibold text-foreground-900 mb-1">Workplace Evidence</h3>
                        <p className="text-sm text-foreground-500 mb-4">Upload evidence showing how this learning was applied. Supported: PDF, Word, PowerPoint, Excel, Image, Screenshot, Email, Meeting Notes, Audio, Video, Link.</p>

                        {/* Upload area */}
                        <div
                          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                          onDragLeave={() => setDragOver(false)}
                          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFileSelect(e.dataTransfer.files); }}
                          onClick={() => fileInputRef.current?.click()}
                          className={`rounded-xl border-2 border-dashed p-8 text-center transition-all duration-200 cursor-pointer shadow-sm ${
                            dragOver
                              ? 'border-primary-400 bg-primary-50/40'
                              : 'border-foreground-300 hover:border-primary-300/60 hover:bg-primary-50/20'
                          }`}
                        >
                          <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(e) => handleFileSelect(e.target.files)}
                            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.mp4,.mov,.mp3,.txt,.csv"
                          />
                          <div className="w-14 h-14 rounded-full bg-primary-100 flex items-center justify-center mx-auto mb-3">
                            <i className="ri-upload-cloud-2-line text-primary-600 text-2xl"></i>
                          </div>
                          <p className="text-sm font-medium text-foreground-700 mb-1">Drop files here or <span className="text-primary-600">browse</span></p>
                          <p className="text-xs text-foreground-400">Multiple files supported — up to 25MB each</p>
                        </div>

                        {/* File list */}
                        {files.length > 0 && (
                          <div className="space-y-2 mt-4">
                            {files.map(f => (
                              <div key={f.id} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white border border-foreground-200 shadow-sm">
                                <i className={`${getFileIcon(f.type)} text-primary-600 text-lg`}></i>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-foreground-700 truncate">{f.name}</p>
                                  <p className="text-xs text-foreground-400">{f.size}</p>
                                </div>
                                <button
                                  onClick={() => removeFile(f.id)}
                                  className="w-7 h-7 rounded-full flex items-center justify-center text-foreground-400 hover:text-red-500 hover:bg-red-50 transition-smooth cursor-pointer shrink-0 border border-foreground-200"
                                >
                                  <i className="ri-close-line"></i>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Evidence description */}
                        <div className="mt-4">
                          <p className="text-sm font-semibold text-foreground-800 mb-2">Evidence Description</p>
                          <textarea
                            value={evidenceDescription}
                            onChange={(e) => setEvidenceDescription(e.target.value)}
                            placeholder="Describe what each piece of evidence shows and how it relates to your learning..."
                            rows={3}
                            className="w-full rounded-xl border border-foreground-200 bg-white px-4 py-3 text-sm text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100/50 resize-none transition-smooth shadow-sm"
                          />
                        </div>

                        {/* Consent checkbox */}
                        <label className="flex items-start gap-3 cursor-pointer mt-4">
                          <input
                            type="checkbox"
                            checked={hasConsent}
                            onChange={(e) => setHasConsent(e.target.checked)}
                            className="mt-0.5 accent-primary-500"
                          />
                          <span className="text-sm text-foreground-600 leading-relaxed">I confirm I have permission to upload this evidence and it does not contain any confidential or personal information about others without their consent.</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* ── TAB 5: BENEFIT ── */}
                  {activeTab === 'benefit' && (
                    <div className="space-y-5">
                      <div className="bg-background-100/50 rounded-xl p-5 border border-background-200/50">
                        <h3 className="text-[15px] font-heading font-semibold text-foreground-900 mb-1">How will your employer benefit?</h3>
                        <p className="text-sm text-foreground-500 mb-4">Select the business benefits that apply and explain the expected impact.</p>

                        <div className="flex flex-wrap gap-2 mb-5">
                          {BENEFIT_TAGS.map(tag => (
                            <button
                              key={tag}
                              onClick={() => toggleBenefit(tag)}
                              className={`text-sm font-medium px-3 py-2 rounded-full border transition-smooth cursor-pointer whitespace-nowrap ${
                                selectedBenefits.includes(tag)
                                  ? 'bg-primary-500 text-white border-primary-500 shadow-sm shadow-primary-500/15'
                                  : 'bg-white text-foreground-600 border-foreground-200 hover:border-primary-300/60'
                              }`}
                            >
                              {selectedBenefits.includes(tag) && <i className="ri-check-line mr-1"></i>}
                              {tag}
                            </button>
                          ))}
                        </div>

                        <div>
                          <p className="text-sm font-semibold text-foreground-800 mb-2">Explain the expected business benefit</p>
                          <textarea
                            value={benefitExplanation}
                            onChange={(e) => setBenefitExplanation(e.target.value)}
                            placeholder="How will this learning improve your workplace performance, your team, or your organisation?"
                            rows={5}
                            className="w-full rounded-xl border border-foreground-200 bg-white px-4 py-3 text-sm text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100/50 resize-none transition-smooth shadow-sm"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── TAB 6: OTJH ── */}
                  {activeTab === 'otjh' && (
                    <div className="space-y-5">
                      <div className="bg-background-100/50 rounded-xl p-5 border border-background-200/50">
                        <h3 className="text-[15px] font-heading font-semibold text-foreground-900 mb-1">Off-The-Job Hours Declaration</h3>
                        <p className="text-sm text-foreground-500 mb-4">Confirm the hours you spent on this learning activity.</p>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                          <div className="bg-white rounded-xl p-4 border border-foreground-200 shadow-sm">
                            <p className="text-[11px] text-foreground-400 uppercase tracking-wider font-semibold mb-1">Planned Hours</p>
                            <p className="text-xl font-heading font-bold text-foreground-900">{plannedOTJH}h</p>
                          </div>
                          <div className="bg-white rounded-xl p-4 border border-foreground-200 shadow-sm">
                            <p className="text-[11px] text-foreground-400 uppercase tracking-wider font-semibold mb-1">Actual Hours</p>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                step="0.1"
                                value={otjhActual}
                                onChange={(e) => setOtjhActual(parseFloat(e.target.value) || 0)}
                                className="w-20 text-xl font-heading font-bold text-foreground-900 bg-white border-2 border-foreground-200 rounded-lg px-2 py-1 focus:outline-none focus:border-primary-500"
                              />
                              <span className="text-sm text-foreground-500">hours</span>
                            </div>
                          </div>
                          <div className="bg-white rounded-xl p-4 border border-foreground-200 shadow-sm">
                            <p className="text-[11px] text-foreground-400 uppercase tracking-wider font-semibold mb-1">Date Completed</p>
                            <input
                              type="date"
                              value={dateCompleted}
                              onChange={(e) => setDateCompleted(e.target.value)}
                              className="text-sm font-medium text-foreground-900 bg-white border-2 border-foreground-200 rounded-lg px-2 py-1 focus:outline-none focus:border-primary-500"
                            />
                          </div>
                        </div>

                        <p className="text-sm font-semibold text-foreground-800 mb-3">Was this completed during paid working hours?</p>
                        <div className="space-y-2 mb-5">
                          {[
                            { value: 'yes', label: 'Yes — fully during paid working hours' },
                            { value: 'no', label: 'No — completed outside normal working hours' },
                            { value: 'partially', label: 'Partially — some during, some outside working hours' },
                          ].map(opt => (
                            <label
                              key={opt.value}
                              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-smooth shadow-sm ${
                                otjhPaid === opt.value
                                  ? 'border-primary-300 bg-primary-50/40'
                                  : 'border-foreground-200 bg-white hover:border-primary-300'
                              }`}
                            >
                              <input
                                type="radio"
                                name="otjhPaid"
                                value={opt.value}
                                checked={otjhPaid === opt.value}
                                onChange={() => setOtjhPaid(opt.value)}
                                className="accent-primary-500"
                              />
                              <span className="text-sm text-foreground-700">{opt.label}</span>
                            </label>
                          ))}
                        </div>

                        <label className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={otjhConfirmed}
                            onChange={(e) => setOtjhConfirmed(e.target.checked)}
                            className="mt-0.5 accent-primary-500"
                          />
                          <span className="text-sm text-foreground-600 leading-relaxed">
                            I confirm the OTJH information is accurate and reflects genuine apprenticeship learning. I understand that false OTJH declarations are a serious matter and may result in referral or disciplinary action.
                          </span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* ── TAB 7: REVIEW ── */}
                  {activeTab === 'review' && (
                    <div className="space-y-5">
                      <div className="bg-background-100/50 rounded-xl p-5 border border-background-200/50">
                        <h3 className="text-[15px] font-heading font-semibold text-foreground-900 mb-1">Submission Review</h3>
                        <p className="text-sm text-foreground-500 mb-4">Review your submission before sending it to your coach. Run an AI quality check to identify any missing elements.</p>

                        {/* AI Check Button */}
                        <button
                          onClick={runAiCheck}
                          disabled={aiCheckRun}
                          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap mb-5 ${
                            aiCheckRun
                              ? 'bg-background-100 text-foreground-300 cursor-not-allowed'
                              : 'bg-primary-500 text-white hover:bg-primary-600 shadow-sm shadow-primary-500/15'
                          }`}
                        >
                          <i className={`${aiCheckRun ? 'ri-loader-4-line animate-spin' : 'ri-sparkling-line'} text-sm`}></i>
                          {aiCheckRun ? 'Running AI Check...' : 'Run AI Quality Check'}
                        </button>

                        {/* AI Check Results */}
                        {aiCheckRun && Object.keys(aiChecks).length > 0 && (
                          <div className="rounded-xl border border-foreground-200 bg-white p-5 mb-5 shadow-sm">
                            <p className="text-sm font-semibold text-foreground-800 mb-3">AI Quality Check Results</p>
                            <div className="space-y-2">
                              {[
                                { key: 'reflection', label: 'Reflection completed', icon: 'ri-lightbulb-line' },
                                { key: 'wordCount', label: 'Minimum word count met', icon: 'ri-file-text-line' },
                                { key: 'ksbs', label: 'KSB explanations provided', icon: 'ri-focus-3-line' },
                                { key: 'application', label: 'Workplace application completed', icon: 'ri-briefcase-line' },
                                { key: 'otjh', label: 'OTJH declared', icon: 'ri-time-line' },
                                { key: 'benefit', label: 'Employer benefit completed', icon: 'ri-building-line' },
                                { key: 'evidence', label: 'Evidence uploaded or described', icon: 'ri-folder-upload-line' },
                              ].map(check => (
                                <div key={check.key} className="flex items-center gap-2">
                                  <i className={`${check.icon} text-sm ${aiChecks[check.key] ? 'text-primary-500' : 'text-foreground-300'}`}></i>
                                  <span className={`text-sm ${aiChecks[check.key] ? 'text-foreground-700' : 'text-foreground-400'}`}>{check.label}</span>
                                  {aiChecks[check.key] ? (
                                    <i className="ri-check-line text-emerald-500 text-sm ml-auto"></i>
                                  ) : (
                                    <i className="ri-alert-line text-amber-500 text-sm ml-auto"></i>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Learner Declaration */}
                        <div className={`rounded-xl border p-5 shadow-sm ${
                          canSubmit ? 'border-emerald-300 bg-emerald-50/30' : 'border-foreground-200 bg-white'
                        }`}>
                          <p className="text-sm font-semibold text-foreground-800 mb-3">Learner Declaration</p>
                          <div className="flex items-start gap-3 mb-3">
                            <span className="w-8 h-8 rounded-full bg-accent-100 flex items-center justify-center shrink-0 text-accent-600 text-xs font-bold">SW</span>
                            <div>
                              <p className="text-sm font-medium text-foreground-700">Sophie Williams</p>
                              <p className="text-xs text-foreground-400">12 Jun 2026 &middot; 14:32</p>
                            </div>
                          </div>
                          <p className="text-sm text-foreground-600 mb-3 leading-relaxed">
                            I confirm this submission is accurate and represents my own learning and workplace application. I understand that all evidence is subject to coach and quality assurance review.
                          </p>
                          <div className="flex items-center gap-2 text-xs text-foreground-500">
                            <i className="ri-shield-check-line text-primary-500"></i>
                            <span>Electronic signature on file</span>
                          </div>
                        </div>

                        {/* Submit actions */}
                        <div className="flex items-center gap-3 pt-4">
                          <button
                            onClick={() => setDraftSaved(true)}
                            className="px-5 py-2.5 rounded-xl border border-foreground-200 text-sm font-medium text-foreground-500 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap shadow-sm"
                          >
                            <i className="ri-save-line mr-1.5"></i>
                            Save Draft
                          </button>
                          <button
                            onClick={handleSubmit}
                            disabled={!canSubmit}
                            className={`flex-1 px-5 py-2.5 rounded-xl text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-2 ${
                              canSubmit
                                ? 'bg-primary-500 text-white hover:bg-primary-600 shadow-sm shadow-primary-500/15'
                                : 'bg-background-100 text-foreground-300 cursor-not-allowed'
                            }`}
                          >
                            <i className="ri-send-plane-line text-sm"></i>
                            Submit For Review
                          </button>
                        </div>
                        {!canSubmit && (
                          <p className="text-xs text-amber-600 mt-2">
                            Please complete the Learning reflection, Evidence, and OTJH declaration before submitting.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ════════════════════════════════════════
                  BOTTOM NAV
                  ════════════════════════════════════════ */}
              <div className="shrink-0 bg-background-50 border-t border-foreground-200 px-5 md:px-8 py-3 flex items-center justify-between">
                <button
                  onClick={() => {
                    const idx = TABS.findIndex(t => t.id === activeTab);
                    if (idx > 0) setActiveTab(TABS[idx - 1].id);
                  }}
                  disabled={activeTab === 'learning'}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-smooth cursor-pointer whitespace-nowrap border border-background-200 ${
                    activeTab === 'learning' ? 'opacity-30 cursor-not-allowed' : 'text-foreground-500 hover:bg-background-100'
                  }`}
                >
                  <i className="ri-arrow-left-line mr-1"></i> Previous
                </button>
                <div className="flex items-center gap-2">
                  {activeTab !== 'review' && (
                    <button
                      onClick={() => {
                        const idx = TABS.findIndex(t => t.id === activeTab);
                        if (idx < TABS.length - 1) setActiveTab(TABS[idx + 1].id);
                      }}
                      className="px-4 py-2 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                    >
                      Next <i className="ri-arrow-right-line ml-1"></i>
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}