import { useCallback, useEffect, useMemo, useState } from 'react';
import LectureQualityTimeline from './LectureQualityTimeline';
import AssessmentMarkingSection from './AssessmentMarkingSection';
import AdvancedAdminAssignmentUploads from './AdvancedAdminAssignmentUploads';
import StructuredRecord from './StructuredRecord';
import StudentReviews from './StudentReviews';
import EligibilityPdfRecord from './EligibilityPdfRecord';
import { matchCoachingSessions } from './coachingMatch';
import {
  advancedAdminAttendance, advancedAdminEvidence, advancedAdminEvidenceDownload,
  advancedAdminInclusion, advancedAdminMark, advancedAdminSubmissions,
  advancedAdminCoachingSessions,
  advancedAdminCoachingReviews,
  advancedAdminQuality, advancedAdminReviews, advancedAdminReviewPdf,
  advancedAdminEligibility,
  advancedAdminMonthlyReports,
  advancedAdminAuditAssignments, advancedAdminAuditAssignmentDocument, advancedAdminAuditAssignmentMark,
  advancedAdminAuditAssignmentSourceMark,
  type AdvancedAdminAttendance, type AdvancedAdminEvidence,
  type AdvancedAdminInclusionReport, type AdvancedAdminInclusionTicket,
  type AdvancedAdminSupportTicket, type AdvancedAdminCoachingSession,
  type AdvancedAdminSubmission,
  type AdvancedAdminQuality, type AdvancedAdminReview,
  type AdvancedAdminEligibility,
  type AdvancedAdminMonthlyReport,
  type AdvancedAdminAuditAssignment,
  type AdvancedAdminLearner,
} from '@/api/advancedAdmin';

function monthOf(value: string | null) { return value?.slice(0, 7) || 'Undated'; }
function monthLabel(value: string) {
  if (value === 'Undated') return value;
  const date = new Date(`${value}-01T00:00:00Z`);
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function day(value: string | null) { return value ? value.slice(0, 10) : 'Date not recorded'; }
function message(error: unknown) { return error instanceof Error ? error.message : 'Could not load records.'; }

function AiReport({ report }: { report: unknown }) {
  return <div className="space-y-3">
    <StructuredRecord value={report} />
    <details className="rounded-lg border border-foreground-200 bg-white p-3">
      <summary className="cursor-pointer text-xs font-semibold text-foreground-700">Original report data</summary>
      <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(report, null, 2)}</pre>
    </details>
  </div>;
}

export { HistoricalCoachMarking } from './AssessmentMarkingSection';

export interface AssignedAssessment {
  id: string;
  activityId?: string;
  subjectId?: string;
  title: string;
  subject: string;
  month: string;
  completed: boolean;
  brief: string;
  plannedHours?: number | null;
  achievedHours?: number | null;
  ksbCodes?: string[];
  achievedKsbCodes?: string[];
}

export type RecordTab = 'lectures' | 'eligibility' | 'inclusion' | 'assessments' | 'evidence' | 'reviews' | 'monthly';
export default function ReviewSections({ learnerId, learner, readOnly = false, initialTab = 'lectures', selectedTab, showTabs = true, reviewFamily }: {
  learnerId: number; assigned: AssignedAssessment[]; readOnly?: boolean;
  learner?: AdvancedAdminLearner;
  initialTab?: RecordTab; selectedTab?: RecordTab; showTabs?: boolean; reviewFamily?: 'pr' | 'mcm';
}) {
  const [submissions, setSubmissions] = useState<AdvancedAdminSubmission[]>([]);
  const [evidence, setEvidence] = useState<AdvancedAdminEvidence[]>([]);
  const [attendance, setAttendance] = useState<AdvancedAdminAttendance[]>([]);
  const [inclusion, setInclusion] = useState<{ reports: AdvancedAdminInclusionReport[]; tickets: AdvancedAdminInclusionTicket[]; supportTickets: AdvancedAdminSupportTicket[] }>({ reports: [], tickets: [], supportTickets: [] });
  const [coaching, setCoaching] = useState<AdvancedAdminCoachingSession[]>([]);
  const [quality, setQuality] = useState<{ tutor: AdvancedAdminQuality[]; lecture: AdvancedAdminQuality[] }>({ tutor: [], lecture: [] });
  const [reviews, setReviews] = useState<{ pr: AdvancedAdminReview[]; mcm: AdvancedAdminReview[] }>({ pr: [], mcm: [] });
  const [coachingReviews, setCoachingReviews] = useState<{ pr: AdvancedAdminReview[]; mcm: AdvancedAdminReview[] }>({ pr: [], mcm: [] });
  const [eligibility, setEligibility] = useState<{ native: AdvancedAdminEligibility[]; imported: AdvancedAdminReview[] }>({ native: [], imported: [] });
  const [monthlyReports, setMonthlyReports] = useState<AdvancedAdminMonthlyReport[]>([]);
  const [auditAssignments, setAuditAssignments] = useState<AdvancedAdminAuditAssignment[]>([]);
  const [inclusionLoaded, setInclusionLoaded] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [coachingReviewsLoading, setCoachingReviewsLoading] = useState(true);
  const [localTab, setLocalTab] = useState<RecordTab>(initialTab);
  const activeTab = selectedTab ?? localTab;

  const loadSubmissions = useCallback(async () => {
    const result = await advancedAdminSubmissions(learnerId);
    setSubmissions(result.items);
  }, [learnerId]);

  const loadAuditAssignments = useCallback(async () => {
    const result = await advancedAdminAuditAssignments(learnerId);
    setAuditAssignments(result.items);
  }, [learnerId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSubmissions([]); setEvidence([]); setAttendance([]);
    setInclusion({ reports: [], tickets: [], supportTickets: [] });
    setInclusionLoaded(false);
    setCoaching([]); setQuality({ tutor: [], lecture: [] });
    setReviews({ pr: [], mcm: [] });
    setEligibility({ native: [], imported: [] });
    setMonthlyReports([]); setAuditAssignments([]);
    setErrors({});
    const fetches = [
      ['assessments', advancedAdminSubmissions(learnerId, controller.signal), (items: AdvancedAdminSubmission[]) => setSubmissions(items)],
      ['evidence', advancedAdminEvidence(learnerId, controller.signal), (items: AdvancedAdminEvidence[]) => setEvidence(items)],
      ['attendance', advancedAdminAttendance(learnerId, controller.signal), (items: AdvancedAdminAttendance[]) => setAttendance(items)],
      ['coaching', advancedAdminCoachingSessions(learnerId, controller.signal), (items: AdvancedAdminCoachingSession[]) => setCoaching(items)],
      ['monthlyReports', advancedAdminMonthlyReports(learnerId, controller.signal), (items: AdvancedAdminMonthlyReport[]) => setMonthlyReports(items)],
      ['auditAssignments', advancedAdminAuditAssignments(learnerId, controller.signal), (items: AdvancedAdminAuditAssignment[]) => setAuditAssignments(items)],
    ] as const;
    Promise.all(fetches.map(async ([key, promise, assign]) => {
      try {
        const result = await promise;
        if (!controller.signal.aborted) (assign as (items: never[]) => void)(result.items as never[]);
      } catch (error) {
        if (!controller.signal.aborted) setErrors(previous => ({ ...previous, [key]: message(error) }));
      }
    })).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    advancedAdminQuality(learnerId, controller.signal).then(result => {
      if (!controller.signal.aborted) setQuality(result);
    }).catch(error => { if (!controller.signal.aborted) setErrors(previous => ({ ...previous, quality: message(error) })); });
    advancedAdminReviews(learnerId, controller.signal).then(result => {
      if (!controller.signal.aborted) setReviews(result);
    }).catch(error => { if (!controller.signal.aborted) setErrors(previous => ({ ...previous, reviews: message(error) })); });
    advancedAdminEligibility(learnerId, controller.signal).then(result => {
      if (!controller.signal.aborted) setEligibility(result);
    }).catch(error => { if (!controller.signal.aborted) setErrors(previous => ({ ...previous, eligibility: message(error) })); });
    advancedAdminInclusion(learnerId, controller.signal).then(result => {
      if (!controller.signal.aborted) { setInclusion(result); setInclusionLoaded(true); }
    }).catch(error => { if (!controller.signal.aborted) { setInclusionLoaded(true); setErrors(previous => ({ ...previous, inclusion: message(error) })); } });
    return () => controller.abort();
  }, [learnerId]);

  useEffect(() => {
    if (readOnly || activeTab !== 'reviews') return;
    const controller = new AbortController();
    setCoachingReviews({ pr: [], mcm: [] });
    setCoachingReviewsLoading(true);
    advancedAdminCoachingReviews(learnerId, controller.signal).then(result => {
      if (!controller.signal.aborted) {
        setCoachingReviews(result);
        setErrors(previous => ({ ...previous, coachingPdf: result.documentLookupError || '' }));
      }
    }).catch(error => {
      if (!controller.signal.aborted) setErrors(previous => ({ ...previous, coachingReviews: message(error) }));
    }).finally(() => {
      if (!controller.signal.aborted) setCoachingReviewsLoading(false);
    });
    return () => controller.abort();
  }, [learnerId, readOnly, activeTab]);

  const coachingMatches = useMemo(() => matchCoachingSessions(reviews, coaching), [reviews, coaching]);
  const coachingReviewMatches = useMemo(() => matchCoachingSessions(coachingReviews, coaching), [coachingReviews, coaching]);
  const evidenceMonths = useMemo(() => {
    const groups = new Map<string, AdvancedAdminEvidence[]>();
    for (const file of evidence) {
      const month = monthOf(file.uploadedAt);
      groups.set(month, [...(groups.get(month) || []), file]);
    }
    return [...groups].sort(([a], [b]) => b.localeCompare(a));
  }, [evidence]);

  async function save(submissionId: string, decision: string, feedback: string): Promise<boolean> {
    try {
      await advancedAdminMark(learnerId, submissionId, decision, feedback);
      await loadSubmissions();
      setErrors(previous => ({ ...previous, assessments: '' }));
      return true;
    } catch (error) {
      setErrors(previous => ({ ...previous, assessments: message(error) }));
      return false;
    }
  }

  async function saveAuditAssignment(evidenceId: number, decision: string, feedback: string): Promise<boolean> {
    try {
      await advancedAdminAuditAssignmentMark(learnerId, evidenceId, decision, feedback);
      await loadAuditAssignments();
      setErrors(previous => ({ ...previous, auditAssignments: '' }));
      return true;
    } catch (error) {
      setErrors(previous => ({ ...previous, auditAssignments: message(error) }));
      return false;
    }
  }

  async function saveAuditSource(recordId: number, decision: string, feedback: string): Promise<boolean> {
    try {
      await advancedAdminAuditAssignmentSourceMark(learnerId, recordId, decision, feedback);
      await loadAuditAssignments();
      setErrors(previous => ({ ...previous, auditAssignments: '' }));
      return true;
    } catch (error) {
      setErrors(previous => ({ ...previous, auditAssignments: message(error) }));
      return false;
    }
  }

  async function openEvidence(file: AdvancedAdminEvidence) {
    try {
      const { url } = await advancedAdminEvidenceDownload(learnerId, file.id);
      window.open(url, '_blank', 'noopener,noreferrer');
      setErrors(previous => ({ ...previous, evidence: '' }));
    } catch (error) { setErrors(previous => ({ ...previous, evidence: message(error) })); }
  }

  async function openAssignmentDocument(evidenceId: number, part: 'file' | 'report') {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const { url } = await advancedAdminAuditAssignmentDocument(learnerId, evidenceId, part);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
      setErrors(previous => ({ ...previous, auditAssignments: '' }));
    } catch (error) {
      tab?.close();
      setErrors(previous => ({ ...previous, auditAssignments: message(error) }));
    }
  }

  const tabs = [
    { id: 'lectures', label: 'Lectures & attendance', count: attendance.length },
    { id: 'eligibility', label: 'Eligibility Review', count: eligibility.native.length + eligibility.imported.length },
    { id: 'inclusion', label: 'Inclusion & support', count: inclusion.reports.length + inclusion.tickets.length + inclusion.supportTickets.length },
    { id: 'assessments', label: 'Assignments & Marking', count: auditAssignments.length },
    { id: 'evidence', label: 'Evidence', count: evidence.length },
    { id: 'reviews', label: 'PR & MCM', count: reviews.pr.length + reviews.mcm.length },
    { id: 'monthly', label: 'Monthly reports', count: monthlyReports.length },
  ] as const;

  return <div className="space-y-6">
    {showTabs && <nav aria-label="Learner record sections" className="rounded-2xl border border-foreground-200 bg-white p-3">
      <div role="tablist" aria-label="Learner record" className="flex flex-wrap gap-2">{tabs.map(tab => <button key={tab.id} type="button" role="tab"
        id={`advanced-tab-${tab.id}`} aria-controls={`advanced-panel-${tab.id}`} aria-selected={activeTab === tab.id}
        onClick={() => setLocalTab(tab.id)} className={`rounded-xl px-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 ${activeTab === tab.id ? 'bg-primary-700 text-white' : 'bg-background-100 text-foreground-700 hover:bg-primary-50'}`}>
        {tab.label} <span className="ml-1 opacity-75">{tab.count}</span>
      </button>)}</div>
    </nav>}
    <section id="advanced-panel-assessments" role={showTabs ? 'tabpanel' : undefined} aria-labelledby={showTabs ? 'advanced-tab-assessments' : undefined} hidden={activeTab !== 'assessments'}>
      <div className="mb-4"><AdvancedAdminAssignmentUploads key={learnerId} learnerId={learnerId} readOnly={readOnly} /></div>
      <AssessmentMarkingSection key={learnerId} learner={learner} assignments={auditAssignments} submissions={submissions}
        readOnly={readOnly} loading={loading}
        errors={{ assessments: errors.assessments, auditAssignments: errors.auditAssignments }}
        onMark={save} onMarkAssignment={saveAuditAssignment} onMarkAssignmentSource={saveAuditSource}
        onOpenAssignmentDocument={(id, part) => { void openAssignmentDocument(id, part); }} />
    </section>
    <section id="advanced-panel-monthly" role={showTabs ? 'tabpanel' : undefined} aria-labelledby={showTabs ? 'advanced-tab-monthly' : undefined} hidden={activeTab !== 'monthly'} className="space-y-3">
      <h2 id="advanced-monthly-reports" className="text-xl font-semibold">Monthly reports</h2>
      {errors.monthlyReports && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{errors.monthlyReports}</p>}
      {monthlyReports.map(report => <details key={report.id} className="rounded-2xl border bg-white p-5 text-sm"><summary className="cursor-pointer font-semibold">{report.monthLabel || monthLabel(report.month)} · {report.status}</summary>
        <div className="mt-3 space-y-2"><p>{report.learnedSummary}</p><p>Submitted: {day(report.submittedAt)}{report.signedName && ` · Signed by ${report.signedName}`}</p>
          {report.attachments?.length > 0 && <p>Attachments: {report.attachments.map(file => file.filename || file.name || 'Evidence file').join(', ')}. Open approved files in Evidence below.</p>}
        </div>
      </details>)}
      {!loading && !errors.monthlyReports && monthlyReports.length === 0 && <p className="rounded-xl border bg-white p-4 text-sm">No monthly reports recorded.</p>}
    </section>
    <section id="advanced-panel-eligibility" role={showTabs ? 'tabpanel' : undefined} aria-labelledby={showTabs ? 'advanced-tab-eligibility' : undefined} hidden={activeTab !== 'eligibility'} className="space-y-3">
      <h2 id="advanced-eligibility" className="text-xl font-semibold">Eligibility Review</h2>
      {errors.eligibility && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{errors.eligibility}</p>}
      {eligibility.native.map(row => <EligibilityPdfRecord key={row.eventKey} learnerId={learnerId}
        recordKey={row.eventKey} label={row.label} status={row.status} date={row.date} source="native" />)}
      {eligibility.imported.map(row => <EligibilityPdfRecord key={row.id} learnerId={learnerId}
        recordKey={row.id} label={row.name} status={row.status}
        date={row.completedDate || row.plannedDate} source="imported" aptemReviewId={row.aptemReviewId} />)}
      {!errors.eligibility && eligibility.native.length + eligibility.imported.length === 0 && <p className="rounded-xl border bg-white p-4 text-sm">No Eligibility Review recorded.</p>}
    </section>
    <section id="advanced-panel-reviews" role={showTabs ? 'tabpanel' : undefined} aria-labelledby={showTabs ? 'advanced-tab-reviews' : undefined} hidden={activeTab !== 'reviews'} className="space-y-3">
      {!readOnly && !showTabs && <StudentReviews learnerId={learnerId} learner={learner} reviews={coachingReviews} coaching={coaching}
        matches={coachingReviewMatches} reviewsError={errors.coachingReviews} coachingError={errors.coaching}
        pdfError={errors.coachingPdf} loading={coachingReviewsLoading} />}
      {(readOnly || showTabs) && <>
      <h2 id="advanced-reviews" className="text-xl font-semibold">Progress Reviews and MCM</h2>
      {errors.reviews && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{errors.reviews}</p>}
      {errors.coaching && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{errors.coaching}</p>}
      <div className="grid gap-4 md:grid-cols-2">{(['pr', 'mcm'] as const).filter(family => !reviewFamily || family === reviewFamily).map(family => <div key={family} className="rounded-2xl border bg-white p-5">
        <h3 className="mb-3 font-semibold text-primary-700">{family === 'pr' ? 'Progress Reviews (PR)' : 'Monthly Coaching Meetings (MCM)'}</h3>
        <div className="space-y-2">{reviews[family].map(review => <details key={review.id} className="rounded-xl border p-3 text-sm">
          <summary className="cursor-pointer font-medium">{review.name} · {review.status} · {day(review.completedDate || review.plannedDate)}</summary>
          <div className="mt-3 space-y-3">
            {review.aptemReviewId && <a className="font-semibold text-primary-700 underline" href={advancedAdminReviewPdf(learnerId, review.aptemReviewId)} target="_blank" rel="noreferrer">Open original PDF</a>}
            {review.sections?.map(section => <div key={section.id} className="rounded-lg border border-foreground-100 p-3"><h4 className="font-semibold">{section.name}</h4>
              <dl className="mt-2 space-y-2">{section.fields?.map((field, index) => <div key={`${field.label}-${index}`}>
                <dt className="text-xs font-semibold text-foreground-600">{field.label}</dt>
                <dd className="mt-1"><StructuredRecord value={field.value} /></dd>
              </div>)}</dl>
            </div>)}
            {review.aiCoachingReport && <details className="rounded-lg border border-primary-200 bg-primary-50 p-3">
              <summary className="cursor-pointer font-semibold">AI coaching session report</summary>
              <div className="mt-3"><AiReport report={review.aiCoachingReport} /></div>
            </details>}
            {coachingMatches.matched.get(`${family}:${review.id}`)?.report && <details className="rounded-lg border border-primary-200 bg-primary-50 p-3">
              <summary className="cursor-pointer font-semibold">Coaching AI report · matched by unique session date</summary>
              <div className="mt-3"><AiReport report={coachingMatches.matched.get(`${family}:${review.id}`)?.report} /></div>
            </details>}
          </div>
        </details>)}
          {coachingMatches.unmatched.filter(session => session.family === family).map(session => <details key={session.id} className="rounded-xl border border-primary-200 bg-primary-50/40 p-3 text-sm">
            <summary className="cursor-pointer font-medium">Coaching session · {day(session.actualStartAt || session.plannedDate)} · {session.status || 'Status not recorded'} · AI {session.aiStatus || 'pending'}</summary>
            {session.report ? <div className="mt-3 space-y-2"><strong>AI session report</strong>
              {typeof session.report.executive_summary === 'string' && <p className="whitespace-pre-wrap">{session.report.executive_summary}</p>}
              <details className="rounded-lg border bg-white p-3"><summary className="cursor-pointer font-medium">Full AI report</summary><div className="mt-3"><AiReport report={session.report} /></div></details>
            </div> : <p className="mt-3 text-foreground-500">AI report is not available for this session.</p>}
          </details>)}
          {!errors.reviews && !errors.coaching && reviews[family].length === 0 && !coaching.some(session => session.family === family) && <p className="text-sm text-foreground-500">No {family.toUpperCase()} records.</p>}
        </div>
      </div>)}</div>
      </>}
    </section>
    <div id="advanced-panel-lectures" role={showTabs ? 'tabpanel' : undefined} aria-labelledby={showTabs ? 'advanced-tab-lectures' : undefined} hidden={activeTab !== 'lectures'}>
      <LectureQualityTimeline learnerId={learnerId} active={activeTab === 'lectures'} attendance={attendance} quality={quality}
        attendanceError={errors.attendance} qualityError={errors.quality} loading={loading} />
    </div>
    <section id="advanced-panel-evidence" role={showTabs ? 'tabpanel' : undefined} aria-labelledby={showTabs ? 'advanced-tab-evidence' : undefined} hidden={activeTab !== 'evidence'} className="space-y-3">
      <h2 id="advanced-evidence" className="text-xl font-semibold">Evidence</h2>
      {errors.evidence && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{errors.evidence}</p>}
      {evidenceMonths.map(([month, files]) => <div key={month} className="rounded-2xl border bg-white p-5"><h3 className="font-semibold text-primary-700">{monthLabel(month)} <span className="text-sm text-foreground-500">({files.length})</span></h3>
        <ul className="mt-3 space-y-2">{files.map(file => <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-2 text-sm">
          <span>{file.filename} · {day(file.uploadedAt)} · {file.status}</span>
          {file.status === 'approved' && <button type="button" onClick={() => openEvidence(file)} className="font-semibold text-primary-700 underline">Open file</button>}
        </li>)}</ul>
      </div>)}
      {!loading && !errors.evidence && evidence.length === 0 && <p className="rounded-2xl border bg-white p-5 text-sm text-foreground-500">No evidence files recorded.</p>}
    </section>
    <section id="advanced-panel-inclusion" role={showTabs ? 'tabpanel' : undefined} aria-labelledby={showTabs ? 'advanced-tab-inclusion' : undefined} hidden={activeTab !== 'inclusion'} className="space-y-3">
      <h2 id="advanced-inclusion" className="text-xl font-semibold">Inclusion</h2>
      {errors.inclusion && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-800">{errors.inclusion}</p>}
      {inclusion.reports.map(report => <details key={report.id} className="rounded-2xl border bg-white p-5 text-sm">
        <summary className="cursor-pointer font-semibold">Inclusion review · {day(report.createdAt)} · {report.status} {report.riskLevel && `· ${report.riskLevel} risk`}</summary>
        <div className="mt-4 space-y-4">
          {typeof report.executiveSummary === 'string' && <p className="whitespace-pre-wrap">{report.executiveSummary}</p>}
          {report.supportPlan != null && <div><h3 className="font-semibold">Support and action plan</h3><div className="mt-2 rounded-lg bg-primary-50 p-3"><StructuredRecord value={report.supportPlan} /></div></div>}
          {report.priorityActions != null && <div><h3 className="font-semibold">Priority actions</h3><div className="mt-2 rounded-lg bg-primary-50 p-3"><StructuredRecord value={report.priorityActions} /></div></div>}
          {report.riskRoadmap != null && <div><h3 className="font-semibold">Risk roadmap</h3><div className="mt-2 rounded-lg bg-foreground-50 p-3"><StructuredRecord value={report.riskRoadmap} /></div></div>}
          <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Full review sections</summary><div className="mt-2"><StructuredRecord value={{ overview: report.overview, keyFindings: report.keyFindings, reviewTimeline: report.reviewTimeline, sections: report.sections }} /></div></details>
          {report.notes.length > 0 && <div><h3 className="font-semibold">Coach notes and actions</h3><ul className="mt-2 space-y-2">{report.notes.map(note => <li key={note.id} className="rounded-lg bg-foreground-50 p-3">{note.note} <span className="text-foreground-500">· {note.createdBy} · {day(note.createdAt)}</span></li>)}</ul></div>}
          {report.evidence.filter(file => file.url).map(file => <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="mr-3 font-semibold text-primary-700 underline">{file.fileName}</a>)}
        </div>
      </details>)}
      {inclusion.tickets.map(ticket => <details key={ticket.id} className="rounded-2xl border bg-white p-5 text-sm"><summary className="cursor-pointer font-semibold">Inclusion case · {ticket.subject} · {ticket.status}</summary>
        <div className="mt-3 space-y-3"><p>{ticket.details}</p>{ticket.notes.map(note => <p key={note.id} className="rounded-lg bg-foreground-50 p-3">{note.note} <span className="text-foreground-500">· {note.createdBy} · {day(note.createdAt)}</span></p>)}
          {ticket.evidence.filter(file => file.url).map(file => <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="mr-3 font-semibold text-primary-700 underline">{file.fileName}</a>)}
        </div>
      </details>)}
      {inclusion.supportTickets.map(ticket => <details key={ticket.id} className="rounded-2xl border bg-white p-5 text-sm"><summary className="cursor-pointer font-semibold">{ticket.ticketType} support · {ticket.subject} · {ticket.status}</summary>
        <div className="mt-3 space-y-3"><p>{ticket.details}</p>{ticket.notes.map(note => <p key={note.id} className="rounded-lg bg-foreground-50 p-3">{note.note} <span className="text-foreground-500">· {note.createdBy} · {day(note.createdAt)}</span></p>)}
          {ticket.evidence.filter(file => file.url).map(file => <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="mr-3 font-semibold text-primary-700 underline">{file.fileName}</a>)}
        </div>
      </details>)}
      {inclusionLoaded && !errors.inclusion && inclusion.reports.length + inclusion.tickets.length + inclusion.supportTickets.length === 0 && <p className="rounded-xl border bg-white p-4 text-sm">No Inclusion record for this learner.</p>}
    </section>
  </div>;
}
