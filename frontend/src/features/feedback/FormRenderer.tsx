import { useState } from 'react';
import { feedbackUploadUrl, type FeedbackAnswerValue, type FeedbackNameAnswer, type FeedbackPhotoAnswer, type FeedbackQuestion, type FeedbackSection } from '@/api/feedback';

interface Props {
  sections: FeedbackSection[];
  answers: Record<string, FeedbackAnswerValue>;
  onChange?: (questionId: number, value: FeedbackAnswerValue) => void;
  readOnly?: boolean;
  activeSection?: number;
  onPhotoUpload?: (questionId: number, file: File) => Promise<FeedbackPhotoAnswer>;
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

export function FormRenderer({ sections, answers, onChange, readOnly = false, activeSection, onPhotoUpload }: Props) {
  const visible = activeSection === undefined ? sections : sections.slice(activeSection, activeSection + 1);
  return <div className="space-y-6">
    {visible.map(section => <section key={section.id ?? section.title} className="rounded-xl border border-foreground-200/60 bg-background-50 p-5">
      <h2 className="font-heading text-base font-semibold text-foreground-900">{section.title}</h2>
      {section.description && <p className="mt-1 text-xs text-foreground-500">{section.description}</p>}
      <div className="mt-5 space-y-5">
        {section.questions.map((question, index) => <QuestionField
          key={question.id ?? `${question.text}-${index}`} question={question}
          value={question.id ? answers[String(question.id)] : null} readOnly={readOnly}
          onChange={value => question.id && onChange?.(question.id, value)}
          onPhotoUpload={question.id && onPhotoUpload ? file => onPhotoUpload(question.id!, file) : undefined}
        />)}
        {!section.questions.length && <p className="text-sm text-foreground-400">No questions in this section.</p>}
      </div>
    </section>)}
  </div>;
}

function QuestionField({ question, value, onChange, readOnly, onPhotoUpload }: { question: FeedbackQuestion; value: FeedbackAnswerValue | undefined; onChange: (value: FeedbackAnswerValue) => void; readOnly: boolean; onPhotoUpload?: (file: File) => Promise<FeedbackPhotoAnswer> }) {
  const options = question.config.options || [];
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const nameValue: FeedbackNameAnswer = isNameAnswer(value) ? value : { firstName: '', lastName: '' };
  const photoValue = isPhotoAnswer(value) ? value : null;
  async function uploadPhoto(file?: File) {
    if (!file || !onPhotoUpload) return;
    setUploading(true); setUploadError('');
    try { onChange(await onPhotoUpload(file)); }
    catch (error) { setUploadError(error instanceof Error ? error.message : 'Photo upload failed.'); }
    finally { setUploading(false); }
  }
  return <div>
    <label className="mb-2 block text-sm font-medium text-foreground-800">
      {question.text} {question.required && <span className="text-red-500">*</span>}
    </label>
    {question.helpText && <p className="mb-2 text-xs text-foreground-400">{question.helpText}</p>}
    {question.type === 'short_text' && <input className={inputClass} disabled={readOnly} value={String(value ?? '')} onChange={e => onChange(e.target.value)} />}
    {question.type === 'long_text' && <textarea rows={4} className={inputClass} disabled={readOnly} value={String(value ?? '')} onChange={e => onChange(e.target.value)} />}
    {question.type === 'number' && <input type="number" className={inputClass} disabled={readOnly} value={value === null || value === undefined ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />}
    {question.type === 'date' && <input type="date" className={inputClass} disabled={readOnly} value={String(value ?? '')} onChange={e => onChange(e.target.value)} />}
    {question.type === 'email' && <div className="relative"><i className="ri-mail-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" /><input type="email" className={`${inputClass} pl-9`} disabled={readOnly} value={typeof value === 'string' ? value : ''} placeholder="name@example.com" onChange={e => onChange(e.target.value)} /></div>}
    {question.type === 'name' && <div className="grid gap-3 sm:grid-cols-2"><label className="text-[11px] text-foreground-500"><span className="relative block"><i className="ri-user-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" /><input className={`${inputClass} pl-9`} disabled={readOnly} value={nameValue.firstName} onChange={e => onChange({ ...nameValue, firstName: e.target.value })} /></span><span className="mt-1 block">First Name</span></label><label className="text-[11px] text-foreground-500"><input className={inputClass} disabled={readOnly} value={nameValue.lastName} onChange={e => onChange({ ...nameValue, lastName: e.target.value })} /><span className="mt-1 block">Last Name</span></label></div>}
    {question.type === 'yes_no' && <div className="flex gap-3">{[['yes', 'Yes'], ['no', 'No']].map(([key, label]) => <Choice key={key} label={label} checked={value === key} disabled={readOnly} onChange={() => onChange(key)} />)}</div>}
    {(question.type === 'single_choice' || question.type === 'likert') && <div className="flex flex-wrap gap-3">{options.map(option => <Choice key={option} label={option} checked={value === option} disabled={readOnly} onChange={() => onChange(option)} />)}</div>}
    {question.type === 'multiple_choice' && <div className="space-y-2">{options.map(option => {
      const selected = Array.isArray(value) ? value : [];
      return <Choice key={option} checkbox label={option} checked={selected.includes(option)} disabled={readOnly} onChange={() => onChange(selected.includes(option) ? selected.filter(x => x !== option) : [...selected, option])} />;
    })}</div>}
    {question.type === 'dropdown' && <select className={inputClass} disabled={readOnly} value={String(value ?? '')} onChange={e => onChange(e.target.value)}><option value="">Select an option</option>{options.map(option => <option key={option}>{option}</option>)}</select>}
    {question.type === 'rating' && <div className="flex flex-wrap items-center gap-2"><span className="text-[11px] text-foreground-400">{question.config.minLabel}</span>{Array.from({ length: question.config.max || 5 }, (_, i) => i + 1).map(number => <button key={number} type="button" disabled={readOnly} onClick={() => onChange(number)} className={`h-9 w-9 rounded-lg border text-xs font-semibold ${value === number ? 'border-primary-500 bg-primary-500 text-white' : 'border-foreground-200 bg-white text-foreground-600'} disabled:cursor-default`}>{number}</button>)}<span className="text-[11px] text-foreground-400">{question.config.maxLabel}</span></div>}
    {question.type === 'photo_upload' && <div className="rounded-lg border border-dashed border-primary-300 bg-white p-4">{photoValue && <div className="mb-3 flex items-center gap-3"><img src={feedbackUploadUrl(photoValue.uploadId)} alt="Uploaded response" className="h-16 w-16 rounded-lg border object-cover" /><span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground-700">{photoValue.filename}</span></div>}{!readOnly && <label className="flex cursor-pointer items-center justify-between gap-3 text-xs font-semibold text-primary-700"><span>{uploading ? 'Uploading photo…' : photoValue ? 'Replace photo' : 'Choose JPG, PNG or WebP'}</span><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50"><i className="ri-upload-cloud-2-line text-base" /></span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading || !onPhotoUpload} className="sr-only" onChange={e => void uploadPhoto(e.target.files?.[0])} /></label>}{readOnly && !photoValue && <p className="text-xs text-foreground-400">No photo uploaded.</p>}{uploadError && <p className="mt-2 text-xs text-red-600">{uploadError}</p>}</div>}
  </div>;
}

function isNameAnswer(value: FeedbackAnswerValue | undefined): value is FeedbackNameAnswer { return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'firstName' in value && 'lastName' in value); }
function isPhotoAnswer(value: FeedbackAnswerValue | undefined): value is FeedbackPhotoAnswer { return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'uploadId' in value); }

function Choice({ label, checked, disabled, onChange, checkbox = false }: { label: string; checked: boolean; disabled: boolean; onChange: () => void; checkbox?: boolean }) {
  return <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground-700"><input type={checkbox ? 'checkbox' : 'radio'} checked={checked} disabled={disabled} onChange={onChange} className="accent-primary-600" />{label}</label>;
}
