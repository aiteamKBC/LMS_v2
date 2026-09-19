import { useEffect, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';
import { type AbsenceReport } from '@/mocks/absence-reports';
import { type CoachCalendarEvent, fetchCoachCalendarEvents, formatDateLabel, formatTimeRangeLabel } from '@/pages/coach/shared/calendarEvents';
import { LearnerIdentity } from '@/pages/coach/shared/LearnerIdentity';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { Panel } from '@/components/ui/Panel';

const coachNav = roleNavMap.coach;
const ABSENCE_REPORTS_ENDPOINT = '/coach_api/coach/absence-reports';

interface CatchUpRequestRow {
  id: string;
  learner: string;
  lecture: string;
  booking: CoachCalendarEvent | null;
  completed: boolean;
}

export default function CoachCatchupQueue() {
  const coach = useCoachIdentity();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(12);
  const [catchupQueue, setCatchupQueue] = useState<CatchUpRequestRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');

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

    Promise.all([
      fetchCoachCalendarEvents(controller.signal),
      coachFetch(ABSENCE_REPORTS_ENDPOINT, { signal: controller.signal }).then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || `Request failed with ${response.status}`);
        return data as { items?: AbsenceReport[] };
      }),
    ])
      .then(([calendarData, absenceData]) => {
        const eventsByKey = new Map(
          (calendarData.events || [])
            .filter(event => event.source === 'catch-up')
            .map(event => [event.eventKey || event.id, event]),
        );
        const catchups = (absenceData.items || [])
          .filter(report => report.recoveryMethod === 'catch-up')
          .map((report): CatchUpRequestRow => {
            const booking = report.catchupEventKey ? eventsByKey.get(report.catchupEventKey) || null : null;
            return {
              id: report.id,
              learner: report.learner,
              lecture: report.sessionTitle,
              booking,
              completed: booking?.status === 'completed',
            };
          });
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

  const totalPages = Math.ceil(catchupQueue.length / itemsPerPage) || 1;
  const paginated = catchupQueue.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

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
      widthClass: 'w-[280px] min-w-[220px]',
      render: (item) => <span className="block max-w-[280px] truncate text-[13px] font-medium text-foreground-700">{item.lecture}</span>,
    },
    {
      key: 'booking',
      label: 'Catch-up Booking',
      widthClass: 'w-[240px] min-w-[210px]',
      render: (item) => item.booking?.scheduledDate ? (
        <span className="inline-flex flex-col whitespace-nowrap text-[13px] text-foreground-700">
          <span className="font-medium">{formatDateLabel(item.booking.scheduledDate)}</span>
          <span className="text-[12px] text-foreground-500">{formatTimeRangeLabel(item.booking)}</span>
        </span>
      ) : <span className="text-[13px] text-foreground-400">Not scheduled</span>,
    },
    {
      key: 'completed',
      label: 'Completed',
      align: 'center',
      widthClass: 'w-[140px]',
      render: (item) => <StatusBadge tone={item.completed ? 'positive' : 'neutral'} label={item.completed ? 'Yes' : 'No'} size="sm" />,
    },
  ];

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
        <PageHeader title="Catch-up Queue" />

        <Panel padding="none">
          <DataTable
            columns={columns}
            rows={paginated}
            rowKey={(row) => row.id}
            minWidthClass="min-w-[760px]"
            loading={queueLoading ? <RowsSkeleton rows={6} className="p-4" /> : undefined}
            empty={
              queueError ? (
                <EmptyState variant="error" title="Could not load catch-up sessions" description={queueError} />
              ) : (
                <EmptyState variant="empty" title="No catch-up requests yet" description="Catch-up requests will appear here when a learner links a booking to a missed lecture." />
              )
            }
            className="rounded-none border-0 shadow-none"
          />

          {!queueLoading && !queueError && catchupQueue.length > 0 ? (
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              total={catchupQueue.length}
              pageSize={itemsPerPage}
              onPageChange={setCurrentPage}
              onPageSizeChange={(size) => { setItemsPerPage(size); setCurrentPage(1); }}
              noun="catch-ups"
            />
          ) : null}
        </Panel>
      </PageContainer>
    </WorkspaceShell>
  );
}
