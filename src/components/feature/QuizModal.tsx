import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  ksbs: string[];
}

interface QuizSession {
  quizId: string;
  quizTitle: string;
  questions: QuizQuestion[];
  passMark: number;
  timeLimit: number; // in seconds
  ksbs: { code: string; label: string; type: string }[];
}

interface QuizResult {
  score: number;
  total: number;
  percentage: number;
  passed: boolean;
  timeTaken: string;
  answers: number[];
  questionResults: { correct: boolean; selected: number; correctAnswer: number }[];
  ksbBreakdown: { code: string; correct: number; total: number }[];
}

interface QuizModalProps {
  session: QuizSession | null;
  onClose: () => void;
  onComplete: (result: QuizResult) => void;
}

export function QuizModal({ session, onClose, onComplete }: QuizModalProps) {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [phase, setPhase] = useState<'intro' | 'quiz' | 'review' | 'result'>('intro');
  const [result, setResult] = useState<QuizResult | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (session && phase === 'intro') {
      setTimeRemaining(session.timeLimit);
      setAnswers(new Array(session.questions.length).fill(-1));
      setCurrentQuestion(0);
      setFlagged(new Set());
      setResult(null);
    }
  }, [session, phase]);

  useEffect(() => {
    if (phase !== 'quiz' || !session) return;
    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          submitQuiz();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [phase, session]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const submitQuiz = useCallback(() => {
    if (!session) return;
    const total = session.questions.length;
    const correct = session.questions.map((q, i) => answers[i] === q.correctAnswer);
    const correctCount = correct.filter(Boolean).length;
    const percentage = Math.round((correctCount / total) * 100);
    const passed = percentage >= session.passMark;

    const timeTaken = session.timeLimit - timeRemaining;
    const m = Math.floor(timeTaken / 60);
    const s = timeTaken % 60;

    const ksbBreakdown: { code: string; correct: number; total: number }[] = [];
    session.ksbs.forEach(ksb => {
      const related = session.questions.filter(q => q.ksbs.includes(ksb.code));
      if (related.length === 0) return;
      const c = related.filter((q, idx) => {
        const qIdx = session.questions.indexOf(q);
        return answers[qIdx] === q.correctAnswer;
      }).length;
      ksbBreakdown.push({ code: ksb.code, correct: c, total: related.length });
    });

    const res: QuizResult = {
      score: correctCount,
      total,
      percentage,
      passed,
      timeTaken: `${m}m ${s}s`,
      answers,
      questionResults: session.questions.map((q, i) => ({
        correct: answers[i] === q.correctAnswer,
        selected: answers[i],
        correctAnswer: q.correctAnswer,
      })),
      ksbBreakdown,
    };

    setResult(res);
    setPhase('result');
    onComplete(res);
  }, [session, answers, timeRemaining, onComplete]);

  const handleAnswer = (optionIndex: number) => {
    setAnswers(prev => {
      const next = [...prev];
      next[currentQuestion] = optionIndex;
      return next;
    });
  };

  const toggleFlag = () => {
    setFlagged(prev => {
      const next = new Set(prev);
      if (next.has(currentQuestion)) next.delete(currentQuestion);
      else next.add(currentQuestion);
      return next;
    });
  };

  const answeredCount = answers.filter(a => a !== -1).length;

  if (!session) return null;

  const progressPct = ((currentQuestion + 1) / session.questions.length) * 100;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-foreground-200/60 bg-background-50">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
              <i className="ri-questionnaire-line text-primary-600"></i>
            </span>
            <div>
              <h3 className="text-sm font-semibold text-foreground-900">{session.quizTitle}</h3>
              <p className="text-xs text-foreground-400">{session.questions.length} questions &middot; Pass {session.passMark}%</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {phase === 'quiz' && (
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${
                timeRemaining < 60 ? 'bg-red-50 text-red-600' : 'bg-background-100 text-foreground-600'
              }`}>
                <i className="ri-time-line"></i>
                {formatTime(timeRemaining)}
              </div>
            )}
            <button onClick={onClose} className="text-foreground-300 hover:text-foreground-500 transition-smooth cursor-pointer">
              <i className="ri-close-line text-lg"></i>
            </button>
          </div>
        </div>

        {/* Progress bar */}
        {phase === 'quiz' && (
          <div className="w-full h-1 bg-background-200">
            <div className="h-full bg-primary-500 transition-all duration-300" style={{ width: `${progressPct}%` }}></div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* INTRO PHASE */}
          {phase === 'intro' && (
            <div className="p-6 space-y-5">
              <div className="bg-primary-50 rounded-xl border border-primary-200/50 p-5">
                <h4 className="text-sm font-semibold text-primary-900 mb-2">Before You Start</h4>
                <ul className="space-y-2 text-sm text-primary-700">
                  <li className="flex items-start gap-2">
                    <i className="ri-check-line text-primary-500 mt-0.5"></i>
                    <span>You have {formatTime(session.timeLimit)} to complete this quiz.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <i className="ri-check-line text-primary-500 mt-0.5"></i>
                    <span>You need {session.passMark}% to pass. You can flag questions for review.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <i className="ri-check-line text-primary-500 mt-0.5"></i>
                    <span>Your score will be linked to your KSB tracker automatically.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <i className="ri-check-line text-primary-500 mt-0.5"></i>
                    <span>Find a quiet space — once you start, the timer cannot be paused.</span>
                  </li>
                </ul>
              </div>

              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <h4 className="text-sm font-semibold text-foreground-900 mb-2">KSBs Being Assessed</h4>
                <div className="flex flex-wrap gap-1.5">
                  {session.ksbs.map(k => (
                    <span key={k.code} className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      k.type === 'Knowledge' ? 'bg-primary-50 text-primary-700 border border-primary-200/50' :
                      k.type === 'Skill' ? 'bg-accent-50 text-accent-700 border border-accent-200/50' :
                      'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                    }`}>
                      {k.code} &middot; {k.label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-center gap-3">
                <button onClick={onClose} className="px-5 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">
                  Cancel
                </button>
                <button
                  onClick={() => setPhase('quiz')}
                  className="px-5 py-2.5 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2"
                >
                  <i className="ri-play-circle-line"></i> Start Quiz
                </button>
              </div>
            </div>
          )}

          {/* QUIZ PHASE */}
          {phase === 'quiz' && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-semibold text-foreground-400">Question {currentQuestion + 1} of {session.questions.length}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleFlag}
                    className={`text-xs font-medium flex items-center gap-1 px-2 py-1 rounded-md transition-smooth cursor-pointer ${
                      flagged.has(currentQuestion) ? 'bg-amber-50 text-amber-700 border border-amber-200/50' : 'bg-background-100 text-foreground-400 border border-foreground-200/60'
                    }`}
                  >
                    <i className={flagged.has(currentQuestion) ? 'ri-flag-fill' : 'ri-flag-line'}></i>
                    {flagged.has(currentQuestion) ? 'Flagged' : 'Flag for Review'}
                  </button>
                </div>
              </div>

              <p className="text-base font-medium text-foreground-900 mb-5 leading-relaxed">
                {session.questions[currentQuestion].question}
              </p>

              <div className="space-y-2.5">
                {session.questions[currentQuestion].options.map((opt, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleAnswer(idx)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-smooth text-sm leading-relaxed cursor-pointer ${
                      answers[currentQuestion] === idx
                        ? 'border-primary-300 bg-primary-50 text-primary-900'
                        : 'border-foreground-200/60 bg-background-50 text-foreground-700 hover:bg-background-100 hover:border-background-300'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5 ${
                        answers[currentQuestion] === idx
                          ? 'border-primary-400 bg-primary-400 text-white'
                          : 'border-background-300 text-foreground-400'
                      }`}>
                        {String.fromCharCode(65 + idx)}
                      </span>
                      <span>{opt}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* REVIEW PHASE */}
          {phase === 'review' && (
            <div className="p-6">
              <h4 className="text-sm font-semibold text-foreground-900 mb-4">Review Your Answers</h4>
              <div className="grid grid-cols-5 sm:grid-cols-8 gap-2 mb-4">
                {session.questions.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => { setCurrentQuestion(idx); setPhase('quiz'); }}
                    className={`w-full aspect-square rounded-lg text-sm font-semibold flex items-center justify-center transition-smooth cursor-pointer ${
                      answers[idx] !== -1
                        ? flagged.has(idx)
                          ? 'bg-amber-100 text-amber-700 border border-amber-200/50'
                          : 'bg-primary-100 text-primary-700 border border-primary-200/50'
                        : flagged.has(idx)
                        ? 'bg-amber-50 text-amber-600 border border-amber-200/50'
                        : 'bg-background-100 text-foreground-400 border border-foreground-200/60'
                    }`}
                  >
                    {idx + 1}
                    {answers[idx] !== -1 && <i className="ri-check-line text-xs ml-0.5"></i>}
                    {flagged.has(idx) && answers[idx] === -1 && <i className="ri-flag-line text-xs ml-0.5"></i>}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-4 text-xs text-foreground-400 mb-4">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-primary-100 border border-primary-200/50"></span> Answered</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-200/50"></span> Flagged</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-background-100 border border-foreground-200/60"></span> Unanswered</span>
              </div>
              <div className="flex items-center justify-center gap-3">
                <button onClick={() => setPhase('quiz')} className="px-4 py-2 bg-background-100 border border-background-200 rounded-lg text-sm font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">
                  Back to Quiz
                </button>
                <button onClick={submitQuiz} className="px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                  Submit Quiz
                </button>
              </div>
            </div>
          )}

          {/* RESULT PHASE */}
          {phase === 'result' && result && (
            <div className="p-6 space-y-5">
              {/* Score hero */}
              <div className={`rounded-2xl p-6 text-center ${
                result.passed ? 'bg-emerald-50 border border-emerald-200/50' : 'bg-red-50 border border-red-200/50'
              }`}>
                <div className="relative w-24 h-24 mx-auto mb-3">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke={result.passed ? 'oklch(var(--emerald-200))' : 'oklch(var(--red-200))'} strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke={result.passed ? 'oklch(var(--emerald-500))' : 'oklch(var(--red-500))'} strokeWidth="3" strokeDasharray={`${Math.round((result.percentage / 100) * 97.4)} 97.4`} strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-xl font-bold ${result.passed ? 'text-emerald-700' : 'text-red-700'}`}>{result.percentage}%</span>
                  </div>
                </div>
                <h4 className={`text-lg font-bold ${result.passed ? 'text-emerald-800' : 'text-red-800'}`}>
                  {result.passed ? 'Quiz Passed!' : 'Quiz Failed'}
                </h4>
                <p className="text-sm mt-1">
                  <span className={result.passed ? 'text-emerald-700' : 'text-red-700'}>
                    {result.score}/{result.total} correct &middot; {result.timeTaken}
                  </span>
                </p>
                {!result.passed && (
                  <p className="text-xs text-red-600 mt-1">You need {session.passMark}% to pass. Review the recommended areas below and retake the quiz.</p>
                )}
              </div>

              {/* KSB Breakdown */}
              <div>
                <h4 className="text-sm font-semibold text-foreground-900 mb-3">KSB Performance</h4>
                <div className="space-y-2">
                  {result.ksbBreakdown.map(ksb => {
                    const pct = Math.round((ksb.correct / ksb.total) * 100);
                    return (
                      <div key={ksb.code} className="flex items-center gap-3 bg-background-50 rounded-lg border border-foreground-200/60 p-3">
                        <span className="text-xs font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded w-10 text-center shrink-0">{ksb.code}</span>
                        <span className="text-sm text-foreground-700 flex-1">{ksb.correct}/{ksb.total} correct</span>
                        <div className="w-24 h-2 bg-background-200 rounded-full overflow-hidden shrink-0">
                          <div className={`h-full rounded-full ${pct >= 70 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${pct}%` }}></div>
                        </div>
                        <span className={`text-xs font-semibold w-8 text-right ${pct >= 70 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{pct}%</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-foreground-400 mt-2">
                  These results have been linked to your <button onClick={() => { navigate('/learner/ksbs'); onClose(); }} className="text-primary-600 font-medium hover:text-primary-700 cursor-pointer">KSB tracker</button>.
                </p>
              </div>

              {/* Question review */}
              <div>
                <h4 className="text-sm font-semibold text-foreground-900 mb-3">Question Review</h4>
                <div className="space-y-3">
                  {session.questions.map((q, idx) => {
                    const qr = result.questionResults[idx];
                    return (
                      <div key={idx} className={`rounded-xl border p-4 ${
                        qr.correct ? 'border-emerald-200/50 bg-emerald-50/30' : 'border-red-200/50 bg-red-50/30'
                      }`}>
                        <div className="flex items-start gap-2 mb-2">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            qr.correct ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {idx + 1}
                          </span>
                          <span className="text-sm font-medium text-foreground-900">{q.question}</span>
                        </div>
                        <div className="space-y-1 ml-8">
                          {q.options.map((opt, oidx) => (
                            <div key={oidx} className={`text-sm px-2 py-1 rounded-md ${
                              oidx === q.correctAnswer ? 'bg-emerald-100 text-emerald-700 font-medium' :
                              oidx === qr.selected && !qr.correct ? 'bg-red-100 text-red-700' :
                              'text-foreground-500'
                            }`}>
                              <span className="font-semibold mr-1">{String.fromCharCode(65 + oidx)}.</span>
                              {opt}
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-foreground-500 mt-2 ml-8 italic">{q.explanation}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer navigation */}
        {phase === 'quiz' && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-foreground-200/60 bg-background-50">
            <div className="flex items-center gap-1">
              {session.questions.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentQuestion(idx)}
                  className={`w-7 h-7 rounded-md text-[10px] font-semibold flex items-center justify-center transition-smooth cursor-pointer ${
                    idx === currentQuestion ? 'bg-primary-500 text-white' :
                    answers[idx] !== -1 ? 'bg-primary-100 text-primary-700' :
                    flagged.has(idx) ? 'bg-amber-100 text-amber-700' :
                    'bg-background-200 text-foreground-400'
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPhase('review')}
                className="px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-xs font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap"
              >
                Review ({answeredCount}/{session.questions.length})
              </button>
              {currentQuestion > 0 && (
                <button
                  onClick={() => setCurrentQuestion(currentQuestion - 1)}
                  className="px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-xs font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-arrow-left-line"></i>
                </button>
              )}
              {currentQuestion < session.questions.length - 1 ? (
                <button
                  onClick={() => setCurrentQuestion(currentQuestion + 1)}
                  className="px-4 py-2 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  Next <i className="ri-arrow-right-line"></i>
                </button>
              ) : (
                <button
                  onClick={submitQuiz}
                  className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-xs font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  Submit <i className="ri-check-line"></i>
                </button>
              )}
            </div>
          </div>
        )}

        {phase === 'result' && (
          <div className="flex items-center justify-center gap-3 px-6 py-4 border-t border-foreground-200/60 bg-background-50">
            {!result?.passed && (
              <button
                onClick={() => { setPhase('intro'); }}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap"
              >
                <i className="ri-refresh-line mr-1"></i> Retake Quiz
              </button>
            )}
            <button
              onClick={() => { navigate('/learner/ksbs'); onClose(); }}
              className="px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
            >
              <i className="ri-bar-chart-2-line mr-1"></i> View KSBs
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-background-100 border border-background-200 rounded-lg text-sm font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export type { QuizSession, QuizResult, QuizQuestion };