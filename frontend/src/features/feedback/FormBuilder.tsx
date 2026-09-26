import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { feedbackApi, type FeedbackCurriculumOptions, type FeedbackFormInput, type FeedbackQuestion, type FeedbackQuestionType, type FeedbackSection } from '@/api/feedback';
import { FeedbackFormHeader, FormRenderer } from './FormRenderer';

const QUESTION_TYPES: { value: FeedbackQuestionType; label: string }[] = [
  ['short_text', 'Short Text'], ['long_text', 'Long Text'], ['yes_no', 'Yes / No'],
  ['single_choice', 'Single Choice'], ['multiple_choice', 'Multiple Choice'], ['dropdown', 'Dropdown'],
  ['rating', 'Rating Scale'], ['likert', 'Likert Scale'], ['number', 'Number'], ['date', 'Date'],
  ['name', 'Name'], ['email', 'Email'], ['photo_upload', 'Photo Upload'],
].map(([value, label]) => ({ value: value as FeedbackQuestionType, label }));
const CHOICE_TYPES = new Set<FeedbackQuestionType>(['single_choice', 'multiple_choice', 'dropdown', 'likert']);
const emptyQuestion = (): FeedbackQuestion => ({ type: 'long_text', text: '', required: false, helpText: '', config: {} });
const emptySection = (number = 1): FeedbackSection => ({ title: `Section ${number}`, description: '', questions: [emptyQuestion()] });
const field = 'w-full rounded-lg border border-foreground-200/70 bg-white px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:bg-background-100';
const emptyCurriculumOptions: FeedbackCurriculumOptions = { programmes: [], cohorts: [], groups: [], modules: [] };

const emptyForm = (): FeedbackFormInput => ({
  title: '', formType: 'post_lecture', deliveryScope: 'all_modules', programmeId: '', cohortId: '', groupId: '', moduleCatalogueId: '',
  description: '', instructions: '', startDate: null, dueDate: null, anonymousResponses: false,
  allowSaveContinue: true, allowEditAfterSubmission: false, sections: [emptySection()],
});

export function FormBuilder() {
  const { formId } = useParams();
  const navigate = useNavigate();
  const [model, setModel] = useState<FeedbackFormInput>(emptyForm);
  const [curriculumOptions, setCurriculumOptions] = useState<FeedbackCurriculumOptions>(emptyCurriculumOptions);
  const [curriculumError, setCurriculumError] = useState('');
  const [curriculumLoading, setCurriculumLoading] = useState(false);
  const [locked, setLocked] = useState(false);
  const [versionInfo, setVersionInfo] = useState<{ version: number; willCreateVersion: boolean } | null>(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!formId) return;
    feedbackApi.getForm(Number(formId)).then(({ form }) => {
      setLocked(form.structureLocked);
      setVersionInfo({ version: form.version || 1, willCreateVersion: Boolean(form.willCreateVersion) });
      setModel({
        title: form.title, formType: form.formType || 'general',
        deliveryScope: form.deliveryScope || (form.curriculumScope?.moduleCatalogueId ? 'module' : form.formType === 'post_lecture' ? 'all_modules' : 'manual'),
        programmeId: form.curriculumScope?.programmeId || '', cohortId: form.curriculumScope?.cohortId || '',
        groupId: form.curriculumScope?.groupId || '', moduleCatalogueId: form.curriculumScope?.moduleCatalogueId || '',
        description: form.description, instructions: form.instructions, startDate: form.startDate, dueDate: form.dueDate,
        anonymousResponses: form.anonymousResponses, allowSaveContinue: form.allowSaveContinue,
        allowEditAfterSubmission: form.allowEditAfterSubmission, sections: form.sections || [],
      });
    }).catch(error => void Swal.fire({ icon: 'error', title: 'Could not load form', text: error.message }));
  }, [formId]);

  const loadCurriculumOptions = useCallback(async () => {
    setCurriculumLoading(true);
    setCurriculumError('');
    try {
      setCurriculumOptions(await feedbackApi.curriculumOptions());
    } catch (error) {
      setCurriculumError(error instanceof Error ? error.message : 'Could not load curriculum options.');
    } finally {
      setCurriculumLoading(false);
    }
  }, []);

  useEffect(() => {
    if (model.formType === 'post_lecture' && model.deliveryScope === 'module' && curriculumOptions.modules.length === 0) {
      void loadCurriculumOptions();
    }
  }, [curriculumOptions.modules.length, loadCurriculumOptions, model.deliveryScope, model.formType]);

  const cohorts = useMemo(() => curriculumOptions.cohorts.filter(item => sameId(item.programmeId, model.programmeId)), [curriculumOptions.cohorts, model.programmeId]);
  const groups = useMemo(() => curriculumOptions.groups.filter(item => sameId(item.cohortId, model.cohortId)), [curriculumOptions.groups, model.cohortId]);
  const modules = useMemo(() => curriculumOptions.modules.filter(item => sameId(item.groupId, model.groupId)), [curriculumOptions.modules, model.groupId]);

  const setSections = (sections: FeedbackSection[]) => setModel(current => ({ ...current, sections }));
  const updateSection = (index: number, patch: Partial<FeedbackSection>) => setSections(model.sections.map((section, i) => i === index ? { ...section, ...patch } : section));
  const moveSection = (index: number, direction: -1 | 1) => { const next = [...model.sections]; const target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; setSections(next); };
  const updateQuestion = (sectionIndex: number, questionIndex: number, patch: Partial<FeedbackQuestion>) => updateSection(sectionIndex, { questions: model.sections[sectionIndex].questions.map((question, i) => i === questionIndex ? { ...question, ...patch } : question) });
  const moveQuestion = (sectionIndex: number, questionIndex: number, direction: -1 | 1) => { const questions = [...model.sections[sectionIndex].questions]; const target = questionIndex + direction; if (target < 0 || target >= questions.length) return; [questions[questionIndex], questions[target]] = [questions[target], questions[questionIndex]]; updateSection(sectionIndex, { questions }); };

  async function save() {
    setSaving(true);
    try {
      const result = formId
        ? await feedbackApi.updateForm(Number(formId), locked ? { ...model, sections: undefined } : model)
        : await feedbackApi.createForm(model);
      await Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: result.form.version > 1 ? `Version ${result.form.version} saved` : 'Draft saved', timer: 1600, showConfirmButton: false });
      navigate(`/engagement/reports/feedback/forms/${result.form.id}/edit`, { replace: true });
    } catch (error) {
      await Swal.fire({ icon: 'error', title: 'Could not save form', text: error instanceof Error ? error.message : 'Unexpected error.' });
    } finally { setSaving(false); }
  }

  return <div className="space-y-5 p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><button type="button" onClick={() => navigate('/engagement/reports/feedback')} className="mb-2 text-xs font-medium text-primary-600">← Back to Feedback</button><h1 className="font-heading text-xl font-bold text-foreground-900">{formId ? 'Edit feedback form' : 'Create feedback form'}</h1><p className="text-xs text-foreground-500">Build sections and questions, then preview the learner experience.</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => setPreview(!preview)} className="rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-xs font-semibold text-primary-700">{preview ? 'Edit form' : 'Preview'}</button><button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-[#541EA0] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save draft'}</button></div>
    </div>
    {locked && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Questions and sections are locked because a learner has started this form. Form details and dates can still be updated.</div>}
    {versionInfo?.willCreateVersion && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">You are editing version {versionInfo.version}. Saving creates a new version for future lectures; previous lecture responses stay unchanged.</div>}
    {preview ? <div className="mx-auto max-w-4xl rounded-2xl bg-background-100 p-5"><FeedbackFormHeader title={model.title || 'Untitled feedback form'} description={model.description} instructions={model.instructions} /><FormRenderer sections={model.sections} answers={{}} readOnly /></div> : <>
      <div className="grid gap-4 rounded-xl border border-foreground-200/60 bg-background-50 p-5 md:grid-cols-2">
        <label className="text-xs font-semibold text-foreground-700 md:col-span-2">Form Type<select disabled={locked} className={`${field} mt-1`} value={model.formType} onChange={e => { const formType = e.target.value as FeedbackFormInput['formType']; setModel(current => ({ ...current, formType, deliveryScope: formType === 'post_lecture' ? 'all_modules' : 'manual', programmeId: '', cohortId: '', groupId: '', moduleCatalogueId: '' })); }}><option value="post_lecture">Post-lecture feedback</option><option value="general">General feedback</option></select></label>
        {model.formType === 'post_lecture' && <div className="rounded-xl border border-primary-100 bg-primary-50/40 p-4 md:col-span-2">
          <div className="mb-3"><h2 className="text-sm font-semibold text-foreground-900">Lecture delivery</h2><p className="mt-1 text-xs text-foreground-500">Present learners receive this form automatically after finalized attendance. A module-specific form overrides the all-modules form.</p></div>
          <label className="mb-3 block text-xs font-semibold text-foreground-700">Delivery scope<select className={`${field} mt-1`} value={model.deliveryScope} onChange={e => setModel(current => ({ ...current, deliveryScope: e.target.value as FeedbackFormInput['deliveryScope'], programmeId: '', cohortId: '', groupId: '', moduleCatalogueId: '' }))}><option value="all_modules">All modules</option><option value="module">One module only</option></select></label>
          {model.deliveryScope === 'module' && <>
            {curriculumError && <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"><span>{curriculumError}</span><button type="button" disabled={curriculumLoading} onClick={() => void loadCurriculumOptions()} className="shrink-0 rounded-md border border-red-300 bg-white px-3 py-1.5 font-semibold disabled:opacity-50">Retry</button></div>}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ScopeSelect label="Programme" value={model.programmeId} disabled={locked || curriculumLoading} options={curriculumOptions.programmes} placeholder={curriculumLoading ? 'Loading programmes...' : 'Choose programme'} onChange={programmeId => setModel(current => ({ ...current, programmeId, cohortId: '', groupId: '', moduleCatalogueId: '' }))} />
            <ScopeSelect label="Cohort" value={model.cohortId} disabled={locked || !model.programmeId} options={cohorts} placeholder="Choose cohort" onChange={cohortId => setModel(current => ({ ...current, cohortId, groupId: '', moduleCatalogueId: '' }))} />
            <ScopeSelect label="Group" value={model.groupId} disabled={locked || !model.cohortId} options={groups} placeholder="Choose group" onChange={groupId => setModel(current => ({ ...current, groupId, moduleCatalogueId: '' }))} />
            <ScopeSelect label="Module" value={model.moduleCatalogueId} disabled={locked || !model.groupId} options={modules} placeholder="Choose module" onChange={moduleCatalogueId => setModel(current => ({ ...current, moduleCatalogueId }))} />
            </div>
          </>}
        </div>}
        <label className="text-xs font-semibold text-foreground-700 md:col-span-2">Form Name<input className={`${field} mt-1`} value={model.title} onChange={e => setModel({ ...model, title: e.target.value })} /></label>
        <label className="text-xs font-semibold text-foreground-700">Description<textarea className={`${field} mt-1`} rows={3} value={model.description} onChange={e => setModel({ ...model, description: e.target.value })} /></label>
        <label className="text-xs font-semibold text-foreground-700">Instructions<textarea className={`${field} mt-1`} rows={3} value={model.instructions} onChange={e => setModel({ ...model, instructions: e.target.value })} /></label>
        <label className="text-xs font-semibold text-foreground-700">Start Date<input type="datetime-local" className={`${field} mt-1`} value={toLocal(model.startDate)} onChange={e => setModel({ ...model, startDate: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
        <label className="text-xs font-semibold text-foreground-700">Due Date<input type="datetime-local" className={`${field} mt-1`} value={toLocal(model.dueDate)} onChange={e => setModel({ ...model, dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
        <div className="flex flex-wrap gap-5 md:col-span-2">{[
          ['anonymousResponses', 'Anonymous responses'], ['allowSaveContinue', 'Allow save and continue'], ['allowEditAfterSubmission', 'Allow editing after submission'],
        ].map(([key, label]) => <label key={key} className="flex items-center gap-2 text-xs text-foreground-700"><input type="checkbox" checked={Boolean(model[key as keyof FeedbackFormInput])} onChange={e => setModel({ ...model, [key]: e.target.checked })} className="accent-primary-600" />{label}</label>)}</div>
      </div>
      <div className="space-y-4">
        {model.sections.map((section, sectionIndex) => <div key={sectionIndex} className="rounded-xl border border-foreground-200/60 bg-background-50 p-5">
          <div className="flex gap-2"><input disabled={locked} aria-label={`Section ${sectionIndex + 1} title`} className={`${field} font-semibold`} value={section.title} onChange={e => updateSection(sectionIndex, { title: e.target.value })} /><MoveButtons index={sectionIndex} length={model.sections.length} onMove={direction => moveSection(sectionIndex, direction)} disabled={locked} /><button type="button" disabled={locked || model.sections.length === 1} onClick={() => setSections(model.sections.filter((_, i) => i !== sectionIndex))} className="rounded-lg px-3 text-xs font-semibold text-red-600 disabled:opacity-30">Delete</button></div>
          <input disabled={locked} className={`${field} mt-2`} placeholder="Section description (optional)" value={section.description} onChange={e => updateSection(sectionIndex, { description: e.target.value })} />
          <div className="mt-4 space-y-3">{section.questions.map((question, questionIndex) => <div key={questionIndex} className="rounded-lg border border-background-300 bg-background-100/60 p-4">
            <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]"><input disabled={locked} className={field} placeholder="Question text" value={question.text} onChange={e => updateQuestion(sectionIndex, questionIndex, { text: e.target.value })} /><select disabled={locked} className={field} value={question.type} onChange={e => updateQuestion(sectionIndex, questionIndex, { type: e.target.value as FeedbackQuestionType, config: CHOICE_TYPES.has(e.target.value as FeedbackQuestionType) ? { options: ['Option 1', 'Option 2'] } : e.target.value === 'rating' ? { min: 1, max: 5 } : {} })}>{QUESTION_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select><MoveButtons index={questionIndex} length={section.questions.length} onMove={direction => moveQuestion(sectionIndex, questionIndex, direction)} disabled={locked} /></div>
            <div className="mt-2 flex gap-2"><input disabled={locked} className={field} placeholder="Help text (optional)" value={question.helpText} onChange={e => updateQuestion(sectionIndex, questionIndex, { helpText: e.target.value })} /><label className="flex shrink-0 items-center gap-2 text-xs text-foreground-700"><input disabled={locked} type="checkbox" checked={question.required} onChange={e => updateQuestion(sectionIndex, questionIndex, { required: e.target.checked })} />Required</label><button type="button" disabled={locked} onClick={() => updateSection(sectionIndex, { questions: section.questions.filter((_, i) => i !== questionIndex) })} className="px-2 text-xs font-semibold text-red-600 disabled:opacity-30">Remove</button></div>
            {CHOICE_TYPES.has(question.type) && <OptionEditor options={question.config.options || []} disabled={locked} onChange={options => updateQuestion(sectionIndex, questionIndex, { config: { ...question.config, options } })} />}
            {question.type === 'rating' && <div className="mt-3 grid gap-2 sm:grid-cols-3"><select disabled={locked} className={field} value={question.config.max || 5} onChange={e => updateQuestion(sectionIndex, questionIndex, { config: { ...question.config, min: 1, max: Number(e.target.value) } })}><option value={5}>1–5</option><option value={10}>1–10</option></select><input disabled={locked} className={field} placeholder="1 label (e.g. Very Poor)" value={question.config.minLabel || ''} onChange={e => updateQuestion(sectionIndex, questionIndex, { config: { ...question.config, minLabel: e.target.value } })} /><input disabled={locked} className={field} placeholder="Max label (e.g. Excellent)" value={question.config.maxLabel || ''} onChange={e => updateQuestion(sectionIndex, questionIndex, { config: { ...question.config, maxLabel: e.target.value } })} /></div>}
          </div>)}<button type="button" disabled={locked} onClick={() => updateSection(sectionIndex, { questions: [...section.questions, emptyQuestion()] })} className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs font-semibold text-primary-700 disabled:opacity-30">+ Add Question</button></div>
        </div>)}
        <button type="button" disabled={locked} onClick={() => setSections([...model.sections, emptySection(model.sections.length + 1)])} className="rounded-lg border border-dashed border-primary-300 bg-primary-50/50 px-4 py-3 text-xs font-semibold text-primary-700 disabled:opacity-30">+ Add Section</button>
      </div>
    </>}
  </div>;
}

function MoveButtons({ index, length, onMove, disabled }: { index: number; length: number; onMove: (direction: -1 | 1) => void; disabled: boolean }) { return <div className="flex shrink-0 gap-1"><button type="button" aria-label="Move up" disabled={disabled || index === 0} onClick={() => onMove(-1)} className="rounded border px-2 text-xs disabled:opacity-25">↑</button><button type="button" aria-label="Move down" disabled={disabled || index === length - 1} onClick={() => onMove(1)} className="rounded border px-2 text-xs disabled:opacity-25">↓</button></div>; }
function ScopeSelect({ label, value, options, placeholder, disabled, onChange }: { label: string; value: string; options: Array<{ id: string; name: string }>; placeholder: string; disabled: boolean; onChange: (value: string) => void }) { return <label className="text-xs font-semibold text-foreground-700">{label}<select aria-label={label} required className={`${field} mt-1`} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}><option value="">{placeholder}</option>{options.map(option => <option key={option.id} value={option.id}>{option.name || option.id}</option>)}</select></label>; }
function OptionEditor({ options, onChange, disabled }: { options: string[]; onChange: (options: string[]) => void; disabled: boolean }) { return <div className="mt-3 space-y-2">{options.map((option, index) => <div key={index} className="flex gap-2"><input disabled={disabled} className={field} value={option} onChange={e => onChange(options.map((item, i) => i === index ? e.target.value : item))} /><MoveButtons disabled={disabled} index={index} length={options.length} onMove={direction => { const next = [...options]; const target = index + direction; [next[index], next[target]] = [next[target], next[index]]; onChange(next); }} /><button type="button" disabled={disabled || options.length <= 2} onClick={() => onChange(options.filter((_, i) => i !== index))} className="px-2 text-xs text-red-600 disabled:opacity-30">Remove</button></div>)}<button type="button" disabled={disabled} onClick={() => onChange([...options, `Option ${options.length + 1}`])} className="text-xs font-semibold text-primary-600">+ Add Option</button></div>; }
function sameId(left: string, right: string) { return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase(); }
function toLocal(value: string | null) { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
