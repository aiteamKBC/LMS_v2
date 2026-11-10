import { useEffect, useId, useState, type ReactNode } from 'react';
import { loadLearningReflectionSubmission, type StoredLearningReflectionSubmission } from '@/api/reflectionSubmission';
import { formatSystemTimestamp } from '@/lib/format';
import { markingVerdict } from '@/lib/markingVerdict';
import { formatClock } from './ReflectionWindow.helpers';

interface SavedReflectionProps {
  learnerKind: 'commercial' | 'apprenticeship';
  learnerId: string;
  activityType: string;
  activityId: string;
  timeOnly?: boolean;
}

/** Read the submitted document without starting the editable reflection flow. */
export function SavedReflection(props: SavedReflectionProps) {
  return <SavedReflectionForActivity key={JSON.stringify([props.learnerKind, props.learnerId, props.activityType, props.activityId])} {...props} />;
}

function SavedReflectionForActivity(props: SavedReflectionProps) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <section aria-label="Saved reflection" className="mt-4 rounded-xl border border-background-300 bg-white p-4">
      <button type="button" aria-expanded={open} aria-controls={contentId}
        onClick={() => setOpen(value => !value)}
        className="rounded-lg text-sm font-semibold text-primary-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
        {props.timeOnly ? open ? 'Hide reflection time history' : 'View reflection time history' : open ? 'Hide saved reflection' : 'View saved reflection'}
      </button>
      <div id={contentId}>
        {open && <SavedReflectionContent {...props} />}
      </div>
    </section>
  );
}

function SavedReflectionContent({ learnerKind, learnerId, activityType, activityId, timeOnly }: SavedReflectionProps) {
  const [state, setState] = useState<{
    loading: boolean; error: string; submission: StoredLearningReflectionSubmission | null;
  }>({ loading: true, error: '', submission: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ loading: true, error: '', submission: null });
    void loadLearningReflectionSubmission({ learnerKind, learnerId, activityType, activityId }, { revalidate: true })
      .then(submission => { if (active) setState({ loading: false, error: '', submission }); })
      .catch(error => {
        if (active) setState({ loading: false, submission: null,
          error: error instanceof Error ? error.message : 'Could not load your saved reflection.' });
      });
    return () => { active = false; };
  }, [learnerKind, learnerId, activityType, activityId, revision]);

  if (state.loading) return <p role="status" className="mt-3 text-sm text-foreground-500">Loading your saved reflection...</p>;
  if (state.error) return <div className="mt-3">
    <p role="alert" className="text-sm text-red-700">{state.error}</p>
    <button type="button" className="mt-2 text-sm font-semibold text-primary-700 underline"
      onClick={() => setRevision(value => value + 1)}>Retry saved reflection</button>
  </div>;
  const saved = state.submission;
  if (!saved) return <p role="status" className="mt-3 text-sm text-foreground-500">No saved reflection was found for this activity.</p>;
  if (timeOnly) return <ReflectionTimeHistory saved={saved} />;
  const verdict = markingVerdict(saved.status);
  const hours = saved.actualTimeHours?.trim() ? Number(saved.actualTimeHours) : NaN;
  const confirmed = (value: boolean | undefined) => value == null ? 'Not recorded' : value ? 'Confirmed' : 'Not confirmed';
  return (
    <div className="mt-4 space-y-4 text-sm text-foreground-700">
      <h2 className="font-heading text-lg font-bold text-foreground-900">Saved reflection</h2>
      {saved.activityTitle && <p className="font-semibold">{saved.activityTitle}</p>}
      <p className="text-xs text-foreground-500">Your saved information is shown below for review.</p>
      <dl className="grid gap-3 rounded-lg bg-background-100 p-3 sm:grid-cols-2">
        <Value label="Review status">{verdict?.label || (saved.status === 'draft' ? 'Draft' : saved.status)}</Value>
        <Value label="Submitted">{saved.submittedAt ? formatSystemTimestamp(saved.submittedAt, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded'}</Value>
      </dl>
      <TextSection title="Learning reflection" text={saved.learningReflection} />
      <section>
        <h3 className="font-semibold text-foreground-900">KSBs</h3>
        {saved.ksbCodes?.length ? <ul className="mt-2 space-y-2">
          {saved.ksbCodes.map(code => <li key={code} className="rounded-lg border border-background-300 p-3">
            <p className="font-semibold">{code}{saved.ksbWeights?.[code] != null ? ` (${saved.ksbWeights[code]}%)` : ''}</p>
            <p className="mt-1 whitespace-pre-wrap break-words">{saved.ksbExplanations?.[code] || 'No explanation recorded.'}</p>
            <p className="mt-1 text-xs text-foreground-500">Confidence before: {saved.confidenceBefore?.[code] ?? 'Not recorded'}; after: {saved.confidenceAfter?.[code] ?? 'Not recorded'}</p>
          </li>)}
        </ul> : <p className="mt-1">No KSBs recorded.</p>}
      </section>
      <TextSection title="Workplace application" text={saved.applicationText} />
      {saved.applicationType === 'unsure' && <p>Support requested from your coach or employer.</p>}
      <section>
        <h3 className="font-semibold text-foreground-900">Evidence</h3>
        {saved.evidenceFiles?.length ? <ul className="mt-1 list-inside list-disc break-words">
          {saved.evidenceFiles.map((name, index) => <li key={`${index}:${name}`}>{name}</li>)}
        </ul> : <p className="mt-1">No evidence files recorded.</p>}
      </section>
      <TextSection title="Employer and business benefit" text={saved.benefitExplanation} />
      {!!saved.selectedBenefits?.length && <p>{saved.selectedBenefits.join(', ')}</p>}
      <dl className="grid gap-3 rounded-lg bg-background-100 p-3 sm:grid-cols-2">
        <Value label="Planned time">{saved.plannedOtjh || 'Not recorded'}</Value>
        <Value label={saved.lectureReflectionTime ? 'Recorded activity total' : 'Recorded time'}>{saved.lectureReflectionTime
          ? formatClock(saved.lectureReflectionTime.countedSeconds)
          : Number.isFinite(hours) && hours >= 0 ? formatClock(Math.round(hours * 3600)) : 'Not recorded'}</Value>
        {saved.lectureReflectionTime && <Value label="Additional reflection time added">{formatClock(saved.lectureReflectionTime.seconds)}</Value>}
        <Value label="Date completed">{saved.dateCompleted || 'Not recorded'}</Value>
        <Value label="Completed during paid hours">{saved.completedDuringPaidHours === 'yes' ? 'Yes' : saved.completedDuringPaidHours === 'no' ? 'No' : 'Not recorded'}</Value>
        <Value label="OTJH confirmation">{confirmed(saved.otjhConfirmed)}</Value>
        <Value label="Signed declaration">{confirmed(saved.signedDeclaration)}</Value>
        <Value label="Evidence consent">{confirmed(saved.evidenceConsentConfirmed)}</Value>
      </dl>
      <TextSection title="Coach feedback" text={saved.coachFeedback} />
      <ReflectionTimeHistory saved={saved} />
      {saved.reviewedBy && <p className="text-xs text-foreground-500">Reviewed by {saved.reviewedBy}
        {saved.reviewedAt ? ` · ${formatSystemTimestamp(saved.reviewedAt, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
      </p>}
    </div>
  );
}

function ReflectionTimeHistory({ saved }: { saved: StoredLearningReflectionSubmission }) {
  const rows = saved.lectureReflectionTimeHistory || (saved.lectureReflectionTime ? [saved.lectureReflectionTime] : []);
  const receipt = saved.lectureReflectionTime;
  if (!rows.length) return <p className="mt-3 text-sm text-foreground-600">No separate reflection writing time has been recorded.</p>;
  const stamp = (value?: string) => value && Number.isFinite(Date.parse(value))
    ? formatSystemTimestamp(value, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded';
  return <section aria-label="Reflection time history" className="mt-4 space-y-3 text-sm">
    <h3 className="font-semibold">Reflection time history</h3>
    {receipt && <p>Lecture time: {formatClock(receipt.lectureSeconds ?? Math.max(0, receipt.countedSeconds - receipt.seconds))}
      {' · '}Reflection time: {formatClock(receipt.seconds)}{' · '}Activity total: {formatClock(receipt.countedSeconds)}</p>}
    <ol className="space-y-2">{rows.map((row, index) => <li key={row.operationId || row.progressEntryId || index} className="rounded-lg border p-3">
      <p className="font-semibold">{index + 1}. {row.choice === 'correct' ? 'Time correction' : row.choice === 'retry' ? 'Another reflection attempt' : 'Additional reflection time'}</p>
      <p>{stamp(row.addedAt)}{' · '}Entered: {formatClock(row.inputSeconds ?? row.seconds)}{' · '}Reflection total: {formatClock(row.seconds)}</p>
      {row.reason && <p>Reason: {row.reason}</p>}
    </li>)}</ol>
    {saved.lectureReflectionAttempts?.map((attempt, index) => <details key={index} className="rounded-lg border p-3">
      <summary className="cursor-pointer font-semibold">Previous reflection {index + 1} · {attempt.status} · {stamp(attempt.submittedAt)}</summary>
      <p className="mt-2 whitespace-pre-wrap">{attempt.content.learningReflection || 'No reflection text recorded.'}</p>
      {attempt.coachFeedback && <p className="mt-2 whitespace-pre-wrap">Coach feedback: {attempt.coachFeedback}</p>}
    </details>)}
  </section>;
}

function Value({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs text-foreground-500">{label}</dt><dd className="mt-1 break-words font-medium">{children}</dd></div>;
}

function TextSection({ title, text }: { title: string; text?: string | null }) {
  return <section><h3 className="font-semibold text-foreground-900">{title}</h3>
    <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{text?.trim() ? text : 'Not recorded.'}</p>
  </section>;
}
