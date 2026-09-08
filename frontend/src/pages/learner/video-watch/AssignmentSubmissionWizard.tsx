import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import DOMPurify from 'dompurify';
import type { ComponentKsbMapping, LearnerKind } from '@/api/learnerDetail';
import {
  loadLearningReflectionSubmission,
  saveLearningReflectionSubmission,
  type LearningReflectionSubmissionInput,
} from '@/api/reflectionSubmission';
import {
  getEvidenceDownloadUrl,
  type EvidenceRecord,
  type EvidenceTrainingPlanDetails,
} from '@/api/evidence';
import { AssignmentEvidence } from '@/components/feature/AssignmentEvidence';
import { AppIcon } from '@/components/feature/AppIcon';

export type AssignmentAnswers = {
  assignmentAnswer: string;
  whatYouLearned: string;
  businessImpact: string;
};

const EMPTY_ANSWERS: AssignmentAnswers = {
  assignmentAnswer: '',
  whatYouLearned: '',
  businessImpact: '',
};

const STEP_META = [
  { label: 'Your answer', icon: 'ri-edit-box-line' },
  { label: 'Learning & KSBs', icon: 'ri-lightbulb-flash-line' },
  { label: 'Business impact', icon: 'ri-building-4-line' },
] as const;

function londonDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export function AssignmentSubmissionWizard({
  kind,
  learnerId,
  learnerName,
  programmeName,
  componentId,
  title,
  moduleTitle,
  weekTitle,
  plannedOtjh,
  questionHtml,
  questionText,
  ksbMappings,
  evidenceFiles,
  evidenceDetails,
  timeSeconds,
  timeControl,
  outsideWorkingHours,
  outsideWorkingHoursConfirmed,
  submittingProgress,
  onEvidenceChanged,
  onRestoreTime,
  onSubmitProgress,
}: {
  kind: LearnerKind;
  learnerId: string;
  learnerName: string;
  programmeName: string;
  componentId: string;
  title: string;
  moduleTitle: string;
  weekTitle: string;
  plannedOtjh: number | null;
  questionHtml?: string | null;
  questionText?: string | null;
  ksbMappings: ComponentKsbMapping[];
  evidenceFiles: EvidenceRecord[];
  evidenceDetails: EvidenceTrainingPlanDetails;
  timeSeconds: number | null;
  timeControl: ReactNode;
  outsideWorkingHours: boolean;
  outsideWorkingHoursConfirmed: boolean;
  submittingProgress: boolean;
  onEvidenceChanged: (files: EvidenceRecord[]) => void;
  onRestoreTime: (seconds: number) => void;
  onSubmitProgress: (answers: AssignmentAnswers) => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<AssignmentAnswers>(EMPTY_ANSWERS);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [evidencePreview, setEvidencePreview] = useState<{ file: EvidenceRecord; url: string } | null>(null);
  const [openingEvidenceId, setOpeningEvidenceId] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const saveVersionRef = useRef(0);
  const submittingRef = useRef(false);
  const onRestoreTimeRef = useRef(onRestoreTime);

  useEffect(() => { onRestoreTimeRef.current = onRestoreTime; }, [onRestoreTime]);

  const locked = status === 'submitted_for_tutor_review' || status === 'accepted';
  const evidenceNames = evidenceFiles.map(file => file.filename);
  const cleanQuestionHtml = useMemo(
    () => questionHtml ? DOMPurify.sanitize(questionHtml) : '',
    [questionHtml],
  );

  const payload = (mode: 'draft' | 'submit'): LearningReflectionSubmissionInput => ({
    learnerKind: kind,
    learnerId,
    learnerName,
    programmeName,
    activityType: 'assignment',
    activityId: componentId,
    activityTitle: title,
    moduleTitle,
    weekTitle,
    plannedOtjh: plannedOtjh == null ? '' : String(plannedOtjh),
    learningReflection: answers.whatYouLearned || answers.assignmentAnswer,
    ksbCodes: ksbMappings.map(mapping => mapping.code),
    ksbWeights: Object.fromEntries(ksbMappings.map(mapping => [mapping.code, Number(mapping.weight) || 0])),
    ksbExplanations: {},
    confidenceBefore: {},
    confidenceAfter: {},
    applicationType: 'assignment_form',
    applicationText: answers.businessImpact,
    evidenceFiles: evidenceNames,
    evidenceConsentConfirmed: true,
    selectedBenefits: [],
    benefitExplanation: answers.businessImpact,
    actualTimeHours: timeSeconds && timeSeconds > 0 ? (timeSeconds / 3600).toFixed(2) : '',
    completedDuringPaidHours: '',
    dateCompleted: mode === 'submit' ? londonDate() : '',
    otjhConfirmed: mode === 'submit',
    signedDeclaration: mode === 'submit',
    qualityScore: 0,
    submissionMode: mode,
    assignmentAnswer: answers.assignmentAnswer,
    whatYouLearned: answers.whatYouLearned,
    businessImpact: answers.businessImpact,
    outsideWorkingHours,
    outsideWorkingHoursConfirmed,
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadLearningReflectionSubmission({
      learnerKind: kind,
      learnerId,
      activityType: 'assignment',
      activityId: componentId,
    })
      .then(submission => {
        if (!active || !submission) return;
        setAnswers({
          assignmentAnswer: submission.assignmentAnswer || '',
          whatYouLearned: submission.whatYouLearned || submission.learningReflection || '',
          businessImpact: submission.businessImpact || submission.benefitExplanation || '',
        });
        setStatus(submission.status || '');
        const storedHours = Number(submission.actualTimeHours);
        if (Number.isFinite(storedHours) && storedHours > 0) onRestoreTimeRef.current(Math.round(storedHours * 3600));
      })
      .catch(error => {
        if (active) setSaveError(error instanceof Error ? error.message : 'Could not load the saved assignment.');
      })
      .finally(() => {
        if (active) {
          loadedRef.current = true;
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, [kind, learnerId, componentId]);

  const saveDraft = async (showSaved = true): Promise<boolean> => {
    if (locked || submittingRef.current) return false;
    const version = ++saveVersionRef.current;
    setSavingDraft(true);
    setSaveError('');
    try {
      const result = await saveLearningReflectionSubmission(payload('draft'));
      if (version !== saveVersionRef.current) return;
      setStatus(result.status || 'draft');
      if (showSaved) setDraftSaved(true);
      return true;
    } catch (error) {
      if (version === saveVersionRef.current) {
        setSaveError(error instanceof Error ? error.message : 'Could not save the assignment draft.');
      }
      return false;
    } finally {
      if (version === saveVersionRef.current) setSavingDraft(false);
    }
  };

  useEffect(() => {
    if (!loadedRef.current || locked) return;
    if (!answers.assignmentAnswer && !answers.whatYouLearned && !answers.businessImpact) return;
    setDraftSaved(false);
    const timeout = window.setTimeout(() => { void saveDraft(false); }, 900);
    return () => window.clearTimeout(timeout);
    // The identifying fields are stable for the lifetime of this wizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers.assignmentAnswer, answers.whatYouLearned, answers.businessImpact, locked]);

  const setAnswer = (key: keyof AssignmentAnswers, value: string) => {
    setAnswers(current => ({ ...current, [key]: value }));
  };

  const currentReady = [
    Boolean(answers.assignmentAnswer.trim()),
    Boolean(answers.whatYouLearned.trim()),
    Boolean(answers.businessImpact.trim()),
  ][step];

  const goNext = async () => {
    if (!currentReady) return;
    if (await saveDraft()) setStep(current => Math.min(2, current + 1));
  };

  const submit = async () => {
    if (locked || submittingProgress) return;
    if (!answers.assignmentAnswer.trim() || !answers.whatYouLearned.trim() || !answers.businessImpact.trim()) {
      setSaveError('Complete all three sections before submitting.');
      return;
    }
    if (!timeSeconds || timeSeconds <= 0) {
      setSaveError('Enter the time spent on this assignment before submitting.');
      return;
    }
    if (outsideWorkingHours && !outsideWorkingHoursConfirmed) {
      setSaveError('Confirm that you completed this assignment outside UK working hours before submitting.');
      return;
    }
    submittingRef.current = true;
    // Invalidate any autosave already in flight so it cannot overwrite the
    // final submitted status with an older draft response.
    saveVersionRef.current += 1;
    setSavingDraft(true);
    setSaveError('');
    try {
      // Persist the complete answers first. The component completion endpoint
      // verifies this server-side, so a client cannot mark an empty assignment
      // complete. Only lock it for tutor review after progress also succeeds.
      await saveLearningReflectionSubmission(payload('draft'));
      await onSubmitProgress(answers);
      const result = await saveLearningReflectionSubmission(payload('submit'));
      setStatus(result.status || 'submitted_for_tutor_review');
      setPreviewOpen(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not submit the assignment.');
    } finally {
      submittingRef.current = false;
      setSavingDraft(false);
    }
  };

  const openEvidence = async (file: EvidenceRecord) => {
    if (file.status !== 'approved') return;
    setOpeningEvidenceId(file.id);
    setSaveError('');
    try {
      const url = await getEvidenceDownloadUrl(kind, learnerId, file.id);
      setEvidencePreview({ file, url });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not open the evidence file.');
    } finally {
      setOpeningEvidenceId(null);
    }
  };

  const closeSubmissionPreview = () => {
    setEvidencePreview(null);
    setPreviewOpen(false);
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-background-200 bg-white p-8 text-center text-sm text-foreground-500">
        <AppIcon className="ri-loader-4-line mr-2 animate-spin" />Loading your saved assignment…
      </div>
    );
  }

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-primary-100 bg-white shadow-sm">
        <div className="border-b border-primary-100 bg-gradient-to-r from-primary-50 to-purple-50 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary-600">Assignment submission</p>
              <h2 className="mt-1 font-heading text-lg font-bold text-foreground-950">{title}</h2>
            </div>
            <div className="flex items-center gap-2">
              {(savingDraft || draftSaved || status === 'draft') && !locked && (
                <span className="text-[11px] font-semibold text-foreground-500">
                  <AppIcon className={savingDraft ? 'ri-loader-4-line mr-1 animate-spin' : 'ri-check-line mr-1 text-emerald-600'} />
                  {savingDraft ? 'Saving…' : 'Draft saved'}
                </span>
              )}
              {locked && (
                <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-[11px] font-bold text-emerald-700">
                  <AppIcon className="ri-checkbox-circle-line mr-1" />Submitted
                </span>
              )}
              {locked && (
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-primary-200 bg-white px-3 py-2 text-xs font-bold text-primary-700 hover:bg-primary-50"
                >
                  <AppIcon className="ri-eye-line" />Preview
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {STEP_META.map((item, index) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setStep(index)}
                className={`rounded-xl border px-3 py-2 text-left transition-colors ${step === index ? 'border-primary-300 bg-white text-primary-800 shadow-sm' : 'border-transparent bg-white/50 text-foreground-500 hover:bg-white'}`}
              >
                <span className="flex items-center gap-2 text-[11px] font-bold">
                  <span className={`grid h-6 w-6 place-items-center rounded-full ${step === index ? 'bg-primary-600 text-white' : 'bg-background-200 text-foreground-500'}`}>{index + 1}</span>
                  <span className="hidden sm:inline">{item.label}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {locked && (
            <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
              This assignment has been submitted for tutor review. Your saved answers and evidence remain available in Preview.
            </div>
          )}

          {step === 0 && (
            <div className="space-y-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary-600">Assignment question</p>
                <div className="mt-2 rounded-xl border border-background-200 bg-background-50 p-4 text-sm leading-6 text-foreground-800">
                  {cleanQuestionHtml ? (
                    <div className="max-w-none [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: cleanQuestionHtml }} />
                  ) : (
                    <p className="whitespace-pre-line">{questionText || 'Your tutor has not added the assignment question yet.'}</p>
                  )}
                </div>
              </div>
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wider text-foreground-600">Your answer <span className="text-red-500">*</span></span>
                <textarea
                  value={answers.assignmentAnswer}
                  onChange={event => setAnswer('assignmentAnswer', event.target.value)}
                  disabled={locked}
                  rows={10}
                  placeholder="Write your answer to the assignment question…"
                  className="mt-2 w-full resize-y rounded-xl border border-background-300 bg-white px-4 py-3 text-sm leading-6 text-foreground-900 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:bg-background-100"
                />
                <span className="mt-1 block text-right text-[10px] text-foreground-400">{wordCount(answers.assignmentAnswer)} words</span>
              </label>
              <div className="rounded-xl border border-background-200 bg-background-50 p-4">
                <AssignmentEvidence
                  kind={kind}
                  learnerId={learnerId}
                  componentId={componentId}
                  trainingPlanDetails={evidenceDetails}
                  onUploaded={onEvidenceChanged}
                  readOnly={locked}
                />
                <p className="mt-3 text-[11px] text-foreground-400">Evidence is optional. Uploaded files are stored securely in Azure.</p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary-600">What You Learned / Achieved KSBs</p>
              <h3 className="mt-2 font-heading text-base font-bold text-foreground-900">What did you learn, and how did this assignment help you achieve the mapped KSBs?</h3>
              {ksbMappings.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {ksbMappings.map(mapping => (
                    <span key={mapping.code} className="rounded-full border border-primary-100 bg-primary-50 px-2.5 py-1 text-[11px] font-bold text-primary-700">
                      {mapping.code}{Number(mapping.weight) > 0 ? ` · ${mapping.weight}%` : ''}
                    </span>
                  ))}
                </div>
              )}
              <textarea
                value={answers.whatYouLearned}
                onChange={event => setAnswer('whatYouLearned', event.target.value)}
                disabled={locked}
                rows={12}
                placeholder="Explain the knowledge, skills or behaviours you developed…"
                className="mt-4 w-full resize-y rounded-xl border border-background-300 bg-white px-4 py-3 text-sm leading-6 text-foreground-900 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:bg-background-100"
              />
              <p className="mt-1 text-right text-[10px] text-foreground-400">{wordCount(answers.whatYouLearned)} words</p>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary-600">Business Impact</p>
              <h3 className="mt-2 font-heading text-base font-bold text-foreground-900">How has this learning benefited your role, workplace or organisation?</h3>
              <textarea
                value={answers.businessImpact}
                onChange={event => setAnswer('businessImpact', event.target.value)}
                disabled={locked}
                rows={12}
                placeholder="Describe the practical impact, improvements or measurable outcomes…"
                className="mt-4 w-full resize-y rounded-xl border border-background-300 bg-white px-4 py-3 text-sm leading-6 text-foreground-900 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:bg-background-100"
              />
              <p className="mt-1 text-right text-[10px] text-foreground-400">{wordCount(answers.businessImpact)} words</p>
              <div className="mt-5 rounded-xl border border-background-200 bg-background-50 p-4">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-foreground-600">Time spent <span className="text-red-500">*</span></p>
                {timeControl}
              </div>
            </div>
          )}

          {saveError && (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{saveError}</p>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-background-200 pt-4">
            <button
              type="button"
              onClick={() => setStep(current => Math.max(0, current - 1))}
              disabled={step === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-background-300 bg-white px-4 py-2.5 text-sm font-semibold text-foreground-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <AppIcon className="ri-arrow-left-line" />Back
            </button>
            {step < 2 ? (
              <button
                type="button"
                onClick={() => void goNext()}
                disabled={!currentReady || locked || savingDraft}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next<AppIcon className="ri-arrow-right-line" />
              </button>
            ) : locked ? (
              <button type="button" onClick={() => setPreviewOpen(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-bold text-white">
                <AppIcon className="ri-eye-line" />Preview submission
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!currentReady || savingDraft || submittingProgress}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <AppIcon className={savingDraft || submittingProgress ? 'ri-loader-4-line animate-spin' : 'ri-send-plane-fill'} />
                {savingDraft || submittingProgress ? 'Submitting…' : 'Submit assignment'}
              </button>
            )}
          </div>
        </div>
      </section>

      {previewOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={closeSubmissionPreview}>
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-background-200 bg-white px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                {evidencePreview && (
                  <button
                    type="button"
                    onClick={() => setEvidencePreview(null)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-background-300 text-foreground-600 hover:bg-background-100"
                    aria-label="Back to submission preview"
                  >
                    <AppIcon className="ri-arrow-left-line" />
                  </button>
                )}
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-wider text-primary-600">{evidencePreview ? 'Evidence preview' : 'Submission preview'}</p>
                  <h2 className="mt-1 truncate font-heading text-lg font-bold text-foreground-950">{evidencePreview ? evidencePreview.file.filename : title}</h2>
                </div>
              </div>
              <button type="button" onClick={closeSubmissionPreview} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-background-100 text-foreground-600 hover:bg-background-200">
                <AppIcon className="ri-close-line" />
              </button>
            </div>
            {evidencePreview ? (
              <div className="min-h-0 flex-1 overflow-auto bg-background-950/95 p-4">
                {(() => {
                  const fileName = evidencePreview.file.filename.toLowerCase();
                  const contentType = (evidencePreview.file.contentType || '').toLowerCase();
                  const isImage = contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(fileName);
                  const isVideo = contentType.startsWith('video/') || /\.(mp4|webm|ogg|mov|m4v)$/.test(fileName);
                  return isImage ? (
                    <img src={evidencePreview.url} alt={evidencePreview.file.filename} className="mx-auto max-h-[72vh] max-w-full rounded-lg object-contain" />
                  ) : isVideo ? (
                    <video src={evidencePreview.url} controls className="mx-auto max-h-[72vh] max-w-full rounded-lg bg-black" />
                  ) : (
                    <iframe title={evidencePreview.file.filename} src={evidencePreview.url} className="h-[72vh] w-full rounded-lg bg-white" />
                  );
                })()}
              </div>
            ) : (
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
                {[
                  ['1. Assignment answer', answers.assignmentAnswer],
                  ['2. What You Learned / Achieved KSBs', answers.whatYouLearned],
                  ['3. Business Impact', answers.businessImpact],
                ].map(([label, value]) => (
                  <section key={label} className="rounded-xl border border-background-200 bg-background-50 p-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-primary-700">{label}</h3>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground-800">{value || 'Not answered yet.'}</p>
                  </section>
                ))}
                <section className="rounded-xl border border-background-200 bg-background-50 p-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary-700">Evidence</h3>
                  {evidenceFiles.length === 0 ? (
                    <p className="mt-3 text-sm text-foreground-500">No evidence files attached.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {evidenceFiles.map(file => (
                        <li key={file.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                          <span className="min-w-0 truncate text-sm font-semibold text-foreground-800"><AppIcon className="ri-attachment-2 mr-2 text-primary-600" />{file.filename}</span>
                          <button type="button" onClick={() => void openEvidence(file)} disabled={file.status !== 'approved' || openingEvidenceId === file.id} className="shrink-0 text-xs font-bold text-primary-700 disabled:text-foreground-300">
                            {openingEvidenceId === file.id ? 'Opening\u2026' : file.status === 'approved' ? 'Preview' : file.status}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                {saveError && (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{saveError}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
