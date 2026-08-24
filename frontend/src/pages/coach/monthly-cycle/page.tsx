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
import { CompactMetric } from '@/components/ui/MetricCard';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { SearchInput } from '@/components/ui/FilterToolbar';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';

import { CoachingDeliveryPanel } from './components/CoachingDeliveryPanel';
import { LearnerMonthCard } from './components/LearnerMonthCard';
import { LearnerOverviewPanel } from './components/LearnerOverviewPanel';
import { MonthNavigator } from './components/MonthNavigator';
import { MonthSidebar } from './components/MonthSidebar';
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
  formatNumber,
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

export default function CoachMonthlyCycle() {
  const navigate = useNavigate();
  const coach = useCoachIdentity();
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [data, setData] = useState<MonthlyActivityResponse | null>(null);
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null);
  const [expandedLearnerId, setExpandedLearnerId] = useState<string | null>(null);
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
      setExpandedLearnerId(null);
      setError('Coach access is required to load monthly activity.');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');

    coachFetch(monthlyActivityEndpoint(selectedMonth), { signal: controller.signal })
      .then(readJson<MonthlyActivityResponse>)
      .then((payload) => {
        setData(payload);
        setSelectedLearnerId((current) => {
          if (current && payload.learners.some((learner) => learner.id === current)) return current;
          return null;
        });
        setExpandedLearnerId((current) => {
          if (current && payload.learners.some((learner) => learner.id === current)) return current;
          return null;
        });
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setData(null);
        setSelectedLearnerId(null);
        setExpandedLearnerId(null);
        setError(requestError instanceof Error ? requestError.message : 'Unable to load monthly activity.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [coach.email, coach.isInitialized, selectedMonth]);

  const summary = data?.summary || EMPTY_SUMMARY;
  const learners = data?.learners || EMPTY_LEARNERS;
  const monthLabel = data?.monthLabel || formatMonthLabel(selectedMonth);
  const learnersNeedingAction = useMemo(
    () => learners.filter((learner) => learner.needsAction.length > 0),
    [learners],
  );
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
  const latestActivities = useMemo(
    () => learners
      .flatMap((learner) => learner.activities.map((activity) => ({ ...activity, learnerName: learner.name })))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6),
    [learners],
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
    setExpandedLearnerId(null);
    setInlineFilter('all');
    setInlineSearch('');
  }, [learnerSearch, selectedMonth]);

  useEffect(() => {
    setLearnerPage((page) => Math.min(page, totalLearnerPages));
  }, [totalLearnerPages]);

  const handleExportLearnerPdf = (learner: MonthlyLearnerActivity) => {
    setExportingLearnerId(learner.id);
    window.setTimeout(() => {
      try {
        downloadLearnerMonthlyCyclePdf(learner, monthLabel, selectedMonth);
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
    setExpandedLearnerId(null);
    setInlineFilter('all');
    setInlineSearch('');
  };

  const handleToggleLearnerTimeline = (learnerId: string) => {
    setExpandedLearnerId((current) => {
      const next = current === learnerId ? null : learnerId;
      if (next) {
        setInlineFilter('all');
        setInlineSearch('');
      }
      return next;
    });
  };

  return (
    <>
      <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Monthly Cycle" pageSubtitle="See what each learner did this month" userName={data?.owner?.name || coach.name} userRole="Progress Coach">
        <PageContainer>
          <PageHeader
            icon="ri-radar-line"
            title={`Monthly Cycle — ${monthLabel}`}
            description="Track every learner touchpoint this month: learning completions, coaching and reviews, evidence, KSBs, and OTJH logged."
            meta={(
              <>
                <CompactMetric label="Learners" value={formatNumber(summary.activeLearners)} />
                <CompactMetric label="Activities" value={formatNumber(summary.timelineItems)} />
                <span className="text-[12px] text-foreground-400">
                  Source: learner progress log, activity feed, and coach calendar for {monthLabel}.
                </span>
              </>
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
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
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

                {paginatedLearners.map((learner) => (
                  <LearnerMonthCard
                    key={learner.id}
                    learner={learner}
                    monthLabel={monthLabel}
                    monthKey={selectedMonth}
                    selected={selectedLearnerId === learner.id}
                    expanded={expandedLearnerId === learner.id}
                    inlineFilter={inlineFilter}
                    inlineSearch={inlineSearch}
                    onOpenOverview={() => handleOpenLearnerOverview(learner.id)}
                    onOpenCaseFile={() => navigate(`/coach/learner-case-file?id=${encodeURIComponent(learner.id)}`)}
                    onToggleTimeline={() => handleToggleLearnerTimeline(learner.id)}
                    onInlineFilterChange={setInlineFilter}
                    onInlineSearchChange={setInlineSearch}
                  />
                ))}

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

              <MonthSidebar
                summary={summary}
                learnersNeedingAction={learnersNeedingAction}
                latestActivities={latestActivities}
                monthLabel={monthLabel}
                onOpenLearner={handleOpenLearnerOverview}
              />
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
            isExporting={exportingLearnerId === selectedLearner.id}
            onExport={() => handleExportLearnerPdf(selectedLearner)}
          />
        )}
      </RightSlidePanel>
    </>
  );
}
