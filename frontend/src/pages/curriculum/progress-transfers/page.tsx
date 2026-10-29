import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ArrowRightLeft, CheckCircle2, Clock3, Eye, Info, Layers, RefreshCw } from 'lucide-react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import { roleNavMap } from '@/mocks/navigation';
import { useAuth } from "@/hooks/useAuth.helpers";
import { Modal } from '@/pages/users/components/Modal';
import { getTransferRequests, getTransferReview, approveTransferRequest, type AdminTransfer, type AdminTransfers, type TransferReview, type TransferMapping } from '@/api/progressTransfer';
import { formatSystemTimestamp } from '@/lib/format';
import { formatHoursMinutes } from '@/utils/learnerJourney';
import styles from './progressTransfers.module.css';
import { componentSuggestions, suggestedMappings } from './componentSuggestions';
import { previewComponentCounts } from './componentCounts';
import { WeekComponentChoices } from './WeekComponentChoices';
import { SourceWeekReview } from './SourceWeekReview';

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
      .then(value => { if (!controller.signal.aborted) { setReview(value); setMappings(suggestedMappings(value)); } })
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
      const result = await approveTransferRequest(selected.requestId, review.csrfToken, { reviewToken: review.reviewToken, mappings });
      if (result.status !== 'approved') throw new Error('The merge was not confirmed. Reload the request before trying again.');
      setSelected(null); setNotice('Progress merged successfully. Completed matches from the old LMS and existing completions in the new LMS now count together, once per component. The old percentage and recorded hours are retained in the transfer record.'); setRefresh(value => value+1);
    } catch (reason) { setSaveError(reason instanceof Error ? reason.message : 'Could not approve this request. Please try again.'); }
    finally { setSaving(false); }
  }
  const pending = data?.requests.filter(row => row.status === 'pending') || [];
  const approved = data?.requests.filter(row => row.status === 'approved') || [];
  const hasMore = data?.nextOffset != null;
  const openRequest = (row: AdminTransfer) => { setSelected(row); setSaveError(''); setNotice(''); };

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
    <div className={styles.guidance}><Info size={19} aria-hidden="true" /><p>Review completed component matches before confirming. Progress in the new module combines existing completions and matched old completions, counting each component once.</p></div>
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
          ? <p>Old LMS progress has been frozen since the learner submitted the request. The table below records the old percentage and hours. After approval, the new percentage is based on completed components in the new module, including matched old completions and existing new completions counted once. It can differ from the old percentage because the modules may contain different components.</p>
          : <p>Approved {requestDate(selected.approvedAt)}. The table shows the old LMS percentage and hours saved before the merge, not the learner's current percentage.</p>}
        <ModuleTable request={selected} />
        <p>Progress moves to the learner's assigned new LMS module; their group membership does not change. The old and new modules can have the same name. All components in the new module remain available for the learner to continue.</p>
        {selected.status === 'approved' && <section className={styles.matching} aria-label="Component counts at approval">
          <h2>Component counts at approval</h2>
          {selected.modules.map(module => <div key={module.moduleId} className={styles.matchModule}>
            <h3>{module.newTitle}</h3>
            {module.componentCounts ? <ComponentCounts title={module.newTitle} counts={module.componentCounts} mergedPercent={module.mergedPercent} />
              : <p>Component counts were not recorded for this earlier transfer.</p>}
          </div>)}
        </section>}
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
  const proposed = useMemo(() => suggestedMappings(review), [review]);
  const selectedTarget = (moduleId: string, sourceRef: string) => mappings.find(mapping => mapping.moduleId === moduleId && mapping.sourceActivityRef === sourceRef)?.targetComponentId;
  const unmatched = review.modules.reduce((count, module) => count + module.sources.filter(source => !source.automaticTargetId && !selectedTarget(module.moduleId, source.sourceActivityRef)).length, 0);
  const matched = review.modules.flatMap(module => module.sources.flatMap(source => {
    const target = module.targets.find(row => row.componentId === (source.automaticTargetId || selectedTarget(module.moduleId, source.sourceActivityRef)));
    return target ? [{ module, source, target }] : [];
  }));
  return <section className={styles.matching} aria-label="Component matching">
    <h2>Component matching</h2>
    <p role="status" className={unmatched ? styles.matchWarning : styles.guidance}>{unmatched
      ? `${unmatched} completed old ${unmatched === 1 ? 'component needs' : 'components need'} a match. Choose each destination below before confirming.`
      : 'All completed old components have a match. Check the review list before confirming.'}</p>
    <p>Only completed old components transfer. Unfinished old components are excluded. Similar names are suggested for your review; unclear matches need a manual choice. Existing new completions are kept, and shared completions count once. Actual transferred hours stay unchanged.</p>
    <p>Name matches are already selected for transfer. Review them before confirming. Open a component selector to browse by week; closing it keeps your match. Each destination can be used once.</p>
    {matched.length > 0 && <details className={styles.matchReview}>
      <summary>Matched components — quick review ({matched.length})</summary>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Matched components review"><table className={styles.moduleTable} aria-label="Matched components review">
        <thead><tr><th scope="col">Completed old component</th><th scope="col">New component</th><th scope="col">Match</th></tr></thead>
        <tbody>{matched.map(({ module, source, target }) => <tr key={`${module.moduleId}:${source.sourceActivityRef}`}>
          <td>{source.title}<small className={styles.matchContext}>{module.title} · {source.week || 'No week specified'}</small></td>
          <td>{target.title}<small className={styles.matchContext}>{target.week || 'No week specified'}</small></td>
          <td>{source.automaticTargetId ? 'Verified source link' : proposed.some(row => row.moduleId === module.moduleId && row.sourceActivityRef === source.sourceActivityRef && row.targetComponentId === target.componentId) ? 'Matched by name — review' : 'Manual selection'}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
    {review.modules.map(module => <div key={module.moduleId} className={styles.matchModule}>
      <h3>{module.title}</h3>
      <ComponentCounts title={module.title} counts={previewComponentCounts(module, mappings)} preview />
      {!module.sources.length && <p>No individual completed activities were recorded in the old module. The new module keeps its existing completions; the old percentage and hours remain in the transfer record.</p>}
      <SourceWeekReview moduleTitle={module.title} sources={module.sources} disabled={disabled}
        isMatched={source => Boolean(source.automaticTargetId || selectedTarget(module.moduleId, source.sourceActivityRef))}>
        {sources => sources.map(source => {
        const value = mappings.find(mapping => mapping.moduleId === module.moduleId && mapping.sourceActivityRef === source.sourceActivityRef);
        const used = new Set([...module.sources.flatMap(row => row.automaticTargetId ? [row.automaticTargetId] : []),
          ...mappings.filter(mapping => mapping.moduleId === module.moduleId && mapping.sourceActivityRef !== source.sourceActivityRef).map(mapping => mapping.targetComponentId)]);
        const automatic = module.targets.find(target => target.componentId === source.automaticTargetId);
        const manualTarget = module.targets.find(target => target.componentId === value?.targetComponentId);
        const nameMatched = proposed.some(row => row.moduleId === module.moduleId && row.sourceActivityRef === source.sourceActivityRef && row.targetComponentId === value?.targetComponentId);
        const { candidates, suggestedId } = componentSuggestions(source, module.targets, used);
        return <div className={styles.matchRow} key={source.sourceActivityRef}>
          <div><strong>{source.title}</strong><small>{source.week || 'No week specified'} · {source.type} · {source.sourceActivityRef}</small></div>
          {source.automaticTargetId ? <div><span className={styles.approvedBadge}>Automatically matched</span><strong>{automatic?.title || source.automaticTargetId}</strong><small>{automatic?.week}</small></div>
            : <div>{manualTarget && <span className={styles.approvedBadge}>{nameMatched ? 'Matched by name — review' : 'Match selected'}</span>}
              <WeekComponentChoices label={`Match ${source.title} (${source.sourceActivityRef}) in ${module.title}`}
                candidates={candidates} selectedId={value?.targetComponentId ?? ''} suggestedId={suggestedId} used={used} disabled={disabled}
                onChange={targetComponentId => onChange([...mappings.filter(mapping => mapping.moduleId !== module.moduleId || mapping.sourceActivityRef !== source.sourceActivityRef),
                  ...(targetComponentId ? [{ moduleId: module.moduleId, sourceActivityRef: source.sourceActivityRef, targetComponentId }] : [])])} />
              {!candidates.length && <small className={styles.error}>No compatible component is available. Check the source type or add the equivalent component to the new module, then reload matches.</small>}
              {manualTarget && <small>New component planned hours: {manualTarget.plannedHours == null ? 'Not specified' : formatHoursMinutes(manualTarget.plannedHours)}. Actual transferred hours are unchanged.</small>}
            </div>}
        </div>;
      })}</SourceWeekReview>
    </div>)}
  </section>;
}

function ComponentCounts({ title, counts, preview = false, mergedPercent }: {
  title: string; counts: ReturnType<typeof previewComponentCounts>; preview?: boolean; mergedPercent?: number;
}) {
  const percent = preview ? (counts.completed === null ? null : counts.total ? Math.round(counts.completed / counts.total * 10000) / 100 : 0) : mergedPercent;
  return <section className={styles.componentCounts} aria-label={`Component counts for ${title}`}>
    <h4>{preview ? 'Components after transfer (preview)' : 'Components at transfer'}</h4>
    <dl>
      <div><dt>Total components</dt><dd>{counts.total}</dd></div>
      <div><dt>Matched from old LMS</dt><dd>{counts.matched}</dd></div>
      <div><dt>Completed components</dt><dd>{counts.completed ?? 'Not available'}</dd></div>
      <div><dt>Remaining components</dt><dd>{counts.remaining ?? 'Not available'}</dd></div>
    </dl>
    {percent != null && <p><strong>{preview ? 'Progress after merge (preview)' : 'Progress at merge'}: {percent}%</strong> — {counts.completed} of {counts.total} completed.</p>}
    <p>{preview ? 'Preview based on the current matches. ' : 'Recorded when this transfer was approved. '}
      Counts use the same components as learner progress. Existing and transferred completions count once. The old percentage is kept as history; recorded hours are preserved.</p>
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
    <thead><tr><th scope="col">Old LMS module</th><th scope="col">New LMS module</th><th scope="col">Old LMS progress</th><th scope="col">Recorded old hours</th></tr></thead>
    <tbody>{request.modules.map(item => <tr key={item.courseRef}>
      <td>{item.oldTitle}<small className={styles.matchContext}>Old LMS course: {item.courseRef.replace(/^legacy:/, '')}</small>{item.demoProgress && <span className={styles.demoBadge}>Demo progress</span>}</td>
      <td>{item.newTitle}<small className={styles.matchContext}>New LMS module: {item.moduleId}</small></td><td className={styles.numeric}>{item.percent}%</td><td className={styles.numeric}>{formatHoursMinutes(item.hours)}</td>
    </tr>)}</tbody>
  </table></div>;
}
