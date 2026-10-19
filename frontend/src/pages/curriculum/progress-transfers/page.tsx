import { useEffect, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import { curriculumNavItems } from '@/mocks/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Modal } from '@/pages/users/components/Modal';
import { getTransferRequests, approveTransferRequest, type AdminTransfer, type AdminTransfers } from '@/api/progressTransfer';
import { formatSystemTimestamp } from '@/lib/format';
import { formatHoursMinutes } from '@/utils/learnerJourney';

export default function ProgressTransfersPage() {
  const { auth } = useAuth();
  return <WorkspaceShell role="curriculum" roleLabel="Curriculum" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Transfer Progress" pageSubtitle="Review learner requests to move progress to the new LMS.">
    <PageContainer>{auth.account?.role === 'admin' ? <TransferRequests /> : <p role="alert">Only administrators can review and approve progress transfers.</p>}</PageContainer>
  </WorkspaceShell>;
}

export function TransferRequests() {
  const [data, setData] = useState<AdminTransfers | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<AdminTransfer | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void getTransferRequests(0, controller.signal).then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load transfer requests.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  async function more() {
    if (!data || data.nextOffset == null || loading) return;
    setLoading(true); setError('');
    try {
      const next = await getTransferRequests(data.nextOffset);
      setData({ ...next, requests: [...data.requests, ...next.requests.filter(row => !data.requests.some(item => item.requestId === row.requestId))] });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load transfer requests.'); }
    finally { setLoading(false); }
  }
  async function confirm() {
    if (!selected || !data || saving) return;
    setSaving(true); setSaveError('');
    try {
      await approveTransferRequest(selected.requestId, data.csrfToken);
      setSelected(null); setNotice('Transfer approved. The learner can now open the new modules.'); setRefresh(value => value+1);
    } catch (reason) { setSaveError(reason instanceof Error ? reason.message : 'Could not approve this request. Please try again.'); }
    finally { setSaving(false); }
  }
  return <section className="space-y-4" aria-label="Progress transfer requests" aria-busy={loading}>
    <div className="flex items-center justify-between gap-4"><h1 className="text-xl font-semibold">Transfer Progress</h1><button type="button" disabled={loading || saving} className="rounded-lg border px-4 py-2" onClick={() => setRefresh(value => value+1)}>Refresh</button></div>
    <p className="text-sm text-foreground-600">Confirm each request to transfer all listed module percentages and hours. Completed activities with verified matching source identities stay completed within the transferred percentage, without counting twice.</p>
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Loading requests…</p>}
    {data && !data.requests.length && !loading && <p className="rounded-xl border bg-white p-6">No transfer requests yet.</p>}
    {data?.requests.map(row => <article key={row.requestId} className="rounded-xl border border-foreground-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{row.learnerName}</h2><p className="text-sm text-foreground-500">{row.programme}</p><p className="mt-1 text-xs text-foreground-500">Requested {formatSystemTimestamp(row.requestedAt)}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${row.status === 'pending' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>{row.status === 'pending' ? 'Pending approval' : 'Approved'}</span></div>
      <ModuleTable request={row} />
      {row.status === 'pending' ? <button type="button" disabled={saving || loading} className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => { setSelected(row); setSaveError(''); }}>Review transfer</button>
        : <p className="mt-3 text-xs text-foreground-500">Approved {row.approvedAt ? formatSystemTimestamp(row.approvedAt) : ''}</p>}
    </article>)}
    {data?.nextOffset != null && <button type="button" disabled={loading || saving} onClick={() => void more()} className="rounded-lg border px-4 py-2">Load more</button>}
    {selected && <Modal title={`Confirm transfer for ${selected.learnerName}`} onClose={() => setSelected(null)} dismissible={!saving} footer={<><button type="button" onClick={() => setSelected(null)} disabled={saving} className="rounded-lg border px-4 py-2">Cancel</button><button type="button" onClick={() => void confirm()} disabled={saving} className="rounded-lg bg-primary-600 px-4 py-2 text-white disabled:opacity-50">{saving ? 'Transferring…' : 'Confirm'}</button></>}>
      <div className="space-y-3 p-5 text-sm"><p>This transfers the saved percentage and hours for every module below. Old LMS progress has been frozen since the learner submitted the request. Activities in the new LMS will not be marked complete by this transfer.</p><ModuleTable request={selected} />{saveError && <p role="alert">{saveError}</p>}</div>
    </Modal>}
  </section>;
}

function ModuleTable({ request }: { request: AdminTransfer }) {
  return <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-foreground-500"><th className="py-2 pr-4">Old LMS module</th><th className="py-2 pr-4">New LMS module</th><th className="py-2 pr-4">Progress</th><th className="py-2">Hours</th></tr></thead><tbody>{request.modules.map(item => <tr key={item.courseRef} className="border-b last:border-0"><td className="py-3 pr-4">{item.oldTitle}{item.demoProgress && <span className="ml-2 text-xs text-amber-700">Demo progress</span>}</td><td className="py-3 pr-4">{item.newTitle}</td><td className="whitespace-nowrap py-3 pr-4">{item.percent}%</td><td className="whitespace-nowrap py-3">{formatHoursMinutes(item.hours)}</td></tr>)}</tbody></table></div>;
}
