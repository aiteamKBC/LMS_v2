import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, ClipboardList } from 'lucide-react';
import { ApplicationSubmitError, submitApprenticeshipApplication, type ApplicationField } from '@/api/apprenticeshipApplication';
import {
  SECTIONS,
  businessToday,
  emptyAnswers,
  isQuestion,
  isShown,
  toPayload,
  validateSection,
  type Answers,
  type Errors,
  type Question,
} from './form';
// The LMS public-page frame (logo bar, banner, footer), shared with the coach
// booking and LMS introduction pages; application.module.css styles the form
// and the dark-theme version of that frame.
import frame from '../coach-booking/booking.module.css';
import styles from './application.module.css';

/**
 * The public apprenticeship eligibility form at /apprenticeship_application.
 *
 * No sign-in: the applicant has no account. Four sections, each checked before
 * moving on; nothing reaches the server until "Submit application", which saves
 * one row to enrolment.eligibility_form. The form collects answers only -- staff
 * assess eligibility, so no funding rule is applied here.
 */
export default function ApprenticeshipApplicationPage() {
  const [answers, setAnswers] = useState<Answers>(emptyAnswers);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [focusErrors, setFocusErrors] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const today = businessToday();

  // Nothing is saved before Submit, so leaving part-way would lose the answers.
  useEffect(() => {
    if (!dirty || submitted) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, submitted]);

  // A new section starts at its heading, so keyboard and screen-reader users begin at the top.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    formRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  useEffect(() => {
    if (!focusErrors) return;
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    const target = invalid?.matches('input, select') ? invalid : invalid?.querySelector<HTMLElement>('input');
    target?.focus();
  }, [focusErrors]);

  useEffect(() => {
    if (submitted) successRef.current?.focus();
  }, [submitted]);

  const section = SECTIONS[step];
  const last = step === SECTIONS.length - 1;
  const percent = Math.round(((step + 1) / SECTIONS.length) * 100);
  const SectionIcon = section.icon;

  const setAnswer = (key: ApplicationField, value: string | boolean) => {
    setAnswers(current => ({ ...current, [key]: value }));
    setDirty(true);
    setErrors(current => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const goTo = (index: number) => {
    moved.current = true;
    setSubmitError('');
    setStep(index);
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError('');
    try {
      await submitApprenticeshipApplication(toPayload(answers));
      setSubmitted(true);
    } catch (reason) {
      const failure = reason instanceof ApplicationSubmitError
        ? reason
        : new ApplicationSubmitError('We could not submit your application. Please try again.', 0);
      // The server refused specific answers: show them where they were asked.
      const refused = SECTIONS.findIndex(candidate => candidate.items.some(item => isQuestion(item) && failure.fields[item.key]));
      if (refused >= 0) {
        setErrors(failure.fields);
        if (refused !== step) goTo(refused);
        else setFocusErrors(count => count + 1);
      }
      setSubmitError(failure.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleContinue = (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const found = validateSection(section, answers, today);
    setErrors(found);
    if (Object.keys(found).length) {
      setFocusErrors(count => count + 1);
      return;
    }
    if (last) void submit();
    else goTo(step + 1);
  };

  let number = 0;

  return (
    <main className={`${frame.page} ${styles.page}`}>
      <div className={frame.container}>
        <div className={`${frame.brandBar} ${styles.brandBar}`}>
          <img src="/assets/kbc-logo.png" alt="Kent Business College" width="175" height="80" />
          <span><ClipboardList size={17} aria-hidden="true" />Apprenticeship application</span>
        </div>
        <header className={frame.hero}>
          <div className={frame.heroCopy}>
            <p className={frame.eyebrow}>APPRENTICESHIP FUNDING ELIGIBILITY</p>
            <h1>Eligibility Form</h1>
            <p>Assess learner eligibility against the England apprenticeship funding rules. All fields marked with * are required.</p>
            <span className={frame.accessNote}><CheckCircle2 size={16} aria-hidden="true" />No LMS account needed to apply</span>
          </div>
          <div className={frame.heroIcon} aria-hidden="true"><ClipboardCheck strokeWidth={1.3} /></div>
        </header>

        {submitted ? (
          <section className={styles.card} aria-labelledby="application-submitted">
            <div className={styles.success}>
              <span className={styles.successIcon} aria-hidden="true"><CheckCircle2 /></span>
              <h2 id="application-submitted" ref={successRef} tabIndex={-1}>Application submitted</h2>
              <p>
                Thank you, {answers.firstName.trim()}. We have received your application for{' '}
                <strong>{answers.programme}</strong>.
              </p>
              <p>You can now close this page.</p>
            </div>
          </section>
        ) : (
          <form ref={formRef} className={styles.card} onSubmit={handleContinue} noValidate aria-labelledby="application-section-title">
            <div className={styles.progressRow}>
              <span className={styles.sectionCount}>Section {step + 1} of {SECTIONS.length}</span>
              <div
                className={styles.track}
                role="progressbar"
                aria-label="Application progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <span style={{ width: `${percent}%` }} />
              </div>
              <span className={styles.percent}>{percent}% complete</span>
            </div>

            <div className={styles.sectionHead}>
              <span className={styles.sectionIcon} aria-hidden="true"><SectionIcon /></span>
              <div>
                <h2 id="application-section-title" ref={headingRef} tabIndex={-1}>{section.title}</h2>
                <p>{section.description}</p>
              </div>
            </div>

            <div className={styles.questions}>
              {section.items.map(item => {
                if (!isQuestion(item)) return <p key={item.text} className={styles.note}>{item.text}</p>;
                if (!isShown(item, answers)) return null;
                number += 1;
                return (
                  <QuestionRow
                    key={item.key}
                    question={item}
                    number={number}
                    value={answers[item.key]}
                    error={errors[item.key]}
                    today={today}
                    onChange={value => setAnswer(item.key, value)}
                  />
                );
              })}
            </div>

            {submitError && <p className={styles.alert} role="alert">{submitError}</p>}

            <div className={styles.actions}>
              {step > 0 && (
                <button type="button" className={styles.secondary} onClick={() => goTo(step - 1)} disabled={submitting}>
                  <ArrowLeft aria-hidden="true" /> Previous
                </button>
              )}
              <button type="submit" className={styles.primary} disabled={submitting}>
                {last ? (submitting ? 'Submitting…' : 'Submit application') : 'Continue'}
                <ArrowRight aria-hidden="true" />
              </button>
            </div>
          </form>
        )}
        <footer className={`${frame.footer} ${styles.footer}`}>
          <span>Kent Business College</span>
          <span>Learning support, one conversation at a time.</span>
        </footer>
      </div>
    </main>
  );
}

interface QuestionRowProps {
  question: Question;
  number: number;
  value: Answers[ApplicationField];
  error?: string;
  today: string;
  onChange: (value: string | boolean) => void;
}

function QuestionRow({ question, number, value, error, today, onChange }: QuestionRowProps) {
  const id = `application-${question.key}`;
  const labelId = `${id}-label`;
  const hintId = question.hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const invalid = Boolean(error);

  const prompt = (
    <>
      <span className={styles.number}>{number}.</span>{' '}
      {question.label}
      {question.required && <span className={styles.required} aria-hidden="true"> *</span>}
    </>
  );
  const hint = question.hint && <span id={hintId} className={styles.hint}>{question.hint}</span>;
  const message = error && <p id={errorId} className={styles.error}>{error}</p>;

  if (question.kind === 'choice' || question.kind === 'yesno') {
    const options = question.kind === 'yesno'
      ? [{ label: 'Yes', value: true }, { label: 'No', value: false }]
      : question.options.map(option => ({ label: option, value: option }));
    return (
      <div className={styles.row}>
        <div className={styles.prompt}>
          <span id={labelId} className={styles.label}>{prompt}</span>
          {hint}
        </div>
        <div className={styles.control}>
          <div
            role="radiogroup"
            aria-labelledby={labelId}
            aria-describedby={describedBy}
            aria-required={question.required}
            aria-invalid={invalid}
            className={`${styles.options} ${invalid ? styles.optionsInvalid : ''}`}
          >
            {options.map(option => {
              const selected = value === option.value;
              return (
                <label key={option.label} className={`${styles.option} ${selected ? styles.optionSelected : ''}`}>
                  <input type="radio" name={question.key} checked={selected} onChange={() => onChange(option.value)} />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
          {message}
        </div>
      </div>
    );
  }

  const shared = {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': invalid,
    'aria-required': question.required,
  };

  return (
    <div className={styles.row}>
      <div className={styles.prompt}>
        <label htmlFor={id} className={styles.label}>{prompt}</label>
        {hint}
      </div>
      <div className={styles.control}>
        {question.kind === 'select' ? (
          <select
            {...shared}
            className={`${styles.input} ${styles.select} ${invalid ? styles.invalid : ''}`}
            value={String(value ?? '')}
            onChange={event => onChange(event.target.value)}
          >
            <option value="">Please select</option>
            {question.options.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        ) : (
          <input
            {...shared}
            className={`${styles.input} ${invalid ? styles.invalid : ''}`}
            type={question.kind}
            value={String(value ?? '')}
            onChange={event => onChange(event.target.value)}
            maxLength={question.kind === 'date' ? undefined : question.maxLength}
            max={question.kind === 'date' ? today : undefined}
            min={question.kind === 'date' ? '1900-01-01' : undefined}
            autoComplete={question.autoComplete}
          />
        )}
        {message}
      </div>
    </div>
  );
}
