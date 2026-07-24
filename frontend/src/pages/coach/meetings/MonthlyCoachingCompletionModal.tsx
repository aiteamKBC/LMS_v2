import { useState } from 'react';
import type { CoachCalendarEvent } from '../shared/calendarEvents';
import {
  MONTHLY_COACHING_SECTIONS,
  REQUIRED_MONTHLY_COACHING_RESPONSE_IDS,
} from '@/pages/shared/monthlyCoachingForm';
import type { ProgressReviewResponses } from '@/pages/shared/progressReviewForm';

export function MonthlyCoachingCompletionModal({
  event,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  event: CoachCalendarEvent;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (responses: ProgressReviewResponses) => void;
}) {
  const [responses, setResponses] = useState<ProgressReviewResponses>(() => ({ ...(event.reviewResponses || {}) }));
  const [openSection, setOpenSection] = useState(MONTHLY_COACHING_SECTIONS[0].id);
  const [validationError, setValidationError] = useState('');
  const answered = REQUIRED_MONTHLY_COACHING_RESPONSE_IDS.filter((id) => responses[id]?.trim()).length;
  const percent = Math.round((answered / REQUIRED_MONTHLY_COACHING_RESPONSE_IDS.length) * 100);

  const update = (id: string, value: string) => {
    setResponses((current) => ({ ...current, [id]: value }));
    setValidationError('');
  };

  const submit = () => {
    const missingSection = MONTHLY_COACHING_SECTIONS.find((section) => (
      section.questions.some((question) => !responses[question.id]?.trim())
    ));
    if (missingSection) {
      setOpenSection(missingSection.id);
      setValidationError('Please answer every question before completing the meeting.');
      return;
    }
    onSubmit(responses);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-primary-950/65 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/20 bg-background-50 shadow-2xl">
        <header className="shrink-0 border-b border-white/10 bg-gradient-to-r from-[#10021f] via-primary-950 to-[#35105e] px-5 py-5 text-white sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-lg text-secondary-200"><i className="ri-chat-check-line"></i></span>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-secondary-200">Complete monthly coaching meeting</p>
                <h2 className="mt-1 text-lg font-bold text-white">{event.learner || 'Learner'} · Monthly Coaching #{event.sequence || 1}</h2>
                <p className="mt-1 text-xs text-white/60">Complete the full MCM record before closing the meeting.</p>
              </div>
            </div>
            <button type="button" onClick={onClose} disabled={busy} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-50" aria-label="Close form"><i className="ri-close-line text-lg"></i></button>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-secondary-300 transition-all" style={{ width: `${percent}%` }} /></div>
            <span className="text-[10px] font-bold text-white/70">{answered}/{REQUIRED_MONTHLY_COACHING_RESPONSE_IDS.length} answered</span>
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto bg-[#f7f6fb] p-4 sm:p-6">
          <div className="rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-xs leading-5 text-primary-800">
            <i className="ri-information-line mr-2"></i>These answers will be saved to this MCM and displayed in the learner’s Monthly Coaching record.
          </div>
          {MONTHLY_COACHING_SECTIONS.map((section, index) => {
            const open = openSection === section.id;
            const complete = section.questions.every((question) => responses[question.id]?.trim());
            return (
              <section key={section.id} className={`overflow-hidden rounded-2xl border bg-background-50 transition-all ${open ? 'border-primary-300 shadow-sm' : 'border-background-200'}`}>
                <button type="button" onClick={() => setOpenSection(open ? '' : section.id)} className="flex w-full items-center gap-3 p-4 text-left sm:px-5">
                  <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${open ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-700'}`}>
                    <i className={section.icon}></i>
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-primary-900 px-1 text-[8px] font-bold text-white">{index + 1}</span>
                  </span>
                  <span className="min-w-0 flex-1"><span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-foreground-400">MCM section {index + 1} of {MONTHLY_COACHING_SECTIONS.length}</span><span className="mt-0.5 block text-sm font-bold text-foreground-900">{section.title}</span></span>
                  {complete && <i className="ri-checkbox-circle-fill text-lg text-emerald-500"></i>}
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full bg-background-100 text-foreground-500 transition-transform ${open ? 'rotate-180' : ''}`}><i className="ri-arrow-down-s-line"></i></span>
                </button>
                {open && (
                  <div className="space-y-5 border-t border-primary-100 bg-white p-4 sm:p-5">
                    {section.questions.map((question, questionIndex) => (
                      <div key={question.id}>
                        <label className="mb-2 block text-xs font-bold text-foreground-800"><span className="mr-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-100 px-1 text-[9px] text-primary-700">{questionIndex + 1}</span>{question.label}<span className="ml-1 text-red-500">*</span></label>
                        {question.type === 'text' && <textarea value={responses[question.id] || ''} onChange={(e) => update(question.id, e.target.value)} rows={3} maxLength={4000} placeholder={question.placeholder} className="w-full resize-y rounded-xl border border-background-300 bg-background-50 px-3.5 py-3 text-sm text-foreground-800 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-200" />}
                        {question.type === 'rating' && <div className="flex flex-wrap gap-2">{['1', '2', '3', '4', '5'].map((rating) => <button key={rating} type="button" onClick={() => update(question.id, rating)} className={`flex h-10 min-w-10 items-center justify-center rounded-xl border px-3 text-xs font-bold transition ${responses[question.id] === rating ? 'border-primary-600 bg-primary-600 text-white' : 'border-background-300 bg-background-50 text-foreground-600 hover:border-primary-300'}`}>{rating}</button>)}<span className="self-center text-[10px] text-foreground-400">1 = poor · 5 = excellent</span></div>}
                        {question.type === 'rag' && <div className="grid max-w-lg grid-cols-3 gap-2">{[['Green', 'bg-emerald-500 text-white', 'bg-emerald-50 text-emerald-700'], ['Amber', 'bg-amber-500 text-white', 'bg-amber-50 text-amber-700'], ['Red', 'bg-red-500 text-white', 'bg-red-50 text-red-700']].map(([value, activeClass, idleClass]) => <button key={value} type="button" onClick={() => update(question.id, value)} className={`rounded-xl px-4 py-2.5 text-xs font-bold transition ${responses[question.id] === value ? activeClass : idleClass}`}><i className="ri-circle-fill mr-1.5 text-[8px]"></i>{value}</button>)}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          {(validationError || error) && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700"><i className="ri-error-warning-line mr-2"></i>{validationError || error}</div>}
        </div>

        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-xl px-4 text-xs font-semibold text-foreground-500 transition hover:bg-background-100 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60"><i className={busy ? 'ri-loader-4-line animate-spin' : 'ri-check-double-line'}></i>{busy ? 'Saving meeting...' : 'Save & Complete MCM'}</button>
        </footer>
      </div>
    </div>
  );
}
