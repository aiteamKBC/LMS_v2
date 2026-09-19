import { useEffect, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { roleNavMap } from '@/mocks/navigation';
import { statusTone } from '@/lib/statusTone';
import { type CatchUpItem } from '@/mocks/catchup-queue';
import { fetchCoachCalendarEvents } from '@/pages/coach/shared/calendarEvents';
import { LearnerIdentity } from '@/pages/coach/shared/LearnerIdentity';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { Panel } from '@/components/ui/Panel';
import { calendarEventToCatchUp } from './lib/trend';
import { priorityTone, titleCase } from './lib/tone';

const coachNav = roleNavMap.coach;

export default function CoachCatchupQueue() {
  const coach = useCoachIdentity();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(12);
  const [catchupQueue, setCatchupQueue] = useState<CatchUpItem[]>([]);
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

  const totalPages = Math.ceil(catchupQueue.length / itemsPerPage) || 1;
  const paginated = catchupQueue.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const columns: DataColumn<CatchUpItem>[] = [
    {
      key: 'learner',
      label: 'Learner',
      widthClass: 'w-[240px] min-w-[220px]',
      render: (item) => (
        <LearnerIdentity
          name={item.learner}
          programme={`${item.cohort} - ${item.programme}`}
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
          : <span className="text-[13px] text-foreground-300">-</span>
      ),
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
            minWidthClass="min-w-[980px]"
            loading={queueLoading ? <RowsSkeleton rows={6} className="p-4" /> : undefined}
            empty={
              queueError ? (
                <EmptyState variant="error" title="Could not load catch-up sessions" description={queueError} />
              ) : (
                <EmptyState variant="empty" title="No catch-up sessions yet" description="Catch-up sessions will appear here once a missed session is scheduled for a learner." />
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
