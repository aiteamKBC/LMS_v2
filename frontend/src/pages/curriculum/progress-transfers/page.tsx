import { useEffect, useState } from 'react';
import { ArrowRight, ArrowRightLeft, CheckCircle2, Clock3, Eye, Info, Layers, RefreshCw } from 'lucide-react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import { curriculumNavItems } from '@/mocks/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Modal } from '@/pages/users/components/Modal';
import { getTransferRequests, approveTransferRequest, type AdminTransfer, type AdminTransfers } from '@/api/progressTransfer';
import { formatSystemTimestamp } from '@/lib/format';
import { formatHoursMinutes } from '@/utils/learnerJourney';
import styles from './progressTransfers.module.css';

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
    if (!selected || selected.status !== 'pending' || !data || saving) return;
    setSaving(true); setSaveError('');
    try {
      await approveTransferRequest(selected.requestId, data.csrfToken);
      setSelected(null); setNotice('Transfer approved. The learner can now open the new modules.'); setRefresh(value => value+1);
    } catch (reason) { setSaveError(reason instanceof Error ? reason.message : 'Could not approve this request. Please try again.'); }
    finally { setSaving(false); }
  }
  const pending = data?.requests.filter(row => row.status === 'pending') || [];
  const approved = data?.requests.filter(row => row.status === 'approved') || [];
  const hasMore = data?.nextOffset != null;
  const openRequest = (row: AdminTransfer) => { setSelected(row); setSaveError(''); };

  return <section className={styles.page} aria-label="Progress transfer requests" aria-busy={loading}>
    <header className={styles.pageHeader}>
      <div className={styles.heading}>
        <span className={styles.pageIcon}><ArrowRightLeft size={23} aria-hidden="true" /></span>
        <div><h1>Transfer Progress</h1><p>Review learner requests and keep track of completed transfers to the new LMS.</p></div>
      </div>
      <button type="button" disabled={loading || saving} className={styles.secondaryButton} onClick={() => setRefresh(value => value+1)}>
        <RefreshCw size={16} aria-hidden="true" />Refresh
      </button>
    </header>
    <div className={styles.guidance}><Info size={19} aria-hidden="true" /><p>Review the modules, progress and hours before confirming a request. Matching activities already completed stay complete within the transferred percentage, without counting twice.</p></div>
    {notice && <p role="status" className={styles.success}><CheckCircle2 size={18} aria-hidden="true" />{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {loading && <p role="status" className={styles.loading}>Loading requests…</p>}
    {data && <>
      <RequestTable status="pending" requests={pending} busy={loading || saving} hasMore={hasMore} onOpen={openRequest} />
      <RequestTable status="approved" requests={approved} busy={loading || saving} hasMore={hasMore} onOpen={openRequest} />
    </>}
    {hasMore && <div className={styles.pagination}><p>Showing {data?.requests.length} loaded requests. Load more to see additional pending and approved requests.</p><button type="button" disabled={loading || saving} onClick={() => void more()} className={styles.secondaryButton}>Load more</button></div>}
    {selected && <Modal title={`${selected.status === 'pending' ? 'Confirm transfer' : 'Transfer details'} for ${selected.learnerName}`} onClose={() => setSelected(null)} dismissible={!saving} size="max-w-5xl" footer={<>
      <button type="button" onClick={() => setSelected(null)} disabled={saving} className={styles.secondaryButton}>{selected.status === 'pending' ? 'Cancel' : 'Close'}</button>
      {selected.status === 'pending' && <button type="button" onClick={() => void confirm()} disabled={saving} className={styles.primaryButton}>{saving ? 'Transferring…' : 'Confirm'}</button>}
    </>}>
      <div className={styles.dialogBody}>
        <div className={styles.dialogSummary}><div><strong>{selected.programme || 'Programme not specified'}</strong><span>Requested {requestDate(selected.requestedAt)}</span></div><span className={selected.status === 'pending' ? styles.pendingBadge : styles.approvedBadge}>{selected.status === 'pending' ? 'Pending approval' : 'Approved'}</span></div>
        {selected.status === 'pending'
          ? <p>This transfers the saved percentage and hours for every module below. Old LMS progress has been frozen since the learner submitted the request. Verified matching activities stay complete within the transferred percentage, without counting twice.</p>
          : <p>Approved {requestDate(selected.approvedAt)}. These are the progress percentages and hours saved at the time of transfer.</p>}
        <ModuleTable request={selected} />
        {saveError && <p role="alert" className={styles.error}>{saveError}</p>}
      </div>
    </Modal>}
  </section>;
}

function requestDate(value: string | null) {
  return value ? formatSystemTimestamp(value, { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not recorded';
}

function RequestTable({ status, requests, busy, hasMore, onOpen }: {
  status: AdminTransfer['status']; requests: AdminTransfer[]; busy: boolean; hasMore: boolean;
  onOpen: (request: AdminTransfer) => void;
}) {
  const pending = status === 'pending';
  const title = pending ? 'Pending requests' : 'Approved requests';
  const titleId = `transfer-${status}-title`;
  return <section className={styles.tableCard} aria-labelledby={titleId}>
    <header className={styles.tableHeader}>
      <span className={pending ? styles.pendingIcon : styles.approvedIcon}>
        {pending ? <Clock3 size={21} aria-hidden="true" /> : <CheckCircle2 size={21} aria-hidden="true" />}
      </span>
      <div className={styles.sectionHeading}><div><h2 id={titleId}>{title}</h2><span className={styles.count}>{requests.length}{hasMore ? ' loaded' : ''}</span></div>
        <p>{pending ? 'Review and confirm requests waiting for your approval.' : 'A record of requests that have been approved and transferred.'}</p>
      </div>
    </header>
    <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={`${title} table`}>
      <table className={`${styles.requestsTable} ${pending ? '' : styles.historyTable}`} aria-label={title}>
        <thead><tr>
          <th scope="col">Learner</th><th scope="col">Programme</th><th scope="col">Modules</th>
          <th scope="col">Requested</th>{!pending && <th scope="col">Approved</th>}<th scope="col" className={styles.actions}>Action</th>
        </tr></thead>
        <tbody>{requests.length ? requests.map(row => <tr key={row.requestId}>
          <th scope="row"><span className={styles.learnerName}>{row.learnerName || 'Unnamed learner'}</span></th>
          <td><span className={styles.programme}>{row.programme || 'Not specified'}</span></td>
          <td><div className={styles.modulesSummary}><strong><Layers size={14} aria-hidden="true" />{row.modules.length} {row.modules.length === 1 ? 'module' : 'modules'}</strong>
            <span title={row.modules[0]?.newTitle}>{row.modules[0]?.newTitle || 'No modules listed'}</span>
            {row.modules.length > 1 && <small>+{row.modules.length - 1} more</small>}
            {row.modules.some(module => module.demoProgress) && <span className={styles.demoBadge}>Demo progress</span>}
          </div></td>
          <td className={styles.date}>{requestDate(row.requestedAt)}</td>
          {!pending && <td className={styles.date}><span className={styles.approvedDate}><CheckCircle2 size={14} aria-hidden="true" />{requestDate(row.approvedAt)}</span></td>}
          <td className={styles.actions}><button type="button" disabled={busy} className={pending ? styles.primaryButton : styles.secondaryButton} onClick={() => onOpen(row)}>
            {pending ? <>Review transfer<ArrowRight size={15} aria-hidden="true" /></> : <><Eye size={15} aria-hidden="true" />View details</>}
          </button></td>
        </tr>) : <tr><td colSpan={pending ? 5 : 6} className={styles.emptyState}>
          <strong>{pending ? 'No pending requests' : 'No approved requests yet'}</strong>
          <p>{hasMore ? 'No matching requests in the loaded results. Use Load more to see additional requests.'
            : pending ? 'New learner requests will appear here for review.' : 'Requests will appear here after you confirm a transfer.'}</p>
        </td></tr>}</tbody>
      </table>
    </div>
  </section>;
}

function ModuleTable({ request }: { request: AdminTransfer }) {
  return <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Module transfer details"><table className={styles.moduleTable} aria-label="Module transfer details">
    <thead><tr><th scope="col">Old LMS module</th><th scope="col">New LMS module</th><th scope="col">Progress</th><th scope="col">Hours</th></tr></thead>
    <tbody>{request.modules.map(item => <tr key={item.courseRef}>
      <td>{item.oldTitle}{item.demoProgress && <span className={styles.demoBadge}>Demo progress</span>}</td>
      <td>{item.newTitle}</td><td className={styles.numeric}>{item.percent}%</td><td className={styles.numeric}>{formatHoursMinutes(item.hours)}</td>
    </tr>)}</tbody>
  </table></div>;
}
