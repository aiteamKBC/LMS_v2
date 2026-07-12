import { useState, useMemo, useRef, useEffect } from 'react';
<<<<<<< HEAD
import { useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RealLearnerPlanView } from '@/components/feature/RealLearnerPlanView';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { useMyLearner } from '@/hooks/useMyLearner';
=======
import { useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE, QUIZ_1_DATA, READING_1_DATA, PODCAST_1_DATA } from '@/mocks/learner-profile';
import { TRAINING_ACTIVITIES, TRAINING_MONTH_GROUPS, ACTIVITY_TYPE_META, TrainingActivity, ActivityType, ActivityStatus, WeekGroup, MonthGroup } from '@/mocks/training-plan';
import { VideoPlayerModal } from '@/pages/learner/this-week/components/VideoPlayerModal';
import { QuizModal } from '@/pages/learner/this-week/components/QuizModal';
import { ReadingModal } from '@/pages/learner/this-week/components/ReadingModal';
import { ReadingPodcastModal } from '@/pages/learner/this-week/components/ReadingPodcastModal';
import { EvidenceLoggingModal } from '@/pages/learner/this-week/components/EvidenceLoggingModal';
import { useToast } from '@/hooks/useToast';
import ActivityPanel from './components/ActivityPanel';

const learnerNav = roleNavMap.learner;
const CURRENT_WEEK = 20;
const TOTAL_PROGRAMME_WEEKS = 60;



const p = LEARNER_PROFILE;

type FilterStatus = '' | ActivityStatus;

/* ═══════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════ */
export default function TrainingPlanPage() {
<<<<<<< HEAD
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const myLearner = useMyLearner();
  const kind = urlKind ?? myLearner?.kind;
  const id = urlId ?? myLearner?.id;
  const { isRealMode, real, loading, loadError } = useLearnerDetailParam(kind, id);
=======
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
  const { warning } = useToast();
  const [searchParams] = useSearchParams();
  const highlightParam = searchParams.get('highlight');

  const [selectedActivity, setSelectedActivity] = useState<TrainingActivity | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>(highlightParam === 'overdue' ? 'overdue' : '');
  const [filterType, setFilterType] = useState<ActivityType | ''>('');
  const [filterModule, setFilterModule] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterWeek, setFilterWeek] = useState('');

  const [videoActivity, setVideoActivity] = useState<TrainingActivity | null>(null);
  const [quizActivity, setQuizActivity] = useState<TrainingActivity | null>(null);
  const [readingActivity, setReadingActivity] = useState<TrainingActivity | null>(null);
  const [podcastActivity, setPodcastActivity] = useState<TrainingActivity | null>(null);
  const [evidenceActivity, setEvidenceActivity] = useState<TrainingActivity | null>(null);

  /* ── Refs for scrolling ── */
  const monthRefs = useRef<Record<string, HTMLDivElement | null>>({});

  /* ── Filter options ── */
  const monthOptions = useMemo(() => {
    return TRAINING_MONTH_GROUPS.map(mg => ({
      value: mg.monthKey,
      label: mg.label,
    }));
  }, []);

  const weekOptions = useMemo(() => {
    const allWeeks = Array.from(new Set(TRAINING_ACTIVITIES.map(a => a.globalWeek).filter(Boolean))).sort((a, b) => (a || 0) - (b || 0)) as number[];
    return allWeeks.map(w => ({ value: String(w), label: `Week ${w}` }));
  }, []);

  const statusOptions = [
    { value: '', label: 'All Status' },
    { value: 'In Progress', label: 'In Progress' },
    { value: 'Completed', label: 'Completed' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'Referred', label: 'Referred' },
    { value: 'Evidence Submitted', label: 'Evidence Submitted' },
    { value: 'Evidence Required', label: 'Evidence Required' },
    { value: 'Not Started', label: 'Not Started' },
  ];

  const typeOptions = useMemo(() => {
    const types = Array.from(new Set(TRAINING_ACTIVITIES.filter(a => !a.isSpecial).map(a => a.type)));
    return [{ value: '', label: 'All Types' }, ...types.map(t => ({ value: t, label: ACTIVITY_TYPE_META[t]?.label || t }))];
  }, []);

  /* ── Stats ── */
  const regularActivities = TRAINING_ACTIVITIES.filter(a => !a.isSpecial);
  const totalActivities = regularActivities.length;
  const completedCount = regularActivities.filter(a => a.status === 'Completed').length;
  const overdueCount = regularActivities.filter(a => a.status === 'overdue' || a.status === 'Referred').length;
  const inProgressCount = regularActivities.filter(a => a.status === 'In Progress' || a.status === 'Evidence Submitted' || a.status === 'Evidence Required').length;

  const overallPct = totalActivities > 0 ? Math.round((completedCount / totalActivities) * 100) : 0;

  useEffect(() => {
    if (highlightParam === 'overdue' && overdueCount > 0) {
      warning(`${overdueCount} ${overdueCount === 1 ? 'component is' : 'components are'} overdue`, 'Showing overdue items from your training plan');
    }
  }, [highlightParam, overdueCount, warning]);

  /* ── All weeks ── */
  const allWeeks = useMemo(() => {
    return TRAINING_MONTH_GROUPS.flatMap(mg =>
      mg.weekGroups.map(wg => ({
        ...wg,
        monthLabel: mg.label,
        monthKey: mg.monthKey,
        isCurrent: wg.activities.some(a => a.globalWeek === CURRENT_WEEK),
      }))
    );
  }, []);

  /* ── Filtering ── */
  const hasActiveFilters = !!(searchQuery || filterStatus || filterType || filterModule || filterMonth || filterWeek);

  /* ── Handlers ── */
  const handleActivityClick = (activity: TrainingActivity) => {
    const isActive = activity.status === 'Not Started' || activity.status === 'In Progress' || activity.status === 'Evidence Required' || activity.status === 'Evidence Submitted' || activity.status === 'Referred' || activity.status === 'overdue';
    if (activity.type === 'Video' && isActive) setVideoActivity(activity);
    else if (activity.type === 'Quiz' && isActive) setQuizActivity(activity);
    else if (activity.type === 'Reading' && isActive) setReadingActivity(activity);
    else if (activity.type === 'Podcast' && isActive) setPodcastActivity(activity);
    else if ((activity.type === 'Evidence' || activity.type === 'Reflection' || activity.type === 'Activity') && isActive) setEvidenceActivity(activity);
    else setSelectedActivity(activity);
  };



  /* ── Group weeks by month ── */
  const monthGroups = useMemo(() => {
    return TRAINING_MONTH_GROUPS.map(mg => {
      const filteredWeeks = hasActiveFilters
        ? mg.weekGroups.filter(wg =>
            wg.activities.some(a => {
              const ms = !searchQuery || a.title.toLowerCase().includes(searchQuery.toLowerCase());
              const mt = !filterType || a.type === filterType;
              let mst = true;
              if (filterStatus === 'overdue') mst = a.status === 'overdue' || a.status === 'Referred';
              else if (filterStatus) mst = a.status === filterStatus;
              const mmonth = !filterMonth || a.monthKey === filterMonth;
              const mweek = !filterWeek || String(a.globalWeek) === filterWeek;
              return ms && mt && mst && mmonth && mweek;
            })
          )
        : mg.weekGroups;

      return {
        monthKey: mg.monthKey,
        label: mg.label,
        weeks: filteredWeeks.map(wg => ({
          ...wg,
          monthLabel: mg.label,
          monthKey: mg.monthKey,
          isCurrent: wg.activities.some(a => a.globalWeek === CURRENT_WEEK),
        })),
      };
    }).filter(g => g.weeks.length > 0);
  }, [hasActiveFilters, searchQuery, filterType, filterStatus, filterMonth, filterWeek]);

<<<<<<< HEAD
  if (isRealMode) {
    return (
      <RealLearnerPlanView
        real={real}
        loading={loading}
        loadError={loadError}
        pageLabel="Training Plan"
        kind={kind}
        learnerId={id}
      />
    );
  }

=======
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Training Plan"
      pageSubtitle={`${p.programme} ${p.programmeLevel} · ${p.durationMonths}-month programme`}
      userName={p.fullName}
      userRole={`${p.programme} Apprentice`}
    >
      <div className="p-3 md:p-6 space-y-5">

        {/* ═══════════ HERO — DARK GRADIENT (matches modules) ═══════════ */}
        <section className="relative rounded-2xl overflow-hidden animate-in fade-in duration-300" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
          {/* Ambient glow blobs */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
            <div className="absolute animate-liquid-blob-3 opacity-10" style={{ width: '50%', height: '25%', left: '20%', bottom: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--primary-500) / 0.2) 0%, transparent 70%)', filter: 'blur(50px)' }} />
          </div>

          <div className="relative flex flex-col lg:flex-row items-stretch min-h-[170px]">
            {/* Left — title & programme */}
            <div className="flex-1 px-5 md:px-7 py-5 md:py-6 flex flex-col justify-center min-w-0">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <span className="text-xs font-semibold text-accent-300/80 uppercase tracking-wider bg-accent-400/10 px-2.5 py-1 rounded-md font-label border border-accent-400/15">
                  {p.programme} · {p.programmeLevel}
                </span>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  overallPct >= 70 ? 'bg-emerald-400/15 text-emerald-300 border border-emerald-400/20' :
                  overallPct >= 45 ? 'bg-amber-400/15 text-amber-300 border border-amber-400/20' :
                  'bg-red-400/15 text-red-300 border border-red-400/20'
                }`}>
                  {overallPct}% Complete
                </span>
              </div>
              <h1 className="text-lg md:text-xl font-heading font-bold text-white tracking-tight mb-1.5">Training Plan</h1>
              <p className="text-sm text-white/40 max-w-lg">{p.durationMonths}-month programme · {p.coach.name} (Coach) · Week {CURRENT_WEEK} of {TOTAL_PROGRAMME_WEEKS} · {completedCount} done, {inProgressCount} active</p>
            </div>

            {/* Right — completion donut */}
            <div className="lg:w-[200px] shrink-0 px-5 md:px-7 py-5 md:py-6 border-t lg:border-t-0 lg:border-l border-accent-400/10 flex items-center justify-center">
              <div className="relative flex flex-col items-center gap-2">
                <div className="relative">
                  <svg width="100" height="100" className="-rotate-90">
                    <circle cx="50" cy="50" r="42" fill="none" strokeWidth="8" stroke="rgba(255,255,255,0.1)" />
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      fill="none"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 42}
                      strokeDashoffset={2 * Math.PI * 42 - (Math.min(overallPct, 100) / 100) * (2 * Math.PI * 42)}
                      stroke={overallPct >= 70 ? '#10b981' : overallPct >= 45 ? '#f59e0b' : '#ef4444'}
                      className="transition-all duration-700 ease-out"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xl font-heading font-bold text-white">{overallPct}%</span>
                    <span className="text-[10px] text-white/50 font-medium">Complete</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-white/50">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400/80"></span>{completedCount}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400/80"></span>{inProgressCount}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400/80"></span>{overdueCount}</span>
                </div>
              </div>
            </div>
          </div>
        </section>





        {/* ═══════════ SEARCH + FILTERS ═══════════ */}
        <div className="rounded-2xl border border-background-300 bg-background-100/60 p-4 md:p-5 space-y-3">
          {/* Search bar + dropdowns row */}
          <div className="flex flex-col lg:flex-row gap-3">
            {/* Search input */}
            <div className="relative flex-1 min-w-0">
              <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                <i className="ri-search-line text-foreground-400 text-base"></i>
              </div>
              <input
                type="text"
                placeholder="Search activities, modules, or KSBs..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full h-11 pl-11 pr-10 text-sm bg-background-50 border border-background-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300 text-foreground-800 placeholder:text-foreground-400 transition-all duration-200"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 flex items-center pr-3"
                >
                  <div className="w-5 h-5 flex items-center justify-center rounded-md hover:bg-background-100 transition-colors cursor-pointer">
                    <i className="ri-close-line text-foreground-400 text-sm"></i>
                  </div>
                </button>
              )}
            </div>

            {/* Dropdowns */}
            <div className="flex flex-wrap items-center gap-2">
              <DropdownFilter
                label="Month"
                icon="ri-calendar-line"
                value={filterMonth}
                options={monthOptions}
                onChange={setFilterMonth}
              />
              <DropdownFilter
                label="Week"
                icon="ri-calendar-check-line"
                value={filterWeek}
                options={weekOptions}
                onChange={setFilterWeek}
              />
              <DropdownFilter
                label="Status"
                icon="ri-flag-line"
                value={filterStatus}
                options={statusOptions}
                onChange={(val) => setFilterStatus(val as FilterStatus)}
              />
              <DropdownFilter
                label="Type"
                icon="ri-stack-line"
                value={filterType}
                options={typeOptions}
                onChange={(val) => setFilterType(val as ActivityType | '')}
              />

              {/* Clear all */}
              {hasActiveFilters && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setFilterStatus('');
                    setFilterType('');
                    setFilterModule('');
                    setFilterMonth('');
                    setFilterWeek('');
                  }}
                  className="flex items-center gap-1.5 h-11 px-3 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-600 hover:bg-red-100 transition-all duration-200 cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-close-line text-[13px]"></i> Clear
                </button>
              )}
            </div>
          </div>

          {/* Active filter chips */}
          {hasActiveFilters && (
            <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-background-300">
              {searchQuery && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 bg-primary-100 text-primary-700 rounded-lg border border-primary-200">
                  <i className="ri-search-line text-[10px]"></i>
                  "{searchQuery}"
                  <button onClick={() => setSearchQuery('')} className="ml-1 w-4 h-4 flex items-center justify-center rounded hover:bg-primary-200 cursor-pointer">
                    <i className="ri-close-line text-[10px]"></i>
                  </button>
                </span>
              )}
              {filterMonth && (
                <FilterChip label={`Month: ${monthOptions.find(o => o.value === filterMonth)?.label || filterMonth}`} onRemove={() => setFilterMonth('')} />
              )}
              {filterWeek && (
                <FilterChip label={`Week: ${filterWeek}`} onRemove={() => setFilterWeek('')} />
              )}
              {filterStatus && (
                <FilterChip label={`Status: ${statusOptions.find(o => o.value === filterStatus)?.label || filterStatus}`} onRemove={() => setFilterStatus('')} />
              )}
              {filterType && (
                <FilterChip label={`Type: ${typeOptions.find(o => o.value === filterType)?.label || filterType}`} onRemove={() => setFilterType('')} />
              )}
              <p className="text-xs text-foreground-400 ml-1">Showing filtered results</p>
            </div>
          )}
        </div>

        {/* ═══════════ MONTH GROUPS — TIMELINE ═══════════ */}
        <div className="space-y-3">
          {monthGroups.map((monthGroup) => {
            const monthProgress = (() => {
              const allActs = monthGroup.weeks.flatMap(w => w.activities.filter(a => !a.isSpecial));
              const done = allActs.filter(a => a.status === 'Completed').length;
              return allActs.length > 0 ? Math.round((done / allActs.length) * 100) : 0;
            })();
            // Upcoming month = all weeks are after current week
            const isUpcoming = monthGroup.weeks.length > 0 && monthGroup.weeks.every(w => {
              const firstGlobalWeek = w.activities.find(a => a.globalWeek !== undefined)?.globalWeek;
              return firstGlobalWeek !== undefined && firstGlobalWeek > CURRENT_WEEK;
            });

            return (
              <div
                key={monthGroup.monthKey}
                ref={el => { monthRefs.current[monthGroup.monthKey] = el; }}
                className="transition-all"
              >
                <MonthSection
                  monthLabel={monthGroup.label}
                  monthKey={monthGroup.monthKey}
                  progress={monthProgress}
                  weeks={monthGroup.weeks}
                  searchQuery={searchQuery}
                  filterType={filterType}
                  filterStatus={filterStatus}
                  onActivityClick={handleActivityClick}
                  isUpcoming={isUpcoming}
                />
              </div>
            );
          })}
        </div>

        {/* ═══════════ EMPTY STATE ═══════════ */}
        {monthGroups.length === 0 && (
          <div className="py-20 text-center">
            <div className="w-16 h-16 flex items-center justify-center mx-auto bg-background-100 rounded-2xl mb-4">
              <i className="ri-search-line text-3xl text-foreground-400"></i>
            </div>
            <p className="text-base font-semibold text-foreground-600">No weeks match your filters</p>
            <p className="text-sm text-foreground-400 mt-1.5">Try adjusting your search or clearing filters</p>
          </div>
        )}
      </div>

      {/* ── Side Panel ── */}
      {selectedActivity && <ActivityPanel activity={selectedActivity} onClose={() => setSelectedActivity(null)} />}

      {/* ── Modals ── */}
      {videoActivity && <VideoPlayerModal isOpen={!!videoActivity} onClose={() => setVideoActivity(null)} onComplete={() => setVideoActivity(null)} title={videoActivity.title} type={videoActivity.type} typeIcon={videoActivity.typeIcon} duration={videoActivity.duration} ksbCodes={videoActivity.ksbs || []} ksbLabels={videoActivity.ksbLabels || ''} plannedOTJH={videoActivity.plannedOTJH} points={videoActivity.points} />}
      {quizActivity && <QuizModal isOpen={!!quizActivity} onClose={() => setQuizActivity(null)} onComplete={() => setQuizActivity(null)} quizData={QUIZ_1_DATA} />}
      {readingActivity && <ReadingModal isOpen={!!readingActivity} onClose={() => setReadingActivity(null)} readingData={READING_1_DATA} title={readingActivity.title} duration={readingActivity.duration} points={readingActivity.points} plannedOTJH={readingActivity.plannedOTJH} ksbCodes={readingActivity.ksbs || []} ksbLabels={readingActivity.ksbLabels || ''} onComplete={() => setReadingActivity(null)} />}
      {podcastActivity && <ReadingPodcastModal isOpen={!!podcastActivity} onClose={() => setPodcastActivity(null)} mode="podcast" podcastData={PODCAST_1_DATA} title={podcastActivity.title} duration={podcastActivity.duration} points={podcastActivity.points} plannedOTJH={podcastActivity.plannedOTJH} ksbCodes={podcastActivity.ksbs || []} ksbLabels={podcastActivity.ksbLabels || ''} onComplete={() => setPodcastActivity(null)} />}
      {evidenceActivity && <EvidenceLoggingModal isOpen={!!evidenceActivity} onClose={() => setEvidenceActivity(null)} onSubmit={() => setEvidenceActivity(null)} title={evidenceActivity.title} componentType={evidenceActivity.type} weekNumber={evidenceActivity.weekNumber} moduleName={evidenceActivity.month} ksbCodes={evidenceActivity.ksbs || []} ksbLabels={evidenceActivity.ksbLabels || ''} plannedOTJH={evidenceActivity.plannedOTJH} points={evidenceActivity.points} isReferred={evidenceActivity.status === 'Referred'} referralReason={evidenceActivity.referralReason || null} requiredActions={evidenceActivity.requiredActions || null} />}
    </WorkspaceShell>
  );
}



/* ═══════════════════════════════════════════════════════
   MONTH SECTION — group of weeks under one month
   ═══════════════════════════════════════════════════════ */
function MonthSection({
  monthLabel, monthKey, progress, weeks, searchQuery, filterType, filterStatus, onActivityClick, isUpcoming,
}: {
  monthLabel: string;
  monthKey: string;
  progress: number;
  weeks: (WeekGroup & { monthLabel: string; monthKey: string; isCurrent: boolean })[];
  searchQuery: string;
  filterType: string;
  filterStatus: string;
  onActivityClick: (a: TrainingActivity) => void;
  isUpcoming?: boolean;
}) {
  const isCurrentMonth = weeks.some(w => w.isCurrent);
  const [collapsed, setCollapsed] = useState(!isCurrentMonth);

  // Upcoming months are always locked
  const isLocked = isUpcoming === true;

  return (
    <div className={`rounded-2xl border transition-all overflow-hidden ${
      isLocked
        ? 'border-background-200/50 bg-background-50/60'
        : isCurrentMonth
        ? 'border-primary-300 bg-background-50'
        : 'border-background-300 bg-background-50'
    }`}>
      {/* Month Header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-3 px-5 py-3.5 transition-colors text-left cursor-pointer hover:bg-background-100/30"
      >
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
          isCurrentMonth ? 'bg-primary-100' : 'bg-background-100'
        }`}>
          <i className={`${isCurrentMonth ? 'ri-calendar-line text-primary-600' : 'ri-calendar-line text-foreground-600'} text-base`}></i>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-heading font-bold text-foreground-800">{monthLabel}</p>
            {isCurrentMonth && <span className="text-[10px] font-bold px-1.5 py-0.5 bg-primary-500 text-white rounded-full whitespace-nowrap">Current</span>}
          </div>
          <p className="text-[11px] text-foreground-400">{weeks.length} {weeks.length === 1 ? 'week' : 'weeks'}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-20 h-1.5 bg-background-200 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${progress >= 100 ? 'bg-emerald-500' : progress >= 50 ? 'bg-primary-500' : 'bg-foreground-300'}`} style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs font-semibold text-foreground-500 w-[32px] text-right">{progress}%</span>
          </div>
          <div className="w-7 h-7 flex items-center justify-center rounded-lg bg-background-100">
            <i className={`ri-arrow-down-s-line text-foreground-400 transition-transform text-sm ${collapsed ? '' : 'rotate-180'}`}></i>
          </div>
        </div>
      </button>

      {/* Month weeks */}
      {!collapsed && (
        <div className="border-t border-background-300">
          <div className="relative pl-10 md:pl-12 pr-4 md:pr-5 py-4">
            {/* Timeline vertical line */}
            <div className="absolute left-7 md:left-[34px] top-0 bottom-0 w-px bg-background-300" />

            <div className="space-y-2">
              {weeks.map((week) => {
                const weekNum = week.activities.find(a => a.globalWeek !== undefined)?.globalWeek || 0;
                const isCurrent = week.isCurrent;
                const allDone = week.completed >= week.total && week.total > 0;
                const hasOverdue = week.overdue > 0;
                const progressVal = week.total > 0 ? Math.round((week.completed / week.total) * 100) : 0;
                const defaultOpen = false;

                return (
                  <TimelineWeekCard
                    key={`${week.monthLabel}-w${week.weekNumber}`}
                    week={week}
                    weekNum={weekNum}
                    isCurrent={isCurrent}
                    allDone={allDone}
                    hasOverdue={hasOverdue}
                    progress={progressVal}
                    defaultOpen={defaultOpen}
                    searchQuery={searchQuery}
                    filterType={filterType}
                    filterStatus={filterStatus}
                    onActivityClick={onActivityClick}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   TIMELINE WEEK CARD
   ═══════════════════════════════════════════════════════ */
function TimelineWeekCard({
  week, weekNum, isCurrent, allDone, hasOverdue, progress, defaultOpen, searchQuery, filterType, filterStatus, onActivityClick,
}: {
  week: WeekGroup & { monthLabel: string; monthKey: string; isCurrent: boolean };
  weekNum: number;
  isCurrent: boolean;
  allDone: boolean;
  hasOverdue: boolean;
  progress: number;
  defaultOpen: boolean;
  searchQuery: string;
  filterType: string;
  filterStatus: string;
  onActivityClick: (a: TrainingActivity) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = `tw-${weekNum}`;

  const filteredActivities = week.activities.filter(a => {
    const ms = !searchQuery || a.title.toLowerCase().includes(searchQuery.toLowerCase());
    const mt = !filterType || a.type === filterType;
    let mst = true;
    if (filterStatus === 'overdue') mst = a.status === 'overdue' || a.status === 'Referred';
    else if (filterStatus) mst = a.status === filterStatus;
    return ms && mt && mst;
  });

  if (filteredActivities.length === 0 && (searchQuery || filterType || filterStatus)) return null;

  const regularActs = filteredActivities.filter(a => !a.isSpecial);
  const specialActs = filteredActivities.filter(a => a.isSpecial);

  // Minimalist dot styling - smaller, more professional
  const dotCls = allDone
    ? 'bg-emerald-400'
    : isCurrent
      ? 'bg-primary-500'
      : hasOverdue
        ? 'bg-red-400'
        : 'bg-background-300';

  const dotRing = allDone
    ? 'ring-emerald-100'
    : isCurrent
      ? 'ring-primary-100'
      : hasOverdue
        ? 'ring-red-100'
        : 'ring-background-100';

  const cardBorder = isCurrent ? 'border-primary-300' : allDone ? 'border-emerald-300' : hasOverdue ? 'border-red-300' : 'border-background-300';

  const pad = 'px-4 py-3';

  return (
    <div id={id} className="relative pl-6 md:pl-7">
      {/* Timeline dot — minimalist, smaller */}
      <div className={`absolute left-[-15px] md:left-[-16px] top-[19px] w-2 h-2 rounded-full ring-2 ${dotRing} ${dotCls} z-10 transition-colors`} />

      {/* Card */}
      <div className={`rounded-xl border ${cardBorder} bg-white transition-all duration-200 overflow-hidden`}>
        {/* Header */}
        <button
          onClick={() => setOpen(o => !o)}
          className={`w-full flex items-center gap-3 ${pad} cursor-pointer text-left hover:bg-background-50/80 transition-colors`}
        >
          {/* Week badge */}
          <span className={`shrink-0 w-9 h-9 text-xs rounded-lg flex items-center justify-center font-heading font-bold ${
            isCurrent ? 'bg-primary-500 text-white' : hasOverdue ? 'bg-red-100 text-red-700' : 'bg-background-100 text-foreground-400'
          }`}>
            {weekNum}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-heading font-bold text-foreground-800">Week {weekNum}</span>
              {isCurrent && <span className="text-[10px] font-bold px-1.5 py-0.5 bg-primary-500 text-white rounded-full">Current</span>}
              {hasOverdue && <span className="text-[10px] font-bold px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full">{week.overdue} overdue</span>}
            </div>
            <p className="text-xs text-foreground-400 mt-0.5">{week.weekStart} – {week.weekEnd}</p>
          </div>

          {/* Stats */}
          <div className="hidden sm:flex items-center gap-3 shrink-0">
            <span className={`text-xs font-semibold ${allDone ? 'text-emerald-600' : hasOverdue ? 'text-red-600' : 'text-foreground-500'}`}>
              {week.completed}/{week.total}
            </span>
            <div className="w-14 h-1.5 bg-background-200 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${allDone ? 'bg-emerald-500' : isCurrent ? 'bg-primary-500' : hasOverdue ? 'bg-red-400' : 'bg-foreground-300'}`} style={{ width: `${progress}%` }} />
            </div>
          </div>

          {/* Toggle icon */}
          <div className="flex items-center justify-center rounded-lg bg-background-100 shrink-0 w-6 h-6">
            <i className={`ri-arrow-down-s-line text-foreground-400 transition-transform ${open ? 'rotate-180' : ''} text-xs`}></i>
          </div>
        </button>

        {/* Expanded activities */}
        {open && (
          <div className="border-t border-background-300">
            {filteredActivities.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-foreground-400">No activities match your filters.</div>
            ) : (
              <div className="divide-y divide-background-300">
                {filteredActivities.map(a => (
                  <ActivityRow key={a.id} activity={a} onClick={() => onActivityClick(a)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Collapsed footer */}
        {!open && (
          <div className="border-t border-background-300 flex items-center gap-3 px-4 py-2.5 text-[11px] text-foreground-400 bg-background-100/50">
            <span>{regularActs.length + specialActs.length} components</span>
            {regularActs.filter(a => a.status === 'In Progress').length > 0 && (
              <><span>·</span><span className="text-accent-600 font-medium">{regularActs.filter(a => a.status === 'In Progress').length} active</span></>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ACTIVITY ROW
   ═══════════════════════════════════════════════════════ */
function ActivityRow({ activity, onClick }: { activity: TrainingActivity; onClick: () => void }) {
  const typeMeta = ACTIVITY_TYPE_META[activity.type] || ACTIVITY_TYPE_META['Evidence'];
  const isCompleted = activity.status === 'Completed';
  const isInProgress = activity.status === 'In Progress';
  const isReferred = activity.status === 'Referred';
  const isOverdue = activity.status === 'overdue';
  const isSpecial = activity.isSpecial || false;

  const pad = 'px-4 py-3';
  const iconBox = 'w-8 h-8';

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 ${pad} hover:bg-background-100/60 transition-colors cursor-pointer text-left group ${
        isSpecial ? 'bg-accent-50/30' : ''
      } ${isReferred || isOverdue ? 'bg-red-50/20' : ''}`}
    >
      {/* Type icon */}
      <div className={`${iconBox} rounded-lg flex items-center justify-center shrink-0 ${typeMeta.bg}`}>
        <i className={`${activity.typeIcon || typeMeta.icon} text-[13px] ${typeMeta.color}`}></i>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">{typeMeta.label}</span>
          {isOverdue && <span className="text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">Overdue</span>}
          {isReferred && <span className="text-[10px] font-bold text-red-700 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded-full">Referred</span>}
          {isCompleted && !isSpecial && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full"><i className="ri-check-line text-[9px] mr-0.5"></i>Done</span>}
          {isInProgress && <span className="text-[10px] font-bold text-accent-600 bg-accent-100 px-1.5 py-0.5 rounded-full">Active</span>}
          {activity.isLive && <span className="text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full animate-pulse">Live</span>}
        </div>
        <p className={`text-sm font-semibold leading-snug ${isCompleted && !isSpecial ? 'text-foreground-400 line-through' : 'text-foreground-900'} group-hover:text-primary-700 transition-colors`}>
          {activity.title}
        </p>
        {isSpecial && (
          <p className="text-[11px] text-accent-600 mt-0.5 font-medium">
            {activity.type === 'monthly-coaching' ? '1-to-1 Coaching Session' : 'Formal Progress Review'}
          </p>
        )}
        <div className="flex items-center gap-x-2.5 gap-y-1 text-[11px] text-foreground-400 mt-1 flex-wrap">
          <span className="flex items-center gap-1"><i className="ri-timer-line text-[10px]"></i>{activity.duration}</span>
          {activity.plannedOTJH > 0 && <span className="flex items-center gap-1"><i className="ri-time-line text-[10px]"></i>{activity.plannedOTJH}h</span>}
          <span className="flex items-center gap-1"><i className="ri-calendar-line text-[10px]"></i>{activity.dueDate}</span>
          {activity.points > 0 && <span className="flex items-center gap-1 text-amber-600"><i className="ri-coin-line text-[10px]"></i>{activity.points} pts</span>}
          {activity.ksbs && activity.ksbs.length > 0 && activity.ksbs.slice(0, 2).map(k => (
            <span key={k} className="text-[10px] px-1.5 py-0.5 font-medium bg-accent-100 text-accent-700 rounded">{k}</span>
          ))}
          {activity.ksbs && activity.ksbs.length > 2 && <span className="text-[10px] text-foreground-400">+{activity.ksbs.length - 2}</span>}
        </div>
      </div>

      {/* Status badge */}
      <span className={`shrink-0 text-[10px] px-2 py-0.5 font-semibold rounded-full ${
        isCompleted && !isSpecial ? 'bg-emerald-100 text-emerald-700' :
        isInProgress ? 'bg-accent-100 text-accent-700' :
        isReferred || isOverdue ? 'bg-red-100 text-red-700' :
        activity.status === 'Evidence Submitted' ? 'bg-amber-100 text-amber-700' :
        activity.status === 'Evidence Required' ? 'bg-amber-100 text-amber-700' :
        'bg-background-100 text-foreground-500'
      }`}>
        {isCompleted && !isSpecial ? 'Done' : isInProgress ? 'Active' : isReferred ? 'Referred' : isOverdue ? 'Overdue' : activity.status === 'Evidence Submitted' ? 'Submitted' : activity.status === 'Evidence Required' ? 'Evidence' : 'Pending'}
      </span>

      <i className="ri-arrow-right-s-line text-foreground-300 group-hover:text-primary-400 text-sm shrink-0 transition-colors"></i>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════
   DROPDOWN FILTER
   ═══════════════════════════════════════════════════════ */
function DropdownFilter({ label, icon, value, options, onChange }: {
  label: string;
  icon: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 h-11 px-3 rounded-xl border text-sm font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
          value
            ? 'bg-primary-50 border-primary-200 text-primary-700'
            : 'bg-background-50 border-background-200 text-foreground-600 hover:border-background-300 hover:bg-background-100'
        }`}
      >
        <i className={`${icon} text-base ${value ? 'text-primary-500' : 'text-foreground-400'}`}></i>
        <span>{selected ? selected.label : label}</span>
        <i className={`ri-arrow-down-s-line text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`}></i>
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-52 bg-background-50 border border-background-200/70 rounded-xl shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="max-h-60 overflow-y-auto py-1">
            {options.map(option => (
              <button
                key={option.value}
                onClick={() => { onChange(option.value === value ? '' : option.value); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-left ${
                  value === option.value
                    ? 'bg-primary-50 text-primary-700 font-medium'
                    : 'text-foreground-700 hover:bg-background-100'
                }`}
              >
                {value === option.value && (
                  <i className="ri-check-line text-primary-500 text-xs"></i>
                )}
                <span className={value === option.value ? 'ml-0' : 'ml-5'}>{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   FILTER CHIP
   ═══════════════════════════════════════════════════════ */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 bg-secondary-100 text-secondary-800 rounded-lg border border-secondary-200/50">
      {label}
      <button onClick={onRemove} className="w-4 h-4 flex items-center justify-center rounded hover:bg-secondary-200 cursor-pointer">
        <i className="ri-close-line text-[10px]"></i>
      </button>
    </span>
  );
}