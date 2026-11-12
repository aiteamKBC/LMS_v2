import { AppIcon } from '@/components/feature/AppIcon';
import { ATTENTION_META, type AttentionIssue } from './attentionMeta';
import { EmptyState, LoadingRows, SectionHeader } from './HomeParts';

function AttentionRow({ issue, onOpen }: { issue: AttentionIssue; onOpen: () => void }) {
  const meta = ATTENTION_META[issue.key];
  return <button type="button" onClick={onOpen} className="group grid w-full gap-2.5 rounded-xl border border-foreground-200/70 bg-background-50 p-3 text-left transition-all duration-200 hover:border-primary-200 hover:bg-primary-50/25 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-inset sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><AppIcon className={`${meta.icon} text-base`} /></span><span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="text-[12px] font-bold text-foreground-900">{meta.title}</span><span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">{issue.count}</span></span><span className="mt-1 block text-[11px] leading-5 text-foreground-500">{meta.detail}</span></span><span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary-700">View details<AppIcon className="ri-arrow-right-line transition-transform duration-200 group-hover:translate-x-0.5" /></span></button>;
}

export function NeedsAttention({ issues, loading, unavailable, onOpen }: { issues: AttentionIssue[]; loading: boolean; unavailable: boolean; onOpen: (issue: AttentionIssue) => void }) {
  return (
    <div className="h-full rounded-2xl border border-foreground-200 bg-background-50 shadow-sm">
      <SectionHeader title="Needs attention" detail="Live gaps, ordered by impact. Each row opens where it can be fixed." href="/curriculum/quality" action="View Quality" />
      <div className="p-3">
        {loading ? <LoadingRows count={4} /> : unavailable ? null : issues.length
          ? <div className="space-y-2">{issues.map(issue => <AttentionRow key={issue.key} issue={issue} onOpen={() => onOpen(issue)} />)}</div>
          : <EmptyState icon="ri-checkbox-circle-line" title="No curriculum blockers found" detail="You can continue authoring or review an active programme." />}
      </div>
    </div>
  );
}
