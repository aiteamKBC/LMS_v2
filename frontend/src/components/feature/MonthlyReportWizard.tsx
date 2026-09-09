// ============================================================================
// Monthly report wizard.
//
// Four steps in a modal over the monthly-activity page:
//   1. Review   — the month's figures and the full activity record.
//   2. Reflect  — what the learner learned, plus any documents to attach.
//   3. KSBs     — which of the programme's KSBs they worked on this month.
//   4. Sign     — a last look, then the learner signs the report.
//
// Attachments go through the existing evidence upload pipeline (quarantine ->
// scan -> approved) under a 'monthly-report:YYYY-MM' section ref, so a file
// attached here is scanned and downloadable like any other piece of evidence.
//
// The signature is captured three ways: a saved one from the learner's record,
// the shared SignaturePad (their name in a script face), or an image of their
// own handwriting. All three commit the same image data URL, so the report
// stores and renders them identically.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { uploadEvidence } from '@/api/evidence';
import {
  monthlyReportSectionRef,
  submitMonthlyReport,
  type MonthlyReport,
  type MonthlyReportActivity,
  type MonthlyReportAttachment,
  type MonthlyReportKsb,
  type MonthlyReportMetrics,
} from '@/api/monthlyReports';
import { canOpenAttachment, openMonthlyReportAttachment } from '@/lib/monthlyReportAttachments';
import { SignaturePad } from '@/pages/users/wizard/steps/SignaturePad';
import type { KsbProgress } from '@/utils/learnerJourney';

type Step = 'review' | 'reflect' | 'ksbs' | 'confirm';

const STEPS: { key: Step; label: string; hint: string }[] = [
  { key: 'review', label: 'Review the month', hint: 'Check everything that was recorded.' },
  { key: 'reflect', label: 'What you learned', hint: 'Write your reflection and attach documents.' },
  { key: 'ksbs', label: 'KSBs this month', hint: 'Choose the KSBs from your programme that you worked on.' },
  { key: 'confirm', label: 'Sign and submit', hint: 'Check the report, then sign it.' },
];

const KSB_GROUPS: { key: string; label: string }[] = [
  { key: 'K', label: 'Knowledge' },
  { key: 'S', label: 'Skills' },
  { key: 'B', label: 'Behaviours' },
];

/** How the learner is providing their signature on this report. */
type SignatureMode = 'saved' | 'typed' | 'upload';

// A signature is stored as a base64 data URL, which inflates the raw bytes by
// about 4/3. Capping the picked file well under the server's 400k-character
// limit keeps a legitimate photo of a signature acceptable while rejecting a
// full-resolution camera image before it is read.
const MAX_SIGNATURE_FILE_BYTES = 250 * 1024;

const TYPE_LABELS: Record<string, string> = {
  quiz: 'Quiz',
  video: 'Video',
  learning: 'Learning',
  coaching: 'Coaching',
  review: 'Review',
};

/** A file the learner has picked, and how its upload is going. Upload happens
 *  at submit time, not on pick, so abandoning the wizard leaves nothing behind. */
interface PendingFile {
  file: File;
  error?: string;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatBytes(bytes: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MonthlyReportWizard({
  open,
  onClose,
  onSubmitted,
  learnerKind,
  learnerId,
  learnerName,
  programmeName,
  monthKey,
  monthLabel,
  activities,
  metrics,
  existing,
  programmeKsbs,
  savedSignature,
  savedSignatureName,
}: {
  open: boolean;
  onClose: () => void;
  /** `signatureWasSaved` says whether the learner asked to keep this
   *  signature on their profile, so the caller can update what it offers next
   *  month without refetching. */
  onSubmitted: (report: MonthlyReport, signatureWasSaved: boolean) => void;
  learnerKind: LearnerKind;
  learnerId: string;
  learnerName: string;
  programmeName: string;
  monthKey: string;
  monthLabel: string;
  activities: MonthlyReportActivity[];
  metrics: MonthlyReportMetrics;
  /** The report already on file for this month, when there is one — the wizard
   *  then opens pre-filled and a submit updates it rather than adding a second. */
  existing: MonthlyReport | null;
  /** Every KSB on the learner's programme, with its progress, so they can pick
   *  the ones they worked on this month. */
  programmeKsbs: KsbProgress[];
  /** The learner's reusable signature, when they have saved one. */
  savedSignature: string;
  savedSignatureName: string;
}) {
  const [step, setStep] = useState<Step>('review');
  const [learned, setLearned] = useState('');
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [keptAttachments, setKeptAttachments] = useState<MonthlyReportAttachment[]>([]);
  const [selectedKsbCodes, setSelectedKsbCodes] = useState<string[]>([]);
  const [ksbQuery, setKsbQuery] = useState('');
  const [signature, setSignature] = useState('');
  const [signatureMode, setSignatureMode] = useState<SignatureMode>('typed');
  const [saveSignature, setSaveSignature] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset to a clean first step each time the wizard is opened, seeded from the
  // month's existing report when there is one.
  useEffect(() => {
    if (!open) return;
    setStep('review');
    setLearned(existing?.learnedSummary || '');
    setKeptAttachments(existing?.attachments || []);
    setPending([]);
    setError('');
    setSaving(false);
    setKsbQuery('');
    // Pre-tick what the learner already claimed for this month; failing that,
    // the KSBs their completed activities evidenced — they can add or remove.
    setSelectedKsbCodes(
      existing?.selectedKsbs?.length
        ? existing.selectedKsbs.map((ksb) => ksb.code)
        : (metrics.ksbCodes || []),
    );
    // A saved signature is the default when there is one, so signing is a
    // single click for a learner who has already provided their mark.
    setSignature(savedSignature || '');
    setSignatureMode(savedSignature ? 'saved' : 'typed');
    setSaveSignature(false);
  }, [open, existing, metrics.ksbCodes, savedSignature]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    // The page behind must not scroll while the modal owns the viewport.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, saving, onClose]);

  const grouped = useMemo(() => {
    const groups = new Map<string, MonthlyReportActivity[]>();
    [...activities]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .forEach((activity) => {
        const key = activity.at.slice(0, 10);
        groups.set(key, [...(groups.get(key) || []), activity]);
      });
    return Array.from(groups.entries());
  }, [activities]);

  // Grouped K / S / B, with anything else the programme carries kept in its own
  // bucket rather than dropped.
  const ksbGroups = useMemo(() => {
    const needle = ksbQuery.trim().toLowerCase();
    const matching = programmeKsbs.filter((ksb) => {
      if (!needle) return true;
      return `${ksb.code} ${ksb.description}`.toLowerCase().includes(needle);
    });
    const groups = KSB_GROUPS.map((group) => ({
      ...group,
      items: matching.filter((ksb) => (ksb.type || ksb.code.charAt(0)).toUpperCase() === group.key),
    }));
    const known = new Set(KSB_GROUPS.map((group) => group.key));
    const other = matching.filter(
      (ksb) => !known.has((ksb.type || ksb.code.charAt(0)).toUpperCase()),
    );
    if (other.length) groups.push({ key: 'other', label: 'Other', items: other });
    return groups.filter((group) => group.items.length > 0);
  }, [programmeKsbs, ksbQuery]);

  if (!open) return null;

  const stepIndex = STEPS.findIndex((entry) => entry.key === step);
  const canSubmit = learned.trim().length > 0 && signature.length > 0;
  const selectedKsbSet = new Set(selectedKsbCodes);
  // Snapshot code + description together, so the report keeps reading correctly
  // if the curriculum rewords a KSB after it was claimed.
  const selectedKsbs: MonthlyReportKsb[] = selectedKsbCodes.map((code) => {
    const match = programmeKsbs.find((ksb) => ksb.code === code);
    return {
      code,
      type: match?.type || code.charAt(0),
      description: match?.description || '',
    };
  });

  const toggleKsb = (code: string) => {
    setSelectedKsbCodes((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
    );
  };

  /** Read a picked signature image into a data URL, the same shape the typed
   *  pad produces, so both paths store and render identically. */
  const readSignatureFile = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
      setError('Upload your signature as a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > MAX_SIGNATURE_FILE_BYTES) {
      setError('That signature image is too large. Use one under 250 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result.startsWith('data:image/')) {
        setError('That file could not be read as an image.');
        return;
      }
      setSignature(result);
      setError('');
      // An uploaded mark is worth keeping by default: unlike the typed pad, it
      // cannot be regenerated from the learner's name next month.
      setSaveSignature(true);
    };
    reader.onerror = () => setError('That file could not be read.');
    reader.readAsDataURL(file);
  };

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    // Copy the FileList to a real array HERE, before any state update. A
    // FileList is a live view of the input element: the caller clears
    // `input.value` right after this returns (so re-picking the same file still
    // fires a change), which empties the list. Reading it inside the lazy
    // updater below — which React runs later — would find nothing, and the file
    // would silently never be attached.
    const picked = Array.from(files).map((file) => ({ file }));
    setPending((current) => [...current, ...picked]);
    setError('');
  };

  const openAttachment = async (attachment: MonthlyReportAttachment) => {
    if (openingId) return;
    setOpeningId(attachment.id);
    setError('');
    try {
      await openMonthlyReportAttachment(learnerKind, learnerId, attachment);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'That document could not be opened.');
    } finally {
      setOpeningId(null);
    }
  };

  const submit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError('');

    // Upload first: a report should never claim an attachment that failed to
    // store. A failed upload stops the submit and is reported against the file.
    const uploaded: MonthlyReportAttachment[] = [];
    const stillPending: PendingFile[] = [];
    for (const entry of pending) {
      try {
        const result = await uploadEvidence(
          learnerKind,
          learnerId,
          entry.file,
          monthlyReportSectionRef(monthKey),
          { evidenceDescription: `Monthly report — ${monthLabel}` },
        );
        uploaded.push({
          id: result.id,
          filename: result.filename || entry.file.name,
          contentType: entry.file.type,
          sizeBytes: entry.file.size,
          status: result.status,
        });
      } catch (uploadError) {
        stillPending.push({
          file: entry.file,
          error: uploadError instanceof Error ? uploadError.message : 'This file could not be uploaded.',
        });
      }
    }

    if (stillPending.length) {
      setPending(stillPending);
      setKeptAttachments((current) => [...current, ...uploaded]);
      setError('Some documents could not be uploaded. Remove them or try again.');
      setSaving(false);
      return;
    }

    try {
      const report = await submitMonthlyReport(learnerKind, learnerId, {
        monthKey,
        monthLabel,
        learnedSummary: learned.trim(),
        learnerName,
        programmeName,
        activitySnapshot: activities,
        summaryMetrics: metrics,
        attachments: [...keptAttachments, ...uploaded],
        selectedKsbs,
        signature,
        signedName: learnerName,
        // A saved signature is already on the record; only re-save when the
        // learner produced a new one and asked to keep it.
        saveSignature: saveSignature && signatureMode !== 'saved',
      });
      setPending([]);
      onSubmitted(report, saveSignature && signatureMode !== 'saved');
    } catch (submitError) {
      // The files are stored, so keep them on the row for a retry rather than
      // making the learner pick them again.
      setKeptAttachments((current) => [...current, ...uploaded]);
      setPending([]);
      setError(submitError instanceof Error ? submitError.message : 'Your report could not be submitted.');
    } finally {
      setSaving(false);
    }
  };

  const summaryCards = [
    { label: 'Total events', value: String(metrics.totalEvents ?? activities.length), icon: 'ri-pulse-line', tint: 'bg-violet-50 text-violet-700' },
    { label: 'Active days', value: String(metrics.activeDays ?? 0), icon: 'ri-calendar-check-line', tint: 'bg-emerald-50 text-emerald-700' },
    { label: 'Time logged', value: metrics.loggedLabel || '0m', icon: 'ri-time-line', tint: 'bg-amber-50 text-amber-700' },
    { label: 'KSBs evidenced', value: String(metrics.ksbCount ?? 0), icon: 'ri-award-line', tint: 'bg-pink-50 text-pink-700' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-primary-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="monthly-report-title"
        className="flex h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-background-50 shadow-2xl sm:h-[88vh] sm:rounded-3xl"
      >
        {/* ── Header + step rail ── */}
        <header className="shrink-0 bg-gradient-to-br from-[#1c0736] via-[#2d0b57] to-[#54208a] px-4 py-4 text-white sm:px-6 sm:py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-secondary-200">
                Monthly report · {monthLabel}
              </p>
              <h2 id="monthly-report-title" className="mt-1 font-heading text-lg font-bold sm:text-xl">
                {STEPS[stepIndex].label}
              </h2>
              <p className="mt-1 text-xs text-white/65">{STEPS[stepIndex].hint}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              aria-label="Close the monthly report"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-40"
            >
              <AppIcon className="ri-close-line text-lg"></AppIcon>
            </button>
          </div>
          <ol className="mt-4 flex items-center gap-1.5">
            {STEPS.map((entry, index) => (
              <li key={entry.key} className="flex flex-1 items-center gap-1.5">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    index < stepIndex
                      ? 'bg-emerald-400 text-emerald-950'
                      : index === stepIndex
                        ? 'bg-white text-primary-900'
                        : 'bg-white/15 text-white/60'
                  }`}
                >
                  {index < stepIndex ? <AppIcon className="ri-check-line text-xs"></AppIcon> : index + 1}
                </span>
                <span className={`h-1 flex-1 rounded-full ${index < stepIndex ? 'bg-emerald-400' : 'bg-white/15'}`}></span>
              </li>
            ))}
          </ol>
        </header>

        {/* ── Step body ── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {step === 'review' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {summaryCards.map((card) => (
                  <div key={card.label} className="rounded-2xl border border-foreground-200/70 bg-background-50 p-3">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${card.tint}`}>
                      <AppIcon className={card.icon}></AppIcon>
                    </span>
                    <p className="mt-2 text-lg font-bold text-foreground-900">{card.value}</p>
                    <p className="text-[11px] text-foreground-500">{card.label}</p>
                  </div>
                ))}
              </div>

              {metrics.ksbCodes?.length ? (
                <div className="rounded-2xl border border-secondary-100 bg-secondary-50/60 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-secondary-700">KSBs evidenced this month</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {metrics.ksbCodes.map((code) => (
                      <span key={code} className="rounded-md border border-secondary-200 bg-background-50 px-1.5 py-0.5 text-[11px] font-semibold text-secondary-700">
                        {code}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <section>
                <h3 className="text-xs font-bold uppercase tracking-wide text-foreground-400">Everything recorded in {monthLabel}</h3>
                {grouped.length === 0 ? (
                  <p className="mt-3 rounded-2xl border border-dashed border-foreground-300 px-4 py-8 text-center text-sm text-foreground-500">
                    Nothing was recorded for this month yet.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {grouped.map(([day, dayActivities]) => (
                      <div key={day} className="rounded-2xl border border-foreground-200/70 bg-background-50 p-3">
                        <p className="text-xs font-bold text-foreground-800">
                          {new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', {
                            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                          })}
                        </p>
                        <ul className="mt-2 space-y-2">
                          {dayActivities.map((activity, index) => (
                            <li key={`${activity.at}-${index}`} className="border-l-2 border-primary-100 pl-3">
                              <div className="flex flex-wrap items-baseline gap-x-2">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-primary-700">
                                  {TYPE_LABELS[activity.type] || activity.type}
                                </span>
                                <span className="text-xs text-foreground-400">{activity.action}</span>
                              </div>
                              <p className="text-sm font-semibold text-foreground-900">{activity.title}</p>
                              {activity.detail && <p className="text-xs text-foreground-500">{activity.detail}</p>}
                              <p className="mt-0.5 text-[11px] text-foreground-400">
                                {[
                                  activity.module,
                                  activity.week,
                                  activity.reportedTime ? `Logged ${activity.reportedTime}` : null,
                                  activity.ksbs?.length ? activity.ksbs.join(', ') : null,
                                ].filter(Boolean).join(' · ')}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {step === 'reflect' && (
            <div className="space-y-5">
              <div>
                <label htmlFor="monthly-report-learned" className="text-sm font-bold text-foreground-900">
                  What have you learned this month?
                </label>
                <p className="mt-1 text-xs text-foreground-500">
                  Write in your own words: the skills you built, how you applied them at work, and what you want to
                  work on next.
                </p>
                <textarea
                  id="monthly-report-learned"
                  value={learned}
                  onChange={(event) => setLearned(event.target.value)}
                  rows={9}
                  placeholder="This month I learned…"
                  className="mt-2 w-full resize-none rounded-2xl border border-foreground-200 bg-background-50 p-3 text-sm leading-6 outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100"
                />
                <p className="mt-1 text-right text-[11px] text-foreground-400">{learned.trim().length} characters</p>
              </div>

              <div>
                <p className="text-sm font-bold text-foreground-900">Attach any related documents</p>
                <p className="mt-1 text-xs text-foreground-500">
                  Optional. PDF, Word, PowerPoint, images or MP4, up to 50 MB each. Files are scanned before they are
                  stored.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    addFiles(event.target.files);
                    // Clear the input so picking the same file again still fires a change.
                    event.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving}
                  className="mt-2 inline-flex items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-4 py-2.5 text-sm font-semibold text-primary-800 transition hover:bg-primary-100 disabled:opacity-50"
                >
                  <AppIcon className="ri-upload-2-line"></AppIcon>Choose files
                </button>

                {(keptAttachments.length > 0 || pending.length > 0) && (
                  <ul className="mt-3 space-y-2">
                    {keptAttachments.map((attachment) => {
                      const openable = canOpenAttachment(attachment);
                      return (
                        <li key={attachment.id} className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2.5">
                          <AppIcon className="ri-checkbox-circle-line shrink-0 text-emerald-600"></AppIcon>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold text-foreground-800">{attachment.filename}</span>
                            <span className="text-[11px] text-emerald-700">
                              {openable ? 'Attached to this report' : 'Security scan in progress'}
                            </span>
                          </span>
                          {openable && (
                            <button
                              type="button"
                              onClick={() => void openAttachment(attachment)}
                              disabled={openingId === attachment.id}
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-background-50 px-2 py-1 text-[11px] font-bold text-primary-700 shadow-sm hover:bg-white disabled:opacity-50"
                            >
                              <AppIcon className={openingId === attachment.id ? 'ri-loader-4-line animate-spin' : 'ri-external-link-line'}></AppIcon>
                              Open
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setKeptAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                            disabled={saving}
                            className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-foreground-500 hover:bg-background-200 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </li>
                      );
                    })}
                    {pending.map((entry, index) => (
                      <li
                        key={`${entry.file.name}-${index}`}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                          entry.error ? 'border-red-200 bg-red-50/70' : 'border-foreground-200 bg-background-100'
                        }`}
                      >
                        <AppIcon className={`shrink-0 ${entry.error ? 'ri-error-warning-line text-red-600' : 'ri-file-line text-foreground-500'}`}></AppIcon>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-foreground-800">{entry.file.name}</span>
                          <span className={`text-[11px] ${entry.error ? 'text-red-700' : 'text-foreground-400'}`}>
                            {entry.error || `${formatBytes(entry.file.size)} · uploads when you submit`}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setPending((current) => current.filter((_, i) => i !== index))}
                          disabled={saving}
                          className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-foreground-500 hover:bg-background-200 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {step === 'ksbs' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-primary-50/70 px-3 py-2.5">
                <p className="text-xs text-primary-800">
                  <AppIcon className="ri-information-line mr-1.5"></AppIcon>
                  {programmeKsbs.length
                    ? `${selectedKsbCodes.length} of ${programmeKsbs.length} selected. The ones your completed activities already evidenced are ticked for you.`
                    : 'No KSBs are mapped on your programme yet, so there is nothing to choose here.'}
                </p>
                {selectedKsbCodes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedKsbCodes([])}
                    className="shrink-0 rounded-lg bg-background-50 px-2.5 py-1 text-[11px] font-bold text-primary-700 shadow-sm hover:bg-white"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {programmeKsbs.length > 0 && (
                <label className="relative block">
                  <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400"></AppIcon>
                  <input
                    value={ksbQuery}
                    onChange={(event) => setKsbQuery(event.target.value)}
                    placeholder="Search KSBs by code or description…"
                    className="h-10 w-full rounded-xl border border-foreground-200 bg-background-50 pl-9 pr-3 text-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100"
                  />
                </label>
              )}

              {programmeKsbs.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-foreground-300 px-4 py-8 text-center text-sm text-foreground-500">
                  Your programme has no KSBs mapped yet. You can still submit your report.
                </p>
              ) : ksbGroups.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-foreground-300 px-4 py-8 text-center text-sm text-foreground-500">
                  No KSB matches “{ksbQuery}”.
                </p>
              ) : (
                ksbGroups.map((group) => (
                  <section key={group.key}>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-foreground-400">
                      {group.label} <span className="text-foreground-300">({group.items.length})</span>
                    </h3>
                    <ul className="mt-2 space-y-1.5">
                      {group.items.map((ksb) => {
                        const checked = selectedKsbSet.has(ksb.code);
                        return (
                          <li key={ksb.code}>
                            <label
                              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                                checked
                                  ? 'border-primary-300 bg-primary-50/70'
                                  : 'border-foreground-200 bg-background-50 hover:border-primary-200'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleKsb(ksb.code)}
                                className="mt-0.5 h-4 w-4 shrink-0 accent-primary-700"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-bold text-foreground-900">{ksb.code}</span>
                                  {/* Progress from the plan, so the learner can see why a
                                      KSB was pre-ticked rather than guessing. */}
                                  {ksb.totalCount > 0 && (
                                    <span className="rounded-md bg-background-100 px-1.5 py-0.5 text-[10px] font-semibold text-foreground-600">
                                      {ksb.doneCount}/{ksb.totalCount} activities · {Math.round(ksb.pct)}%
                                    </span>
                                  )}
                                </span>
                                {ksb.description && (
                                  <span className="mt-0.5 block text-xs leading-5 text-foreground-600">{ksb.description}</span>
                                )}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))
              )}
            </div>
          )}

          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">Report for</p>
                <p className="mt-1 text-base font-bold text-foreground-900">{monthLabel}</p>
                <p className="text-xs text-foreground-500">{learnerName}{programmeName ? ` · ${programmeName}` : ''}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-background-200 pt-3 text-xs sm:grid-cols-4">
                  {summaryCards.map((card) => (
                    <div key={card.label}>
                      <dt className="text-foreground-400">{card.label}</dt>
                      <dd className="font-bold text-foreground-900">{card.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">What you learned</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground-800">{learned.trim() || '—'}</p>
              </div>

              <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">
                  KSBs worked on ({selectedKsbs.length})
                </p>
                {selectedKsbs.length === 0 ? (
                  <p className="mt-2 text-sm text-foreground-500">No KSBs selected for this month.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedKsbs.map((ksb) => (
                      <span
                        key={ksb.code}
                        title={ksb.description || undefined}
                        className="rounded-md border border-secondary-200 bg-secondary-50 px-2 py-0.5 text-[11px] font-semibold text-secondary-700"
                      >
                        {ksb.code}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">
                  Documents ({keptAttachments.length + pending.length})
                </p>
                {keptAttachments.length + pending.length === 0 ? (
                  <p className="mt-2 text-sm text-foreground-500">No documents attached.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm text-foreground-800">
                    {[...keptAttachments.map((a) => a.filename), ...pending.map((p) => p.file.name)].map((name, index) => (
                      <li key={`${name}-${index}`} className="flex items-center gap-2">
                        <AppIcon className="ri-file-line text-foreground-400"></AppIcon>
                        <span className="truncate">{name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* ── Sign the report ── */}
              <div className="rounded-2xl border border-primary-200 bg-primary-50/40 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-primary-700">
                  Your signature <span className="text-red-600">*</span>
                </p>
                <p className="mt-1 text-xs text-foreground-600">
                  By signing you confirm this is a true record of your month. Your name, signature and the date are
                  stored with the report.
                </p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {savedSignature && (
                    <button
                      type="button"
                      onClick={() => { setSignatureMode('saved'); setSignature(savedSignature); setError(''); }}
                      className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                        signatureMode === 'saved'
                          ? 'bg-primary-900 text-white shadow-sm'
                          : 'bg-background-100 text-foreground-600 hover:bg-background-200'
                      }`}
                    >
                      <AppIcon className="ri-bookmark-line mr-1"></AppIcon>Use saved signature
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setSignatureMode('typed'); setSignature(''); setError(''); }}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                      signatureMode === 'typed'
                        ? 'bg-primary-900 text-white shadow-sm'
                        : 'bg-background-100 text-foreground-600 hover:bg-background-200'
                    }`}
                  >
                    <AppIcon className="ri-quill-pen-line mr-1"></AppIcon>Sign with my name
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSignatureMode('upload'); setSignature(''); setError(''); }}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                      signatureMode === 'upload'
                        ? 'bg-primary-900 text-white shadow-sm'
                        : 'bg-background-100 text-foreground-600 hover:bg-background-200'
                    }`}
                  >
                    <AppIcon className="ri-upload-2-line mr-1"></AppIcon>Upload my signature
                  </button>
                </div>

                <div className="mt-3">
                  {signatureMode === 'typed' && !signature && (
                    <SignaturePad
                      signatoryName={learnerName}
                      onCommit={(dataUrl) => { setSignature(dataUrl); setError(''); }}
                      onCancel={() => setSignature('')}
                    />
                  )}

                  {signatureMode === 'upload' && !signature && (
                    <div>
                      <input
                        ref={signatureInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(event) => {
                          readSignatureFile(event.target.files?.[0]);
                          event.target.value = '';
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => signatureInputRef.current?.click()}
                        className="inline-flex items-center gap-2 rounded-xl border border-primary-200 bg-background-50 px-4 py-2.5 text-sm font-semibold text-primary-800 transition hover:bg-primary-50"
                      >
                        <AppIcon className="ri-image-add-line"></AppIcon>Choose a signature image
                      </button>
                      <p className="mt-1.5 text-[11px] text-foreground-500">
                        A photo or scan of your handwritten signature. PNG, JPEG or WebP, under 250 KB.
                      </p>
                    </div>
                  )}

                  {signature && (
                    <div className="rounded-xl border border-foreground-200 bg-background-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold text-emerald-700">
                          <AppIcon className="ri-checkbox-circle-line mr-1"></AppIcon>
                          {signatureMode === 'saved' ? 'Your saved signature' : 'Signed'}
                        </p>
                        <button
                          type="button"
                          onClick={() => { setSignature(''); if (signatureMode === 'saved') setSignatureMode('typed'); }}
                          className="rounded-lg px-2 py-1 text-[11px] font-semibold text-foreground-500 hover:bg-background-200"
                        >
                          Sign differently
                        </button>
                      </div>
                      <img
                        src={signature}
                        alt={`Signature of ${savedSignatureName || learnerName}`}
                        className="mt-2 max-h-20 w-auto max-w-full object-contain"
                      />
                      <p className="mt-1.5 border-t border-background-200 pt-1.5 text-[11px] text-foreground-500">
                        {learnerName} · {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </p>
                    </div>
                  )}
                </div>

                {signature && signatureMode !== 'saved' && (
                  <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-foreground-700">
                    <input
                      type="checkbox"
                      checked={saveSignature}
                      onChange={(event) => setSaveSignature(event.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-primary-700"
                    />
                    <span>
                      Save this signature to my profile so I can reuse it next time.
                      {savedSignature ? ' This replaces the one already saved.' : ''}
                    </span>
                  </label>
                )}
              </div>

              <p className="rounded-2xl bg-primary-50/70 px-4 py-3 text-xs leading-5 text-primary-800">
                <AppIcon className="ri-information-line mr-1.5"></AppIcon>
                Submitting saves this month&rsquo;s activity record alongside your reflection, so the report you
                download later always matches what you see here. You can update this month&rsquo;s report by opening
                the wizard again.
              </p>
            </div>
          )}

          {error && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700">
              <AppIcon className="ri-error-warning-line mt-0.5 shrink-0"></AppIcon>
              <span>{error}</span>
            </p>
          )}
        </div>

        {/* ── Footer navigation ── */}
        <footer className="shrink-0 border-t border-foreground-200/70 bg-background-100/80 px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => (stepIndex === 0 ? onClose() : setStep(STEPS[stepIndex - 1].key))}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground-600 transition hover:bg-background-200 disabled:opacity-50"
            >
              <AppIcon className={stepIndex === 0 ? 'ri-close-line' : 'ri-arrow-left-line'}></AppIcon>
              {stepIndex === 0 ? 'Cancel' : 'Back'}
            </button>

            {step === 'confirm' ? (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit || saving}
                title={!signature ? 'Sign the report to submit it' : undefined}
                className="inline-flex items-center gap-2 rounded-xl bg-primary-900 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary-800 disabled:opacity-50"
              >
                <AppIcon className={saving ? 'ri-loader-4-line animate-spin' : 'ri-send-plane-line'}></AppIcon>
                {saving ? 'Submitting…' : existing ? 'Update my report' : 'Submit my report'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStep(STEPS[stepIndex + 1].key)}
                disabled={step === 'reflect' && !learned.trim()}
                title={step === 'reflect' && !learned.trim() ? 'Write what you learned to continue' : undefined}
                className="inline-flex items-center gap-2 rounded-xl bg-primary-900 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary-800 disabled:opacity-50"
              >
                Continue<AppIcon className="ri-arrow-right-line"></AppIcon>
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
