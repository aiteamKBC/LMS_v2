import { CompanyTrainingPanel } from './CompanyTrainingPanel';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Building2, CheckCircle2, ChevronRight, CircleAlert, Clock3, FileSignature, LayoutDashboard, Link2, ShoppingBag, Users, WalletCards } from 'lucide-react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { useAuth } from '@/hooks/useAuth';
import { fetchEmployerDashboardMetrics, fetchEmployerPortal } from '@/api/employerPortal';
import { buildB2BPortalData, withCompanyDemoTraining, type B2BPortalData, type B2BPortalRole } from '@/api/b2bPortal';
import { getCompanyTraining, createBreatheConnection, getBreathePreview, getBreatheRuns, listBreatheConnections, triggerBreatheSync, type BreatheConnectionStatus, type BreathePendingMatch, type BreatheSyncRun } from '@/api/breatheIntegration';

type B2BTab = 'overview' | 'people' | 'training' | 'progress' | 'contracts' | 'marketplace' | 'integration' | 'company';

const tabs: { id: B2BTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'people', label: 'People', icon: Users },
  { id: 'training', label: 'Training', icon: CheckCircle2 },
  { id: 'progress', label: 'Progress', icon: Building2 },
  { id: 'contracts', label: 'Contracts', icon: FileSignature },
  { id: 'marketplace', label: 'Marketplace', icon: ShoppingBag },
  { id: 'integration', label: 'Integration', icon: Link2 },
  { id: 'company', label: 'Company', icon: WalletCards },
];

function readTab(value: string | null): B2BTab {
  return tabs.some(tab => tab.id === value) ? value as B2BTab : 'overview';
}

function formatDate(value: string | null) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusTone(status: string) {
  if (status === 'active' || status === 'completed') return 'bg-emerald-100 text-emerald-700';
  if (status === 'attention' || status === 'failed') return 'bg-rose-100 text-rose-700';
  return 'bg-amber-100 text-amber-700';
}

function MetricCard({ label, value, detail, icon, tone = 'primary' }: { label: string; value: string; detail: string; icon: React.ReactNode; tone?: 'primary' | 'amber' | 'rose' | 'emerald' }) {
  const tones = {
    primary: 'bg-primary-50 text-primary-700', amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700', emerald: 'bg-emerald-50 text-emerald-700',
  };
  return <div className="rounded-2xl border border-foreground-100 bg-white p-5">
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-foreground-400">{label}</p><p className="mt-2 text-2xl font-bold text-foreground-900">{value}</p></div><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</span></div>
    <p className="mt-2 text-xs text-foreground-500">{detail}</p>
  </div>;
}

function EmployeeTable({ data, role }: { data: B2BPortalData; role: B2BPortalRole }) {
  return <div className="overflow-hidden rounded-2xl border border-foreground-100 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground-100 px-5 py-4"><div><h2 className="text-lg font-bold text-foreground-900">{role === 'hr' ? 'All employees' : 'Employees in your company view'}</h2><p className="mt-1 text-sm text-foreground-500">Progress indicators only. Sensitive evidence files stay hidden.</p></div>{role === 'hr' && <button type="button" disabled className="rounded-lg border border-foreground-200 px-3 py-2 text-sm font-semibold text-foreground-400" title="The HR employee-management endpoint is not connected yet">Add employee</button>}</div>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-foreground-100 text-xs uppercase tracking-wide text-foreground-400"><th className="px-5 py-3">Employee</th><th className="px-5 py-3">Programme</th><th className="px-5 py-3">Progress</th><th className="px-5 py-3">Hours</th><th className="px-5 py-3">Last activity</th><th className="px-5 py-3">Status</th><th className="px-5 py-3"></th></tr></thead><tbody>{data.employees.map(employee => <tr key={`${employee.kind}-${employee.id}`} className="border-b border-foreground-50 last:border-b-0"><td className="px-5 py-4"><p className="font-semibold text-foreground-900">{employee.name}</p><p className="mt-0.5 text-xs text-foreground-500">{employee.email || 'No email'}{employee.cohort ? ` · ${employee.cohort}` : ''}</p></td><td className="px-5 py-4 text-foreground-700">{employee.programme || 'Not assigned'}</td><td className="px-5 py-4"><div className="flex items-center gap-2"><div className="h-2 w-24 rounded-full bg-foreground-100"><div className="h-2 rounded-full bg-primary-600" style={{ width: `${employee.progress}%` }} /></div><span className="text-xs font-semibold text-foreground-700">{employee.progress}%</span></div></td><td className="px-5 py-4 text-foreground-700">{employee.hoursPercent}%</td><td className="px-5 py-4 text-xs text-foreground-500">{formatDate(employee.lastActivityAt)}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${employee.risk === 'at-risk' ? 'bg-rose-100 text-rose-700' : employee.risk === 'need-attention' ? 'bg-amber-100 text-amber-700' : employee.risk === 'on-track' ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-500'}`}>{employee.risk === 'on-track' ? 'On track' : employee.risk === 'need-attention' ? 'Needs attention' : employee.risk === 'at-risk' ? 'At risk' : 'No status'}</span></td><td className="px-5 py-4 text-right">{employee.demoTraining ? <span className="text-xs text-amber-700">Demo training</span> : <Link to={`/employers/${data.company.id}/learner/${employee.kind}/${employee.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:text-primary-800">View <ChevronRight size={14} /></Link>}</td></tr>)}</tbody></table></div>
    {data.employees.length === 0 && <div className="px-5 py-12 text-center text-sm text-foreground-500">No employees are available in this company view.</div>}
  </div>;
}

function IntegrationPanel({ role, connection, pendingMatches, runs, onSync, syncing, onCreate, creating }: { role: B2BPortalRole; connection: BreatheConnectionStatus | null; pendingMatches: BreathePendingMatch[]; runs: BreatheSyncRun[]; onSync: () => void; syncing: boolean; onCreate: (input: { tenantKey: string; displayName: string; externalAccountId: string; apiKey: string }) => void; creating: boolean }) {
  const [tenantKey, setTenantKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [externalAccountId, setExternalAccountId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const submit = (event: FormEvent) => { event.preventDefault(); onCreate({ tenantKey, displayName, externalAccountId, apiKey }); };
  return <div className="space-y-5"><div className="grid gap-4 md:grid-cols-3"><MetricCard label="Connection" value={connection?.status || 'Not connected'} detail={connection?.externalAccountId ? `Breathe account ${connection.externalAccountId}` : 'HR can connect a Breathe tenant'} icon={<Link2 size={18} />} tone={connection?.status === 'active' ? 'emerald' : 'amber'} /><MetricCard label="Last sync" value={formatDate(connection?.lastSyncAt || null)} detail="The B2B policy checks Breathe every hour." icon={<Clock3 size={18} />} /><MetricCard label="Needs review" value={String(pendingMatches.length)} detail="HR reviews identity matches before activation." icon={<CircleAlert size={18} />} tone={pendingMatches.length ? 'amber' : 'emerald'} /></div>{role === 'hr' && <form onSubmit={submit} className="rounded-2xl border border-foreground-100 bg-white p-5"><h2 className="text-lg font-bold text-foreground-900">Company Breathe API</h2><p className="mt-1 text-sm text-foreground-500">Add this company's Breathe API key. It is encrypted at rest and never shown again.</p><div className="mt-4 grid gap-3 md:grid-cols-2"><input required value={tenantKey} onChange={event => setTenantKey(event.target.value)} placeholder="Tenant key" className="rounded-lg border border-foreground-200 px-3 py-2 text-sm" /><input required value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Company display name" className="rounded-lg border border-foreground-200 px-3 py-2 text-sm" /><input required value={externalAccountId} onChange={event => setExternalAccountId(event.target.value)} placeholder="Breathe account ID" className="rounded-lg border border-foreground-200 px-3 py-2 text-sm" /><input required type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="Company Breathe API key" autoComplete="new-password" className="rounded-lg border border-foreground-200 px-3 py-2 text-sm" /></div><button type="submit" disabled={creating} className="mt-4 rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{creating ? 'Saving?' : connection ? 'Replace company API' : 'Connect company API'}</button></form>}{connection && <div className="rounded-2xl border border-foreground-100 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-bold text-foreground-900">Breathe HR</h2><p className="mt-1 max-w-2xl text-sm text-foreground-500">Imported employees remain read-only until HR reviews the match and activates the LMS account.</p></div>{role === 'hr' ? <button type="button" onClick={onSync} disabled={syncing} className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{syncing ? 'Queueing…' : 'Sync now'}</button> : <span className="rounded-lg border border-foreground-200 px-3 py-2 text-xs font-semibold text-foreground-500">Manager view only</span>}</div>{pendingMatches.length > 0 && <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-foreground-100 text-xs uppercase tracking-wide text-foreground-400"><th className="px-3 py-3">Employee</th><th className="px-3 py-3">Email</th><th className="px-3 py-3">Department</th><th className="px-3 py-3">Status</th></tr></thead><tbody>{pendingMatches.map(match => <tr key={match.id} className="border-b border-foreground-50"><td className="px-3 py-3 font-semibold text-foreground-800">{match.displayName || match.externalEmployeeId}</td><td className="px-3 py-3 text-foreground-600">{match.email || '—'}</td><td className="px-3 py-3 text-foreground-600">{match.department || '—'}</td><td className="px-3 py-3"><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">Needs review</span></td></tr>)}</tbody></table></div>}</div>}<div className="rounded-2xl border border-foreground-100 bg-white p-5"><h2 className="text-lg font-bold text-foreground-900">Recent sync runs</h2><div className="mt-3 space-y-2">{runs.slice(0, 5).map(run => <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground-100 px-4 py-3"><div><p className="text-sm font-semibold text-foreground-800">{run.resources.join(', ') || 'Breathe resources'}</p><p className="text-xs text-foreground-500">{formatDate(run.finishedAt || run.createdAt)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(run.status)}`}>{run.status}</span></div>)}{runs.length === 0 && <p className="text-sm text-foreground-500">No sync runs recorded yet.</p>}</div></div></div>;
}

export default function B2BEmployerPortalPage() {
  const { auth } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<B2BPortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<BreatheConnectionStatus | null>(null);
  const [pendingMatches, setPendingMatches] = useState<BreathePendingMatch[]>([]);
  const [runs, setRuns] = useState<BreatheSyncRun[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [creatingConnection, setCreatingConnection] = useState(false);

  const role: B2BPortalRole = auth.account?.portalRole === 'hr' || auth.account?.permissions?.some(permission => permission === 'b2b.hr.manage' || permission === 'employer-portal.manage') ? 'hr' : 'manager';
  const tab = readTab(searchParams.get('tab'));
  const employerId = String(auth.account?.subjectId || '');

  const load = useCallback(async () => {
    if (!employerId) {
      setError('No company account is available for this workspace.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [portal, metrics] = await Promise.all([
        fetchEmployerPortal(employerId),
        fetchEmployerDashboardMetrics(employerId, undefined, 'all').catch(() => null),
      ]);
      const base = buildB2BPortalData(portal, metrics);
      const connections = await listBreatheConnections();
      if (connections.results.length === 1) {
        setData(withCompanyDemoTraining(base, await getCompanyTraining(connections.results[0].id)));
      } else setData(base);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the B2B portal.');
    } finally {
      setLoading(false);
    }
  }, [employerId]);

  const loadIntegration = useCallback(async () => {
    try {
      const connections = await listBreatheConnections();
      const current = connections.results[0] || null;
      setConnection(current);
      if (!current) return;
      const [preview, history] = await Promise.all([getBreathePreview(current.id), getBreatheRuns(current.id)]);
      setPendingMatches(preview.pendingMatches);
      setRuns(history.results);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the Breathe integration.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tab === 'integration') void loadIntegration(); }, [loadIntegration, tab]);

  const runSync = useCallback(async () => {
    if (!connection) return;
    setSyncing(true);
    setError(null);
    try {
      await triggerBreatheSync(connection.id);
      await loadIntegration();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not queue the Breathe sync.');
    } finally {
      setSyncing(false);
    }
  }, [connection, loadIntegration]);

  const createConnection = useCallback(async (input: { tenantKey: string; displayName: string; externalAccountId: string; apiKey: string }) => {
    setCreatingConnection(true);
    setError(null);
    try {
      await createBreatheConnection({ ...input, employerId: Number(employerId) });
      await loadIntegration();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect the Breathe account.');
    } finally {
      setCreatingConnection(false);
    }
  }, [employerId, loadIntegration]);

  const setTab = useCallback((next: B2BTab) => setSearchParams(next === 'overview' ? {} : { tab: next }), [setSearchParams]);
  const employeeCount = data?.company.employees || 0;
  const notStarted = data?.progress.notStartedCount || 0;
  const attention = data?.company.employeesNeedingAttention || 0;
  const companyName = data?.company.name || auth.account?.displayName || 'Company workspace';

  const content = useMemo(() => {
    if (!data) return null;
    if (tab === 'people') return <EmployeeTable data={data} role={role} />;
    if (tab === 'progress') return <div className="space-y-5"><div className="grid gap-4 md:grid-cols-4"><MetricCard label="Average progress" value={`${data.progress.averageProgress}%`} detail="Employees who have not started count as 0%." icon={<Building2 size={18} />} /><MetricCard label="Started" value={String(data.progress.startedCount)} detail={`of ${employeeCount} employees`} icon={<CheckCircle2 size={18} />} tone="emerald" /><MetricCard label="Not started" value={String(notStarted)} detail="Included in the company average." icon={<Clock3 size={18} />} tone="amber" /><MetricCard label="Needs attention" value={String(attention)} detail="Based on the existing learner risk signal." icon={<CircleAlert size={18} />} tone={attention ? 'rose' : 'emerald'} /></div><EmployeeTable data={data} role={role} /></div>;
    if (tab === 'integration') return <IntegrationPanel role={role} connection={connection} pendingMatches={pendingMatches} runs={runs} onSync={() => void runSync()} syncing={syncing} onCreate={input => void createConnection(input)} creating={creatingConnection} />;
    if (tab === 'contracts') return <div className="rounded-2xl border border-foreground-100 bg-white p-6"><div className="flex items-start gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><FileSignature size={20} /></span><div><h2 className="text-lg font-bold text-foreground-900">Contracts and signatures</h2><p className="mt-1 max-w-2xl text-sm text-foreground-500">Line Managers sign first, followed by the Learner and KBC. Open the existing employer documents view to review or sign company documents.</p><Link to={`/employers/${data.company.id}/documents`} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white">Open contracts <ChevronRight size={15} /></Link></div></div><p className="mt-5 rounded-xl bg-background-50 px-4 py-3 text-xs text-foreground-500">Open actions for this company: {data.company.outstandingActions}</p></div>;
    if (tab === 'marketplace') return <div className="rounded-2xl border border-foreground-100 bg-white p-6"><div className="flex items-start gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><ShoppingBag size={20} /></span><div><h2 className="text-lg font-bold text-foreground-900">Course marketplace</h2><p className="mt-1 max-w-2xl text-sm text-foreground-500">Managers can request a course. HR reviews the request and completes payment through Stripe or a corporate invoice.</p><button type="button" disabled className="mt-4 rounded-lg border border-foreground-200 px-4 py-2 text-sm font-semibold text-foreground-400" title="The company catalogue and Stripe checkout endpoint are not connected yet">Browse catalogue</button></div></div></div>;
    if (tab === 'training') return <CompanyTrainingPanel hr={role === 'hr'} />;
    if (tab === 'company') return <div className="grid gap-5 lg:grid-cols-2"><div className="rounded-2xl border border-foreground-100 bg-white p-6"><h2 className="text-lg font-bold text-foreground-900">Company details</h2><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-foreground-500">Company</dt><dd className="font-semibold text-foreground-800">{companyName}</dd></div><div className="flex justify-between gap-4"><dt className="text-foreground-500">Employees</dt><dd className="font-semibold text-foreground-800">{employeeCount}</dd></div><div className="flex justify-between gap-4"><dt className="text-foreground-500">Portal role</dt><dd className="font-semibold capitalize text-foreground-800">{role}</dd></div></dl></div><div className="rounded-2xl border border-foreground-100 bg-white p-6"><h2 className="text-lg font-bold text-foreground-900">Data and privacy</h2><p className="mt-2 text-sm text-foreground-500">This portal shows company-level progress and scoped employee indicators. Sensitive evidence files remain in the learner and staff workflows.</p></div></div>;
    return <div className="space-y-5"><div className="grid gap-4 md:grid-cols-4"><MetricCard label="Employees" value={String(employeeCount)} detail={`${data.company.activeEmployees} active`} icon={<Users size={18} />} /><MetricCard label="Average progress" value={`${data.company.averageProgress}%`} detail="Company-wide subject progress" icon={<Building2 size={18} />} /><MetricCard label="Needs attention" value={String(attention)} detail="Employees requiring a follow-up" icon={<CircleAlert size={18} />} tone={attention ? 'rose' : 'emerald'} /><MetricCard label="Open actions" value={String(data.company.outstandingActions)} detail="Contracts and reviews" icon={<FileSignature size={18} />} tone={data.company.outstandingActions ? 'amber' : 'emerald'} /></div><div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]"><div className="rounded-2xl border border-foreground-100 bg-white p-5"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-bold text-foreground-900">Progress snapshot</h2><p className="mt-1 text-sm text-foreground-500">{role === 'hr' ? 'All company employees' : 'Employees available to your account'} · updated {formatDate(data.asOf)}</p></div><button type="button" onClick={() => setTab('progress')} className="text-xs font-semibold text-primary-700">View progress</button></div><div className="mt-5 h-3 rounded-full bg-foreground-100"><div className="h-3 rounded-full bg-primary-600" style={{ width: `${data.progress.averageProgress}%` }} /></div><div className="mt-2 flex justify-between text-xs text-foreground-500"><span>{data.progress.averageProgress}% average</span><span>{data.progress.notStartedCount} not started</span></div></div><div className="rounded-2xl border border-foreground-100 bg-white p-5"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Link2 size={18} /></span><div><h2 className="text-lg font-bold text-foreground-900">Breathe status</h2><p className="mt-1 text-sm text-foreground-500">{connection?.status ? `Status: ${connection.status}` : 'Open Integration to review the connection.'}</p><button type="button" onClick={() => setTab('integration')} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary-700">Open integration <ChevronRight size={14} /></button></div></div></div></div></div>;
  }, [attention, companyName, connection, createConnection, creatingConnection, data, employeeCount, notStarted, pendingMatches, role, runSync, runs, setTab, syncing, tab]);

  return <WorkspaceShell role="b2b" roleLabel="B2B Portal" appearance="learner" navItems={tabs.map(item => ({ id: `b2b-${item.id}`, label: item.label, icon: item.id === 'overview' ? 'ri-dashboard-line' : item.id === 'people' ? 'ri-group-line' : item.id === 'training' ? 'ri-book-open-line' : item.id === 'progress' ? 'ri-bar-chart-line' : item.id === 'contracts' ? 'ri-draft-line' : item.id === 'marketplace' ? 'ri-shopping-bag-line' : item.id === 'integration' ? 'ri-links-line' : 'ri-building-line', href: item.id === 'overview' ? '/workspace/b2b' : `/workspace/b2b?tab=${item.id}`, active: tab === item.id }))} workspaceLabel="B2B Employer Portal" pageTitle={companyName} pageSubtitle={role === 'hr' ? 'HR company administration' : 'Manager company overview'} userName={auth.account?.displayName || undefined} userRole={role === 'hr' ? 'HR' : 'Line Manager'}>
    <div className="space-y-6 p-6"><WorkspaceHeroBanner title={companyName} description={`${role === 'hr' ? 'HR administration' : 'Manager view'} · ${employeeCount} employees · ${data?.progress.averageProgress || 0}% average progress`} icon="ri-building-2-line" stats={[{ label: 'Employees', value: String(employeeCount) }, { label: 'Open actions', value: String(data?.company.outstandingActions || 0), variant: (data?.company.outstandingActions || 0) ? 'danger' : 'success' }]} />
      <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-background-100 p-1">{tabs.map(item => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${tab === item.id ? 'bg-white text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-800'}`}><Icon size={15} />{item.label}</button>; })}</div>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {loading && <div role="status" className="rounded-2xl border border-foreground-100 bg-white p-8 text-sm text-foreground-500">Loading company workspace…</div>}
      {!loading && data && content}
    </div>
  </WorkspaceShell>;
}
