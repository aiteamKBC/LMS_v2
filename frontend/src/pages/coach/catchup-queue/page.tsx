import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { AppIcon } from '@/components/feature/AppIcon';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import { cn } from '@/lib/cn';
import { statusTone, toneStyle } from '@/lib/statusTone';
import { type CatchUpItem } from '@/mocks/catchup-queue';
import { fetchCoachCalendarEvents } from '@/pages/coach/shared/calendarEvents';
import { LearnerAvatar, LearnerIdentity } from '@/pages/coach/shared/LearnerIdentity';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { MetricCard, CompactMetric, MetricRow } from '@/components/ui/MetricCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState, EmptyStateAction } from '@/components/ui/EmptyState';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { PageTabs, PageTabsBar, type PageTabItem } from '@/components/ui/PageTabs';
import { FilterToolbar, SearchInput, FilterSelect, FilterChip, ClearFiltersButton } from '@/components/ui/FilterToolbar';
import { Pagination } from '@/components/ui/Pagination';
import { Panel } from '@/components/ui/Panel';
import { DonutChart, Sparkline, StackedBarChart, StatusDistribution } from './components/charts';
import { calendarEventToCatchUp, buildCatchUpTrend } from './lib/trend';
import { exportCatchUpCsv, exportCatchUpPdf } from './lib/export';
import { priorityTone, titleCase } from './lib/tone';

const coachNav = roleNavMap.coach;

const PRIORITY_OPTIONS = [
  { value: 'all', label: 'All priorities' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

function optionsFrom(values: string[]): { value: string; label: string }[] {
  return values.map((value) => ({ value, label: value }));
}

export default function CoachCatchupQueue() {
  const navigate = useNavigate();
  const { success, info } = useToast();
  const coach = useCoachIdentity();

  const [filter, setFilter] = useState<'all' | 'scheduled' | 'overdue' | 'completed'>('all');
  const [cohortFilter, setCohortFilter] = useState<string>('all');
  const [programmeFilter, setProgrammeFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showEmployerDropdown, setShowEmployerDropdown] = useState(false);
  const [trendView, setTrendView] = useState<'week' | 'month'>('week');
  const [trendCount, setTrendCount] = useState<number>(12);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(12);
  const [statCardsReady, setStatCardsReady] = useState(false);
  const [chartAnimate, setChartAnimate] = useState(true);
  const [showEscalateModal, setShowEscalateModal] = useState(false);
  const [escalateReason, setEscalateReason] = useState('');
  const [escalateTo, setEscalateTo] = useState('');
  const [escalateSubmitted, setEscalateSubmitted] = useState(false);
  const [catchupQueue, setCatchupQueue] = useState<CatchUpItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setStatCardsReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!coach.isInitialized) return;
    if (!coach.email) {
      setCatchupQueue([]);
      setQueueError('Coach access is required to load catch-up sessions.');
      setQueueLoading(false);
      return;
    }
    const controller = new AbortController();
    setQueueLoading(true);
    setQueueError('');

    fetchCoachCalendarEvents(controller.signal)
      .then((data) => {
        const catchups = (data.events || [])
          .filter((event) => event.source === 'catch-up')
          .map(calendarEventToCatchUp);
        setCatchupQueue(catchups);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setCatchupQueue([]);
        setQueueError(requestError instanceof Error ? requestError.message : 'Could not load catch-up sessions.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setQueueLoading(false);
      });

    return () => controller.abort();
  }, [coach.email, coach.isInitialized]);

  const clearAllFilters = () => {
    setFilter('all');
    setCohortFilter('all');
    setProgrammeFilter('all');
    setPriorityFilter('all');
    setSearchQuery('');
    setCurrentPage(1);
  };

  const filtered = catchupQueue.filter((c) => {
    if (filter !== 'all' && c.status !== filter) return false;
    if (cohortFilter !== 'all' && c.cohort !== cohortFilter) return false;
    if (programmeFilter !== 'all' && c.programme !== programmeFilter) return false;
    if (priorityFilter !== 'all' && c.priority !== priorityFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        c.learner.toLowerCase().includes(q) ||
        c.initials.toLowerCase().includes(q) ||
        c.programme.toLowerCase().includes(q) ||
        c.cohort.toLowerCase().includes(q) ||
        c.missedSession.toLowerCase().includes(q) ||
        c.tutor.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const scheduled = catchupQueue.filter((c) => c.status === 'scheduled').length;
  const overdue = catchupQueue.filter((c) => c.status === 'overdue').length;
  const completed = catchupQueue.filter((c) => c.status === 'completed').length;
  const highPriority = catchupQueue.filter((c) => c.priority === 'high').length;
  const totalCatchups = catchupQueue.length;
  const overdueDays = catchupQueue.filter((c) => c.status === 'overdue').reduce((a, b) => a + b.daysOverdue, 0);

  const selectedItem = catchupQueue.find((c) => c.id === selectedItemId) || null;

  const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const cohorts = useMemo(() => [...new Set(catchupQueue.map((c) => c.cohort))].sort(), [catchupQueue]);
  const programmes = useMemo(() => [...new Set(catchupQueue.map((c) => c.programme))].sort(), [catchupQueue]);

  // Trend data
  const trendData = useMemo(() => {
    return buildCatchUpTrend(catchupQueue, trendView, trendCount);
  }, [catchupQueue, trendView, trendCount]);

  const maxCount = trendView === 'week' ? 52 : 12;
  const countLabel = trendView === 'week' ? 'Weeks' : 'Months';

  useEffect(() => {
    // re-trigger chart animation when trend data changes
    setChartAnimate(false);
    const t = setTimeout(() => setChartAnimate(true), 50);
    return () => clearTimeout(t);
  }, [trendData]);

  const handleExportCSV = () => {
    exportCatchUpCsv(filtered);
    success('CSV exported', `${filtered.length} rows exported successfully`);
  };

  const handleExportPDF = () => {
    info('PDF export', 'PDF generation started. Download will begin shortly.');
    setTimeout(() => {
      exportCatchUpPdf(filtered);
      success('PDF export', 'Report downloaded successfully');
    }, 800);
  };

  const handleViewProfile = (item: CatchUpItem) => {
    navigate(`/coach/learner-case-file?id=${item.id}`);
    success(`Opening profile`, item.learner);
  };

  const handleEmailEmployer = (item: CatchUpItem) => {
    window.open(`mailto:hr@${item.employer.toLowerCase().replace(/\s+/g, '')}.co.uk`, '_blank');
    setShowEmployerDropdown(false);
  };

  const handleZoomCall = () => {
    window.open('https://zoom.us/start/videomeeting', '_blank');
    setShowEmployerDropdown(false);
  };

  const handleOutlookCall = () => {
    window.open('https://outlook.office.com/calendar/deeplink/compose', '_blank');
    setShowEmployerDropdown(false);
  };

  const volumeTrend = trendData.map((item) => item.scheduled + item.overdue + item.completed);
  const trendUp = volumeTrend.length > 1 && volumeTrend[volumeTrend.length - 1] < volumeTrend[0];
  const percentageOfTotal = (value: number) => totalCatchups ? Math.round((value / totalCatchups) * 100) : 0;

  const hasActiveFilters = Boolean(
    filter !== 'all'
    || cohortFilter !== 'all'
    || programmeFilter !== 'all'
    || priorityFilter !== 'all'
    || searchQuery.trim(),
  );
  const hasChipFilters = Boolean(cohortFilter !== 'all' || programmeFilter !== 'all' || priorityFilter !== 'all');

  const statusTabs: PageTabItem[] = [
    { value: 'all', label: 'All', count: totalCatchups },
    { value: 'scheduled', label: 'Scheduled', count: scheduled, tone: 'info' },
    { value: 'overdue', label: 'Overdue', count: overdue, tone: 'critical' },
    { value: 'completed', label: 'Completed', count: completed, tone: 'positive' },
  ];

  const columns: DataColumn<CatchUpItem>[] = [
    {
      key: 'learner',
      label: 'Learner',
      widthClass: 'w-[240px] min-w-[220px]',
      render: (item) => (
        <LearnerIdentity
          name={item.learner}
          programme={`${item.cohort} · ${item.programme}`}
          tone={priorityTone(item.priority)}
        />
      ),
    },
    {
      key: 'missedSession',
      label: 'Missed Session',
      widthClass: 'w-[190px] min-w-[170px]',
      render: (item) => <span className="block max-w-[190px] truncate text-[13px] text-foreground-700">{item.missedSession}</span>,
    },
    {
      key: 'missedDate',
      label: 'Missed Date',
      widthClass: 'w-[130px]',
      render: (item) => <span className="whitespace-nowrap text-[13px] text-foreground-500">{item.missedDate}</span>,
    },
    {
      key: 'catchupDate',
      label: 'Catch-up Date',
      widthClass: 'w-[130px]',
      render: (item) => <span className="whitespace-nowrap text-[13px] text-foreground-500">{item.catchupDate}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      widthClass: 'w-[130px]',
      render: (item) => <StatusBadge tone={statusTone(item.status)} label={titleCase(item.status)} size="sm" />,
    },
    {
      key: 'priority',
      label: 'Priority',
      align: 'center',
      widthClass: 'w-[120px]',
      render: (item) => <StatusBadge tone={priorityTone(item.priority)} label={titleCase(item.priority)} size="sm" />,
    },
    {
      key: 'overdue',
      label: 'Overdue',
      align: 'center',
      widthClass: 'w-[90px]',
      render: (item) => (
        item.status === 'overdue'
          ? <span className="text-[13px] font-semibold text-red-600">{item.daysOverdue}d</span>
          : <span className="text-[13px] text-foreground-300">—</span>
      ),
    },
  ];

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Catch-up Queue" pageSubtitle="Manage and schedule catch-up sessions for missed learning" userName={coach.name} userRole="Progress Coach">
      <PageContainer>
        <PageHeader
          title="Catch-up Queue"
          description="Track missed sessions through to a scheduled or completed catch-up, and escalate the ones that are overdue."
          icon="ri-timer-line"
          actions={(
            <>
              <button
                type="button"
                onClick={handleExportCSV}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-foreground-200 bg-background-50 px-3.5 text-[12px] font-semibold text-foreground-700 shadow-sm transition hover:border-foreground-300"
              >
                <AppIcon className="ri-file-download-line"></AppIcon>
                Export CSV
              </button>
              <button
                type="button"
                onClick={handleExportPDF}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-foreground-200 bg-background-50 px-3.5 text-[12px] font-semibold text-foreground-700 shadow-sm transition hover:border-foreground-300"
              >
                <AppIcon className="ri-file-pdf-line"></AppIcon>
                Export PDF
              </button>
            </>
          )}
        />

        {/* ===== KPI summary: 4 primary cards, the rest as compact metrics ===== */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Total catch-ups"
            value={totalCatchups}
            icon="ri-timer-line"
            note={(
              <span className="flex items-center gap-2">
                <span className="h-7 w-16 shrink-0 overflow-hidden rounded-md bg-background-100">
                  <Sparkline data={volumeTrend.slice(-6)} color="primary" width={64} height={28} animate={statCardsReady} />
                </span>
                <span>{trendUp ? 'Trending down' : 'Trending up'}</span>
              </span>
            )}
          />
          <MetricCard
            label="Scheduled"
            value={scheduled}
            tone="info"
            icon="ri-calendar-check-line"
            note={`${percentageOfTotal(scheduled)}% of total`}
          />
          <MetricCard
            label="Overdue"
            value={overdue}
            tone="critical"
            icon="ri-error-warning-line"
            note={`${percentageOfTotal(overdue)}% of total · ${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue accumulated`}
          />
          <MetricCard
            label="Completed"
            value={completed}
            tone="positive"
            icon="ri-check-double-line"
            note={`${percentageOfTotal(completed)}% of total`}
          />
        </div>

        <MetricRow>
          <CompactMetric
            label="High priority"
            value={highPriority}
            tone="critical"
            note={`${percentageOfTotal(highPriority)}% of total`}
          />
          <CompactMetric
            label="Overdue days"
            value={overdueDays}
            tone="critical"
            note="Accumulated across overdue items"
          />
          <CompactMetric
            label="Volume trend"
            value={trendUp ? 'Improving' : 'Worsening'}
            tone={trendUp ? 'positive' : 'caution'}
            note={`Last ${Math.min(6, volumeTrend.length)} ${countLabel.toLowerCase()} vs the first`}
          />
        </MetricRow>

        {/* ===== Charts row ===== */}
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <Panel>
            <SectionHeader
              title="Catch-up volume trend"
              icon="ri-bar-chart-grouped-line"
              description="Scheduled, overdue, and completed sessions over time."
              actions={(
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1 rounded-lg bg-background-100 p-1">
                    <button
                      type="button"
                      onClick={() => setTrendView('week')}
                      className={cn(
                        'rounded-md px-3 py-1 text-[12px] font-semibold transition whitespace-nowrap',
                        trendView === 'week' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700',
                      )}
                    >
                      Week
                    </button>
                    <button
                      type="button"
                      onClick={() => setTrendView('month')}
                      className={cn(
                        'rounded-md px-3 py-1 text-[12px] font-semibold transition whitespace-nowrap',
                        trendView === 'month' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700',
                      )}
                    >
                      Month
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] text-foreground-400">Show</span>
                    <input
                      type="number"
                      min={1}
                      max={maxCount}
                      value={trendCount}
                      onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= maxCount) setTrendCount(v); }}
                      className="h-8 w-12 rounded-md border border-foreground-200 bg-background-50 px-1 text-center text-[12px] text-foreground-700 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50"
                    />
                    <span className="text-[12px] text-foreground-400">{countLabel}</span>
                  </div>
                </div>
              )}
            />
            <div className="mt-4 overflow-x-auto overflow-y-visible">
              <StackedBarChart data={trendData} height={260} animate={chartAnimate} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-emerald-500"></span>
                <span className="text-[12px] font-medium text-foreground-500">Completed</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-primary-500"></span>
                <span className="text-[12px] font-medium text-foreground-500">Scheduled</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-red-500"></span>
                <span className="text-[12px] font-medium text-foreground-500">Overdue</span>
              </span>
            </div>
          </Panel>

          <Panel className="flex flex-col items-center">
            <SectionHeader title="Status distribution" icon="ri-pie-chart-line" description="Current catch-up breakdown." className="self-start" />
            <div className="mt-4">
              <StatusDistribution scheduled={scheduled} overdue={overdue} completed={completed} size={180} animate={chartAnimate} />
            </div>
          </Panel>
        </div>

        {/* ===== Status tabs ===== */}
        <PageTabsBar>
          <PageTabs
            items={statusTabs}
            value={filter}
            onChange={(next) => { setFilter(next as typeof filter); setCurrentPage(1); }}
            label="Filter catch-ups by status"
          />
        </PageTabsBar>

        {/* ===== Search + filters ===== */}
        <FilterToolbar
          search={(
            <SearchInput
              value={searchQuery}
              onChange={(value) => { setSearchQuery(value); setCurrentPage(1); }}
              placeholder="Search learners, sessions, tutors…"
            />
          )}
          filters={(
            <>
              <FilterSelect
                value={cohortFilter}
                onChange={(value) => { setCohortFilter(value); setCurrentPage(1); }}
                options={[{ value: 'all', label: 'All cohorts' }, ...optionsFrom(cohorts)]}
                widthClass="w-[170px]"
                tone={cohortFilter !== 'all' ? 'active' : 'default'}
              />
              <FilterSelect
                value={programmeFilter}
                onChange={(value) => { setProgrammeFilter(value); setCurrentPage(1); }}
                options={[{ value: 'all', label: 'All programmes' }, ...optionsFrom(programmes)]}
                widthClass="w-[180px]"
                tone={programmeFilter !== 'all' ? 'active' : 'default'}
              />
              <FilterSelect
                value={priorityFilter}
                onChange={(value) => { setPriorityFilter(value); setCurrentPage(1); }}
                options={PRIORITY_OPTIONS}
                widthClass="w-[150px]"
                tone={priorityFilter !== 'all' ? 'active' : 'default'}
              />
            </>
          )}
          trailing={hasActiveFilters ? (
            <button
              type="button"
              onClick={clearAllFilters}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold text-foreground-500 transition hover:bg-background-100 hover:text-foreground-800"
            >
              <AppIcon className="ri-close-circle-line text-[13px]"></AppIcon>
              Clear filters
            </button>
          ) : undefined}
          chips={hasChipFilters ? (
            <>
              {cohortFilter !== 'all' && (
                <FilterChip label="Cohort" value={cohortFilter} onRemove={() => { setCohortFilter('all'); setCurrentPage(1); }} />
              )}
              {programmeFilter !== 'all' && (
                <FilterChip label="Programme" value={programmeFilter} onRemove={() => { setProgrammeFilter('all'); setCurrentPage(1); }} />
              )}
              {priorityFilter !== 'all' && (
                <FilterChip label="Priority" value={titleCase(priorityFilter)} onRemove={() => { setPriorityFilter('all'); setCurrentPage(1); }} />
              )}
              <ClearFiltersButton onClick={clearAllFilters} />
            </>
          ) : undefined}
        />

        {/* ===== Queue table ===== */}
        <section className="space-y-3">
          <SectionHeader title="Catch-up queue" count={filtered.length} icon="ri-list-check-2" />

          <Panel padding="none">
            <DataTable
              columns={columns}
              rows={paginated}
              rowKey={(row) => row.id}
              onRowClick={(row) => setSelectedItemId(selectedItemId === row.id ? null : row.id)}
              minWidthClass="min-w-[980px]"
              loading={queueLoading ? <RowsSkeleton rows={6} className="p-4" /> : undefined}
              empty={
                queueError ? (
                  <EmptyState variant="error" title="Could not load catch-up sessions" description={queueError} />
                ) : catchupQueue.length === 0 ? (
                  <EmptyState variant="empty" title="No catch-up sessions yet" description="Catch-up sessions will appear here once a missed session is scheduled for a learner." />
                ) : (
                  <EmptyState
                    variant="no-matches"
                    title="No catch-up items match your filters"
                    description="Try adjusting the filters, or clear them to see the full queue."
                    action={<EmptyStateAction label="Clear filters" icon="ri-close-circle-line" onClick={clearAllFilters} />}
                  />
                )
              }
              className="rounded-none border-0 shadow-none"
            />

            {!queueLoading && !queueError && filtered.length > 0 ? (
              <Pagination
                page={currentPage}
                totalPages={totalPages}
                total={filtered.length}
                pageSize={itemsPerPage}
                onPageChange={setCurrentPage}
                onPageSizeChange={(size) => { setItemsPerPage(size); setCurrentPage(1); }}
                noun="catch-ups"
              />
            ) : null}
          </Panel>
        </section>
      </PageContainer>

      {/* ═══════ Right Slide Panel ═══════ */}
      <RightSlidePanel isOpen={selectedItem !== null} onClose={() => { setSelectedItemId(null); setShowEmployerDropdown(false); }} title={selectedItem?.learner || 'Learner Detail'} width="w-[520px]">
        {selectedItem && (
          <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center gap-4">
              <LearnerAvatar name={selectedItem.learner} initials={selectedItem.initials} tone={priorityTone(selectedItem.priority)} size="lg" />
              <div>
                <div className="mb-0.5 flex flex-wrap items-center gap-2">
                  <StatusBadge tone={statusTone(selectedItem.status)} label={titleCase(selectedItem.status)} size="sm" />
                  <StatusBadge tone={priorityTone(selectedItem.priority)} label={`${titleCase(selectedItem.priority)} Priority`} size="sm" />
                </div>
                <p className="text-[12px] text-foreground-400">{selectedItem.programme} · {selectedItem.cohort}</p>
                <p className="mt-0.5 text-[12px] text-foreground-300">{selectedItem.employer} · {selectedItem.group}</p>
              </div>
            </div>

            {/* Status Alert */}
            {selectedItem.status === 'overdue' && (
              <div className={cn('rounded-xl border p-4', toneStyle('critical').bg, toneStyle('critical').border)}>
                <h4 className={cn('mb-2 flex items-center gap-1.5 text-[12px] font-semibold', toneStyle('critical').text)}>
                  <AppIcon className="ri-alert-line"></AppIcon> Overdue Alert
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-red-200/50 bg-red-100 px-2 py-1 text-[12px] font-medium text-red-700">{selectedItem.daysOverdue} days overdue</span>
                  <span className="rounded-full border border-red-200/50 bg-red-100 px-2 py-1 text-[12px] font-medium text-red-700">Missed: {selectedItem.missedDate}</span>
                  <span className="rounded-full border border-red-200/50 bg-red-100 px-2 py-1 text-[12px] font-medium text-red-700">Priority: {selectedItem.priority}</span>
                </div>
                <p className="mt-2 text-[12px] text-red-500">{selectedItem.notes}</p>
              </div>
            )}

            {/* Donut Charts */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-3 rounded-xl border border-foreground-200/60 bg-background-50 p-4">
                <DonutChart percentage={selectedItem.overallProgress} size={64} color="primary" />
                <div>
                  <p className="text-[12px] text-foreground-400">Overall Progress</p>
                  <p className="text-lg font-bold text-foreground-900">{selectedItem.overallProgress}%</p>
                  <p className="text-[12px] text-foreground-300">{selectedItem.overallProgress >= 70 ? 'On Track' : 'Needs Support'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-foreground-200/60 bg-background-50 p-4">
                <DonutChart percentage={selectedItem.attendance} size={64} color={selectedItem.attendance >= 90 ? 'emerald' : selectedItem.attendance >= 80 ? 'amber' : 'red'} />
                <div>
                  <p className="text-[12px] text-foreground-400">Attendance</p>
                  <p className="text-lg font-bold text-foreground-900">{selectedItem.attendance}%</p>
                  <p className="text-[12px] text-foreground-300">{selectedItem.attendance >= 90 ? 'Excellent' : selectedItem.attendance >= 80 ? 'Good' : 'At Risk'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-foreground-200/60 bg-background-50 p-4">
                <DonutChart percentage={Math.round((selectedItem.otjhCompleted / selectedItem.otjhTarget) * 100)} size={64} color={selectedItem.otjhCompleted / selectedItem.otjhTarget >= 0.7 ? 'emerald' : selectedItem.otjhCompleted / selectedItem.otjhTarget >= 0.4 ? 'amber' : 'red'} />
                <div>
                  <p className="text-[12px] text-foreground-400">OTJH</p>
                  <p className="text-lg font-bold text-foreground-900">{selectedItem.otjhCompleted}<span className="text-sm text-foreground-400">/{selectedItem.otjhTarget}</span></p>
                  <p className="text-[12px] text-foreground-300">{Math.round((selectedItem.otjhCompleted / selectedItem.otjhTarget) * 100)}% of target</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-foreground-200/60 bg-background-50 p-4">
                <DonutChart percentage={selectedItem.ksbProgress} size={64} color={selectedItem.ksbProgress >= 70 ? 'emerald' : selectedItem.ksbProgress >= 40 ? 'primary' : 'red'} />
                <div>
                  <p className="text-[12px] text-foreground-400">KSB Progress</p>
                  <p className="text-lg font-bold text-foreground-900">{selectedItem.ksbProgress}%</p>
                  <p className="text-[12px] text-foreground-300">{selectedItem.ksbProgress >= 70 ? 'On pace' : 'Needs Support'}</p>
                </div>
              </div>
            </div>

            {/* Details */}
            <div className="space-y-2.5">
              <div className="flex justify-between border-b border-foreground-100 py-2 text-[12px]">
                <span className="text-foreground-400">Missed Session</span>
                <span className="font-medium text-foreground-900">{selectedItem.missedSession}</span>
              </div>
              <div className="flex justify-between border-b border-foreground-100 py-2 text-[12px]">
                <span className="text-foreground-400">Missed Date</span>
                <span className="font-medium text-foreground-900">{selectedItem.missedDate}</span>
              </div>
              <div className="flex justify-between border-b border-foreground-100 py-2 text-[12px]">
                <span className="text-foreground-400">Catch-up Date</span>
                <span className="font-medium text-foreground-900">{selectedItem.catchupDate}</span>
              </div>
              <div className="flex justify-between border-b border-foreground-100 py-2 text-[12px]">
                <span className="text-foreground-400">Tutor</span>
                <span className="font-medium text-foreground-900">{selectedItem.tutor}</span>
              </div>
              <div className="flex justify-between border-b border-foreground-100 py-2 text-[12px]">
                <span className="text-foreground-400">Reason</span>
                <span className="font-medium text-foreground-900">{selectedItem.reason}</span>
              </div>
              <div className="flex justify-between border-b border-foreground-100 py-2 text-[12px]">
                <span className="text-foreground-400">Catch-up Route</span>
                <span className="font-medium text-foreground-900">{selectedItem.catchupRoute}</span>
              </div>
              <div className="flex justify-between border-b border-foreground-100 py-2 text-[12px]">
                <span className="text-foreground-400">Status</span>
                <span className={cn('font-medium', toneStyle(statusTone(selectedItem.status)).text)}>{selectedItem.status}</span>
              </div>
              <div className="flex justify-between border-b border-foreground-100 py-2 text-[12px]">
                <span className="text-foreground-400">Evidence</span>
                <span className={cn('font-medium', selectedItem.evidenceSubmitted ? 'text-emerald-600' : 'text-foreground-500')}>{selectedItem.evidenceSubmitted ? (selectedItem.evidenceApproved ? 'Submitted & Approved' : 'Submitted') : 'Not Submitted'}</span>
              </div>
              <div className="flex justify-between py-2 text-[12px]">
                <span className="text-foreground-400">Notes</span>
                <span className="font-medium text-foreground-900">{selectedItem.notes}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 pt-2">
              {/* Status-aware action button */}
              {selectedItem.status === 'overdue' && (
                <button onClick={() => { setShowEscalateModal(true); setEscalateSubmitted(false); setEscalateReason(''); setEscalateTo(''); }} className="flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-red-600 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-red-700">
                  <AppIcon className="ri-alert-line"></AppIcon> Escalate
                </button>
              )}
              {selectedItem.status === 'scheduled' && (
                <button onClick={() => { info(`1:1 Session started for ${selectedItem.learner}`, 'Redirecting to Zoom...'); window.open('https://zoom.us/start/videomeeting', '_blank'); }} className="flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-amber-600 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-amber-700">
                  <AppIcon className="ri-video-line"></AppIcon> Start 1:1 Session
                </button>
              )}

              <button onClick={() => handleViewProfile(selectedItem)} className="flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-foreground-200/60 bg-background-50 px-4 py-2.5 text-[13px] font-medium text-foreground-600 transition hover:bg-background-100">
                <AppIcon className="ri-file-chart-line"></AppIcon> View Full Profile
              </button>
              <div className="relative">
                <button onClick={() => setShowEmployerDropdown(!showEmployerDropdown)} className="flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-foreground-200/60 bg-background-50 px-4 py-2.5 text-[13px] font-medium text-foreground-600 transition hover:bg-background-100">
                  <AppIcon className="ri-building-2-line mr-1.5"></AppIcon> Contact Employer
                  <AppIcon className={cn('ri-arrow-down-s-line text-xs transition-transform', showEmployerDropdown && 'rotate-180')}></AppIcon>
                </button>
                {showEmployerDropdown && (
                  <div className="absolute bottom-full left-0 right-0 z-50 mb-1 overflow-hidden rounded-xl border border-background-200 bg-background-50 shadow-xl">
                    <button onClick={() => handleEmailEmployer(selectedItem)} className="flex w-full items-center gap-2.5 border-t border-background-200/30 px-4 py-2.5 text-left text-[12px] text-foreground-700 transition hover:bg-background-100">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-100 text-accent-600"><AppIcon className="ri-mail-send-line text-xs"></AppIcon></span>
                      <div><p className="font-medium">Email</p><p className="text-[12px] text-foreground-400">hr@{selectedItem.employer.toLowerCase().replace(/\s+/g, '')}.co.uk</p></div>
                    </button>
                    <button onClick={handleZoomCall} className="flex w-full items-center gap-2.5 border-t border-background-200/30 px-4 py-2.5 text-left text-[12px] text-foreground-700 transition hover:bg-background-100">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600"><AppIcon className="ri-video-line text-xs"></AppIcon></span>
                      <div><p className="font-medium">Call via Zoom</p><p className="text-[12px] text-foreground-400">Start video meeting</p></div>
                    </button>
                    <button onClick={handleOutlookCall} className="flex w-full items-center gap-2.5 border-t border-background-200/30 px-4 py-2.5 text-left text-[12px] text-foreground-700 transition hover:bg-background-100">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-600"><AppIcon className="ri-calendar-event-line text-xs"></AppIcon></span>
                      <div><p className="font-medium">Schedule via Outlook</p><p className="text-[12px] text-foreground-400">Book calendar meeting</p></div>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Escalate Modal */}
            {showEscalateModal && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowEscalateModal(false)}></div>
                <div className="relative w-full max-w-[420px] overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-2xl">
                  {!escalateSubmitted ? (
                    <>
                      <div className="border-b border-foreground-200/60 p-5">
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100">
                            <AppIcon className="ri-alert-line text-lg text-red-600"></AppIcon>
                          </span>
                          <div>
                            <h3 className="text-sm font-heading font-semibold text-foreground-900">Escalate Catch-up</h3>
                            <p className="text-[12px] text-foreground-400">{selectedItem.learner} — {selectedItem.missedSession}</p>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-4 p-5">
                        <div>
                          <label className="mb-1.5 block text-[12px] font-semibold text-foreground-700">Escalate to</label>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { value: 'engagement-team', label: 'Engagement Team', icon: 'ri-team-line' },
                              { value: 'leadership', label: 'Leadership', icon: 'ri-shield-star-line' },
                              { value: 'employer', label: 'Employer', icon: 'ri-building-2-line' },
                              { value: 'safeguarding', label: 'Safeguarding', icon: 'ri-shield-check-line' },
                            ].map((opt) => (
                              <button
                                key={opt.value}
                                onClick={() => setEscalateTo(opt.value)}
                                className={cn(
                                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition',
                                  escalateTo === opt.value
                                    ? 'border-red-300 bg-red-50 text-red-700'
                                    : 'border-foreground-200/60 text-foreground-600 hover:bg-background-100',
                                )}
                              >
                                <AppIcon className={cn(opt.icon, 'text-sm')}></AppIcon>
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[12px] font-semibold text-foreground-700">Reason for escalation</label>
                          <textarea
                            value={escalateReason}
                            onChange={(e) => setEscalateReason(e.target.value.slice(0, 500))}
                            placeholder="Explain why this catch-up needs escalation..."
                            rows={3}
                            className="w-full resize-none rounded-lg border border-foreground-200 bg-background-100 px-3 py-2 text-[13px] text-foreground-700 placeholder:text-foreground-400 focus:outline-none focus:border-red-300 focus:ring-1 focus:ring-red-300/50"
                          />
                          <div className="mt-1 flex justify-between">
                            <span className="text-[12px] text-foreground-400">{escalateReason.length}/500</span>
                            {escalateReason.length >= 500 && <span className="text-[12px] text-red-500">Maximum reached</span>}
                          </div>
                        </div>
                        <div className={cn('rounded-lg border p-3', toneStyle('critical').bg, toneStyle('critical').border)}>
                          <div className="flex items-start gap-2">
                            <AppIcon className="mt-0.5 ri-information-line text-sm text-red-500"></AppIcon>
                            <p className="text-[12px] leading-relaxed text-red-600">This will notify the selected team and add a flag to the learner's record. The escalation will be tracked in the system.</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 border-t border-foreground-200/60 p-5">
                        <button onClick={() => setShowEscalateModal(false)} className="flex-1 whitespace-nowrap rounded-lg bg-background-100 px-4 py-2.5 text-[13px] font-medium text-foreground-600 transition hover:bg-background-200">
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            if (!escalateTo) { info('Please select a team', 'Choose who to escalate to'); return; }
                            setEscalateSubmitted(true);
                            setTimeout(() => {
                              setShowEscalateModal(false);
                              success('Escalation sent', `${selectedItem.learner} escalated to ${escalateTo.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}`);
                            }, 1500);
                          }}
                          disabled={!escalateTo || !escalateReason.trim()}
                          className="flex-1 whitespace-nowrap rounded-lg bg-red-600 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Confirm Escalation
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center p-8 text-center">
                      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
                        <AppIcon className="ri-check-line text-2xl text-red-600"></AppIcon>
                      </div>
                      <h3 className="mb-1 text-sm font-heading font-semibold text-foreground-900">Escalation Sent</h3>
                      <p className="mb-4 text-[12px] text-foreground-500">{selectedItem.learner} has been escalated to {escalateTo.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}</p>
                      <p className="max-w-full truncate rounded-lg bg-background-100 px-3 py-2 text-[12px] text-foreground-400">"{escalateReason}"</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </RightSlidePanel>
    </WorkspaceShell>
  );
}
