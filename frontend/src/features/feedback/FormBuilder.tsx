import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { useNavigate, useParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { QRCodeSVG } from 'qrcode.react';
import { feedbackApi, type FeedbackCurriculumOptions, type FeedbackFormInput, type FeedbackQuestion, type FeedbackQuestionType, type FeedbackSection } from '@/api/feedback';
import { FeedbackFormHeader, FeedbackStepProgress, FormRenderer } from './FormRenderer';
import { FEEDBACK_SECTION_ICONS } from './formPresentation';
import { lecturePresentationSections } from './lecturePresentation';
import { QuestionBankImport } from './QuestionBankImport';
import { QuestionAnalyticsSettings } from './QuestionAnalyticsSettings';
import { FormScoringSetup } from './FormScoringSetup';
import { analyticsForNewType, withAnswerOptions } from './questionAnalyticsConfig';
import scoringStyles from './ScoringSetup.module.css';

type BuilderSelectOption = { value: string; label: string; description: string; icon: string };

const QUESTION_TYPES: { value: FeedbackQuestionType; label: string }[] = [
  ['short_text', 'Short Text'], ['long_text', 'Long Text'], ['yes_no', 'Yes / No'],
  ['single_choice', 'Single Choice'], ['multiple_choice', 'Multiple Choice'], ['dropdown', 'Dropdown'],
  ['rating', 'Rating Scale'], ['likert', 'Likert Scale'], ['number', 'Number'], ['date', 'Date'],
  ['name', 'Name'], ['email', 'Email'], ['photo_upload', 'Photo Upload'],
].map(([value, label]) => ({ value: value as FeedbackQuestionType, label }));
const CHOICE_TYPES = new Set<FeedbackQuestionType>(['single_choice', 'multiple_choice', 'dropdown', 'likert']);
const FORM_TYPE_OPTIONS: BuilderSelectOption[] = [
  { value: 'post_lecture', label: 'Live Sessions Feedback', description: 'Sent automatically after finalized attendance', icon: 'ri-graduation-cap-line' },
  { value: 'mid_module', label: 'Mid-module Feedback', description: 'Opens halfway between the module start and end dates', icon: 'ri-calendar-check-line' },
  { value: 'end_module', label: 'End-module Feedback', description: 'Opens on the module end date', icon: 'ri-flag-line' },
  { value: 'post_mcm_review', label: 'MCM Feedback', description: 'Used after completed monthly coaching meetings', icon: 'ri-team-line' },
  { value: 'post_progress_review', label: 'Progress Review Feedback', description: 'Used after completed progress reviews', icon: 'ri-line-chart-line' },
  { value: 'post_event', label: 'Post-event feedback', description: 'Collect feedback after an event', icon: 'ri-calendar-check-line' },
  { value: 'event_rsvp', label: 'Event RSVP', description: 'Collect attendance choices and extra responses', icon: 'ri-mail-send-line' },
  { value: 'general', label: 'General feedback', description: 'A flexible form for manual feedback collection', icon: 'ri-chat-poll-line' },
];
const emptyQuestion = (): FeedbackQuestion => ({ type: 'long_text', text: '', required: false, helpText: '', config: {} });
const emptySection = (number = 1): FeedbackSection => ({ title: `Section ${number}`, icon: 'ri-file-list-3-line', description: '', questions: [emptyQuestion()] });
const emptyLectureCategory = (number = 1): FeedbackSection => ({
  ...emptySection(number), title: `Category ${number}`, questionsPerDelivery: 1,
  questions: [{ ...emptyQuestion(), type: 'rating', required: true, config: { min: 1, max: 5, display: 'stars', labels: ['', '', '', '', ''] } }],
});
const field = 'w-full rounded-lg border border-foreground-200/70 bg-white px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:bg-background-100';
const emptyCurriculumOptions: FeedbackCurriculumOptions = { programmes: [], cohorts: [], groups: [], modules: [] };

const emptyForm = (): FeedbackFormInput => ({
  title: '', formType: 'post_lecture', deliveryScope: 'all_modules', programmeId: '', cohortId: '', groupId: '', moduleCatalogueId: '',
  description: '', instructions: '', startDate: null, dueDate: null, anonymousResponses: false,
  allowSaveContinue: true, allowEditAfterSubmission: false, sections: [emptyLectureCategory()],
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
  const [previewStep, setPreviewStep] = useState(0);
  const [selectedSectionIndex, setSelectedSectionIndex] = useState(0);
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [saving, setSaving] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const questionSettingsRef = useRef<HTMLElement>(null);
  const lectureFeedbackUrl = `${window.location.origin}/login?lectureFeedback=1`;
  const presentationSections = useMemo(() => lecturePresentationSections(model.formType, model.sections), [model.formType, model.sections]);
  const presentationStep = Math.min(previewStep, Math.max(presentationSections.length - 1, 0));

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
    if (['post_lecture', 'mid_module', 'end_module'].includes(model.formType) && model.deliveryScope === 'module' && curriculumOptions.modules.length === 0) {
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
  const activeSectionIndex = Math.min(selectedSectionIndex, Math.max(model.sections.length - 1, 0));
  const activeSection = model.sections[activeSectionIndex];
  const activeQuestionIndex = Math.min(selectedQuestionIndex, Math.max((activeSection?.questions.length || 1) - 1, 0));
  const activeQuestion = activeSection?.questions[activeQuestionIndex];
  const lastSection = model.sections.at(-1);
  const closingIndex = model.formType === 'post_lecture' && lastSection?.title === 'General comments'
    && lastSection.questionsPerDelivery == null && lastSection.questions.length === 1
    && lastSection.questions[0].type === 'long_text' ? model.sections.length - 1 : -1;
  const categoryCount = model.sections.length - (closingIndex < 0 ? 0 : 1);
  const lectureQuestionCount = model.sections.reduce((count, section) => count + (section.questionsPerDelivery ?? section.questions.length), 0);

  const selectQuestion = (sectionIndex: number, questionIndex: number) => {
    setSelectedSectionIndex(sectionIndex);
    setSelectedQuestionIndex(questionIndex);
    setPreviewStep(sectionIndex);
  };

  const addQuestion = (sectionIndex: number) => {
    const questionIndex = model.sections[sectionIndex].questions.length;
    const question = model.formType === 'post_lecture' ? emptyLectureCategory().questions[0] : emptyQuestion();
    updateSection(sectionIndex, { questions: [...model.sections[sectionIndex].questions, question] });
    selectQuestion(sectionIndex, questionIndex);
  };

  const addSection = () => {
    const sectionIndex = closingIndex < 0 ? model.sections.length : closingIndex;
    const sections = [...model.sections];
    sections.splice(sectionIndex, 0, model.formType === 'post_lecture' ? emptyLectureCategory(categoryCount + 1) : emptySection(sectionIndex + 1));
    setSections(sections);
    selectQuestion(sectionIndex, 0);
  };

  const removeSection = (sectionIndex: number) => {
    const sections = model.sections.filter((_, index) => index !== sectionIndex);
    setSections(sections);
    selectQuestion(Math.max(0, Math.min(sectionIndex, sections.length - 1)), 0);
  };

  const removeQuestion = (sectionIndex: number, questionIndex: number) => {
    if (sectionIndex === closingIndex) { removeSection(sectionIndex); return; }
    const section = model.sections[sectionIndex];
    const questions = section.questions.filter((_, index) => index !== questionIndex);
    updateSection(sectionIndex, {
      questions,
      questionsPerDelivery: section.questionsPerDelivery == null
        ? null : Math.min(section.questionsPerDelivery, questions.length) || null,
    });
    setSelectedSectionIndex(sectionIndex);
    setSelectedQuestionIndex(Math.max(0, Math.min(questionIndex, questions.length - 1)));
  };

  const moveSectionAndSelection = (sectionIndex: number, direction: -1 | 1) => {
    const target = sectionIndex + direction;
    moveSection(sectionIndex, direction);
    if (selectedSectionIndex === sectionIndex) {
      setSelectedSectionIndex(target);
      setPreviewStep(target);
    } else if (selectedSectionIndex === target) {
      setSelectedSectionIndex(sectionIndex);
      setPreviewStep(sectionIndex);
    }
  };

  const moveQuestionAndSelection = (sectionIndex: number, questionIndex: number, direction: -1 | 1) => {
    const target = questionIndex + direction;
    moveQuestion(sectionIndex, questionIndex, direction);
    if (sectionIndex !== activeSectionIndex) return;
    if (activeQuestionIndex === questionIndex) setSelectedQuestionIndex(target);
    else if (activeQuestionIndex === target) setSelectedQuestionIndex(questionIndex);
  };

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

  function applyBankSections(sections: FeedbackSection[]) {
    if (locked) return;
    setSections(sections);
    setSelectedSectionIndex(0);
    setSelectedQuestionIndex(0);
    setPreviewStep(0);
  }

  return <div className="mx-auto max-w-[1480px] space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <button type="button" onClick={() => navigate('/engagement/reports/feedback')} className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 transition-colors hover:text-primary-800">
          <i className="ri-arrow-left-line text-sm" aria-hidden="true" /> Back to Feedback
        </button>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground-900 sm:text-3xl">{formId ? 'Edit feedback form' : 'Create feedback form'}</h1>
        <p className="mt-1 text-sm text-foreground-500">{model.formType === 'post_lecture' ? 'Upload your question bank and choose how many questions appear each lecture.' : 'Build sections and questions, then preview the learner experience.'}</p>
      </div>
      <div className="sticky top-4 z-20 flex items-center gap-2 rounded-xl border border-foreground-200/70 bg-white/95 p-1.5 shadow-sm backdrop-blur">
        <button type="button" onClick={() => { setPreviewStep(0); setPreview(!preview); }} className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-100"><i className={`${preview ? 'ri-edit-line' : 'ri-eye-line'} text-sm`} aria-hidden="true" />{preview ? 'Edit form' : 'Preview'}</button>
        <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-[#541EA0] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#451884] disabled:cursor-not-allowed disabled:opacity-50"><i className="ri-save-line text-sm" aria-hidden="true" />{saving ? 'Saving…' : 'Save draft'}</button>
      </div>
    </div>
    {locked && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Questions and sections are locked because a learner has started this form. Form details and dates can still be updated.</div>}
    {versionInfo?.willCreateVersion && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">You are editing version {versionInfo.version}. Saving creates a new version for future deliveries; previous responses stay unchanged.</div>}
    {preview ? <div className="mx-auto max-w-4xl rounded-2xl border border-foreground-200/70 bg-white p-6 shadow-xl sm:p-8">{model.formType === 'post_lecture' && <p className="mb-4 text-xs text-primary-700">Bank preview shows all questions. Each lecture will show only its saved random selection.</p>}<FeedbackFormHeader title={model.title || 'Untitled feedback form'} description={model.description} instructions={model.instructions} /><FeedbackStepProgress sections={presentationSections} activeSection={presentationStep} onStepChange={setPreviewStep} /><FormRenderer sections={presentationSections} activeSection={presentationStep} answers={{}} readOnly /><div className="mt-7 grid grid-cols-3 items-center border-t border-foreground-100 pt-5"><div>{presentationStep > 0 && <button type="button" onClick={() => setPreviewStep(value => value - 1)} className="rounded-md bg-[#34405f] px-6 py-2.5 text-xs font-semibold text-white">Back</button>}</div><div className="flex justify-center">{presentationStep < presentationSections.length - 1 && <button type="button" onClick={() => setPreviewStep(value => value + 1)} className="rounded-md bg-[#34405f] px-6 py-2.5 text-xs font-semibold text-white">Next</button>}</div><p className="text-right text-xs text-foreground-500">{presentationStep + 1}/{presentationSections.length}</p></div></div> : <>
      <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-white shadow-sm">
        <div className="flex items-start gap-3 border-b border-foreground-100 bg-background-50/70 px-5 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700"><i className="ri-settings-3-line text-lg" aria-hidden="true" /></span>
          <div><h2 className="text-sm font-bold text-foreground-900">Form setup</h2><p className="mt-0.5 text-xs text-foreground-500">Choose when this form is used and who should receive it.</p></div>
        </div>
        <div className="grid gap-5 p-5 md:grid-cols-2">
        <div className="max-w-2xl"><BuilderSelect label="Form Type" value={model.formType} options={FORM_TYPE_OPTIONS} disabled={locked} onValueChange={value => { const formType = value as FeedbackFormInput['formType']; setModel(current => ({ ...current, formType, deliveryScope: ['post_lecture', 'mid_module', 'end_module'].includes(formType) ? 'all_modules' : 'manual', startDate: ['mid_module', 'end_module'].includes(formType) ? null : current.startDate, dueDate: ['mid_module', 'end_module'].includes(formType) ? null : current.dueDate, programmeId: '', cohortId: '', groupId: '', moduleCatalogueId: '', sections: formType === 'post_lecture' ? current.sections : current.sections.map(section => ({ ...section, questionsPerDelivery: null })) })); }} /></div>
        {(model.formType === 'post_mcm_review' || model.formType === 'post_progress_review') && <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 text-xs text-violet-800 md:col-span-2">Learners receive this form automatically only for matching reviews completed after this template is first published. Historical completed reviews are not backfilled.</div>}
        {model.formType === 'event_rsvp' && <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-xs text-emerald-800 md:col-span-2">This form is attached to an event invitation. Yes / No / Maybe is collected by the RSVP page; add any extra questions attendees should answer.</div>}
        {['post_lecture', 'mid_module', 'end_module'].includes(model.formType) && <div className="rounded-xl border border-primary-100 bg-primary-50/40 p-4 md:col-span-2">
          <div className="mb-4 flex items-start gap-3"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-primary-600 shadow-sm"><i className="ri-graduation-cap-line" aria-hidden="true" /></span><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-foreground-900">{model.formType === 'post_lecture' ? 'Live Sessions Feedback delivery' : 'Module delivery'}</h3><span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-700">Automatic</span></div><p className="mt-1 text-xs leading-5 text-foreground-500">{model.formType === 'post_lecture' ? 'Present learners receive this form automatically after finalized attendance.' : model.formType === 'mid_module' ? 'All assigned learners receive this form halfway between the module start and end dates.' : 'All assigned learners receive this form on the module end date.'} A module-specific form overrides the all-modules form.</p></div></div>
          {model.formType === 'post_lecture' ? <p className="mb-4 text-xs leading-5 text-foreground-600">Add your categories and questions below. Each lecture gets an automatic selection based on your settings.</p> : <p className="mb-4 text-xs leading-5 text-foreground-600">Module start and end dates must be valid. Dates use UK time. Modules ended before publication are excluded. Schedule changes move unanswered feedback; started responses keep their date and question version.</p>}
          <fieldset className="mb-3 max-w-2xl"><legend className="mb-1.5 text-xs font-semibold text-foreground-700">Delivery scope</legend><div className="grid gap-2 sm:grid-cols-2">{[
            { value: 'all_modules', label: 'All modules', description: 'Use this form by default for every module.', icon: 'ri-stack-line' },
            { value: 'module', label: 'One module only', description: 'Override the default for a specific module.', icon: 'ri-book-open-line' },
          ].map(option => <label key={option.value} className={`relative flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-all ${model.deliveryScope === option.value ? 'border-primary-400 bg-white shadow-sm ring-2 ring-primary-100' : 'border-foreground-200/80 bg-white/60 hover:border-primary-200 hover:bg-white'}`}><input type="radio" name="delivery-scope" value={option.value} checked={model.deliveryScope === option.value} onChange={() => setModel(current => ({ ...current, deliveryScope: option.value as FeedbackFormInput['deliveryScope'], programmeId: '', cohortId: '', groupId: '', moduleCatalogueId: '' }))} className="peer sr-only" /><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${model.deliveryScope === option.value ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-600'}`}><i className={option.icon} aria-hidden="true" /></span><span className="min-w-0"><span className="flex items-center gap-2 text-xs font-bold text-foreground-900">{option.label}{model.deliveryScope === option.value && <i className="ri-check-line text-primary-600" aria-hidden="true" />}</span><span className="mt-0.5 block text-[10px] leading-4 text-foreground-500">{option.description}</span></span></label>)}</div></fieldset>
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
        {model.formType === 'post_lecture' && <div className="rounded-xl border border-primary-100 bg-white p-4 md:col-span-2">
          <h3 className="text-sm font-semibold text-foreground-900">Reusable Live Sessions Feedback QR</h3>
          <p className="mt-1 text-xs text-foreground-500">Share this same QR every week. After sign-in, each learner sees only Live Sessions Feedback unlocked by their finalized attendance.</p>
          <div className="mt-3 flex flex-wrap items-center gap-4"><div className="rounded-lg border border-foreground-200 bg-white p-2"><QRCodeSVG value={lectureFeedbackUrl} size={150} level="M" marginSize={1} title="Live Sessions Feedback QR" /></div><div className="min-w-0 flex-1"><p className="break-all text-xs text-foreground-600">{lectureFeedbackUrl}</p><button type="button" className="mt-3 rounded-lg border border-primary-200 px-3 py-2 text-xs font-semibold text-primary-700" onClick={() => void navigator.clipboard.writeText(lectureFeedbackUrl).then(() => { setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 1600); }).catch(() => void Swal.fire({ icon: 'error', title: 'Could not copy link' }))}>{linkCopied ? 'Copied' : 'Copy link'}</button></div></div>
        </div>}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-white shadow-sm">
        <div className="flex items-start gap-3 border-b border-foreground-100 bg-background-50/70 px-5 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700"><i className="ri-file-text-line text-lg" aria-hidden="true" /></span>
          <div><h2 className="text-sm font-bold text-foreground-900">Form details</h2><p className="mt-0.5 text-xs text-foreground-500">Add the content, availability and response preferences learners will see.</p></div>
        </div>
        <div className="grid gap-5 p-5 md:grid-cols-2">
        <label className="text-xs font-semibold text-foreground-700 md:col-span-2">Form Name<input className={`${field} mt-1.5`} value={model.title} onChange={e => setModel({ ...model, title: e.target.value })} /></label>
        <label className="text-xs font-semibold text-foreground-700">Description<textarea className={`${field} mt-1.5`} rows={4} value={model.description} onChange={e => setModel({ ...model, description: e.target.value })} /></label>
        <label className="text-xs font-semibold text-foreground-700">Instructions<textarea className={`${field} mt-1.5`} rows={4} value={model.instructions} onChange={e => setModel({ ...model, instructions: e.target.value })} /></label>
        <div className="rounded-xl border border-foreground-100 bg-background-50/60 p-4 md:col-span-2">
          <div className="mb-4 flex items-start gap-3"><i className="ri-calendar-line mt-0.5 text-lg text-primary-600" aria-hidden="true" /><div><h3 className="text-xs font-bold text-foreground-900">Availability</h3><p className="mt-0.5 text-[11px] text-foreground-500">{model.formType === 'mid_module' || model.formType === 'end_module' ? 'Module dates determine when feedback opens. Responses remain open until the template is closed manually.' : 'Leave dates empty when the form should be available immediately without a deadline.'}</p></div></div>
          {!['mid_module', 'end_module'].includes(model.formType) && <div className="grid gap-4 md:grid-cols-2"><label className="text-xs font-semibold text-foreground-700">Start Date<input type="datetime-local" className={`${field} mt-1.5`} value={toLocal(model.startDate)} onChange={e => setModel({ ...model, startDate: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label><label className="text-xs font-semibold text-foreground-700">Due Date<input type="datetime-local" className={`${field} mt-1.5`} value={toLocal(model.dueDate)} onChange={e => setModel({ ...model, dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label></div>}
        </div>
        <div className="grid gap-3 md:col-span-2 lg:grid-cols-3">{[
          ['anonymousResponses', 'Anonymous responses', 'Hide learner identity in submitted responses.'],
          ['allowSaveContinue', 'Automatically save progress', 'Let learners leave and continue later.'],
          ['allowEditAfterSubmission', 'Allow editing after submission', 'Learners can revise a completed response.'],
        ].map(([key, label, description]) => <label key={key} className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-foreground-200/70 bg-background-50/60 p-4 transition-colors hover:border-primary-200 hover:bg-primary-50/30"><span><span className="block text-xs font-semibold text-foreground-800">{label}</span><span className="mt-1 block text-[11px] leading-4 text-foreground-500">{description}</span></span><span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0"><input type="checkbox" checked={Boolean(model[key as keyof FeedbackFormInput])} onChange={e => setModel({ ...model, [key]: e.target.checked })} className="peer sr-only" /><span className="absolute inset-0 rounded-full bg-foreground-200 transition-colors peer-checked:bg-primary-600 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-300 peer-focus-visible:ring-offset-2" /><span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" /></span></label>)}</div>
        </div>
      </section>

      {model.formType === 'post_lecture' && <section aria-label="Question bank import" className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-white shadow-sm">
        <div className="border-b border-foreground-100 bg-background-50/70 p-5"><h2 className="text-lg font-bold text-foreground-900">Question bank</h2><p className="mt-1 text-sm text-foreground-500">Upload your bank, then select a question in Form structure to edit it.</p></div>
        <div className="space-y-4 p-5"><QuestionBankImport locked={locked} onApply={applyBankSections} /><p role="status" className="rounded-xl bg-primary-50 px-4 py-3 text-sm font-semibold text-primary-800">Learners will answer {lectureQuestionCount} {lectureQuestionCount === 1 ? 'question' : 'questions'} per lecture.</p></div>
      </section>}
      <FormScoringSetup sections={model.sections} bank={model.formType === 'post_lecture'} locked={locked} onSelect={(sectionIndex, questionIndex) => {
        selectQuestion(sectionIndex, questionIndex);
        questionSettingsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      }} />
      <section className="grid items-start gap-4 xl:grid-cols-[290px_minmax(0,1fr)_360px]">
        <aside className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-white shadow-sm xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
          <div className="sticky top-0 z-10 border-b border-foreground-100 bg-white px-4 py-4">
            <div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-bold text-foreground-900"><i className="ri-node-tree text-primary-600" aria-hidden="true" />Form structure</h2><p className="mt-1 text-[11px] text-foreground-500">Select a question to edit its settings.</p></div><span className="rounded-full bg-primary-50 px-2 py-1 text-[10px] font-bold text-primary-700">{model.sections.length}</span></div>
          </div>
          <div className="space-y-3 p-3">
            {model.sections.map((section, sectionIndex) => <div key={sectionIndex} className={`rounded-xl border p-3 transition-colors ${sectionIndex === activeSectionIndex ? 'border-primary-200 bg-primary-50/40' : 'border-foreground-200/70 bg-background-50/40'}`}>
              <div className="mb-2 flex items-center justify-between gap-2"><button type="button" aria-label={`Select section ${sectionIndex + 1}: ${section.title}`} onClick={() => { setSelectedSectionIndex(sectionIndex); setSelectedQuestionIndex(0); setPreviewStep(sectionIndex); }} className="flex min-w-0 items-center gap-2 text-left"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white text-[10px] font-bold text-primary-700 shadow-sm">{sectionIndex + 1}</span><span className="truncate text-xs font-bold text-foreground-800">{section.title || `Section ${sectionIndex + 1}`}</span></button><div className="flex items-center gap-1"><MoveButtons label={`Section ${sectionIndex + 1}`} index={sectionIndex} length={closingIndex < 0 ? model.sections.length : categoryCount} onMove={direction => moveSectionAndSelection(sectionIndex, direction)} disabled={locked || sectionIndex === closingIndex} /><button type="button" aria-label={`Delete section ${sectionIndex + 1}`} disabled={locked || (model.formType === 'post_lecture' ? sectionIndex !== closingIndex && categoryCount <= 1 : model.sections.length === 1)} onClick={() => removeSection(sectionIndex)} className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-25"><i className="ri-delete-bin-line" aria-hidden="true" /></button></div></div>
              <div className="grid gap-2"><label className="relative"><span className="sr-only">Section {sectionIndex + 1} icon</span><i className={`${section.icon || 'ri-file-list-3-line'} pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-primary-600`} /><select disabled={locked} aria-label={`Section ${sectionIndex + 1} icon`} className={`${field} pl-9 text-xs`} value={section.icon || 'ri-file-list-3-line'} onChange={e => updateSection(sectionIndex, { icon: e.target.value })}>{FEEDBACK_SECTION_ICONS.map(icon => <option key={icon.value} value={icon.value}>{icon.label}</option>)}</select></label><input disabled={locked || sectionIndex === closingIndex} aria-label={`Section ${sectionIndex + 1} title`} className={`${field} text-xs font-semibold`} value={section.title} onChange={e => updateSection(sectionIndex, { title: e.target.value })} /><input disabled={locked} className={`${field} text-xs`} placeholder="Section description (optional)" value={section.description} onChange={e => updateSection(sectionIndex, { description: e.target.value })} /></div>
              {model.formType === 'post_lecture' && (sectionIndex === closingIndex
                ? <p className="mt-3 text-[11px] text-foreground-500">Closing question: shown at the end of every lecture.</p>
                : <label className="mt-3 block text-[11px] font-semibold text-foreground-700">Questions per lecture<select disabled={locked || !section.questions.length} aria-label={`Section ${sectionIndex + 1} questions per lecture`} className={`${field} mt-1 text-xs`} value={section.questionsPerDelivery ?? ''} onChange={event => updateSection(sectionIndex, { questionsPerDelivery: event.target.value ? Number(event.target.value) : null })}><option value="">All questions (fixed)</option>{section.questions.map((_, index) => <option key={index + 1} value={index + 1}>{index + 1} random {index ? 'questions' : 'question'}</option>)}</select><span className="mt-1 block font-normal text-foreground-500">{section.questions.length} in this category. {section.questionsPerDelivery == null ? 'All questions appear every lecture.' : section.questionsPerDelivery < section.questions.length ? 'Selected automatically for each lecture.' : 'Add more questions for a different mix.'}</span></label>)}
              <div className="mt-3 space-y-1.5">{section.questions.map((question, questionIndex) => <div key={questionIndex} className="flex items-center gap-1"><button type="button" aria-label={`Edit section ${sectionIndex + 1} question ${questionIndex + 1}: ${question.text || 'Untitled question'}`} aria-pressed={sectionIndex === activeSectionIndex && questionIndex === activeQuestionIndex} onClick={() => selectQuestion(sectionIndex, questionIndex)} className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${sectionIndex === activeSectionIndex && questionIndex === activeQuestionIndex ? 'border-primary-300 bg-white shadow-sm' : 'border-transparent hover:border-foreground-200 hover:bg-white'}`}><span className="text-[10px] font-bold text-foreground-400">{questionIndex + 1}</span><i className={`${question.type === 'rating' ? 'ri-star-line' : question.type === 'long_text' ? 'ri-message-3-line' : 'ri-question-line'} shrink-0 text-primary-600`} aria-hidden="true" /><span className="min-w-0"><span className="block truncate text-[11px] font-semibold text-foreground-800">{question.text || `Question ${questionIndex + 1}`}</span><span className="block text-[10px] text-foreground-400">{QUESTION_TYPES.find(type => type.value === question.type)?.label}</span></span></button><MoveButtons label={`Section ${sectionIndex + 1} question ${questionIndex + 1}`} index={questionIndex} length={section.questions.length} onMove={direction => moveQuestionAndSelection(sectionIndex, questionIndex, direction)} disabled={locked} /></div>)}</div>
              {sectionIndex !== closingIndex && <button type="button" aria-label={`+ Add Question to section ${sectionIndex + 1}`} disabled={locked} onClick={() => addQuestion(sectionIndex)} className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-primary-300 bg-white px-3 py-2 text-[11px] font-semibold text-primary-700 transition-colors hover:bg-primary-50 disabled:opacity-30"><i className="ri-add-line" aria-hidden="true" />Add question</button>}
            </div>)}
            <button type="button" aria-label="+ Add Section" disabled={locked} onClick={addSection} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary-300 bg-primary-50/30 px-4 py-3 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-50 disabled:opacity-30"><i className="ri-add-circle-line text-base" aria-hidden="true" />{model.formType === 'post_lecture' ? 'Add category' : 'Add section'}</button>
            {model.formType === 'post_lecture' && closingIndex < 0 && <button type="button" disabled={locked} onClick={() => { const sectionIndex = model.sections.length; setSections([...model.sections, { title: 'General comments', icon: 'ri-chat-3-line', description: '', questionsPerDelivery: null, questions: [emptyQuestion()] }]); selectQuestion(sectionIndex, 0); }} className="w-full rounded-xl border border-primary-200 px-4 py-3 text-xs font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-30">Add closing question</button>}
          </div>
        </aside>

        <main className="min-w-0 overflow-hidden rounded-2xl border border-foreground-200/70 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground-100 bg-background-50/70 px-4 py-3"><div><h2 className="flex items-center gap-2 text-sm font-bold text-foreground-900"><i className="ri-macbook-line text-primary-600" aria-hidden="true" />Form preview</h2><p className="mt-0.5 text-[11px] text-foreground-500">{model.formType === 'post_lecture' ? 'Edit the full bank by category. Each lecture shows only the saved automatic selection in one form.' : 'This is how learners will see the form.'}</p></div><div className="flex rounded-lg border border-primary-200 bg-white p-1"><button type="button" onClick={() => setPreviewViewport('desktop')} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold ${previewViewport === 'desktop' ? 'bg-primary-600 text-white' : 'text-foreground-500'}`}><i className="ri-computer-line" aria-hidden="true" />Desktop</button><button type="button" onClick={() => setPreviewViewport('mobile')} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold ${previewViewport === 'mobile' ? 'bg-primary-600 text-white' : 'text-foreground-500'}`}><i className="ri-smartphone-line" aria-hidden="true" />Mobile</button></div></div>
          <div className="bg-[#f6f4fb] p-4 sm:p-6"><div className={`mx-auto rounded-2xl border border-foreground-200/70 bg-white p-5 shadow-sm transition-[max-width] sm:p-6 ${previewViewport === 'mobile' ? 'max-w-[390px]' : 'max-w-4xl'}`}><FeedbackFormHeader title={model.title || 'Untitled feedback form'} description={model.description} instructions={model.instructions} /><FeedbackStepProgress sections={model.sections} activeSection={activeSectionIndex} onStepChange={step => { setPreviewStep(step); setSelectedSectionIndex(step); setSelectedQuestionIndex(0); }} /><FormRenderer sections={model.sections} activeSection={activeSectionIndex} answers={{}} readOnly /><div className="mt-6 grid grid-cols-3 items-center border-t border-foreground-100 pt-4"><div>{activeSectionIndex > 0 && <button type="button" onClick={() => { const step = activeSectionIndex - 1; setPreviewStep(step); setSelectedSectionIndex(step); setSelectedQuestionIndex(0); }} className="rounded-md bg-[#34405f] px-4 py-2 text-xs font-semibold text-white">Back</button>}</div><div className="flex justify-center">{activeSectionIndex < model.sections.length - 1 && <button type="button" onClick={() => { const step = activeSectionIndex + 1; setPreviewStep(step); setSelectedSectionIndex(step); setSelectedQuestionIndex(0); }} className="rounded-md bg-[#34405f] px-4 py-2 text-xs font-semibold text-white">Next</button>}</div><p className="text-right text-xs text-foreground-500">{activeSectionIndex + 1}/{model.sections.length}</p></div></div></div>
        </main>

        <aside ref={questionSettingsRef} className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-white shadow-sm xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
          <div className="sticky top-0 z-10 border-b border-foreground-100 bg-white px-4 py-4"><div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-bold text-foreground-900"><i className="ri-edit-2-line text-primary-600" aria-hidden="true" />Question settings</h2><p className="mt-1 text-[11px] text-foreground-500">Edit the selected question.</p></div>{activeQuestion && <span className="rounded-full bg-primary-50 px-2 py-1 text-[10px] font-bold text-primary-700">{activeQuestionIndex + 1} of {activeSection.questions.length}</span>}</div></div>
          {activeQuestion ? <div className="space-y-4 p-4">
            <div className="rounded-xl border border-primary-100 bg-primary-50/50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-primary-600">Selected question</p><p className="mt-1 truncate text-xs font-semibold text-foreground-900">{activeQuestion.text || `Question ${activeQuestionIndex + 1}`}</p><p className="mt-0.5 text-[10px] text-foreground-500">{activeSection.title}</p></div>
            <label className="block text-xs font-semibold text-foreground-700">Question text<input disabled={locked} className={`${field} mt-1.5`} placeholder="Question text" value={activeQuestion.text} onChange={event => updateQuestion(activeSectionIndex, activeQuestionIndex, { text: event.target.value })} /></label>
            <label className="block text-xs font-semibold text-foreground-700">Question type<select disabled={locked || activeSectionIndex === closingIndex} aria-label={`Question ${activeQuestionIndex + 1} type`} className={`${field} mt-1.5`} value={activeQuestion.type} onChange={event => { const type = event.target.value as FeedbackQuestionType; updateQuestion(activeSectionIndex, activeQuestionIndex, { type, config: { ...(CHOICE_TYPES.has(type) ? { options: ['Option 1', 'Option 2'] } : type === 'rating' ? { min: 1, max: 5, display: 'stars' as const, labels: ['', '', '', '', ''] } : {}), ...analyticsForNewType(activeQuestion, type) } }); }}>{QUESTION_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
            <label className="block text-xs font-semibold text-foreground-700">Help text <span className="font-normal text-foreground-400">(optional)</span><textarea disabled={locked} className={`${field} mt-1.5`} rows={3} placeholder="Add guidance for learners" value={activeQuestion.helpText} onChange={event => updateQuestion(activeSectionIndex, activeQuestionIndex, { helpText: event.target.value })} /></label>
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-foreground-200/70 bg-background-50/60 p-3"><span><span className="block text-xs font-semibold text-foreground-800">Required question</span><span className="mt-0.5 block text-[10px] text-foreground-500">Learners must provide a response.</span></span><span className="relative inline-flex h-5 w-9 shrink-0"><input disabled={locked} type="checkbox" checked={activeQuestion.required} onChange={event => updateQuestion(activeSectionIndex, activeQuestionIndex, { required: event.target.checked })} className="peer sr-only" /><span className="absolute inset-0 rounded-full bg-foreground-200 transition-colors peer-checked:bg-primary-600" /><span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" /></span></label>
            {activeQuestion.type === 'rating' && <RatingEditor question={activeQuestion} disabled={locked} onChange={config => updateQuestion(activeSectionIndex, activeQuestionIndex, { config })} />}
            <QuestionAnalyticsSettings question={activeQuestion} disabled={locked} onChange={config => updateQuestion(activeSectionIndex, activeQuestionIndex, { config })}
              renderAnswerOptions={CHOICE_TYPES.has(activeQuestion.type) ? renderScore => <OptionEditor labelPrefix="Answer option" options={activeQuestion.config.options || []} disabled={locked} renderScore={renderScore} onChange={options => updateQuestion(activeSectionIndex, activeQuestionIndex, { config: withAnswerOptions(activeQuestion, options) })} /> : undefined}
            />
            <button type="button" disabled={locked} onClick={() => removeQuestion(activeSectionIndex, activeQuestionIndex)} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-30"><i className="ri-delete-bin-line" aria-hidden="true" />Remove question</button>
          </div> : <div className="p-6 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-500"><i className="ri-question-line text-xl" aria-hidden="true" /></span><p className="mt-3 text-sm font-semibold text-foreground-800">No question selected</p><p className="mt-1 text-xs text-foreground-500">Add or select a question from the structure panel.</p>{activeSection && <button type="button" disabled={locked} onClick={() => addQuestion(activeSectionIndex)} className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-30">Add question</button>}</div>}
        </aside>
      </section>
      </div>
    </>}
  </div>;
}

function BuilderSelect({ label, value, options, disabled, onValueChange }: { label: string; value: string; options: BuilderSelectOption[]; disabled?: boolean; onValueChange: (value: string) => void }) {
  const selectedOption = options.find(option => option.value === value) || options[0];
  return <div>
    <span className="mb-1.5 block text-xs font-semibold text-foreground-700">{label}</span>
    <SelectPrimitive.Root value={value} disabled={disabled} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger aria-label={label} className="group flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-foreground-200/80 bg-white px-3.5 py-2 text-left outline-none transition-all hover:border-primary-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:bg-background-100 disabled:opacity-60">
        <span className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><i className={selectedOption.icon} aria-hidden="true" /></span><span className="min-w-0"><span className="block truncate text-xs font-bold text-foreground-900">{selectedOption.label}</span><span className="block truncate text-[10px] text-foreground-500">{selectedOption.description}</span></span></span>
        <SelectPrimitive.Icon asChild><i className="ri-arrow-down-s-line shrink-0 text-lg text-foreground-400 transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden="true" /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={6} collisionPadding={12} className="z-[100] max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-foreground-200/80 bg-white p-1.5 shadow-xl outline-none">
          <SelectPrimitive.Viewport>
            {options.map(option => <SelectPrimitive.Item key={option.value} value={option.value} className="relative flex cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2.5 pr-10 outline-none transition-colors data-[highlighted]:bg-primary-50 data-[state=checked]:bg-primary-50/70">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><i className={option.icon} aria-hidden="true" /></span>
              <span className="min-w-0"><SelectPrimitive.ItemText><span className="block text-xs font-bold text-foreground-900">{option.label}</span></SelectPrimitive.ItemText><span className="mt-0.5 block text-[10px] leading-4 text-foreground-500">{option.description}</span></span>
              <SelectPrimitive.ItemIndicator className="absolute right-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-white"><i className="ri-check-line text-xs" aria-hidden="true" /></SelectPrimitive.ItemIndicator>
            </SelectPrimitive.Item>)}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  </div>;
}

function RatingEditor({ question, disabled, onChange }: { question: FeedbackQuestion; disabled: boolean; onChange: (config: FeedbackQuestion['config']) => void }) {
  const display = question.config.display || 'numbers';
  const labels = Array.from({ length: 5 }, (_, index) => question.config.labels?.[index] || '');
  return <div className="mt-3 space-y-3 rounded-lg border border-amber-200/70 bg-amber-50/40 p-3">
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-xs font-semibold text-foreground-700">Rating style<select disabled={disabled} aria-label="Rating style" className={`${field} mt-1`} value={display} onChange={event => {
        const nextDisplay = event.target.value as 'stars' | 'numbers';
        onChange({ ...question.config, display: nextDisplay, min: 1, max: nextDisplay === 'stars' ? 5 : question.config.max || 5, labels: nextDisplay === 'stars' ? labels : question.config.labels });
      }}><option value="stars">Stars</option><option value="numbers">Numbers</option></select></label>
      {display === 'numbers' && <label className="text-xs font-semibold text-foreground-700">Scale<select disabled={disabled} aria-label="Rating scale" className={`${field} mt-1`} value={question.config.max || 5} onChange={event => onChange({ ...question.config, min: 1, max: Number(event.target.value) })}><option value={5}>1–5</option><option value={10}>1–10</option></select></label>}
    </div>
    {display === 'stars'
      ? <div><p className="mb-2 text-xs font-semibold text-foreground-700">Description for each star</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{labels.map((label, index) => <label key={index} className="text-[11px] font-medium text-foreground-600">{index + 1} star<input disabled={disabled} aria-label={`${index + 1} star description`} className={`${field} mt-1`} placeholder={`Description for ${index + 1}`} value={label} onChange={event => {
        const nextLabels = [...labels]; nextLabels[index] = event.target.value;
        onChange({ ...question.config, display: 'stars', min: 1, max: 5, labels: nextLabels });
      }} /></label>)}</div></div>
      : <div className="grid gap-2 sm:grid-cols-2"><input disabled={disabled} className={field} placeholder="1 label (e.g. Very Poor)" value={question.config.minLabel || ''} onChange={event => onChange({ ...question.config, minLabel: event.target.value })} /><input disabled={disabled} className={field} placeholder="Max label (e.g. Excellent)" value={question.config.maxLabel || ''} onChange={event => onChange({ ...question.config, maxLabel: event.target.value })} /></div>}
  </div>;
}

function MoveButtons({ index, length, onMove, disabled, label }: { index: number; length: number; onMove: (direction: -1 | 1) => void; disabled: boolean; label?: string }) { return <div className="flex shrink-0 gap-1"><button type="button" aria-label={label ? `Move ${label.toLowerCase()} up` : 'Move up'} disabled={disabled || index === 0} onClick={() => onMove(-1)} className="rounded border px-2 text-xs disabled:opacity-25">↑</button><button type="button" aria-label={label ? `Move ${label.toLowerCase()} down` : 'Move down'} disabled={disabled || index === length - 1} onClick={() => onMove(1)} className="rounded border px-2 text-xs disabled:opacity-25">↓</button></div>; }
function ScopeSelect({ label, value, options, placeholder, disabled, onChange }: { label: string; value: string; options: Array<{ id: string; name: string }>; placeholder: string; disabled: boolean; onChange: (value: string) => void }) { return <label className="text-xs font-semibold text-foreground-700">{label}<select aria-label={label} required className={`${field} mt-1`} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}><option value="">{placeholder}</option>{options.map(option => <option key={option.id} value={option.id}>{option.name || option.id}</option>)}</select></label>; }
function OptionEditor({ options, onChange, disabled, labelPrefix, renderScore }: {
  options: string[]; onChange: (options: string[]) => void; disabled: boolean; labelPrefix?: string;
  renderScore: (option: string, index: number) => ReactNode;
}) {
  return <div className="mt-3 space-y-2">
    <div className={scoringStyles.optionEditorHeading}><span>Answer option</span><span>Score (%)</span></div>
    {options.map((option, index) => <div key={index} className={scoringStyles.scoredOptionRow}>
      <input disabled={disabled} aria-label={labelPrefix ? `${labelPrefix} ${index + 1}` : undefined} className={field} value={option} onChange={e => onChange(options.map((item, i) => i === index ? e.target.value : item))} />
      {renderScore(option, index)}
      <div className={scoringStyles.optionActions}>
        <MoveButtons disabled={disabled} index={index} length={options.length} onMove={direction => { const next = [...options]; const target = index + direction; [next[index], next[target]] = [next[target], next[index]]; onChange(next); }} />
        <button type="button" disabled={disabled || options.length <= 2} onClick={() => onChange(options.filter((_, i) => i !== index))} className="px-2 text-xs text-red-600 disabled:opacity-30">Remove</button>
      </div>
    </div>)}
    <button type="button" disabled={disabled} onClick={() => onChange([...options, `Option ${options.length + 1}`])} className="text-xs font-semibold text-primary-600">+ Add Option</button>
  </div>;
}
function sameId(left: string, right: string) { return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase(); }
function toLocal(value: string | null) { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
