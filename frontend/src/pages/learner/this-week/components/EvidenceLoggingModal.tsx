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
    signedDeclaration: boolean;
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
  'Improved productivity', 'Better customer service', 'Better marketing performance',
  'Better project planning or control', 'Improved communication', 'Better data use',
  'Reduced errors', 'Better compliance', 'Cost saving',
  'Improved quality', 'Improved teamwork', 'Stronger innovation',
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
  const [ksbExplanations, setKsbExplanations] = useState<Record<string, string>>({});
  const [confidenceBefore, setConfidenceBefore] = useState<Record<string, number>>({});
  const [confidenceAfter, setConfidenceAfter] = useState<Record<string, number>>({});

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
  const [aiChecking, setAiChecking] = useState(false);
  const [aiCheckRun, setAiCheckRun] = useState(false);
  const [aiChecks, setAiChecks] = useState<Record<string, boolean>>({});
  const [signedDeclaration, setSignedDeclaration] = useState(false);

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
      setAiChecking(false);
      setAiCheckRun(false);
      setAiChecks({});
      setSignedDeclaration(false);
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
    setAiChecking(true);
    setAiCheckRun(false);
    setTimeout(() => {
      setAiChecks({
        reflection: reflection.trim().length > 50,
        wordCount: wordCount >= MIN_WORDS,
        ksbs: ksbCodes.length === 0 || Object.values(ksbExplanations).some(value => value.trim().length > 0),
        application: applicationType !== '' && applicationText.trim().length > 20,
        otjh: otjhConfirmed && otjhActual > 0 && otjhPaid !== '' && dateCompleted !== '',
        benefit: selectedBenefits.length > 0 && benefitExplanation.trim().length > 20,
        evidence: files.length > 0 && hasConsent,
      });
      setAiChecking(false);
      setAiCheckRun(true);
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
      signedDeclaration,
    });
    setSubmitted(true);
  };

  const allKsbRatingsComplete = ksbCodes.every(
    code => confidenceBefore[code] !== undefined && confidenceAfter[code] !== undefined
  );
  const ksbExplanationReady = ksbCodes.length === 0
    || Object.values(ksbExplanations).some(value => value.trim().length > 0);
  const applicationReady = applicationType !== '' && applicationText.trim().length > 20;
  const evidenceReady = files.length > 0 && hasConsent;
  const benefitReady = selectedBenefits.length > 0 && benefitExplanation.trim().length > 20;
  const otjhReady = otjhConfirmed && otjhActual > 0 && otjhPaid !== '' && dateCompleted !== '';
  const canSubmit = wordCount >= MIN_WORDS
    && allKsbRatingsComplete
    && ksbExplanationReady
    && applicationReady
    && evidenceReady
    && benefitReady
    && otjhReady
    && signedDeclaration;

  const isTabComplete = (tabId: string) => {
    switch (tabId) {
      case 'learning': return wordCount >= MIN_WORDS;
      case 'ksbs': return allKsbRatingsComplete && ksbExplanationReady;
      case 'apply': return applicationReady;
      case 'evidence': return evidenceReady;
      case 'benefit': return benefitReady;
      case 'otjh': return otjhReady;
      case 'review': return canSubmit;
      default: return false;
    }
  };

  const submissionChecklist = [
    { label: `Reflection (≥ ${MIN_WORDS} words)`, complete: wordCount >= MIN_WORDS },
    { label: ksbCodes.length === 0 ? 'No KSB explanation required' : 'At least one KSB explained and rated', complete: ksbExplanationReady && allKsbRatingsComplete },
    { label: 'Workplace application or support request', complete: applicationReady },
    { label: 'Evidence uploaded and coach visibility confirmed', complete: evidenceReady },
    { label: 'Employer benefit selected and explained', complete: benefitReady },
    { label: 'OTJH confirmed', complete: otjhReady },
    { label: 'Signed declaration', complete: signedDeclaration },
  ];

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
        className={`fixed inset-0 z-[61] flex items-center justify-center p-3 md:p-6 transition-all duration-300 ease-out ${
          isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="evidence-modal-title"
          className="w-full max-w-5xl h-[min(92vh,860px)] bg-background-50 border border-foreground-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        >

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
                    <AppIcon className="ri-folder-upload-line text-primary-600 text-lg"></AppIcon>
                  </span>
                  <div className="min-w-0">
                    <h2 id="evidence-modal-title" className="text-[15px] font-heading font-bold text-foreground-900 leading-tight">My Learning Evidence &amp; Reflection</h2>
                    <p className="text-sm text-foreground-500 mt-0.5 leading-snug">{title}</p>
                    <p className="text-[11px] text-foreground-400 mt-1">{componentType === 'Evidence' ? 'Upload Workplace Project Evidence' : 'Upload Learning Activity Evidence'}</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer shrink-0 mt-0.5"
                >
                  <AppIcon className="ri-close-line text-lg"></AppIcon>
                </button>
              </div>

              {/* Meta bar */}
              <div className="flex items-center gap-4 md:gap-6 mt-3 flex-wrap text-[11px] text-foreground-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-accent-100 flex items-center justify-center shrink-0 text-[9px] font-bold text-accent-600">SW</span>
                  Sophie Williams
                </span>
                <span className="text-foreground-200">|</span>
                <span className="flex items-center gap-1.5"><AppIcon className="ri-graduation-cap-line text-foreground-300"></AppIcon> Marketing Executive</span>
                <span className="text-foreground-200">|</span>
                <span className="flex items-center gap-1.5"><AppIcon className="ri-time-line text-foreground-300"></AppIcon> {plannedOTJH}h OTJH</span>
                <span className="text-foreground-200">|</span>
                <span className="flex items-center gap-1.5">
                  <AppIcon className="ri-focus-3-line text-foreground-300"></AppIcon>
                  <span className="flex items-center gap-1">
                    {ksbCodes.map(k => (
                      <span key={k} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${ksbColor(k)}`}>{k}</span>
                    ))}
                  </span>
                </span>
                <span className="text-foreground-200">|</span>
                <span className="flex items-center gap-1.5"><AppIcon className="ri-award-line text-foreground-300"></AppIcon> {points} pts</span>
              </div>
            </div>
          </div>

          {/* ════════════════════════════════════════
              PROGRESS STEPPER — Redesigned
              ════════════════════════════════════════ */}
          <div className="shrink-0 bg-background-100/40 px-5 md:px-8 py-3 border-b border-background-200/40">
            <div className="flex items-center overflow-x-auto">
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
                          <AppIcon className="ri-check-line text-[9px]"></AppIcon>
                        ) : (
                          <AppIcon className={`${tab.icon} text-[9px]`}></AppIcon>
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
                  <AppIcon className="ri-check-double-line text-emerald-600 text-3xl"></AppIcon>
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
                          <AppIcon className={step.icon}></AppIcon>
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
                          <AppIcon className="ri-arrow-go-back-line text-red-600 text-sm"></AppIcon>
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
                        <h3 className="text-[15px] font-heading font-semibold text-foreground-900 mb-1">What have you learnt from this activity?</h3>
                        <p className="text-sm text-foreground-500 mb-4">Summarise the key ideas, methods, models, tools, concepts or techniques you understood from this {componentType.toLowerCase()}. <span className="font-semibold text-foreground-700">Aim for at least {MIN_WORDS} words.</span></p>

                        {/* Toolbar — improved */}
                        <div className="flex items-center gap-2 mb-3">
                          <button
                            onClick={() => setRecording(!recording)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-smooth cursor-pointer whitespace-nowrap shadow-sm ${
                              recording ? 'bg-red-50 text-red-600 border border-red-300' : 'text-foreground-500 hover:bg-background-100 border border-foreground-200'
                            }`}
                          >
                            <AppIcon className={`${recording ? 'ri-mic-fill animate-pulse' : 'ri-mic-line'} text-sm`}></AppIcon>
                            {recording ? 'Recording...' : 'Voice Record'}
                          </button>
                          <button
                            onClick={runAiWriting}
                            disabled={aiWriting}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-smooth cursor-pointer whitespace-nowrap border border-foreground-200 shadow-sm text-foreground-500 hover:bg-background-100 ${
                              aiWriting ? 'opacity-60' : ''
                            }`}
                          >
                            <AppIcon className={`${aiWriting ? 'ri-loader-4-line animate-spin' : 'ri-sparkling-line'} text-sm`}></AppIcon>
                            {aiWriting ? 'Writing...' : 'AI Writing Assistant'}
                          </button>
                          <button
                            onClick={() => setDraftSaved(true)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-smooth cursor-pointer whitespace-nowrap border border-foreground-200 shadow-sm text-foreground-500 hover:bg-background-100"
                          >
                            <AppIcon className="ri-save-line text-sm"></AppIcon>
                            {draftSaved ? 'Draft Saved' : 'Save Draft'}
                          </button>
                          <span className={`ml-auto text-xs font-semibold px-2 py-1 rounded-md ${wordCount >= MIN_WORDS ? 'bg-emerald-100 text-emerald-700' : 'bg-background-100 text-foreground-400'}`}>
                            {wordCount} / {MIN_WORDS} words
                          </span>
                        </div>

                        <textarea
                          value={reflection}
                          onChange={(e) => setReflection(e.target.value)}
                          placeholder={`Summarise what you learnt from this ${componentType.toLowerCase()}...`}
                          rows={12}
                          className="w-full rounded-xl border border-foreground-200 bg-white px-4 py-3 text-sm text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100/50 resize-none transition-smooth shadow-sm"
                        />

                        {wordCount < MIN_WORDS && wordCount > 0 && (
                          <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                            <AppIcon className="ri-alert-line"></AppIcon>
                            You need at least {MIN_WORDS} words. Currently: {wordCount}.
                          </p>
                        )}
                        {wordCount >= MIN_WORDS && (
                          <p className="text-xs text-emerald-600 mt-2 flex items-center gap-1">
                            <AppIcon className="ri-check-line"></AppIcon> Minimum word count met
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── TAB 2: KSBs ── */}
                  {activeTab === 'ksbs' && (
                    <div className="space-y-5">
                      <div className="bg-background-100/50 rounded-xl p-5 border border-background-200/50">
                        <h3 className="text-[15px] font-heading font-semibold text-foreground-900 mb-1">KSB confidence check</h3>
                        <p className="text-sm text-foreground-500 mb-4">Rate your confidence before and after this activity for each mapped KSB. This helps show the progress you made.</p>

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

                                <p className="text-sm text-foreground-600 mb-3">Briefly explain how this activity developed {code}.</p>
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
                                      max="5"
                                      value={confidenceBefore[code] ?? 1}
                                      onChange={(e) => setConfidenceBefore(prev => ({ ...prev, [code]: parseInt(e.target.value) }))}
                                      className="w-full accent-primary-500"
                                    />
                                    <div className="flex justify-between text-xs text-foreground-400 mt-1">
                                      <span>Low</span>
                                      <span className="font-semibold text-primary-600">{confidenceBefore[code] ?? 1}/5</span>
                                      <span>High</span>
                                    </div>
                                  </div>
                                  <div className="bg-background-100/40 rounded-lg p-3">
                                    <p className="text-xs text-foreground-400 mb-2">Confidence After</p>
                                    <input
                                      type="range"
                                      min="1"
                                      max="5"
                                      value={confidenceAfter[code] ?? 1}
                                      onChange={(e) => setConfidenceAfter(prev => ({ ...prev, [code]: parseInt(e.target.value) }))}
                                      className="w-full accent-accent-500"
                                    />
                                    <div className="flex justify-between text-xs text-foreground-400 mt-1">
                                      <span>Low</span>
                                      <span className="font-semibold text-accent-600">{confidenceAfter[code] ?? 1}/5</span>
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
                        <p className="text-sm text-foreground-500 mb-4">Choose the option that best describes whether you know how to use this learning at work.</p>

                        <div className="space-y-3 mb-5">
                          {[
                            { value: 'already', label: 'I have already applied this learning' },
                            { value: 'plan', label: 'I plan to apply this learning' },
                            { value: 'unsure', label: "I'm not sure how to apply — I need support" },
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

                        {applicationType !== '' && applicationType !== 'unsure' && (
                          <div className="rounded-xl border border-foreground-200 bg-white p-5 shadow-sm">
                            <p className="text-sm font-semibold text-foreground-800 mb-3">Workplace Application Plan</p>
                            <div className="space-y-2 mb-4">
                              <ul className="text-sm text-foreground-500 space-y-1.5 list-none">
                                <li className="flex items-start gap-2"><AppIcon className="ri-question-line text-foreground-300 mt-0.5 text-xs"></AppIcon><span>What will you do?</span></li>
                                <li className="flex items-start gap-2"><AppIcon className="ri-question-line text-foreground-300 mt-0.5 text-xs"></AppIcon><span>When will you do it?</span></li>
                                <li className="flex items-start gap-2"><AppIcon className="ri-question-line text-foreground-300 mt-0.5 text-xs"></AppIcon><span>Who will be involved?</span></li>
                                <li className="flex items-start gap-2"><AppIcon className="ri-question-line text-foreground-300 mt-0.5 text-xs"></AppIcon><span>What outcome do you expect?</span></li>
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

                        {applicationType === 'unsure' && (
                          <div className="space-y-3">
                            <textarea
                              value={applicationText}
                              onChange={(e) => setApplicationText(e.target.value)}
                              placeholder="Describe what support you need from your coach or employer."
                              rows={6}
                              className="w-full rounded-xl border border-foreground-200 bg-white px-4 py-3 text-sm text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100/50 resize-none transition-smooth shadow-sm"
                            />
                            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50/60 px-4 py-3 text-sm text-amber-800">
                              <AppIcon className="ri-alert-line mt-0.5 shrink-0"></AppIcon>
                              <span>Submitting this will alert your coach so they can discuss the support you need in your next meeting.</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── TAB 4: EVIDENCE ── */}
                  {activeTab === 'evidence' && (
                    <div className="space-y-5">
                      <div className="bg-background-100/50 rounded-xl p-5 border border-background-200/50">
                        <h3 className="text-[15px] font-heading font-semibold text-foreground-900 mb-1">Upload evidence of your learning</h3>
                        <p className="text-sm text-foreground-500 mb-4">Upload at least one file for your coach to review. Supported: PDF, Word, PowerPoint, Excel, image, screenshot, email, meeting notes, audio or video.</p>

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
                            <AppIcon className="ri-upload-cloud-2-line text-primary-600 text-2xl"></AppIcon>
                          </div>
                          <p className="text-sm font-medium text-foreground-700 mb-1">Drop files here or <span className="text-primary-600">browse</span></p>
                          <p className="text-xs text-foreground-400">Multiple files supported — up to 25MB each</p>
                        </div>

                        {/* File list */}
                        {files.length > 0 && (
                          <div className="space-y-2 mt-4">
                            {files.map(f => (
                              <div key={f.id} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white border border-foreground-200 shadow-sm">
                                <AppIcon className={`${getFileIcon(f.type)} text-primary-600 text-lg`}></AppIcon>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-foreground-700 truncate">{f.name}</p>
                                  <p className="text-xs text-foreground-400">{f.size}</p>
                                </div>
                                <button
                                  onClick={() => removeFile(f.id)}
                                  className="w-7 h-7 rounded-full flex items-center justify-center text-foreground-400 hover:text-red-500 hover:bg-red-50 transition-smooth cursor-pointer shrink-0 border border-foreground-200"
                                >
                                  <AppIcon className="ri-close-line"></AppIcon>
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
                          <span className="text-sm text-foreground-600 leading-relaxed">I confirm that this evidence can be viewed by my coach and that I have removed or hidden any confidential, personal or commercially sensitive information where necessary.</span>
                        </label>
                        {files.length > 0 && !hasConsent && (
                          <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                            <AppIcon className="ri-alert-line"></AppIcon>
                            Confirm coach visibility before continuing.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── TAB 5: BENEFIT ── */}
                  {activeTab === 'benefit' && (
                    <div className="space-y-5">
                      <div className="bg-background-100/50 rounded-xl p-5 border border-background-200/50">
                        <h3 className="text-[15px] font-heading font-semibold text-foreground-900 mb-1">How could your employer or business benefit from this learning?</h3>
                        <p className="text-sm text-foreground-500 mb-4">Select all relevant benefits, then explain how this learning could improve outcomes for your team or company.</p>

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
                              {selectedBenefits.includes(tag) && <AppIcon className="ri-check-line mr-1"></AppIcon>}
                              {tag}
                            </button>
                          ))}
                        </div>

                        <div>
                          <p className="text-sm font-semibold text-foreground-800 mb-2">Explain the expected benefit</p>
                          <textarea
                            value={benefitExplanation}
                            onChange={(e) => setBenefitExplanation(e.target.value)}
                            placeholder="Explain how this could improve your team, employer or business outcomes."
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
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <label className="block">
                          <span className="block text-xs font-medium text-foreground-700 mb-1.5">Planned time</span>
                          <div className="h-11 flex items-center rounded-xl border border-foreground-200 bg-background-100 px-3 text-sm text-foreground-400 shadow-sm">
                            {plannedOTJH}h
                          </div>
                        </label>
                        <label className="block">
                          <span className="block text-xs font-medium text-foreground-700 mb-1.5">Actual time spent (hours)</span>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={otjhActual}
                            onChange={(e) => setOtjhActual(parseFloat(e.target.value) || 0)}
                            className="h-11 w-full rounded-xl border border-foreground-200 bg-white px-3 text-sm text-foreground-800 shadow-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100/50"
                          />
                        </label>
                        <label className="block">
                          <span className="block text-xs font-medium text-foreground-700 mb-1.5">Date completed</span>
                          <input
                            type="date"
                            value={dateCompleted}
                            onChange={(e) => setDateCompleted(e.target.value)}
                            className="h-11 w-full rounded-xl border border-foreground-200 bg-white px-3 text-sm text-foreground-800 shadow-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100/50"
                          />
                        </label>
                      </div>

                      <fieldset>
                        <legend className="text-xs font-medium text-foreground-700 mb-2">Completed during paid working hours?</legend>
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                          {[
                            { value: 'yes', label: 'Yes' },
                            { value: 'no', label: 'No' },
                            { value: 'partially', label: 'Partly' },
                          ].map(opt => (
                            <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm text-foreground-700">
                              <input
                                type="radio"
                                name="otjhPaid"
                                value={opt.value}
                                checked={otjhPaid === opt.value}
                                onChange={() => setOtjhPaid(opt.value)}
                                className="h-4 w-4 accent-primary-600"
                              />
                              {opt.label}
                            </label>
                          ))}
                        </div>
                      </fieldset>

                      <div className="rounded-xl border border-foreground-200 bg-primary-50/30 px-4 py-3 text-sm leading-relaxed text-foreground-500">
                        I confirm that the time recorded is accurate. I confirm that this activity supported development of my apprenticeship KSBs. I confirm it was completed during my normal paid working hours, unless I have explained an agreed exception.
                      </div>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={otjhConfirmed}
                          onChange={(e) => setOtjhConfirmed(e.target.checked)}
                          className="h-4 w-4 accent-primary-600"
                        />
                        <span className="text-sm text-foreground-700">I confirm this OTJH record is accurate.</span>
                      </label>
                    </div>
                  )}

                  {/* ── TAB 7: REVIEW ── */}
                  {activeTab === 'review' && (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-foreground-200 bg-white px-4 py-3 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-foreground-800">AI quality check</p>
                          <button
                            onClick={runAiCheck}
                            disabled={aiChecking}
                            className="flex items-center gap-2 rounded-xl border border-foreground-200 bg-white px-4 py-2 text-xs font-medium text-foreground-700 shadow-sm transition-smooth hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <AppIcon className={`${aiChecking ? 'ri-loader-4-line animate-spin' : 'ri-sparkling-line'} text-sm`}></AppIcon>
                            {aiChecking ? 'Checking...' : aiCheckRun ? 'Run again' : 'Run check'}
                          </button>
                        </div>
                        {aiCheckRun && (
                          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-foreground-100 pt-3">
                            {[
                              { key: 'wordCount', label: 'Reflection quality' },
                              { key: 'ksbs', label: 'KSB explanation' },
                              { key: 'application', label: 'Workplace application' },
                              { key: 'evidence', label: 'Evidence and consent' },
                              { key: 'benefit', label: 'Employer benefit' },
                              { key: 'otjh', label: 'OTJH record' },
                            ].map(check => (
                              <div key={check.key} className="flex items-center gap-2 text-xs">
                                <AppIcon className={`${aiChecks[check.key] ? 'ri-checkbox-circle-line text-emerald-500' : 'ri-alert-line text-amber-500'}`}></AppIcon>
                                <span className={aiChecks[check.key] ? 'text-foreground-700' : 'text-foreground-500'}>{check.label}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl border border-primary-200 bg-primary-50/30 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <AppIcon className="ri-shield-check-line text-primary-500"></AppIcon>
                          <h3 className="text-sm font-semibold text-foreground-800">Learner declaration &amp; signature</h3>
                        </div>
                        <p className="text-xs leading-relaxed text-foreground-500 mb-3">
                          Your stored signature is reused on every submission and saved with the document dated and time-stamped for legal and compliance reasons.
                        </p>
                        <div className="rounded-xl border border-foreground-200 bg-white px-4 py-2.5 text-sm italic text-foreground-700 shadow-sm mb-3">
                          Sophie Williams
                        </div>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={signedDeclaration}
                            onChange={(e) => setSignedDeclaration(e.target.checked)}
                            className="mt-0.5 h-4 w-4 accent-primary-600"
                          />
                          <span className="text-sm text-foreground-700">I confirm this evidence is accurate and electronically sign it.</span>
                        </label>
                        <p className="mt-2 text-xs text-foreground-500">
                          Will be stored as: <span className="font-semibold">Sophie Williams</span> &middot; {new Date().toLocaleDateString('en-GB')} &middot; {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>

                      <div className="rounded-xl border border-foreground-200 bg-white p-4">
                        <h3 className="text-xs font-semibold text-foreground-800 mb-2">Submission checklist</h3>
                        <div className="space-y-1.5">
                          {submissionChecklist.map(item => (
                            <div key={item.label} className="flex items-center gap-2 text-xs">
                              <AppIcon className={`${item.complete ? 'ri-checkbox-circle-line text-emerald-500' : 'ri-alert-line text-foreground-500'}`}></AppIcon>
                              <span className={item.complete ? 'text-foreground-700' : 'text-foreground-500'}>{item.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-col gap-3 border-t border-foreground-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-foreground-500">
                          Status on submit: <span className="font-semibold">Submitted for tutor review</span> — KSBs &amp; OTJH stay pending until validated.
                        </p>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => setDraftSaved(true)}
                            className="rounded-xl border border-foreground-200 bg-white px-4 py-2.5 text-sm font-medium text-foreground-700 shadow-sm transition-smooth hover:bg-background-100"
                          >
                            {draftSaved ? 'Draft saved' : 'Save draft'}
                          </button>
                          <button
                            onClick={handleSubmit}
                            disabled={!canSubmit}
                            className={`flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-smooth ${
                              canSubmit
                                ? 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm'
                                : 'cursor-not-allowed bg-foreground-300 text-white'
                            }`}
                          >
                            <AppIcon className="ri-edit-line"></AppIcon>
                            Submit for tutor review
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ════════════════════════════════════════
                  BOTTOM NAV
                  ════════════════════════════════════════ */}
              {activeTab !== 'review' && (
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
                  <AppIcon className="ri-arrow-left-line mr-1"></AppIcon> Previous
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const idx = TABS.findIndex(t => t.id === activeTab);
                      if (idx < TABS.length - 1) setActiveTab(TABS[idx + 1].id);
                    }}
                    className="px-4 py-2 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                  >
                    Next <AppIcon className="ri-arrow-right-line ml-1"></AppIcon>
                  </button>
                </div>
              </div>
              )}
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
