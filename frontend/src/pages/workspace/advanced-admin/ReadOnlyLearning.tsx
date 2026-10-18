import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, CheckCircle2 } from 'lucide-react';
import type { LearnerComponentEntry, LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import { advancedAdminComponent, advancedAdminComponentFileUrl, type AdvancedAdminWordPressCourse } from '@/api/advancedAdmin';
import { LearningCatalogue, LearningHero } from '@/pages/learner/my-learning/LearningCatalogue';
import { Cover, SubjectCard } from '@/pages/learner/my-learning/SubjectWorkspace';
import { Media } from '@/pages/learner/my-learning/StudentMaterial';
import { DEFAULT_MODULE_COVER } from '@/pages/learner/my-learning/moduleCover';
import { buildUnifiedLearningSummary, type SubjectEntry } from '@/pages/learner/my-learning/learningSummary';
import { subjectLearningStatus, subjectPercent } from '@/pages/learner/my-learning/subjectLearning';
import { AdminLegacyActivityContent, AdminNativeQuizReview, RichContent } from './AdminActivityContent';
import { matchedLearningSummary } from './wordpressLearning';
import styles from '@/pages/learner/my-learning/SubjectWorkspace.module.css';

type Learning = { current: LearnerDetail; historical: StudentActivityResponse };

function NativeActivity({ learnerId, entry }: { learnerId: number; entry: SubjectEntry }) {
  const componentId = entry.native?.componentId || '';
  const [component, setComponent] = useState<LearnerComponentEntry | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!componentId) return;
    const controller = new AbortController();
    setComponent(null); setError('');
    advancedAdminComponent(learnerId, componentId, controller.signal)
      .then(result => { if (!controller.signal.aborted) setComponent(result.component); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load activity.'); });
    return () => controller.abort();
  }, [learnerId, componentId]);
  if (!componentId) return <p className="p-5 text-sm text-foreground-500">This activity has no linked player.</p>;
  if (error) return <p role="alert" className="p-5 text-sm text-red-700">{error}</p>;
  if (!component) return <p role="status" className="p-5 text-sm">Loading activity…</p>;
  const fileUrl = (slot: string, original: string | null | undefined) => original?.startsWith('/curriculum_api/curriculum/uploads/')
    ? advancedAdminComponentFileUrl(learnerId, componentId, slot) : /^https?:\/\//i.test(original || '') ? original! : '';
  const files = component.files || [];
  const resource = fileUrl('resource', component.resourceUrl);
  const primaryIsFile = files.some(file => file.url === component.resourceUrl);
  const html = component.contentHtml || '';
  const assignmentHtml = component.assignmentBriefHtml || '';
  const hasContent = Boolean(component.description || html || assignmentHtml || component.assignmentBrief
    || component.reflectionPrompt || component.quizMeta || component.videoUrl || component.audioUrl || resource || files.length);
  return <div className="space-y-5 rounded-2xl border border-foreground-200 bg-white p-5">
    <div className="rounded-xl border border-primary-100 bg-primary-50 p-4"><h4 className="font-semibold">Activity progress</h4>
      <p className={`mt-1 text-sm font-semibold ${entry.completed ? 'text-emerald-700' : 'text-foreground-600'}`}>{entry.completed ? 'Complete' : 'Not complete'}</p></div>
    {component.description && <p className="text-sm leading-6 text-foreground-700">{component.description}</p>}
    {html && <RichContent value={html} />}
    {component.assignmentBrief && <section><h5 className="font-semibold">Assignment brief</h5><p className="mt-2 whitespace-pre-wrap text-sm">{component.assignmentBrief}</p></section>}
    {assignmentHtml && <section><h5 className="font-semibold">Assignment brief</h5><RichContent value={assignmentHtml} /></section>}
    {component.reflectionPrompt && <section><h5 className="font-semibold">Reflection prompt</h5><p className="mt-2 whitespace-pre-wrap text-sm">{component.reflectionPrompt}</p></section>}
    {component.quizMeta && <p className="rounded-xl bg-background-100 p-3 text-sm">Quiz · {component.quizMeta.questions ?? 'Unspecified'} questions
      {entry.bestScorePercent != null ? ` · Best recorded score ${Math.round(entry.bestScorePercent)}%` : ''}</p>}
    {component.quizMeta && <AdminNativeQuizReview learnerId={learnerId} componentId={componentId} />}
    {component.videoUrl && <Media value={fileUrl('video', component.videoUrl)} kind="video" title={entry.title} />}
    {component.audioUrl && <Media value={fileUrl('audio', component.audioUrl)} kind="audio" title={entry.title} />}
    {resource && !primaryIsFile && (/\.pdf(?:$|\?)/i.test(component.resourceUrl || '')
      ? <Media value={resource} kind="pdf" title={entry.title} fileName={component.fileName || 'material.pdf'} />
      : <a href={resource} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary-700 underline">Open learning material</a>)}
    {files.map((file, index) => {
      const url = fileUrl(`file-${index}`, file.url);
      if (!url) return null;
      return <div key={`${index}:${file.url}`} className="rounded-xl border border-foreground-200 p-3 text-sm">
        {/\.pdf(?:$|\?)/i.test(file.url) ? <Media value={url} kind="pdf" title={file.fileName || entry.title} fileName={file.fileName || 'material.pdf'} />
          : <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary-700 underline">{file.fileName || 'Open attachment'}</a>}
      </div>;
    })}
    {!hasContent && <p className="text-sm text-foreground-500">No viewable content is attached to this activity.</p>}
  </div>;
}

export default function ReadOnlyLearning({ learnerId, learning, wordpressCourses, initialSelection }: { learnerId: number; learning: Learning;
  wordpressCourses?: AdvancedAdminWordPressCourse[];
  initialSelection?: { subjectId: string; activityId: string } | null }) {
  const [search, setSearch] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState(initialSelection?.subjectId || '');
  const [selectedActivityId, setSelectedActivityId] = useState(initialSelection?.activityId || '');
  const summary = useMemo(() => wordpressCourses
    ? matchedLearningSummary(learning, wordpressCourses, true)
    : buildUnifiedLearningSummary(learning.historical, learning.current), [learning, wordpressCourses]);
  const active = summary.subjects.find(subject => subject.id === selectedSubjectId);
  const activity = active?.activities.find(item => item.id === selectedActivityId) || active?.activities[0];
  const covers = learning.historical.covers || {};
  const openSubject = (subjectId: string) => { setSelectedSubjectId(subjectId); setSelectedActivityId(''); };

  return <section className={`${styles.learningPage} space-y-5`} aria-label="Learner learning review">
    {!active ? <>
      <LearningHero />
      <LearningCatalogue summary={summary} search={search} onSearch={setSearch}
        total={summary.activityCount} done={summary.completedActivityCount} percent={summary.percent}
        covers={covers} reviewMode moduleStartDate={() => null}
        onContinue={subject => openSubject(subject.id)}
        renderCard={(subject) => <SubjectCard key={subject.id} subject={subject} cover={covers[subject.id]}
          onOpen={() => openSubject(subject.id)} template={null} csrfToken="" />} />
    </> : <>
      <button type="button" onClick={() => { setSelectedSubjectId(''); setSelectedActivityId(''); }}
        className="inline-flex items-center gap-2 text-sm font-semibold text-primary-700"><ArrowLeft size={17} />All courses</button>
      <div className="overflow-hidden rounded-2xl border border-foreground-200 bg-white">
        <Cover title={active.title} url={covers[active.id]} fallbackUrl={DEFAULT_MODULE_COVER} large />
        <div className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-700">{active.source === 'legacy' ? 'WordPress course' : 'Current LMS course'}</p>
          <h2 className="mt-1 text-2xl font-bold">{active.title}</h2></div>
          <span className="rounded-full bg-primary-50 px-3 py-1 text-sm font-semibold text-primary-800">{subjectLearningStatus(active)}</span></div>
          <div className="mt-4 flex justify-between text-sm"><span>{active.activities.filter(item => item.completed).length} of {active.activities.length} completed</span><strong>{subjectPercent(active)}%</strong></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-primary-100" role="progressbar" aria-label="Course progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={subjectPercent(active)}>
            <div className="h-full bg-primary-600" style={{ width: `${subjectPercent(active)}%` }} /></div>
          {active.recordedHistory && <p className="mt-2 text-xs text-foreground-500">Recorded activities only · Full catalogue: {active.catalogueCount ?? 0}</p>}
        </div>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-3">
          {activity ? <><div className="rounded-2xl border border-foreground-200 bg-white p-5"><p className="text-xs font-semibold uppercase tracking-wider text-primary-700">Learning activity</p>
            <h3 className="mt-1 text-xl font-bold">{activity.title}</h3><p className="mt-1 text-sm text-foreground-500">{activity.category} · {activity.completed ? 'Complete' : 'Not complete'}
              {activity.bestScorePercent != null ? ` · Best score ${Math.round(activity.bestScorePercent)}%` : ''}</p></div>
            {activity.legacy && (!activity.legacy.catalogue_kind || ['material', 'quiz'].includes(activity.legacy.catalogue_kind)) &&
              <AdminLegacyActivityContent key={`${active.id}:${activity.id}`} learnerId={learnerId}
                groupId={activity.legacy.group_id} activityId={activity.legacy.source_activity_id}
                kind={activity.legacy.catalogue_kind === 'quiz' ? 'quiz' : 'material'} completed={activity.completed} />}
            {activity.native && <NativeActivity key={`native:${active.id}:${activity.id}`} learnerId={learnerId} entry={activity} />}
            {!activity.native && (!activity.legacy || (activity.legacy.catalogue_kind && !['material', 'quiz'].includes(activity.legacy.catalogue_kind))) &&
              <p className="rounded-2xl border bg-white p-5 text-sm text-foreground-500">No viewable content is attached to this activity.</p>}
          </> : <p className="rounded-2xl border bg-white p-5">No activities are recorded for this course.</p>}
        </div>
        <aside className="rounded-2xl border border-foreground-200 bg-white p-4" aria-label="Course activities">
          <h3 className="mb-3 flex items-center gap-2 font-semibold"><BookOpen size={18} />Course content</h3>
          <div className="max-h-[70vh] space-y-1 overflow-auto">{active.activities.map(item => <button key={item.id} type="button"
            onClick={() => setSelectedActivityId(item.id)} aria-current={activity?.id === item.id ? 'true' : undefined}
            className={`flex w-full items-start gap-2 rounded-lg border p-3 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 ${activity?.id === item.id ? 'border-primary-300 bg-primary-50' : 'border-transparent hover:bg-background-100'}`}>
            <CheckCircle2 size={17} className={`mt-0.5 shrink-0 ${item.completed ? 'text-emerald-600' : 'text-foreground-300'}`} aria-hidden="true" />
            <span className="min-w-0 flex-1"><strong className="block break-words">{item.title}</strong><small className="text-foreground-500">{item.completed ? 'Complete' : 'Not complete'}</small></span>
          </button>)}</div>
        </aside>
      </div>
    </>}
  </section>;
}
