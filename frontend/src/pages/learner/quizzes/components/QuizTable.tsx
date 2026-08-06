import { useState } from 'react';
import type { QuizItem } from '@/mocks/quiz-data';

interface QuizTableProps {
  quizzes: QuizItem[];
  onQuizClick: (quiz: QuizItem) => void;
}

export function QuizTable({ quizzes, onQuizClick }: QuizTableProps) {
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  const statusMeta = (quiz: QuizItem) => {
    switch (quiz.status) {
      case 'Passed':
        return { dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Passed' };
      case 'Failed':
        return { dot: 'bg-red-500', bg: 'bg-red-50', text: 'text-red-700', label: 'Failed' };
      case 'Retake Required':
        return { dot: 'bg-red-400', bg: 'bg-red-50', text: 'text-red-600', label: 'Retake' };
      case 'In Progress':
        return { dot: 'bg-primary-500', bg: 'bg-primary-50', text: 'text-primary-700', label: 'In Progress' };
      case 'Locked':
        return { dot: 'bg-foreground-300', bg: 'bg-background-100', text: 'text-foreground-400', label: 'Locked' };
      case 'Not Started':
        if (quiz.isPriority) return { dot: 'bg-amber-500', bg: 'bg-amber-50', text: 'text-amber-700', label: quiz.priorityLabel || 'Priority' };
        return { dot: 'bg-foreground-300', bg: 'bg-background-50', text: 'text-foreground-500', label: 'Not Started' };
      default:
        return { dot: 'bg-foreground-300', bg: 'bg-background-50', text: 'text-foreground-500', label: quiz.status };
    }
  };

  const scoreColor = (score: number | null, status: string) => {
    if (score === null) return 'text-foreground-300';
    if (status === 'Passed') return 'text-emerald-600';
    if (status === 'Failed' || status === 'Retake Required') return 'text-red-500';
    return 'text-foreground-600';
  };

  const scoreBar = (score: number | null) => {
    if (score === null) return 'bg-background-200';
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 60) return 'bg-amber-500';
    return 'bg-red-500';
  };

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-foreground-200/60 bg-background-100/60">
              <th className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3 w-12">#</th>
              <th className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3">Quiz</th>
              <th className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3">Module</th>
              <th className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3">Week</th>
              <th className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3">KSBs</th>
              <th className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3">Status</th>
              <th className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3">Score</th>
              <th className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3">Due</th>
              <th className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {quizzes.map((quiz, index) => {
              const meta = statusMeta(quiz);
              return (
                <tr
                  key={quiz.id}
                  className="border-b border-foreground-200/40 cursor-pointer transition-all duration-150"
                  onClick={() => onQuizClick(quiz)}
                  onMouseEnter={() => setHoveredRow(quiz.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{
                    backgroundColor: hoveredRow === quiz.id ? 'oklch(var(--background-100))' : undefined,
                  }}
                >
                  <td className="px-4 py-3">
                    <span className="text-xs text-foreground-400 font-mono">{String(index + 1).padStart(2, '0')}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        quiz.status === 'Passed' ? 'bg-emerald-100' :
                        quiz.status === 'Failed' || quiz.status === 'Retake Required' ? 'bg-red-100' :
                        quiz.status === 'In Progress' ? 'bg-primary-100' :
                        quiz.isPriority ? 'bg-amber-100' :
                        'bg-background-100'
                      }`}>
                        <AppIcon className={`${
                          quiz.status === 'Passed' ? 'ri-check-double-line text-emerald-600' :
                          quiz.status === 'Failed' ? 'ri-close-circle-line text-red-500' :
                          quiz.status === 'Retake Required' ? 'ri-refresh-line text-red-400' :
                          quiz.status === 'Locked' ? 'ri-lock-line text-foreground-300' :
                          quiz.isPriority ? 'ri-alert-line text-amber-600' :
                          'ri-questionnaire-line text-foreground-400'
                        } text-sm`}></AppIcon>
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground-900 truncate">{quiz.title}</p>
                        <p className="text-[11px] text-foreground-400">{quiz.questionCount} Qs &middot; {quiz.timeLimit}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-foreground-500">{quiz.module}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-foreground-500">{quiz.weekRef}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {quiz.ksbs.slice(0, 3).map(k => (
                        <span key={k.code} className={`text-[10px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap ${
                          k.type === 'Knowledge' ? 'bg-primary-50 text-primary-700 border-primary-200/50' :
                          k.type === 'Skill' ? 'bg-accent-50 text-accent-700 border-accent-200/50' :
                          'bg-emerald-50 text-emerald-700 border-emerald-200/50'
                        }`}>
                          {k.code}
                        </span>
                      ))}
                      {quiz.ksbs.length > 3 && (
                        <span className="text-[10px] text-foreground-400 px-1 py-0.5">+{quiz.ksbs.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${meta.bg} ${meta.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`}></span>
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {quiz.latestScore !== null ? (
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-background-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${scoreBar(quiz.latestScore)}`} style={{ width: `${quiz.latestScore}%` }} />
                        </div>
                        <span className={`text-xs font-bold ${scoreColor(quiz.latestScore, quiz.status)}`}>{quiz.latestScore}%</span>
                      </div>
                    ) : (
                      <span className="text-xs text-foreground-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${quiz.status === 'Not Started' && quiz.dueDate !== 'TBC' ? 'text-foreground-500' : 'text-foreground-400'}`}>
                      {quiz.dueDate}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <AppIcon className="ri-arrow-right-s-line text-foreground-300"></AppIcon>
                  </td>
                </tr>
              );
            })}
            {quizzes.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center">
                  <span className="w-12 h-12 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-3">
                    <AppIcon className="ri-inbox-line text-foreground-300 text-xl"></AppIcon>
                  </span>
                  <p className="text-sm font-medium text-foreground-500">No quizzes match this filter</p>
                  <p className="text-xs text-foreground-400 mt-1">Try a different category</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}