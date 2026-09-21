import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { fetchQuiz, type Quiz, type QuizAnswerValue } from '@/api/quizzes';
import { submitFreeCourseQuiz, type FreeCourseQuizResult } from '@/api/freeCourses';
import type { LearnerKind } from '@/api/learnerDetail';
// The question renderer is shared with the normal quiz player — only the submit
// path differs (free courses store nothing in OTJH/KSBs).
import { QuestionInput } from '@/pages/learner/quiz-take/page';

export function FreeCourseQuiz({ kind, learnerId, componentId, quizId, onPassed }: {
  kind: LearnerKind; learnerId: string; componentId: string; quizId: number;
  onPassed: () => void;
}) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loadError, setLoadError] = useState('');
  const [answers, setAnswers] = useState<Record<string, QuizAnswerValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState<FreeCourseQuizResult | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setQuiz(null);
    setLoadError('');
    fetchQuiz(quizId)
      .then((data) => { if (!cancelled) setQuiz(data); })
      .catch((failure) => { if (!cancelled) setLoadError(failure instanceof Error ? failure.message : 'Could not load the quiz.'); });
    return () => { cancelled = true; };
  }, [quizId, retry]);

  const submit = () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError('');
    submitFreeCourseQuiz(kind, learnerId, componentId, answers)
      .then((res) => { setResult(res); if (res.passed) onPassed(); })
      .catch((failure) => setSubmitError(failure instanceof Error ? failure.message : 'Could not submit the quiz.'))
      .finally(() => setSubmitting(false));
  };

  const tryAgain = () => { setResult(null); setAnswers({}); };

  if (loadError) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {loadError} <button onClick={() => setRetry((value) => value + 1)} className="font-semibold underline">Try again</button>
      </div>
    );
  }
  if (!quiz) return <p role="status" className="p-3 text-sm text-foreground-500">Loading quiz…</p>;

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
      {quiz.questions.map((question, index) => (
        <div key={question.id} className="space-y-3">
          <p className="text-sm font-semibold text-foreground-900"><span className="text-foreground-400">{index + 1}. </span>{question.text}</p>
          <QuestionInput
            question={question}
            value={answers[String(question.id)]}
            onChange={(value) => setAnswers((previous) => ({ ...previous, [String(question.id)]: value }))}
          />
        </div>
      ))}
      {!quiz.questions.length && <p className="text-sm text-foreground-500">This quiz has no questions yet.</p>}
      <div className="border-t border-foreground-100 pt-4">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !quiz.questions.length}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
        >
          {submitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
          {submitting ? 'Submitting…' : 'Submit quiz'}
        </button>
        {submitError && <p role="alert" className="mt-2 text-[12px] text-red-700">{submitError}</p>}
      </div>
    </div>
  );
}
