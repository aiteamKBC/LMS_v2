<<<<<<< HEAD
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import { useAuth } from '@/hooks/useAuth';
import { TransferRequests } from './TransferRequestsView';
import styles from './TransferProgress.module.css';

export { TransferRequests } from './TransferRequestsView';

export default function ProgressTransfersPage() {
  const { auth } = useAuth();
  return <WorkspaceShell role="curriculum" roleLabel="Curriculum" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Transfer Progress" pageSubtitle="Review learner requests to move progress to the new LMS.">
    {auth.account?.role === 'admin' ? <TransferRequests /> : <div className={styles.page}><p role="alert">Only administrators can review and approve progress transfers.</p></div>}
  </WorkspaceShell>;
}
=======
import { useEffect, useState } from 'react';
import { ArrowRight, ArrowRightLeft, CheckCircle2, Clock3, Eye, Info, Layers, RefreshCw } from 'lucide-react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import { roleNavMap } from '@/mocks/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Modal } from '@/pages/users/components/Modal';
import { getTransferRequests, getTransferReview, approveTransferRequest, type AdminTransfer, type AdminTransfers, type TransferReview, type TransferMapping } from '@/api/progressTransfer';
import { formatSystemTimestamp } from '@/lib/format';
import { formatHoursMinutes } from '@/utils/learnerJourney';
import styles from './progressTransfers.module.css';

export default function ProgressTransfersPage() {
  const { auth } = useAuth();
  return <WorkspaceShell role="compliance" roleLabel={roleNavMap.apprentice.label} navItems={roleNavMap.apprentice.items} workspaceLabel={roleNavMap.apprentice.workspaceLabel} pageTitle="Transfer Progress" pageSubtitle="Review learner requests to move progress to the new LMS.">
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
  const [review, setReview] = useState<TransferReview | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [reviewRefresh, setReviewRefresh] = useState(0);
  const [mappings, setMappings] = useState<TransferMapping[]>([]);
  const requestId = selected?.requestId;
  const requestStatus = selected?.status;
  useEffect(() => {
    setReview(null); setReviewError(''); setMappings([]);
    if (!requestId || requestStatus !== 'pending') return;
    const controller = new AbortController();
    void getTransferReview(requestId, controller.signal)
      .then(value => { if (!controller.signal.aborted) setReview(value); })
      .catch(reason => { if (!controller.signal.aborted) setReviewError(reason instanceof Error ? reason.message : 'Could not load component matches.'); });
    return () => controller.abort();
  }, [requestId, requestStatus, reviewRefresh]);
  const unresolved = review?.modules.reduce((count, module) => count + module.sources.filter(source =>
    !source.automaticTargetId && !mappings.some(mapping => mapping.moduleId === module.moduleId && mapping.sourceActivityRef === source.sourceActivityRef)).length, 0) ?? 0;
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
    if (!selected || selected.status !== 'pending' || !data || saving || !review || unresolved) return;
    setSaving(true); setSaveError('');
    try {
      await approveTransferRequest(selected.requestId, review.csrfToken, { reviewToken: review.reviewToken, mappings });
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
      {selected.status === 'pending' && <button type="button" onClick={() => void confirm()} disabled={saving || !review || unresolved > 0} className={styles.primaryButton}>{saving ? 'Transferring…' : 'Confirm'}</button>}
    </>}>
      <div className={styles.dialogBody}>
        <div className={styles.dialogSummary}><div><strong>{selected.programme || 'Programme not specified'}</strong><span>Requested {requestDate(selected.requestedAt)}</span></div><span className={selected.status === 'pending' ? styles.pendingBadge : styles.approvedBadge}>{selected.status === 'pending' ? 'Pending approval' : 'Approved'}</span></div>
        {selected.status === 'pending'
          ? <p>This transfers the saved percentage and hours for every module below. Old LMS progress has been frozen since the learner submitted the request. Verified matching activities stay complete within the transferred percentage, without counting twice.</p>
          : <p>Approved {requestDate(selected.approvedAt)}. These are the progress percentages and hours saved at the time of transfer.</p>}
        <ModuleTable request={selected} />
        {selected.status === 'approved' && selected.modules.some(module => module.componentMatches?.length) && <section className={styles.matching} aria-label="Approved component matches">
          <h2>Approved component matches</h2>
          {selected.modules.filter(module => module.componentMatches?.length).map(module => <div key={module.moduleId} className={styles.matchModule}>
            <h3>{module.newTitle}</h3>{module.componentMatches?.map(match => <div key={match.sourceActivityRef} className={styles.matchRow}>
              <div><strong>{match.sourceTitle}</strong><small>{match.sourceActivityRef}</small></div>
              <div><strong>{match.targetTitle}</strong><small>{match.manual ? 'Manual match' : 'Automatic match'}</small>
                {match.manual && <small>New component planned hours: {match.plannedHours == null ? 'Not specified' : formatHoursMinutes(match.plannedHours)}. Actual transferred hours are unchanged.</small>}</div>
            </div>)}
          </div>)}
        </section>}
        {selected.status === 'pending' && <>
          {reviewError ? <div role="alert" className={styles.error}>{reviewError} <button type="button" className={styles.secondaryButton} onClick={() => setReviewRefresh(value => value + 1)}>Retry matching</button></div>
            : !review ? <p role="status">Checking component matches…</p>
              : <ComponentMatching review={review} mappings={mappings} disabled={saving} onChange={setMappings} />}
          {(review || saveError) && <button type="button" disabled={saving} className={styles.secondaryButton} onClick={() => { setReviewRefresh(value => value + 1); setSaveError(''); }}>Reload component matches</button>}
        </>}
        {saveError && <p role="alert" className={styles.error}>{saveError}</p>}
      </div>
    </Modal>}
  </section>;
}

function ComponentMatching({ review, mappings, disabled, onChange }: {
  review: TransferReview; mappings: TransferMapping[]; disabled: boolean; onChange: (value: TransferMapping[]) => void;
}) {
  const unmatched = review.modules.reduce((count, module) => count + module.sources.filter(source => !source.automaticTargetId).length, 0);
  return <section className={styles.matching} aria-label="Component matching">
    <h2>Component matching</h2>
    <p role="status" className={unmatched ? styles.matchWarning : styles.guidance}>{unmatched
      ? `${unmatched} completed old ${unmatched === 1 ? 'component has' : 'components have'} no automatic match. Review each item below before confirming.`
      : 'All completed source components with recorded activity progress have been matched.'}</p>
    <p>Every completed old component needs a match before approval. Choose the equivalent component in the new module. Matched completions are included in the transferred percentage; actual transferred hours stay unchanged.</p>
    {review.modules.map(module => <div key={module.moduleId} className={styles.matchModule}>
      <h3>{module.title}</h3>
      {!module.sources.length && <p>No individual completed activities were recorded for this module. Its saved percentage and hours will still transfer.</p>}
      {module.sources.map(source => {
        const value = mappings.find(mapping => mapping.moduleId === module.moduleId && mapping.sourceActivityRef === source.sourceActivityRef);
        const used = new Set([...module.sources.flatMap(row => row.automaticTargetId ? [row.automaticTargetId] : []),
          ...mappings.filter(mapping => mapping.moduleId === module.moduleId && mapping.sourceActivityRef !== source.sourceActivityRef).map(mapping => mapping.targetComponentId)]);
        const automatic = module.targets.find(target => target.componentId === source.automaticTargetId);
        const manualTarget = module.targets.find(target => target.componentId === value?.targetComponentId);
        const candidates = module.targets.filter(target => target.type === source.type && source.type !== 'unknown');
        return <div className={styles.matchRow} key={source.sourceActivityRef}>
          <div><strong>{source.title}</strong><small>{source.week || 'No week specified'} · {source.type} · {source.sourceActivityRef}</small></div>
          {source.automaticTargetId ? <div><span className={styles.approvedBadge}>Automatically matched</span><strong>{automatic?.title || source.automaticTargetId}</strong><small>{automatic?.week}</small></div>
            : <label><span>Match in new module</span><select aria-label={`Match ${source.title} (${source.sourceActivityRef}) in ${module.title}`} disabled={disabled} value={value?.targetComponentId ?? ''}
              onChange={event => onChange([...mappings.filter(mapping => mapping.moduleId !== module.moduleId || mapping.sourceActivityRef !== source.sourceActivityRef),
                ...(event.target.value ? [{ moduleId: module.moduleId, sourceActivityRef: source.sourceActivityRef, targetComponentId: event.target.value }] : [])])}>
              <option value="">Choose a matching component</option>
              {candidates.map(target => <option key={target.componentId} value={target.componentId} disabled={used.has(target.componentId)}>{target.week ? `${target.week} · ` : ''}{target.title} ({target.type} · {target.componentId})</option>)}
            </select><small>Choose only an equivalent activity. Each destination can be used once.</small>
              {!candidates.length && <small className={styles.error}>No compatible component is available. Check the source type or add the equivalent component to the new module, then reload matches.</small>}
              {manualTarget && <small>New component planned hours: {manualTarget.plannedHours == null ? 'Not specified' : formatHoursMinutes(manualTarget.plannedHours)}. Actual transferred hours are unchanged.</small>}
            </label>}
        </div>;
      })}
    </div>)}
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
>>>>>>> main
