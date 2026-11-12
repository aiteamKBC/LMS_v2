import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { AppIcon } from '@/components/feature/AppIcon';
import { roleNavMap } from '@/mocks/navigation';
import { useAuth } from '@/hooks/useAuth';
import { createBreatheConnection, getBreatheConflicts, getBreathePreview, getBreatheRuns, getBreatheStatus, listBreatheConnections, triggerBreatheSync, type BreatheConnectionStatus, type BreathePendingMatch, type BreatheSchedulingConflict, type BreatheSyncRun } from '@/api/breatheIntegration';

const nav = roleNavMap.integrations;

function statusTone(status: string) {
  if (status === 'active' || status === 'completed') return 'bg-emerald-100 text-emerald-700';
  if (status === 'attention' || status === 'failed') return 'bg-rose-100 text-rose-700';
  return 'bg-amber-100 text-amber-700';
}

export default function BreatheIntegrationWorkspace() {
  const { auth } = useAuth();
  const [connectionId, setConnectionId] = useState('');
  const [connections, setConnections] = useState<BreatheConnectionStatus[]>([]);
  const [status, setStatus] = useState<BreatheConnectionStatus | null>(null);
  const [matches, setMatches] = useState<BreathePendingMatch[]>([]);
  const [runs, setRuns] = useState<BreatheSyncRun[]>([]);
  const [conflicts, setConflicts] = useState<BreatheSchedulingConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenantKey, setTenantKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [externalAccountId, setExternalAccountId] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, preview, nextRuns, nextConflicts] = await Promise.all([getBreatheStatus(id), getBreathePreview(id), getBreatheRuns(id), getBreatheConflicts(id)]);
      setStatus(nextStatus);
      setMatches(preview.pendingMatches);
      setRuns(nextRuns.results);
      setConflicts(nextConflicts.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Breathe integration.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('connection');
    if (id) {
      setConnectionId(id);
      void load(id);
    } else {
      void listBreatheConnections().then(({ results }) => {
        setConnections(results);
        if (results[0]) {
          setConnectionId(results[0].id);
          return load(results[0].id);
        }
        setLoading(false);
        setError('No Breathe connections are configured yet.');
      }).catch(err => {
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Could not load Breathe connections.');
      });
    }
  }, [load]);

  const totals = useMemo(() => runs.reduce((sum, run) => sum + Object.values(run.counts || {}).reduce((n, value) => n + value, 0), 0), [runs]);

  const runSync = async () => {
    if (!connectionId) return;
    setSyncing(true);
    setError(null);
    try {
      await triggerBreatheSync(connectionId);
      await load(connectionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not queue a sync.');
    } finally {
      setSyncing(false);
    }
  };

  const createConnection = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const created = await createBreatheConnection({ tenantKey, displayName, externalAccountId, secretRef });
      setConnections([created]);
      setConnectionId(created.id);
      await load(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the Breathe connection.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <WorkspaceShell role="integrations" roleLabel={nav.label} navItems={nav.items} workspaceLabel={nav.workspaceLabel} pageTitle="Breathe HR Integration" pageSubtitle="Tenant-scoped HR sync, identity review and scheduling availability" userName={auth.account?.displayName || undefined} userRole="HR Integration Admin">
      <div className="space-y-6 p-6">
        <WorkspaceHeroBanner title="Breathe HR Integration" description="Review the connected account, approve safe identity matches and monitor HR availability signals without changing apprenticeship evidence." icon="ri-links-line" stats={[{ label: 'Pending matches', value: String(matches.length) }, { label: 'Conflicts', value: String(conflicts.length) }, { label: 'Records processed', value: String(totals) }]} />

        {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        {loading && <div className="rounded-xl border border-foreground-100 bg-white p-8 text-sm text-foreground-500">Loading integration health…</div>}

        {!loading && connections.length > 1 && <section className="rounded-2xl border border-foreground-100 bg-white p-5"><h2 className="text-lg font-bold text-foreground-900">Connections</h2><div className="mt-3 flex flex-wrap gap-2">{connections.map(connection => <button key={connection.id} type="button" onClick={() => { setConnectionId(connection.id); void load(connection.id); }} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${connection.id === connectionId ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-foreground-200 text-foreground-600'}`}>{connection.externalAccountId}</button>)}</div></section>}

        {!loading && connections.length === 0 && auth.account?.role !== 'employer' && <form onSubmit={createConnection} className="rounded-2xl border border-foreground-100 bg-white p-5"><h2 className="text-lg font-bold text-foreground-900">Connect a Breathe account</h2><p className="mt-1 text-sm text-foreground-500">Store only a secret reference here. The API key stays in the server environment or Secrets Manager.</p><div className="mt-4 grid gap-3 md:grid-cols-2"><input required value={tenantKey} onChange={event => setTenantKey(event.target.value)} placeholder="Tenant key" className="rounded-lg border border-foreground-200 px-3 py-2 text-sm" /><input required value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Tenant display name" className="rounded-lg border border-foreground-200 px-3 py-2 text-sm" /><input required value={externalAccountId} onChange={event => setExternalAccountId(event.target.value)} placeholder="Breathe account ID" className="rounded-lg border border-foreground-200 px-3 py-2 text-sm" /><input required value={secretRef} onChange={event => setSecretRef(event.target.value)} placeholder="Secret reference" className="rounded-lg border border-foreground-200 px-3 py-2 text-sm" /></div><button disabled={creating} className="mt-4 rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{creating ? 'Connecting…' : 'Create pending connection'}</button></form>}
        {!loading && connections.length === 0 && auth.account?.role === 'employer' && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">Your Breathe connection has not been created yet. Ask KBC Integration Admin to connect it, then return here to review your tenant mappings.</div>}

        {!loading && status && <>
          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-foreground-100 bg-white p-5"><p className="text-xs font-semibold uppercase tracking-wide text-foreground-400">Connected account</p><p className="mt-2 text-lg font-bold text-foreground-900">{status.externalAccountId}</p><span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(status.status)}`}>{status.status}</span></div>
            <div className="rounded-2xl border border-foreground-100 bg-white p-5"><p className="text-xs font-semibold uppercase tracking-wide text-foreground-400">Last sync</p><p className="mt-2 text-lg font-bold text-foreground-900">{status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : 'No sync yet'}</p><p className="mt-1 text-xs text-foreground-500">Breathe data remains read-only until approved.</p></div>
            <div className="rounded-2xl border border-foreground-100 bg-white p-5"><p className="text-xs font-semibold uppercase tracking-wide text-foreground-400">Actions</p><button type="button" onClick={() => void runSync()} disabled={syncing} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><AppIcon className="ri-refresh-line" />{syncing ? 'Queueing…' : 'Sync now'}</button></div>
          </section>

          <section className="rounded-2xl border border-foreground-100 bg-white p-5">
            <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-bold text-foreground-900">Pending identity review</h2><p className="text-sm text-foreground-500">Email is a suggestion only. Approve a link before any LMS account is activated.</p></div><span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">{matches.length} pending</span></div>
            {matches.length === 0 ? <p className="text-sm text-foreground-500">No pending matches.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-foreground-100 text-xs uppercase tracking-wide text-foreground-400"><th className="px-3 py-3">Employee</th><th className="px-3 py-3">Email</th><th className="px-3 py-3">Department</th><th className="px-3 py-3">Status</th></tr></thead><tbody>{matches.map(match => <tr key={match.id} className="border-b border-foreground-50"><td className="px-3 py-3 font-semibold text-foreground-800">{match.displayName || match.externalEmployeeId}</td><td className="px-3 py-3 text-foreground-600">{match.email || '—'}</td><td className="px-3 py-3 text-foreground-600">{match.department || '—'}</td><td className="px-3 py-3"><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">{match.status}</span></td></tr>)}</tbody></table></div>}
          </section>

          <section className="rounded-2xl border border-foreground-100 bg-white p-5">
            <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-bold text-foreground-900">Scheduling conflicts</h2><p className="text-sm text-foreground-500">Leave overlaps are queued for human review. Confirmed sessions and OTJ hours are never moved automatically.</p></div><span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">{conflicts.length} open</span></div>
            {conflicts.length === 0 ? <p className="text-sm text-foreground-500">No scheduling conflicts.</p> : <div className="space-y-2">{conflicts.map(conflict => <div key={conflict.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3"><div><p className="text-sm font-semibold text-foreground-900">Session {conflict.sessionRef}</p><p className="text-xs text-foreground-600">Employee {conflict.externalPersonId} · {new Date(conflict.startsAt).toLocaleString()}</p></div><span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-rose-700">{conflict.status}</span></div>)}</div>}
          </section>
        </>}
      </div>
    </WorkspaceShell>
  );
}
