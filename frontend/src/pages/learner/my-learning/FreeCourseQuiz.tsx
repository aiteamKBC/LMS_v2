import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { type QuizAnswerValue } from '@/api/quizzes';
import { fetchFreeCourseQuiz, submitFreeCourseQuiz, type FreeCourseQuizData, type FreeCourseQuizResult } from '@/api/freeCourses';
import type { LearnerKind } from '@/api/learnerDetail';
// The question renderer is shared with the normal quiz player — only the submit
// path differs (free courses store nothing in OTJH/KSBs).
import { QuestionInput } from '@/pages/learner/quiz-take/page';
import { QuizQuestionImage } from '@/components/feature/QuizQuestionImage';

export function FreeCourseQuiz({ kind, learnerId, componentId, quizId, onPassed, readOnly = false, completed = false }: {
  kind: LearnerKind; learnerId: string; componentId: string; quizId: number;
  onPassed: () => void;
  readOnly?: boolean;
  completed?: boolean;
}) {
  const [quiz, setQuiz] = useState<FreeCourseQuizData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [answers, setAnswers] = useState<Record<string, QuizAnswerValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState<FreeCourseQuizResult | null>(null);
  const [retry, setRetry] = useState(0);
  const submissionId = useRef(crypto.randomUUID());
  const generation = useRef(0);

  useEffect(() => {
    let cancelled = false;
    generation.current += 1;
    setSubmitting(false);
    setQuiz(null);
    setAnswers({}); setResult(null); setSubmitError('');
    submissionId.current = crypto.randomUUID();
    setLoadError('');
    fetchFreeCourseQuiz(kind, learnerId, componentId)
      .then((data) => { if (!cancelled) setQuiz(data); })
      .catch((failure) => { if (!cancelled) setLoadError(failure instanceof Error ? failure.message : 'Could not load the quiz.'); });
    return () => { cancelled = true; generation.current += 1; };
  }, [kind, learnerId, componentId, quizId, retry]);

  const submit = () => {
    if (submitting || readOnly || quiz?.historyOnly) return;
    setSubmitting(true);
    setSubmitError('');
    const currentGeneration = generation.current;
    submitFreeCourseQuiz(kind, learnerId, componentId, answers, submissionId.current)
      .then((res) => { if (generation.current !== currentGeneration) return; setResult(res); if (res.passed) onPassed(); })
      .catch((failure) => { if (generation.current === currentGeneration) setSubmitError(failure instanceof Error ? failure.message : 'Could not submit the quiz.'); })
      .finally(() => { if (generation.current === currentGeneration) setSubmitting(false); });
  };

  const tryAgain = () => { submissionId.current = crypto.randomUUID(); setResult(null); setAnswers({}); };

  if (loadError) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {loadError} <button onClick={() => setRetry((value) => value + 1)} className="font-semibold underline">Try again</button>
      </div>
    );
  }
  if (!quiz) return <p  className="p-3 text-sm text-foreground-500"><LoadingSkeleton label="Loading quiz…" variant="rows" /></p>;
  if (quiz.unavailableReason) return <p role="alert" className="p-3 text-sm text-red-700">{quiz.unavailableReason}</p>;

  if (result) {
    const correct = result.breakdown.filter((item) => item.correct).length;
    return (
      <div className="space-y-4">
        <div className={`flex items-start gap-3 rounded-xl border p-4 ${result.passed ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          {result.passed ? <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={20} /> : <XCircle className="mt-0.5 shrink-0 text-amber-600" size={20} />}
          <div>
            <p className={`text-sm font-bold ${result.passed ? 'text-emerald-800' : 'text-amber-800'}`}>
              {result.passed ? 'Passed' : 'Not passed yet'} — {result.grade}%
            </p>
            <p className="mt-0.5 text-[12px] text-foreground-600">
              {correct} of {result.breakdown.length} correct · pass mark {result.passingGrade}%
            </p>
          </div>
        </div>
        {result.passed
          ? <p className="text-sm text-emerald-700">This quiz is now complete.</p>
          : <button type="button" onClick={tryAgain} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700">Try again</button>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!!quiz.attempts?.length && <section aria-label="Previous quiz attempts" className="rounded-lg border border-foreground-200 p-3">
        <h3 className="text-sm font-semibold">Previous attempts</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {quiz.attempts.map(attempt => <li key={attempt.attemptId}>
            {attempt.grade == null ? 'Score unavailable' : `${attempt.grade}%`} ? {attempt.passed === true ? 'Passed' : attempt.passed === false ? 'Not passed' : 'Result unavailable'}
            {attempt.submittedAt && <time dateTime={attempt.submittedAt}> ? {new Date(attempt.submittedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}</time>}
          </li>)}
        </ul>
      </section>}
      {quiz.questions.map((question, index) => (
        <div key={question.id} className="space-y-3">
          <p className="text-sm font-semibold text-foreground-900"><span className="text-foreground-400">{index + 1}. </span>{question.text}</p>
          <QuizQuestionImage imageUrl={question.imageUrl} />
          <QuestionInput
            question={question}
            value={answers[String(question.id)]}
            onChange={(value) => setAnswers((previous) => ({ ...previous, [String(question.id)]: value }))}
          />
        </div>
      ))}
      {quiz.historyOnly && <p role="status" className="text-sm text-foreground-500">Historical results are read-only. This learner is withdrawn.</p>}
      {!quiz.questions.length && !quiz.historyOnly && <p className="text-sm text-foreground-500">This quiz has no questions yet.</p>}
      <div className="border-t border-foreground-100 pt-4">
        {readOnly || quiz.historyOnly ? (
          <p className="text-sm text-foreground-500">{completed ? 'This quiz is complete. Saved attempts are shown above when available.' : 'Quiz submission is disabled in staff preview.'}</p>
        ) : (
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !quiz.questions.length}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
        >
          {submitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
          {submitting ? 'Submitting…' : 'Submit quiz'}
        </button>
        )}
        {submitError && <p role="alert" className="mt-2 text-[12px] text-red-700">{submitError}</p>}
      </div>
    </div>
  );
}
