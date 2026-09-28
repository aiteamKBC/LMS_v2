import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { coachViewAs } from '@/lib/coachViewAs';
import { EmptyState } from '@/components/ui/EmptyState';
import { MonthListSkeleton } from '@/features/old-otjh/RecordSkeletons';
import design from '@/features/old-otjh/design.module.css';
import journal from '@/features/old-otjh/journal.module.css';
import { getCoachMonthlyLogLearners } from '../api/monthlyLogsApi';
import { filterCoachMonthlyLogLearners } from '../selectors/monthlyLogsSelectors';

export function CoachMonthlyLogLearners() {
  const { auth } = useAuth();
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['monthly-logs', auth.account?.id, coachViewAs()?.email, 'learners'],
    queryFn: getCoachMonthlyLogLearners,
    // A coach returning to this route should keep the successful list visible;
    // React Query can still refresh it without reverting to the first-load UI.
    gcTime: Infinity,
  });
  if (query.isPending) return <MonthListSkeleton />;
  if (query.error) return <EmptyState variant="error" title="Unable to load monthly logs" description={query.error.message}
    action={<button className={journal.secondaryButton} onClick={() => void query.refetch()}>Try again</button>} />;
  const learners = filterCoachMonthlyLogLearners(query.data.learners, search);
  return <div className={design.monthList}>
    <header className={design.monthListHeader}><h1 className="font-heading font-semibold">Monthly Logs</h1><p>Open a learner’s monthly record to review activities and add your signature.</p></header>
    <label className="block space-y-2 text-sm">Search learners<input type="search" className="block w-full rounded-xl border p-3" value={search} onChange={e => setSearch(e.target.value)} /></label>
    {learners.length ? <div className="grid gap-4 md:grid-cols-2">{learners.map(learner => <Link className={`${journal.card} block p-5`} to={`/coach/monthly-logs/${learner.id}`} key={learner.id}>
      <h2 className="font-semibold">{learner.name}</h2><p className="mt-2 text-sm">{learner.programme}</p><span className="mt-4 inline-block text-sm font-semibold">Open monthly logs →</span>
    </Link>)}</div> : <EmptyState title="No learners found" />}
  </div>;
}
