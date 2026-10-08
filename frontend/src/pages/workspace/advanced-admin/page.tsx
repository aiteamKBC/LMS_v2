import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { advancedAdminLearners, type AdvancedAdminLearner } from '@/api/advancedAdmin';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useAuth } from '@/hooks/useAuth';

const nav = roleNavMap['advanced-admin'];

export default function AdvancedAdminWorkspace() {
  const { auth } = useAuth();
  const [learners, setLearners] = useState<AdvancedAdminLearner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [programme, setProgramme] = useState<'all' | 'PCP' | 'ME'>('all');
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    advancedAdminLearners(controller.signal)
      .then(result => { setLearners(result.learners); setError(''); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load learners.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const filtered = useMemo(() => learners.filter(learner =>
    (programme === 'all' || learner.programmeCode === programme)
    && (!search.trim() || `${learner.name} ${learner.programme} ${learner.group}`.toLowerCase().includes(search.trim().toLowerCase()))
  ), [learners, programme, search]);
  const filtering = programme !== 'all' || search.trim() !== '';
  const visible = showMore || filtering ? filtered : filtered.slice(0, 10);

  return <WorkspaceShell role="advanced-admin" roleLabel={nav.label} navItems={nav.items}
    workspaceLabel={nav.workspaceLabel} pageTitle="Learner review" pageSubtitle="Active PCP and ME learners"
    userName={auth.account?.displayName || undefined} userRole="Advanced Admin">
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="rounded-2xl border border-foreground-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><h2 className="text-xl font-semibold text-foreground-900">Assigned learners</h2>
            <p className="mt-1 text-sm text-foreground-600">{loading ? 'Loading…' : `${visible.length} of ${learners.length} learners`}</p></div>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 rounded-lg border border-foreground-200 px-3 py-2 text-sm">
              <Search size={17} aria-hidden="true" /><span className="sr-only">Search learners</span>
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search learners" className="min-w-48 bg-transparent outline-none" /></label>
            <label className="sr-only" htmlFor="advanced-admin-programme">Programme</label>
            <select id="advanced-admin-programme" value={programme} onChange={event => setProgramme(event.target.value as typeof programme)} className="rounded-lg border border-foreground-200 bg-white px-3 py-2 text-sm">
              <option value="all">PCP and ME</option><option value="PCP">PCP</option><option value="ME">ME</option>
            </select>
          </div>
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</p>}
      {loading ? <p className="p-5">Loading learners…</p> : !error && <>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map(learner => <Link key={learner.id} to={`/workspace/advanced-admin/learners/${learner.id}/learning`}
          className="rounded-2xl border border-foreground-200 bg-white p-5 shadow-sm transition hover:border-primary-400 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600">
          <div className="flex items-start justify-between gap-3"><h3 className="font-semibold text-foreground-900">{learner.name}</h3>
            <span className="rounded-full bg-primary-100 px-2 py-1 text-xs font-semibold text-primary-800">{learner.programmeCode}</span></div>
          <p className="mt-2 text-sm text-foreground-600">{learner.programme}</p>
          <p className="mt-1 text-sm text-foreground-500">{learner.group || 'Group not recorded'}</p>
          {!learner.lmsLinked && <p className="mt-3 text-sm text-amber-700">LMS link pending</p>}
          </Link>)}
        </div>
        {!showMore && !filtering && filtered.length > 10 && <div className="flex justify-end">
          <button type="button" onClick={() => setShowMore(true)}
            className="rounded-lg border border-primary-200 bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600">
            See More
          </button>
        </div>}
      </>}
      {!loading && !error && filtered.length === 0 && <p className="rounded-xl border border-foreground-200 bg-white p-5">No learners match these filters.</p>}
    </div>
  </WorkspaceShell>;
}
