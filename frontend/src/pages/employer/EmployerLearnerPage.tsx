import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { fetchEmployerLearner, fetchEmployerLearnerPlan, fetchEmployerLearnerSummary, fetchEmployerReviewInstance, signReviewAsEmployer, type EmployerLearnerDetail, type EmployerLearnerSummary } from '@/api/employerPortal';
import type { LearnerReviewDefinition } from '@/api/learnerCalendar';
import { flattenReviewFields } from '@/api/reviewInstances';
import { ReviewFormRenderer } from '@/components/reviews/ReviewFormRenderer';
import { ReviewSignatures } from '@/components/reviews/ReviewSignatures';
import { EmployerDocuments } from './EmployerDocuments';
import { SignaturePad } from '@/pages/users/wizard/steps/SignaturePad';
import LearningPlanTab from './components/LearningPlanTab';
import EmployerHeader from './components/EmployerHeader';
import LoadingState from './components/LoadingState';
import { Badge, ErrorState, Metric, Panel, ProgressBar, Row, Tabs, date, hours, percent, secondaryButton, textValue } from './components/Presentation';
import './styles/employer-readdy.css';

const tabs = ['Overview', 'Progress Reviews', 'Learning Plan', 'Attendance & OTJ', 'Documents', 'Actions'] as const;
// Short query tokens a deep link (e.g. the dashboard's Action Centre) can use
// to land directly on a tab — matches Readdy's own `?tab=` scheme.
const TAB_BY_QUERY: Record<string, typeof tabs[number]> = {
  overview: 'Overview', reviews: 'Progress Reviews', plan: 'Learning Plan',
  attendance: 'Attendance & OTJ', documents: 'Documents', actions: 'Actions',
};

// Readdy AttendanceOtjTab.Stat / OtjBar composition.
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rounded-lg border border-background-200 bg-background-100/50 p-4">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">{label}</p>
    <p className={`mt-1 text-2xl font-bold ${value === 'Unavailable' ? 'text-foreground-500' : 'text-foreground-950'}`}>{value}</p>
    {sub && <p className="mt-1 text-xs text-foreground-600">{sub}</p>}
  </div>;
}
function OtjBar({ label, value, max, tone }: { label: string; value: number | null; max: number; tone: 'navy' | 'muted' | 'green' }) {
  if (value == null) return <div className="flex items-center gap-3"><span className="w-24 shrink-0 text-sm text-foreground-600">{label}</span><div className="h-2 flex-1 rounded-full bg-background-100" /><span className="w-24 shrink-0 text-right text-xs text-foreground-500">Unavailable</span></div>;
  const width = max > 0 ? Math.round((value / max) * 100) : 0;
  const barClass = tone === 'green' ? 'bg-emerald-500' : tone === 'navy' ? 'bg-foreground-950' : 'bg-background-400';
  return <div className="flex items-center gap-3">
    <span className="w-24 shrink-0 text-sm text-foreground-600">{label}</span>
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-background-200"><div className={`h-full rounded-full ${barClass}`} style={{ width: `${width}%` }} /></div>
    <span className="w-16 shrink-0 text-right text-sm font-medium text-foreground-900">{value}h</span>
  </div>;
}

function EmployerReviewSignature({
  employerId, kind, learnerId, eventKey, employerName, onSaved, onCancel,
}: {
  employerId: string; kind: string; learnerId: string; eventKey: string; employerName: string;
  onSaved: () => void; onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async (signature: string) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await signReviewAsEmployer(employerId, kind, learnerId, eventKey, { name: employerName, signature });
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the employer signature.');
    } finally {
      setSaving(false);
    }
  };
  return <section aria-label="Employer signature" className="rounded-xl border border-primary-200 bg-primary-50/40 p-4 sm:p-5">
    <div className="mb-3 flex items-start justify-between gap-3">
      <div><h4 className="text-sm font-semibold text-foreground-950">Employer signature</h4><p className="mt-1 text-sm text-foreground-600">Sign to confirm this completed Progress Review is accurate.</p></div>
      <button type="button" className={secondaryButton} onClick={onCancel} disabled={saving}>Cancel</button>
    </div>
    <SignaturePad signatoryName={employerName} onCommit={(signature) => { void save(signature); }} onCancel={onCancel} />
    {saving && <p role="status" className="mt-3 text-sm text-foreground-600">Saving signature…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </section>;
}

function ReviewView({ employerId, kind, learnerId, eventKey, onClose, onUpdated }: { employerId: string; kind: string; learnerId: string; eventKey: string; onClose: () => void; onUpdated: () => void }) {
  const [definition, setDefinition] = useState<LearnerReviewDefinition | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [openSection, setOpenSection] = useState('');
  const [signing, setSigning] = useState(false);
  const { auth } = useAuth();
  useEffect(() => {
    let active = true;
    setDefinition(null);
    setError('');
    fetchEmployerReviewInstance(employerId, kind, learnerId, eventKey).then(result => {
      if (!active) return;
      if (!result.instance || result.template.reviewTypeCode !== 'progress_review' || !result.template.visibleTo.employer) {
        setError('This Progress Review is unavailable.');
        return;
      }
      setDefinition(result);
      setOpenSection(result.sections.find(section => section.enabled)?.id || '');
    }).catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [employerId, kind, learnerId, eventKey, revision]);
  const answers = Object.fromEntries(flattenReviewFields(definition?.sections || []).filter(field => field.answer != null).map(field => [field.id, field.answer]));
  const employerSignature = definition?.signatures.employer;
  const signingStateAllows = ['awaiting-signature', 'completed'].includes(String(definition?.instance?.status || ''));
  const canEmployerSign = Boolean(
    auth.account?.role === 'employer'
    && definition?.template.reviewTypeCode === 'progress_review'
    && definition.template.visibleTo.employer
    && employerSignature?.required
    && !employerSignature.signed
    && signingStateAllows
  );
  return <Panel title="Progress Review details" icon="ri-file-list-3-line">
    <button className={secondaryButton} onClick={onClose}>Close review</button>
    {!definition && !error && <p role="status" className="text-sm text-foreground-500">Loading review…</p>}
    {error && <ErrorState message={error} retry={() => setRevision(n => n + 1)} />}
    {definition && <>
      <h3 className="text-sm font-semibold text-foreground-950">{definition.template.name}</h3>
      <ReviewFormRenderer sections={definition.sections} answers={answers} onAnswerChange={() => undefined} readOnly openSectionId={openSection} onOpenSectionChange={setOpenSection} />
      <ReviewSignatures signatures={definition.signatures} />
      {canEmployerSign && !signing && <button type="button" className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700" onClick={() => setSigning(true)}>Sign as Employer</button>}
      {signing && <EmployerReviewSignature
        employerId={employerId} kind={kind} learnerId={learnerId} eventKey={eventKey}
        employerName={auth.account?.displayName || 'Employer'} onCancel={() => setSigning(false)}
        onSaved={() => { setSigning(false); setRevision(value => value + 1); onUpdated(); }}
      />}
    </>}
  </Panel>;
}

function LearnerPage({ employerId, kind, learnerId }: { employerId: string; kind: string; learnerId: string }) {
  const { auth } = useAuth();
  const [data, setData] = useState<EmployerLearnerDetail | null>(null);
  const [summary, setSummary] = useState<EmployerLearnerSummary | null>(null);
  const [error, setError] = useState('');
  const [summaryError, setSummaryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [searchParams] = useSearchParams();
  const initialTab = TAB_BY_QUERY[searchParams.get('tab') || ''] || 'Overview';
  const [tab, setTab] = useState<typeof tabs[number]>(initialTab);
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const [plan, setPlan] = useState<import('@/api/learnerDetail').LearnerDetail | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSummaryLoading(true);
    setError('');
    setSummaryError('');
    setData(null);
    setSummary(null);
    setReviewKey(null);
    setPlan(null);
    setPlanError('');
    // Every request uses the employer-scoped API; the backend resolves ownership and learner kind.
    fetchEmployerLearner(employerId, kind, learnerId).then(result => { if (active) setData(result); })
      .catch((reason: Error) => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    fetchEmployerLearnerSummary(employerId, kind, learnerId).then(result => { if (active) setSummary(result); })
      .catch((reason: Error) => { if (active) setSummaryError(reason.message); }).finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [employerId, kind, learnerId, revision]);
  useEffect(() => {
    if ((tab !== 'Learning Plan' && tab !== 'Attendance & OTJ') || plan || planLoading || planError || !data) return;
    let active = true;
    setPlanLoading(true);
    setPlanError('');
    fetchEmployerLearnerPlan(employerId, kind, learnerId)
      .then(result => { if (active) setPlan(result); })
      .catch((reason: Error) => { if (active) setPlanError(reason.message); })
      .finally(() => { if (active) setPlanLoading(false); });
    return () => { active = false; };
  }, [tab, plan, planLoading, planError, data, employerId, kind, learnerId]);
  const learner = data?.learner;
  const modules = summary?.currentLearning.modules || [];
  const state = summary?.currentLearning.selectionState || 'unavailable';
  const reviews = data?.reviews.filter(review => review.reviewInstanceId && review.reviewType === 'progress_review') || [];
  const attendance = summary?.attendance.available ? summary.attendance : null;
  const ksb = summary?.ksb.available ? summary.ksb : null;

  const breadcrumb = <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
    <Link to={`/employers/${employerId}`} className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-primary-700 transition-colors hover:text-primary-800">
      <i className="ri-arrow-left-line" aria-hidden="true" />Dashboard
    </Link>
    <span className="text-foreground-400" aria-hidden="true">/</span>
    <span className="text-foreground-600">{learner?.name || 'Learner'}</span>
  </nav>;

  return <div className="employer-readdy min-h-screen bg-background-100">
    <EmployerHeader employer={{ name: auth.account?.displayName || 'Employer', organisationName: '' }} title={learner?.name || 'Learner'} subtitle={learner?.programme || undefined} nav={breadcrumb} />
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-6 md:py-8">
      {loading && <div role="status"><span className="sr-only">Loading learner</span><LoadingState variant="rows" count={3} /></div>}
      {error && <ErrorState message={error} retry={() => setRevision(n => n + 1)} />}
      {!loading && !error && data && <>
        <Tabs labels={tabs} selected={tab} onSelect={(name) => { setTab(name as typeof tabs[number]); setReviewKey(null); }} label="Learner sections" />

        {tab === 'Learning Plan' && <section aria-label="Learning Plan">
          <LearningPlanTab real={plan} loading={planLoading} loadError={planError || null} onRetry={() => { setPlan(null); setPlanError(''); }} />
        </section>}

        {tab === 'Progress Reviews' && <section aria-label="Progress Reviews">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold text-foreground-950">Progress Reviews</h2><span className="text-sm text-foreground-600">{reviews.length} review{reviews.length === 1 ? '' : 's'}</span></div>
          {reviews.length === 0 ? <p className="text-sm text-foreground-500">No canonical Progress Reviews available to view.</p> : <div className="space-y-3">{reviews.map(review => <div key={review.eventKey} className="rounded-lg border border-background-200 bg-background-50 p-4 md:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold text-foreground-950">{review.label}</h3><Badge>{review.completed ? 'Completed' : 'In progress'}</Badge></div>
                <p className="mt-1 text-sm text-foreground-600">{date(review.scheduledDate)}</p>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                <div className="flex items-center gap-2" aria-label="Signature progress">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${review.adminSigned ? 'bg-emerald-100 text-emerald-700' : 'bg-background-200 text-foreground-400'}`} title={review.adminSigned ? 'Coach signed' : 'Coach has not signed yet'}><i className={review.adminSigned ? 'ri-check-line' : 'ri-more-line'} aria-hidden="true" /></span>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${review.learnerSigned ? 'bg-emerald-100 text-emerald-700' : 'bg-background-200 text-foreground-400'}`} title={review.learnerSigned ? 'Learner signed' : 'Learner has not signed yet'}><i className={review.learnerSigned ? 'ri-check-line' : 'ri-more-line'} aria-hidden="true" /></span>
                  {review.employerSignatureRequired && <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${review.signed ? 'bg-emerald-100 text-emerald-700' : 'bg-background-200 text-foreground-400'}`} title={review.signed ? 'Employer signed' : 'Employer has not signed yet'}><i className={review.signed ? 'ri-check-line' : 'ri-more-line'} aria-hidden="true" /></span>}
                  <span className="ml-1 text-xs text-foreground-500">{review.employerSignatureRequired ? 'Coach · Learner · Employer' : 'Coach · Learner'}</span>
                </div>
                <button className={secondaryButton} onClick={() => setReviewKey(review.eventKey)}>View Review</button>
              </div>
            </div>
          </div>)}</div>}
          {reviewKey && <ReviewView key={reviewKey} employerId={employerId} kind={kind} learnerId={learnerId} eventKey={reviewKey} onClose={() => setReviewKey(null)} onUpdated={() => setRevision(value => value + 1)} />}
        </section>}

        {tab === 'Actions' && (() => {
          const reviewActions = reviews.filter(review => review.employerSignatureRequired && !review.signed);
          const documentActions = (data.documents || []).filter(doc => doc.signable && !doc.signed);
          const attendanceAction = attendance && (attendance.classification === 'red' || attendance.classification === 'amber') ? attendance : null;
          const total = reviewActions.length + documentActions.length + (attendanceAction ? 1 : 0);
          return <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground-950">Actions</h2>
              <p className="mt-1 text-sm text-foreground-600">Tasks and decisions requiring your attention for {learner?.name || 'this learner'}.</p>
            </div>
            <div className="rounded-lg border border-background-200 bg-background-100/50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Require Attention</p>
              <p className="mt-1 text-2xl font-bold text-foreground-950">{total}</p>
            </div>
            {total === 0 ? (
              <div className="rounded-lg border border-background-200 bg-background-50 p-8 text-center">
                <i className="ri-checkbox-circle-line text-2xl text-emerald-600" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-foreground-950">You're up to date</p>
                <p className="mt-1 text-sm text-foreground-600">There are no actions requiring your attention for {learner?.name || 'this learner'}.</p>
              </div>
            ) : <ul className="space-y-3">
              {reviewActions.map(review => <li key={review.eventKey} className="rounded-lg border border-background-200 bg-background-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-700"><i className="ri-quill-pen-line text-base" aria-hidden="true" /></span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><p className="text-sm font-semibold text-foreground-950">{review.label}</p><span className="rounded-full bg-background-100 px-2 py-0.5 text-[11px] font-medium text-foreground-500">Progress Review</span></div>
                      <p className="mt-0.5 text-sm text-foreground-600">Scheduled {date(review.scheduledDate)} · awaiting employer signature.</p>
                    </div>
                  </div>
                  <button type="button" className="shrink-0 self-start rounded-md border border-background-300 bg-background-50 px-3.5 py-1.5 text-sm font-medium text-foreground-700 hover:bg-background-100 sm:self-center" onClick={() => { setTab('Progress Reviews'); setReviewKey(review.eventKey); }}>View Review</button>
                </div>
              </li>)}
              {documentActions.map(doc => <li key={doc.id} className="rounded-lg border border-background-200 bg-background-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-700"><i className="ri-file-text-line text-base" aria-hidden="true" /></span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><p className="text-sm font-semibold text-foreground-950">{doc.label}</p><span className="rounded-full bg-background-100 px-2 py-0.5 text-[11px] font-medium text-foreground-500">Document</span></div>
                      <p className="mt-0.5 text-sm text-foreground-600">Awaiting your signature.</p>
                    </div>
                  </div>
                  <button type="button" className={`shrink-0 self-start rounded-md bg-primary-500 px-3.5 py-1.5 text-sm font-medium text-background-50 hover:bg-primary-600 sm:self-center`} onClick={() => setTab('Documents')}>Review &amp; Sign</button>
                </div>
              </li>)}
              {attendanceAction && <li className="rounded-lg border border-background-200 bg-background-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-700"><i className="ri-calendar-check-line text-base" aria-hidden="true" /></span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><p className="text-sm font-semibold text-foreground-950">Attendance concern</p><span className="rounded-full bg-background-100 px-2 py-0.5 text-[11px] font-medium text-foreground-500">Attendance</span></div>
                      <p className="mt-0.5 text-sm text-foreground-600">Attendance rate {percent(attendanceAction.ratePercent)} — below the expected level.</p>
                    </div>
                  </div>
                  <button type="button" className="shrink-0 self-start rounded-md border border-background-300 bg-background-50 px-3.5 py-1.5 text-sm font-medium text-foreground-700 hover:bg-background-100 sm:self-center" onClick={() => setTab('Attendance & OTJ')}>View Attendance</button>
                </div>
              </li>}
            </ul>}
          </div>;
        })()}

        {tab === 'Attendance & OTJ' && <div className="space-y-6">
          <section aria-label="Attendance">
            <h2 className="text-base font-semibold text-foreground-950">Attendance &amp; Absence</h2>
            {summaryLoading && <p role="status" className="mt-2 text-sm text-foreground-500">Loading attendance…</p>}
            {summaryError && <ErrorState message={`Attendance unavailable: ${summaryError}`} retry={() => setRevision(n => n + 1)} />}
            {!summaryLoading && !summaryError && <>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Attendance rate" value={attendance ? percent(attendance.ratePercent) : 'Unavailable'} />
                <Stat label="Sessions attended" value={attendance ? `${textValue(attendance.sessionsAttended)} / ${textValue(attendance.sessionsHeld)}` : 'Unavailable'} />
                <Stat label="Absences" value={textValue(attendance?.absences)} />
                <Stat label="Last attendance" value={textValue(attendance?.lastAttendanceStatus)} sub={attendance?.lastSessionDate ? date(attendance.lastSessionDate) : undefined} />
              </div>

              {!attendance ? null : attendance.classification === 'red' || attendance.classification === 'amber' ? (
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-accent-300 bg-accent-50 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-500 text-foreground-950"><i className="ri-alert-line text-lg" aria-hidden="true" /></span>
                  <div><p className="text-sm font-semibold text-foreground-950">Attendance requires attention</p><p className="text-sm text-foreground-600">This learner's attendance is below the expected level. Please discuss any concerns with the coach at the next review.</p></div>
                </div>
              ) : (
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><i className="ri-check-line text-lg" aria-hidden="true" /></span>
                  <div><p className="text-sm font-semibold text-foreground-950">Attendance on track</p><p className="text-sm text-foreground-600">No attendance concerns have been flagged for this learner.</p></div>
                </div>
              )}

              <div className="mt-4 rounded-lg border border-background-200 bg-background-50 p-4">
                <p className="text-sm font-semibold text-foreground-950">Attendance details</p>
                <dl>
                  <Row label="Sessions held">{textValue(attendance?.sessionsHeld)}</Row>
                  <Row label="Sessions attended">{textValue(attendance?.sessionsAttended)}</Row>
                  <Row label="Absences">{textValue(attendance?.absences)}</Row>
                  <Row label="Last session">{date(attendance?.lastSessionDate)}</Row>
                </dl>
                <p className="mt-2 text-xs text-foreground-500">Future and cancelled sessions are not counted as absences.</p>
              </div>
            </>}
          </section>

          <section aria-label="Off-the-job Hours">
            <h2 className="text-base font-semibold text-foreground-950">Off-the-job Hours</h2>
            {planLoading && <p role="status" className="mt-2 text-sm text-foreground-500">Loading OTJ detail…</p>}
            {planError && <ErrorState message={`OTJ detail unavailable: ${planError}`} retry={() => { setPlan(null); setPlanError(''); }} />}
            {!planLoading && !planError && <>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Actual (approved)" value={hours(summary?.otj.actualHours)} />
                <Stat label="Planned to date" value="Unavailable" />
                <Stat label="Submitted" value={hours(summary?.otj.submittedPendingHours)} />
                <Stat label="Programme target" value={hours(summary?.otj.plannedTotalHours)} />
              </div>
              <div className="mt-4 rounded-lg border border-background-200 bg-background-50 p-4">
                <p className="text-xs text-foreground-500">Planned-to-date hours are not tracked by this system yet, so the planned bar and variance below are unavailable.</p>
                <div className="mt-3 space-y-3">
                  <OtjBar label="Planned" value={null} max={Math.max(summary?.otj.submittedPendingHours ?? 0, summary?.otj.actualHours ?? 0, 1)} tone="muted" />
                  <OtjBar label="Submitted" value={summary?.otj.submittedPendingHours ?? null} max={Math.max(summary?.otj.submittedPendingHours ?? 0, summary?.otj.actualHours ?? 0, 1)} tone="navy" />
                  <OtjBar label="Actual" value={summary?.otj.actualHours ?? null} max={Math.max(summary?.otj.submittedPendingHours ?? 0, summary?.otj.actualHours ?? 0, 1)} tone="green" />
                </div>
                <div className="mt-4 flex items-center justify-between rounded-md bg-background-100/70 px-3 py-2">
                  <span className="text-sm text-foreground-600">Variance</span>
                  <span className="text-sm font-semibold text-foreground-500">Unavailable</span>
                </div>
              </div>
              <p className="mt-4 text-sm font-semibold text-foreground-800">Recorded activity history</p>
              {plan?.activityFeed?.length ? <div className="divide-y divide-background-100">{plan.activityFeed.map((item, index) => <div key={`${item.componentId || item.title}-${index}`} className="py-3"><p className="text-sm font-medium text-foreground-900">{item.title}</p><p className="text-xs text-foreground-500">{item.action} · {date(item.at)}</p></div>)}</div> : <p className="mt-2 text-sm text-foreground-500">No OTJ activity history available.</p>}
            </>}
          </section>
        </div>}

        {tab === 'Documents' && (kind === 'apprenticeship' || kind === 'commercial') && <EmployerDocuments documents={data.documents} employerName={data.employer.name} kind={kind} learnerId={learnerId} onReload={() => setRevision(n => n + 1)} />}

        {tab === 'Overview' && <>
          {summaryLoading && <p role="status" className="text-sm text-foreground-500">Loading learner summary…</p>}
          {summaryError && <ErrorState message={`Summary unavailable: ${summaryError}`} retry={() => setRevision(n => n + 1)} />}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="Current Module Progress" icon="ri-book-open-line" value={state === 'multiple' ? 'Multiple active modules' : state !== 'unavailable' && modules[0]?.available ? percent(modules[0].progressPercent) : 'Unavailable'} />
            <Metric label="Attendance" icon="ri-calendar-check-line" value={attendance ? percent(attendance.ratePercent) : 'Attendance unavailable'} detail={attendance ? `${textValue(attendance.sessionsAttended)} of ${textValue(attendance.sessionsHeld)} sessions attended` : undefined} />
            <Metric label="Absences" icon="ri-calendar-close-line" value={textValue(attendance?.absences)} detail={attendance?.lastAttendanceStatus ? `Last: ${attendance.lastAttendanceStatus} · ${date(attendance.lastSessionDate)}` : undefined} />
            <Metric label="Off-the-job Hours" icon="ri-time-line" value={hours(summary?.otj.actualHours)} detail={<>Pending <span>{hours(summary?.otj.submittedPendingHours)}</span><span className="block">Programme planned <span>{hours(summary?.otj.plannedTotalHours)}</span></span></>} />
            <Metric label="KSB Activity Coverage" icon="ri-shield-check-line" value={ksb ? `${textValue(ksb.achieved)} / ${textValue(ksb.total)}` : 'KSB data unavailable'} detail={ksb ? `${percent(ksb.percentage)} · activity-KSB points` : undefined} />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Panel title="Programme Details" icon="ri-graduation-cap-line">
              <dl>
                <Row label="Programme">{textValue(learner?.programme)}</Row>
                <Row label="Programme status">{textValue(learner?.programmeStatus)}</Row>
                <Row label="Cohort">{textValue(learner?.cohort)}</Row>
                <Row label="Group">{textValue(summary?.programme.group)}</Row>
                <Row label="Start date">{date(learner?.startDate)}</Row>
                <Row label="Planned end date">{date(learner?.endDate)}</Row>
                <Row label="Coach">{textValue(summary?.coach.name)}</Row>
              </dl>
            </Panel>
            <Panel title="Current Learning" icon="ri-book-open-line">
              <p className="text-sm text-foreground-600">{({ current: 'Current module', next: 'Next module', last: 'Last module', multiple: 'Multiple active modules', unavailable: 'Current learning unavailable' })[state]}</p>
              {state !== 'unavailable' && modules.map((module, index) => <div key={module.moduleId || index} className="rounded-lg border border-background-200 p-3">
                <div className="flex items-baseline justify-between gap-3"><h3 className="truncate text-sm font-semibold text-foreground-950">{textValue(module.moduleName)}</h3><p className="whitespace-nowrap text-sm font-bold text-foreground-950">{module.available ? percent(module.progressPercent) : 'Unavailable'}</p></div>
                <ProgressBar value={module.available ? module.progressPercent : null} />
                <dl className="mt-2">
                  <Row label="Activities completed">{textValue(module.completedActivities)} / {textValue(module.totalActivities)}</Row>
                  <Row label="Current week / total weeks">{textValue(module.currentWeek)} / {textValue(module.totalWeeks)}</Row>
                </dl>
              </div>)}
            </Panel>
            <Panel title="Recent Activity" icon="ri-pulse-line">{summary && Object.values(summary.activity).some(Boolean) ? <dl>
              <Row label="Last LMS activity">{date(summary.activity.lastLmsActivityAt)}</Row>
              <Row label="Last submission">{date(summary.activity.lastSubmissionAt)}</Row>
              <Row label="Last live session">{date(summary.activity.lastLiveSessionAt)}</Row>
            </dl> : <p className="text-sm text-foreground-500">{summary ? 'No recent activity recorded' : 'Recent activity unavailable'}</p>}</Panel>
            <Panel title="Reviews" icon="ri-file-list-3-line">
              <dl>
                <Row label="Last progress review">{date(summary?.reviews.lastReviewDate)}</Row>
                <Row label="Next progress review">{date(summary?.reviews.nextReviewDate)}</Row>
                <Row label="Pending employer action count"><Badge>{summary?.reviews.available ? textValue(summary.reviews.pendingEmployerSignatureCount) : 'Unavailable'}</Badge></Row>
              </dl>
              {reviews.length > 0 && <div className="mt-3 space-y-3">{reviews.map(review => <div key={review.eventKey} className="rounded-lg border border-background-200 p-3 space-y-2">
                <h3 className="text-sm font-semibold text-foreground-950">{review.label}</h3>
                <p className="text-sm text-foreground-600">{date(review.scheduledDate)} · {review.employerSignatureRequired ? review.signed ? 'Employer signature recorded' : 'Employer signature required' : 'Employer signature not required'}</p>
                <button className={secondaryButton} onClick={() => setReviewKey(review.eventKey)}>View Review</button>
              </div>)}</div>}
              {reviews.length === 0 && <p className="mt-2 text-sm text-foreground-500">No canonical Progress Reviews available to view.</p>}
            </Panel>
          </div>
          {reviewKey && <ReviewView key={reviewKey} employerId={employerId} kind={kind} learnerId={learnerId} eventKey={reviewKey} onClose={() => setReviewKey(null)} onUpdated={() => setRevision(value => value + 1)} />}
        </>}
      </>}
    </main>
  </div>;
}

/**
 * Who has signed: one chip per party, ticked when they have.
 *
 * Mirrors the admin board's SignatureParties so both sides read the same way. A
 * party is omitted entirely when undefined rather than shown unsigned — a
 * compliance PDF only tracks the employer's signature, and rendering an empty
 * "Learner" cell there would imply a signature was expected and missing.
 */
function PartyChips({
  learner,
  admin,
  employer,
}: {
  learner?: boolean;
  admin?: boolean;
  employer?: boolean;
}) {
  const parties = [
    { key: 'learner', label: 'Learner', icon: 'ri-user-line', signed: learner },
    { key: 'admin', label: 'Provider', icon: 'ri-shield-user-line', signed: admin },
    { key: 'employer', label: 'You', icon: 'ri-briefcase-line', signed: employer },
  ].filter((p) => p.signed !== undefined);

  return (
    <span className="flex items-center gap-1.5">
      {parties.map((p) => (
        <span
          key={p.key}
          title={p.signed ? `${p.label} signed` : `${p.label} has not signed yet`}
          className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border whitespace-nowrap ${
            p.signed
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
              : 'bg-background-100 text-foreground-400 border-foreground-200/60'
          }`}
        >
          <i className={`${p.signed ? 'ri-check-line' : p.icon} text-[11px]`} />
          <span className="hidden sm:inline">{p.label}</span>
        </span>
      ))}
    </span>
  );
}

/** One row in the documents panel. */
function DocumentRow({
  item,
  onSign,
  onShow,
  opening,
}: {
  item: SignableItem;
  onSign: () => void;
  onShow: () => void;
  opening: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
      <span className="flex items-center gap-2.5 min-w-0">
        <i className={`${item.kind === 'review' ? 'ri-file-list-3-line' : 'ri-file-pdf-line'} text-foreground-400 shrink-0`} />
        <span className="min-w-0">
          <span className="text-[13px] text-foreground-800 font-medium block truncate" title={item.label}>{item.label}</span>
          <span className="text-[11px] text-foreground-400">
            {item.kind === 'review'
              ? item.scheduledDate ? `Review · ${item.scheduledDate}` : 'Review'
              : `Document · ${fmt(item.generatedAt)}`}
            {item.signed && item.signedName ? ` · signed by ${item.signedName} on ${fmt(item.signedAt)}` : ''}
          </span>
        </span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {/* Every party the item needs, so the employer can see they aren't the
            only one outstanding. Reviews report all three; a compliance PDF
            reports the parties its own doc type asks for — the Apprenticeship
            Agreement is learner + employer, with no provider signature. */}
        {item.kind === 'review' ? (
          <PartyChips
            learner={item.learnerSigned}
            admin={item.adminSigned}
            employer={item.signed}
          />
        ) : (
          <PartyChips
            learner={item.parties?.includes('learner') ? Boolean(item.learnerSigned) : undefined}
            admin={item.parties?.includes('provider') ? Boolean(item.providerSigned) : undefined}
            employer={item.parties?.includes('employer') !== false ? item.signed : undefined}
          />
        )}
        {item.signed ? (
          <>
            {/* Opens the saved document — the signed artefact, carrying every
                party's signature. Not the sign dialog: this row is done, and
                re-opening the pad here invited an accidental re-sign. */}
            <button
              onClick={onShow}
              disabled={opening}
              className="inline-flex items-center gap-1.5 rounded-lg border border-foreground-200 px-2.5 py-1 text-[12px] font-medium text-foreground-600 transition-smooth hover:border-primary-300 hover:bg-primary-50/60 hover:text-primary-700 cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              {opening
                ? <><i className="ri-loader-4-line animate-spin" />Opening…</>
                : <><i className="ri-file-text-line text-[13px]" />Show document</>}
            </button>
          </>
        ) : item.signable ? (
          <button
            onClick={onSign}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-primary-700 transition-smooth cursor-pointer"
          >
            <i className="ri-pen-nib-line" />Sign
          </button>
        ) : (
          // A review whose questionnaire isn't finished can't be signed by
          // anyone yet — saying so beats an inert button.
          <span className="text-[11px] text-foreground-400 italic">Awaiting completion by the learner</span>
        )}
      </span>
    </div>
  );
}

/**
 * The page is one learner seen four ways. Overview is the employer's own
 * business — details and the signing queue; the other three are the learner's
 * workspace shown read-only, so employer and apprentice discuss the same plan,
 * the same hours and the same KSBs rather than two different pictures of them.
 */
type TabKey = 'overview' | 'plan' | 'otjh' | 'ksbs';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
  { key: 'plan', label: 'Learning plan', icon: 'ri-calendar-check-line' },
  { key: 'otjh', label: 'Off-the-job hours', icon: 'ri-time-line' },
  { key: 'ksbs', label: 'KSB progress', icon: 'ri-award-line' },
];

export default function EmployerLearnerPage() {
  const { employerId = '', kind: kindParam = 'apprenticeship', learnerId = '' } = useParams();
  // The URL segment is a plain string; the document APIs want the narrowed union.
  const kind: LearnerKind = kindParam === 'commercial' ? 'commercial' : 'apprenticeship';
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [data, setData] = useState<EmployerLearnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState<SignableItem | null>(null);
  const [reviewDefinition, setReviewDefinition] = useState<any>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  // The learner's own workspace payload, behind the three progress tabs. Fetched
  // once, on first use: an employer who only came to sign a document never pays
  // for it, and all three tabs read the same object afterwards.
  const [plan, setPlan] = useState<LearnerDetail | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  // Which row is mid-open, so its button can show progress. Reviews are keyed by
  // event key and documents by id — they never collide.
  const [opening, setOpening] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchEmployerLearner(employerId, kind, learnerId)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [employerId, kind, learnerId]);

  useEffect(() => {
    if (!signing || signing.kind !== 'review' || !signing.reviewInstanceId) {
      setReviewDefinition(null);
      return;
    }
    let active = true;
    fetchEmployerReviewInstance(employerId, kind, learnerId, signing.eventKey)
      .then(value => { if (active) setReviewDefinition(value); })
      .catch(() => { if (active) setReviewDefinition(null); });
    return () => { active = false; };
  }, [employerId, kind, learnerId, signing]);

  const loadPlan = () => {
    setPlanLoading(true);
    setPlanError(null);
    fetchEmployerLearnerPlan(employerId, kind, learnerId)
      .then(setPlan)
      .catch((e: Error) => setPlanError(e.message))
      .finally(() => setPlanLoading(false));
  };

  // Only when a progress tab is actually opened, and only once per learner.
  useEffect(() => {
    if (tab === 'overview' || plan || planLoading || planError) return;
    loadPlan();
  }, [tab, plan, planLoading, planError]);

  // A different learner invalidates whatever plan is held.
  useEffect(() => {
    setPlan(null);
    setPlanError(null);
    setTab('overview');
  }, [employerId, kind, learnerId]);

  const handleSign = async (name: string, signature: string) => {
    if (!signing) return;
    if (signing.kind === 'review') {
      await signReviewAsEmployer(employerId, kind, learnerId, signing.eventKey, { name, signature });
    } else if (signing.kind === 'written-agreement') {
      await signWrittenAgreementAsEmployer(learnerId, { name, signature });
    } else if (signing.kind === 'training-plan') {
      await signTrainingPlanAsEmployer(learnerId, { name, signature });
    } else if (signing.kind === 'agreement') {
      // Its own table, its own endpoint — see apprenticeship_agreement.py.
      await signAgreementAsEmployer(learnerId, { name, signature });
    } else {
      await signDocumentAsEmployer(kind, learnerId, signing.id, { name, signature });
    }
    // No reusable copy is kept: the employer's name always produces the same
    // mark, so there is nothing to save and nothing to go stale.
    success(signature ? 'Signed' : 'Signature removed', signing.label);
    load();
  };

  /**
   * Open the saved document itself — the signed artefact, not the sign dialog.
   *
   * A review is rendered client-side into the same PDF the admin board exports
   * (so it carries the Declaration block with every signature on it), while a
   * compliance PDF already exists in blob storage and just needs a download URL.
   */
  const openDocument = async (item: SignableItem) => {
    setOpening(item.kind === 'review' ? item.eventKey : item.id);
    try {
      if (item.kind === 'review') {
        const review = await fetchReviewForm(kind, learnerId, item.eventKey);
        downloadReviewPdf(review, REVIEW_QUESTION_LABELS);
      } else {
        const url = await getEnrolmentDocumentUrl(kind, learnerId, item.id);
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      toastError('Could not open the document', e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setOpening(null);
    }
  };

  const learner = data?.learner;
  const items: SignableItem[] = data ? [...data.reviews, ...data.documents] : [];
  // Unsigned first, then signable-but-unsigned before blocked ones, so the row
  // an employer can actually act on is always at the top.
  const sorted = [...items].sort((a, b) => {
    if (a.signed !== b.signed) return a.signed ? 1 : -1;
    if (a.signable !== b.signable) return a.signable ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  // The fetch is kicked off by an effect, so the first render after a tab switch
  // has neither data nor an in-flight flag yet. Treat that frame as loading too,
  // or the panels flash "nothing here" before the request has even started.
  const planPending = !plan && !planError;
  const outstanding = data?.outstandingCount ?? 0;
  // Active learners lead with performance; anyone still being set up leads with
  // the paperwork. Both panels always render.
  const documentsFirst = !learner?.isActive || outstanding > 0;

  const documentsPanel = (
    <SectionPanel
      title={outstanding > 0 ? `Documents to sign (${outstanding} outstanding)` : 'Documents'}
      icon="ri-draft-line"
      defaultOpen
    >
      {sorted.length === 0 ? (
        <p className="text-[13px] text-foreground-400 py-2">
          No documents need your signature yet. They appear here once the provider has prepared them.
        </p>
      ) : (
        <div className="divide-y divide-foreground-100 -mx-4 -my-1">
          {sorted.map((item) => (
            <DocumentRow
              key={item.kind === 'review' ? `r-${item.eventKey}` : `d-${item.id}`}
              item={item}
              onSign={() => setSigning(item)}
              onShow={() => openDocument(item)}
              opening={opening === (item.kind === 'review' ? item.eventKey : item.id)}
            />
          ))}
        </div>
      )}
    </SectionPanel>
  );

  const performancePanel = (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <StatCard icon="ri-question-answer-line" label="Quizzes taken" value={data?.performance.quizzesTaken ?? 0} tint="primary" />
        <StatCard icon="ri-check-double-line" label="Quizzes passed" value={data?.performance.quizzesPassed ?? 0} tint="emerald" />
        <StatCard
          icon="ri-percent-line"
          label="Average score"
          value={data?.performance.averageScore != null ? `${data.performance.averageScore}%` : '—'}
          tint="accent"
        />
        <StatCard icon="ri-award-line" label="KSBs evidenced" value={data?.performance.ksbsEvidenced ?? 0} tint="secondary" />
      </div>

      <SectionPanel title="Learner details" icon="ri-user-3-line" defaultOpen>
        <FieldRow readonly label="Email" value={learner?.email || '—'} />
        <FieldRow readonly label="Phone" value={learner?.phone || '—'} />
        <FieldRow readonly label="Programme" value={learner?.programme || '—'} />
        <FieldRow readonly label="Cohort" value={learner?.cohort || '—'} />
        <FieldRow readonly label="Programme status" value={learner?.programmeStatus || '—'} />
        <FieldRow readonly label="Start date" value={learner?.startDate || '—'} />
        <FieldRow readonly label="End date" value={learner?.endDate || '—'} />
      </SectionPanel>

      <SectionPanel title="Progress" icon="ri-line-chart-line" defaultOpen>
        <FieldRow readonly label="Components completed" value={String(data?.performance.componentsCompleted ?? 0)} />
        <FieldRow readonly label="Off-the-job hours logged" value={data?.performance.completedHours || '—'} />
        <FieldRow readonly label="Last activity" value={fmt(data?.performance.lastActivityAt)} />
      </SectionPanel>
    </>
  );

  return (
    <WorkspaceShell
      role="compliance"
      roleLabel={employerNav.label}
      navItems={employerNav.items}
      workspaceLabel={employerNav.workspaceLabel}
      pageTitle="Learner"
      pageSubtitle={learner?.name ?? 'Learner'}
      userName="Enrolment Officer"
      userRole="Enrolment Officer"
    >
      {/* The progress tabs render the learner's own multi-column layouts, which
          need more room than the signing queue does. */}
      <div className={`p-6 mx-auto space-y-6 ${tab === 'overview' ? 'max-w-5xl' : 'max-w-7xl'}`}>
        <div className="animate-fade-in-up">
          <Hero
            icon="ri-user-3-line"
            title={learner?.name || 'Learner'}
            subtitle={
              learner
                ? <>
                    {learner.programme || 'No programme'}
                    {learner.cohort ? ` · ${learner.cohort}` : ''}
                    {` · ${learner.programmeStatus || 'Status not set'}`}
                  </>
                : undefined
            }
            right={
              <button
                onClick={() => navigate(-1)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white/15 backdrop-blur-sm border border-white/25 text-white rounded-xl text-[13px] font-semibold hover:bg-white/25 transition-smooth cursor-pointer"
              >
                <i className="ri-arrow-left-line" />All learners
              </button>
            }
          />
        </div>

        {loading && (
          <p className="py-16 text-center text-[13px] text-foreground-400">
            <i className="ri-loader-4-line animate-spin mr-2" />Loading learner…
          </p>
        )}

        {!loading && error && (
          <div className="py-16 text-center">
            <p className="text-red-600 text-[13px] mb-3"><i className="ri-error-warning-line mr-1.5" />{error}</p>
            <button className={btnSecondary} onClick={load}><i className="ri-refresh-line" />Retry</button>
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-4">
            {outstanding > 0 && (
              <div className="rounded-xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 flex items-center gap-2.5">
                <i className="ri-error-warning-line text-amber-600 shrink-0" />
                <p className="text-[13px] text-amber-900">
                  <strong>{outstanding} document{outstanding === 1 ? '' : 's'}</strong> need your signature.
                </p>
              </div>
            )}

            <nav className="flex flex-wrap items-center gap-1.5 border-b border-foreground-100 pb-2" aria-label="Learner sections">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  aria-current={tab === t.key ? 'page' : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition-smooth cursor-pointer ${
                    tab === t.key
                      ? 'bg-primary-600 text-white'
                      : 'text-foreground-500 hover:bg-background-100 hover:text-foreground-700'
                  }`}
                >
                  <i className={`${t.icon} text-[14px]`} />{t.label}
                </button>
              ))}
            </nav>

            {tab === 'overview' && (documentsFirst
              ? <>{documentsPanel}{performancePanel}</>
              : <>{performancePanel}{documentsPanel}</>)}

            {tab !== 'overview' && planError && (
              <div className="py-16 text-center">
                <p className="text-red-600 text-[13px] mb-3"><i className="ri-error-warning-line mr-1.5" />{planError}</p>
                <button className={btnSecondary} onClick={loadPlan}><i className="ri-refresh-line" />Retry</button>
              </div>
            )}

            {/* No kind/learnerId is passed on purpose: every start/open/upload
                action in the learner's plan is gated on them, so the employer
                gets the plan and its recorded outcomes but none of the actions. */}
            {tab === 'plan' && !planError && (
              <LearnerPlanBody
                real={plan}
                loading={planPending}
                loadError={null}
                pageLabel="Learning plan"
                showHero={false}
                note={`${learner?.name || 'This learner'}'s training plan as they see it — modules, weeks and every component, with recorded quiz results.`}
              />
            )}

            {tab === 'otjh' && !planError && (
              <OtjhBody real={plan} loading={planPending} showHero={false} audience="observer" />
            )}

            {tab === 'ksbs' && !planError && (
              <KsbProgressBody real={plan} loading={planPending} showHero={false} audience="observer" />
            )}
          </div>
        )}
      </div>

      {signing && data && (
        <SignModal
          item={signing}
          employerName={data.employer.name}
          reviewDefinition={reviewDefinition}
          onClose={() => setSigning(null)}
          onSign={handleSign}
        />
      )}
    </WorkspaceShell>
  );
}
