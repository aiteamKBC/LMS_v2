import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import DOMPurify from 'dompurify';
import { loadAssignmentTopicStates, selectAssignmentTopic, type AssignmentTopicState } from '@/api/assignmentTopics';
import { MONTHLY_STEPS } from '@/api/monthlyAssignment';
import { topicHasContent, topicLabel, type AssignmentTopic } from '@/lib/assignmentTopics';
import { AssignmentSubmissionForm } from './AssignmentSubmissionWizard';
import { useAssignmentTimer } from './useAssignmentTimer';
import { ActivityElapsedTimer } from './ActivityElapsedTimer';
import { AssignmentAttachment } from '../monthly-submission/AssignmentAttachment';
import { readingFiles } from './readingDownloads';

type FormProps = ComponentProps<typeof AssignmentSubmissionForm>;
const submitted = (status?: string) => ['submitted_for_tutor_review', 'accepted', 'partial'].includes(status || '');

export function TopicAssignment({ topics, ...props }: FormProps & { topics: AssignmentTopic[] }) {
  const [states, setStates] = useState<AssignmentTopicState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState('');
  const [opened, setOpened] = useState('');
  const [starting, setStarting] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const busy = useRef(false);
  const draftLoadFailed = useRef(false);
  const timer = useAssignmentTimer(`assignment-work-time:v1:${props.kind}:${props.learnerId}:${props.componentId}`);
  const identity = { learnerKind: props.kind, learnerId: props.learnerId, activityId: props.componentId };
  const draft = states.find(state => state.topicId && !submitted(state.status));
  const chosen = topics.find(topic => topic.id === selected);
  const instructionFiles = useMemo(() => readingFiles(undefined, undefined, chosen?.instructions || chosen?.question || '', chosen?.resources), [chosen]);
  const activeTopic = topics.find(topic => topic.id === opened);
  const readonly = submitted(states.find(state => state.topicId === opened)?.status);
  const complete = states.some(state => submitted(state.status));
  useEffect(() => {
    let live = true;
    setLoading(true); setError(''); draftLoadFailed.current = false;
    loadAssignmentTopicStates(identity).then(rows => {
      if (!live) return;
      setStates(rows);
      const old = rows.find(row => !row.topicId);
      if (old) { setLegacy(true); return; }
      const pending = rows.find(row => row.topicId && !submitted(row.status));
      if (pending) { setSelected(pending.topicId); timer.restore(pending.elapsedSeconds, false); }
      else timer.restore(Math.max(0, ...rows.map(row => row.elapsedSeconds || 0)), !rows.some(row => submitted(row.status)));
    }).catch(reason => { if (live) { draftLoadFailed.current = true; setError(reason instanceof Error ? reason.message : 'Could not load your topics.'); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // Identity changes remount this workflow; retry is explicitly requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.kind, props.learnerId, props.componentId, retry]);
  const begin = async () => {
    if (!chosen || busy.current || submitted(states.find(state => state.topicId === chosen.id)?.status)) return;
    if (draft && draft.topicId !== chosen.id) return;
    busy.current = true; setStarting(true); setError('');
    try {
      if (!draft) {
        await selectAssignmentTopic({ ...identity, assignmentTopicId: chosen.id, assignmentElapsedSeconds: timer.flush(),
          month: states.find(row => row.month)?.month || props.initialMonth || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/London' }).slice(0, 7),
          activityTitle: props.title, plannedOtjh: props.plannedOtjh == null ? '' : String(props.plannedOtjh),
          learnerName: props.learnerName, programmeName: props.programmeName, moduleTitle: props.moduleTitle, weekTitle: props.weekTitle });
        setStates(current => [...current, { topicId: chosen.id, status: 'draft', elapsedSeconds: timer.elapsed }]);
      }
      setOpened(chosen.id); timer.resume();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start this topic.'); }
    finally { busy.current = false; setStarting(false); }
  };
  if (legacy) return <AssignmentSubmissionForm {...props} />;
  if (loading) return <p role="status" className="rounded-xl border bg-white p-6">Loading assignment topics...</p>;
  if (draftLoadFailed.current) return <div className="rounded-xl border bg-white p-6"><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></div>;
  const clock = [Math.floor(timer.elapsed / 3600), Math.floor(timer.elapsed / 60) % 60, timer.elapsed % 60].map(value => String(value).padStart(2, '0')).join(':');
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white px-5 py-3">
      <ActivityElapsedTimer time={clock} />
      <span className="text-sm text-foreground-500">Planned hours: {props.plannedOtjh ?? 'Not set'} for this assignment</span>
      {complete && <span role="status" className="text-sm font-semibold text-emerald-700">Assignment submitted - remaining topics are optional</span>}
    </div>
    {activeTopic ? <div>
      <p className="mb-3 text-sm font-semibold text-primary-700">{topicLabel(activeTopic)}</p>
      {!timer.running && !readonly && <div className="mb-3 rounded-xl border border-primary-200 bg-primary-50 p-4"><p>Your draft is saved. Resume when you are ready to continue.</p><button type="button" onClick={timer.resume} className="mt-2 rounded-lg bg-primary-600 px-4 py-2 text-white">Resume</button></div>}
      <fieldset disabled={!timer.running && !readonly} className="min-w-0">
        <AssignmentSubmissionForm {...props} key={opened}
          title={props.title}
          assignmentTopicId={opened} elapsedSeconds={timer.elapsed}
          onRestoreElapsed={seconds => timer.restore(seconds, timer.running)}
          onManualDraftSaved={timer.pause}
          onShowInstructions={() => { setOpened(''); timer.pause(); }}
          questionHtml={activeTopic.question} questionText={activeTopic.question}
          questionFileUrl={undefined} questionFileName={undefined} questionFiles={undefined}
          onSubmitProgress={answers => props.onSubmitProgress(answers)}
          onTopicSubmitted={() => {
            timer.pause();
            setStates(current => current.map(row => row.topicId === opened ? { ...row, status: 'submitted_for_tutor_review', elapsedSeconds: timer.flush() } : row));
            setOpened(''); setSelected('');
          }} />
      </fieldset>
    </div> : <div className="overflow-hidden rounded-2xl border border-background-200 bg-white">
      <div className="border-b bg-primary-50/40 p-5">
        <h2 className="font-heading text-lg font-bold">{props.title}</h2>
        <p className="mt-3 text-sm">Step 1 of 9 - Instructions</p>
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-bold text-white">1 Instructions</button>{MONTHLY_STEPS.map((label, index) => <button key={label} type="button" disabled className="rounded-lg border px-3 py-2 text-xs opacity-50">{index + 2} {label}</button>)}</div>
      </div>
      <div className="space-y-5 p-5">
        <p className="text-sm text-foreground-600">Choose a topic, read its instructions, then select Next. Finish and submit its eight steps before choosing another topic.</p>
        <div className="grid gap-3 sm:grid-cols-3">{topics.map(topic => {
          const state = states.find(row => row.topicId === topic.id);
          const locked = submitted(state?.status);
          return <div key={topic.id} className="space-y-2">
            <button type="button" disabled={locked || starting || Boolean(draft && draft.topicId !== topic.id) || !topicHasContent(topic)}
              aria-pressed={selected === topic.id} onClick={() => setSelected(topic.id)}
              className={`w-full rounded-xl border p-4 text-left disabled:cursor-not-allowed disabled:opacity-40 ${selected === topic.id ? 'border-primary-600 bg-primary-50' : 'border-background-200'}`}>
              <strong className="block">{topicLabel(topic)}</strong>
              <span className="mt-1 block text-xs">{locked ? 'Submitted - Locked' : draft?.topicId === topic.id ? 'Draft saved' : topicHasContent(topic) ? 'Available' : 'Not yet configured'}</span>
            </button>
            {locked && <button type="button" className="text-sm font-semibold text-primary-700" onClick={() => { timer.pause(); setOpened(topic.id); }}>Preview {topicLabel(topic)}</button>}
          </div>;
        })}</div>
        {chosen && <article className="space-y-4 rounded-xl border p-4">
          <h3 className="font-bold">{topicLabel(chosen)}</h3>
          <div className="rich-text-surface whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(chosen.instructions || chosen.question) }} />
          {instructionFiles.map(resource => /^(video\/)/.test(chosen.resources.find(file => file.url === resource.url)?.contentType || '') || /\.(mp4|webm|mov|m4v)(?:$|\?)/i.test(resource.fileName || '')
            ? <div key={resource.url}><p className="mb-2 text-sm font-semibold">{resource.fileName}</p><video controls preload="metadata" src={resource.url} className="max-h-96 w-full rounded-lg bg-black" /></div>
            : <AssignmentAttachment key={resource.url} url={resource.url} fileName={resource.fileName} title={resource.label || topicLabel(chosen)} defaultExpanded pdfTools />)}
        </article>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="button" disabled={!chosen || starting || !topicHasContent(chosen)} onClick={() => void begin()} className="rounded-xl bg-primary-600 px-5 py-2.5 font-bold text-white disabled:opacity-40">{starting ? 'Saving topic...' : draft ? 'Resume' : 'Next'}</button>
      </div>
    </div>}
  </section>;
}
