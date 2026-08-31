// ============================================================================
// Monthly Cycle — what each learner did this month.
//
// Hierarchy, top to bottom: the month itself (header + navigator), the
// monthly coaching-delivery health (MCR/MCM, Progress Review, Catch-up,
// Support — booked vs completed vs cancelled vs needing a schedule), then the
// Learner Month Log itself, one card per learner, expandable into that
// learner's day-by-day timeline. A card's "Overview" opens the same data in a
// drawer with room for the full activity list and a PDF export.
//
// Data contract, unchanged from before this refactor:
//   GET /coach_api/coach/monthly-activity?month=YYYY-MM
//
// This component owns state, data fetching and every handler. Anything that
// renders lives in ./components; the pure data/formatting helpers and the PDF
// export live in ./lib.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { SearchInput } from '@/components/ui/FilterToolbar';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { cn } from '@/lib/cn';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';

import { CoachingDeliveryPanel } from './components/CoachingDeliveryPanel';
import { LearnerMonthCard } from './components/LearnerMonthCard';
import { LearnerOverviewPanel } from './components/LearnerOverviewPanel';
import { MonthHeroTiles } from './components/MonthHeroTiles';
import { MonthNavigator } from './components/MonthNavigator';
import { MonthlyCycleError, MonthlyCycleLoading, NoActiveLearners, NoLearnerMatches } from './components/MonthlyCycleStates';
import { COACHING_DELIVERY_CONFIG, COACHING_DELIVERY_ORDER, EMPTY_LEARNERS, EMPTY_SUMMARY, LEARNERS_PER_PAGE } from './lib/constants';
import {
  coachingDeliveryEventKey,
  coachingDeliveryFocusSource,
  coachingDeliveryKind,
  coachingDeliveryScheduleSource,
  coachingDeliveryScheduledTime,
  coachingDeliveryStatusKey,
  currentMonthKey,
  emptyCoachingDeliverySummary,
  formatMonthLabel,
  monthlyActivityEndpoint,
  normalizeSearch,
  readJson,
  shiftMonthKey,
} from './lib/monthly';
import { downloadLearnerMonthlyCyclePdf } from './lib/pdf';
import type {
  CoachingDeliveryItem,
  CoachingDeliverySummary,
  InlineActivityFilter,
  MonthlyActivityResponse,
  MonthlyLearnerActivity,
} from './types';

const coachNav = roleNavMap.coach;
const MONTHLY_ACTIVITY_TIMEOUT_MS = 20000;

export default function CoachMonthlyCycle() {
  const navigate = useNavigate();
  const coach = useCoachIdentity();
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [data, setData] = useState<MonthlyActivityResponse | null>(null);
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null);
  const [expandedLearnerIds, setExpandedLearnerIds] = useState<string[]>([]);
  const [learnerSearch, setLearnerSearch] = useState('');
  const [learnerPage, setLearnerPage] = useState(1);
  const [inlineFilter, setInlineFilter] = useState<InlineActivityFilter>('all');
  const [inlineSearch, setInlineSearch] = useState('');
  const [exportingLearnerId, setExportingLearnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!coach.isInitialized) return;
    if (!coach.email) {
      setData(null);
      setSelectedLearnerId(null);
      setExpandedLearnerIds([]);
      setError('Coach access is required to load monthly activity.');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let disposed = false;
    let timedOut = false;
    setLoading(true);
    setError('');

    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, MONTHLY_ACTIVITY_TIMEOUT_MS);

    coachFetch(monthlyActivityEndpoint(selectedMonth), { signal: controller.signal })
      .then(readJson<MonthlyActivityResponse>)
      .then((payload) => {
        if (disposed) return;
        setData(payload);
        setSelectedLearnerId((current) => {
          if (current && payload.learners.some((learner) => learner.id === current)) return current;
          return null;
        });
        setExpandedLearnerIds((current) => current.filter((id) => payload.learners.some((learner) => learner.id === id)));
      })
      .catch((requestError: unknown) => {
        if (disposed) return;
        if (requestError instanceof DOMException && requestError.name === 'AbortError' && !timedOut) return;
        setData(null);
        setSelectedLearnerId(null);
        setExpandedLearnerIds([]);
        setError(
          timedOut
            ? 'Monthly activity is taking too long to load. Please refresh or try a different month.'
            : requestError instanceof Error ? requestError.message : 'Unable to load monthly activity.',
        );
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [coach.email, coach.isInitialized, selectedMonth]);

  const summary = data?.summary || EMPTY_SUMMARY;
  const learners = data?.learners || EMPTY_LEARNERS;
  const monthLabel = data?.monthLabel || formatMonthLabel(selectedMonth);
  const filteredLearners = useMemo(() => {
    const query = normalizeSearch(learnerSearch);
    if (!query) return learners;
    return learners.filter((learner) => normalizeSearch(learner.name).includes(query));
  }, [learnerSearch, learners]);
  const totalLearnerPages = Math.max(1, Math.ceil(filteredLearners.length / LEARNERS_PER_PAGE));
  const visibleLearnerPage = Math.min(learnerPage, totalLearnerPages);
  const pageStartIndex = filteredLearners.length === 0 ? 0 : (visibleLearnerPage - 1) * LEARNERS_PER_PAGE;
  const pageEndIndex = Math.min(pageStartIndex + LEARNERS_PER_PAGE, filteredLearners.length);
  const paginatedLearners = useMemo(
    () => filteredLearners.slice(pageStartIndex, pageEndIndex),
    [filteredLearners, pageEndIndex, pageStartIndex],
  );
  const coachingDelivery = useMemo<CoachingDeliverySummary>(() => {
    const delivery = emptyCoachingDeliverySummary();

    learners.forEach((learner) => {
      learner.activities.forEach((activity) => {
        const kind = coachingDeliveryKind(activity);
        if (!kind) return;
        const config = COACHING_DELIVERY_CONFIG[kind];
        const status = coachingDeliveryStatusKey(activity);
        delivery.byKind[kind].counts[status] += 1;
        delivery.byKind[kind].items.push({
          id: `${learner.id}-${activity.id}`,
          eventKey: coachingDeliveryEventKey(activity.id),
          learnerId: learner.id,
          learnerName: learner.name,
          learnerStatus: learner.status,
          programme: learner.programme,
          cohort: learner.cohortName,
          group: learner.group,
          kind,
          label: config.shortLabel,
          title: activity.title,
          detail: activity.detail,
          date: activity.date,
          status,
          timeLabel: activity.timeLabel || activity.detail.split(' - ')[1]?.trim() || 'Time TBC',
        });
      });
    });

    COACHING_DELIVERY_ORDER.forEach((kind) => {
      delivery.byKind[kind].items.sort((a, b) => b.date.localeCompare(a.date));
    });

    return delivery;
  }, [learners]);
  const selectedLearner = useMemo(
    () => learners.find((learner) => learner.id === selectedLearnerId) || null,
    [learners, selectedLearnerId],
  );

  useEffect(() => {
    setLearnerPage(1);
    setExpandedLearnerIds([]);
    setInlineFilter('all');
    setInlineSearch('');
  }, [learnerSearch, selectedMonth]);

  useEffect(() => {
    setLearnerPage((page) => Math.min(page, totalLearnerPages));
  }, [totalLearnerPages]);

  const coachName = data?.owner?.name || coach.name;

  const handleExportLearnerPdf = (learner: MonthlyLearnerActivity) => {
    setExportingLearnerId(learner.id);
    window.setTimeout(() => {
      try {
        downloadLearnerMonthlyCyclePdf(learner, monthLabel, selectedMonth, coachName);
      } finally {
        setExportingLearnerId((current) => (current === learner.id ? null : current));
      }
    }, 0);
  };

  const handleOpenLearnerOverview = (learnerId: string) => {
    setSelectedLearnerId(learnerId);
  };

  const handleOpenCalendarItem = (item: CoachingDeliveryItem) => {
    const focusEvent = {
      source: coachingDeliveryFocusSource(item.kind),
      eventKey: item.eventKey,
      date: item.date,
      title: item.title,
      scheduledTime: coachingDeliveryScheduledTime(item.timeLabel),
      programme: item.programme,
      cohort: item.cohort,
      group: item.group,
    };
    const scheduleSource = item.status === 'needs-schedule'
      ? coachingDeliveryScheduleSource(item.kind)
      : null;

    navigate('/coach/timetable', {
      state: scheduleSource
        ? {
            scheduleIntent: {
              source: scheduleSource,
              learnerId: item.learnerId,
              targetDate: item.date,
              title: item.title,
            },
          }
        : { focusEvent },
    });
  };

  const handleCloseLearnerOverview = () => {
    setSelectedLearnerId(null);
  };

  const handleLearnerPageChange = (nextPage: number) => {
    const clampedPage = Math.max(1, Math.min(totalLearnerPages, nextPage));
    setLearnerPage(clampedPage);
    setExpandedLearnerIds([]);
    setInlineFilter('all');
    setInlineSearch('');
  };

  const handleToggleLearnerTimeline = (learnerId: string) => {
    setExpandedLearnerIds((current) => {
      if (current.includes(learnerId)) return current.filter((id) => id !== learnerId);
      if (current.length === 0) {
        setInlineFilter('all');
        setInlineSearch('');
      }
      return [...current, learnerId];
    });
  };

  return (
    <>
      <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Monthly Cycle" pageSubtitle="See what each learner did this month" userName={coachName} userRole="Progress Coach">
        <PageContainer>
          <PageHeader
            icon="ri-radar-line"
            title={`Monthly Cycle — ${monthLabel}`}
            description="Track every learner touchpoint this month: learning completions, coaching and reviews, evidence, KSBs, and OTJH logged."
            meta={(
              <MonthHeroTiles
                learners={summary.activeLearners}
                reviews={summary.coachingSessions}
              />
            )}
            actions={(
              <MonthNavigator
                value={selectedMonth}
                onShift={(offset) => setSelectedMonth((value) => shiftMonthKey(value, offset))}
                onChange={(value) => setSelectedMonth(value || currentMonthKey())}
              />
            )}
          />

          {!loading && !error && (
            <CoachingDeliveryPanel
              delivery={coachingDelivery}
              monthLabel={monthLabel}
              onOpenCalendarItem={handleOpenCalendarItem}
            />
          )}

          {loading && <MonthlyCycleLoading />}
          {!loading && error && <MonthlyCycleError message={error} />}

          {!loading && !error && (
            <div className="grid grid-cols-1 gap-5">
              <section className="space-y-4">
                <SectionHeader
                  title="Learner Month Log"
                  description="Each learner card shows the monthly cycle summary; use the arrow to open the detailed timeline."
                  actions={(
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full 2xl:w-auto">
                      <SearchInput
                        value={learnerSearch}
                        onChange={setLearnerSearch}
                        placeholder="Search learner name..."
                        ariaLabel="Search learner name"
                        className="w-full sm:w-80"
                      />
                      <span className="px-3 py-1 rounded-full bg-background-50 border border-foreground-200 text-[12px] font-semibold text-foreground-600 w-fit">
                        Showing {filteredLearners.length === 0 ? 0 : pageStartIndex + 1}-{pageEndIndex} of {filteredLearners.length}
                      </span>
                    </div>
                  )}
                />

                {learners.length === 0 && <NoActiveLearners />}

                {learners.length > 0 && filteredLearners.length === 0 && (
                  <NoLearnerMatches monthLabel={monthLabel} onClear={() => setLearnerSearch('')} />
                )}

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {paginatedLearners.map((learner) => {
                    const isExpanded = expandedLearnerIds.includes(learner.id);
                    return (
                      <div key={learner.id} className={cn(isExpanded && 'xl:col-span-2')}>
                        <LearnerMonthCard
                          learner={learner}
                          monthLabel={monthLabel}
                          monthKey={selectedMonth}
                          coachName={coachName}
                          selected={selectedLearnerId === learner.id}
                          expanded={isExpanded}
                          inlineFilter={inlineFilter}
                          inlineSearch={inlineSearch}
                          onOpenOverview={() => handleOpenLearnerOverview(learner.id)}
                          onOpenCaseFile={() => navigate(`/coach/learner-case-file?id=${encodeURIComponent(learner.id)}`, {
                            state: {
                              learnerId: learner.id,
                              learnerName: learner.name,
                              ...(learner.learnerType ? { kind: learner.learnerType } : {}),
                              ...(learner.enrolmentId ? { enrolmentId: learner.enrolmentId } : {}),
                            },
                          })}
                          onToggleTimeline={() => handleToggleLearnerTimeline(learner.id)}
                          onInlineFilterChange={setInlineFilter}
                          onInlineSearchChange={setInlineSearch}
                        />
                      </div>
                    );
                  })}
                </div>

                {filteredLearners.length > LEARNERS_PER_PAGE && (
                  <Pagination
                    page={visibleLearnerPage}
                    totalPages={totalLearnerPages}
                    total={filteredLearners.length}
                    pageSize={LEARNERS_PER_PAGE}
                    onPageChange={handleLearnerPageChange}
                    noun="learners"
                    className="rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm"
                  />
                )}
              </section>
            </div>
          )}
        </PageContainer>
      </WorkspaceShell>

      <RightSlidePanel
        isOpen={!!selectedLearner}
        onClose={handleCloseLearnerOverview}
        title={selectedLearner ? `${selectedLearner.name} Overview` : 'Learner Overview'}
        width="w-[620px]"
        coloredHeader
      >
        {selectedLearner && (
          <LearnerOverviewPanel
            learner={selectedLearner}
            monthLabel={monthLabel}
            coachName={coachName}
            isExporting={exportingLearnerId === selectedLearner.id}
            onExport={() => handleExportLearnerPdf(selectedLearner)}
          />
        )}
      </RightSlidePanel>
    </>
  );
}
