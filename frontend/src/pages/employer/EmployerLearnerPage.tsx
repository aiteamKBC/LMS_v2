import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { downloadEmployerReviewPdf, fetchEmployerLearner, fetchEmployerLearnerPlan, fetchEmployerLearnerSummary, fetchEmployerReviewInstance, signReviewAsEmployer, type EmployerLearnerDetail, type EmployerLearnerSummary } from '@/api/employerPortal';
import type { LearnerReviewDefinition } from '@/api/learnerCalendar';
import { flattenReviewFields } from '@/api/reviewInstances';
import { ReviewFormRenderer } from '@/components/reviews/ReviewFormRenderer';
import { ReviewPdfDownload } from '@/components/reviews/ReviewPdfDownload';
import { ReviewSignatures } from '@/components/reviews/ReviewSignatures';
import { EmployerDocuments } from './EmployerDocuments';
import { SignaturePad } from '@/pages/users/wizard/steps/SignaturePad';
import LearningPlanTab from './components/LearningPlanTab';
import EmployerHeader from './components/EmployerHeader';
import LoadingState from './components/LoadingState';
import { Badge, ErrorState, Metric, Panel, ProgressBar, Row, Tabs, date, hours, percent, secondaryButton, textValue } from './components/Presentation';
import './styles/employer-readdy.css';

const tabs = ['Overview', 'Progress Reviews', 'Learning Plan', 'Attendance & OTJ', 'Documents'] as const;
// Short query tokens a deep link (e.g. the dashboard's Action Centre) can use
// to land directly on a tab — matches Readdy's own `?tab=` scheme.
const TAB_BY_QUERY: Record<string, typeof tabs[number]> = {
  overview: 'Overview', reviews: 'Progress Reviews', plan: 'Learning Plan',
  attendance: 'Attendance & OTJ', documents: 'Documents',
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
    <span className="w-16 shrink-0 text-right text-sm font-medium text-foreground-900">{hours(value)}</span>
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
      <ReviewPdfDownload availability={definition.pdf} onDownload={() => downloadEmployerReviewPdf(employerId, kind, learnerId, eventKey)} />
      {canEmployerSign && !signing && <button type="button" className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700" onClick={() => setSigning(true)}>Sign as Employer</button>}
      {signing && <EmployerReviewSignature
        employerId={employerId} kind={kind} learnerId={learnerId} eventKey={eventKey}
        employerName={auth.account?.displayName || 'Employer'} onCancel={() => setSigning(false)}
        onSaved={() => { setSigning(false); setRevision(value => value + 1); onUpdated(); }}
      />}
    </>}
  </Panel>;
}

/**
 * The page itself: the learner, read-only, behind the five employer tabs.
 *
 * Routed via the default export below, which reads the ids off the URL and
 * remounts this on a learner change so no state crosses between learners.
 */
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
  // Guards the learner-plan fetch below against firing twice. Deliberately a
  // ref, not state: `planLoading` as a dependency re-ran that effect the moment
  // it was set, and the cleanup flipped `active` to false on the in-flight
  // request, so every handler — the one clearing the spinner included — was
  // skipped when it resolved and the section stayed on "Loading OTJ detail…".
  const planRequested = useRef(false);
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
    // Reloading the learner discards the plan, so allow it to be requested again.
    planRequested.current = false;
    // Every request uses the employer-scoped API; the backend resolves ownership and learner kind.
    fetchEmployerLearner(employerId, kind, learnerId).then(result => { if (active) setData(result); })
      .catch((reason: Error) => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    fetchEmployerLearnerSummary(employerId, kind, learnerId).then(result => { if (active) setSummary(result); })
      .catch((reason: Error) => { if (active) setSummaryError(reason.message); }).finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [employerId, kind, learnerId, revision]);
  useEffect(() => {
    if ((tab !== 'Learning Plan' && tab !== 'Attendance & OTJ') || plan || planError || !data || planRequested.current) return;
    let active = true;
    planRequested.current = true;
    setPlanLoading(true);
    setPlanError('');
    fetchEmployerLearnerPlan(employerId, kind, learnerId)
      .then(result => { if (active) setPlan(result); })
      .catch((reason: Error) => { if (active) setPlanError(reason.message); })
      .finally(() => { if (active) setPlanLoading(false); });
    return () => { active = false; };
  }, [tab, plan, planError, data, employerId, kind, learnerId]);
  const learner = data?.learner;
  const modules = summary?.currentLearning.modules || [];
  const state = summary?.currentLearning.selectionState || 'unavailable';
  const reviews = data?.reviews.filter(review => review.reviewInstanceId && review.reviewType === 'progress_review') || [];
  const attendance = summary?.attendance.available ? summary.attendance : null;
  const variance = summary?.otj.varianceToDateHours ?? null;
  // One scale for all three OTJ bars, so their lengths stay comparable.
  const otjMax = Math.max(summary?.otj.submittedPendingHours ?? 0, summary?.otj.actualHours ?? 0, summary?.otj.plannedToDateHours ?? 0, 1);
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
          <LearningPlanTab real={plan} loading={planLoading} loadError={planError || null} onRetry={() => { planRequested.current = false; setPlan(null); setPlanError(''); }} />
        </section>}

        {tab === 'Progress Reviews' && <section aria-label="Progress Reviews">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold text-foreground-950">Progress Reviews</h2><span className="text-sm text-foreground-600">{reviews.length} review{reviews.length === 1 ? '' : 's'}</span></div>
          {reviews.length === 0 ? <p className="text-sm text-foreground-500">No canonical Progress Reviews available to view.</p> : <div className="space-y-3">{reviews.map(review => <div key={review.eventKey} className="space-y-3"><div className="rounded-lg border border-background-200 bg-background-50 p-4 md:p-5">
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
          </div>
            {/* The details open directly under the review that was clicked, not after the whole list. */}
            {reviewKey === review.eventKey && <ReviewView key={reviewKey} employerId={employerId} kind={kind} learnerId={learnerId} eventKey={reviewKey} onClose={() => setReviewKey(null)} onUpdated={() => setRevision(value => value + 1)} />}
          </div>)}</div>}
        </section>}

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
            {planError && <ErrorState message={`OTJ detail unavailable: ${planError}`} retry={() => { planRequested.current = false; setPlan(null); setPlanError(''); }} />}
            {!planLoading && !planError && <>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Actual (approved)" value={hours(summary?.otj.actualHours)} />
                <Stat label="Planned to date" value={hours(summary?.otj.plannedToDateHours)} sub={summary?.otj.plannedToDateAvailable ? 'Pro-rata across programme dates' : undefined} />
                <Stat label="Submitted" value={hours(summary?.otj.submittedPendingHours)} />
                <Stat label="Programme target" value={hours(summary?.otj.plannedTotalHours)} />
              </div>
              <div className="mt-4 rounded-lg border border-background-200 bg-background-50 p-4">
                <p className="text-xs text-foreground-500">{summary?.otj.plannedToDateAvailable ? 'Planned-to-date is spread evenly across the programme dates. A plan that front- or back-loads hours will sit either side of it by design.' : 'Planned-to-date needs the programme start and end dates, so the planned bar and variance below are unavailable.'}</p>
                <div className="mt-3 space-y-3">
                  <OtjBar label="Planned" value={summary?.otj.plannedToDateHours ?? null} max={otjMax} tone="muted" />
                  <OtjBar label="Submitted" value={summary?.otj.submittedPendingHours ?? null} max={otjMax} tone="navy" />
                  <OtjBar label="Actual" value={summary?.otj.actualHours ?? null} max={otjMax} tone="green" />
                </div>
                <div className="mt-4 flex items-center justify-between rounded-md bg-background-100/70 px-3 py-2">
                  <span className="text-sm text-foreground-600">Variance</span>
                  <span className={`text-sm font-semibold ${variance == null ? 'text-foreground-500' : variance < 0 ? 'text-accent-700' : 'text-emerald-700'}`}>{variance == null ? 'Unavailable' : variance < 0 ? `${hours(Math.abs(variance))} behind plan` : `${hours(variance)} ahead of plan`}</span>
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


export default function EmployerLearnerPage() {
  const { employerId = '', kind = 'apprenticeship', learnerId = '' } = useParams();
  // Keyed on the learner: navigating between two learners must not leave the
  // previous one's summary, reviews or open modal on screen while the new one
  // loads. A remount clears all of it in one step.
  return <LearnerPage key={`${employerId}:${kind}:${learnerId}`} employerId={employerId} kind={kind} learnerId={learnerId} />;
}
