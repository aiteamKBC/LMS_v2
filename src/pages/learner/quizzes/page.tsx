import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import {
  QUIZ_ITEMS,
  type QuizItem,
} from '@/mocks/quiz-data';
import { QuizModal, type QuizSession, type QuizResult } from '@/components/feature/QuizModal';
import { getQuestionsForQuiz } from '@/mocks/quiz-questions';
import { QuizSlidePanel } from './components/QuizSlidePanel';

const learnerNav = roleNavMap.learner;
const p = LEARNER_PROFILE;

/* ═══════════════════════════════════════════════════════════════
   DERIVED STATS
   ═══════════════════════════════════════════════════════════════ */
const passedQuizzes = QUIZ_ITEMS.filter(q => q.status === 'Passed');
const failedQuizzes = QUIZ_ITEMS.filter(q => q.status === 'Failed' || q.status === 'Retake Required');
const lockedQuizzes = QUIZ_ITEMS.filter(q => q.status === 'Locked');
const notStartedQuizzes = QUIZ_ITEMS.filter(q => q.status === 'Not Started');
const priorityQuiz = QUIZ_ITEMS.find(q => q.isPriority && q.status === 'Not Started') || QUIZ_ITEMS.find(q => q.isPriority);

const scoresWithData = QUIZ_ITEMS.filter(q => q.latestScore !== null);
const averageScore = scoresWithData.length > 0
  ? Math.round(scoresWithData.reduce((s, q) => s + (q.latestScore || 0), 0) / scoresWithData.length)
  : 0;

const highestScore = scoresWithData.length > 0
  ? Math.max(...scoresWithData.map(q => q.latestScore || 0))
  : 0;

const totalQuizzes = QUIZ_ITEMS.length;
const completedQuizzes = passedQuizzes.length;
const passRate = scoresWithData.length > 0
  ? Math.round((passedQuizzes.length / scoresWithData.length) * 100)
  : 0;

const quizStreak = passedQuizzes.length;

const totalPoints = QUIZ_ITEMS.reduce((s, q) => s + q.pointsValue, 0);
const earnedPoints = passedQuizzes.reduce((s, q) => s + q.pointsValue, 0);

const weeklyQuizzes = QUIZ_ITEMS.filter(q => q.quizType === 'weekly');
const monthlyQuizzes = QUIZ_ITEMS.filter(q => q.quizType === 'monthly');

const weeklyPassed = weeklyQuizzes.filter(q => q.status === 'Passed').length;
const weeklyTotal = weeklyQuizzes.length;
const weeklyPct = weeklyTotal > 0 ? Math.round((weeklyPassed / weeklyTotal) * 100) : 0;

const monthlyPassed = monthlyQuizzes.filter(q => q.status === 'Passed').length;
const monthlyTotal = monthlyQuizzes.length;
const monthlyPct = monthlyTotal > 0 ? Math.round((monthlyPassed / monthlyTotal) * 100) : 0;

/* ═══════════════════════════════════════════════════════════════
   DUE DATE HELPERS
   ═══════════════════════════════════════════════════════════════ */
function parseQuizDueDate(dateStr: string): Date | null {
  if (dateStr === 'TBC' || dateStr === 'As Required') return null;
  try {
    const parts = dateStr.split(' ');
    if (parts.length === 3) {
      const day = parseInt(parts[0]);
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = monthNames.indexOf(parts[1]);
      const year = parseInt(parts[2]);
      if (month !== -1 && !isNaN(day) && !isNaN(year)) {
        return new Date(year, month, day);
      }
    }
    return new Date(dateStr);
  } catch {
    return null;
  }
}

function getDaysUntil(date: Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getDueSoonQuizzes(): { quiz: QuizItem; days: number; urgency: 'critical' | 'urgent' | 'soon' | 'upcoming' }[] {
  const now = new Date();
  const items: { quiz: QuizItem; days: number; urgency: 'critical' | 'urgent' | 'soon' | 'upcoming' }[] = [];

  QUIZ_ITEMS.forEach(q => {
    if (q.status === 'Passed' || q.status === 'Locked') return;
    const date = parseQuizDueDate(q.dueDate);
    if (!date) return;
    const days = getDaysUntil(date);
    if (days > 14) return;
    const urgency: 'critical' | 'urgent' | 'soon' | 'upcoming' =
      days < 0 ? 'critical' : days <= 2 ? 'urgent' : days <= 5 ? 'soon' : 'upcoming';
    items.push({ quiz: q, days, urgency });
  });

  return items.sort((a, b) => a.days - b.days);
}

/* ═══════════════════════════════════════════════════════════════
   PAGE COMPONENT
   ═══════════════════════════════════════════════════════════════ */
export default function QuizzesPage() {
  const [activeSection, setActiveSection] = useState<'library' | 'history'>('library');
  const [activeQuizType, setActiveQuizType] = useState<'weekly' | 'monthly'>('weekly');
  const [quizSession, setQuizSession] = useState<QuizSession | null>(null);
  const [quizResults, setQuizResults] = useState<Record<string, QuizResult>>();
  const [previewQuiz, setPreviewQuiz] = useState<QuizItem | null>(null);
  const [selectedQuiz, setSelectedQuiz] = useState<QuizItem | null>(null);
  const [animReady, setAnimReady] = useState(false);
  const [dismissedNotifications, setDismissedNotifications] = useState<string[]>([]);

  const dueSoon = getDueSoonQuizzes().filter(d => !dismissedNotifications.includes(d.quiz.id));

  useEffect(() => {
    const t = setTimeout(() => setAnimReady(true), 100);
    return () => clearTimeout(t);
  }, []);

  const openQuiz = (quiz: QuizItem) => {
    const questions = getQuestionsForQuiz(quiz.id);
    if (questions.length === 0) return;
    const timeLimit = parseInt(quiz.timeLimit) * 60;
    setQuizSession({
      quizId: quiz.id,
      quizTitle: quiz.title,
      questions,
      passMark: quiz.passMark,
      timeLimit,
      ksbs: quiz.ksbs.map(k => ({ code: k.code, label: k.label, type: k.type })),
    });
  };

  const handleQuizComplete = (result: QuizResult) => {
    if (quizSession) {
      setQuizResults(prev => ({ ...prev, [quizSession.quizId]: result }));
    }
  };

  const currentTypeQuizzes = activeQuizType === 'weekly' ? weeklyQuizzes : monthlyQuizzes;

  return (
    <>
      {/* Quiz Modal */}
      <QuizModal
        session={quizSession}
        onClose={() => setQuizSession(null)}
        onComplete={handleQuizComplete}
      />
      {/* Preview Modal */}
      {previewQuiz && (
        <QuizPreviewModal quiz={previewQuiz} onClose={() => setPreviewQuiz(null)} />
      )}
      {/* Slide Panel */}
      {selectedQuiz && (
        <QuizSlidePanel
          quiz={selectedQuiz}
          onClose={() => setSelectedQuiz(null)}
          onStart={() => { setSelectedQuiz(null); openQuiz(selectedQuiz); }}
          onPreview={() => { setSelectedQuiz(null); setPreviewQuiz(selectedQuiz); }}
        />
      )}
      <WorkspaceShell
        role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
        pageTitle="Quizzes & Knowledge Checks" pageSubtitle="Track your knowledge, strengthen your KSB development and prepare for Gateway."
        userName={p.fullName} userRole={`${p.programme} Apprentice`}
      >
        <div className="p-4 md:p-6 space-y-5 md:space-y-6">

          {/* ══════════════════════════════════════════════════════
              HERO HEADER
              ══════════════════════════════════════════════════════ */}
          <div className="relative rounded-2xl overflow-hidden animate-in fade-in duration-300" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
              <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
            </div>

            <div className="relative p-6 md:p-8 flex flex-col lg:flex-row items-start lg:items-center gap-5 lg:gap-8">
              {/* Left: Icon + Title */}
              <div className="flex items-center gap-4 shrink-0">
                <span className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
                  <i className="ri-questionnaire-line text-white text-2xl"></i>
                </span>
                <div>
                  <h2 className="text-xl font-heading font-bold text-white">Quizzes &amp; Knowledge Checks</h2>
                  <p className="text-sm text-white/60">Assessment hub for your apprenticeship journey</p>
                </div>
              </div>

              {/* Right: Quick summary pills */}
              <div className="flex items-center gap-2 flex-wrap lg:ml-auto">
                <span className="text-xs text-white/70 bg-white/10 rounded-full px-3 py-1.5 whitespace-nowrap">
                  <i className="ri-check-double-line text-emerald-300 mr-1"></i>
                  {completedQuizzes} of {totalQuizzes - lockedQuizzes.length} passed
                </span>
                <span className="text-xs text-white/70 bg-white/10 rounded-full px-3 py-1.5 whitespace-nowrap">
                  <i className="ri-bar-chart-2-line text-primary-300 mr-1"></i>
                  Avg {averageScore}%
                </span>
                <span className="text-xs text-white/70 bg-white/10 rounded-full px-3 py-1.5 whitespace-nowrap">
                  <i className="ri-flashlight-line text-amber-300 mr-1"></i>
                  Streak {quizStreak}
                </span>
                <span className="text-xs text-white/70 bg-white/10 rounded-full px-3 py-1.5 whitespace-nowrap">
                  <i className="ri-coin-line text-secondary-300 mr-1"></i>
                  {earnedPoints} pts
                </span>
              </div>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════
              DUE SOON NOTIFICATIONS
              ══════════════════════════════════════════════════════ */}
          {dueSoon.length > 0 && (
            <section className="animate-in slide-in-from-top-2 duration-400">
              <div className="flex items-center gap-3 mb-3">
                <span className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                  <i className="ri-notification-3-line text-red-500 text-sm"></i>
                </span>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Upcoming Deadlines</h3>
                  <p className="text-xs text-foreground-400">{dueSoon.length} quiz{dueSoon.length > 1 ? 'zes' : ''} require attention</p>
                </div>
                <button
                  onClick={() => setDismissedNotifications(dueSoon.map(d => d.quiz.id))}
                  className="ml-auto text-xs text-foreground-400 hover:text-foreground-600 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  Dismiss all
                </button>
              </div>

              <div className="space-y-2">
                {dueSoon.map(({ quiz, days, urgency }) => {
                  const urgencyConfig = {
                    critical: { border: 'border-red-300/60', bg: 'bg-red-50/80', text: 'text-red-700', icon: 'ri-alarm-warning-line', iconColor: 'text-red-500', badge: 'bg-red-100 text-red-700', label: 'Overdue' },
                    urgent: { border: 'border-red-200/50', bg: 'bg-red-50/50', text: 'text-red-600', icon: 'ri-alarm-warning-line', iconColor: 'text-red-400', badge: 'bg-red-100 text-red-700', label: 'Due soon' },
                    soon: { border: 'border-amber-200/50', bg: 'bg-amber-50/50', text: 'text-amber-700', icon: 'ri-time-line', iconColor: 'text-amber-500', badge: 'bg-amber-100 text-amber-700', label: 'Due in ' + days + ' days' },
                    upcoming: { border: 'border-primary-200/50', bg: 'bg-primary-50/40', text: 'text-primary-700', icon: 'ri-calendar-event-line', iconColor: 'text-primary-500', badge: 'bg-primary-100 text-primary-700', label: 'Due in ' + days + ' days' },
                  }[urgency];

                  return (
                    <div
                      key={quiz.id}
                      className={`flex items-center gap-4 rounded-xl border ${urgencyConfig.border} ${urgencyConfig.bg} p-3.5 transition-smooth hover:bg-opacity-80`}
                    >
                      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${urgencyConfig.iconColor}`}>
                        <i className={`${urgencyConfig.icon} text-lg`}></i>
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className={`text-sm font-semibold ${urgencyConfig.text} truncate`}>{quiz.title}</p>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${urgencyConfig.badge}`}>
                            {urgencyConfig.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-foreground-400">
                          <span>{quiz.module}</span>
                          <span className="text-foreground-200">·</span>
                          <span>{quiz.questionCount} questions</span>
                          <span className="text-foreground-200">·</span>
                          <span>Pass {quiz.passMark}%</span>
                          <span className="text-foreground-200">·</span>
                          <span>{quiz.dueDate}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setDismissedNotifications(prev => [...prev, quiz.id])}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-500 hover:bg-background-100 transition-smooth cursor-pointer"
                        >
                          <i className="ri-close-line text-sm"></i>
                        </button>
                        <button
                          onClick={() => openQuiz(quiz)}
                          disabled={!getQuestionsForQuiz(quiz.id).length}
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <i className="ri-play-circle-line"></i>
                          Start
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ══════════════════════════════════════════════════════
              CURRENT PRIORITY QUIZ
              ══════════════════════════════════════════════════════ */}
          {priorityQuiz && (
            <section className="animate-in slide-in-from-bottom-4 duration-500 delay-200">
              <div className="flex items-center gap-3 mb-4">
                <span className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                  <i className="ri-alert-line text-red-500 text-sm"></i>
                </span>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Current Priority</h3>
                  <p className="text-xs text-foreground-400">{priorityQuiz.priorityLabel || 'Your next assessment'}</p>
                </div>
                {priorityQuiz.dueDate !== 'TBC' && (
                  <span className="ml-auto text-xs font-semibold text-red-600 bg-red-50 px-3 py-1 rounded-full whitespace-nowrap">
                    Due: {priorityQuiz.dueDate}
                  </span>
                )}
              </div>

              <div className="bg-background-50 rounded-xl border-2 border-red-200/50 overflow-hidden card-premium">
                <div className="h-1.5 bg-gradient-to-r from-red-400 via-red-500 to-primary-500"></div>

                <div className="p-5 md:p-6">
                  <div className="flex flex-col lg:flex-row gap-5">
                    {/* Left: Quiz details */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center">
                          <i className="ri-questionnaire-line text-primary-600"></i>
                        </span>
                        <h4 className="text-base font-heading font-bold text-foreground-900">{priorityQuiz.title}</h4>
                        <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full whitespace-nowrap">
                          {priorityQuiz.isPriority ? 'Priority' : 'Upcoming'}
                        </span>
                      </div>

                      <p className="text-sm text-foreground-500 leading-relaxed mb-4">{priorityQuiz.description}</p>

                      {/* Meta grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4">
                        <DetailChip label="Module" value={priorityQuiz.module} icon="ri-book-open-line" />
                        <DetailChip label="Questions" value={`${priorityQuiz.questionCount}`} icon="ri-list-check-3" />
                        <DetailChip label="Pass Mark" value={`${priorityQuiz.passMark}%`} icon="ri-checkbox-circle-line" />
                        <DetailChip label="Duration" value={priorityQuiz.timeLimit} icon="ri-time-line" />
                      </div>

                      {/* KSBs covered */}
                      <div>
                        <p className="text-xs font-medium text-foreground-400 mb-1.5 uppercase tracking-wide">KSBs Covered</p>
                        <div className="flex flex-wrap gap-1.5">
                          {priorityQuiz.ksbs.map(k => (
                            <span key={k.code} className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
                              k.type === 'Knowledge' ? 'bg-primary-50 text-primary-700 border border-primary-200/50' :
                              k.type === 'Skill' ? 'bg-accent-50 text-accent-700 border border-accent-200/50' :
                              'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                            }`}>
                              {k.code} &middot; {k.label.length > 40 ? k.label.slice(0, 40) + '...' : k.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Right: CTA */}
                    <div className="flex flex-row lg:flex-col gap-2 shrink-0 lg:w-[180px]">
                      <button
                        onClick={() => priorityQuiz && openQuiz(priorityQuiz)}
                        disabled={!getQuestionsForQuiz(priorityQuiz?.id || '').length}
                        className="flex-1 lg:flex-none inline-flex items-center justify-center gap-1.5 px-5 py-3 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <i className="ri-play-circle-line"></i> Start Quiz
                      </button>
                      <button
                        onClick={() => setPreviewQuiz(priorityQuiz)}
                        className="flex-1 lg:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-background-100 border border-foreground-200/60 text-foreground-600 rounded-lg text-sm font-medium hover:bg-background-200 transition-smooth whitespace-nowrap cursor-pointer"
                      >
                        <i className="ri-eye-line"></i> Preview
                      </button>
                      <Link
                        to="/learner/ksbs"
                        className="flex-1 lg:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-background-100 border border-foreground-200/60 text-foreground-600 rounded-lg text-sm font-medium hover:bg-background-200 transition-smooth whitespace-nowrap cursor-pointer"
                      >
                        <i className="ri-bar-chart-2-line"></i> View KSBs
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ══════════════════════════════════════════════════════
              QUIZ LIBRARY — Weekly & Monthly
              ══════════════════════════════════════════════════════ */}
          <section className="animate-in slide-in-from-bottom-2 duration-400 delay-300">
            {/* Section Header */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                  <i className="ri-stack-line text-primary-600 text-sm"></i>
                </span>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Weekly &amp; Monthly Quizzes</h3>
                  <p className="text-xs text-foreground-400">{totalQuizzes} quizzes across the programme</p>
                </div>
              </div>

              {/* Section tabs: Library / History */}
              <div className="flex items-center gap-1 p-1 bg-background-100 rounded-lg border border-foreground-200/60 sm:ml-auto">
                {[
                  { key: 'library', label: 'Library', icon: 'ri-stack-line' },
                  { key: 'history', label: 'History', icon: 'ri-history-line' },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveSection(tab.key as typeof activeSection)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap hover:scale-105 active:scale-95 ${
                      activeSection === tab.key
                        ? 'bg-background-50 text-foreground-900 shadow-sm border border-foreground-200 scale-105'
                        : 'text-foreground-400 hover:text-foreground-600'
                    }`}
                  >
                    <i className={`${tab.icon}`}></i> {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {activeSection === 'library' && (
              <>
                {/* Animated Progress Indicators */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  <ProgressRingCard
                    label="Weekly Progress"
                    subtitle={`${weeklyPassed} of ${weeklyTotal} quizzes passed`}
                    percentage={weeklyPct}
                    color="primary"
                    icon="ri-questionnaire-line"
                    animReady={animReady}
                  />
                  <ProgressRingCard
                    label="Monthly KSB Progress"
                    subtitle={`${monthlyPassed} of ${monthlyTotal} quizzes passed`}
                    percentage={monthlyPct}
                    color="accent"
                    icon="ri-award-line"
                    animReady={animReady}
                  />
                </div>

                {/* Weekly / Monthly Toggle */}
                <div className="flex items-center gap-2 mb-4">
                  <button
                    onClick={() => setActiveQuizType('weekly')}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap border ${
                      activeQuizType === 'weekly'
                        ? 'bg-primary-50 text-primary-700 border-primary-200/60'
                        : 'bg-background-50 text-foreground-500 border-foreground-200/60 hover:bg-background-100'
                    }`}
                  >
                    <i className="ri-questionnaire-line text-sm"></i>
                    Weekly ({weeklyQuizzes.length})
                  </button>
                  <button
                    onClick={() => setActiveQuizType('monthly')}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap border ${
                      activeQuizType === 'monthly'
                        ? 'bg-primary-50 text-primary-700 border-primary-200/60'
                        : 'bg-background-50 text-foreground-500 border-foreground-200/60 hover:bg-background-100'
                    }`}
                  >
                    <i className="ri-award-line text-sm"></i>
                    Monthly KSB ({monthlyQuizzes.length})
                  </button>
                </div>

                {/* Info banner */}
                <div className="mb-4 rounded-xl border border-primary-200/40 bg-primary-50/50 p-4">
                  <p className="text-sm text-primary-800">
                    {activeQuizType === 'weekly'
                      ? 'This weekly quiz helps you check your understanding and prepare for your monthly KSB progression quiz. It does not directly validate your KSB progression.'
                      : 'Your monthly quiz contributes to your KSB progression dashboard. Some KSB updates may require tutor approval or workplace evidence.'}
                  </p>
                </div>

                {/* Quiz Cards Grid */}
                <QuizCardsGrid
                  quizzes={currentTypeQuizzes}
                  onQuizClick={setSelectedQuiz}
                  onStartQuiz={openQuiz}
                  onPreviewQuiz={setPreviewQuiz}
                />
              </>
            )}

            {activeSection === 'history' && (
              <QuizHistorySection />
            )}
          </section>

        </div>
      </WorkspaceShell>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SUBCOMPONENTS
   ═══════════════════════════════════════════════════════════════ */

/* ── Progress Ring Card ── */
function ProgressRingCard({ label, subtitle, percentage, color, icon, animReady }: {
  label: string;
  subtitle: string;
  percentage: number;
  color: 'primary' | 'accent';
  icon: string;
  animReady: boolean;
}) {
  const radius = 40;
  const stroke = 6;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  const colorClass = color === 'primary' ? 'text-primary-500' : 'text-accent-500';
  const bgClass = color === 'primary' ? 'bg-primary-50' : 'bg-accent-50';
  const borderClass = color === 'primary' ? 'border-primary-200/50' : 'border-accent-200/50';

  return (
    <div className={`flex items-center gap-5 p-4 rounded-xl border ${borderClass} ${bgClass} bg-opacity-50`}>
      <div className="relative shrink-0" style={{ width: radius * 2, height: radius * 2 }}>
        <svg height={radius * 2} width={radius * 2} className="rotate-[-90deg]">
          <circle
            stroke="currentColor"
            fill="transparent"
            strokeWidth={stroke}
            strokeDasharray={circumference + ' ' + circumference}
            style={{ strokeDashoffset: 0 }}
            r={normalizedRadius}
            cx={radius}
            cy={radius}
            className="text-foreground-200"
          />
          <circle
            stroke="currentColor"
            fill="transparent"
            strokeWidth={stroke}
            strokeDasharray={circumference + ' ' + circumference}
            style={{
              strokeDashoffset: animReady ? strokeDashoffset : circumference,
              transition: 'stroke-dashoffset 1.5s ease-out',
            }}
            strokeLinecap="round"
            r={normalizedRadius}
            cx={radius}
            cy={radius}
            className={colorClass}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-base font-bold ${colorClass} tabular-nums`}>
            {animReady ? percentage : 0}%
          </span>
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <i className={`${icon} text-sm ${colorClass}`}></i>
          <p className="text-sm font-semibold text-foreground-900">{label}</p>
        </div>
        <p className="text-xs text-foreground-500">{subtitle}</p>
        <div className="mt-2 h-1.5 w-full max-w-[160px] bg-foreground-200/40 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${color === 'primary' ? 'bg-primary-500' : 'bg-accent-500'}`}
            style={{
              width: animReady ? `${percentage}%` : '0%',
              transition: 'width 1.5s ease-out',
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Detail Chip ── */
function DetailChip({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="bg-background-50 rounded-lg border border-foreground-200/60 p-2">
      <p className="text-[11px] text-foreground-400 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-foreground-900 flex items-center gap-1.5">
        <i className={`${icon} text-foreground-400 text-xs`}></i>{value}
      </p>
    </div>
  );
}

/* ── Quiz Preview Modal ── */
function QuizPreviewModal({ quiz, onClose }: { quiz: QuizItem; onClose: () => void }) {
  const [showingAnswers, setShowingAnswers] = useState(false);
  const questions = getQuestionsForQuiz(quiz.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-background-50 rounded-2xl border border-foreground-200/60 shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 p-5 border-b border-foreground-200/60">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
              <i className="ri-eye-line text-primary-600 text-lg"></i>
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-heading font-semibold text-foreground-900 truncate">{quiz.title}</h3>
              <p className="text-xs text-foreground-400">{questions.length} questions &middot; Preview mode</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowingAnswers(!showingAnswers)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                showingAnswers ? 'bg-primary-100 text-primary-700' : 'bg-background-100 text-foreground-500 hover:bg-background-200'
              }`}
            >
              <i className={`${showingAnswers ? 'ri-checkbox-circle-line' : 'ri-question-line'} text-xs`}></i>
              {showingAnswers ? 'Hide Answers' : 'Show Answers'}
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center text-foreground-400 hover:text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer"
            >
              <i className="ri-close-line text-lg"></i>
            </button>
          </div>
        </div>

        {/* Questions list */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {questions.length === 0 ? (
            <div className="text-center py-10">
              <span className="w-12 h-12 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-3">
                <i className="ri-file-list-3-line text-foreground-300 text-xl"></i>
              </span>
              <p className="text-sm font-medium text-foreground-500">No preview available</p>
              <p className="text-xs text-foreground-400 mt-1">Questions for this quiz are not yet loaded</p>
            </div>
          ) : (
            questions.map((q, i) => (
              <div key={q.id} className="bg-background-100 rounded-xl border border-foreground-200/40 p-4">
                <div className="flex items-start gap-3 mb-3">
                  <span className="w-7 h-7 rounded-lg bg-primary-100 flex items-center justify-center shrink-0 text-xs font-bold text-primary-700">
                    {i + 1}
                  </span>
                  <p className="text-sm font-medium text-foreground-900 leading-relaxed">{q.question}</p>
                </div>
                <div className="space-y-1.5 ml-10">
                  {q.options.map((opt, j) => (
                    <div
                      key={j}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-smooth ${
                        showingAnswers && j === q.correctAnswer
                          ? 'bg-emerald-50 border border-emerald-200/50 text-emerald-800'
                          : showingAnswers && j !== q.correctAnswer
                          ? 'bg-background-50 border border-foreground-200/30 text-foreground-400'
                          : 'bg-background-50 border border-foreground-200/30 text-foreground-600'
                      }`}
                    >
                      <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] font-bold shrink-0 ${
                        showingAnswers && j === q.correctAnswer
                          ? 'border-emerald-400 bg-emerald-100 text-emerald-700'
                          : 'border-foreground-200 bg-background-50 text-foreground-400'
                      }`}>
                        {String.fromCharCode(65 + j)}
                      </span>
                      <span className="flex-1">{opt}</span>
                      {showingAnswers && j === q.correctAnswer && (
                        <i className="ri-check-line text-emerald-600 text-sm shrink-0"></i>
                      )}
                    </div>
                  ))}
                </div>
                {showingAnswers && (
                  <div className="mt-3 ml-10 bg-primary-50 rounded-lg p-3 border border-primary-200/40">
                    <p className="text-xs font-semibold text-primary-700 mb-1">Explanation</p>
                    <p className="text-xs text-primary-800 leading-relaxed">{q.explanation}</p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-foreground-200/60">
          <span className="text-xs text-foreground-400">
            <i className="ri-information-line text-xs mr-1"></i>
            This is a preview only — no answers are recorded
          </span>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth whitespace-nowrap cursor-pointer"
          >
            <i className="ri-close-line"></i> Close Preview
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Quiz Cards Grid (Weekly / Monthly) ── */
function QuizCardsGrid({ quizzes, onQuizClick, onStartQuiz, onPreviewQuiz }: {
  quizzes: QuizItem[];
  onQuizClick: (quiz: QuizItem) => void;
  onStartQuiz: (quiz: QuizItem) => void;
  onPreviewQuiz: (quiz: QuizItem) => void;
}) {
  if (quizzes.length === 0) {
    return (
      <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-10 text-center">
        <span className="w-12 h-12 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-3">
          <i className="ri-inbox-line text-foreground-300 text-xl"></i>
        </span>
        <p className="text-sm font-medium text-foreground-500">No quizzes match this filter</p>
        <p className="text-xs text-foreground-400 mt-1">Try a different category</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {quizzes.map(quiz => {
        const hasQuestions = getQuestionsForQuiz(quiz.id).length > 0;
        const isLocked = quiz.status === 'Locked';
        const isPassed = quiz.status === 'Passed';
        const isFailed = quiz.status === 'Failed' || quiz.status === 'Retake Required';
        const isInProgress = quiz.status === 'In Progress';

        return (
          <div
            key={quiz.id}
            className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 hover:border-primary-200/60 hover:shadow-sm transition-all duration-200 cursor-pointer group"
            onClick={() => onQuizClick(quiz)}
          >
            {/* Header: Title + badge */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-foreground-900 leading-snug group-hover:text-primary-700 transition-colors">
                  {quiz.title}
                </h4>
                <p className="text-xs text-foreground-400 mt-0.5">{quiz.module} — {quiz.weekRef}</p>
              </div>
              <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 ${
                quiz.quizType === 'weekly'
                  ? 'bg-primary-50 text-primary-700 border border-primary-200/50'
                  : 'bg-accent-50 text-accent-700 border border-accent-200/50'
              }`}>
                {quiz.quizType === 'weekly' ? 'Weekly' : 'Monthly KSB'}
              </span>
            </div>

            {/* Metadata row */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-4">
              <div className="flex items-center gap-2 text-xs text-foreground-500">
                <i className="ri-questionnaire-line text-foreground-300"></i>
                {quiz.questionCount} questions
              </div>
              <div className="flex items-center gap-2 text-xs text-foreground-500">
                <i className="ri-calendar-line text-foreground-300"></i>
                Due {quiz.dueDate}
              </div>
              <div className="flex items-center gap-2 text-xs text-foreground-500">
                <i className="ri-checkbox-circle-line text-foreground-300"></i>
                Pass {quiz.passMark}%
              </div>
              <div className="flex items-center gap-2 text-xs text-foreground-500">
                <i className="ri-restart-line text-foreground-300"></i>
                Attempts: {quiz.attemptCount}
              </div>
            </div>

            {/* KSBs */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {quiz.ksbs.map(k => (
                <span key={k.code} className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap border ${
                  k.type === 'Knowledge' ? 'bg-primary-50 text-primary-700 border-primary-200/50' :
                  k.type === 'Skill' ? 'bg-accent-50 text-accent-700 border-accent-200/50' :
                  'bg-emerald-50 text-emerald-700 border-emerald-200/50'
                }`}>
                  {k.code}
                </span>
              ))}
            </div>

            {/* CTA Button */}
            <div className="flex items-center gap-2">
              {!isLocked && !isPassed && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartQuiz(quiz);
                  }}
                  disabled={!hasQuestions}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <i className="ri-play-circle-line"></i>
                  {isInProgress ? 'Continue' : isFailed ? 'Retake' : 'Start Quiz'}
                  <i className="ri-arrow-right-line text-xs"></i>
                </button>
              )}
              {isPassed && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onPreviewQuiz(quiz);
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-50 text-emerald-700 border border-emerald-200/50 rounded-lg text-sm font-semibold hover:bg-emerald-100 transition-smooth whitespace-nowrap cursor-pointer"
                >
                  <i className="ri-check-double-line"></i>
                  Passed
                </button>
              )}
              {isLocked && (
                <span className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-background-100 text-foreground-400 border border-foreground-200/60 rounded-lg text-sm font-medium whitespace-nowrap">
                  <i className="ri-lock-line"></i>
                  Locked
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPreviewQuiz(quiz);
                }}
                className="inline-flex items-center justify-center gap-1 px-3 py-2.5 bg-background-100 border border-foreground-200/60 text-foreground-500 rounded-lg text-sm hover:bg-background-200 transition-smooth cursor-pointer"
              >
                <i className="ri-eye-line"></i>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Quiz History Section ── */
function QuizHistorySection() {
  const quizzesWithHistory = QUIZ_ITEMS.filter(q => q.history.length > 0);

  if (quizzesWithHistory.length === 0) {
    return (
      <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-10 text-center">
        <span className="w-12 h-12 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-3">
          <i className="ri-history-line text-foreground-300 text-xl"></i>
        </span>
        <p className="text-sm font-medium text-foreground-500">No quiz history yet</p>
        <p className="text-xs text-foreground-400 mt-1">Complete your first quiz to see your history here</p>
      </div>
    );
  }

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-foreground-400/50">
              <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Quiz</th>
              <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Date</th>
              <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Score</th>
              <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Attempts</th>
              <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Status</th>
              <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">KSBs</th>
              <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Feedback</th>
            </tr>
          </thead>
          <tbody>
            {quizzesWithHistory.map(qz => (
              <tr key={qz.id} className="border-b border-foreground-300/50 hover:bg-background-50/50 transition-smooth">
                <td className="px-5 py-3">
                  <p className="text-sm font-medium text-foreground-900">{qz.title}</p>
                  <span className="text-xs text-foreground-400">{qz.module}</span>
                </td>
                <td className="px-5 py-3 text-sm text-foreground-500">{qz.history[0]?.date}</td>
                <td className="px-5 py-3">
                  {qz.latestScore !== null && (
                    <span className={`text-sm font-bold ${qz.status === 'Passed' ? 'text-emerald-600' : 'text-red-500'}`}>
                      {qz.latestScore}%
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-sm text-foreground-500">{qz.attemptCount}</td>
                <td className="px-5 py-3">
                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${
                    qz.status === 'Passed' ? 'bg-emerald-50 text-emerald-700' :
                    qz.status === 'Failed' ? 'bg-red-50 text-red-700' :
                    qz.status === 'Retake Required' ? 'bg-red-50 text-red-600' :
                    'bg-background-100 text-foreground-500'
                  }`}>
                    {qz.status === 'Passed' && <i className="ri-check-line text-[10px]"></i>}
                    {qz.status === 'Failed' && <i className="ri-close-line text-[10px]"></i>}
                    {qz.status === 'Retake Required' && <i className="ri-refresh-line text-[10px]"></i>}
                    {qz.status}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1">
                    {qz.ksbs.map(k => (
                      <span key={k.code} className="text-[10px] text-foreground-400 bg-background-100 border border-foreground-200/60 px-1 py-0.5 rounded whitespace-nowrap">
                        {k.code}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-5 py-3">
                  {qz.feedback ? (
                    <span className="text-xs text-emerald-600 flex items-center gap-1 cursor-pointer hover:text-emerald-700">
                      <i className="ri-chat-1-line text-xs"></i> View
                    </span>
                  ) : (
                    <span className="text-xs text-foreground-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}