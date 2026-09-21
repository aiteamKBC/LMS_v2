import type { FeedbackAnswerValue, FeedbackQuestion, FeedbackSection } from '@/api/feedback';

interface Props {
  sections: FeedbackSection[];
  answers: Record<string, FeedbackAnswerValue>;
  onChange?: (questionId: number, value: FeedbackAnswerValue) => void;
  readOnly?: boolean;
  activeSection?: number;
}

const inputClass = 'w-full rounded-lg border border-foreground-200/70 bg-white px-3 py-2 text-sm text-foreground-800 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:bg-background-100';

export function FormRenderer({ sections, answers, onChange, readOnly = false, activeSection }: Props) {
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
        />)}
        {!section.questions.length && <p className="text-sm text-foreground-400">No questions in this section.</p>}
      </div>
    </section>)}
  </div>;
}

function QuestionField({ question, value, onChange, readOnly }: { question: FeedbackQuestion; value: FeedbackAnswerValue | undefined; onChange: (value: FeedbackAnswerValue) => void; readOnly: boolean }) {
  const options = question.config.options || [];
  return <div>
    <label className="mb-2 block text-sm font-medium text-foreground-800">
      {question.text} {question.required && <span className="text-red-500">*</span>}
    </label>
    {question.helpText && <p className="mb-2 text-xs text-foreground-400">{question.helpText}</p>}
    {question.type === 'short_text' && <input className={inputClass} disabled={readOnly} value={String(value ?? '')} onChange={e => onChange(e.target.value)} />}
    {question.type === 'long_text' && <textarea rows={4} className={inputClass} disabled={readOnly} value={String(value ?? '')} onChange={e => onChange(e.target.value)} />}
    {question.type === 'number' && <input type="number" className={inputClass} disabled={readOnly} value={value === null || value === undefined ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />}
    {question.type === 'date' && <input type="date" className={inputClass} disabled={readOnly} value={String(value ?? '')} onChange={e => onChange(e.target.value)} />}
    {question.type === 'yes_no' && <div className="flex gap-3">{[['yes', 'Yes'], ['no', 'No']].map(([key, label]) => <Choice key={key} label={label} checked={value === key} disabled={readOnly} onChange={() => onChange(key)} />)}</div>}
    {(question.type === 'single_choice' || question.type === 'likert') && <div className="flex flex-wrap gap-3">{options.map(option => <Choice key={option} label={option} checked={value === option} disabled={readOnly} onChange={() => onChange(option)} />)}</div>}
    {question.type === 'multiple_choice' && <div className="space-y-2">{options.map(option => {
      const selected = Array.isArray(value) ? value : [];
      return <Choice key={option} checkbox label={option} checked={selected.includes(option)} disabled={readOnly} onChange={() => onChange(selected.includes(option) ? selected.filter(x => x !== option) : [...selected, option])} />;
    })}</div>}
    {question.type === 'dropdown' && <select className={inputClass} disabled={readOnly} value={String(value ?? '')} onChange={e => onChange(e.target.value)}><option value="">Select an option</option>{options.map(option => <option key={option}>{option}</option>)}</select>}
    {question.type === 'rating' && <div className="flex flex-wrap items-center gap-2"><span className="text-[11px] text-foreground-400">{question.config.minLabel}</span>{Array.from({ length: question.config.max || 5 }, (_, i) => i + 1).map(number => <button key={number} type="button" disabled={readOnly} onClick={() => onChange(number)} className={`h-9 w-9 rounded-lg border text-xs font-semibold ${value === number ? 'border-primary-500 bg-primary-500 text-white' : 'border-foreground-200 bg-white text-foreground-600'} disabled:cursor-default`}>{number}</button>)}<span className="text-[11px] text-foreground-400">{question.config.maxLabel}</span></div>}
  </div>;
}

function Choice({ label, checked, disabled, onChange, checkbox = false }: { label: string; checked: boolean; disabled: boolean; onChange: () => void; checkbox?: boolean }) {
  return <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground-700"><input type={checkbox ? 'checkbox' : 'radio'} checked={checked} disabled={disabled} onChange={onChange} className="accent-primary-600" />{label}</label>;
}
