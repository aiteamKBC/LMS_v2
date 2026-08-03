import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/pages/users/components/ui';
import { formatDisplayDate, resolveQuizAttemptTitle, type CaseFileTabProps } from '../data';

interface LiveRecordRow {
  id: string;
  title: string;
  detail: string;
  meta: string;
  status: 'available' | 'unavailable';
}

export default function DocumentsTab({ data }: CaseFileTabProps) {
  const navigate = useNavigate();
  const records = useMemo(() => buildRecords(data), [data]);
  const availableRecords = records.filter((record) => record.status === 'available');
  const weekCount = data.journey.reduce((count, module) => count + module.weeks.length, 0);

  const handleOpenTrainingPlan = () => {
    if (!data.kind || !data.learnerId) {
      return;
    }
    navigate(`/learner/training-plan/${data.kind}/${data.learnerId}`);
  };

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon="ri-database-2-line" label="Live Records" value={String(availableRecords.length)} tone="primary" />
        <StatCard icon="ri-route-line" label="Plan Modules" value={String(data.journey.length)} tone="accent" />
        <StatCard icon="ri-calendar-todo-line" label="Plan Weeks" value={String(weekCount)} tone="emerald" />
        <StatCard icon="ri-folder-open-line" label="File Feed" value="Unavailable" tone="amber" />
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
                <i className="ri-file-list-3-line text-primary-500"></i> Available Live Records
              </h2>
              <p className="text-[12px] text-foreground-500 mt-1">
                This tab now shows only records that actually exist in the connected APIs.
              </p>
            </div>
            {data.kind && (
              <button
                onClick={handleOpenTrainingPlan}
                className="px-4 py-2 rounded-full bg-primary-500 text-background-50 dark:text-foreground-950 text-[12px] font-semibold hover:bg-primary-600 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5"
              >
                <i className="ri-route-line text-sm"></i> Open Training Plan
              </button>
            )}
          </div>

          {records.length === 0 ? (
            <EmptyState text="No live records were available for this learner." />
          ) : (
            <div className="space-y-3">
              {records.map((record) => (
                <div key={record.id} className="flex items-start gap-3 p-4 rounded-xl border border-foreground-200/60 bg-background-100/50">
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    record.status === 'available' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-700'
                  }`}>
                    <i className={`${record.status === 'available' ? 'ri-check-line' : 'ri-alert-line'} text-base`}></i>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-semibold text-foreground-900">{record.title}</p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        record.status === 'available'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        {record.status === 'available' ? 'Available' : 'Unavailable'}
                      </span>
                    </div>
                    <p className="text-[11px] text-foreground-500 mt-1">{record.detail}</p>
                    <p className="text-[10px] text-foreground-400 mt-1">{record.meta}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2 mb-4">
            <i className="ri-calendar-line text-accent-500"></i> Key Dates
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DetailCard title="Start Date" value={data.startDate || '--'} detail="Coach caseload snapshot." icon="ri-play-circle-line" />
            <DetailCard title="Last Session" value={data.attendance?.lastSession || '--'} detail={data.attendance?.lastSessionDate ? `Recorded ${formatDisplayDate(data.attendance.lastSessionDate)}` : '--'} icon="ri-calendar-event-line" />
            <DetailCard title="Last Submission" value={data.evidence?.lastSubmission || '--'} detail={data.evidence?.lastSubmissionIso ? `Recorded ${formatDisplayDate(data.evidence.lastSubmissionIso)}` : '--'} icon="ri-folder-upload-line" />
            <DetailCard title="Planned End" value={data.plannedEndDate || '--'} detail="Expected programme end from the coach snapshot." icon="ri-flag-2-line" />
          </div>
        </div>
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6 text-[12px] text-foreground-600 space-y-2">
          <p>
            The current backend does not expose learner document files, signatures, or download links to this page yet.
          </p>
          <p>
            Static fake compliance documents were removed so the coach only sees live records and dates that actually exist.
          </p>
        </div>
      </section>
    </div>
  );
}

function buildRecords(data: CaseFileTabProps['data']): LiveRecordRow[] {
  const weekCount = data.journey.reduce((count, module) => count + module.weeks.length, 0);
  const latestQuiz = [...(data.detail?.quizAttempts || [])]
    .sort((left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime())[0];

  return [
    {
      id: 'learner-profile',
      title: 'Learner profile record',
      detail: `${data.programme || '--'} for ${data.displayName}`,
      meta: `Learner ID ${data.learnerId} - ${data.email || '--'}`,
      status: data.detail || data.snapshot ? 'available' : 'unavailable',
    },
    {
      id: 'training-plan',
      title: 'Training plan structure',
      detail: `${data.journey.length} module(s) and ${weekCount} week(s) in the live learner plan`,
      meta: data.kind ? `Open in /learner/training-plan/${data.kind}/${data.learnerId}` : 'Learner kind was not resolved, so the plan route is unavailable.',
      status: data.kind && data.journey.length > 0 ? 'available' : 'unavailable',
    },
    {
      id: 'attendance-record',
      title: 'Attendance snapshot',
      detail: data.attendance?.hasAttendance
        ? `${data.attendance.attendance ?? '--'}% attendance across ${data.attendance.sessions ?? 0} session(s)`
        : '--',
      meta: data.attendance?.lastSessionDate ? `Last session ${formatDisplayDate(data.attendance.lastSessionDate)}` : '--',
      status: data.attendance?.hasAttendance ? 'available' : 'unavailable',
    },
    {
      id: 'marking-queue',
      title: 'Evidence review snapshot',
      detail: data.evidence
        ? `${data.evidence.pendingEvidence} pending, ${data.evidence.acceptedEvidence} accepted, ${data.evidence.referredEvidence} referred`
        : '--',
      meta: data.evidence?.lastSubmission || '--',
      status: data.evidence ? 'available' : 'unavailable',
    },
    {
      id: 'quiz-history',
      title: 'Assessment transcript',
      detail: `${data.detail?.quizAttempts.length || 0} quiz attempt(s) returned`,
      meta: latestQuiz ? `Latest: ${resolveQuizAttemptTitle(data.detail, latestQuiz)} on ${formatDisplayDate(latestQuiz.submittedAt)}` : '--',
      status: (data.detail?.quizAttempts.length || 0) > 0 ? 'available' : 'unavailable',
    },
  ];
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  tone: 'primary' | 'accent' | 'emerald' | 'amber';
}) {
  const toneMap = {
    primary: 'bg-primary-100 text-primary-600',
    accent: 'bg-accent-100 text-accent-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
  } as const;

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${toneMap[tone]}`}>
        <i className={`${icon} text-base`}></i>
      </div>
      <p className="text-xl font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400">{label}</p>
    </div>
  );
}

function DetailCard({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: string;
}) {
  return (
    <div className="rounded-xl border border-background-200/70 bg-background-100/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-8 h-8 rounded-lg bg-background-50 border border-background-200 flex items-center justify-center">
          <i className={`${icon} text-sm text-foreground-600`}></i>
        </span>
        <p className="text-[12px] font-semibold text-foreground-900">{title}</p>
      </div>
      <p className="text-lg font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400 mt-1">{detail}</p>
    </div>
  );
}
