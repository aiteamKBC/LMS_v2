import { useEffect, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Database, Search, Table2, X } from 'lucide-react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { useAuth } from '@/hooks/useAuth';
import { roleNavMap } from '@/mocks/navigation';
import { schemaGroups, searchCatalogue, totalTables, type SchemaTable } from './catalogue';

const basePath = '/workspace/admin/database';
const focusStyle = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2';

function TableList({ tables }: { tables: SchemaTable[] }) {
  return <ul className="divide-y divide-foreground-100">
    {tables.map(table => <li key={table.name} className="flex min-w-0 items-start gap-3 px-4 py-4 sm:px-5">
      <Table2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
      <div className="min-w-0 flex-1">
        <p className="break-words font-mono text-xs font-semibold text-foreground-900 sm:text-sm" dir="ltr">{table.name}</p>
        <p lang="ar" dir="rtl" className="mt-2 text-start text-sm leading-7 text-foreground-600">{table.description}</p>
      </div>
    </li>)}
  </ul>;
}

export default function DatabaseExplorerPage() {
  const { auth } = useAuth();
  const { groupId } = useParams<{ groupId: string }>();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const activeGroup = schemaGroups.find(group => group.id === groupId);
  const invalidGroup = Boolean(groupId && !activeGroup);
  const results = searchCatalogue(query, activeGroup ? [activeGroup] : schemaGroups);
  const matchingTables = results.reduce((sum, group) => sum + group.tables.length, 0);
  const searching = Boolean(query.trim());
  const headingRef = useRef<HTMLDivElement>(null);
  const previousGroup = useRef(groupId);
  const searchSuffix = query ? `?${new URLSearchParams({ q: query })}` : '';
  const overviewUrl = `${basePath}${searchSuffix}`;
  const adminNav = roleNavMap.admin;

  useEffect(() => {
    if (previousGroup.current !== groupId) headingRef.current?.focus();
    previousGroup.current = groupId;
  }, [groupId]);

  function updateSearch(value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set('q', value); else next.delete('q');
    setParams(next, { replace: true });
  }

  return <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items}
    workspaceLabel={adminNav.workspaceLabel} pageTitle="Database"
    pageSubtitle="Explore the platform's database structure"
    userName={auth.account?.displayName || auth.user?.fullName || 'Platform Admin'} userRole="Super Administrator">
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6 p-4 sm:p-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-xs text-foreground-500">
        <Link to="/workspace/admin" className={`rounded hover:text-primary-700 ${focusStyle}`}>Super Admin Workspace</Link>
        <span aria-hidden="true">/</span>
        {groupId ? <><Link to={overviewUrl} className={`rounded hover:text-primary-700 ${focusStyle}`}>Database</Link>
          <span aria-hidden="true">/</span><span aria-current="page">{activeGroup?.name || 'Group not found'}</span></>
          : <span aria-current="page">Database</span>}
      </nav>

      <div ref={headingRef} tabIndex={-1} className="rounded-2xl focus:outline-none">
        <header className="rounded-2xl border border-primary-200/60 bg-white p-5 sm:p-6">
          {groupId && <Link to={overviewUrl} className={`mb-4 inline-flex items-center gap-2 rounded text-xs font-semibold text-primary-700 ${focusStyle}`}>
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />Back to Database overview
          </Link>}
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-primary-50 p-2.5 text-primary-600"><Database aria-hidden="true" className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground-900 sm:text-2xl">{activeGroup?.name || (invalidGroup ? 'Group not found' : 'Database')}</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-foreground-600">{activeGroup?.description || "Explore the platform's database structure and understand what each table is responsible for."}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-foreground-100 pt-4 text-foreground-600">
            <span className="text-sm"><strong className="text-foreground-900">{activeGroup ? activeGroup.tables.length : totalTables}</strong> {activeGroup ? 'tables in this group' : 'total tables'}</span>
            {!activeGroup && <span className="text-sm"><strong className="text-foreground-900">{schemaGroups.length}</strong> schema groups</span>}
            <span className="text-xs">Static catalogue · Read-only documentation · Counts are not live database totals</span>
          </div>
        </header>
      </div>

      {!invalidGroup && <>
        <div>
          <label htmlFor="database-search" className="mb-2 block text-sm font-medium text-foreground-800">Search {activeGroup ? 'this group' : 'the catalogue'}</label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-foreground-400" />
            <input id="database-search" type="search" dir="auto" value={query} onChange={event => updateSearch(event.target.value)}
              placeholder="Table name, group or Arabic description…"
              className={`h-11 w-full rounded-xl border border-foreground-200 bg-white pl-10 pr-12 text-sm text-foreground-900 ${focusStyle}`} />
            {query && <button type="button" aria-label="Clear search" onClick={() => updateSearch('')}
              className={`absolute right-1 top-1 rounded-lg p-2 text-foreground-500 hover:bg-primary-50 ${focusStyle}`}><X className="h-5 w-5" /></button>}
          </div>
          <p role="status" className="mt-2 text-xs text-foreground-500">
            {searching ? `${matchingTables} matching tables in ${results.length} ${results.length === 1 ? 'group' : 'groups'}`
              : activeGroup ? `${activeGroup.tables.length} documented tables` : 'Browse all 13 schema groups or search in English and Arabic.'}
          </p>
        </div>

        {!results.length ? <div className="rounded-2xl border border-foreground-200 bg-white px-5 py-12 text-center">
          <Search aria-hidden="true" className="mx-auto mb-3 h-6 w-6 text-foreground-400" />
          <h2 className="text-base font-semibold text-foreground-900">No matching tables</h2>
          <p className="mt-2 text-sm text-foreground-500">Try a different table name, group name or Arabic description.</p>
          <button type="button" onClick={() => updateSearch('')} className={`mt-4 rounded-lg px-3 py-2 text-sm font-semibold text-primary-700 ${focusStyle}`}>Clear search</button>
        </div> : activeGroup ? <section aria-label={`${activeGroup.name} tables`} className="overflow-hidden rounded-2xl border border-foreground-200 bg-white">
          <TableList tables={results[0].tables} />
        </section> : <div className={searching ? 'space-y-4' : 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'}>
          {results.map(group => <section key={group.id} className="min-w-0 overflow-hidden rounded-2xl border border-foreground-200 bg-white">
            <Link to={`${basePath}/${group.id}${searchSuffix}`} className={`group block rounded-2xl p-5 transition-colors hover:bg-primary-50/50 ${focusStyle}`}>
              <div className="flex items-center gap-2 text-primary-600">
                <AppIcon className={`${group.icon} text-lg`} aria-hidden="true" />
                <span className="text-xs text-foreground-500">{searching ? `${group.tables.length} matching / ` : ''}{schemaGroups.find(item => item.id === group.id)!.tables.length} tables</span>
                <ArrowRight aria-hidden="true" className="ml-auto h-4 w-4 text-foreground-400 group-hover:text-primary-600" />
              </div>
              <h2 className="mt-3 text-sm font-semibold text-foreground-900">{group.name}</h2>
              <p className="mt-2 text-xs leading-5 text-foreground-500">{group.description}</p>
            </Link>
            {searching && <TableList tables={group.tables} />}
          </section>)}
        </div>}
      </>}
      {invalidGroup && <div className="rounded-2xl border border-foreground-200 bg-white p-6">
        <Database aria-hidden="true" className="mb-3 h-6 w-6 text-primary-500" />
        <p className="text-sm text-foreground-600">This schema group is not in the catalogue.</p>
        <Link to={basePath} className={`mt-4 inline-flex items-center gap-2 rounded text-sm text-primary-700 ${focusStyle}`}><ArrowLeft className="h-4 w-4" />Browse all groups</Link>
      </div>}
    </div>
  </WorkspaceShell>;
}
