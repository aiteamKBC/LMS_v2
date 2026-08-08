import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const tutorNav = roleNavMap.tutor;

interface QuizResult {
  id: string;
  quizTitle: string;
  module: string;
  cohort: string;
  date: string;
  learners: number;
  avgScore: number;
  passRate: number;
  highScore: number;
  lowScore: number;
  status: 'completed' | 'in-progress';
}

interface LearnerQuizScore {
  learner: string;
  score: number;
  grade: string;
  timeSpent: string;
  attempts: number;
  questionsCorrect: number;
  questionsTotal: number;
  submitted: string;
}

const QUIZ_RESULTS: QuizResult[] = [
  { id: 'qr-01', quizTitle: 'Business Communication — Week 1', module: 'Business Communication', cohort: 'Cohort A — BA', date: '5 Jun 2026', learners: 14, avgScore: 76, passRate: 86, highScore: 95, lowScore: 42, status: 'completed' },
  { id: 'qr-02', quizTitle: 'Written Communication Assessment', module: 'Business Communication', cohort: 'Cohort A — BA', date: '12 Jun 2026', learners: 10, avgScore: 68, passRate: 70, highScore: 88, lowScore: 35, status: 'in-progress' },
  { id: 'qr-03', quizTitle: 'Data Visualisation — Tableau Basics', module: 'Data Visualisation', cohort: 'Cohort B — DA', date: '3 Jun 2026', learners: 12, avgScore: 72, passRate: 75, highScore: 96, lowScore: 48, status: 'completed' },
  { id: 'qr-04', quizTitle: 'Segmentation & Targeting Test', module: 'Marketing Planning', cohort: 'Cohort C — ME', date: '1 Jun 2026', learners: 8, avgScore: 82, passRate: 88, highScore: 98, lowScore: 55, status: 'completed' },
  { id: 'qr-05', quizTitle: 'Business Admin Practice — Mid-Module', module: 'Business Admin Practice', cohort: 'Cohort A — BA', date: '8 Jun 2026', learners: 12, avgScore: 74, passRate: 83, highScore: 92, lowScore: 40, status: 'completed' },
];

const LEARNER_RESULTS: LearnerQuizScore[] = [
  { learner: 'Sarah Mitchell', score: 95, grade: 'Distinction', timeSpent: '18 min', attempts: 1, questionsCorrect: 19, questionsTotal: 20, submitted: '5 Jun 2026' },
  { learner: 'Emily Watson', score: 88, grade: 'Merit', timeSpent: '22 min', attempts: 1, questionsCorrect: 17, questionsTotal: 20, submitted: '5 Jun 2026' },
  { learner: 'Sophie Williams', score: 75, grade: 'Merit', timeSpent: '25 min', attempts: 2, questionsCorrect: 15, questionsTotal: 20, submitted: '5 Jun 2026' },
  { learner: 'David Chen', score: 92, grade: 'Distinction', timeSpent: '15 min', attempts: 1, questionsCorrect: 18, questionsTotal: 20, submitted: '5 Jun 2026' },
  { learner: 'Liam Foster', score: 68, grade: 'Pass', timeSpent: '30 min', attempts: 1, questionsCorrect: 13, questionsTotal: 20, submitted: '5 Jun 2026' },
  { learner: 'Aisha Patel', score: 55, grade: 'Pass', timeSpent: '28 min', attempts: 3, questionsCorrect: 11, questionsTotal: 20, submitted: '5 Jun 2026' },
  { learner: 'James Okonkwo', score: 42, grade: 'Refer', timeSpent: '20 min', attempts: 1, questionsCorrect: 8, questionsTotal: 20, submitted: '5 Jun 2026' },
  { learner: 'Maya Kapoor', score: 82, grade: 'Merit', timeSpent: '19 min', attempts: 2, questionsCorrect: 16, questionsTotal: 20, submitted: '5 Jun 2026' },
];

const gradeColors: Record<string, string> = {
  'Distinction': 'bg-accent-100 text-accent-700',
  'Merit': 'bg-primary-100 text-primary-700',
  'Pass': 'bg-emerald-100 text-emerald-700',
  'Refer': 'bg-red-100 text-red-700',
};

export default function QuizResultsPage() {
  const [selectedQuiz, setSelectedQuiz] = useState<QuizResult>(QUIZ_RESULTS[0]);
  const [view, setView] = useState<'overview' | 'learners' | 'analysis'>('overview');

  const quiz = selectedQuiz;
  const failRate = 100 - quiz.passRate;
  const range = quiz.highScore - quiz.lowScore;

  return (
    <WorkspaceShell role="tutor" roleLabel={tutorNav.label} navItems={tutorNav.items} workspaceLabel={tutorNav.workspaceLabel} pageTitle="Quiz Results" pageSubtitle="View quiz performance, learner scores and question-level analysis" userName="Rachel Myers" userRole="Business Admin Tutor">
      <div className="p-6 space-y-6">
        {/* Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><AppIcon className="ri-bar-chart-line text-white text-2xl"></AppIcon></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Quiz Results</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{QUIZ_RESULTS.length} quizzes</strong> recorded. Avg pass rate {Math.round(QUIZ_RESULTS.reduce((s, q) => s + q.passRate, 0) / QUIZ_RESULTS.length)}%. Monitor learner performance and identify gaps.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{QUIZ_RESULTS.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Quizzes</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{QUIZ_RESULTS.reduce((s, q) => s + q.learners, 0)}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Attempts</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{Math.round(QUIZ_RESULTS.reduce((s, q) => s + q.passRate, 0) / QUIZ_RESULTS.length)}%</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Pass Rate</p></div>
            </div>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Quiz List */}
          <div className="w-[320px] shrink-0 space-y-2">
            <h4 className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider px-1">Quizzes</h4>
            {QUIZ_RESULTS.map(q => (
              <button key={q.id} onClick={() => setSelectedQuiz(q)} className={`w-full text-left p-3 rounded-xl border transition-smooth cursor-pointer ${selectedQuiz.id === q.id ? 'border-primary-300 bg-primary-50/50' : 'border-foreground-200/60 bg-background-50 hover:bg-background-100/50'}`}>
                <p className="text-[12px] font-semibold text-foreground-900 mb-1">{q.quizTitle}</p>
                <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[10px]">
                  <span className="text-foreground-400">{q.module}</span>
                  <span className="text-[8px] text-foreground-300">&middot;</span>
                  <span className="text-foreground-400">{q.date}</span>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-[10px] font-semibold text-foreground-600">Avg: {q.avgScore}</span>
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{q.passRate}% pass</span>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${q.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{q.status}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Results Detail */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* Quiz Stats */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-heading font-bold text-foreground-900">{quiz.quizTitle}</h3>
                  <p className="text-[11px] text-foreground-400 mt-0.5">{quiz.module} · {quiz.cohort} · {quiz.date}</p>
                </div>
                <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
                  <button onClick={() => setView('overview')} className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${view === 'overview' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500'}`}>Overview</button>
                  <button onClick={() => setView('learners')} className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${view === 'learners' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500'}`}>Learners</button>
                  <button onClick={() => setView('analysis')} className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${view === 'analysis' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500'}`}>Analysis</button>
                </div>
              </div>

              {/* Overview */}
              {view === 'overview' && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
                    {[
                      { l: 'Avg Score', v: `${quiz.avgScore}%`, c: quiz.avgScore >= 70 ? 'text-emerald-600' : 'text-amber-600' },
                      { l: 'Pass Rate', v: `${quiz.passRate}%`, c: 'text-emerald-600' },
                      { l: 'Fail Rate', v: `${failRate}%`, c: failRate > 30 ? 'text-red-600' : 'text-foreground-600' },
                      { l: 'High Score', v: `${quiz.highScore}%`, c: 'text-accent-600' },
                      { l: 'Low Score', v: `${quiz.lowScore}%`, c: 'text-red-600' },
                      { l: 'Range', v: `${range}pp`, c: 'text-foreground-600' },
                    ].map(s => (
                      <div key={s.l} className="bg-background-100/50 rounded-lg p-3 text-center">
                        <p className={`text-lg font-bold ${s.c}`}>{s.v}</p>
                        <p className="text-[9px] text-foreground-400 uppercase tracking-wider">{s.l}</p>
                      </div>
                    ))}
                  </div>

                  {/* Score Distribution Bars */}
                  <div className="space-y-2">
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wider mb-2">Score Distribution</p>
                    {[
                      { label: 'Distinction (90-100%)', count: 2, total: quiz.learners, color: 'bg-accent-500' },
                      { label: 'Merit (70-89%)', count: 3, total: quiz.learners, color: 'bg-primary-500' },
                      { label: 'Pass (50-69%)', count: 6, total: quiz.learners, color: 'bg-emerald-500' },
                      { label: 'Refer (&lt;50%)', count: 3, total: quiz.learners, color: 'bg-red-500' },
                    ].map(b => (
                      <div key={b.label} className="flex items-center gap-3">
                        <span className="text-[11px] text-foreground-600 w-36 shrink-0">{b.label}</span>
                        <div className="flex-1 bg-background-200 rounded-full h-3">
                          <div className={`h-3 rounded-full ${b.color} transition-all duration-500`} style={{ width: `${(b.count / b.total) * 100}%` }}></div>
                        </div>
                        <span className="text-[11px] font-semibold text-foreground-700 w-8 text-right">{b.count}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Learners Tab */}
              {view === 'learners' && (
                <div className="bg-background-50 rounded-lg border border-background-200/30 overflow-hidden">
                  <div className="grid grid-cols-[2fr_1fr_1fr_0.8fr_0.8fr_0.8fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                    <span>Learner</span>
                    <span className="text-center">Score</span>
                    <span className="text-center">Grade</span>
                    <span className="text-center">Time</span>
                    <span className="text-center">Attempts</span>
                    <span className="text-center">Correct</span>
                  </div>
                  <div className="divide-y divide-background-200/30">
                    {LEARNER_RESULTS.map(l => (
                      <div key={l.learner} className="grid grid-cols-[2fr_1fr_1fr_0.8fr_0.8fr_0.8fr] gap-3 px-4 py-3 items-center hover:bg-background-100/30 transition-smooth">
                        <span className="text-[12px] font-medium text-foreground-900">{l.learner}</span>
                        <div className="flex items-center justify-center gap-1.5">
                          <div className="w-10 bg-background-200 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full ${l.score >= 70 ? 'bg-emerald-500' : l.score >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${l.score}%` }}></div>
                          </div>
                          <span className={`text-[11px] font-semibold ${l.score >= 70 ? 'text-emerald-600' : l.score >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{l.score}</span>
                        </div>
                        <div className="flex justify-center">
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${gradeColors[l.grade]}`}>{l.grade}</span>
                        </div>
                        <span className="text-[11px] text-foreground-400 text-center">{l.timeSpent}</span>
                        <span className="text-[11px] text-foreground-400 text-center">{l.attempts}</span>
                        <span className="text-[11px] text-foreground-400 text-center">{l.questionsCorrect}/{l.questionsTotal}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Analysis Tab */}
              {view === 'analysis' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Bar chart: Scores */}
                    <div className="bg-background-100/50 rounded-xl p-4">
                      <h4 className="text-[11px] font-semibold text-foreground-500 mb-3">Score Spread</h4>
                      <div className="flex items-end justify-between gap-1 h-32">
                        {LEARNER_RESULTS.map(l => (
                          <div key={l.learner} className="flex-1 flex flex-col items-center gap-1">
                            <span className={`text-[9px] font-semibold ${l.score >= 70 ? 'text-emerald-600' : l.score >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{l.score}</span>
                            <div className={`w-full rounded-t-md transition-all ${l.score >= 90 ? 'bg-accent-500' : l.score >= 70 ? 'bg-primary-500' : l.score >= 50 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ height: `${l.score}%` }}></div>
                            <span className="text-[7px] text-foreground-300 truncate w-full text-center">{l.learner.split(' ')[0]}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Pie-like: Grade distribution */}
                    <div className="bg-background-100/50 rounded-xl p-4">
                      <h4 className="text-[11px] font-semibold text-foreground-500 mb-3">Grade Distribution</h4>
                      <div className="space-y-2">
                        {[
                          { g: 'Distinction', c: LEARNER_RESULTS.filter(l => l.grade === 'Distinction').length, color: 'bg-accent-500' },
                          { g: 'Merit', c: LEARNER_RESULTS.filter(l => l.grade === 'Merit').length, color: 'bg-primary-500' },
                          { g: 'Pass', c: LEARNER_RESULTS.filter(l => l.grade === 'Pass').length, color: 'bg-emerald-500' },
                          { g: 'Refer', c: LEARNER_RESULTS.filter(l => l.grade === 'Refer').length, color: 'bg-red-500' },
                        ].map(d => (
                          <div key={d.g} className="flex items-center gap-2">
                            <span className="text-[10px] text-foreground-500 w-16">{d.g}</span>
                            <div className="flex-1 bg-background-200 rounded-full h-2.5">
                              <div className={`h-2.5 rounded-full ${d.color}`} style={{ width: `${(d.c / LEARNER_RESULTS.length) * 100}%` }}></div>
                            </div>
                            <span className="text-[10px] font-semibold text-foreground-600 w-4">{d.c}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Time vs Score scatter-like */}
                  <div className="bg-background-100/50 rounded-xl p-4">
                    <h4 className="text-[11px] font-semibold text-foreground-500 mb-3">Time Spent vs Score</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-left text-[9px] text-foreground-400 uppercase tracking-wider border-b border-foreground-300/50">
                            <th className="pb-2 font-semibold">Learner</th>
                            <th className="pb-2 font-semibold text-center">Score</th>
                            <th className="pb-2 font-semibold text-center">Time</th>
                            <th className="pb-2 font-semibold text-center">Attempts</th>
                            <th className="pb-2 font-semibold text-center">Efficiency</th>
                          </tr>
                        </thead>
                        <tbody>
                          {LEARNER_RESULTS.map(l => {
                            const timeNum = parseInt(l.timeSpent);
                            const efficiency = l.score / Math.max(timeNum, 1);
                            return (
                              <tr key={l.learner} className="border-b border-background-200/20">
                                <td className="py-2 text-foreground-700">{l.learner}</td>
                                <td className="py-2 text-center font-semibold">{l.score}</td>
                                <td className="py-2 text-center text-foreground-400">{l.timeSpent}</td>
                                <td className="py-2 text-center text-foreground-400">{l.attempts}</td>
                                <td className="py-2 text-center">
                                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${efficiency >= 4 ? 'bg-emerald-100 text-emerald-700' : efficiency >= 2.5 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{efficiency.toFixed(1)}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}