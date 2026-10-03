import { useEffect, useState, type ReactNode } from 'react';
import { feedbackUploadUrl, type FeedbackAnswerValue, type FeedbackNameAnswer, type FeedbackPhotoAnswer, type FeedbackQuestion, type FeedbackSection } from '@/api/feedback';

interface Props {
  sections: FeedbackSection[];
  answers: Record<string, FeedbackAnswerValue>;
  onChange?: (questionId: number, value: FeedbackAnswerValue) => void;
  readOnly?: boolean;
  activeSection?: number;
  invalidQuestionIds?: Set<number>;
  onPhotoUpload?: (questionId: number, file: File) => Promise<FeedbackPhotoAnswer>;
  onPhotoRemove?: (uploadId: string) => Promise<void>;
  loadPhoto?: (uploadId: string) => Promise<Blob>;
  dragDropPhotos?: boolean;
}

const inputClass = 'w-full rounded-lg border border-foreground-200/70 bg-white px-3 py-2 text-sm text-foreground-800 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:bg-background-100';

export function FeedbackFormHeader({ title, description, instructions }: { title: string; description?: string; instructions?: string }) {
  return <header className="mb-6 border-b border-foreground-200/70 pb-5">
    <div className="flex flex-wrap items-center gap-5">
      <img src="/kbc-logo.png" alt="Kent Business College" className="h-20 w-auto max-w-[240px] object-contain" />
      <div className="min-w-0 flex-1"><h1 className="font-heading text-2xl font-bold text-foreground-900">{title}</h1>{description && <p className="mt-1 text-sm text-foreground-500">{description}</p>}</div>
    </div>
    {instructions && <p className="mt-4 rounded-lg bg-primary-50 p-3 text-xs text-primary-800">{instructions}</p>}
  </header>;
}

export function FeedbackStepProgress({ sections, activeSection, onStepChange }: { sections: FeedbackSection[]; activeSection: number; onStepChange?: (index: number) => void }) {
  if (sections.length < 2) return null;
  return <nav aria-label="Form progress" className="relative mb-8 overflow-x-auto pb-2">
    <div className="absolute left-[7%] right-[7%] top-3 h-px bg-foreground-300" aria-hidden="true" />
    <ol className="relative flex min-w-max justify-between gap-4 sm:min-w-0">
      {sections.map((section, index) => {
        const active = index === activeSection;
        const complete = index < activeSection;
        return <li key={section.id ?? `${section.title}-${index}`} className="min-w-28 flex-1 text-center">
          <button type="button" disabled={!onStepChange} onClick={() => onStepChange?.(index)} aria-current={active ? 'step' : undefined} className="w-full disabled:cursor-default">
            <span className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold shadow-sm ${active ? 'border-[#34405f] bg-[#34405f] text-white ring-2 ring-[#34405f]/20 ring-offset-2' : complete ? 'border-[#53617f] bg-[#53617f] text-white' : 'border-[#9ba5bd] bg-[#9ba5bd] text-white'}`}>{index + 1}</span>
            <span className={`mt-3 flex items-center justify-center gap-1.5 whitespace-nowrap text-[11px] font-medium sm:text-xs ${active ? 'text-[#34405f]' : complete ? 'text-foreground-600' : 'text-foreground-400'}`}><i className={section.icon || 'ri-file-list-3-line'} aria-hidden="true" />{section.title}</span>
          </button>
        </li>;
      })}
    </ol>
  </nav>;
}

interface FeedbackFormExperienceProps extends Props {
  title: string;
  description?: string;
  instructions?: string;
  activeSection: number;
  onStepChange?: (index: number) => void;
  onBack?: () => void;
  onNext?: () => void;
  onSubmit?: () => void;
  submitting?: boolean;
  footerStatus?: ReactNode;
}

/**
 * The canonical respondent experience shared by learner, guest and future
 * feedback delivery types. Authentication changes how answers are transported,
 * not how the form itself is presented or navigated.
 */
export function FeedbackFormExperience({
  title, description, instructions, sections, answers, onChange,
  readOnly = false, activeSection, invalidQuestionIds, onPhotoUpload, onPhotoRemove, loadPhoto, dragDropPhotos = false,
  onStepChange, onBack, onNext, onSubmit, submitting = false, footerStatus,
}: FeedbackFormExperienceProps) {
  const isLast = activeSection >= sections.length - 1;
  return <>
    <FeedbackFormHeader title={title} description={description} instructions={instructions} />
    <FeedbackStepProgress sections={sections} activeSection={activeSection} onStepChange={onStepChange} />
    <FormRenderer sections={sections} activeSection={activeSection} answers={answers}
      invalidQuestionIds={invalidQuestionIds} onChange={onChange}
      onPhotoUpload={onPhotoUpload} onPhotoRemove={onPhotoRemove} loadPhoto={loadPhoto} dragDropPhotos={dragDropPhotos} readOnly={readOnly} />
    {sections.length > 0 && <div className="mt-7 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-foreground-100 pt-5">
      <div className="flex items-center gap-3">
        {activeSection > 0 && onBack && <button type="button" onClick={onBack} className="rounded-md bg-[#34405f] px-6 py-2.5 text-xs font-semibold text-white">Back</button>}
        {footerStatus}
      </div>
      {!readOnly && (!isLast
        ? <button type="button" onClick={onNext} className="rounded-md bg-[#34405f] px-6 py-2.5 text-xs font-semibold text-white">Next</button>
        : <button type="button" disabled={submitting} onClick={onSubmit} className="rounded-md bg-[#541EA0] px-6 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{submitting ? 'Submitting…' : 'Submit'}</button>)}
      <p className="text-right text-xs text-foreground-500">{activeSection + 1}/{sections.length}</p>
    </div>}
  </>;
}

export function FormRenderer({ sections, answers, onChange, readOnly = false, activeSection, invalidQuestionIds, onPhotoUpload, onPhotoRemove, loadPhoto, dragDropPhotos = false }: Props) {
  const visible = activeSection === undefined ? sections : sections.slice(activeSection, activeSection + 1);
  return <div className="space-y-6">
    {visible.map(section => <section key={section.id ?? section.title} className="rounded-xl border border-foreground-200/60 bg-background-50 p-5">
      <h2 className="font-heading text-base font-semibold text-foreground-900">{section.title}</h2>
      {section.description && <p className="mt-1 text-xs text-foreground-500">{section.description}</p>}
      <div className="mt-5 space-y-5">
        {section.questions.map((question, index) => <QuestionField
          key={question.id ?? `${question.text}-${index}`} question={question}
          value={question.id ? answers[String(question.id)] : null} readOnly={readOnly}
          invalid={Boolean(question.id && invalidQuestionIds?.has(question.id))}
          onChange={value => question.id && onChange?.(question.id, value)}
          onPhotoUpload={question.id && onPhotoUpload ? file => onPhotoUpload(question.id!, file) : undefined}
          onPhotoRemove={onPhotoRemove}
          loadPhoto={loadPhoto}
          dragDropPhotos={dragDropPhotos}
        />)}
        {!section.questions.length && <p className="text-sm text-foreground-400">No questions in this section.</p>}
      </div>
    </section>)}
  </div>;
}

function QuestionField({ question, value, onChange, readOnly, invalid, onPhotoUpload, onPhotoRemove, loadPhoto, dragDropPhotos }: { question: FeedbackQuestion; value: FeedbackAnswerValue | undefined; onChange: (value: FeedbackAnswerValue) => void; readOnly: boolean; invalid: boolean; onPhotoUpload?: (file: File) => Promise<FeedbackPhotoAnswer>; onPhotoRemove?: (uploadId: string) => Promise<void>; loadPhoto?: (uploadId: string) => Promise<Blob>; dragDropPhotos: boolean }) {
  const options = question.config.options || [];
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const nameValue: FeedbackNameAnswer = isNameAnswer(value) ? value : { firstName: '', lastName: '' };
  const photoValue = isPhotoAnswer(value) ? value : null;
  const photoUploadId = photoValue?.uploadId;
  const [photoSrc, setPhotoSrc] = useState('');
  const [draggingPhoto, setDraggingPhoto] = useState(false);
  const inputId = `feedback-question-${question.id ?? question.text.replace(/\W+/g, '-').toLowerCase()}`;
  const hasSingleInput = ['short_text', 'long_text', 'number', 'date', 'email', 'dropdown'].includes(question.type);
  async function uploadPhoto(file?: File) {
    if (!file || !onPhotoUpload) return;
    setUploading(true); setUploadError('');
    try { onChange(await onPhotoUpload(file)); }
    catch (error) { setUploadError(error instanceof Error ? error.message : 'Photo upload failed.'); }
    finally { setUploading(false); }
  }
  async function removePhoto() {
    if (!photoValue || !onPhotoRemove) return;
    setRemovingPhoto(true); setUploadError('');
    try { await onPhotoRemove(photoValue.uploadId); onChange(null); }
    catch (error) { setUploadError(error instanceof Error ? error.message : 'Photo could not be removed.'); }
    finally { setRemovingPhoto(false); }
  }
  function dropPhoto(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDraggingPhoto(false);
    if (!dragDropPhotos || uploading || removingPhoto) return;
    void uploadPhoto(event.dataTransfer.files?.[0]);
  }
  useEffect(() => {
    if (!photoUploadId) { setPhotoSrc(''); return; }
    if (!loadPhoto) { setPhotoSrc(feedbackUploadUrl(photoUploadId)); return; }
    let active = true;
    let objectUrl = '';
    loadPhoto(photoUploadId).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setPhotoSrc(objectUrl);
    }).catch(() => { if (active) setPhotoSrc(''); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoUploadId, loadPhoto]);
  return <div className={invalid ? 'rounded-lg border border-red-200 bg-red-50/50 p-3' : ''}>
    <label htmlFor={hasSingleInput ? inputId : undefined} className="mb-2 block text-sm font-medium text-foreground-800">
      {question.text} {question.required && <span className="text-red-500">*</span>}
    </label>
    {question.helpText && <p className="mb-2 text-xs text-foreground-400">{question.helpText}</p>}
    {question.type === 'short_text' && <input id={inputId} className={inputClass} disabled={readOnly} value={String(value ?? '')} onChange={e => onChange(e.target.value)} />}
    {question.type === 'long_text' && <textarea id={inputId} rows={4} className={inputClass} disabled={readOnly} value={String(value ?? '')} onChange={e => onChange(e.target.value)} />}
    {question.type === 'number' && <input id={inputId} type="number" className={inputClass} disabled={readOnly} value={value === null || value === undefined ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />}
    {question.type === 'date' && <input id={inputId} type="date" className={inputClass} disabled={readOnly} value={String(value ?? '')} onChange={e => onChange(e.target.value)} />}
    {question.type === 'email' && <div className="relative"><i className="ri-mail-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" /><input id={inputId} type="email" className={`${inputClass} pl-9`} disabled={readOnly} value={typeof value === 'string' ? value : ''} placeholder="name@example.com" onChange={e => onChange(e.target.value)} /></div>}
    {question.type === 'name' && <div className="grid gap-3 sm:grid-cols-2"><label className="text-[11px] text-foreground-500"><span className="relative block"><i className="ri-user-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" /><input className={`${inputClass} pl-9`} disabled={readOnly} value={nameValue.firstName} onChange={e => onChange({ ...nameValue, firstName: e.target.value })} /></span><span className="mt-1 block">First Name</span></label><label className="text-[11px] text-foreground-500"><input className={inputClass} disabled={readOnly} value={nameValue.lastName} onChange={e => onChange({ ...nameValue, lastName: e.target.value })} /><span className="mt-1 block">Last Name</span></label></div>}
    {question.type === 'yes_no' && <div className="flex gap-3">{[['yes', 'Yes'], ['no', 'No']].map(([key, label]) => <Choice key={key} label={label} checked={value === key} disabled={readOnly} onChange={() => onChange(key)} />)}</div>}
    {(question.type === 'single_choice' || question.type === 'likert') && <div className="flex flex-wrap gap-3">{options.map(option => <Choice key={option} label={option} checked={value === option} disabled={readOnly} onChange={() => onChange(option)} />)}</div>}
    {question.type === 'multiple_choice' && <div className="space-y-2">{options.map(option => {
      const selected = Array.isArray(value) ? value : [];
      return <Choice key={option} checkbox label={option} checked={selected.includes(option)} disabled={readOnly} onChange={() => onChange(selected.includes(option) ? selected.filter(x => x !== option) : [...selected, option])} />;
    })}</div>}
    {question.type === 'dropdown' && <select id={inputId} className={inputClass} disabled={readOnly} value={String(value ?? '')} onChange={e => onChange(e.target.value)}><option value="">Select an option</option>{options.map(option => <option key={option}>{option}</option>)}</select>}
    {question.type === 'rating' && <div className="flex flex-wrap items-center gap-2"><span className="text-[11px] text-foreground-400">{question.config.minLabel}</span>{Array.from({ length: question.config.max || 5 }, (_, i) => i + 1).map(number => <button key={number} type="button" disabled={readOnly} onClick={() => onChange(number)} className={`h-9 w-9 rounded-lg border text-xs font-semibold ${value === number ? 'border-primary-500 bg-primary-500 text-white' : 'border-foreground-200 bg-white text-foreground-600'} disabled:cursor-default`}>{number}</button>)}<span className="text-[11px] text-foreground-400">{question.config.maxLabel}</span></div>}
    {question.type === 'photo_upload' && <div
      onDragEnter={dragDropPhotos && !readOnly ? event => { event.preventDefault(); setDraggingPhoto(true); } : undefined}
      onDragOver={dragDropPhotos && !readOnly ? event => event.preventDefault() : undefined}
      onDragLeave={dragDropPhotos && !readOnly ? () => setDraggingPhoto(false) : undefined}
      onDrop={dragDropPhotos && !readOnly ? dropPhoto : undefined}
      className={`rounded-lg border border-dashed bg-white p-4 transition-colors ${draggingPhoto ? 'border-primary-600 bg-primary-50 ring-2 ring-primary-200' : 'border-primary-300'}`}>
      {photoValue && <div className="mb-3 flex items-center gap-3">{photoSrc && <img src={photoSrc} alt="Uploaded response" className="h-16 w-16 rounded-lg border object-cover" />}<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground-700">{photoValue.filename}</span>{onPhotoRemove && !readOnly && <button type="button" disabled={uploading || removingPhoto} onClick={() => void removePhoto()} className="shrink-0 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">{removingPhoto ? 'Removing…' : 'Remove image'}</button>}</div>}
      {!readOnly && <label className="flex cursor-pointer items-center justify-between gap-3 text-xs font-semibold text-primary-700"><span>{uploading ? 'Uploading photo…' : photoValue ? 'Replace photo' : dragDropPhotos ? 'Choose or drop JPG, PNG or WebP (up to 20 MB)' : 'Choose JPG, PNG or WebP'}</span><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50"><i className="ri-upload-cloud-2-line text-base" /></span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading || !onPhotoUpload} className="sr-only" onChange={e => { const file = e.target.files?.[0]; e.currentTarget.value = ''; void uploadPhoto(file); }} /></label>}
      {readOnly && !photoValue && <p className="text-xs text-foreground-400">No photo uploaded.</p>}{uploadError && <p className="mt-2 text-xs text-red-600">{uploadError}</p>}
    </div>}
    {invalid && <p role="alert" className="mt-2 text-xs font-medium text-red-600">This field is required before continuing.</p>}
  </div>;
}

function isNameAnswer(value: FeedbackAnswerValue | undefined): value is FeedbackNameAnswer { return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'firstName' in value && 'lastName' in value); }
function isPhotoAnswer(value: FeedbackAnswerValue | undefined): value is FeedbackPhotoAnswer { return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'uploadId' in value); }

function Choice({ label, checked, disabled, onChange, checkbox = false }: { label: string; checked: boolean; disabled: boolean; onChange: () => void; checkbox?: boolean }) {
  return <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground-700"><input type={checkbox ? 'checkbox' : 'radio'} checked={checked} disabled={disabled} onChange={onChange} className="accent-primary-600" />{label}</label>;
}
