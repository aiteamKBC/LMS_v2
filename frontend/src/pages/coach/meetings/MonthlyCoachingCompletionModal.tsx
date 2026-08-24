import { useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';
import {
  MONTHLY_COACHING_SECTIONS,
  REQUIRED_MONTHLY_COACHING_RESPONSE_IDS,
} from '@/pages/shared/monthlyCoachingForm';
import type { ProgressReviewResponses } from '@/pages/shared/progressReviewForm';
import {
  type CoachCalendarEvent,
  formatDateLabel,
  formatTimeLabel,
} from '../shared/calendarEvents';
import { ModalHeader, ModalShell } from '../shared/ModalHeader';

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
      section.questions.some((question) => (
        question.type !== 'statement'
        && question.required !== false
        && !responses[question.id]?.trim()
      ))
    ));
    if (missingSection) {
      setOpenSection(missingSection.id);
      setValidationError('Please complete every required field before finishing the meeting.');
      return;
    }
    onSubmit(responses);
  };

  return (
    <ModalShell busy={busy} onClose={onClose}>
      <ModalHeader
        eyebrow="Complete monthly coaching meeting"
        icon="ri-chat-check-line"
        title={`${event.learner || 'Learner'} · Monthly Coaching #${event.sequence || 1}`}
        subtitle="Complete the guided MCM record before closing the meeting."
        busy={busy}
        onClose={onClose}
        progressPercent={percent}
        progressLabel={`${answered}/${REQUIRED_MONTHLY_COACHING_RESPONSE_IDS.length} answered`}
      />

      <div className="flex-1 space-y-3 overflow-y-auto bg-background-100 p-4 sm:p-6">
        <div className="rounded-lg border border-primary-100 bg-primary-50 px-4 py-3 text-[13px] leading-5 text-primary-800">
          <AppIcon className="ri-information-line mr-2"></AppIcon>
          These answers will be saved to this MCM and displayed in the learner's Monthly Coaching record.
        </div>

        <div className="grid gap-3 rounded-2xl border border-background-200 bg-background-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Learner', event.learner || 'Unknown learner'],
            ['Programme', event.programme || '--'],
            ['Meeting', `Monthly Coaching #${event.sequence || 1}`],
            ['Scheduled', `${formatDateLabel(event.scheduledDate || event.targetDate)} · ${formatTimeLabel(event)}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-background-100 px-3.5 py-3">
              <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-foreground-400">{label}</p>
              <p className="mt-1 text-[13px] font-bold text-foreground-800">{value}</p>
            </div>
          ))}
        </div>

        {MONTHLY_COACHING_SECTIONS.map((section, sectionIndex) => {
          const open = openSection === section.id;
          const requiredQuestions = section.questions.filter((question) => question.type !== 'statement' && question.required !== false);
          const complete = requiredQuestions.every((question) => responses[question.id]?.trim());
          return (
            <section key={section.id} className={cn('overflow-hidden rounded-2xl border bg-background-50 transition-all', open ? 'border-primary-300 shadow-sm' : 'border-background-200')}>
              <button type="button" onClick={() => setOpenSection(open ? '' : section.id)} className="flex w-full items-center gap-3 p-4 text-left sm:px-5">
                <span className={cn('relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', open ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-700')}>
                  <AppIcon className={section.icon}></AppIcon>
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-primary-900 px-1 text-[12px] font-bold text-white">{sectionIndex + 1}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-bold uppercase tracking-[0.12em] text-foreground-400">MCM section {sectionIndex + 1} of {MONTHLY_COACHING_SECTIONS.length}</span>
                  <span className="mt-0.5 block text-sm font-bold text-foreground-900">{section.title}</span>
                  <span className="mt-1 hidden text-[12px] text-foreground-400 sm:block">{section.description}</span>
                </span>
                {complete ? <AppIcon className="ri-checkbox-circle-fill text-lg text-emerald-500"></AppIcon> : null}
                <span className={cn('flex h-8 w-8 items-center justify-center rounded-full bg-background-100 text-foreground-500 transition-transform', open && 'rotate-180')}>
                  <AppIcon className="ri-arrow-down-s-line"></AppIcon>
                </span>
              </button>

              {open ? (
                <div className="space-y-3 border-t border-primary-100 bg-white p-4 sm:p-5">
                  {section.questions.map((question, questionIndex) => (
                    question.type === 'statement' ? (
                      <div key={question.id} className="rounded-lg border border-background-200 bg-background-100/70 px-4 py-3">
                        <div className="flex items-start gap-3">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[12px] font-bold text-primary-700">{questionIndex + 1}</span>
                          <div>
                            <p className="text-xs font-bold text-foreground-800">{question.label}</p>
                            {question.helpText ? <p className="mt-1 text-[12px] leading-4 text-foreground-400">{question.helpText}</p> : null}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div key={question.id} className="rounded-2xl border border-background-200 bg-background-50 p-4 transition focus-within:border-primary-300 focus-within:shadow-sm">
                        <label className="mb-2 block text-xs font-bold text-foreground-800">
                          <span className="mr-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-100 px-1 text-[12px] text-primary-700">{questionIndex + 1}</span>
                          {question.label}
                          {question.required !== false ? <span className="ml-1 text-red-500">*</span> : null}
                        </label>
                        {question.helpText ? <p className="mb-2 text-[12px] leading-4 text-foreground-400">{question.helpText}</p> : null}

                        {question.type === 'text' ? (
                          <textarea value={responses[question.id] || ''} onChange={(e) => update(question.id, e.target.value)} rows={3} maxLength={4000} placeholder={question.placeholder} className="w-full resize-y rounded-lg border border-background-300 bg-white px-3.5 py-3 text-sm text-foreground-800 outline-none transition placeholder:text-foreground-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-200" />
                        ) : null}
                        {question.type === 'yes-no' ? (
                          <div className="grid max-w-sm grid-cols-2 gap-2">
                            {[
                              ['Yes', 'ri-check-line'],
                              ['No', 'ri-close-line'],
                            ].map(([value, icon]) => (
                              <button key={value} type="button" onClick={() => update(question.id, value)} className={cn('flex h-11 items-center justify-center gap-2 rounded-lg border text-xs font-bold transition', responses[question.id] === value ? (value === 'Yes' ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm' : 'border-foreground-700 bg-foreground-800 text-white shadow-sm') : 'border-background-300 bg-white text-foreground-600 hover:border-primary-300 hover:bg-primary-50')}>
                                <AppIcon className={icon}></AppIcon>{value}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {question.type === 'agreement' ? (
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            {['Agree', 'Neutral', 'Disagree', 'Not discussed'].map((option) => (
                              <button key={option} type="button" onClick={() => update(question.id, option)} className={cn('min-h-10 rounded-lg border px-3 py-2 text-[12px] font-bold transition', responses[question.id] === option ? 'border-primary-600 bg-primary-600 text-white shadow-sm' : 'border-background-300 bg-white text-foreground-600 hover:border-primary-300 hover:bg-primary-50')}>
                                {option}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {question.type === 'select' ? (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {(question.options || []).map((option) => (
                              <button key={option} type="button" onClick={() => update(question.id, option)} className={cn('min-h-10 rounded-lg border px-3 py-2 text-left text-[12px] font-semibold transition', responses[question.id] === option ? 'border-primary-600 bg-primary-600 text-white shadow-sm' : 'border-background-300 bg-white text-foreground-600 hover:border-primary-300 hover:bg-primary-50')}>
                                <AppIcon className={cn('mr-2', responses[question.id] === option ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line')}></AppIcon>{option}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {question.type === 'date' ? (
                          <input type="date" value={responses[question.id] || ''} onChange={(e) => update(question.id, e.target.value)} className="h-11 w-full max-w-sm rounded-lg border border-background-300 bg-white px-3.5 text-sm font-semibold text-foreground-800 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-200" />
                        ) : null}
                        {question.type === 'rag' ? (
                          <div className="grid max-w-lg grid-cols-3 gap-2">
                            {[
                              ['Green', 'bg-emerald-500 text-white', 'bg-emerald-50 text-emerald-700'],
                              ['Amber', 'bg-amber-500 text-white', 'bg-amber-50 text-amber-700'],
                              ['Red', 'bg-red-500 text-white', 'bg-red-50 text-red-700'],
                            ].map(([value, activeClass, idleClass]) => (
                              <button key={value} type="button" onClick={() => update(question.id, value)} className={cn('rounded-lg px-4 py-2.5 text-xs font-bold transition', responses[question.id] === value ? activeClass : idleClass)}>
                                <AppIcon className="ri-circle-fill mr-1.5 text-[12px]"></AppIcon>{value}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}

        {(validationError || error) ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            <AppIcon className="ri-error-warning-line mr-2"></AppIcon>{validationError || error}
          </div>
        ) : null}
      </div>

      <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-lg px-4 text-xs font-semibold text-foreground-500 transition hover:bg-background-100 disabled:opacity-50">Cancel</button>
        <button type="button" onClick={submit} disabled={busy} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60">
          <AppIcon className={busy ? 'ri-loader-4-line animate-spin' : 'ri-check-double-line'}></AppIcon>
          {busy ? 'Saving meeting...' : 'Save & Complete MCM'}
        </button>
      </footer>
    </ModalShell>
  );
}
