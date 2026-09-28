import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { roleNavMap } from '@/mocks/navigation';
import {
  formatDateLabel,
  formatTimeRangeLabel,
  meetingUrl,
  statusLabel,
} from '@/pages/coach/shared/calendarEvents';
import { LearnerIdentity } from '@/pages/coach/shared/LearnerIdentity';
import { AppIcon } from '@/components/feature/AppIcon';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { Panel } from '@/components/ui/Panel';
import { useCatchUpQueue } from '@/features/coach/meetings/catch-up/hooks/useCatchUpQueue';
import type { CatchUpRequestRow } from '@/features/coach/meetings/catch-up/types/catchUp.types';

const coachNav = roleNavMap.coach;
function lectureLines(lecture: string) {
  const [title, ...sessionParts] = lecture.split(/\s+[—–-]\s+/);
  return { title, session: sessionParts.join(' — ') };
}

export default function CoachCatchupQueue() {
  const coach = useCoachIdentity();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(12);
  const queue = useCatchUpQueue(coach.isInitialized && Boolean(coach.email));
  const catchupQueue = queue.rows;
  const queueLoading = coach.isInitialized && !coach.email ? false : (!coach.isInitialized || queue.loading);
  const queueError = coach.isInitialized && !coach.email
    ? 'Coach access is required to load catch-up sessions.'
    : queue.error;
  const queueWarning = queue.warning;

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
      render: (item) => <StatusBadge status={item.booking.status} label={statusLabel(item.booking.status)} size="sm" />,
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

        {queueWarning ? (
          <div role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            {queueWarning} Calendar bookings are still shown.
          </div>
        ) : null}

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
                <EmptyState variant="empty" title="No catch-up bookings yet" description="Booked catch-up sessions from the coach calendar will appear here." />
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
