import { useMemo, useState } from 'react';
import { lecturePublicFeedbackApi, type PublicLectureFeedback } from '@/api/lecturePublicFeedback';
import type { FeedbackAnswerValue } from '@/api/feedback';
import { FeedbackFormExperience, FormRenderer } from '@/features/feedback/FormRenderer';
import { lecturePresentationSections } from '@/features/feedback/lecturePresentation';
import { missingRequiredQuestionIds } from '@/features/feedback/formPresentation';

export default function PublicLectureFeedbackPage() {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [matchedEmail, setMatchedEmail] = useState('');
  const [data, setData] = useState<PublicLectureFeedback | null>(null);
  const [answers, setAnswers] = useState<Record<string, FeedbackAnswerValue>>({});
  const [step, setStep] = useState(0);
  const [invalidIds, setInvalidIds] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const form = data?.form;
  const sections = useMemo(() => form ? lecturePresentationSections('post_lecture', form.sections) : [], [form]);
  const completed = form?.response.status === 'completed' && !form.allowEditAfterSubmission;

  async function open(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const chosen = await lecturePublicFeedbackApi.discover(email.trim());
      const result = await lecturePublicFeedbackApi.read(chosen.token, email.trim());
      setToken(chosen.token);
      setData(result);
      setMatchedEmail(email.trim());
      setAnswers(result.form.response.answers);
      setStep(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open lecture feedback.');
    } finally { setBusy(false); }
  }

  function updateAnswer(questionId: number, value: FeedbackAnswerValue) {
    setInvalidIds(current => { const next = new Set(current); next.delete(questionId); return next; });
    setAnswers(current => ({ ...current, [String(questionId)]: value }));
  }

  async function save(submit: boolean) {
    if (!form) return;
    if (submit) {
      const invalid = sections.map(section => missingRequiredQuestionIds(section, answers));
      const first = invalid.findIndex(ids => ids.size > 0);
      if (first >= 0) { setStep(first); setInvalidIds(invalid[first]); return; }
    }
    setBusy(true); setError('');
    try {
      const result = await lecturePublicFeedbackApi.save(token, matchedEmail, answers, submit);
      setData(current => current ? {
        ...current, form: { ...current.form, response: {
          ...current.form.response, status: result.response.status,
          submittedAt: result.response.submittedAt, answers,
        } },
      } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save feedback.');
    } finally { setBusy(false); }
  }

  return <main
    className={`relative min-h-screen px-4 py-8 ${data ? 'bg-background-100' : 'isolate flex items-center justify-center overflow-hidden bg-[#f4efe9]'}`}
  >{!data && <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-cover bg-center blur-[1px] scale-[1.02]"
    style={{ backgroundImage: "linear-gradient(#f7f3ed59, #f7f3ed59), url('/assets/student-home/canterbury-background.png')" }} />}
  <section className={`relative z-10 mx-auto w-full border border-foreground-200/60 bg-white ${data ? 'max-w-4xl rounded-2xl p-5 shadow-sm sm:p-8' : 'max-w-[420px] rounded-xl p-6 shadow-[0_22px_65px_rgba(36,9,72,0.28)] sm:p-8'}`}>
    {!data ? <>
      <header className="flex items-start justify-between gap-3">
        <h1 className="max-w-[220px] pt-1 text-xl font-bold leading-tight text-foreground-900">Live Sessions Feedback</h1>
        <img src="/kbc-logo.png" alt="Kent Business College" className="h-22 w-36 shrink-0 object-contain object-right" />
      </header>
      <p className="mt-4 text-sm leading-relaxed text-foreground-600">Enter your Aptem or LMS email to open your latest available Live Sessions Feedback.</p>
      <form onSubmit={event => void open(event)} className="mt-6 space-y-4">
        <div className="space-y-2">
          <label htmlFor="lecture-feedback-email" className="block text-sm font-semibold text-foreground-800">Aptem or LMS email</label>
          <input id="lecture-feedback-email" type="email" required autoComplete="email" maxLength={320} value={email}
            onChange={event => setEmail(event.target.value)} className="w-full rounded-lg border border-foreground-300 bg-white px-3 py-2.5 text-sm text-foreground-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200" />
        </div>
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-40">{busy ? 'Checking…' : 'Open feedback'}</button>
      </form>
    </> : <>
      <div className="mb-5 rounded-xl bg-primary-50 p-4">
        <p className="text-xs font-semibold uppercase text-primary-700">Live Sessions Feedback</p>
        <h1 className="mt-1 text-xl font-bold text-foreground-900">{data.lecture.title}</h1>
        <p className="mt-1 text-sm text-foreground-600">{data.lecture.moduleName}{data.lecture.startsAt ? ` · ${new Date(data.lecture.startsAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })}` : ''}</p>
        <p className="mt-2 text-sm text-foreground-700">Welcome, {data.learner.name}.</p>
        <button type="button" onClick={() => { setData(null); setToken(''); setEmail(''); setMatchedEmail(''); setAnswers({}); setError(''); }} className="mt-2 text-xs font-semibold text-primary-700 underline">Use a different email</button>
      </div>
      {completed ? <>
        <p className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Your feedback has been submitted. Your answers are shown below.</p>
        <FormRenderer sections={sections} answers={answers} readOnly loadPhoto={uploadId => lecturePublicFeedbackApi.loadPhoto(token, matchedEmail, uploadId)} />
      </> : <>
        <FeedbackFormExperience title={form!.title} description={form!.description} instructions={form!.instructions}
          sections={sections} activeSection={step} answers={answers} invalidQuestionIds={invalidIds}
          onChange={updateAnswer}
          onPhotoUpload={(questionId, file) => lecturePublicFeedbackApi.uploadPhoto(token, matchedEmail, questionId, file)}
          onPhotoRemove={uploadId => lecturePublicFeedbackApi.removePhoto(token, matchedEmail, uploadId)}
          loadPhoto={uploadId => lecturePublicFeedbackApi.loadPhoto(token, matchedEmail, uploadId)}
          onStepChange={index => { if (index <= step) { setStep(index); setInvalidIds(new Set()); } }}
          onBack={() => { setStep(value => Math.max(value - 1, 0)); setInvalidIds(new Set()); }}
          onNext={() => { const missing = missingRequiredQuestionIds(sections[step], answers); setInvalidIds(missing); if (!missing.size) setStep(value => Math.min(value + 1, sections.length - 1)); }}
          onSubmit={() => void save(true)} submitting={busy} />
        {form!.allowSaveContinue && <button type="button" disabled={busy} onClick={() => void save(false)} className="mt-4 rounded-lg border border-primary-300 px-4 py-2 text-sm font-semibold text-primary-700 disabled:opacity-40">Save progress</button>}
      </>}
    </>}
    {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {data && <footer className="mt-8 border-t border-foreground-200 pt-4 text-center text-xs text-foreground-400">Kent Business College · Lecture feedback</footer>}
  </section></main>;
}
