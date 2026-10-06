import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { roleNavMap } from '@/mocks/navigation';
import {
  bookCoachCalendarEvent,
  formatDateLabel,
  formatTimeRangeLabel,
  isCompletedEvent,
  isEventInMonth,
  isInProgressEvent,
  isScheduledEvent,
  meetingUrl,
} from '@/pages/coach/shared/calendarEvents';
import { LearnerIdentity } from '@/pages/coach/shared/LearnerIdentity';
import { AppIcon } from '@/components/feature/AppIcon';
import { PageContainer } from '@/components/ui/PageContainer';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { Panel } from '@/components/ui/Panel';
import { useCatchUpQueue } from '@/features/coach/meetings/catch-up/hooks/useCatchUpQueue';
import type { CatchUpRequestRow } from '@/features/coach/meetings/catch-up/types/catchUp.types';
import { MeetingsHero } from '../monthly-coaching/components/MeetingsHero';
import { MiniCalendar } from '../monthly-coaching/components/MiniCalendar';
import { MonthlyStatsCard } from '../monthly-coaching/components/MonthlyStatsCard';
import { MeetingStatusPill, StatusTabs, type StatusTabItem } from '../monthly-coaching/components/StatusTabs';
import { formatMonthYear, getStatusCounts, type MeetingStatusKey } from '../monthly-coaching/meetingsView';

const coachNav = roleNavMap.coach;

// Booked catch-ups are only ever scheduled, in progress or completed.
type CatchUpFilter = 'all' | 'scheduled' | 'in-progress' | 'completed';
const CATCH_UP_STATUSES: MeetingStatusKey[] = ['scheduled', 'in-progress', 'completed'];

function startOfMonth(value = new Date()) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function addMonths(value: Date, offset: number) {
  return new Date(value.getFullYear(), value.getMonth() + offset, 1);
}

function monthKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

function monthFromInput(value: string) {
  const [year, month] = value.split('-').map(Number);
  return Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12 ? new Date(year, month - 1, 1) : startOfMonth();
}

function todayIso() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function lectureLines(lecture: string) {
  const [title, ...sessionParts] = lecture.split(/\s+[—–-]\s+/);
  return { title, session: sessionParts.join(' — ') };
}

export default function CoachCatchupQueue() {
  const coach = useCoachIdentity();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(12);
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth());
  const [filter, setFilter] = useState<CatchUpFilter>('all');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleCandidateId, setScheduleCandidateId] = useState('');
  const [scheduleDate, setScheduleDate] = useState(todayIso);
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduleDuration, setScheduleDuration] = useState(45);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const queue = useCatchUpQueue(coach.isInitialized && Boolean(coach.email));
  const catchupQueue = queue.rows;
  const queueLoading = coach.isInitialized && !coach.email ? false : (!coach.isInitialized || queue.loading);
  const queueError = coach.isInitialized && !coach.email
    ? 'Coach access is required to load catch-up sessions.'
    : queue.error;
  const queueWarning = queue.warning;
  const selectedCandidate = queue.candidates.find(candidate => candidate.id === scheduleCandidateId) || null;

  // The queue already holds every booking; the month and tab only filter it here.
  const selectedMonthLabel = formatMonthYear(selectedMonth);
  const selectedMonthIsCurrent = monthKey(selectedMonth) === monthKey(startOfMonth());
  const monthRows = catchupQueue.filter(row => isEventInMonth(row.booking, selectedMonth));
  const monthBookings = monthRows.map(row => row.booking);
  const statusCounts = getStatusCounts(monthBookings);
  const visibleRows = monthRows.filter(row => {
    if (filter === 'scheduled') return isScheduledEvent(row.booking);
    if (filter === 'in-progress') return isInProgressEvent(row.booking);
    if (filter === 'completed') return isCompletedEvent(row.booking);
    return true;
  });
  const totalPages = Math.ceil(visibleRows.length / itemsPerPage) || 1;
  const paginated = visibleRows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const filterTabs: StatusTabItem[] = [
    { value: 'all', label: 'All', count: statusCounts.total },
    { value: 'scheduled', label: 'Scheduled', count: statusCounts.scheduled, status: 'scheduled' },
    { value: 'in-progress', label: 'In Progress', count: statusCounts['in-progress'], status: 'in-progress' },
    { value: 'completed', label: 'Completed', count: statusCounts.completed, status: 'completed' },
  ];

  const changeMonth = (nextMonth: Date) => {
    setSelectedMonth(startOfMonth(nextMonth));
    setFilter('all');
    setCurrentPage(1);
  };

  const changeFilter = (nextFilter: CatchUpFilter) => {
    setFilter(nextFilter);
    setCurrentPage(1);
  };

  const openSchedule = () => {
    const candidate = queue.candidates[0];
    if (!candidate) return;
    setScheduleCandidateId(candidate.id);
    setScheduleDate(candidate.lectureDate > todayIso() ? candidate.lectureDate : todayIso());
    setScheduleTime('09:00');
    setScheduleDuration(45);
    setScheduleError('');
    setScheduleOpen(true);
  };

  const selectCandidate = (candidateId: string) => {
    const candidate = queue.candidates.find(item => item.id === candidateId);
    setScheduleCandidateId(candidateId);
    if (candidate && scheduleDate < candidate.lectureDate) setScheduleDate(candidate.lectureDate);
  };

  const saveSchedule = async () => {
    if (!selectedCandidate || !scheduleDate || !scheduleTime) return;
    setScheduleBusy(true);
    setScheduleError('');
    try {
      await bookCoachCalendarEvent({
        learnerId: selectedCandidate.learnerId,
        sessionType: 'catch-up',
        absenceReportId: selectedCandidate.id,
        scheduledDate: scheduleDate,
        scheduledTime: scheduleTime,
        durationMinutes: scheduleDuration,
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        notes: `Catch-up for lecture: ${selectedCandidate.lecture}\nLecture date: ${selectedCandidate.lectureDate}`,
      });
      setScheduleOpen(false);
      queue.refresh();
    } catch (reason) {
      setScheduleError(reason instanceof Error ? reason.message : 'Unable to schedule this catch-up.');
    } finally {
      setScheduleBusy(false);
    }
  };

  const columns: DataColumn<CatchUpRequestRow>[] = [
    {
      key: 'learner',
      label: 'Learner',
      widthClass: 'w-[240px] min-w-[220px]',
      render: (item) => (
        <LearnerIdentity name={item.learner} />
      ),
    },
    {
      key: 'lecture',
      label: 'Missed Lecture',
      align: 'center',
      widthClass: 'w-[280px] min-w-[220px]',
      render: (item) => {
        if (!item.lecture) return <span className="text-[13px] text-foreground-400">Not linked</span>;
        const { title, session } = lectureLines(item.lecture);
        return (
          <span className="inline-flex max-w-[280px] flex-col items-center text-center text-[13px] text-foreground-700">
            <span className="max-w-full truncate font-medium">{title}</span>
            {session ? <span className="max-w-full truncate text-[12px] text-foreground-500">{session}</span> : null}
          </span>
        );
      },
    },
    {
      key: 'booking',
      label: 'Catch-up Booking',
      widthClass: 'w-[240px] min-w-[210px]',
      render: (item) => item.booking.scheduledDate ? (
        <span className="inline-flex flex-col whitespace-nowrap text-[13px] text-foreground-700">
          <span className="font-medium">{formatDateLabel(item.booking.scheduledDate)}</span>
          <span className="text-[12px] text-foreground-500">{formatTimeRangeLabel(item.booking)}</span>
        </span>
      ) : <span className="text-[13px] text-foreground-400">Not scheduled</span>,
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      widthClass: 'w-[140px]',
      render: (item) => <MeetingStatusPill event={item.booking} />,
    },
    {
      key: 'meeting',
      label: 'Meeting',
      align: 'center',
      widthClass: 'w-[150px]',
      render: (item) => {
        const url = meetingUrl(item.booking);
        return url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-2.5 text-[12px] font-semibold text-primary-700 transition hover:bg-primary-100"
          >
            <AppIcon className="ri-video-on-line text-[14px]" />
            Open meeting
          </a>
        ) : <span className="text-[13px] text-foreground-400">Unavailable</span>;
      },
    },
  ];

  const monthPicker = (
    <div className="flex flex-wrap items-center gap-2" aria-label="Catch-up month">
      <button type="button" onClick={() => changeMonth(addMonths(selectedMonth, -1))} className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary-100 bg-white text-primary-700 shadow-sm transition hover:bg-primary-50" aria-label="Previous month"><AppIcon className="ri-arrow-left-s-line text-lg" /></button>
      <label className="relative inline-flex h-10 min-w-44 cursor-pointer items-center justify-center gap-2 rounded-xl border border-primary-100 bg-white px-3 text-[14px] font-bold text-primary-900 shadow-sm transition hover:bg-primary-50">
        <AppIcon className="ri-calendar-line text-primary-600" />{selectedMonthLabel}<AppIcon className="ri-arrow-down-s-line text-foreground-400" />
        <input type="month" aria-label="Choose month" value={monthKey(selectedMonth)}
          onClick={(event) => { try { event.currentTarget.showPicker?.(); } catch { /* picker unsupported; typing still works */ } }}
          onChange={(event) => { if (event.target.value) changeMonth(monthFromInput(event.target.value)); }}
          className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
      <button type="button" onClick={() => changeMonth(addMonths(selectedMonth, 1))} className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary-100 bg-white text-primary-700 shadow-sm transition hover:bg-primary-50" aria-label="Next month"><AppIcon className="ri-arrow-right-s-line text-lg" /></button>
      {!selectedMonthIsCurrent ? <button type="button" onClick={() => changeMonth(startOfMonth())} className="h-10 rounded-xl border border-primary-200 bg-primary-50 px-3 text-[12px] font-semibold text-primary-700 transition hover:bg-primary-100">Today</button> : null}
    </div>
  );

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Catch-up Queue"
      pageSubtitle="Catch-up sessions"
      userName={coach.name}
      userRole="Progress Coach"
    >
      <PageContainer>
        <div className="space-y-4">
        <MeetingsHero title="Catch-up Queue" subject="catch-up sessions" monthLabel={selectedMonthLabel} actions={<div className="flex flex-wrap items-center justify-end gap-2">{monthPicker}<button type="button" onClick={openSchedule} disabled={queue.candidates.length === 0} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary-700 px-3.5 text-[12px] font-bold text-white shadow-sm transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60"><AppIcon className="ri-add-line text-lg" />Schedule meeting</button></div>} />

        {queueWarning ? (
          <div role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            {queueWarning} Calendar bookings are still shown.
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel padding="none" className="min-w-0">
          <div className="border-b border-foreground-100 px-4 py-4 md:px-5">
            <StatusTabs items={filterTabs} value={filter} onChange={(next) => changeFilter(next as CatchUpFilter)} label="Filter catch-up sessions by status" />
          </div>
          <DataTable
            columns={columns}
            rows={paginated}
            rowKey={(row) => row.id}
            minWidthClass="min-w-[980px]"
            loading={queueLoading ? <RowsSkeleton rows={6} className="p-4" /> : undefined}
            empty={
              queueError ? (
                <EmptyState variant="error" title="Could not load catch-up sessions" description={queueError} />
              ) : (
                <EmptyState variant="empty" title={catchupQueue.length ? `No catch-up bookings in ${selectedMonthLabel}` : 'No catch-up bookings yet'} description={catchupQueue.length ? 'Try another month or status.' : 'Booked catch-up sessions from the coach calendar will appear here.'} />
              )
            }
            className="rounded-none border-0 shadow-none"
          />

          {!queueLoading && !queueError && visibleRows.length > 0 ? (
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              total={visibleRows.length}
              pageSize={itemsPerPage}
              onPageChange={setCurrentPage}
              onPageSizeChange={(size) => { setItemsPerPage(size); setCurrentPage(1); }}
              noun="catch-ups"
            />
          ) : null}
        </Panel>

        <aside className="grid content-start gap-4 md:grid-cols-2 xl:grid-cols-1" aria-label="Catch-up overview">
          <MiniCalendar month={selectedMonth} events={monthBookings} onMonthChange={(offset) => changeMonth(addMonths(selectedMonth, offset))} />
          <MonthlyStatsCard counts={statusCounts} monthLabel={selectedMonthLabel} totalLabel="Total catch-ups" statuses={CATCH_UP_STATUSES} />
        </aside>
        </div>
        {scheduleOpen ? (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={() => { if (!scheduleBusy) setScheduleOpen(false); }}>
            <div role="dialog" aria-modal="true" aria-labelledby="schedule-catchup-title" className="w-full max-w-[620px] rounded-2xl border border-foreground-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-start justify-between border-b border-foreground-100 px-5 py-4">
                <div><p className="text-[11px] font-semibold uppercase tracking-wide text-primary-600">Microsoft Teams booking</p><h2 id="schedule-catchup-title" className="mt-1 text-[20px] font-bold text-foreground-900">Schedule meeting</h2><p className="mt-1 text-[12px] text-foreground-500">Choose the missed lecture this catch-up will make up, then set the meeting details.</p></div>
                <button type="button" aria-label="Close schedule meeting" disabled={scheduleBusy} onClick={() => setScheduleOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-400 hover:bg-foreground-50"><AppIcon className="ri-close-line text-lg" /></button>
              </div>
              <div className="space-y-4 px-5 py-5">
                <label className="block text-[12px] font-semibold text-foreground-700">Missed lecture<select aria-label="Missed lecture" value={scheduleCandidateId} onChange={(event) => selectCandidate(event.target.value)} disabled={scheduleBusy} className="mt-1 h-10 w-full rounded-lg border border-foreground-200 bg-white px-3 text-[13px] font-medium text-foreground-800 outline-none focus:border-primary-400"><option value="" disabled>Select a missed lecture</option>{queue.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.learner} · {candidate.lecture} · {formatDateLabel(candidate.lectureDate)}</option>)}</select></label>
                {selectedCandidate ? <div className="rounded-lg border border-primary-100 bg-primary-50/60 px-3 py-2 text-[12px] text-primary-900"><span className="font-semibold">Learner:</span> {selectedCandidate.learner}<span className="mx-2 text-primary-300">•</span><span>{selectedCandidate.programme || 'Programme not recorded'}</span></div> : null}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><label className="text-[12px] font-semibold text-foreground-700">Date<input type="date" min={selectedCandidate?.lectureDate || todayIso()} value={scheduleDate} disabled={scheduleBusy} onChange={(event) => setScheduleDate(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-foreground-200 px-3 text-[13px] font-medium outline-none focus:border-primary-400" /></label><label className="text-[12px] font-semibold text-foreground-700">Start time<input type="time" value={scheduleTime} disabled={scheduleBusy} onChange={(event) => setScheduleTime(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-foreground-200 px-3 text-[13px] font-medium outline-none focus:border-primary-400" /></label><label className="text-[12px] font-semibold text-foreground-700">Duration<select value={scheduleDuration} disabled={scheduleBusy} onChange={(event) => setScheduleDuration(Number(event.target.value))} className="mt-1 h-10 w-full rounded-lg border border-foreground-200 bg-white px-3 text-[13px] font-medium outline-none focus:border-primary-400"><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option><option value={90}>90 minutes</option><option value={120}>120 minutes</option></select></label></div>
                {scheduleError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">{scheduleError}</p> : null}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-foreground-100 px-5 py-4"><button type="button" disabled={scheduleBusy} onClick={() => setScheduleOpen(false)} className="h-10 rounded-lg border border-foreground-200 px-4 text-[12px] font-semibold text-foreground-700 hover:bg-foreground-50">Cancel</button><button type="button" disabled={scheduleBusy || !selectedCandidate || !scheduleDate || !scheduleTime} onClick={() => { void saveSchedule(); }} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-700 px-4 text-[12px] font-bold text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60"><AppIcon className={scheduleBusy ? 'ri-loader-4-line animate-spin' : 'ri-calendar-check-line'} />{scheduleBusy ? 'Scheduling...' : 'Schedule meeting'}</button></div>
            </div>
          </div>
        ) : null}
        </div>
      </PageContainer>
    </WorkspaceShell>
  );
}
