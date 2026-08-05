import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import {
  fetchQuiz, submitQuizAttempt,
  type Quiz, type QuizQuestion, type QuizAnswerValue, type QuizAttemptResult,
} from '@/api/quizzes';
import { fetchLearnerDetail, type LearnerKsbItem, type LearnerKind } from '@/api/learnerDetail';
import { ReflectionWindow, formatClock } from '@/components/feature/ReflectionWindow';
import { rememberLearner } from '@/hooks/useMyLearner';

const learnerNav = roleNavMap.learner;

type Phase = 'intro' | 'quiz' | 'reflect' | 'results';

export default function QuizTakePage() {
  const { kind, id, quizId } = useParams<{ kind: string; id: string; quizId: string }>();
  // Keep sidebar self-view pointing at this learner after the quiz.
  useEffect(() => { rememberLearner(kind, id); }, [kind, id]);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const moduleTitle = searchParams.get('module');
  const weekTitle = searchParams.get('week');

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [learnerKsbs, setLearnerKsbs] = useState<LearnerKsbItem[]>([]);
  const [learnerName, setLearnerName] = useState('Learner');
  const [programmeName, setProgrammeName] = useState('Programme not set');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('intro');
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QuizAnswerValue>>({});
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<QuizAttemptResult | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!quizId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchQuiz(Number(quizId))
      .then((data) => { if (!cancelled) setQuiz(data); })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load quiz'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [quizId]);

  // Load the learner's KSBs (from their Active_users row) for the reflection window.
  useEffect(() => {
    if (kind !== 'commercial' && kind !== 'apprenticeship') return;
    if (!id) return;
    let cancelled = false;
    fetchLearnerDetail(kind as LearnerKind, id)
      .then((d) => {
        if (!cancelled) {
          setLearnerKsbs(d.ksbs || []);
          setLearnerName(d.name || 'Learner');
          setProgrammeName(d.programme || 'Programme not set');
        }
      })
      .catch(() => { /* KSBs are optional — window still works without them */ });
    return () => { cancelled = true; };
  }, [kind, id]);

  useEffect(() => {
    if (phase !== 'quiz') return;
    timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase]);

  const totalPoints = useMemo(() => (quiz ? quiz.questions.reduce((n, q) => n + q.points, 0) : 0), [quiz]);

  const startQuiz = () => {
    setStartedAt(new Date().toISOString());
    setElapsedSeconds(0);
    setCurrent(0);
    setAnswers({});
    setPhase('quiz');
  };

  const setAnswer = (questionId: number, value: QuizAnswerValue) => {
    setAnswers((prev) => ({ ...prev, [String(questionId)]: value }));
  };

  const goNext = () => setCurrent((c) => Math.min(c + 1, (quiz?.questions.length || 1) - 1));
  const goPrev = () => setCurrent((c) => Math.max(c - 1, 0));

  // Finishing the quiz stops the timer and opens the reflection window;
  // the attempt is only persisted once the learner completes that window.
  const handleFinishQuiz = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase('reflect');
  };

  const finalizeSubmit = async (reflection: { ksbs: string[]; feedback: string; reportedTime: string }) => {
    if (!quiz || !kind || !id || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await submitQuizAttempt(quiz.id, kind as 'commercial' | 'apprenticeship', id, {
        answers,
        timeTakenSeconds: elapsedSeconds,
        startedAt: startedAt || new Date().toISOString(),
        module: moduleTitle,
        week: weekTitle,
        ksbs: reflection.ksbs,
        feedback: reflection.feedback,
        reportedTime: reflection.reportedTime,
      });
      setResult(res);
      setPhase('results');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not submit quiz');
    } finally {
      setSubmitting(false);
    }
  };

  const backHref = kind && id ? `/learner/training-plan/${kind}/${id}` : '/learner/training-plan';

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={quiz?.title || 'Quiz'}
      pageSubtitle={[moduleTitle, weekTitle].filter(Boolean).join(' · ')}
      userName="Learner"
      userRole="Learner"
    >
      <div className="p-3 md:p-6 max-w-5xl mx-auto">
        {loading ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="Loading quiz…" /></div>
        ) : loadError || !quiz ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text={loadError || 'Quiz not found.'} /></div>
        ) : phase === 'intro' ? (
          <IntroScreen quiz={quiz} totalPoints={totalPoints} onStart={startQuiz} onBack={() => navigate(backHref)} />
        ) : phase === 'quiz' ? (
          <QuizScreen
            quiz={quiz}
            current={current}
            answers={answers}
            elapsedSeconds={elapsedSeconds}
            submitting={submitting}
            submitError={submitError}
            onAnswer={setAnswer}
            onNext={goNext}
            onPrev={goPrev}
            onJump={setCurrent}
            onSubmit={handleFinishQuiz}
          />
        ) : phase === 'reflect' ? (
          <ReflectionWindow
            noun="quiz"
            plannedTimeLabel={quiz.duration ? `${quiz.duration} ${quiz.timeUnit || 'min'}` : ''}
            learnerKsbs={learnerKsbs}
            elapsedSeconds={elapsedSeconds}
              submitting={submitting}
              submitError={submitError}
              onSubmit={finalizeSubmit}
              activityTitle={quiz.title}
              weekLabel={weekTitle || ''}
              moduleLabel={moduleTitle || ''}
              learnerName={learnerName}
              programmeName={programmeName}
              learnerKind={kind as LearnerKind}
              learnerId={id}
              evidenceSectionRef={`quiz-${quiz.id}`}
              onClose={() => navigate(backHref)}
            />
        ) : (
          result && <ResultsScreen quiz={quiz} result={result} onBack={() => navigate(backHref)} />
        )}
      </div>
    </WorkspaceShell>
  );
}

/* ═══════════════════════════════════════════════════════
   INTRO
   ═══════════════════════════════════════════════════════ */
function IntroScreen({ quiz, totalPoints, onStart, onBack }: {
  quiz: Quiz; totalPoints: number; onStart: () => void; onBack: () => void;
}) {
  return (
    <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6 md:p-8 card-premium">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
          <AppIcon className="ri-questionnaire-line text-amber-600 text-xl" />
        </div>
        <div>
          <h1 className="text-lg font-heading font-bold text-foreground-900">{quiz.title}</h1>
          <p className="text-sm text-foreground-400">{quiz.questions.length} questions · {totalPoints} points</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatTile icon="ri-time-line" label="Time limit" value={quiz.duration ? `${quiz.duration} ${quiz.timeUnit || 'min'}` : 'No limit'} />
        <StatTile icon="ri-checkbox-circle-line" label="Passing grade" value={quiz.passingGrade != null ? `${quiz.passingGrade}%` : '—'} />
        <StatTile icon="ri-question-line" label="Questions" value={String(quiz.questions.length)} />
        <StatTile icon="ri-medal-line" label="Total points" value={String(totalPoints)} />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={onBack} className="px-4 py-2.5 rounded-xl text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer">
          Back
        </button>
        <button
          onClick={onStart}
          disabled={quiz.questions.length === 0}
          className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          <AppIcon className="ri-play-fill" /> Start Quiz
        </button>
      </div>
      {quiz.questions.length === 0 && (
        <p className="text-xs text-foreground-400 mt-3">This quiz has no questions yet.</p>
      )}
    </div>
  );
}

function StatTile({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-foreground-100 p-3">
      <AppIcon className={`${icon} text-primary-500 text-base`} />
      <p className="text-sm font-semibold text-foreground-900 mt-1">{value}</p>
      <p className="text-[11px] text-foreground-400">{label}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   QUIZ — timer + navigator + active question
   ═══════════════════════════════════════════════════════ */
function QuizScreen({
  quiz, current, answers, elapsedSeconds, submitting, submitError, onAnswer, onNext, onPrev, onJump, onSubmit,
}: {
  quiz: Quiz;
  current: number;
  answers: Record<string, QuizAnswerValue>;
  elapsedSeconds: number;
  submitting: boolean;
  submitError: string | null;
  onAnswer: (questionId: number, value: QuizAnswerValue) => void;
  onNext: () => void;
  onPrev: () => void;
  onJump: (i: number) => void;
  onSubmit: () => void;
}) {
  const question = quiz.questions[current];
  const isLast = current === quiz.questions.length - 1;
  const answeredCount = quiz.questions.filter((q) => isAnswered(answers[String(q.id)])).length;

  const timeLimitSeconds = quiz.duration ? quiz.duration * (quiz.timeUnit === 'seconds' ? 1 : 60) : null;
  const timeRemaining = timeLimitSeconds != null ? Math.max(0, timeLimitSeconds - elapsedSeconds) : null;
  const overTime = timeLimitSeconds != null && elapsedSeconds >= timeLimitSeconds;

  useEffect(() => {
    if (overTime) onSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overTime]);

  return (
    <div className="space-y-4">
      {/* Timer + progress bar */}
      <div className="flex items-center justify-between bg-background-50 rounded-xl border border-foreground-200/60 px-4 py-3">
        <span className="text-sm font-semibold text-foreground-700">{answeredCount}/{quiz.questions.length} answered</span>
        <span className={`text-sm font-mono font-bold inline-flex items-center gap-1.5 ${timeRemaining != null && timeRemaining < 60 ? 'text-red-600' : 'text-foreground-700'}`}>
          <AppIcon className="ri-timer-line" />
          {timeRemaining != null ? formatClock(timeRemaining) : formatClock(elapsedSeconds)}
        </span>
      </div>

      {/* Question navigator */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {quiz.questions.map((q, i) => (
          <button
            key={q.id}
            onClick={() => onJump(i)}
            className={`w-8 h-8 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              i === current
                ? 'bg-primary-600 text-white'
                : isAnswered(answers[String(q.id)])
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-background-100 text-foreground-500'
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* Active question */}
      <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5 md:p-6 card-premium">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-400">Question {current + 1} of {quiz.questions.length}</span>
          <span className="text-[11px] text-foreground-400">· {question.points} {question.points === 1 ? 'point' : 'points'}</span>
        </div>
        <p className="text-base font-semibold text-foreground-900 mb-5">{question.text}</p>

        <QuestionInput question={question} value={answers[String(question.id)]} onChange={(v) => onAnswer(question.id, v)} />
      </div>

      {submitError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{submitError}</div>
      )}

      {/* Nav buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={onPrev}
          disabled={current === 0}
          className="px-4 py-2.5 rounded-xl text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        {isLast ? (
          <button
            onClick={onSubmit}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
          >
            <AppIcon className="ri-check-line" /> Finish Quiz
          </button>
        ) : (
          <button
            onClick={onNext}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors cursor-pointer"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}

function isAnswered(value: QuizAnswerValue | undefined): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/* ═══════════════════════════════════════════════════════
   QUESTION INPUT — dispatches by type
   ═══════════════════════════════════════════════════════ */
function QuestionInput({ question, value, onChange }: {
  question: QuizQuestion;
  value: QuizAnswerValue | undefined;
  onChange: (v: QuizAnswerValue) => void;
}) {
  switch (question.type) {
    case 'single_choice':
    case 'true_false':
      return <SingleChoiceInput question={question} value={value as number | undefined} onChange={onChange} />;
    case 'multiple_choice':
      return <MultipleChoiceInput question={question} value={value as number[] | undefined} onChange={onChange} />;
    case 'fill_gap':
      return <FillGapInput value={value as string | undefined} onChange={onChange} />;
    case 'keywords':
      return <KeywordsInput answerCount={question.answerCount || 1} value={value as string[] | undefined} onChange={onChange} />;
    case 'ordering':
      return <OrderingInput question={question} value={value as number[] | undefined} onChange={onChange} />;
    case 'matching':
    case 'image_matching':
      return <MatchingInput question={question} value={value as Record<string, string> | undefined} onChange={onChange} />;
    default:
      return <p className="text-sm text-foreground-400 italic">This question type isn't supported yet — skip and continue.</p>;
  }
}

function SingleChoiceInput({ question, value, onChange }: {
  question: QuizQuestion; value: number | undefined; onChange: (v: QuizAnswerValue) => void;
}) {
  return (
    <div className="space-y-2">
      {question.answers.map((a, i) => (
        <button
          key={a.id}
          onClick={() => onChange(a.id)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors cursor-pointer ${
            value === a.id ? 'border-primary-400 bg-primary-50' : 'border-foreground-200 hover:bg-background-100'
          }`}
        >
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
            value === a.id ? 'bg-primary-600 text-white' : 'bg-background-100 text-foreground-500'
          }`}>
            {String.fromCharCode(65 + i)}
          </span>
          <span className="text-sm text-foreground-800">{a.text}</span>
        </button>
      ))}
    </div>
  );
}

function MultipleChoiceInput({ question, value, onChange }: {
  question: QuizQuestion; value: number[] | undefined; onChange: (v: QuizAnswerValue) => void;
}) {
  const selected = value || [];
  const toggle = (id: number) => {
    onChange(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
  };
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-foreground-400 mb-1">Select all that apply</p>
      {question.answers.map((a) => (
        <button
          key={a.id}
          onClick={() => toggle(a.id)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors cursor-pointer ${
            selected.includes(a.id) ? 'border-primary-400 bg-primary-50' : 'border-foreground-200 hover:bg-background-100'
          }`}
        >
          <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border-2 ${
            selected.includes(a.id) ? 'bg-primary-600 border-primary-600' : 'border-foreground-300'
          }`}>
            {selected.includes(a.id) && <AppIcon className="ri-check-line text-white text-xs" />}
          </span>
          <span className="text-sm text-foreground-800">{a.text}</span>
        </button>
      ))}
    </div>
  );
}

function FillGapInput({ value, onChange }: { value: string | undefined; onChange: (v: QuizAnswerValue) => void }) {
  return (
    <input
      type="text"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Type your answer…"
      className="w-full h-11 px-4 text-sm bg-background-50 border border-foreground-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300 text-foreground-800"
    />
  );
}

function KeywordsInput({ answerCount, value, onChange }: {
  answerCount: number; value: string[] | undefined; onChange: (v: QuizAnswerValue) => void;
}) {
  const words = value && value.length === answerCount ? value : Array.from({ length: answerCount }, (_, i) => (value || [])[i] || '');
  const setWord = (i: number, w: string) => {
    const next = [...words];
    next[i] = w;
    onChange(next);
  };
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-foreground-400 mb-1">Give {answerCount} {answerCount === 1 ? 'answer' : 'answers'}</p>
      {words.map((w, i) => (
        <input
          key={i}
          type="text"
          value={w}
          onChange={(e) => setWord(i, e.target.value)}
          placeholder={`Answer ${i + 1}…`}
          className="w-full h-10 px-4 text-sm bg-background-50 border border-foreground-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300 text-foreground-800"
        />
      ))}
    </div>
  );
}

function OrderingInput({ question, value, onChange }: {
  question: QuizQuestion; value: number[] | undefined; onChange: (v: QuizAnswerValue) => void;
}) {
  const order = value && value.length === question.answers.length ? value : question.answers.map((a) => a.id);
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const byId = new Map(question.answers.map((a) => [a.id, a.text]));
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-foreground-400 mb-1">Arrange in the correct order</p>
      {order.map((id, i) => (
        <div key={id} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-foreground-200 bg-background-50">
          <span className="w-6 h-6 rounded-full bg-background-100 text-foreground-500 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
          <span className="flex-1 text-sm text-foreground-800">{byId.get(id)}</span>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => move(i, -1)} disabled={i === 0} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-background-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed">
              <AppIcon className="ri-arrow-up-line text-foreground-500 text-sm" />
            </button>
            <button onClick={() => move(i, 1)} disabled={i === order.length - 1} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-background-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed">
              <AppIcon className="ri-arrow-down-line text-foreground-500 text-sm" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchingInput({ question, value, onChange }: {
  question: QuizQuestion; value: Record<string, string> | undefined; onChange: (v: QuizAnswerValue) => void;
}) {
  const pairs = value || {};
  const setMatch = (left: string, right: string) => {
    onChange({ ...pairs, [left]: right });
  };
  const rightOptions = question.rightOptions || [];
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-foreground-400 mb-1">Match each item on the left with the correct option</p>
      {question.answers.map((a) => (
        <div key={a.id} className="flex items-center gap-3">
          <span className="flex-1 text-sm text-foreground-800 px-3 py-2.5 rounded-lg bg-background-100">{a.left}</span>
          <AppIcon className="ri-arrow-right-line text-foreground-300 shrink-0" />
          <select
            value={pairs[a.left || ''] || ''}
            onChange={(e) => setMatch(a.left || '', e.target.value)}
            className="flex-1 h-10 px-3 text-sm bg-background-50 border border-foreground-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300 text-foreground-800"
          >
            <option value="">Select…</option>
            {rightOptions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   RESULTS
   ═══════════════════════════════════════════════════════ */
function ResultsScreen({ quiz, result, onBack }: { quiz: Quiz; result: QuizAttemptResult; onBack: () => void }) {
  const { attempt } = result;
  return (
    <div className="space-y-4">
      <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6 md:p-8 card-premium text-center">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${attempt.passed ? 'bg-emerald-100' : 'bg-red-100'}`}>
          <AppIcon className={`${attempt.passed ? 'ri-trophy-line text-emerald-600' : 'ri-close-circle-line text-red-600'} text-2xl`} />
        </div>
        <h1 className="text-lg font-heading font-bold text-foreground-900 mb-1">{attempt.passed ? 'Quiz Passed!' : 'Quiz Not Passed'}</h1>
        <p className="text-sm text-foreground-400 mb-6">{quiz.title}</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatTile icon="ri-percent-line" label="Grade" value={`${Math.round((result.grade ?? attempt.grade) * 100)}%`} />
          <StatTile icon="ri-check-double-line" label="Score" value={`${result.achievedScore ?? attempt.achievedScore}/${result.totalScore ?? attempt.totalScore}`} />
          <StatTile icon="ri-medal-line" label="Points" value={`${result.earned}/${result.possible}`} />
          <StatTile icon="ri-timer-line" label="Time taken" value={attempt.timeTaken} />
        </div>

        <button
          onClick={onBack}
          className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors cursor-pointer"
        >
          Back to Training Plan
        </button>
      </div>

      {/* Per-question breakdown */}
      <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5 md:p-6 card-premium">
        <h2 className="text-sm font-heading font-bold text-foreground-900 mb-3">Question Breakdown</h2>
        <div className="space-y-2">
          {result.breakdown.map((q, i) => (
            <div
              key={q.questionId}
              className={`rounded-xl border p-4 ${q.correct ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40'}`}
            >
              <div className="flex items-start gap-2 mb-2">
                <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 ${
                  q.correct ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
                }`}>
                  <AppIcon className={q.correct ? 'ri-check-line' : 'ri-close-line'} />
                </span>
                <p className="text-sm font-semibold text-foreground-900 flex-1">
                  <span className="text-foreground-400 font-normal">Q{i + 1}.</span> {q.questionText}
                </p>
                <span className="shrink-0 text-[11px] text-foreground-400">{q.earned}/{q.possible} pt</span>
              </div>
              <div className="pl-7 space-y-1">
                <p className="text-xs text-foreground-600">
                  <span className="font-medium text-foreground-500">Your answer: </span>
                  {q.chosenAnswer || <span className="italic text-foreground-400">No answer</span>}
                </p>
                {!q.correct && q.correctAnswer && (
                  <p className="text-xs text-emerald-700">
                    <span className="font-medium">Correct answer: </span>{q.correctAnswer}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
