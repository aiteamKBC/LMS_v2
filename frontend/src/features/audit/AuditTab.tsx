import { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import { EmptyState } from '@/pages/users/components/ui';
import { formatDisplayDate, type CaseFileTabProps } from '@/pages/coach/learner-case-file/data';
import { formatHoursMinutes } from '@/lib/format';
import { fetchLearnerAudit, type AuditActivityItem, type LearnerAuditResponse } from './api';

export default function AuditTab({ data }: CaseFileTabProps) {
  const [audit, setAudit] = useState<LearnerAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchLearnerAudit(data.learnerId)
      .then((payload) => {
        if (!cancelled) setAudit(payload);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Unable to load audit data.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data.learnerId]);

  const items = useMemo(() => audit?.months.flatMap((month) => [
    ...month.weeks.flatMap((week) => [...week.aptem_items, ...week.lms_items]),
    ...month.undated_items,
  ]) || [], [audit]);
  const completedCount = items.filter((item) => statusText(item).toLowerCase().includes('complete') || statusText(item).toLowerCase().includes('pass')).length;
  const latestDate = items
    .map((item) => item.relevant_date)
    .filter((date): date is string => Boolean(date))
    .map((date) => ({ date, time: new Date(date).getTime() }))
    .filter((item) => !Number.isNaN(item.time))
    .sort((left, right) => right.time - left.time)[0]?.date;

  const handleExportPdf = () => {
    if (!audit) return;
    setExporting(true);
    try {
      downloadAuditPdf(audit, items);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon="ri-file-search-line" label="Audit Items" value={String(items.length || '--')} tone="primary" />
        <StatCard icon="ri-check-double-line" label="Completed" value={String(completedCount || '--')} tone="emerald" />
        <StatCard icon="ri-calendar-event-line" label="Latest Activity" value={latestDate ? formatDisplayDate(latestDate, true) : '--'} tone="amber" />
        <StatCard icon="ri-database-2-line" label="Source" value="Aptem/LMS" tone="accent" />
      </section>

      <section className="overflow-hidden rounded-xl border border-foreground-200/60 bg-background-50">
        <div className="flex flex-col gap-3 border-b border-background-200 bg-background-100/50 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-heading font-semibold text-foreground-900">
              <AppIcon className="ri-shield-check-line text-primary-500"></AppIcon> Learner Audit
            </h2>
            <p className="mt-1 text-[11px] text-foreground-500">
              Aptem/LMS reconciliation from Audit.Aptem_LMS_matching.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={!audit || loading || exporting}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-foreground-950 px-4 py-2.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-foreground-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon className={`${exporting ? 'ri-loader-4-line animate-spin' : 'ri-file-pdf-line'} text-sm`}></AppIcon>
            Export PDF
          </button>
        </div>

        <div className="p-5 md:p-6">
          {loading ? (
            <EmptyState text="Loading learner audit..." />
          ) : error ? (
            <EmptyState text={error} />
          ) : !audit ? (
            <EmptyState text="No Aptem/LMS audit record was found for this learner." />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <InfoPanel title="Learner Record" rows={[
                ['Learner ID', display(audit.learner.id)],
                ['Full name', display(audit.learner.name)],
                ['Programme', display(audit.learner.programme_name)],
                ['Employer', display(audit.learner.employer)],
                ['End-Point Assessment (EPA)', display(audit.learner.epa)],
              ]} />
              <InfoPanel title="Audit Summary" rows={[
                ['Completed OTJH', audit.summary.completed_otjh == null ? 'Not available' : formatHoursMinutes(audit.summary.completed_otjh)],
                ['Total planned hours', audit.summary.total_programme_planned_hours == null ? 'Not available' : `${audit.summary.total_programme_planned_hours}h`],
                ['LMS progress', audit.summary.lms_progress == null ? 'Not available' : `${audit.summary.lms_progress}%`],
                ['Quiz attempts', display(audit.summary.quiz_attempts)],
                ['Warnings', String(audit.warnings.length)],
              ]} />
            </div>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-foreground-200/60 bg-background-50">
        <div className="flex items-center justify-between border-b border-background-200 bg-background-100/50 px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-heading font-semibold text-foreground-900">
            <AppIcon className="ri-timeline-view text-accent-500"></AppIcon> Monthly Audit Timeline
          </h2>
          <span className="text-[11px] text-foreground-400">{audit?.months.length || 0} month(s)</span>
        </div>
        <div className="p-5 md:p-6">
          {loading ? (
            <EmptyState text="Loading monthly audit timeline..." />
          ) : !audit || audit.months.length === 0 ? (
            <EmptyState text="No Aptem or LMS activity was returned for this learner." />
          ) : (
            <div className="space-y-3">
              {audit.months.slice(0, 6).map((month) => (
                <div key={month.month_key} className="rounded-xl border border-foreground-200/60 bg-background-100/50 p-4">
                  <p className="text-[13px] font-semibold text-foreground-900">{month.label}</p>
                  <p className="mt-1 text-[11px] text-foreground-500">
                    {month.summary.aptem_items} Aptem items - {month.summary.lms_items} LMS items - {month.summary.warnings} warning(s)
                  </p>
                  <div className="mt-3 space-y-2">
                    {month.weeks.slice(0, 3).map((week) => (
                      <div key={week.week_key} className="rounded-lg border border-background-200 bg-background-50 p-3 text-[11px] text-foreground-600">
                        <span className="font-semibold text-foreground-800">{week.label}</span> - {week.aptem_items.length} Aptem - {week.lms_items.length} LMS
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function InfoPanel({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <div className="rounded-xl border border-background-200/70 bg-background-100/50 p-4">
      <h3 className="mb-3 text-[12px] font-semibold text-foreground-900">{title}</h3>
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4 border-b border-background-200 pb-2 last:border-0 last:pb-0">
            <span className="text-[11px] text-foreground-400">{label}</span>
            <span className="text-right text-[12px] font-medium text-foreground-900">{value || 'Not available'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, tone }: { icon: string; label: string; value: string; tone: 'primary' | 'emerald' | 'amber' | 'accent' }) {
  const toneMap = {
    primary: 'bg-primary-100 text-primary-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-700',
    accent: 'bg-secondary-100 text-secondary-700',
  } as const;
  return (
    <div className="coach-metric-card">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${toneMap[tone]}`}>
        <AppIcon className={`${icon} text-base`}></AppIcon>
      </div>
      <p className="text-xl font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400">{label}</p>
    </div>
  );
}

function display(value: unknown) {
  if (value === null || value === undefined || value === '') return 'Not available';
  return String(value);
}

function statusText(item: AuditActivityItem) {
  return item.source === 'Aptem' ? item.status : item.completion_status;
}

function downloadAuditPdf(audit: LearnerAuditResponse, items: AuditActivityItem[]) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 14;
  const add = (text: string, bold = false) => {
    if (y > 280) {
      doc.addPage();
      y = 14;
    }
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 12 : 9);
    const lines = doc.splitTextToSize(text || 'Not available', 182) as string[];
    doc.text(lines, 14, y);
    y += Math.max(5, lines.length * 5);
  };
  add('Monthly Learner Audit Report', true);
  add(`Learner: ${display(audit.learner.name)}`);
  add(`Programme: ${display(audit.learner.programme_name)}`);
  add(`Generated: ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`);
  y += 4;
  add('Audit Items', true);
  items.slice(0, 80).forEach((item, index) => {
    const title = item.source === 'Aptem' ? item.activity_name : item.component_name;
    add(`${index + 1}. ${item.source}: ${title} - ${statusText(item)} - ${item.match_status}`);
  });
  doc.save(`monthly-learner-audit-${audit.learnerId}.pdf`);
}
