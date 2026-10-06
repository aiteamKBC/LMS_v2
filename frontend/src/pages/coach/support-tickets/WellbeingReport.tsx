import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppIcon } from '@/components/feature/AppIcon';
import { SkeletonBlock } from '@/components/feature/Skeletons';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/hooks/useAuth';
import { coachViewAs } from '@/lib/coachViewAs';
import { cn } from '@/lib/cn';
import { formatSystemTimestamp } from '@/lib/format';
import { toneStyle, type StatusTone } from '@/lib/statusTone';
import {
  fetchSupportTicketWellbeingReport,
  type WellbeingReport as Report,
  type WellbeingReportAnswer,
} from '@/api/coachSupportTickets';

type View = 'flags' | 'all';

const RISK_TONE: Record<string, StatusTone> = {
  low: 'positive',
  medium: 'caution',
  high: 'critical',
  critical: 'critical',
};

const FLAG_META: Record<'high' | 'medium' | 'none', { label: string; tone: StatusTone; icon: string }> = {
  high: { label: 'High concern', tone: 'critical', icon: 'ri-alarm-warning-line' },
  medium: { label: 'Follow-up', tone: 'caution', icon: 'ri-error-warning-line' },
  none: { label: 'Not flagged', tone: 'neutral', icon: 'ri-checkbox-circle-line' },
};

function formatScore(value: number | null) {
  if (value == null) return '--';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
}

/** "protective_above_5" -> "Protective above 5" */
function patternLabel(code: string) {
  const text = code.replace(/[_-]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : code;
}

function HeadlineTile({ label, children, tone }: { label: string; children: ReactNode; tone?: StatusTone }) {
  const style = tone ? toneStyle(tone) : null;
  return (
    <div className="rounded-xl border border-foreground-100 bg-background-50 px-4 py-3 shadow-sm">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-foreground-500">{label}</dt>
      <dd className={cn('mt-1.5 text-[18px] font-semibold leading-tight', style ? style.text : 'text-foreground-900')}>{children}</dd>
    </div>
  );
}

function CountTile({ label, value, tone }: { label: string; value: number; tone: StatusTone }) {
  const style = toneStyle(tone);
  return (
    <div className={cn('rounded-xl border px-4 py-3', style.bg, style.border)}>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-foreground-500">{label}</dt>
      <dd className={cn('mt-1 text-[22px] font-bold leading-none tabular-nums', style.text)}>{value}</dd>
    </div>
  );
}

function AnswerCard({ answer }: { answer: WellbeingReportAnswer }) {
  const meta = FLAG_META[answer.flag ?? 'none'];
  const style = toneStyle(meta.tone);
  const percent = answer.concernScore == null || !answer.maxScore
    ? 0
    : Math.max(0, Math.min(100, (answer.concernScore / answer.maxScore) * 100));
  return (
    <li className={cn('rounded-xl border p-4', answer.flag ? cn(style.bg, style.border) : 'border-foreground-100 bg-background-50')}>
      <div className="flex items-start gap-3">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', answer.flag ? 'bg-background-50' : style.bg, style.text)}>
          <AppIcon className={cn(meta.icon, 'text-[16px]')} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge tone={meta.tone} label={meta.label} size="sm" dot={false} />
            {answer.category ? (
              <span className="rounded-md border border-foreground-100 bg-background-50 px-1.5 py-0.5 text-[11px] font-medium text-foreground-600">
                {answer.category}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-[13px] font-semibold leading-snug text-foreground-900">{answer.question || 'Survey question'}</p>
          {answer.construct ? <p className="mt-0.5 text-[12px] text-foreground-500">{answer.construct}</p> : null}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-background-50 px-2.5 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-foreground-500">Learner answer</dt>
          <dd className="mt-1 text-[16px] font-bold tabular-nums text-foreground-900">{formatScore(answer.learnerAnswer)}</dd>
        </div>
        <div className="rounded-lg bg-background-50 px-2.5 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-foreground-500">Concern score</dt>
          <dd className="mt-1">
            <span className="text-[16px] font-bold tabular-nums text-foreground-900">{formatScore(answer.concernScore)}</span>
            <span className="ml-1 text-[11px] text-foreground-500">/ {formatScore(answer.maxScore)}</span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-foreground-100" aria-hidden="true">
              <span className={cn('block h-full rounded-full', answer.flag ? style.dot : 'bg-foreground-300')} style={{ width: `${percent}%` }} />
            </span>
          </dd>
        </div>
        <div className="rounded-lg bg-background-50 px-2.5 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-foreground-500">Why flagged</dt>
          <dd className="mt-1 text-[12px] font-medium leading-snug text-foreground-800">
            {answer.whyFlagged || (answer.flag ? 'Flagged by the survey' : '--')}
          </dd>
        </div>
      </dl>
    </li>
  );
}

function ReportBody({ report }: { report: Report }) {
  const [view, setView] = useState<View>(report.counts.riskFlags ? 'flags' : 'all');
  const flagged = [
    ...report.answers.filter(answer => answer.flag === 'high'),
    ...report.answers.filter(answer => answer.flag === 'medium'),
  ];
  const shown = view === 'flags' ? flagged : report.answers;
  const riskTone = RISK_TONE[report.riskLevel.toLowerCase()] ?? 'neutral';
  const overall = report.scores.find(score => score.key === 'overall');
  const domains = report.scores.filter(score => score.key !== 'overall');

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <HeadlineTile label="Risk">
          {report.riskLevel ? <StatusBadge tone={riskTone} label={report.riskLevel} size="lg" /> : '--'}
        </HeadlineTile>
        <HeadlineTile label={overall?.label ?? 'Overall score'}>{formatScore(overall?.value ?? null)}</HeadlineTile>
        <HeadlineTile label="Triggers" tone={report.triggerCount ? 'caution' : undefined}>{report.triggerCount}</HeadlineTile>
        <HeadlineTile label="Survey submitted">
          <span className="text-[14px]">
            {report.submittedAt ? formatSystemTimestamp(report.submittedAt, { day: 'numeric', month: 'short', year: 'numeric' }) : '--'}
          </span>
        </HeadlineTile>
      </dl>

      {domains.length ? (
        <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {domains.map(score => (
            <div key={score.key} className="rounded-lg border border-foreground-100 bg-foreground-50/60 px-3 py-2">
              <dt className="truncate text-[11px] font-medium text-foreground-500">{score.label}</dt>
              <dd className="mt-0.5 text-[15px] font-semibold tabular-nums text-foreground-900">{formatScore(score.value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <section className="rounded-xl border border-foreground-100 bg-background-50" aria-label="Survey question evidence">
        <div className="flex flex-col gap-3 border-b border-foreground-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-500">Survey review</p>
            <h4 className="text-[14px] font-semibold text-foreground-900">Question evidence</h4>
          </div>
          <div className="flex gap-1 rounded-lg bg-foreground-50 p-1" role="group" aria-label="Choose which answers to show">
            {([
              { value: 'flags', label: 'Risk flags', count: report.counts.riskFlags },
              { value: 'all', label: 'All answers', count: report.counts.answers },
            ] as const).map(option => (
              <button
                key={option.value}
                type="button"
                aria-pressed={view === option.value}
                onClick={() => setView(option.value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold transition',
                  view === option.value ? 'bg-primary-700 text-white shadow-sm' : 'text-foreground-600 hover:text-foreground-900',
                )}
              >
                {option.label}
                <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', view === option.value ? 'bg-white/20' : 'bg-background-50')}>{option.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4 p-4">
          <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <CountTile label="Risk flags" value={report.counts.riskFlags} tone="critical" />
            <CountTile label="High concern" value={report.counts.high} tone="critical" />
            <CountTile label="Follow-up" value={report.counts.medium} tone="caution" />
            <CountTile label="All answers" value={report.counts.answers} tone="brand" />
          </dl>

          {report.patterns.length ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="font-medium text-foreground-600">Patterns detected:</span>
              {report.patterns.map(code => <StatusBadge key={code} tone="info" label={patternLabel(code)} size="sm" />)}
            </div>
          ) : null}

          {shown.length ? (
            <ul className="grid gap-3 lg:grid-cols-2">
              {shown.map(answer => <AnswerCard key={answer.id} answer={answer} />)}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-foreground-200 px-3 py-4 text-center text-[12px] text-foreground-500">
              {view === 'flags' ? 'No individual answers were flagged in this survey.' : 'No answers were stored for this survey.'}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * The survey behind a ticket, as the Inclusion app's wellbeing report shows it.
 * `fallback` is rendered when the ticket has no stored survey (or the report
 * cannot be loaded), so the ticket's own text is never lost.
 */
export function WellbeingReport({ ticketId, fallback, originalText }: {
  ticketId: number;
  fallback: ReactNode;
  originalText: string;
}) {
  const { auth } = useAuth();
  const query = useQuery({
    queryKey: ['coach-support-ticket-report', ticketId, auth.account?.id, coachViewAs()?.email],
    queryFn: ({ signal }) => fetchSupportTicketWellbeingReport(ticketId, signal),
    staleTime: 5 * 60 * 1000,
  });

  if (query.isPending) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading wellbeing report" aria-busy="true">
        <span className="sr-only">Loading wellbeing report…</span>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3].map(index => <SkeletonBlock key={index} className="h-16 w-full rounded-xl" />)}
        </div>
        <SkeletonBlock className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (query.error) {
    return (
      <div className="space-y-3">
        <p role="alert" className={cn('flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium', toneStyle('caution').bg, toneStyle('caution').border, toneStyle('caution').text)}>
          <AppIcon className="ri-error-warning-line" aria-hidden="true" />
          The wellbeing report could not be loaded: {query.error.message}
          <button type="button" className="underline underline-offset-2" onClick={() => void query.refetch()}>Try again</button>
        </p>
        {fallback}
      </div>
    );
  }

  if (!query.data.available) return <>{fallback}</>;

  return (
    <div className="space-y-3">
      <ReportBody report={query.data} />
      {originalText.trim() ? (
        <details className="group rounded-lg border border-foreground-100 px-3 py-2">
          <summary className="cursor-pointer text-[12px] font-medium text-foreground-600 group-open:mb-2">Original ticket text</summary>
          <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground-700">{originalText}</p>
        </details>
      ) : null}
    </div>
  );
}
