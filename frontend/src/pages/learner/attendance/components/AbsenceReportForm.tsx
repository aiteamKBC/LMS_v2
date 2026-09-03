import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchAbsenceReports,
  submitAbsenceReport,
  type LearnerAbsenceReport,
  type MissedAttendanceSession,
} from '@/api/absenceReports';
import { useMyLearner } from '@/hooks/useMyLearner';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState } from '@/components/ui/EmptyState';

const REASONS = [
  { value: 'illness', label: 'Illness or medical appointment', icon: 'ri-heart-pulse-line' },
  { value: 'emergency', label: 'Family or personal emergency', icon: 'ri-alarm-warning-line' },
  { value: 'travel', label: 'Travel disruption', icon: 'ri-bus-line' },
  { value: 'technical', label: 'Technical issue', icon: 'ri-wifi-off-line' },
  { value: 'other', label: 'Other reason', icon: 'ri-more-line' },
];

const statusClass: Record<string, string> = {
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'catch-up complete': 'bg-primary-50 text-primary-700 border-primary-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  declined: 'bg-red-50 text-red-700 border-red-200',
};

function displayDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface EvidencePreview {
  title: string;
  objectUrl: string;
  isPdf: boolean;
}

export interface AbsenceReportFormProps {
  /** Preselect the missed session that matches this date + title, once loaded. */
  preselectMatch?: { dateIso: string; title: string } | null;
  /** Called once a report has been saved, in addition to the inline confirmation. */
  onSubmitted?: (report: LearnerAbsenceReport) => void;
  /** Renders the supporting "What happens next" + safeguarding callout. Off by default for compact (drawer) use. */
  showGuidance?: boolean;
  /** Renders the "Previous reports" list. Defaults to true. */
  showHistory?: boolean;
}

export default function AbsenceReportForm({
  preselectMatch = null,
  onSubmitted,
  showGuidance = false,
  showHistory = true,
}: AbsenceReportFormProps) {
  const myLearner = useMyLearner();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sessionId, setSessionId] = useState('');
  const [reasonType, setReasonType] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [explanation, setExplanation] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [selectedFilePreviewUrl, setSelectedFilePreviewUrl] = useState('');
  const [fileError, setFileError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedReport, setSubmittedReport] = useState<LearnerAbsenceReport | null>(null);
  const [reports, setReports] = useState<LearnerAbsenceReport[]>([]);
  const [missedSessions, setMissedSessions] = useState<MissedAttendanceSession[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [requestError, setRequestError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [evidencePreview, setEvidencePreview] = useState<EvidencePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [didPreselect, setDidPreselect] = useState(false);

  const selectedSession = useMemo(
    () => missedSessions.find((session) => session.id === sessionId),
    [missedSessions, sessionId],
  );
  const availableSessions = useMemo(() => {
    const reportedSessions = new Set(
      reports
        .filter((report) => !['declined', 'rejected'].includes(report.status.trim().toLowerCase()))
        .map((report) => `${report.sessionDate}|${report.sessionTitle.trim().toLowerCase()}`),
    );
    return missedSessions.filter(
      (session) => !reportedSessions.has(`${session.dateIso}|${session.title.trim().toLowerCase()}`),
    );
  }, [missedSessions, reports]);
  const hasReason = Boolean(reasonType && (reasonType !== 'other' || otherReason.trim()));
  const canUploadEvidence = Boolean(sessionId && hasReason);
  const canSubmit = Boolean(sessionId && hasReason && (explanation.trim() || file));
  const resolvedCount = reports.filter((report) => report.status !== 'Pending').length;

  useEffect(() => {
    let cancelled = false;
    setReportsLoading(true);
    fetchAbsenceReports(myLearner.kind, myLearner.id)
      .then((data) => {
        if (!cancelled) {
          setReports(data.results);
          setMissedSessions(data.missedSessions);
        }
      })
      .catch((error: unknown) => { if (!cancelled) setRequestError(error instanceof Error ? error.message : 'Could not load reports.'); })
      .finally(() => { if (!cancelled) setReportsLoading(false); });
    return () => { cancelled = true; };
  }, [myLearner.kind, myLearner.id]);

  // Preselect the missed session a caller opened this form for (e.g. from a
  // row in the attendance history) once the real session list has loaded.
  useEffect(() => {
    if (didPreselect || reportsLoading || !preselectMatch) return;
    const match = missedSessions.find(
      (session) => session.dateIso === preselectMatch.dateIso
        && session.title.trim().toLowerCase() === preselectMatch.title.trim().toLowerCase(),
    );
    if (match) setSessionId(match.id);
    setDidPreselect(true);
  }, [didPreselect, reportsLoading, preselectMatch, missedSessions]);

  useEffect(() => {
    if (!file) {
      setSelectedFilePreviewUrl('');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(file);
    setSelectedFilePreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const selectFile = (nextFile?: File) => {
    setFileError('');
    if (!nextFile) return;
    const supported = nextFile.type.startsWith('image/') || nextFile.type === 'application/pdf';
    if (!supported) {
      setFileError('Please upload an image or PDF file.');
      return;
    }
    if (nextFile.size > 10 * 1024 * 1024) {
      setFileError('The file must be smaller than 10 MB.');
      return;
    }
    setFile(nextFile);
  };

  const resetForm = () => {
    setSessionId('');
    setReasonType('');
    setOtherReason('');
    setExplanation('');
    setFile(null);
    setFileError('');
    setSubmitted(false);
    setSubmittedReport(null);
    setRequestError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !selectedSession || submitting) return;
    setSubmitting(true);
    setRequestError('');
    const payload = new FormData();
    payload.append('sessionTitle', selectedSession.title);
    payload.append('sessionDate', selectedSession.dateIso);
    payload.append('sessionTime', selectedSession.startTime);
    payload.append('reasonCategory', reasonType);
    payload.append('otherReason', otherReason.trim());
    payload.append('explanation', explanation.trim());
    if (file) payload.append('evidence', file);
    try {
      const created = await submitAbsenceReport(myLearner.kind, myLearner.id, payload);
      setReports((current) => [created, ...current]);
      setSubmittedReport(created);
      setSubmitted(true);
      onSubmitted?.(created);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Could not submit the absence report.');
    } finally {
      setSubmitting(false);
    }
  };

  const closeEvidencePreview = () => {
    if (evidencePreview?.objectUrl.startsWith('blob:')) {
      URL.revokeObjectURL(evidencePreview.objectUrl);
    }
    setEvidencePreview(null);
    setPreviewLoading(false);
    setPreviewError('');
  };

  const openEvidencePreview = (report: LearnerAbsenceReport) => {
    if (!report.evidenceUrl) return;
    if (evidencePreview?.objectUrl.startsWith('blob:')) {
      URL.revokeObjectURL(evidencePreview.objectUrl);
    }
    const isPdf = /\.pdf(?:\?|$)/i.test(report.evidenceUrl);
    setEvidencePreview({
      title: `${report.reference} - ${report.sessionTitle}`,
      objectUrl: report.evidenceUrl,
      isPdf,
    });
    setPreviewLoading(false);
    setPreviewError('');
  };

  const openSelectedFilePreview = () => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    if (evidencePreview?.objectUrl.startsWith('blob:')) {
      URL.revokeObjectURL(evidencePreview.objectUrl);
    }
    setPreviewError('');
    setPreviewLoading(false);
    setEvidencePreview({
      title: file.name,
      objectUrl,
      isPdf: file.type === 'application/pdf',
    });
  };

  return (
    <div className="space-y-4">
      {submitted ? (
        <Panel className="mx-auto max-w-2xl text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
            <AppIcon className="ri-check-line text-2xl text-emerald-600" />
          </span>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-600">Report submitted</p>
          <h2 className="mb-2 text-[16px] font-semibold text-foreground-900">Thanks for letting us know</h2>
          <p className="mx-auto mb-5 max-w-lg text-[13px] leading-6 text-foreground-500">
            Your report for <strong className="text-foreground-800">{submittedReport?.sessionTitle}</strong> has been saved and sent to your coach and tutor for review.
          </p>
          <div className="mx-auto mb-5 grid max-w-xl gap-3 rounded-xl bg-background-100/70 p-4 text-left sm:grid-cols-2">
            <div><p className="text-[10px] uppercase tracking-wide text-foreground-400">Reference</p><p className="text-[13px] font-semibold text-foreground-800">{submittedReport?.reference}</p></div>
            <div><p className="text-[10px] uppercase tracking-wide text-foreground-400">Current status</p><p className="text-[13px] font-semibold text-amber-600">Pending review</p></div>
            <div><p className="text-[10px] uppercase tracking-wide text-foreground-400">Session</p><p className="text-[13px] font-semibold text-foreground-800">{submittedReport ? displayDate(submittedReport.sessionDate) : ''}</p></div>
            <div><p className="text-[10px] uppercase tracking-wide text-foreground-400">Evidence</p><p className="truncate text-[13px] font-semibold text-foreground-800">{file?.name || 'Written explanation'}</p></div>
          </div>
          <button type="button" onClick={resetForm} className="rounded-lg border border-foreground-200 bg-background-50 px-4 py-2.5 text-[13px] font-semibold text-foreground-600 transition hover:bg-background-100">
            Submit another report
          </button>
        </Panel>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <Panel className="space-y-5">
            <SectionHeader title="Absence details" description="Fields marked with * are required" icon="ri-edit-box-line" />

            <div>
              <label htmlFor="missed-session" className="mb-2 block text-[13px] font-semibold text-foreground-700">Missed session *</label>
              <select id="missed-session" value={sessionId} onChange={(event) => setSessionId(event.target.value)} required disabled={reportsLoading || availableSessions.length === 0} className="w-full rounded-xl border border-foreground-200 bg-background-50 px-3.5 py-3 text-[13px] text-foreground-800 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:bg-background-100 disabled:text-foreground-400">
                <option value="">{reportsLoading ? 'Loading missed sessions...' : availableSessions.length === 0 ? 'All missed sessions have been reported' : 'Choose the session you missed'}</option>
                {availableSessions.map((session) => <option key={session.id} value={session.id}>{displayDate(session.dateIso)} - {session.title}</option>)}
              </select>
              {selectedSession && (
                <div className="mt-3 grid gap-2 rounded-xl border border-primary-100 bg-primary-50/60 p-3 sm:grid-cols-3">
                  <div className="flex items-center gap-2 text-[12px] text-foreground-600"><AppIcon className="ri-time-line text-primary-500" />{selectedSession.startTime}{selectedSession.endTime ? ` - ${selectedSession.endTime}` : ''}</div>
                  <div className="flex items-center gap-2 text-[12px] text-foreground-600"><AppIcon className="ri-user-star-line text-primary-500" />{selectedSession.coach || 'Coach not assigned'}</div>
                  <div className="flex items-center gap-2 text-[12px] text-foreground-600"><AppIcon className="ri-book-open-line text-primary-500" />{selectedSession.module || selectedSession.sessionType.replaceAll('_', ' ')}</div>
                </div>
              )}
            </div>

            <fieldset>
              <legend className="mb-2 block text-[13px] font-semibold text-foreground-700">Main reason *</legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {REASONS.map((reason) => (
                  <label key={reason.value} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-[12px] font-medium transition ${reasonType === reason.value ? 'border-primary-400 bg-primary-50 text-primary-700 ring-1 ring-primary-200' : 'border-foreground-200 bg-background-50 text-foreground-600 hover:border-primary-200'}`}>
                    <input type="radio" name="reason" value={reason.value} checked={reasonType === reason.value} onChange={(event) => setReasonType(event.target.value)} className="sr-only" />
                    <AppIcon className={`${reason.icon} text-base ${reasonType === reason.value ? 'text-primary-600' : 'text-foreground-400'}`} />
                    <span>{reason.label}</span>
                    {reasonType === reason.value && <AppIcon className="ri-check-line ml-auto text-primary-600" />}
                  </label>
                ))}
              </div>
              {reasonType === 'other' && (
                <div className="mt-3 rounded-xl border border-primary-200 bg-primary-50/40 p-3.5">
                  <label htmlFor="other-absence-reason" className="mb-2 block text-[12px] font-semibold text-foreground-700">
                    Please specify the reason *
                  </label>
                  <input
                    id="other-absence-reason"
                    type="text"
                    value={otherReason}
                    onChange={(event) => setOtherReason(event.target.value)}
                    maxLength={120}
                    required
                    autoFocus
                    placeholder="Type your reason here..."
                    className="w-full rounded-lg border border-foreground-200 bg-background-50 px-3.5 py-2.5 text-[13px] text-foreground-800 outline-none transition placeholder:text-foreground-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                  />
                  <p className="mt-1.5 text-right text-[10px] text-foreground-400">{otherReason.length}/120</p>
                </div>
              )}
            </fieldset>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="absence-explanation" className="text-[13px] font-semibold text-foreground-700">Written explanation</label>
                <span className="text-[11px] text-foreground-400">{explanation.length}/600</span>
              </div>
              <textarea id="absence-explanation" value={explanation} onChange={(event) => setExplanation(event.target.value)} maxLength={600} rows={4} required={!file} placeholder="Tell your coach what happened and anything they should know..." className="w-full resize-none rounded-xl border border-foreground-200 bg-background-50 px-3.5 py-3 text-[13px] leading-6 text-foreground-800 outline-none transition placeholder:text-foreground-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
              <p className="mt-1.5 text-[11px] text-foreground-400">Add an explanation or attach evidence below. You can provide both.</p>
            </div>

            <div>
              <p className="mb-2 text-[13px] font-semibold text-foreground-700">Supporting evidence <span className="font-normal text-foreground-400">(optional)</span></p>
              {!file ? (
                <button
                  type="button"
                  disabled={!canUploadEvidence}
                  onClick={() => { if (canUploadEvidence) fileInputRef.current?.click(); }}
                  onDragOver={(event) => { event.preventDefault(); if (canUploadEvidence) setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => { event.preventDefault(); setDragging(false); if (canUploadEvidence) selectFile(event.dataTransfer.files[0]); }}
                  className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition ${!canUploadEvidence ? 'cursor-not-allowed border-foreground-200 bg-background-100/70 opacity-60' : dragging ? 'border-primary-400 bg-primary-50' : 'border-foreground-300 bg-background-100/40 hover:border-primary-300 hover:bg-primary-50/40'}`}
                >
                  <span className={`mb-2 flex h-11 w-11 items-center justify-center rounded-xl ${canUploadEvidence ? 'bg-primary-100' : 'bg-background-200'}`}><AppIcon className={`${canUploadEvidence ? 'ri-upload-cloud-2-line text-primary-600' : 'ri-lock-line text-foreground-400'} text-xl`} /></span>
                  <span className="text-[13px] font-semibold text-foreground-700">{canUploadEvidence ? 'Drop an image here or click to browse' : 'Complete the session and reason above first'}</span>
                  <span className="mt-1 text-[11px] text-foreground-400">{canUploadEvidence ? 'JPG, PNG or PDF - maximum 10 MB' : 'Evidence upload will unlock automatically'}</span>
                </button>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5">
                  {file.type.startsWith('image/') && selectedFilePreviewUrl ? (
                    <img src={selectedFilePreviewUrl} alt="Selected evidence preview" className="h-14 w-14 shrink-0 rounded-lg border border-white object-cover shadow-sm" />
                  ) : (
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-white text-xl text-red-500 shadow-sm"><AppIcon className="ri-file-pdf-2-line" /></span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-foreground-800">{file.name}</p>
                    <p className="text-[11px] text-foreground-400">{(file.size / 1024 / 1024).toFixed(2)} MB - ready to upload</p>
                    <button type="button" onClick={openSelectedFilePreview} className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:underline"><AppIcon className="ri-eye-line" />Preview selected file</button>
                  </div>
                  <button type="button" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} aria-label="Remove attachment" className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-400 transition hover:bg-red-50 hover:text-red-600"><AppIcon className="ri-delete-bin-line" /></button>
                </div>
              )}
              <input ref={fileInputRef} type="file" disabled={!canUploadEvidence} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => selectFile(event.target.files?.[0])} className="hidden" />
              {fileError && <p className="mt-2 flex items-center gap-1 text-[12px] text-red-600"><AppIcon className="ri-error-warning-line" />{fileError}</p>}
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-background-100/60 p-3.5">
              <input type="checkbox" required className="mt-0.5 h-4 w-4 rounded border-foreground-300 text-primary-500 focus:ring-primary-300" />
              <span className="text-[12px] leading-5 text-foreground-500">I confirm the information in this report is accurate and I understand my coach may contact me for more details.</span>
            </label>

            <div className="flex flex-col-reverse gap-3 border-t border-foreground-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-1.5 text-[11px] text-foreground-400"><AppIcon className="ri-shield-check-line text-emerald-500" />Your information is only shared with the relevant support team.</p>
              <button type="submit" disabled={!canSubmit || submitting} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 py-3 text-[13px] font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40">
                {submitting ? <><AppIcon className="ri-loader-4-line animate-spin" /> Saving report...</> : <>Submit absence report <AppIcon className="ri-arrow-right-line" /></>}
              </button>
            </div>
            {requestError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700"><AppIcon className="ri-error-warning-line mr-1.5" />{requestError}</p>}
          </Panel>
        </form>
      )}

      {showGuidance && !submitted && (
        <Panel>
          <SectionHeader title="What happens next?" icon="ri-route-line" />
          <ol className="mt-4 space-y-4">
            {[
              ['1', 'Report received', 'Your coach and tutor are notified.'],
              ['2', 'Coach review', 'They may contact you for more detail.'],
              ['3', 'Catch-up arranged', 'A recording or activity is assigned.'],
            ].map(([step, title, description], index) => (
              <li key={step} className="relative flex gap-3">
                {index < 2 && <span className="absolute left-[13px] top-7 h-8 w-px bg-foreground-200" />}
                <span className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[11px] font-bold text-primary-600">{step}</span>
                <div><p className="text-[13px] font-semibold text-foreground-800">{title}</p><p className="mt-0.5 text-[11px] leading-4 text-foreground-400">{description}</p></div>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      {showHistory && (
        <Panel>
          <SectionHeader title="Previous reports" description="Last 90 days" icon="ri-history-line" />
          <div className="mt-3 space-y-2.5">
            {reportsLoading && <div className="py-6 text-center text-[12px] text-foreground-400"><AppIcon className="ri-loader-4-line mr-1.5 animate-spin" />Loading reports...</div>}
            {!reportsLoading && reports.length === 0 && <EmptyState size="sm" icon="ri-file-list-3-line" title="No absence reports yet" />}
            {reports.map((report) => (
              <article key={report.id} className="rounded-xl border border-foreground-200/70 bg-background-50 p-3.5">
                <div className="mb-2 flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-[13px] font-semibold text-foreground-800">{report.sessionTitle}</p><p className="mt-0.5 text-[10px] text-foreground-400">{displayDate(report.sessionDate)} - {report.reference}</p></div><span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusClass[report.status.trim().toLowerCase()] || statusClass.pending}`}>{report.status}</span></div>
                <div className="flex items-center gap-1.5 border-t border-foreground-100 pt-2 text-[10px] text-foreground-400">
                  <AppIcon className="ri-attachment-2" />
                  {report.evidenceUrl ? (
                    <button
                      type="button"
                      onClick={() => openEvidencePreview(report)}
                      className="inline-flex items-center gap-1 font-medium text-primary-600 transition hover:text-primary-700 hover:underline"
                      title="Preview evidence"
                    >
                      {/\.pdf(?:\?|$)/i.test(report.evidenceUrl) ? 'View PDF evidence' : 'View image evidence'}
                      <AppIcon className="ri-eye-line" />
                    </button>
                  ) : (
                    <span className="truncate">Written explanation</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </Panel>
      )}

      {showGuidance && (
        <div className="rounded-xl border border-amber-200/70 bg-amber-50 p-4">
        <div className="flex gap-3"><AppIcon className="ri-information-line mt-0.5 text-amber-600" /><div><p className="text-[12px] font-semibold text-amber-900">Need urgent support?</p><p className="mt-1 text-[11px] leading-4 text-amber-700">Contact your coach directly if your absence relates to wellbeing or safeguarding.</p><Link to="/learner/messages" className="compact-action mt-2 text-[11px] font-bold text-amber-800 hover:underline">Message my coach <AppIcon className="ri-arrow-right-s-line" /></Link></div></div>
        </div>
      )}

      {evidencePreview && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEvidencePreview(); }}>
          <section className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex items-center justify-between gap-4 border-b border-foreground-200 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary-600">Evidence preview</p>
                <h3 className="truncate text-[13px] font-bold text-foreground-900">{evidencePreview.title}</h3>
              </div>
              <button type="button" onClick={closeEvidencePreview} aria-label="Close evidence preview" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground-500 transition hover:bg-background-100 hover:text-foreground-900">
                <AppIcon className="ri-close-line text-xl" />
              </button>
            </header>
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-background-200/60 p-2 sm:p-4">
              {previewLoading && <div className="text-sm font-medium text-foreground-500"><AppIcon className="ri-loader-4-line mr-2 animate-spin text-primary-600" />Loading evidence...</div>}
              {!previewLoading && previewError && <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center"><AppIcon className="ri-error-warning-line mb-2 block text-2xl text-red-500" /><p className="text-sm font-semibold text-red-700">{previewError}</p></div>}
              {!previewLoading && !previewError && evidencePreview.objectUrl && evidencePreview.isPdf && (
                <iframe
                  src={evidencePreview.objectUrl}
                  title={evidencePreview.title}
                  className="h-full w-full rounded-lg bg-white"
                  onError={() => setPreviewError('Could not display this PDF evidence.')}
                />
              )}
              {!previewLoading && !previewError && evidencePreview.objectUrl && !evidencePreview.isPdf && (
                <img
                  src={evidencePreview.objectUrl}
                  alt={evidencePreview.title}
                  className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
                  onError={() => setPreviewError('Could not display this image evidence.')}
                />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
