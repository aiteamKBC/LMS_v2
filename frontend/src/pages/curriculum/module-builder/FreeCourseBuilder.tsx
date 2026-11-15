import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  CurriculumApiError, createFreeCourseQuiz, fetchFreeCourseAuthoringCourse, unlinkFreeCourseQuiz,
  updateFreeCourseAuthoring, type FreeCourseAuthoringDocument, type FreeCourseAuthoringWeek,
} from '@/lib/curriculumApi';
import { ComponentEditor, WeekComponentRail } from '../shared/components/weekAuthoringLazy';
import { fetchComponentPointsDefaults, uploadWeekComponentResource } from '../week-builder/weekTemplateData';
import type { ModuleComponent } from './moduleAuthoringData';
import { freeCourseComponentChange, freeCourseEditorComponent, freeCourseReturnTo, freeCourseSaveInput, newFreeCourseWeek } from './freeCourseBuilderData';
import { WeekTemplateImportModal } from './WeekTemplateImportModal';
import { FreeCourseVideoScopeContext, PendingVideoFilesContext, usePendingVideoFiles } from '../shared/pendingVideoFiles';

const QuizEditor = lazy(() => import('../quiz-xml/edit/QuizEditorPanel').then(module => ({ default: module.QuizEditorPanel })));
const inputClass = 'w-full rounded-lg border border-background-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary-400';
const freeCourseTypes = ['reading', 'video', 'podcast', 'powerpoint', 'quiz', 'assignment'] as const;

/** Module Builder tools, backed exclusively by the independent Free Course document. */
export default function FreeCourseBuilder({ courseId }: { courseId: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = freeCourseReturnTo(params.get('returnTo'));
  const [stored, setStored] = useState<FreeCourseAuthoringDocument | null>(null);
  const [draft, setDraft] = useState<FreeCourseAuthoringDocument | null>(null);
  const [weekId, setWeekId] = useState('');
  const [componentId, setComponentId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');
  const busy = useRef(false);
  const [quiz, setQuiz] = useState<{ id: number; componentId: string; revision: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [points, setPoints] = useState<Partial<Record<ModuleComponent['type'], number>>>({});
  const videoFiles = usePendingVideoFiles(courseId);
  const dirty = videoFiles.hasPending || Boolean(draft && stored && JSON.stringify(draft) !== JSON.stringify(stored));
  const week = draft?.weeks.find(item => item.freeCourseWeekId === weekId);
  const component = week?.components.find(item => item.id === componentId);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetchFreeCourseAuthoringCourse(courseId, controller.signal).then(document => {
      if (controller.signal.aborted) return;
      setStored(document);
      setDraft(document);
      setWeekId(document.weeks[0]?.freeCourseWeekId || '');
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load this free course.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [courseId, retry]);

  useEffect(() => {
    let active = true;
    fetchComponentPointsDefaults().then(value => { if (active) setPoints(value); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const changeWeek = (id: string, patch: Partial<FreeCourseAuthoringWeek>) => {
    setSavedNotice('');
    setDraft(current => current && ({ ...current, weeks: current.weeks.map(item => item.freeCourseWeekId === id ? { ...item, ...patch } : item) }));
  };
  const changeCourse = (patch: Partial<FreeCourseAuthoringDocument['course']>) => {
    setSavedNotice('');
    setDraft(current => current && ({ ...current, course: { ...current.course, ...patch } }));
  };
  const back = async () => {
    if (busy.current) return;
    if (!dirty) { navigate(returnTo); return; }
    await showCurriculumConfirm({
      title: 'Discard unsaved changes?', text: 'Your changes to this free course have not been saved.',
      confirmButtonText: 'Discard changes', cancelButtonText: 'Keep editing', onConfirm: async () => { navigate(returnTo); },
    });
  };
  const save = async () => {
    if (!draft || !stored || busy.current) return;
    if (!draft.course.courseName.trim()) { setError('Give the course a name.'); return; }
    const price = draft.course.price || '';
    if (draft.course.isForSale && (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(price.trim()) || Number(price) <= 0 || Number(price) > 99999999.99)) {
      setError('Enter a GBP price between £0.01 and £99,999,999.99, with at most two decimal places.'); return;
    }
    if (!draft.weeks.some(item => item.status === 'active' && item.components.length) || draft.weeks.some(item => item.status === 'active' && !item.components.length)) {
      setError('Each active week needs at least one component, and the course needs at least one active week.'); return;
    }
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      let saved = await updateFreeCourseAuthoring(courseId, {
        ...freeCourseSaveInput(stored, draft),
        importVideoComponentIds: component?.type === 'video' && !videoFiles.files[component.id] ? [component.id] : [],
      });
      const weekIndex = draft.weeks.findIndex(item => item.freeCourseWeekId === weekId);
      const componentIndex = week?.components.findIndex(item => item.id === componentId) ?? -1;
      setStored(saved);
      setDraft(saved);
      setWeekId(saved.weeks[weekIndex]?.freeCourseWeekId || saved.weeks[0]?.freeCourseWeekId || '');
      setComponentId(saved.weeks[weekIndex]?.components[componentIndex]?.id || '');
      const mapping = saved.clientIdMap?.components;
      videoFiles.remapIds(mapping && typeof mapping === 'object'
        ? Object.fromEntries(Object.entries(mapping).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {});
      await videoFiles.uploadSaved('free_course', courseId, saved.weeks.flatMap(item => item.components), () => {}, {
        fields: () => ({ expectedRevision: saved.revision }),
        onResponse: data => {
          const document = data.course as FreeCourseAuthoringDocument | undefined;
          if (!document?.revision || document.course.courseId !== courseId) throw new Error('The MP4 response could not confirm the saved course. Reopen the course before retrying.');
          saved = document;
          setStored(document); setDraft(document);
        },
      });
      setSavedNotice('Free course saved');
    } catch (reason) {
      const code = reason instanceof CurriculumApiError && reason.data && typeof reason.data === 'object' && 'code' in reason.data ? reason.data.code : undefined;
      setError(reason instanceof CurriculumApiError && reason.status === 409 && (!code || code === 'stale_revision')
        ? 'This Free Course changed after you opened it. Your draft is still here. Reopen the course to read the latest version before saving.'
        : reason instanceof Error ? reason.message : 'Could not save this free course. Your draft is still here.');
    } finally { busy.current = false; setSaving(false); }
  };
  const changeComponents = (next: ModuleComponent[]) => {
    if (!week) return;
    for (const item of week.components) if (!next.some(part => part.id === item.id)) videoFiles.remove(item.id);
    changeWeek(week.freeCourseWeekId, { components: next.map((item, index) => {
      const existing = week.components.find(part => part.id === item.id);
      if (existing) return { ...freeCourseComponentChange(existing, item), displayOrder: index };
      const settings = { ...item.settings };
      // A new activity cannot claim another activity's canonical quiz.
      delete settings.linkedQuizId;
      return { id: item.id, freeCourseWeekId: week.freeCourseWeekId, type: item.type,
        title: item.title, description: item.description, expectedOtjh: 0, points: item.points,
        reflectionRequired: item.reflectionRequired, workplaceEvidenceRequired: item.workplaceEvidenceRequired,
        tutorValidationRequired: item.tutorValidationRequired, displayOrder: index, settings };
    }) });
  };
  const openQuiz = async () => {
    if (!component || !week || !stored || busy.current) return;
    if (dirty) { setError('Save your course changes before opening its quiz.'); return; }
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      let id = Number(component.settings.linkedQuizId || 0);
      let document = stored;
      if (!id) {
        const result = await createFreeCourseQuiz(courseId, { expectedRevision: stored.revision,
          freeCourseWeekId: week.freeCourseWeekId, componentId: component.id, title: component.title });
        id = result.quiz.quiz.id;
        document = result.course;
        setStored(document); setDraft(document);
      }
      setQuiz({ id, componentId: component.id, revision: document.revision });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open the quiz.'); }
    finally { busy.current = false; setSaving(false); }
  };
  const closeQuiz = async () => {
    setQuiz(null);
    setSaving(true); busy.current = true;
    try {
      const document = await fetchFreeCourseAuthoringCourse(courseId);
      setStored(document); setDraft(document);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not refresh the course after editing its quiz.'); }
    finally { setSaving(false); busy.current = false; }
  };
  const unlinkQuiz = async () => {
    if (!stored || !component || busy.current) return;
    if (dirty) { setError('Save your course changes before unlinking its quiz.'); return; }
    await showCurriculumConfirm({ title: 'Unlink quiz?', text: 'The quiz record is preserved. This activity will no longer open it for learners.',
      confirmButtonText: 'Unlink quiz', cancelButtonText: 'Keep linked', onConfirm: async () => {
        busy.current = true; setSaving(true);
        try {
          const result = await unlinkFreeCourseQuiz(courseId, Number(component.settings.linkedQuizId), { expectedRevision: stored.revision, componentId: component.id });
          setStored(result.course); setDraft(result.course);
        } finally { busy.current = false; setSaving(false); }
      } });
  };
  const uploadCover = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 1024 * 1024) { setError('Choose an image under 1 MB.'); return; }
    try {
      const value = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read the image.')); reader.readAsDataURL(file);
      });
      changeCourse({ coverImageUrl: value });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read the image.'); }
  };

  return <PendingVideoFilesContext.Provider value={videoFiles}><FreeCourseVideoScopeContext.Provider value={courseId}><WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio"
    pageTitle="Module Builder" pageSubtitle="Free course authoring workspace" userName="Rachel Myers" userRole="Curriculum Designer">
    <div className="min-h-[calc(100vh-96px)] bg-background-100 px-3 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1840px] flex-col gap-4">
        <header className="flex flex-col items-stretch gap-3 rounded-xl border border-background-200 bg-white p-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          <button type="button" disabled={saving} onClick={() => { void back(); }} className="shrink-0 self-start rounded-lg bg-primary-600 px-4 py-2 text-sm font-bold text-white sm:self-auto">Back to free courses</button>
          <div className="min-w-0 sm:flex-1"><p className="text-xs font-bold text-primary-700">Module Builder · Free course</p><h1 className="break-words text-xl font-bold">{draft?.course.courseName || 'Free course'}</h1></div>
          {draft && <><span role="status" className="text-xs text-foreground-500">{saving ? 'Saving...' : dirty ? 'Unsaved changes' : savedNotice || 'All changes saved'}</span>
            <button type="button" disabled={saving} onClick={() => { void save(); }} className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Save changes</button></>}
        </header>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}
          {!draft && !loading && <button type="button" onClick={() => setRetry(value => value + 1)} className="ml-3 underline">Retry</button>}</div>}
        {loading && <p role="status">Loading free course...</p>}
        {draft && <fieldset disabled={saving || Boolean(quiz)} className="m-0 min-w-0 border-0 p-0">
          <div className="grid items-start gap-4 xl:grid-cols-[380px_minmax(0,1fr)_290px]">
            <section aria-label="Course structure" className="rounded-xl border border-background-200 bg-white p-3">
              <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Course structure</h2><span className="text-xs text-foreground-500">{draft.weeks.length} weeks</span></div>
              {draft.weeks.map((item, index) => <div key={item.freeCourseWeekId} className="mb-2 overflow-hidden rounded-lg border border-background-200">
                <button type="button" aria-expanded={weekId === item.freeCourseWeekId} onClick={() => { setWeekId(item.freeCourseWeekId); setComponentId(''); }} className="flex w-full items-center gap-2 bg-primary-50 p-3 text-left text-sm font-bold">
                  <AppIcon className="ri-calendar-line text-primary-600" /><span className="min-w-0 flex-1">{index + 1}. {item.title}</span><span className="text-xs">{item.components.length}</span>
                </button>
                {weekId === item.freeCourseWeekId && <WeekComponentRail weekId={weekId} displayWeek={{ id: weekId, title: item.title }}
                  components={item.components.map(freeCourseEditorComponent)} selectedId={componentId || null} onSelectId={id => setComponentId(id || '')}
                  onChange={changeComponents} pointsByType={points} variant="nested" selfStudyOnly allowedTypes={freeCourseTypes} />}
              </div>)}
              <button type="button" onClick={() => { const next = newFreeCourseWeek(draft.weeks.length); setDraft({ ...draft, weeks: [...draft.weeks, next] }); setWeekId(next.freeCourseWeekId); setComponentId(''); }}
                className="mt-2 w-full rounded-lg border border-dashed border-primary-300 p-3 text-sm font-bold text-primary-700">+ Add week</button>
              <button type="button" onClick={() => setImportOpen(true)} className="mt-2 w-full rounded-lg border border-primary-200 p-3 text-sm font-bold text-primary-700">Add weeks from library</button>
            </section>
            <div className="min-w-0">
              {component && week ? <ComponentEditor key={component.id} component={freeCourseEditorComponent(component)} displayWeek={{ id: weekId, title: week.title }}
                onChange={patch => changeWeek(weekId, { components: week.components.map(item => item.id === component.id ? freeCourseComponentChange(item, patch) : item) })}
                onBack={() => setComponentId('')} groupOptions={[]} rulePoints={points[component.type as ModuleComponent['type']]}
                weekScope={{ courseType: 'free', programmeId: '', programmeName: '', moduleName: draft.course.courseName }}
                uploadResource={uploadWeekComponentResource} selfStudyOnly canonicalFreeCourse
                quizEditor={<div className="space-y-4 p-4"><label className="block text-sm font-semibold">Title<input className={inputClass} value={component.title} onChange={event => changeWeek(weekId, { components: week.components.map(item => item.id === component.id ? { ...item, title: event.target.value } : item) })} /></label>
                  <button type="button" onClick={() => { void openQuiz(); }} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-bold text-white">{component.settings.linkedQuizId ? 'Edit quiz' : 'Create quiz'}</button>
                  {Boolean(component.settings.linkedQuizId) && <button type="button" onClick={() => { void unlinkQuiz(); }} className="ml-2 text-sm text-red-700 underline">Unlink quiz</button>}
                  <label className="flex gap-2 text-sm"><input type="checkbox" checked={Boolean(component.settings.manualUnlock)} onChange={event => changeWeek(weekId, { components: week.components.map(item => item.id === component.id ? { ...item, settings: { ...item.settings, manualUnlock: event.target.checked } } : item) })} />Manual unlock</label>
                </div>} />
                : week && <section className="space-y-4 rounded-xl border border-background-200 bg-white p-5">
                  <h2 className="font-bold">Week overview</h2>
                  <label className="block text-sm font-semibold">Week title<input className={inputClass} value={week.title} onChange={event => changeWeek(weekId, { title: event.target.value })} /></label>
                  <label className="block text-sm font-semibold">Summary<textarea className={inputClass} rows={4} value={week.summary} onChange={event => changeWeek(weekId, { summary: event.target.value })} /></label>
                  <label className="block text-sm font-semibold">Status<select className={inputClass} value={week.status} onChange={event => changeWeek(weekId, { status: event.target.value as 'active' | 'inactive' })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
                  <div className="flex flex-wrap gap-3">
                    {([-1, 1] as const).map(direction => <button type="button" key={direction} disabled={draft.weeks.indexOf(week) + direction < 0 || draft.weeks.indexOf(week) + direction >= draft.weeks.length}
                      className="text-sm text-primary-700 underline disabled:opacity-30" onClick={() => { const next = [...draft.weeks]; const index = next.indexOf(week); [next[index], next[index + direction]] = [next[index + direction], next[index]]; setDraft({ ...draft, weeks: next }); }}>Move week {direction === -1 ? 'up' : 'down'}</button>)}
                    <button type="button" className="text-sm text-red-700 underline" onClick={() => { void showCurriculumConfirm({ title: 'Remove week?', text: `Remove "${week.title}" and its components from this free course?`, confirmButtonText: 'Remove week', cancelButtonText: 'Keep week', onConfirm: async () => {
                      for (const item of week.components) videoFiles.remove(item.id);
                      const weeks = draft.weeks.filter(item => item.freeCourseWeekId !== weekId); setDraft({ ...draft, weeks }); setWeekId(weeks[0]?.freeCourseWeekId || ''); setComponentId('');
                    } }); }}>Remove week</button>
                  </div>
                </section>}
            </div>
            <section aria-label="Course settings" className="space-y-4 rounded-xl border border-background-200 bg-white p-4">
              <h2 className="font-bold">Course settings</h2>
              <label className="block text-sm font-semibold">Course name<input className={inputClass} placeholder="Name this free course" value={draft.course.courseName} onChange={event => changeCourse({ courseName: event.target.value })} /></label>
              <label className="block text-sm font-semibold">Description<textarea className={inputClass} rows={4} value={draft.course.description} onChange={event => changeCourse({ description: event.target.value })} /></label>
              {draft.course.coverImageUrl && <img src={draft.course.coverImageUrl} alt="Course cover" className="h-32 w-full rounded-lg object-cover" />}
              <label className="block text-sm font-semibold">Cover image<input type="file" accept="image/*" className="mt-1 w-full text-xs" onChange={event => { void uploadCover(event.target.files?.[0]); event.target.value = ''; }} /></label>
              {draft.course.coverImageUrl && <button type="button" onClick={() => changeCourse({ coverImageUrl: '' })} className="text-xs text-red-700 underline">Remove cover image</button>}
              <label className="flex gap-2 text-sm font-semibold"><input type="checkbox" checked={draft.course.isForSale} onChange={event => changeCourse({ isForSale: event.target.checked })} />Available for sale</label>
              {draft.course.isForSale && <label className="block text-sm font-semibold">Price (GBP)<input className={inputClass} placeholder="e.g. 49.99" inputMode="decimal" value={draft.course.price || ''} onChange={event => changeCourse({ price: event.target.value })} /></label>}
            </section>
          </div>
        </fieldset>}
        {importOpen && draft && <WeekTemplateImportModal courseType="free" scope={{ programmeId: '', programmeName: '' }} onClose={() => setImportOpen(false)} onImport={(template, count) => {
          if (template.components.some(item => item.type === 'live-session')) throw new Error('Choose self-study content for this free course.');
          const added = Array.from({ length: count }, (_, index) => {
            const next = newFreeCourseWeek(draft.weeks.length + index);
            return { ...next, title: template.title, summary: template.summary, learningOutcomes: template.learningOutcomes, legacyCopiedFromWeekId: template.id,
              components: template.components.map((item, componentIndex) => ({
                id: `draft-component:${crypto.randomUUID()}`, freeCourseWeekId: next.freeCourseWeekId, type: item.type,
                title: item.title, description: item.description, expectedOtjh: item.expectedOtjh, points: item.points,
                reflectionRequired: item.reflectionRequired, workplaceEvidenceRequired: item.workplaceEvidenceRequired,
                tutorValidationRequired: item.tutorValidationRequired, displayOrder: componentIndex, settings: { ...item.settings },
              })),
            };
          });
          setDraft({ ...draft, weeks: [...draft.weeks, ...added] }); setWeekId(added[0].freeCourseWeekId); setComponentId(''); setImportOpen(false);
        }} />}
        {quiz && <div role="dialog" aria-modal="true" aria-label="Free course quiz editor" className="fixed inset-0 z-50 overflow-y-auto bg-background-100 p-5">
          <Suspense fallback={<p role="status">Loading quiz editor...</p>}><QuizEditor quizId={quiz.id} freeCourseContext={{ courseId, componentId: quiz.componentId, expectedRevision: quiz.revision }} onClose={() => { void closeQuiz(); }} /></Suspense>
        </div>}
      </div>
    </div>
  </WorkspaceShell></FreeCourseVideoScopeContext.Provider></PendingVideoFilesContext.Provider>;
}
