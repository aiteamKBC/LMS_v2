import type { ReactNode } from 'react';
import type { QualityAnswer, QualityForm, QualityTemplate, Rating } from '@/api/coachingQualityReviews';

export const qualityControl = 'w-full min-w-0 rounded-lg border border-background-200 bg-white px-3 py-2 text-sm text-foreground-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500';
const ratingLabels: Record<string, string> = { gold: 'Gold', green: 'Green', amber: 'Amber', red: 'Red', na: 'N/A' };
const tones: Record<string, string> = { gold: 'border-yellow-500 bg-yellow-100 text-yellow-950', green: 'border-emerald-500 bg-emerald-50 text-emerald-900', amber: 'border-amber-500 bg-amber-50 text-amber-900', red: 'border-rose-500 bg-rose-50 text-rose-900', na: 'border-slate-500 bg-slate-100 text-slate-800' };

export default function QualityQuestions({ template, sectionId, form, onChange, renderImages, renderFiles }: {
  template: QualityTemplate; sectionId: string; form: QualityForm; onChange: (form: QualityForm) => void;
  renderImages?: (key: string, label: string) => ReactNode;
  renderFiles?: (key: string) => ReactNode;
}) {
  const section = template.sections.find(item => item.id === sectionId);
  if (!section) return null;
  const setAnswer = (key: string, value: QualityAnswer) => onChange({ ...form, answers: { ...form.answers, [key]: value } });
  const images = (key: string, label: string) => renderImages ? renderImages(key, label) : <div className="rounded-xl border border-dashed border-primary-200 bg-primary-50 p-4 text-sm text-primary-800">{label} · Image upload appears when completing a saved review.</div>;
  return <section aria-label={section.title} className="space-y-4">
    <h3 className="text-lg font-bold">{section.title}</h3>
    {section.criteria.map((item, index) => {
      const kind = item.type || 'rating', value = form.answers?.[item.id];
      const answer = form.criteria[item.id] ?? { rating: '', evidence: '' };
      return <fieldset key={item.id} className="min-w-0 rounded-xl border border-background-200 bg-white p-4">
        <legend className="sr-only">{item.text}</legend>
        <p className="break-words text-sm font-semibold leading-6">{index + 1}. {item.text} <span className="ml-1 text-[10px] font-normal text-foreground-500">{item.required === false ? 'Optional' : 'Required'}</span></p>
        {item.help && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-foreground-500">{item.help}</p>}
        {kind === 'rating' ? <>
          <div className="mt-3 flex flex-wrap gap-2">{Object.entries(template.ratings).filter(([rating]) => rating !== 'na' || item.allowNa !== false).map(([rating, description]) => <label key={rating} title={item.descriptors?.[rating as Exclude<Rating, ''>] || description} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold ${answer.rating === rating ? tones[rating] : 'border-background-200 text-foreground-600'}`}>
            <input type="radio" name={item.id} value={rating} checked={answer.rating === rating} onChange={() => onChange({ ...form, criteria: { ...form.criteria, [item.id]: { ...answer, rating: rating as Rating } } })} />{ratingLabels[rating]}</label>)}</div>
          {answer.rating && <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-foreground-600">{item.descriptors?.[answer.rating] || template.ratings[answer.rating]}</p>}
          {item.descriptors && <details className="mt-3 rounded-lg bg-background-50 p-3 text-xs"><summary className="cursor-pointer font-semibold text-primary-700">Reference criteria · what each rating means</summary><div className="mt-3 space-y-3">{Object.entries(item.descriptors).map(([key, text]) => <div key={key}><p className="font-bold">{ratingLabels[key]}</p><p className="mt-1 whitespace-pre-wrap leading-6">{text}</p></div>)}</div></details>}
          <label className="mt-4 grid gap-1.5 text-xs font-semibold">Evidence observed and impact on the learner<textarea rows={4} maxLength={6000} className={qualityControl} value={answer.evidence} onChange={event => onChange({ ...form, criteria: { ...form.criteria, [item.id]: { ...answer, evidence: event.target.value } } })} placeholder="Describe what you observed. Include the video time, report page or evidence reference." /></label>
        </> : kind === 'file' ? <div className="mt-3">{renderFiles?.(item.id) ?? 'Evidence upload appears when completing the form.'}</div> : kind === 'image' ? <div className="mt-3">{images(item.id, item.text)}</div>
          : kind === 'checklist' ? <div className="mt-3 grid gap-2">{item.options?.map(option => <label key={option} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={Array.isArray(value) && value.includes(option)} onChange={event => setAnswer(item.id, event.target.checked ? [...(Array.isArray(value) ? value : []), option] : (Array.isArray(value) ? value : []).filter(entry => entry !== option))} />{option}</label>)}</div>
            : kind === 'boolean' || kind === 'single_choice' ? <label className="mt-3 block"><span className="sr-only">{item.text}</span><select className={qualityControl} value={kind === 'boolean' ? value === true ? 'yes' : value === false ? 'no' : '' : String(value ?? '')} onChange={event => setAnswer(item.id, kind === 'boolean' ? event.target.value === '' ? null : event.target.value === 'yes' : event.target.value)}><option value="">Choose an answer</option>{kind === 'boolean' ? <><option value="yes">Yes</option><option value="no">No</option></> : item.options?.map(option => <option key={option}>{option}</option>)}</select></label>
              : kind === 'textarea' ? <label className="mt-3 block"><span className="sr-only">{item.text}</span><textarea className={qualityControl} rows={4} maxLength={6000} value={String(value ?? '')} onChange={event => setAnswer(item.id, event.target.value)} /></label>
                : <label className="mt-3 block"><span className="sr-only">{item.text}</span><input className={qualityControl} type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'} step={kind === 'number' ? 'any' : undefined} maxLength={1000} value={typeof value === 'number' || typeof value === 'string' ? value : ''} onChange={event => setAnswer(item.id, kind === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)} /></label>}
      </fieldset>;
    })}
    {section.screenshots && images(section.id, `${section.title} screenshots`)}
  </section>;
}
