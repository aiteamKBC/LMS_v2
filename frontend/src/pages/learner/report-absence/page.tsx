import { useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { fetchAbsenceReports, submitAbsenceReport, type LearnerAbsenceReport } from '@/api/absenceReports';
import { useMyLearner } from '@/hooks/useMyLearner';

const learnerNav = roleNavMap.learner;

const MISSED_SESSIONS = [
  { id: 'session-1', date: '18 Jun 2026', dateIso: '2026-06-18', time: '10:00 - 12:00', startTime: '10:00', title: 'Consumer Behaviour', tutor: 'Crispin Jones', module: 'Marketing Principles' },
  { id: 'session-2', date: '11 Jun 2026', dateIso: '2026-06-11', time: '10:00 - 12:00', startTime: '10:00', title: 'Campaign Targeting', tutor: 'Crispin Jones', module: 'Digital Campaigns' },
  { id: 'session-3', date: '04 Jun 2026', dateIso: '2026-06-04', time: '14:00 - 15:00', startTime: '14:00', title: 'Monthly Coaching', tutor: 'Med Maher', module: 'Progress Review' },
];

const REASONS = [
  { value: 'illness', label: 'Illness or medical appointment', icon: 'ri-heart-pulse-line' },
  { value: 'work', label: 'Work commitment', icon: 'ri-briefcase-4-line' },
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

export default function ReportAbsencePage() {
  const p = LEARNER_PROFILE;
  const myLearner = useMyLearner();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRequestRef = useRef(0);
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
  const [reportsLoading, setReportsLoading] = useState(true);
  const [requestError, setRequestError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [evidencePreview, setEvidencePreview] = useState<EvidencePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const selectedSession = useMemo(
    () => MISSED_SESSIONS.find((session) => session.id === sessionId),
    [sessionId],
  );
  const availableSessions = useMemo(() => {
    const reportedSessions = new Set(
      reports
        .filter((report) => !['declined', 'rejected'].includes(report.status.trim().toLowerCase()))
        .map((report) => `${report.sessionDate}|${report.sessionTitle.trim().toLowerCase()}`),
    );
    return MISSED_SESSIONS.filter(
      (session) => !reportedSessions.has(`${session.dateIso}|${session.title.trim().toLowerCase()}`),
    );
  }, [reports]);
  const hasReason = Boolean(reasonType && (reasonType !== 'other' || otherReason.trim()));
  const canUploadEvidence = Boolean(sessionId && hasReason);
  const canSubmit = Boolean(sessionId && hasReason && (explanation.trim() || file));
  const resolvedCount = reports.filter((report) => report.status !== 'Pending').length;

  useEffect(() => {
    let cancelled = false;
    setReportsLoading(true);
    fetchAbsenceReports(myLearner.kind, myLearner.id)
      .then((results) => { if (!cancelled) setReports(results); })
      .catch((error: unknown) => { if (!cancelled) setRequestError(error instanceof Error ? error.message : 'Could not load reports.'); })
      .finally(() => { if (!cancelled) setReportsLoading(false); });
    return () => { cancelled = true; };
  }, [myLearner.kind, myLearner.id]);

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
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Could not submit the absence report.');
    } finally {
      setSubmitting(false);
    }
  };

  const closeEvidencePreview = () => {
    previewRequestRef.current += 1;
    if (evidencePreview?.objectUrl) URL.revokeObjectURL(evidencePreview.objectUrl);
    setEvidencePreview(null);
    setPreviewLoading(false);
    setPreviewError('');
  };

  const openEvidencePreview = async (report: LearnerAbsenceReport) => {
    if (!report.evidenceUrl) return;
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    if (evidencePreview?.objectUrl) URL.revokeObjectURL(evidencePreview.objectUrl);
    const isPdf = report.evidenceUrl.toLowerCase().endsWith('.pdf');
    setEvidencePreview({ title: `${report.reference} - ${report.sessionTitle}`, objectUrl: '', isPdf });
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const response = await fetch(report.evidenceUrl);
      if (!response.ok) throw new Error(`Could not open evidence (${response.status}).`);
      const objectUrl = URL.createObjectURL(await response.blob());
      if (previewRequestRef.current !== requestId) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      setEvidencePreview({ title: `${report.reference} - ${report.sessionTitle}`, objectUrl, isPdf });
    } catch (error) {
      if (previewRequestRef.current === requestId) {
        setPreviewError(error instanceof Error ? error.message : 'Could not open evidence.');
      }
    } finally {
      if (previewRequestRef.current === requestId) setPreviewLoading(false);
    }
  };

  const openSelectedFilePreview = () => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    previewRequestRef.current += 1;
    if (evidencePreview?.objectUrl) URL.revokeObjectURL(evidencePreview.objectUrl);
    setPreviewError('');
    setPreviewLoading(false);
    setEvidencePreview({
      title: file.name,
      objectUrl,
      isPdf: file.type === 'application/pdf',
    });
  };

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Absence Report"
      pageSubtitle="Tell us why you missed a session and upload supporting evidence"
      userName={p.fullName}
      userRole={`${p.programme} Apprentice`}
    >
      <div className="p-4 md:p-6 space-y-5">
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-5 sm:p-6 text-white">
          <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-accent-400/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm">
                <i className="ri-file-warning-line text-2xl" />
              </span>
              <div>
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <h2 className="font-heading text-xl font-bold text-white">Report a missed session</h2>
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/80">Private & secure</span>
                </div>
                <p className="max-w-2xl text-sm leading-6 text-white/70">
                  Your report goes directly to your coach and tutor. Add a written explanation, supporting evidence, or both.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <div className="rounded-xl bg-white/10 px-4 py-3 text-center backdrop-blur-sm">
                <p className="text-lg font-bold">{reports.length}</p><p className="text-[10px] uppercase tracking-wide text-white/60">Reports</p>
              </div>
              <div className="rounded-xl bg-white/10 px-4 py-3 text-center backdrop-blur-sm">
                <p className="text-lg font-bold text-emerald-300">{resolvedCount}</p><p className="text-[10px] uppercase tracking-wide text-white/60">Resolved</p>
              </div>
              <div className="rounded-xl bg-white/10 px-4 py-3 text-center backdrop-blur-sm">
                <p className="text-lg font-bold">-</p><p className="text-[10px] uppercase tracking-wide text-white/60">Attendance</p>
              </div>
            </div>
          </div>
        </section>

        {submitted ? (
          <section className="mx-auto max-w-3xl rounded-2xl border border-emerald-200 bg-background-50 p-6 text-center shadow-sm sm:p-8">
            <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <i className="ri-check-line text-3xl text-emerald-600" />
            </span>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-600">Report submitted</p>
            <h2 className="mb-2 font-heading text-xl font-bold text-foreground-900">Thanks for letting us know</h2>
            <p className="mx-auto mb-6 max-w-lg text-sm leading-6 text-foreground-500">
              Your report for <strong className="text-foreground-800">{submittedReport?.sessionTitle}</strong> has been saved and sent to your coach and tutor for review.
            </p>
            <div className="mx-auto mb-6 grid max-w-xl gap-3 rounded-xl bg-background-100/70 p-4 text-left sm:grid-cols-2">
              <div><p className="text-[10px] uppercase tracking-wide text-foreground-400">Reference</p><p className="text-sm font-semibold text-foreground-800">{submittedReport?.reference}</p></div>
              <div><p className="text-[10px] uppercase tracking-wide text-foreground-400">Current status</p><p className="text-sm font-semibold text-amber-600">Pending review</p></div>
              <div><p className="text-[10px] uppercase tracking-wide text-foreground-400">Session</p><p className="text-sm font-semibold text-foreground-800">{submittedReport ? displayDate(submittedReport.sessionDate) : ''}</p></div>
              <div><p className="text-[10px] uppercase tracking-wide text-foreground-400">Evidence</p><p className="truncate text-sm font-semibold text-foreground-800">{file?.name || 'Written explanation'}</p></div>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <button type="button" onClick={resetForm} className="rounded-lg border border-background-200 bg-white px-4 py-2.5 text-sm font-semibold text-foreground-600 transition hover:bg-background-100">
                Submit another report
              </button>
              <a href="/learner/attendance" className="rounded-lg bg-primary-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-600">Back to attendance</a>
            </div>
          </section>
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl border border-background-200/70 bg-background-50 p-5 shadow-sm sm:p-6 xl:col-span-2">
              <div className="flex items-center gap-3 border-b border-background-200/60 pb-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 text-primary-600"><i className="ri-edit-box-line" /></span>
                <div><h3 className="font-heading text-base font-bold text-foreground-900">Absence details</h3><p className="text-xs text-foreground-400">Fields marked with * are required</p></div>
              </div>

              <div>
                <label htmlFor="missed-session" className="mb-2 block text-sm font-semibold text-foreground-700">Missed session *</label>
                <select id="missed-session" value={sessionId} onChange={(event) => setSessionId(event.target.value)} required disabled={reportsLoading || availableSessions.length === 0} className="w-full rounded-xl border border-background-200 bg-white px-3.5 py-3 text-sm text-foreground-800 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:bg-background-100 disabled:text-foreground-400">
                  <option value="">{reportsLoading ? 'Loading missed sessions...' : availableSessions.length === 0 ? 'All missed sessions have been reported' : 'Choose the session you missed'}</option>
                  {availableSessions.map((session) => <option key={session.id} value={session.id}>{session.date} - {session.title}</option>)}
                </select>
                {selectedSession && (
                  <div className="mt-3 grid gap-2 rounded-xl border border-primary-100 bg-primary-50/60 p-3 sm:grid-cols-3">
                    <div className="flex items-center gap-2 text-xs text-foreground-600"><i className="ri-time-line text-primary-500" />{selectedSession.time}</div>
                    <div className="flex items-center gap-2 text-xs text-foreground-600"><i className="ri-user-star-line text-primary-500" />{selectedSession.tutor}</div>
                    <div className="flex items-center gap-2 text-xs text-foreground-600"><i className="ri-book-open-line text-primary-500" />{selectedSession.module}</div>
                  </div>
                )}
              </div>

              <fieldset>
                <legend className="mb-2 block text-sm font-semibold text-foreground-700">Main reason *</legend>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {REASONS.map((reason) => (
                    <label key={reason.value} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-xs font-medium transition ${reasonType === reason.value ? 'border-primary-400 bg-primary-50 text-primary-700 ring-1 ring-primary-200' : 'border-background-200 bg-white text-foreground-600 hover:border-primary-200'}`}>
                      <input type="radio" name="reason" value={reason.value} checked={reasonType === reason.value} onChange={(event) => setReasonType(event.target.value)} className="sr-only" />
                      <i className={`${reason.icon} text-base ${reasonType === reason.value ? 'text-primary-600' : 'text-foreground-400'}`} />
                      <span>{reason.label}</span>
                      {reasonType === reason.value && <i className="ri-check-line ml-auto text-primary-600" />}
                    </label>
                  ))}
                </div>
                {reasonType === 'other' && (
                  <div className="mt-3 rounded-xl border border-primary-200 bg-primary-50/40 p-3.5">
                    <label htmlFor="other-absence-reason" className="mb-2 block text-xs font-semibold text-foreground-700">
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
                      className="w-full rounded-lg border border-background-200 bg-white px-3.5 py-2.5 text-sm text-foreground-800 outline-none transition placeholder:text-foreground-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                    />
                    <p className="mt-1.5 text-right text-[10px] text-foreground-400">{otherReason.length}/120</p>
                  </div>
                )}
              </fieldset>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="absence-explanation" className="text-sm font-semibold text-foreground-700">Written explanation</label>
                  <span className="text-[11px] text-foreground-400">{explanation.length}/600</span>
                </div>
                <textarea id="absence-explanation" value={explanation} onChange={(event) => setExplanation(event.target.value)} maxLength={600} rows={4} required={!file} placeholder="Tell your coach what happened and anything they should know..." className="w-full resize-none rounded-xl border border-background-200 bg-white px-3.5 py-3 text-sm leading-6 text-foreground-800 outline-none transition placeholder:text-foreground-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
                <p className="mt-1.5 text-[11px] text-foreground-400">Add an explanation or attach evidence below. You can provide both.</p>
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold text-foreground-700">Supporting evidence <span className="font-normal text-foreground-400">(optional)</span></p>
                {!file ? (
                  <button
                    type="button"
                    disabled={!canUploadEvidence}
                    onClick={() => { if (canUploadEvidence) fileInputRef.current?.click(); }}
                    onDragOver={(event) => { event.preventDefault(); if (canUploadEvidence) setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event) => { event.preventDefault(); setDragging(false); if (canUploadEvidence) selectFile(event.dataTransfer.files[0]); }}
                    className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition ${!canUploadEvidence ? 'cursor-not-allowed border-background-200 bg-background-100/70 opacity-60' : dragging ? 'border-primary-400 bg-primary-50' : 'border-background-300 bg-background-100/40 hover:border-primary-300 hover:bg-primary-50/40'}`}
                  >
                    <span className={`mb-2 flex h-11 w-11 items-center justify-center rounded-xl ${canUploadEvidence ? 'bg-primary-100' : 'bg-background-200'}`}><i className={`${canUploadEvidence ? 'ri-upload-cloud-2-line text-primary-600' : 'ri-lock-line text-foreground-400'} text-xl`} /></span>
                    <span className="text-sm font-semibold text-foreground-700">{canUploadEvidence ? 'Drop an image here or click to browse' : 'Complete the session and reason above first'}</span>
                    <span className="mt-1 text-[11px] text-foreground-400">{canUploadEvidence ? 'JPG, PNG or PDF - maximum 10 MB' : 'Evidence upload will unlock automatically'}</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5">
                    {file.type.startsWith('image/') && selectedFilePreviewUrl ? (
                      <img src={selectedFilePreviewUrl} alt="Selected evidence preview" className="h-14 w-14 shrink-0 rounded-lg border border-white object-cover shadow-sm" />
                    ) : (
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-white text-xl text-red-500 shadow-sm"><i className="ri-file-pdf-2-line" /></span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground-800">{file.name}</p>
                      <p className="text-[11px] text-foreground-400">{(file.size / 1024 / 1024).toFixed(2)} MB - ready to upload</p>
                      <button type="button" onClick={openSelectedFilePreview} className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:underline"><i className="ri-eye-line" />Preview selected file</button>
                    </div>
                    <button type="button" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} aria-label="Remove attachment" className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-400 transition hover:bg-red-50 hover:text-red-600"><i className="ri-delete-bin-line" /></button>
                  </div>
                )}
                <input ref={fileInputRef} type="file" disabled={!canUploadEvidence} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => selectFile(event.target.files?.[0])} className="hidden" />
                {fileError && <p className="mt-2 flex items-center gap-1 text-xs text-red-600"><i className="ri-error-warning-line" />{fileError}</p>}
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-background-100/60 p-3.5">
                <input type="checkbox" required className="mt-0.5 h-4 w-4 rounded border-background-300 text-primary-500 focus:ring-primary-300" />
                <span className="text-xs leading-5 text-foreground-500">I confirm the information in this report is accurate and I understand my coach may contact me for more details.</span>
              </label>

              <div className="flex flex-col-reverse gap-3 border-t border-background-200/60 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-1.5 text-[11px] text-foreground-400"><i className="ri-shield-check-line text-emerald-500" />Your information is only shared with the relevant support team.</p>
                <button type="submit" disabled={!canSubmit || submitting} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-500 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-40">
                  {submitting ? <><i className="ri-loader-4-line animate-spin" /> Saving report...</> : <>Submit absence report <i className="ri-arrow-right-line" /></>}
                </button>
              </div>
              {requestError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"><i className="ri-error-warning-line mr-1.5" />{requestError}</p>}
            </form>

            <aside className="space-y-5">
              <section className="rounded-2xl border border-background-200/70 bg-background-50 p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary-100 text-secondary-600"><i className="ri-route-line" /></span><h3 className="font-heading text-sm font-bold text-foreground-900">What happens next?</h3></div>
                <ol className="space-y-4">
                  {[
                    ['1', 'Report received', 'Your coach and tutor are notified.'],
                    ['2', 'Coach review', 'They may contact you for more detail.'],
                    ['3', 'Catch-up arranged', 'A recording or activity is assigned.'],
                  ].map(([step, title, description], index) => (
                    <li key={step} className="relative flex gap-3">
                      {index < 2 && <span className="absolute left-[13px] top-7 h-8 w-px bg-background-200" />}
                      <span className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[11px] font-bold text-primary-600">{step}</span>
                      <div><p className="text-xs font-semibold text-foreground-800">{title}</p><p className="mt-0.5 text-[11px] leading-4 text-foreground-400">{description}</p></div>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="rounded-2xl border border-background-200/70 bg-background-50 p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between"><h3 className="font-heading text-sm font-bold text-foreground-900">Previous reports</h3><span className="text-[11px] text-foreground-400">Last 90 days</span></div>
                <div className="space-y-3">
                  {reportsLoading && <div className="py-6 text-center text-xs text-foreground-400"><i className="ri-loader-4-line mr-1.5 animate-spin" />Loading reports...</div>}
                  {!reportsLoading && reports.length === 0 && <div className="rounded-xl border border-dashed border-background-200 py-7 text-center"><i className="ri-file-list-3-line mb-2 block text-xl text-foreground-300" /><p className="text-xs font-medium text-foreground-500">No absence reports yet</p></div>}
                  {reports.map((report) => (
                    <article key={report.id} className="rounded-xl border border-background-200/60 bg-white p-3.5">
                      <div className="mb-2 flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-semibold text-foreground-800">{report.sessionTitle}</p><p className="mt-0.5 text-[10px] text-foreground-400">{displayDate(report.sessionDate)} - {report.reference}</p></div><span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusClass[report.status.trim().toLowerCase()] || statusClass.pending}`}>{report.status}</span></div>
                      <div className="flex items-center gap-1.5 border-t border-background-100 pt-2 text-[10px] text-foreground-400">
                        <i className="ri-attachment-2" />
                        {report.evidenceUrl ? (
                          <button
                            type="button"
                            onClick={() => openEvidencePreview(report)}
                            className="inline-flex items-center gap-1 font-medium text-primary-600 transition hover:text-primary-700 hover:underline"
                            title="Preview evidence"
                          >
                            {report.evidenceUrl.toLowerCase().endsWith('.pdf') ? 'View PDF evidence' : 'View image evidence'}
                            <i className="ri-eye-line" />
                          </button>
                        ) : (
                          <span className="truncate">Written explanation</span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <div className="rounded-xl border border-amber-200/70 bg-amber-50 p-4">
                <div className="flex gap-3"><i className="ri-information-line mt-0.5 text-amber-600" /><div><p className="text-xs font-semibold text-amber-900">Need urgent support?</p><p className="mt-1 text-[11px] leading-4 text-amber-700">Contact your coach directly if your absence relates to wellbeing or safeguarding.</p><a href="/learner/messages" className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 hover:underline">Message my coach <i className="ri-arrow-right-s-line" /></a></div></div>
              </div>
            </aside>
          </div>
        )}
      </div>

      {evidencePreview && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEvidencePreview(); }}>
          <section className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex items-center justify-between gap-4 border-b border-background-200 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary-600">Evidence preview</p>
                <h3 className="truncate text-sm font-bold text-foreground-900">{evidencePreview.title}</h3>
              </div>
              <button type="button" onClick={closeEvidencePreview} aria-label="Close evidence preview" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground-500 transition hover:bg-background-100 hover:text-foreground-900">
                <i className="ri-close-line text-xl" />
              </button>
            </header>
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-background-200/60 p-2 sm:p-4">
              {previewLoading && <div className="text-sm font-medium text-foreground-500"><i className="ri-loader-4-line mr-2 animate-spin text-primary-600" />Loading evidence...</div>}
              {!previewLoading && previewError && <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center"><i className="ri-error-warning-line mb-2 block text-2xl text-red-500" /><p className="text-sm font-semibold text-red-700">{previewError}</p></div>}
              {!previewLoading && !previewError && evidencePreview.objectUrl && evidencePreview.isPdf && (
                <iframe src={evidencePreview.objectUrl} title={evidencePreview.title} className="h-full w-full rounded-lg bg-white" />
              )}
              {!previewLoading && !previewError && evidencePreview.objectUrl && !evidencePreview.isPdf && (
                <img src={evidencePreview.objectUrl} alt={evidencePreview.title} className="max-h-full max-w-full rounded-lg object-contain shadow-sm" />
              )}
            </div>
          </section>
        </div>
      )}
    </WorkspaceShell>
  );
}
