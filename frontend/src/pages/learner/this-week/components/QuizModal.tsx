import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { QuizData } from '@/mocks/learner-profile';

interface QuizModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (score: number, passed: boolean) => void;
  quizData: QuizData;
}

export function QuizModal({ isOpen, onClose, onComplete, quizData }: QuizModalProps) {
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<'intro' | 'quiz' | 'results'>('intro');
  const [currentQ, setCurrentQ] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [showFeedback, setShowFeedback] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [finalPassed, setFinalPassed] = useState(false);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setPhase('intro');
      setCurrentQ(0);
      setSelected(null);
      setAnswers(new Array(quizData.questions.length).fill(null));
      setShowFeedback(false);
      setTimeLeft(quizData.timeLimit * 60);
      setFinalScore(null);
      setFinalPassed(false);
      setFlagged(new Set());
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen, quizData]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen && phase !== 'quiz') onClose();
      if (e.key >= '1' && e.key <= '4' && phase === 'quiz' && !showFeedback) {
        const idx = parseInt(e.key) - 1;
        if (idx < quizData.questions[currentQ].options.length) selectAnswer(idx);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, phase, showFeedback, currentQ, quizData]);

  useEffect(() => {
    if (phase !== 'quiz' || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [phase, timeLeft]);

  useEffect(() => {
    if (timeLeft === 0 && phase === 'quiz') {
      finishQuiz();
    }
  }, [timeLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const startQuiz = () => {
    setPhase('quiz');
    setTimeLeft(quizData.timeLimit * 60);
  };

  const toggleFlag = () => {
    setFlagged(prev => {
      const next = new Set(prev);
      if (next.has(currentQ)) next.delete(currentQ);
      else next.add(currentQ);
      return next;
    });
  };

  const selectAnswer = (idx: number) => {
    if (showFeedback) return;
    setSelected(idx);
    setShowFeedback(true);
    const newAnswers = [...answers];
    newAnswers[currentQ] = idx;
    setAnswers(newAnswers);
  };

  const goNext = () => {
    if (currentQ < quizData.questions.length - 1) {
      setCurrentQ(prev => prev + 1);
      setSelected(answers[currentQ + 1] ?? null);
      setShowFeedback(answers[currentQ + 1] !== null);
    } else {
      finishQuiz();
    }
  };

  const goToQuestion = (idx: number) => {
    if (showFeedback) return;
    setCurrentQ(idx);
    setSelected(answers[idx] ?? null);
    setShowFeedback(answers[idx] !== null);
  };

  const finishQuiz = () => {
    const correct = answers.reduce((sum, a, i) => sum + (a === quizData.questions[i].correctIndex ? 1 : 0), 0);
    const pct = Math.round((correct / quizData.questions.length) * 100);
    const passed = pct >= quizData.passingScore;
    setFinalScore(pct);
    setFinalPassed(passed);
    setPhase('results');
    onComplete(pct, passed);
  };

  const handleRetake = () => {
    setPhase('quiz');
    setCurrentQ(0);
    setSelected(null);
    setAnswers(new Array(quizData.questions.length).fill(null));
    setShowFeedback(false);
    setTimeLeft(quizData.timeLimit * 60);
    setFlagged(new Set());
  };

  const q = quizData.questions[currentQ];
  const progressPct = ((currentQ + (showFeedback ? 1 : 0)) / quizData.questions.length) * 100;
  const answeredCount = answers.filter(a => a !== null).length;

  const ksbColor = (code: string) => {
    if (code.startsWith('K')) return 'bg-primary-100 text-primary-700 border-primary-200';
    if (code.startsWith('S')) return 'bg-accent-100 text-accent-700 border-accent-200';
    return 'bg-secondary-100 text-secondary-700 border-secondary-200';
  };

  if (!mounted) return null;

  const isTimerUrgent = timeLeft <= 60 && timeLeft > 0;
  const timerClass = isTimerUrgent ? 'text-red-600 bg-red-50 border-red-200 animate-pulse' : 'text-foreground-600 bg-background-100 border-foreground-200';

  const panel = (
    <>
      <div
        onClick={phase !== 'quiz' ? onClose : undefined}
        className={`fixed inset-0 z-[60] bg-foreground-950/60 backdrop-blur-sm transition-opacity duration-500 ease-out ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <div
        className={`fixed inset-0 z-[61] flex items-center justify-center p-4 md:p-6 transition-all duration-500 ease-out ${
          isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        <div className="w-full max-w-[840px] max-h-[92vh] bg-background-50 rounded-2xl overflow-hidden flex flex-col shadow-2xl shadow-foreground-950/20">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-foreground-200 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-9 h-9 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                <i className="ri-questionnaire-line text-primary-600 text-sm"></i>
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground-900 truncate">{quizData.title}</p>
                <p className="text-xs text-foreground-400">{quizData.questions.length} questions &middot; {quizData.totalPoints} pts &middot; Pass: {quizData.passingScore}%</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {finalPassed && finalScore !== null && (
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full flex items-center gap-1">
                  <i className="ri-check-line"></i> Completed &middot; {finalScore}%
                </span>
              )}
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer shrink-0"
              >
                <i className="ri-close-line text-lg"></i>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {phase === 'intro' && (
              <IntroScreen quizData={quizData} onStart={startQuiz} ksbColor={ksbColor} />
            )}

            {phase === 'quiz' && (
              <div className="flex flex-col lg:flex-row">
                {/* Main Quiz Area */}
                <div className="flex-1 min-w-0">
                  <QuizScreen
                    question={q}
                    questionIndex={currentQ}
                    total={quizData.questions.length}
                    selected={selected}
                    showFeedback={showFeedback}
                    onSelect={selectAnswer}
                    onNext={goNext}
                    onFlag={toggleFlag}
                    isFlagged={flagged.has(currentQ)}
                    timerDisplay={formatTime(timeLeft)}
                    timerClass={timerClass}
                    progressPct={progressPct}
                    ksbColor={ksbColor}
                  />
                </div>
                {/* Question Navigator - Right Sidebar */}
                <div className="hidden lg:block w-[160px] border-l border-foreground-200 bg-background-50 shrink-0">
                  <div className="p-4 sticky top-0">
                    <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-3">Question Navigator</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {quizData.questions.map((_, idx) => {
                        const isAnswered = answers[idx] !== null;
                        const isCurrent = idx === currentQ;
                        const isFlagged = flagged.has(idx);
                        return (
                          <button
                            key={idx}
                            onClick={() => goToQuestion(idx)}
                            disabled={showFeedback}
                            className={`w-8 h-8 rounded-lg text-[10px] font-semibold flex items-center justify-center transition-smooth cursor-pointer relative ${
                              isCurrent
                                ? 'bg-primary-500 text-white shadow-sm'
                                : isAnswered
                                ? 'bg-primary-100 text-primary-700 border border-primary-200'
                                : isFlagged
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-background-100 text-foreground-400 border border-foreground-200'
                            }`}
                          >
                            {idx + 1}
                            {isFlagged && !isCurrent && (
                              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 border-2 border-white"></span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-4 space-y-1.5 text-[10px] text-foreground-400">
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded bg-primary-500 border border-primary-500"></span>
                        <span>Current</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded bg-primary-100 border border-primary-200"></span>
                        <span>Answered</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded bg-amber-50 border border-amber-200"></span>
                        <span>Flagged</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded bg-background-100 border border-foreground-200"></span>
                        <span>Pending</span>
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-foreground-200">
                      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${timerClass}`}>
                        <i className="ri-time-line"></i>
                        <span className="tabular-nums">{formatTime(timeLeft)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {phase === 'results' && finalScore !== null && (
              <ResultsScreen
                answers={answers}
                quizData={quizData}
                onRetake={handleRetake}
                onClose={onClose}
                ksbColor={ksbColor}
                score={finalScore}
                passed={finalPassed}
              />
            )}
          </div>

          {/* Footer navigation for quiz */}
          {phase === 'quiz' && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-foreground-200 bg-background-50 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-foreground-400">
                  <span className="font-semibold text-foreground-700">{answeredCount}</span>/{quizData.questions.length} answered
                </span>
                {flagged.size > 0 && (
                  <span className="text-xs text-amber-600 flex items-center gap-1">
                    <i className="ri-flag-fill"></i> {flagged.size} flagged
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {currentQ > 0 && (
                  <button
                    onClick={() => goToQuestion(currentQ - 1)}
                    disabled={showFeedback}
                    className="px-3 py-2 bg-background-100 border border-foreground-200 rounded-lg text-xs font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap"
                  >
                    <i className="ri-arrow-left-line mr-1"></i> Previous
                  </button>
                )}
                {showFeedback && (
                  <button
                    onClick={goNext}
                    className={`px-5 py-2 rounded-lg text-xs font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 ${
                      currentQ < quizData.questions.length - 1
                        ? 'bg-primary-500 text-white hover:bg-primary-600'
                        : 'bg-emerald-500 text-white hover:bg-emerald-600'
                    }`}
                  >
                    {currentQ < quizData.questions.length - 1 ? (
                      <>Next <i className="ri-arrow-right-line"></i></>
                    ) : (
                      <>Finish <i className="ri-flag-line"></i></>
                    )}
                  </button>
                )}
                {!showFeedback && (
                  <button
                    onClick={finishQuiz}
                    className="px-5 py-2 rounded-lg text-xs font-semibold bg-foreground-200 text-foreground-700 hover:bg-foreground-300 transition-smooth cursor-pointer whitespace-nowrap"
                  >
                    Submit Early
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(panel, document.body);
}

/* ── Intro Screen ── */
function IntroScreen({
  quizData, onStart, ksbColor,
}: {
  quizData: QuizData;
  onStart: () => void;
  ksbColor: (code: string) => string;
}) {
  return (
    <div className="flex flex-col lg:flex-row">
      {/* Left: Main Content */}
      <div className="flex-1 p-6 md:p-8 lg:p-10">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
            <i className="ri-questionnaire-line text-primary-600 text-lg"></i>
          </span>
          <div>
            <span className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Knowledge Check</span>
            <h2 className="text-lg font-heading font-bold text-foreground-900 leading-tight">{quizData.title}</h2>
          </div>
        </div>

        <p className="text-sm text-foreground-500 leading-relaxed mb-6 max-w-lg">
          {quizData.description}
        </p>

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-background-100 rounded-xl border border-foreground-200 p-4 text-center">
            <p className="text-2xl font-heading font-bold text-foreground-900">{quizData.questions.length}</p>
            <p className="text-xs text-foreground-400 mt-0.5">Questions</p>
          </div>
          <div className="bg-background-100 rounded-xl border border-foreground-200 p-4 text-center">
            <p className="text-2xl font-heading font-bold text-foreground-900">{quizData.timeLimit}m</p>
            <p className="text-xs text-foreground-400 mt-0.5">Time Limit</p>
          </div>
          <div className="bg-background-100 rounded-xl border border-foreground-200 p-4 text-center">
            <p className="text-2xl font-heading font-bold text-primary-600">{quizData.passingScore}%</p>
            <p className="text-xs text-foreground-400 mt-0.5">Pass Mark</p>
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-background-100 rounded-xl border border-foreground-200 p-4 mb-6">
          <h4 className="text-xs font-semibold text-foreground-700 uppercase tracking-wider mb-2.5">Instructions</h4>
          <ul className="space-y-2 text-sm text-foreground-600">
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-primary-100 flex items-center justify-center shrink-0 mt-0.5">
                <i className="ri-check-line text-primary-600 text-xs"></i>
              </span>
              <span>You have <strong className="text-foreground-800">{quizData.timeLimit} minutes</strong> to complete this assessment.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-primary-100 flex items-center justify-center shrink-0 mt-0.5">
                <i className="ri-check-line text-primary-600 text-xs"></i>
              </span>
              <span>You need <strong className="text-foreground-800">{quizData.passingScore}%</strong> to pass. Your score links to your KSB tracker.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-primary-100 flex items-center justify-center shrink-0 mt-0.5">
                <i className="ri-check-line text-primary-600 text-xs"></i>
              </span>
              <span>Flag questions for review using the flag button. Navigate freely between questions.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-primary-100 flex items-center justify-center shrink-0 mt-0.5">
                <i className="ri-check-line text-primary-600 text-xs"></i>
              </span>
              <span>Use keyboard shortcuts <strong className="text-foreground-800">1-4</strong> to select answers quickly.</span>
            </li>
          </ul>
        </div>

        <button
          onClick={onStart}
          className="w-full sm:w-auto px-8 py-3 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
        >
          <i className="ri-play-circle-line"></i>
          Start Assessment
        </button>
      </div>

      {/* Right: KSB Panel */}
      <div className="hidden lg:block w-[260px] border-l border-foreground-200 bg-background-50 p-6">
        <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-3">KSBs Assessed</p>
        <div className="space-y-2">
          {quizData.questions.map((q, i) => {
            const seen = new Set<string>();
            if (seen.has(q.ksbRef)) return null;
            seen.add(q.ksbRef);
            return (
              <div key={i} className="flex items-center gap-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ksbColor(q.ksbRef)}`}>{q.ksbRef}</span>
                <span className="text-xs text-foreground-500">Question {i + 1}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 pt-4 border-t border-foreground-200">
          <p className="text-[10px] text-foreground-400 leading-relaxed">
            Your results will be automatically linked to your KSB portfolio and coaching progress.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Quiz Screen ── */
function QuizScreen({
  question, questionIndex, total, selected, showFeedback,
  onSelect, onNext, onFlag, isFlagged,
  timerDisplay, timerClass, progressPct, ksbColor,
}: {
  question: { id: number; text: string; options: string[]; correctIndex: number; explanation: string; ksbRef: string };
  questionIndex: number; total: number; selected: number | null; showFeedback: boolean;
  onSelect: (i: number) => void; onNext: () => void; onFlag: () => void; isFlagged: boolean;
  timerDisplay: string; timerClass: string; progressPct: number;
  ksbColor: (code: string) => string;
}) {
  return (
    <div className="p-6 md:p-8">
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
            Question {questionIndex + 1} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onFlag}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-smooth cursor-pointer ${
                isFlagged
                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : 'bg-background-100 text-foreground-400 border border-foreground-200 hover:text-foreground-600'
              }`}
            >
              <i className={isFlagged ? 'ri-flag-fill' : 'ri-flag-line'}></i>
              {isFlagged ? 'Flagged' : 'Flag'}
            </button>
            <div className={`lg:hidden flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${timerClass}`}>
              <i className="ri-time-line"></i>
              <span className="tabular-nums">{timerDisplay}</span>
            </div>
          </div>
        </div>
        <div className="h-2 rounded-full bg-background-200 overflow-hidden">
          <div className="h-full rounded-full bg-primary-500 transition-all duration-500" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {/* Question */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${ksbColor(question.ksbRef)}`}>
            {question.ksbRef}
          </span>
          <span className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">KSB Reference</span>
        </div>
        <p className="text-base font-semibold text-foreground-900 leading-relaxed">{question.text}</p>
      </div>

      {/* Options */}
      <div className="space-y-3 mb-6">
        {question.options.map((opt, i) => {
          let optStyle = 'border-foreground-200 bg-background-50 hover:border-primary-300 hover:bg-primary-50/40';
          let labelStyle = 'bg-background-200 text-foreground-500 border border-foreground-200';
          let textStyle = 'text-foreground-700';

          if (showFeedback) {
            if (i === question.correctIndex) {
              optStyle = 'border-emerald-300 bg-emerald-50';
              labelStyle = 'bg-emerald-500 text-white border border-emerald-500';
              textStyle = 'text-emerald-800 font-semibold';
            } else if (i === selected && i !== question.correctIndex) {
              optStyle = 'border-red-300 bg-red-50';
              labelStyle = 'bg-red-500 text-white border border-red-500';
              textStyle = 'text-red-700';
            } else {
              optStyle = 'border-foreground-200 bg-background-50 opacity-40';
              labelStyle = 'bg-background-200 text-foreground-400 border border-foreground-200';
              textStyle = 'text-foreground-400';
            }
          } else if (selected === i) {
            optStyle = 'border-primary-400 bg-primary-50';
            labelStyle = 'bg-primary-500 text-white border border-primary-500';
            textStyle = 'text-primary-900 font-medium';
          }

          return (
            <button
              key={i}
              onClick={() => onSelect(i)}
              disabled={showFeedback}
              className={`w-full flex items-start gap-3.5 px-5 py-4 rounded-xl border text-left transition-all duration-200 cursor-pointer ${optStyle}`}
            >
              <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold transition-all duration-200 ${labelStyle}`}>
                {showFeedback && i === question.correctIndex ? (
                  <i className="ri-check-line text-sm"></i>
                ) : showFeedback && i === selected && i !== question.correctIndex ? (
                  <i className="ri-close-line text-sm"></i>
                ) : (
                  String.fromCharCode(65 + i)
                )}
              </span>
              <span className={`text-[15px] leading-relaxed pt-0.5 ${textStyle}`}>{opt}</span>
              {showFeedback && i === question.correctIndex && (
                <i className="ri-check-line text-emerald-500 ml-auto text-lg shrink-0"></i>
              )}
              {showFeedback && i === selected && i !== question.correctIndex && (
                <i className="ri-close-line text-red-500 ml-auto text-lg shrink-0"></i>
              )}
            </button>
          );
        })}
      </div>

      {/* Feedback */}
      {showFeedback && (
        <div className={`rounded-xl p-5 mb-2 ${
          selected === question.correctIndex
            ? 'bg-emerald-50 border border-emerald-200'
            : 'bg-amber-50 border border-amber-200'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              selected === question.correctIndex ? 'bg-emerald-100' : 'bg-amber-100'
            }`}>
              <i className={`${selected === question.correctIndex ? 'ri-check-double-line text-emerald-600' : 'ri-error-warning-line text-amber-600'} text-lg`}></i>
            </span>
            <span className={`text-sm font-semibold ${selected === question.correctIndex ? 'text-emerald-800' : 'text-amber-800'}`}>
              {selected === question.correctIndex ? 'Correct Answer' : 'Incorrect Answer'}
            </span>
          </div>
          <p className="text-sm text-foreground-700 leading-relaxed pl-10">{question.explanation}</p>
        </div>
      )}
    </div>
  );
}

/* ── Results Screen ── */
function ResultsScreen({
  answers, quizData, onRetake, onClose, ksbColor, score, passed,
}: {
  answers: (number | null)[];
  quizData: QuizData;
  onRetake: () => void;
  onClose: () => void;
  ksbColor: (code: string) => string;
  score: number;
  passed: boolean;
}) {
  const correct = answers.reduce((sum, a, i) => sum + (a === quizData.questions[i].correctIndex ? 1 : 0), 0);

  // Calculate KSB breakdown
  const ksbStats: Record<string, { correct: number; total: number }> = {};
  quizData.questions.forEach((q, i) => {
    if (!ksbStats[q.ksbRef]) ksbStats[q.ksbRef] = { correct: 0, total: 0 };
    ksbStats[q.ksbRef].total += 1;
    if (answers[i] === q.correctIndex) ksbStats[q.ksbRef].correct += 1;
  });

  return (
    <div className="flex flex-col lg:flex-row">
      {/* Left: Main Results */}
      <div className="flex-1 p-6 md:p-8 lg:p-10">
        {/* Status badge */}
        <div className="flex items-center justify-center mb-6">
          <span className={`text-sm font-semibold px-4 py-1.5 rounded-full flex items-center gap-2 border ${
            passed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}>
            <i className={`${passed ? 'ri-check-double-line text-emerald-600' : 'ri-time-line text-amber-600'} text-lg`}></i>
            {passed ? 'Assessment Completed — Passed' : 'Assessment Completed — Review Needed'}
          </span>
        </div>

        {/* Score hero */}
        <div className="text-center mb-8">
          <div className="relative w-32 h-32 mx-auto mb-5">
            <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke={passed ? 'oklch(var(--emerald-200))' : 'oklch(var(--amber-200))'} strokeWidth="2.5" />
              <circle cx="18" cy="18" r="15.5" fill="none" stroke={passed ? 'oklch(var(--emerald-500))' : 'oklch(var(--amber-500))'} strokeWidth="2.5" strokeDasharray={`${Math.round((score / 100) * 97.4)} 97.4`} strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-2xl font-heading font-bold ${passed ? 'text-emerald-700' : 'text-amber-700'}`}>{score}%</span>
              <span className="text-[10px] text-foreground-400 mt-0.5">Your Score</span>
            </div>
          </div>
          <h2 className="text-xl font-heading font-bold text-foreground-900 mb-2">
            {passed ? 'Well Done — You Passed' : 'Keep Practicing — You Will Get There'}
          </h2>
          <p className="text-sm text-foreground-500 max-w-md mx-auto">
            {passed
              ? `You scored ${score}% and met the required pass mark of ${quizData.passingScore}%. Your KSB tracker has been updated with these results.`
              : `You scored ${score}%. The required pass mark is ${quizData.passingScore}%. Review the question breakdown below and retake when ready.`
            }
          </p>
        </div>

        {/* Score breakdown */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="bg-background-100 rounded-xl border border-foreground-200 p-4 text-center">
            <p className="text-2xl font-heading font-bold text-foreground-900">{correct}/{quizData.questions.length}</p>
            <p className="text-xs text-foreground-400 mt-0.5">Correct Answers</p>
          </div>
          <div className={`rounded-xl border p-4 text-center ${passed ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
            <p className={`text-2xl font-heading font-bold ${passed ? 'text-emerald-700' : 'text-amber-700'}`}>{score}%</p>
            <p className="text-xs text-foreground-400 mt-0.5">Score</p>
          </div>
          <div className="bg-background-100 rounded-xl border border-foreground-200 p-4 text-center">
            <p className="text-2xl font-heading font-bold text-foreground-900">{quizData.totalPoints}</p>
            <p className="text-xs text-foreground-400 mt-0.5">Max Points</p>
          </div>
        </div>

        {/* KSB Performance */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-foreground-700 mb-3">Performance by KSB</h3>
          <div className="space-y-2">
            {Object.entries(ksbStats).map(([ksb, stats]) => {
              const pct = Math.round((stats.correct / stats.total) * 100);
              return (
                <div key={ksb} className="flex items-center gap-3 bg-background-50 rounded-xl border border-foreground-200 p-3">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ksbColor(ksb)}`}>{ksb}</span>
                  <span className="text-xs text-foreground-500 flex-1">{stats.correct}/{stats.total} correct</span>
                  <div className="w-28 h-2 bg-background-200 rounded-full overflow-hidden shrink-0">
                    <div className={`h-full rounded-full transition-all duration-500 ${pct >= 70 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${pct}%` }}></div>
                  </div>
                  <span className={`text-xs font-semibold w-10 text-right ${pct >= 70 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl border border-foreground-200 text-sm font-medium text-foreground-500 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"
          >
            Close
          </button>
          {!passed && (
            <button
              onClick={onRetake}
              className="flex-1 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
            >
              <i className="ri-refresh-line"></i> Retake Assessment
            </button>
          )}
          {passed && (
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
            >
              <i className="ri-check-line"></i> Mark as Complete
            </button>
          )}
        </div>
      </div>

      {/* Right: Question Review */}
      <div className="lg:w-[320px] lg:border-l border-foreground-200 bg-background-50 p-6 lg:max-h-[600px] lg:overflow-y-auto">
        <h3 className="text-xs font-semibold text-foreground-700 uppercase tracking-wider mb-4">Question Review</h3>
        <div className="space-y-3">
          {quizData.questions.map((q, i) => {
            const userAns = answers[i];
            const isCorrect = userAns === q.correctIndex;
            return (
              <div key={q.id} className={`rounded-xl border p-4 ${
                isCorrect ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40'
              }`}>
                <div className="flex items-start gap-2.5 mb-2">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                    isCorrect ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
                  }`}>
                    {isCorrect ? <i className="ri-check-line"></i> : <i className="ri-close-line"></i>}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${ksbColor(q.ksbRef)}`}>{q.ksbRef}</span>
                      <span className="text-xs font-semibold text-foreground-600">Q{i + 1}</span>
                    </div>
                    <p className="text-xs text-foreground-700 leading-relaxed mb-1.5">{q.text}</p>
                    <div className="space-y-1">
                      {userAns !== null && !isCorrect && (
                        <div className="flex items-start gap-1.5 text-xs text-red-600">
                          <i className="ri-close-line text-[10px] mt-0.5 shrink-0"></i>
                          <span>Your answer: <strong>{q.options[userAns]}</strong></span>
                        </div>
                      )}
                      <div className="flex items-start gap-1.5 text-xs text-emerald-700">
                        <i className="ri-check-line text-[10px] mt-0.5 shrink-0"></i>
                        <span>Correct: <strong>{q.options[q.correctIndex]}</strong></span>
                      </div>
                    </div>
                    <p className="text-[10px] text-foreground-500 mt-1.5 italic leading-relaxed">{q.explanation}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}