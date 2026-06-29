import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { QuizItem } from '@/mocks/quiz-data';
import { getQuestionsForQuiz } from '@/mocks/quiz-questions';

interface QuizSlidePanelProps {
  quiz: QuizItem | null;
  onClose: () => void;
  onStart: () => void;
  onPreview: () => void;
}

export function QuizSlidePanel({ quiz, onClose, onStart, onPreview }: QuizSlidePanelProps) {
  const [showingHistory, setShowingHistory] = useState(false);
  if (!quiz) return null;

  const hasQuestions = getQuestionsForQuiz(quiz.id).length > 0;
  const progress = quiz.history.length > 0 && quiz.attemptCount > 0
    ? Math.round((quiz.history.filter(h => h.passed).length / quiz.attemptCount) * 100)
    : 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />
      {/* Slide panel */}
      <div className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-lg bg-background-50 border-l border-foreground-200/60 flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 p-5 border-b border-foreground-200/60 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              quiz.status === 'Passed' ? 'bg-emerald-100' :
              quiz.status === 'Failed' || quiz.status === 'Retake Required' ? 'bg-red-100' :
              quiz.status === 'In Progress' ? 'bg-primary-100' :
              quiz.isPriority ? 'bg-amber-100' :
              'bg-background-100'
            }`}>
              <i className={`${
                quiz.status === 'Passed' ? 'ri-check-double-line text-emerald-600' :
                quiz.status === 'Failed' ? 'ri-close-circle-line text-red-500' :
                quiz.status === 'Retake Required' ? 'ri-refresh-line text-red-400' :
                quiz.status === 'Locked' ? 'ri-lock-line text-foreground-300' :
                quiz.isPriority ? 'ri-alert-line text-amber-600' :
                'ri-questionnaire-line text-foreground-400'
              } text-lg`}></i>
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-heading font-semibold text-foreground-900 truncate">{quiz.title}</h3>
              <p className="text-xs text-foreground-400">{quiz.module} &middot; {quiz.weekRef}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center text-foreground-400 hover:text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer shrink-0"
          >
            <i className="ri-close-line text-lg"></i>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Status bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${
              quiz.status === 'Passed' ? 'bg-emerald-50 text-emerald-700' :
              quiz.status === 'Failed' ? 'bg-red-50 text-red-700' :
              quiz.status === 'Retake Required' ? 'bg-red-50 text-red-600' :
              quiz.status === 'In Progress' ? 'bg-primary-50 text-primary-700' :
              quiz.isPriority ? 'bg-amber-50 text-amber-700' :
              'bg-background-100 text-foreground-500'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                quiz.status === 'Passed' ? 'bg-emerald-500' :
                quiz.status === 'Failed' ? 'bg-red-500' :
                quiz.status === 'Retake Required' ? 'bg-red-400' :
                quiz.status === 'In Progress' ? 'bg-primary-500' :
                quiz.isPriority ? 'bg-amber-500' :
                'bg-foreground-300'
              }`}></span>
              {quiz.status}
            </span>
            {quiz.isPriority && (
              <span className="text-[11px] font-semibold bg-amber-100 text-amber-700 px-2 py-1 rounded-full whitespace-nowrap">
                {quiz.priorityLabel}
              </span>
            )}
            {quiz.dueDate !== 'TBC' && (
              <span className="text-[11px] font-semibold text-foreground-500 bg-background-100 px-2 py-1 rounded-full whitespace-nowrap">
                <i className="ri-calendar-line text-[10px] mr-1"></i>Due {quiz.dueDate}
              </span>
            )}
          </div>

          {/* Description */}
          <p className="text-sm text-foreground-600 leading-relaxed">{quiz.description}</p>

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-background-100 rounded-lg border border-foreground-200/40 p-3">
              <p className="text-[11px] text-foreground-400 mb-0.5">Questions</p>
              <p className="text-sm font-semibold text-foreground-900">{quiz.questionCount}</p>
            </div>
            <div className="bg-background-100 rounded-lg border border-foreground-200/40 p-3">
              <p className="text-[11px] text-foreground-400 mb-0.5">Pass Mark</p>
              <p className="text-sm font-semibold text-foreground-900">{quiz.passMark}%</p>
            </div>
            <div className="bg-background-100 rounded-lg border border-foreground-200/40 p-3">
              <p className="text-[11px] text-foreground-400 mb-0.5">Duration</p>
              <p className="text-sm font-semibold text-foreground-900">{quiz.timeLimit}</p>
            </div>
            <div className="bg-background-100 rounded-lg border border-foreground-200/40 p-3">
              <p className="text-[11px] text-foreground-400 mb-0.5">Attempts</p>
              <p className="text-sm font-semibold text-foreground-900">{quiz.attemptCount}</p>
            </div>
          </div>

          {/* Score summary if available */}
          {quiz.latestScore !== null && (
            <div className="bg-background-100 rounded-lg border border-foreground-200/40 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-foreground-500">Performance</p>
                <span className={`text-sm font-bold ${quiz.status === 'Passed' ? 'text-emerald-600' : 'text-red-500'}`}>
                  {quiz.latestScore}%
                </span>
              </div>
              <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden mb-2">
                <div className={`h-full rounded-full ${quiz.status === 'Passed' ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${quiz.latestScore}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs text-foreground-400">
                <span>Best: {quiz.highestScore}%</span>
                <span>Pass: {quiz.passMark}%</span>
              </div>
            </div>
          )}

          {/* KSBs */}
          <div>
            <p className="text-xs font-semibold text-foreground-500 mb-2 uppercase tracking-wider">KSBs Assessed</p>
            <div className="flex flex-wrap gap-1.5">
              {quiz.ksbs.map(k => (
                <span key={k.code} className={`text-[11px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${
                  k.type === 'Knowledge' ? 'bg-primary-50 text-primary-700 border border-primary-200/50' :
                  k.type === 'Skill' ? 'bg-accent-50 text-accent-700 border border-accent-200/50' :
                  'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                }`}>
                  {k.code} &middot; {k.label}
                </span>
              ))}
            </div>
          </div>

          {/* Feedback */}
          {quiz.status === 'Passed' && quiz.feedback && (
            <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-200/50">
              <p className="text-xs font-semibold text-emerald-700 mb-1">Coach Feedback</p>
              <p className="text-sm text-emerald-800 leading-relaxed">{quiz.feedback}</p>
            </div>
          )}
          {(quiz.status === 'Failed' || quiz.status === 'Retake Required') && quiz.areasForImprovement && (
            <div className="bg-red-50 rounded-lg p-4 border border-red-200/50">
              <p className="text-xs font-semibold text-red-700 mb-1.5">Areas for Improvement</p>
              <ul className="space-y-1">
                {quiz.areasForImprovement.map((area, i) => (
                  <li key={i} className="text-xs text-red-800 flex items-start gap-1.5">
                    <i className="ri-arrow-right-s-line text-red-400 mt-0.5 shrink-0"></i>
                    {area}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Locked details */}
          {quiz.status === 'Locked' && quiz.unlockRequirement && (
            <div className="bg-background-100 rounded-lg border border-foreground-200/40 p-4">
              <p className="text-xs font-semibold text-foreground-500 mb-2">Unlock Requirements</p>
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <i className="ri-lock-line text-foreground-400 text-xs mt-0.5 shrink-0"></i>
                  <p className="text-sm text-foreground-700">{quiz.unlockRequirement}</p>
                </div>
                <div className="flex items-start gap-2">
                  <i className="ri-book-open-line text-foreground-400 text-xs mt-0.5 shrink-0"></i>
                  <p className="text-sm text-foreground-700">{quiz.unlockModule}</p>
                </div>
                <div className="flex items-start gap-2">
                  <i className="ri-calendar-line text-foreground-400 text-xs mt-0.5 shrink-0"></i>
                  <p className="text-sm text-foreground-700">Expected: {quiz.expectedUnlockDate}</p>
                </div>
              </div>
            </div>
          )}

          {/* Attempt history */}
          {quiz.history.length > 1 && (
            <div>
              <button
                onClick={() => setShowingHistory(!showingHistory)}
                className="flex items-center gap-2 text-xs font-semibold text-foreground-500 mb-2 hover:text-foreground-700 transition-smooth cursor-pointer"
              >
                <i className={`${showingHistory ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} text-sm`}></i>
                Attempt History ({quiz.history.length})
              </button>
              {showingHistory && (
                <div className="space-y-1">
                  {quiz.history.map((entry, i) => (
                    <div key={i} className="flex items-center gap-3 text-xs bg-background-100 rounded-md px-3 py-2 border border-foreground-200/40">
                      <span className="text-foreground-500 w-24 shrink-0">{entry.date}</span>
                      <span className={`font-semibold ${entry.passed ? 'text-emerald-600' : 'text-red-500'} w-10`}>{entry.score}%</span>
                      <span className="text-foreground-400">{entry.timeTaken}</span>
                      <span className={`ml-auto text-[11px] font-medium px-2 py-0.5 rounded-full ${entry.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {entry.passed ? 'Passed' : 'Failed'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer CTA */}
        <div className="shrink-0 p-5 border-t border-foreground-200/60 bg-background-50 space-y-2">
          {quiz.status === 'Not Started' && (
            <button
              onClick={onStart}
              disabled={!hasQuestions}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <i className="ri-play-circle-line"></i> Start Quiz
            </button>
          )}
          {quiz.status === 'In Progress' && (
            <button
              onClick={onStart}
              disabled={!hasQuestions}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <i className="ri-play-circle-line"></i> Continue Quiz
            </button>
          )}
          {(quiz.status === 'Failed' || quiz.status === 'Retake Required') && (
            <button
              onClick={onStart}
              disabled={!hasQuestions}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 transition-smooth whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <i className="ri-refresh-line"></i> Retake Quiz
            </button>
          )}
          {quiz.status === 'Passed' && (
            <button
              onClick={onPreview}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-background-100 border border-foreground-200/60 text-foreground-600 rounded-lg text-sm font-medium hover:bg-background-200 transition-smooth whitespace-nowrap cursor-pointer"
            >
              <i className="ri-eye-line"></i> View Feedback
            </button>
          )}
          <button
            onClick={onPreview}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-sm font-medium hover:bg-background-100 transition-smooth whitespace-nowrap cursor-pointer"
          >
            <i className="ri-eye-line"></i> Preview Questions
          </button>
          <Link
            to="/learner/ksbs"
            onClick={onClose}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-sm font-medium hover:bg-background-100 transition-smooth whitespace-nowrap cursor-pointer"
          >
            <i className="ri-bar-chart-2-line"></i> View KSBs
          </Link>
        </div>
      </div>
    </>
  );
}