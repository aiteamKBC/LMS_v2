// ============================================================================
// Learner overview drawer content.
//
// Mirrors the printed "Learner Journal" report (header info strip, hours
// summary cards, activity log table) so the on-screen preview and the PDF
// export read as the same document. Columns are limited to what the monthly
// activity feed actually carries — no Activity ID / Accepted columns, since
// that data comes from a different report and is not part of this feed.
// ============================================================================
import { AppIcon } from '@/components/feature/AppIcon';
import { Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { statusTone, toneStyle } from '@/lib/statusTone';
import { formatDateLabel } from '@/pages/coach/shared/calendarEvents';
import { MONTHLY_STATUS_LABEL } from '../lib/constants';
import { formatHoursLabel, formatSourceLabel } from '../lib/monthly';
import { activityStatusTone } from '../lib/tone';
import type { MonthlyLearnerActivity } from '../types';

function JournalField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
      <p className="mt-1 text-[13px] font-bold text-foreground-800">{value}</p>
    </div>
  );
}

function JournalMetric({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-background-100 px-3 py-2.5">
      <span className={`h-8 w-1 shrink-0 rounded-full ${accent}`} />
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
        <p className="mt-0.5 text-[15px] font-extrabold text-foreground-900">{value}</p>
      </div>
    </div>
  );
}

export function LearnerOverviewPanel({
  learner,
  monthLabel,
  coachName,
  isExporting,
  onExport,
}: {
  learner: MonthlyLearnerActivity;
  monthLabel: string;
  coachName: string;
  isExporting: boolean;
  onExport: () => void;
}) {
  const tone = statusTone(learner.status);
  const variance = learner.otjh.monthlyHours - learner.otjh.monthlyTarget;
  const varianceLabel = `${variance >= 0 ? '+' : '-'}${formatHoursLabel(Math.abs(variance))}`;

  return (
    <div className="space-y-5">
      <Panel>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-foreground-900">Learner Journal</h2>
            <p className="text-[12px] text-foreground-500">Monthly off-the-job learning record</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge tone={tone} label={MONTHLY_STATUS_LABEL[learner.status]} />
            <button
              type="button"
              onClick={onExport}
              disabled={isExporting}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-[12px] font-semibold text-white hover:bg-red-700 transition-smooth cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <AppIcon className={isExporting ? 'ri-loader-4-line animate-spin text-sm' : 'ri-file-pdf-line text-sm'}></AppIcon>
              {isExporting ? 'Preparing...' : 'Download PDF'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 rounded-xl bg-background-100/70 p-4 sm:grid-cols-3">
          <JournalField label="Learner" value={learner.name} />
          <JournalField label="Programme" value={learner.programme || '--'} />
          <JournalField label="Coach" value={coachName || '--'} />
          <JournalField label="Cohort / Group" value={`${learner.cohortName || '--'} / ${learner.group || '--'}`} />
          <JournalField label="Reporting month" value={monthLabel} />
          <JournalField label="Last captured" value={learner.lastActivityDate ? formatDateLabel(learner.lastActivityDate) : 'No date captured'} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <JournalMetric label="Monthly target" value={formatHoursLabel(learner.otjh.monthlyTarget)} accent="bg-foreground-700" />
          <JournalMetric label="Actual hours" value={learner.otjh.monthlyHoursLabel} accent="bg-primary-600" />
          <JournalMetric label="Variance" value={varianceLabel} accent={variance < 0 ? 'bg-red-500' : 'bg-emerald-500'} />
          <JournalMetric label="KSBs evidenced" value={String(learner.ksb.touched)} accent="bg-amber-500" />
        </div>
      </Panel>

      <Panel padding="none">
        <div className="flex items-center justify-between p-5 pb-0">
          <div>
            <h3 className="text-[13px] font-bold text-foreground-800">Activity log</h3>
            <p className="text-[12px] text-foreground-500">Recorded off-the-job learning activity for {monthLabel}</p>
          </div>
          <span className="text-[12px] font-semibold text-foreground-400">{learner.activities.length} item{learner.activities.length === 1 ? '' : 's'}</span>
        </div>

        {learner.activities.length === 0 ? (
          <div className="p-5">
            <EmptyState
              size="sm"
              variant="empty"
              icon="ri-inbox-line"
              title={`No activity captured for ${monthLabel}`}
              description="This learner has no progress log, activity feed, or coach calendar item in the selected month."
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto px-5 pb-5">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="bg-foreground-900 text-white">
                  <th className="whitespace-nowrap px-4 py-2.5 font-bold">Date</th>
                  <th className="whitespace-nowrap px-4 py-2.5 font-bold">Type</th>
                  <th className="px-4 py-2.5 font-bold">Activity details</th>
                  <th className="whitespace-nowrap px-4 py-2.5 font-bold">Source</th>
                  <th className="whitespace-nowrap px-4 py-2.5 font-bold">Status</th>
                </tr>
              </thead>
              <tbody>
                {learner.activities.map((activity, index) => {
                  const rowTone = activityStatusTone(activity.tone);
                  return (
                    <tr key={activity.id} className={index % 2 === 0 ? 'bg-background-50' : 'bg-background-100/60'}>
                      <td className="whitespace-nowrap px-4 py-2.5 align-top text-foreground-600">{formatDateLabel(activity.date)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 align-top text-foreground-600">{activity.type}</td>
                      <td className="px-4 py-2.5 align-top">
                        <p className="font-semibold text-foreground-800">{activity.title}</p>
                        {activity.detail && <p className="mt-0.5 text-foreground-500">{activity.detail}</p>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 align-top text-foreground-500">{formatSourceLabel(activity.source)}</td>
                      <td className={`whitespace-nowrap px-4 py-2.5 align-top font-semibold ${toneStyle(rowTone).text}`}>{activity.status || '--'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {learner.needsAction.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-foreground-100 p-5">
            {learner.needsAction.map((action) => (
              <StatusBadge key={action} tone={tone} label={action} dot={false} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
