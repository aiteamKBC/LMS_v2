import { Link } from 'react-router-dom';
import { WorkspaceMetricContent } from '@/components/ui/WorkspaceMetricContent';
import type { CurriculumHomeSummary } from '../useCurriculumHome';

function SummaryCard({ label, value, detail, href, icon, loading, warning = false }: { label: string; value: number; detail: string; href: string; icon: string; loading: boolean; warning?: boolean }) {
  return (
    <Link to={href} className="card-premium flex min-h-[88px] items-center rounded-xl border border-foreground-200/60 bg-background-50 px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">
      <WorkspaceMetricContent label={label} value={loading ? '—' : value} note={detail} icon={icon}
        iconClassName={warning ? '!bg-amber-50 !text-amber-700' : ''} />
    </Link>
  );
}

export function HomeSummaryCards({ data, loading, unavailable, issueTypes }: { data: CurriculumHomeSummary | null; loading: boolean; unavailable: boolean; issueTypes: number }) {
  const openIssues = data?.stats.openIssues ?? 0;
  const pending = loading || unavailable;
  return (
    <section className="grid gap-3 sm:grid-cols-3">
      <SummaryCard label="Programmes" value={data?.stats.programmes ?? 0} detail="Open programme workspaces" href="/curriculum/programmes" icon="ri-stack-line" loading={pending} />
      <SummaryCard label="Active delivery" value={data?.stats.activeCohorts ?? 0} detail={data ? `${data.stats.groups} groups across all cohorts` : 'Groups across all cohorts'} href="/curriculum/delivery" icon="ri-calendar-check-line" loading={pending} />
      <SummaryCard label="Needs attention" value={openIssues} detail={unavailable ? 'Summary unavailable' : issueTypes ? `${issueTypes} types of action` : 'No blockers found'} href="/curriculum/quality" icon="ri-error-warning-line" loading={pending} warning={openIssues > 0} />
    </section>
  );
}
