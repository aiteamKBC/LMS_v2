// ============================================================================
// Learner Engagement Overview — cumulative activity across the month, one
// line per category.
//
// Only Completions, Reviews and Evidence carry a per-activity date in the API
// response (`MonthlyLearnerActivity.activities[].date`), so those three are
// genuine day-by-day series here. KSBs and OTJH are monthly totals on the
// learner record with no per-day breakdown, so they are not plotted as a
// trend — showing a smooth line for them would invent data the backend does
// not provide.
// ============================================================================
import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { inlineActivityCategory } from '../lib/monthly';
import type { MonthlyLearnerActivity } from '../types';

const SERIES = [
  { key: 'completions', label: 'Completions', color: 'oklch(var(--primary-500))' },
  { key: 'reviews', label: 'Reviews', color: '#f59e0b' },
  { key: 'evidence', label: 'Evidence', color: '#10b981' },
] as const;

type SeriesKey = (typeof SERIES)[number]['key'];

function dayLabel(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(parsed);
}

export function EngagementOverviewChart({ learners, monthKey }: { learners: MonthlyLearnerActivity[]; monthKey: string }) {
  const chartData = useMemo(() => {
    const [year, month] = monthKey.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();

    const dailyCounts = new Map<number, Record<SeriesKey, number>>();
    for (let day = 1; day <= daysInMonth; day += 1) {
      dailyCounts.set(day, { completions: 0, reviews: 0, evidence: 0 });
    }

    learners.forEach((learner) => {
      learner.activities.forEach((activity) => {
        const activityDate = new Date(`${activity.date.slice(0, 10)}T00:00:00`);
        if (Number.isNaN(activityDate.getTime())) return;
        if (activityDate.getFullYear() !== year || activityDate.getMonth() !== month - 1) return;

        const category = inlineActivityCategory(activity.type);
        const seriesKey: SeriesKey = category === 'meeting' ? 'reviews' : category === 'assignment' ? 'evidence' : 'completions';
        const bucket = dailyCounts.get(activityDate.getDate());
        if (bucket) bucket[seriesKey] += 1;
      });
    });

    const running: Record<SeriesKey, number> = { completions: 0, reviews: 0, evidence: 0 };
    return Array.from(dailyCounts.entries()).map(([day, counts]) => {
      running.completions += counts.completions;
      running.reviews += counts.reviews;
      running.evidence += counts.evidence;
      return {
        day,
        label: dayLabel(`${monthKey}-${String(day).padStart(2, '0')}`),
        ...running,
      };
    });
  }, [learners, monthKey]);

  const hasActivity = chartData.some((point) =>
    SERIES.some((series) => point[series.key] > 0));

  return (
    <Panel>
      <SectionHeader
        title="Learner Engagement Overview"
        description="Cumulative completions, coaching reviews and evidence logged this month."
      />

      {!hasActivity ? (
        <EmptyState size="sm" variant="empty" icon="ri-line-chart-line" title="No dated activity yet this month." />
      ) : (
        <>
          <div className="mt-4 h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--background-200)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--foreground-400)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--background-200)' }}
                  interval={Math.max(0, Math.floor(chartData.length / 5) - 1)}
                />
                <YAxis tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid var(--background-200)', fontSize: 12 }}
                  labelStyle={{ fontWeight: 600, marginBottom: 4 }}
                />
                {SERIES.map((series) => (
                  <Line
                    key={series.key}
                    type="monotone"
                    dataKey={series.key}
                    name={series.label}
                    stroke={series.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
            {SERIES.map((series) => (
              <span key={series.key} className="flex items-center gap-1.5 text-[12px] text-foreground-600">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: series.color }} />
                {series.label}
              </span>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
