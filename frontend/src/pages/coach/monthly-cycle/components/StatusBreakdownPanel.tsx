// ============================================================================
// Status Breakdown — On Track / At Risk / Need Attention as a donut, the
// same three counts `MonthSidebar`'s Month Health bars already showed, drawn
// the way the redesigned Monthly Cycle dashboard presents them.
// ============================================================================
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { Link } from 'react-router-dom';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { toneStyle } from '@/lib/statusTone';
import { MONTHLY_STATUS_LABEL } from '../lib/constants';
import { formatNumber } from '../lib/monthly';
import type { MonthlySummary } from '../types';

const SLICES: { key: 'onTrack' | 'needAttention' | 'atRisk'; label: string; dotClassName: string; hex: string }[] = [
  { key: 'onTrack', label: MONTHLY_STATUS_LABEL['on-track'], dotClassName: toneStyle('positive').dot, hex: '#10b981' },
  { key: 'needAttention', label: MONTHLY_STATUS_LABEL['need-attention'], dotClassName: toneStyle('caution').dot, hex: '#f59e0b' },
  { key: 'atRisk', label: MONTHLY_STATUS_LABEL['at-risk'], dotClassName: toneStyle('critical').dot, hex: '#ef4444' },
];

export function StatusBreakdownPanel({ summary }: { summary: MonthlySummary }) {
  const total = summary.activeLearners;
  const data = SLICES.map((slice) => ({ ...slice, value: summary[slice.key] }));
  const hasData = total > 0;

  return (
    <Panel>
      <SectionHeader
        title="Status Breakdown"
        actions={<Link to="#learner-month-log" className="text-[12px] font-semibold text-primary-600 hover:text-primary-700">View all learners</Link>}
      />

      <div className="mt-4 flex items-center gap-5">
        <div className="relative h-[132px] w-[132px] shrink-0">
          {hasData ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="label" innerRadius={44} outerRadius={64} paddingAngle={3} stroke="none">
                  {data.map((slice) => (
                    <Cell key={slice.key} fill={slice.hex} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-full border-8 border-background-200" />
          )}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[22px] font-bold leading-none text-foreground-900 tabular-nums">{formatNumber(total)}</span>
            <span className="text-[11px] text-foreground-400">Learners</span>
          </div>
        </div>

        <ul className="min-w-0 flex-1 space-y-2.5">
          {data.map((slice) => (
            <li key={slice.key} className="flex items-center justify-between gap-3 text-[12px]">
              <span className="flex min-w-0 items-center gap-2 text-foreground-600">
                <span className={`h-2 w-2 shrink-0 rounded-full ${slice.dotClassName}`} />
                <span className="truncate">{slice.label}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-foreground-900">
                {formatNumber(slice.value)} {total > 0 ? `(${Math.round((slice.value / total) * 100)}%)` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
