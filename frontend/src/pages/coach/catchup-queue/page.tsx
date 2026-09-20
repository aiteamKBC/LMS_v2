import { useEffect, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';
import { type AbsenceReport } from '@/mocks/absence-reports';
import {
  type CoachCalendarEvent,
  fetchCoachCalendarEvents,
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

const coachNav = roleNavMap.coach;
const ABSENCE_REPORTS_ENDPOINT = '/coach_api/coach/absence-reports';

interface CatchUpRequestRow {
  id: string;
  learner: string;
  lecture?: string;
  booking: CoachCalendarEvent;
}

const BOOKED_CATCHUP_STATUSES = new Set<CoachCalendarEvent['status']>([
  'scheduled',
  'in-progress',
  'completed',
]);

function lectureLines(lecture: string) {
  const [title, ...sessionParts] = lecture.split(/\s+[—–-]\s+/);
  return { title, session: sessionParts.join(' — ') };
}

export default function CoachCatchupQueue() {
  const coach = useCoachIdentity();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(12);
  const [catchupQueue, setCatchupQueue] = useState<CatchUpRequestRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');
  const [queueWarning, setQueueWarning] = useState('');

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
    setQueueWarning('');

    Promise.all([
      fetchCoachCalendarEvents(controller.signal),
      coachFetch(ABSENCE_REPORTS_ENDPOINT, { signal: controller.signal }).then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || `Request failed with ${response.status}`);
        return data as { items?: AbsenceReport[] };
      }).then(
        data => ({ data, warning: '' }),
        () => ({ data: { items: [] as AbsenceReport[] }, warning: 'Missed lecture details could not be loaded.' }),
      ),
    ])
      .then(([calendarData, absenceResult]) => {
        const lectureByEventKey = new Map(
          (absenceResult.data.items || [])
            .filter(report => report.recoveryMethod === 'catch-up' && report.catchupEventKey)
            .map(report => [report.catchupEventKey as string, report.sessionTitle]),
        );
        const catchups = (calendarData.events || [])
          .filter(event => event.source === 'catch-up' && BOOKED_CATCHUP_STATUSES.has(event.status))
          .map((booking): CatchUpRequestRow => {
            const id = booking.eventKey || booking.id;
            return {
              id,
              learner: booking.learner || booking.email || 'Unknown learner',
              lecture: lectureByEventKey.get(id),
              booking,
            };
          });
        setQueueWarning(absenceResult.warning);
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
