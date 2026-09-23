import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import type { LearnerKind } from '@/api/learnerDetail';
import { fetchEvidence, type EvidenceRecord } from '@/api/evidence';
import { AssignmentEvidence } from '@/components/feature/AssignmentEvidence';
import { AssignmentAttemptHistory } from '@/components/feature/AssignmentAttemptHistory';
import type { SubmissionAttempt } from '@/api/assignmentAttempts';
import { loadLearningReflectionSubmission, saveLearningReflectionSubmission, type LearningReflectionSubmissionInput } from '@/api/reflectionSubmission';
import { checkMonthlyAssignment, emptyMonthlyAssignment, type AssignmentQualityCheck } from '@/api/monthlyAssignment';
import { MonthlyAnswerField, MonthlyAssignmentSteps } from '../video-watch/MonthlyAssignmentSteps';
import { AssignmentAiCheckContext } from '../video-watch/AssignmentAiCheckContext';
import { assignmentTimeHours } from '../video-watch/AssignmentTimeEntries';
import { useLearningStatements } from '@/hooks/useLearningStatements';
import { ExtraActivities } from './ExtraActivities';
import styles from './monthlySubmission.module.css';

const steps = ['Activity answer', 'Evidence & cross-referencing', 'KSBs & hours claimed', 'Quality checks'];
const monthNow = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).format(new Date());
export default function ExtraActivityPage() {
  const { kind: routeKind, id: routeId } = useParams();
  const { kind, id } = useResolvedLearner(routeKind, routeId);
  const [query] = useSearchParams();
  if (!id || (kind !== 'commercial' && kind !== 'apprenticeship')) return <p>Loading learner...</p>;
  return <ExtraActivityForm key={`${kind}:${id}:${query.get('activity') || 'new'}`} kind={kind} learnerId={id} savedId={query.get('activity')} />;
}
export function ExtraActivityForm({ kind, learnerId, savedId }: { kind: LearnerKind; learnerId: string; savedId: string | null }) {
  const { real } = useLearnerDetailParam(kind, learnerId);
  const [activityId] = useState(() => savedId || `extra:${crypto.randomUUID()}`);
  const [title, setTitle] = useState('');
  const [answers, setAnswers] = useState({ assignmentAnswer: '', whatYouLearned: '', businessImpact: '' });
  const [monthly, setMonthly] = useState(() => emptyMonthlyAssignment([], monthNow()));
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState('draft');
  const [attempts, setAttempts] = useState<SubmissionAttempt[]>([]);
  const [files, setFiles] = useState<EvidenceRecord[]>([]);
  const [loading, setLoading] = useState(Boolean(savedId));
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checks, setChecks] = useState<AssignmentQualityCheck[]>([]);
  const [outsideConfirmed, setOutsideConfirmed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [failedSnapshot, setFailedSnapshot] = useState('');
  const [savedVersion, setSavedVersion] = useState(0);
  const [evidenceVersion, setEvidenceVersion] = useState(0);
  const requestRunning = useRef(false);
  const locked = ['accepted', 'submitted_for_tutor_review'].includes(status);
  const disabled = locked || busy || loading || loadFailed;
  useEffect(() => {
    if (!savedId) return;
    let active = true;
    void loadLearningReflectionSubmission({ learnerKind: kind, learnerId, activityType: 'extra_activity', activityId })
      .then(value => {
        if (!active) return;
        if (!value) throw new Error('Extra activity not found.');
        setTitle(value.activityTitle); setAnswers({ assignmentAnswer: value.assignmentAnswer || '', whatYouLearned: value.whatYouLearned || '', businessImpact: '' });
        setStatus(value.status); setAttempts(value.submissionAttempts || []);
        if (value.monthlyAssignment) { setMonthly({ ...value.monthlyAssignment, ...(!['accepted', 'submitted_for_tutor_review'].includes(value.status) ? { month: monthNow() } : {}) }); setStep(Math.min(3, value.monthlyAssignment.step || 0)); }
        setOutsideConfirmed(Boolean(value.outsideWorkingHoursConfirmed));
      }).catch(reason => { if (active) { setLoadFailed(true); setError(String(reason.message || reason)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [savedId, kind, learnerId, activityId]);
  useEffect(() => {
    const controller = new AbortController();
    void fetchEvidence(kind, learnerId, { sectionRef: activityId, signal: controller.signal }).then(setFiles)
      .catch(() => { if (!controller.signal.aborted) setError('Could not load evidence. Please reload before submitting.'); });
    return () => controller.abort();
  }, [kind, learnerId, activityId, evidenceVersion]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty && !locked) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, locked]);
  const changed = () => { setChecks([]); setDirty(true); setNotice(''); setSaveState('idle'); };
  const generation = useLearningStatements(answers.assignmentAnswer, learnerId, kind, activityId, step === 0 && !disabled,
    { whatYouLearned: answers.whatYouLearned, understood: monthly.understood, gainedSkills: monthly.gainedSkills }, result => {
      changed(); setAnswers(value => ({ ...value, whatYouLearned: result.whatYouLearned ?? value.whatYouLearned }));
      setMonthly(value => ({ ...value, understood: result.understood ?? value.understood, gainedSkills: result.gainedSkills ?? value.gainedSkills }));
    });
  const payload = (mode: 'draft' | 'submit'): LearningReflectionSubmissionInput => ({
    learnerKind: kind, learnerId, learnerName: real?.name || '', programmeName: real?.programme || '', activityType: 'extra_activity', activityId,
    activityTitle: title, moduleTitle: '', weekTitle: '', plannedOtjh: '', learningReflection: answers.whatYouLearned || answers.assignmentAnswer,
    ksbCodes: monthly.claims.map(claim => claim.code), ksbWeights: {}, ksbExplanations: Object.fromEntries(monthly.claims.map(claim => [claim.code, claim.explanation])),
    confidenceBefore: {}, confidenceAfter: {}, applicationType: 'extra_activity', applicationText: answers.assignmentAnswer,
    evidenceFiles: monthly.evidence.map(file => file.name), evidenceConsentConfirmed: monthly.sharingConsent,
    selectedBenefits: [], benefitExplanation: '', actualTimeHours: String(assignmentTimeHours(monthly.timeEntries)),
    completedDuringPaidHours: monthly.paidHours ? 'yes' : 'no', dateCompleted: '', otjhConfirmed: mode === 'submit', signedDeclaration: mode === 'submit',
    qualityScore: 0, submissionMode: mode, ...answers, monthlyAssignment: { ...monthly, step },
    outsideWorkingHours: !monthly.paidHours, outsideWorkingHoursConfirmed: outsideConfirmed, assignmentTimeSource: 'input',
  });
  const snapshot = JSON.stringify(payload('draft'));
  const latest = useRef(snapshot); latest.current = snapshot;
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  useEffect(() => {
    if (!dirty || disabled || savingDraft || snapshot === failedSnapshot) return;
    const timer = window.setTimeout(() => { void saveRef.current(); }, 900);
    return () => window.clearTimeout(timer);
  }, [snapshot, dirty, disabled, savingDraft, failedSnapshot]);
  async function runChecks() {
    const checked = latest.current;
    setChecks([]); setError('');
    const result = await checkMonthlyAssignment(payload('draft'));
    if (checked !== latest.current) return false;
    if (result.length !== 8 || result.some(item => typeof item.passed !== 'boolean')) throw new Error('Could not verify all requirements. Please retry.');
    setChecks(result); return result.every(item => item.passed);
  }
  async function save(mode: 'draft' | 'submit') {
    if (requestRunning.current || disabled) return false;
    requestRunning.current = true;
    const savingSnapshot = latest.current;
    if (mode === 'draft') { setSavingDraft(true); setSaveState('saving'); }
    else setBusy(true);
    setError('');
    try {
      if (mode === 'submit' && !await runChecks()) return false;
      const result = await saveLearningReflectionSubmission(payload(mode));
      setStatus(result.status); setAttempts(result.submissionAttempts || attempts);
      if (savingSnapshot === latest.current) { setDirty(false); setSaveState('saved'); }
      else setSaveState('idle');
      setFailedSnapshot('');
      setSavedVersion(value => value + 1);
      if (mode === 'submit') setNotice("Extra activity submitted. It now appears in this month's full-month reflection, awaiting coach review.");
      return true;
    } catch (reason) {
      if (mode === 'draft') { setFailedSnapshot(savingSnapshot); setSaveState('error'); }
      setError(reason instanceof Error ? reason.message : 'Could not save extra activity.'); return false;
    }
    finally { requestRunning.current = false; setBusy(false); setSavingDraft(false); }
  }
  saveRef.current = () => save('draft');
  const nav = roleNavMap.learner;
  return <WorkspaceShell role="learner" roleLabel={nav.label} navItems={nav.items} workspaceLabel={nav.workspaceLabel} pageTitle="Extra activity" pageSubtitle="Record additional learning and supporting evidence" userName={real?.name || 'Learner'} userRole="Learner">
    <main className={`page-container ${styles.extraPage}`}>
      <Link to={`/learner/monthly-submission/${kind}/${learnerId}`} onClick={event => { if (dirty && !window.confirm('Leave without saving your changes?')) event.preventDefault(); }}>Back to monthly submission</Link>
      <header className={styles.extraHeader}><div><p className={styles.eyebrow}>Monthly learning</p><h1>Extra activity</h1>
      <p>Record your learning, add evidence and claim your KSBs and hours.</p><p>Your submission month is based on the date you submit (UK time).</p></div>
      <div className={styles.extraSave}><span role="status" data-state={saveState}>{locked ? 'Submitted work' : savingDraft ? 'Saving draft...' : saveState === 'error' ? 'Draft not saved — please retry' : dirty ? 'Unsaved changes' : saveState === 'saved' ? 'Draft saved' : 'Changes save automatically'}</span>
        <button type="button" className={styles.secondary} disabled={disabled || savingDraft} onClick={() => void save('draft')}>{saveState === 'error' ? 'Retry save' : 'Save draft'}</button></div></header>
      {loading && <p role="status">Loading extra activity...</p>}
      {notice && <p role="status" className="rounded-xl bg-green-50 p-4 text-green-900">{notice}</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
      {locked && <p>This activity is {status === 'accepted' ? 'accepted' : 'awaiting coach review'}. Your submitted work is read-only.</p>}
      <AssignmentAttemptHistory attempts={attempts} />
      <section className={styles.extraForm} aria-label="Extra activity form">
      <div className={styles.extraSteps}><div className={styles.extraStepHeading}><strong>Step {step + 1} of 4</strong><span>{steps[step]}</span></div>
      <div className={styles.extraProgress} aria-hidden="true"><span style={{ width: `${(step + 1) * 25}%` }} /></div>
      <nav aria-label="Extra activity steps">{steps.map((label, index) => <button key={label} type="button" aria-current={index === step ? 'step' : undefined} className={index === step ? styles.primary : styles.secondary} onClick={() => setStep(index)}>{index + 1}. {label}</button>)}</nav></div>
      <div className={styles.extraContent}>
      <AssignmentAiCheckContext.Provider value={{ learnerId, learnerKind: kind, enabled: !disabled }}>
        {step === 0 && <section className="space-y-5">
          <label className="block">Activity title<input className="mt-2 block w-full rounded-xl border p-3" value={title} disabled={disabled} onChange={event => { changed(); setTitle(event.target.value); }} /></label>
          <MonthlyAnswerField title={title} label="Describe your extra activity (at least 120 words)" minimumWords={120} value={answers.assignmentAnswer} disabled={disabled} onChange={value => { changed(); setAnswers(current => ({ ...current, assignmentAnswer: value })); }} generation={{ enabled: generation.canGenerate, busy: generation.generating, onGenerate: () => void generation.generate() }} />
          {generation.status && <p role="status">{generation.status}</p>}
          <MonthlyAnswerField title={title} label="What I learned (at least 20 words)" minimumWords={20} value={answers.whatYouLearned} disabled={disabled} onChange={value => { changed(); setAnswers(current => ({ ...current, whatYouLearned: value })); }} />
          {(['understood', 'gainedSkills'] as const).map(key => <MonthlyAnswerField key={key} title={title} label={key === 'understood' ? 'What I understood (at least 20 words)' : 'Skills I gained (at least 20 words)'} minimumWords={20} value={monthly[key]} disabled={disabled} onChange={value => { changed(); setMonthly(current => ({ ...current, [key]: value })); }} />)}
        </section>}
        {(step === 1 || step === 2) && <MonthlyAssignmentSteps step={step} data={monthly} onChange={update => { changed(); setMonthly(update); }} answers={answers} onAnswer={(key, value) => { changed(); setAnswers(current => ({ ...current, [key]: value })); }}
          kind={kind} learnerId={learnerId} title={title} plannedOtjh={null} mappings={[]} evidenceFiles={files} evidenceUploader={<AssignmentEvidence kind={kind} learnerId={learnerId} componentId={activityId} trainingPlanDetails={{}} onUploaded={() => { changed(); setEvidenceVersion(value => value + 1); }} readOnly={disabled} />} timeControl={null} disabled={disabled} payload={() => payload('draft')} checks={checks} checking={busy} onCheck={runChecks} onSave={() => save('draft')} activityId={activityId} />}
        {step === 2 && !monthly.paidHours && <label className="flex gap-2"><input type="checkbox" checked={outsideConfirmed} disabled={disabled} onChange={event => { changed(); setOutsideConfirmed(event.target.checked); }} />I confirm this learning took place outside my working hours.</label>}
      </AssignmentAiCheckContext.Provider>
      {step === 3 && <section className={styles.extraChecks}><h2>Ready to submit?</h2><p>Run the checks, then select any result to review or correct that part of your activity.</p>
        <button type="button" className={styles.secondary} disabled={disabled} onClick={() => { setBusy(true); void runChecks().catch(reason => setError(reason.message)).finally(() => setBusy(false)); }}>Run quality checks</button>
        {!checks.length && <p className={styles.extraCheckEmpty}>Checks have not been run for your latest changes.</p>}
        {checks.map(check => <button type="button" key={check.key} aria-label={`${check.passed ? 'Passed' : 'Needs attention'}: ${check.label}`} className={styles.extraCheck} data-passed={check.passed} onClick={() => setStep(['title', 'answer', 'learning'].includes(check.key) ? 0 : check.key === 'evidence' ? 1 : 2)}><span><strong>{check.passed ? 'Passed' : 'Needs attention'}</strong><span>{check.label}</span></span><span aria-hidden="true">→</span></button>)}
      </section>}
      </div><footer className={styles.extraFooter}><button type="button" className={styles.secondary} disabled={step === 0} onClick={() => setStep(value => value - 1)}>Back</button>
        {step === 3 ? <button type="button" className={styles.primary} disabled={disabled || savingDraft || checks.length !== 8 || checks.some(check => !check.passed)} onClick={() => void save('submit')}>Submit extra activity</button>
          : <button type="button" className={styles.primary} onClick={() => setStep(value => value + 1)}>Next</button>}</footer></section>
      <section className={styles.extraHistory}><ExtraActivities key={savedVersion} kind={kind} learnerId={learnerId} /></section>
    </main>
  </WorkspaceShell>;
}
