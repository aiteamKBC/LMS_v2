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

const learnerNav = roleNavMap.learner;

type Phase = 'intro' | 'quiz' | 'reflect' | 'results';

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function QuizTakePage() {
  const { kind, id, quizId } = useParams<{ kind: string; id: string; quizId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const moduleTitle = searchParams.get('module');
  const weekTitle = searchParams.get('week');

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [learnerKsbs, setLearnerKsbs] = useState<LearnerKsbItem[]>([]);
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
      .then((d) => { if (!cancelled) setLearnerKsbs(d.ksbs || []); })
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
      <div className="p-3 md:p-6 max-w-3xl mx-auto">
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
            quiz={quiz}
            learnerKsbs={learnerKsbs}
            elapsedSeconds={elapsedSeconds}
            submitting={submitting}
            submitError={submitError}
            onSubmit={finalizeSubmit}
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
          <i className="ri-questionnaire-line text-amber-600 text-xl" />
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
          <i className="ri-play-fill" /> Start Quiz
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
      <i className={`${icon} text-primary-500 text-base`} />
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
          <i className="ri-timer-line" />
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
            <i className="ri-check-line" /> Finish Quiz
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
            {selected.includes(a.id) && <i className="ri-check-line text-white text-xs" />}
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
              <i className="ri-arrow-up-line text-foreground-500 text-sm" />
            </button>
            <button onClick={() => move(i, 1)} disabled={i === order.length - 1} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-background-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed">
              <i className="ri-arrow-down-line text-foreground-500 text-sm" />
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
          <i className="ri-arrow-right-line text-foreground-300 shrink-0" />
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
   REFLECTION WINDOW — 2 tabs: KSBs + feedback, and time-taken
   ═══════════════════════════════════════════════════════ */
const KSB_TYPE_LABELS: Record<string, string> = { K: 'Knowledge', S: 'Skills', B: 'Behaviours' };
const KSB_TYPE_ORDER = ['K', 'S', 'B'];

/** Group a flat KSB list into type buckets, ordered K → S → B, then by number. */
function groupKsbsByType(ksbs: LearnerKsbItem[]) {
  const byType: Record<string, LearnerKsbItem[]> = {};
  for (const k of ksbs) {
    const t = (k.type || k.code.charAt(0) || '?').toUpperCase();
    (byType[t] ||= []).push(k);
  }
  const types = Object.keys(byType).sort((a, b) => {
    const ia = KSB_TYPE_ORDER.indexOf(a); const ib = KSB_TYPE_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return types.map((t) => ({
    type: t,
    label: KSB_TYPE_LABELS[t] || t,
    items: byType[t].slice().sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0)),
  }));
}

function ReflectionWindow({
  quiz, learnerKsbs, elapsedSeconds, submitting, submitError, onSubmit,
}: {
  quiz: Quiz;
  learnerKsbs: LearnerKsbItem[];
  elapsedSeconds: number;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (r: { ksbs: string[]; feedback: string; reportedTime: string }) => void;
}) {
  const [tab, setTab] = useState<'ksbs' | 'time'>('ksbs');
  const [selectedKsbs, setSelectedKsbs] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');
  const [timeMode, setTimeMode] = useState<'planned' | 'custom' | null>(null);
  const [customTime, setCustomTime] = useState('');
  const [triedSave, setTriedSave] = useState(false);

  const groups = useMemo(() => groupKsbsByType(learnerKsbs), [learnerKsbs]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isExpanded = (t: string) => expanded[t] ?? true; // default: open

  const plannedTimeLabel = quiz.duration ? `${quiz.duration} ${quiz.timeUnit || 'min'}` : '';
  const toggleKsb = (code: string) =>
    setSelectedKsbs((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));

  const toggleGroup = (codes: string[], allSelected: boolean) =>
    setSelectedKsbs((prev) => (allSelected
      ? prev.filter((c) => !codes.includes(c))
      : Array.from(new Set([...prev, ...codes]))));

  // Time is obligatory: a mode must be chosen, and if custom it must be non-empty.
  const reportedTime = timeMode === 'planned' ? plannedTimeLabel : timeMode === 'custom' ? customTime.trim() : '';
  const timeValid = reportedTime.length > 0;

  const handleSave = () => {
    if (!timeValid) {
      setTriedSave(true);
      setTab('time');
      return;
    }
    onSubmit({ ksbs: selectedKsbs, feedback: feedback.trim(), reportedTime });
  };

  return (
    <div className="bg-background-50 rounded-2xl border border-foreground-200/60 card-premium overflow-hidden">
      {/* Header */}
      <div className="px-5 md:px-6 pt-5 pb-0">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
            <i className="ri-checkbox-circle-line text-primary-600 text-base" />
          </div>
          <div>
            <h1 className="text-base font-heading font-bold text-foreground-900">Before we finish…</h1>
            <p className="text-xs text-foreground-400">Tell us what this quiz covered and how it went.</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-background-300 mt-4">
          <TabButton active={tab === 'ksbs'} onClick={() => setTab('ksbs')} icon="ri-links-line" label="KSBs & Feedback" />
          <TabButton active={tab === 'time'} onClick={() => setTab('time')} icon="ri-timer-line" label="Time Taken" required={!timeValid} />
        </div>
      </div>

      {/* Tab content */}
      <div className="p-5 md:p-6">
        {tab === 'ksbs' ? (
          <div className="space-y-5">
            <div>
              <p className="text-sm font-semibold text-foreground-800 mb-1">Which KSBs did this quiz fulfil?</p>
              <p className="text-xs text-foreground-400 mb-3">Expand a category and tick all that apply.</p>
              {learnerKsbs.length === 0 ? (
                <p className="text-xs text-foreground-400 italic">No KSBs available for this learner.</p>
              ) : (
                <div className="border border-background-300 rounded-xl divide-y divide-background-300 max-h-72 overflow-y-auto">
                  {groups.map((g) => {
                    const codes = g.items.map((k) => k.code);
                    const selectedInGroup = codes.filter((c) => selectedKsbs.includes(c)).length;
                    const allSelected = selectedInGroup === codes.length && codes.length > 0;
                    const someSelected = selectedInGroup > 0 && !allSelected;
                    const open = isExpanded(g.type);
                    return (
                      <div key={g.type}>
                        {/* Parent node */}
                        <div className="flex items-center gap-2 px-3 py-2 bg-background-100/40">
                          <button
                            onClick={() => setExpanded((e) => ({ ...e, [g.type]: !open }))}
                            className="w-5 h-5 flex items-center justify-center rounded hover:bg-background-200 cursor-pointer shrink-0"
                            aria-label={open ? 'Collapse' : 'Expand'}
                          >
                            <i className={`ri-arrow-right-s-line text-foreground-500 transition-transform ${open ? 'rotate-90' : ''}`} />
                          </button>
                          <button
                            onClick={() => toggleGroup(codes, allSelected)}
                            className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer text-left"
                          >
                            <span className={`shrink-0 w-4 h-4 rounded flex items-center justify-center border-2 ${
                              allSelected ? 'bg-primary-600 border-primary-600' : someSelected ? 'bg-primary-200 border-primary-400' : 'border-foreground-300'
                            }`}>
                              {allSelected ? <i className="ri-check-line text-white text-[10px]" /> : someSelected ? <i className="ri-subtract-line text-primary-700 text-[10px]" /> : null}
                            </span>
                            <span className="text-sm font-semibold text-foreground-800">{g.label} <span className="text-foreground-400 font-normal">({g.type})</span></span>
                            <span className="text-[11px] text-foreground-400">{selectedInGroup}/{codes.length}</span>
                          </button>
                        </div>
                        {/* Children */}
                        {open && (
                          <div className="pl-8 pr-2 py-1.5 space-y-1">
                            {g.items.map((k) => {
                              const selected = selectedKsbs.includes(k.code);
                              return (
                                <button
                                  key={k.code}
                                  onClick={() => toggleKsb(k.code)}
                                  className={`w-full flex items-start gap-2 p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                                    selected ? 'border-primary-400 bg-primary-50' : 'border-transparent hover:bg-background-100'
                                  }`}
                                >
                                  <span className={`shrink-0 w-4 h-4 rounded flex items-center justify-center mt-0.5 border-2 ${
                                    selected ? 'bg-primary-600 border-primary-600' : 'border-foreground-300'
                                  }`}>
                                    {selected && <i className="ri-check-line text-white text-[10px]" />}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="text-xs font-semibold text-primary-600">{k.code}</span>
                                    <span className="block text-[11px] text-foreground-600 line-clamp-2">{k.description}</span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {selectedKsbs.length > 0 && (
                <p className="text-[11px] text-foreground-500 mt-2">{selectedKsbs.length} KSB{selectedKsbs.length === 1 ? '' : 's'} selected</p>
              )}
            </div>

            <div>
              <p className="text-sm font-semibold text-foreground-800 mb-2">Feedback about this quiz</p>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={4}
                placeholder="How did you find the quiz? Anything you'd like to note…"
                className="w-full px-3 py-2.5 text-sm bg-background-50 border border-foreground-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300 text-foreground-800 resize-none"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-foreground-800">How long did it take you to complete this quiz? <span className="text-red-500">*</span></p>
            <p className="text-xs text-foreground-400 -mt-2">We tracked {formatClock(elapsedSeconds)} while you worked. Please confirm or record your own — this is required.</p>

            <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
              timeMode === 'planned' ? 'border-primary-400 bg-primary-50' : 'border-foreground-200 hover:bg-background-100'
            } ${!plannedTimeLabel ? 'opacity-50 pointer-events-none' : ''}`}>
              <input type="radio" name="timeMode" checked={timeMode === 'planned'} onChange={() => setTimeMode('planned')} disabled={!plannedTimeLabel} className="accent-primary-600" />
              <span className="text-sm text-foreground-800">
                Use the planned time
                {plannedTimeLabel ? <span className="font-semibold"> ({plannedTimeLabel})</span> : <span className="text-foreground-400"> (none set)</span>}
              </span>
            </label>

            <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
              timeMode === 'custom' ? 'border-primary-400 bg-primary-50' : 'border-foreground-200 hover:bg-background-100'
            }`}>
              <input type="radio" name="timeMode" checked={timeMode === 'custom'} onChange={() => setTimeMode('custom')} className="accent-primary-600 mt-1" />
              <span className="flex-1">
                <span className="text-sm text-foreground-800 block mb-2">Enter it myself</span>
                <input
                  type="text"
                  value={customTime}
                  onChange={(e) => { setCustomTime(e.target.value); setTimeMode('custom'); }}
                  placeholder="e.g. 25 minutes"
                  className="w-full h-10 px-3 text-sm bg-background-50 border border-foreground-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300 text-foreground-800"
                />
              </span>
            </label>

            {triedSave && !timeValid && (
              <p className="text-xs text-red-600 inline-flex items-center gap-1">
                <i className="ri-error-warning-line" /> Please record how long the quiz took before finishing.
              </p>
            )}
          </div>
        )}

        {submitError && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{submitError}</div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-background-300">
          {tab === 'ksbs' ? (
            <button onClick={() => setTab('time')} className="text-sm font-medium text-primary-600 hover:text-primary-700 cursor-pointer inline-flex items-center gap-1">
              Next: Time Taken <i className="ri-arrow-right-line" />
            </button>
          ) : (
            <button onClick={() => setTab('ksbs')} className="text-sm font-medium text-foreground-500 hover:text-foreground-700 cursor-pointer inline-flex items-center gap-1">
              <i className="ri-arrow-left-line" /> Back to KSBs
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={submitting || !timeValid}
            title={!timeValid ? 'Record how long the quiz took first' : undefined}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {submitting ? <><i className="ri-loader-4-line animate-spin" /> Saving…</> : <><i className="ri-check-line" /> Finish & Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label, required }: { active: boolean; onClick: () => void; icon: string; label: string; required?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-1.5 border-b-2 -mb-px transition-colors cursor-pointer ${
        active ? 'border-primary-600 text-primary-700' : 'border-transparent text-foreground-400 hover:text-foreground-600'
      }`}
    >
      <i className={icon} /> {label}
      {required && <span className="w-1.5 h-1.5 rounded-full bg-red-500" title="Required" />}
    </button>
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
          <i className={`${attempt.passed ? 'ri-trophy-line text-emerald-600' : 'ri-close-circle-line text-red-600'} text-2xl`} />
        </div>
        <h1 className="text-lg font-heading font-bold text-foreground-900 mb-1">{attempt.passed ? 'Quiz Passed!' : 'Quiz Not Passed'}</h1>
        <p className="text-sm text-foreground-400 mb-6">{quiz.title}</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatTile icon="ri-percent-line" label="Grade" value={attempt.grade} />
          <StatTile icon="ri-check-double-line" label="Score" value={attempt.Score} />
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
                  <i className={q.correct ? 'ri-check-line' : 'ri-close-line'} />
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
