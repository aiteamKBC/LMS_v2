import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowLeftRight, ArrowRight, CheckCheck, Download, Info, Layers, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AdminTransfer, TransferDecisions, TransferMapping, TransferModule, TransferReview } from '@/api/progressTransfer';
import { Modal } from '@/pages/users/components/Modal';
import { formatSystemTimestamp } from '@/lib/format';
import { formatHoursMinutes } from '@/utils/learnerJourney';
import { useTransferRequests } from './useTransferRequests';
import { useTransferReview } from './useTransferReview';
import { TransferRequestList } from './TransferRequestList';
import { EnrolmentHero } from '@/pages/users/presentation/EnrolmentPage';
import styles from './TransferProgress.module.css';
import matchingStyles from './progressTransfers.module.css';
import { componentSuggestions, suggestedMappings } from './componentSuggestions';
import { previewComponentCounts } from './componentCounts';
import { SourceWeekReview } from './SourceWeekReview';
import { WeekComponentChoices } from './WeekComponentChoices';
import { transferLogCsv } from './transferExport';
import motion from '@/pages/users/presentation/EnrolmentMotion.module.css';

const date = (value: string | null, full = false) => value && Number.isFinite(Date.parse(value))
  ? formatSystemTimestamp(value, { day: 'numeric', month: 'short', year: 'numeric', ...(full ? { hour: '2-digit', minute: '2-digit' } : {}) }) : 'Not provided';
const validHours = (value: number) => Number.isFinite(value) && value >= 0;
const hours = (modules: TransferModule[]) => modules.every(item => validHours(item.hours)) ? modules.reduce((sum, item) => sum + item.hours, 0) : null;
const hoursLabel = (value: number | null) => value === null ? 'Unavailable' : formatHoursMinutes(value);
const percent = (value: number) => Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const moduleKey = (item: TransferModule) => `${item.courseRef}:${item.moduleId}`;
function Badge({ approved = false, children }: { approved?: boolean; children: ReactNode }) {
  return <span className={`${styles.badge} ${approved ? styles.approved : ''}`}>{children}</span>;
}

function SavedProgress({ item }: { item: TransferModule }) {
  const value = percent(item.percent);
  return value === null ? <small>Progress unavailable</small> : <div className={styles.savedProgress} role="progressbar" aria-label={`Saved progress for ${item.oldTitle}`} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${value}%` }} /></div>;
}

const plannedHours = (value: number | null | undefined) => `New component planned hours: ${value == null ? 'Not specified' : formatHoursMinutes(value)}. Actual transferred hours are unchanged.`;

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
  return <section className={matchingStyles.matching} aria-label="Component matching">
    <h2>Component matching</h2>
    <p role="status" className={unmatched ? matchingStyles.matchWarning : matchingStyles.guidance}>{unmatched
      ? `${unmatched} completed old ${unmatched === 1 ? 'component needs' : 'components need'} a match. Choose each destination below before confirming.`
      : 'All completed old components have a match. Check the review list before confirming.'}</p>
    <p>Only completed old components transfer. Unfinished old components are excluded. Similar names are suggested for your review; unclear matches need a manual choice. Matched completions are included in the transferred percentage; actual transferred hours stay unchanged.</p>
    <p>Name matches are already selected for transfer. Review them before confirming. Open a component selector to browse by week; closing it keeps your match. Each destination can be used once.</p>
    {matched.length > 0 && <details className={matchingStyles.matchReview}>
      <summary>Matched components — quick review ({matched.length})</summary>
      <div className={matchingStyles.tableScroll} tabIndex={0} role="region" aria-label="Matched components review"><table className={matchingStyles.moduleTable} aria-label="Matched components review">
        <thead><tr><th scope="col">Completed old component</th><th scope="col">New component</th><th scope="col">Match</th></tr></thead>
        <tbody>{matched.map(({ module, source, target }) => <tr key={`${module.moduleId}:${source.sourceActivityRef}`}>
          <td>{source.title}<small className={matchingStyles.matchContext}>{module.title} · {source.week || 'No week specified'}</small></td>
          <td>{target.title}<small className={matchingStyles.matchContext}>{target.week || 'No week specified'}</small></td>
          <td>{source.automaticTargetId ? 'Verified source link' : proposed.some(row => row.moduleId === module.moduleId && row.sourceActivityRef === source.sourceActivityRef && row.targetComponentId === target.componentId) ? 'Matched by name — review' : 'Manual selection'}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
    {review.modules.map(module => <div key={module.moduleId} className={matchingStyles.matchModule}>
      <h3>{module.title}</h3>
      <ComponentCounts title={module.title} counts={previewComponentCounts(module, mappings)} preview existing={module.completedTargetIds === undefined ? undefined : new Set(module.completedTargetIds.filter(id => module.targets.some(target => target.componentId === id))).size} />
      {!module.sources.length && <p>No individual completed activities were recorded for this module. Its saved percentage and hours will still transfer.</p>}
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
        return <div className={matchingStyles.matchRow} key={source.sourceActivityRef}>
          <div><strong>{source.title}</strong><small>{source.week || 'No week specified'} · {source.type} · {source.sourceActivityRef}</small></div>
          {source.automaticTargetId ? <div><span className={matchingStyles.approvedBadge}>Automatically matched</span><strong>{automatic?.title || source.automaticTargetId}</strong><small>{automatic?.week}</small></div>
            : <div>{manualTarget && <span className={matchingStyles.approvedBadge}>{nameMatched ? 'Matched by name — review' : 'Match selected'}</span>}
              <WeekComponentChoices label={`Match ${source.title} (${source.sourceActivityRef}) in ${module.title}`}
                candidates={candidates} selectedId={value?.targetComponentId ?? ''} suggestedId={suggestedId} used={used} disabled={disabled}
                onChange={targetComponentId => onChange([...mappings.filter(mapping => mapping.moduleId !== module.moduleId || mapping.sourceActivityRef !== source.sourceActivityRef),
                  ...(targetComponentId ? [{ moduleId: module.moduleId, sourceActivityRef: source.sourceActivityRef, targetComponentId }] : [])])} />
              {!candidates.length && <small className={matchingStyles.error}>No compatible component is available. Check the source type or add the equivalent component to the new module, then reload matches.</small>}
              {manualTarget && <small>New component planned hours: {manualTarget.plannedHours == null ? 'Not specified' : formatHoursMinutes(manualTarget.plannedHours)}. Actual transferred hours are unchanged.</small>}
            </div>}
        </div>;
      })}</SourceWeekReview>
    </div>)}
  </section>;
}

function ComponentCounts({ title, counts, preview = false, existing }: {
  title: string; counts: ReturnType<typeof previewComponentCounts>; preview?: boolean; existing?: number;
}) {
  return <section className={matchingStyles.componentCounts} aria-label={`Component counts for ${title}`}>
    <h4>{preview ? 'Components after transfer (preview)' : 'Components at transfer'}</h4>
    <dl>
      <div><dt>Total components</dt><dd>{counts.total}</dd></div>
      <div><dt>Matched from old LMS</dt><dd>{counts.matched}</dd></div>
      {preview && <><div><dt>Existing completions</dt><dd>{existing ?? 'Not available'}</dd></div><div><dt>Additional matched completions</dt><dd>{existing === undefined || counts.completed === null ? 'Not available' : counts.completed - existing}</dd></div></>}
      <div><dt>Completed components</dt><dd>{counts.completed ?? 'Not available'}</dd></div>
      <div><dt>Remaining components</dt><dd>{counts.remaining ?? 'Not available'}</dd></div>
    </dl>
    <p>{preview ? 'Preview based on the current matches. ' : 'Recorded when this transfer was approved. '}
      Counts cover available components in the new module. Existing and transferred completions count once; the saved percentage and hours stay unchanged.</p>
  </section>;
}

function ApprovedMatches({ request }: { request: AdminTransfer }) {
  const modules = request.modules.filter(module => module.componentMatches?.length);
  if (!modules.length) return null;
  return <section className={styles.matching} aria-label="Approved component matches">
    <h3>Approved component matches</h3>
    {modules.map(module => <div key={moduleKey(module)} className={styles.matchModule}>
      <h4>{module.newTitle}</h4>{module.componentMatches?.map(match => <div key={match.sourceActivityRef} className={styles.matchRow}>
        <div><strong>{match.sourceTitle}</strong><small>{match.sourceActivityRef}</small></div>
        <div><strong>{match.targetTitle}</strong><small>{match.manual ? 'Manual match' : 'Automatic match'}</small>
          {match.manual && <small>{plannedHours(match.plannedHours)}</small>}</div>
      </div>)}
    </div>)}
  </section>;
}

function RequestDetails({ request, saving, busy, canApprove, error, onClose, onApprove, onClearError, returnFocusRef }: {
  request: AdminTransfer; saving: boolean; busy: boolean; canApprove: boolean; error: string; onClose: () => void; returnFocusRef: RefObject<HTMLButtonElement | null>;
  onApprove: (decisions: TransferDecisions, csrfToken: string) => void; onClearError: () => void;
}) {
  const pending = request.status === 'pending';
  const matching = useTransferReview(request.requestId, pending);
  const { review } = matching;
  const ready = !!review && matching.unresolved === 0;
  const approve = () => { if (review && ready) onApprove({ reviewToken: review.reviewToken, mappings: matching.mappings }, review.csrfToken); };
  return <Modal returnFocusRef={returnFocusRef} className={styles.drawer} title={<span className={styles.drawerHeader}>
    <span className={styles.drawerIcon}><ArrowLeftRight size={18} aria-hidden="true" /></span>
    <span className={styles.drawerTitle}><span className={styles.eyebrow}>Transfer progress</span><strong>{request.learnerName}</strong><span>{request.programme || 'Programme not provided'}</span></span>
    <Badge approved={!pending}>{pending ? 'Awaiting decision' : 'Approved'}</Badge>
  </span>} onClose={onClose} dismissible={!saving} footer={<>
    <button type="button" className={`${styles.button} ${styles.cancel}`} disabled={saving} onClick={onClose}>{pending ? 'Cancel' : 'Close'}</button>
    {pending && <>
      <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || !canApprove || !ready} onClick={approve}><CheckCheck size={14} aria-hidden="true" />{saving ? 'Transferring…' : 'Approve transfer'}</button></>}
  </>}>
    <div className={styles.details} aria-busy={busy}>
      <section><h3>Request</h3><dl className={styles.requestFacts}>
        <div><dt>Learner</dt><dd>{request.learnerName}</dd></div><div><dt>Current learner programme</dt><dd>{request.programme || 'Not provided'}</dd></div>
        <div><dt>Enrolment ID</dt><dd>{request.learnerId}</dd></div><div><dt>Learner type</dt><dd>{request.learnerKind === 'commercial' ? 'Commercial' : 'Apprenticeship'}</dd></div>
        <div><dt>Requested</dt><dd>{date(request.requestedAt, true)}</dd></div><div><dt>Request ID</dt><dd>{request.requestId}</dd></div>
        {!pending && <div><dt>Approved</dt><dd>{date(request.approvedAt, true)}</dd></div>}
      </dl></section>
      <section className={styles.detailHours} aria-label="Request hours"><span>{pending ? 'Recorded hours in request' : 'Hours carried over'}</span><strong>{hoursLabel(hours(request.modules))}</strong><p>Saved recorded hours across all {request.modules.length} modules in this request. The recorded hours are preserved when this request is approved.</p></section>
      <p>Progress moves to the learner's assigned new LMS module; their group membership does not change. The old and new modules can have the same name. All components in the new module remain available for the learner to continue.</p>
      <section><h3>{request.modules.length} modules in this request</h3><ul className={styles.moduleDetails}>{request.modules.map(item => <li key={moduleKey(item)}>
        <div className={styles.mapping}><div><strong>{item.oldTitle}</strong><small>Old LMS course: {item.courseRef.replace(/^legacy:/, '')}</small></div><ArrowRight size={14} aria-hidden="true" /><div><strong>{item.newTitle}</strong><small>New LMS module: {item.moduleId}</small></div></div>
        <div className={styles.moduleFacts}><Badge>{percent(item.percent) === null ? 'Progress unavailable' : `${item.percent}% saved progress`}</Badge><span>{hoursLabel(validHours(item.hours) ? item.hours : null)} recorded</span>{item.demoProgress && <Badge>Demo progress</Badge>}</div><SavedProgress item={item} />
      </li>)}</ul></section>
      {pending && <>
        {matching.error ? <div role="alert" className={styles.error}>{matching.error}<button type="button" onClick={matching.reload}>Retry matching</button></div>
          : !review ? <p role="status" className={styles.matchStatus}>Checking component matches…</p>
            : <ComponentMatching review={review} mappings={matching.mappings} disabled={saving} onChange={matching.setMappings} />}
        {(review || error) && <button type="button" className={styles.button} disabled={saving} onClick={() => { matching.reload(); onClearError(); }}><RefreshCw size={13} aria-hidden="true" />Reload component matches</button>}
      </>}
      {!pending && <section className={styles.matching} aria-label="Component counts at approval">
        <h3>Component counts at approval</h3>
        {request.modules.map(module => <div key={moduleKey(module)} className={styles.matchModule}>
          <h4>{module.newTitle}</h4>
          {module.componentCounts ? <ComponentCounts title={module.newTitle} counts={module.componentCounts} />
            : <p>Component counts were not recorded for this earlier transfer.</p>}
        </div>)}
      </section>}
      {!pending && <ApprovedMatches request={request} />}
      <div className={styles.information}><Layers size={16} aria-hidden="true" /><div><strong>Before you confirm</strong>Existing completions and matched old completions count once per component. Approval validates the selected request and module assignments on the server. Recorded hours and historical learning records are preserved.</div></div>
      <p className={styles.historyNote}><ShieldCheck size={14} aria-hidden="true" /> Historic learning records and evidence are retained.</p>
      {pending && !canApprove && <p className={styles.error}>Refresh requests before approving this transfer.</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  </Modal>;
}

export function TransferRequests() {
  const { data, reading, saving, error, saveError, notice, needsRefresh, refresh, more, approve, clearSaveError } = useTransferRequests();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const selected = data?.requests.find(row => row.requestId === selectedId);
  useEffect(() => {
    // An approved row leaves Pending. Return keyboard users to the active tab
    // when the modal's original review trigger no longer exists.
    if (selectedId === null && trigger.current && !trigger.current.isConnected) {
      document.getElementById('curriculum-progress-transfers')?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
    }
  }, [selectedId]);
  const busy = !!reading || saving;
  const complete = !!data && data.nextOffset === null;
  const pendingCount = data?.requests.filter(row => row.status === 'pending').length ?? 0;
  const approvedRequests = data?.requests.filter(row => row.status === 'approved') ?? [];
  const recognisedHours = hours(approvedRequests.flatMap(row => row.modules));
  const exportLog = () => {
    if (!data || !complete || busy || needsRefresh) return;
    const url = URL.createObjectURL(new Blob([transferLogCsv(data.requests)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'transfer-progress.csv';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const canApprove = !!data?.csrfToken && !needsRefresh;
  const review = (requestId: string, button: HTMLButtonElement) => { trigger.current = button; clearSaveError(); setSelectedId(requestId); };
  const close = () => { if (!saving) setSelectedId(null); };
  const confirm = async (decisions: TransferDecisions, csrfToken: string) => {
    if (selected && await approve(selected.requestId, decisions, csrfToken)) setSelectedId(null);
  };

  return <div id="curriculum-progress-transfers" className={`${styles.page} ${motion.page}`}>
    <EnrolmentHero title="Transfer progress" breadcrumbLabel="Transfer progress" image="transfers" className={`${styles.hero} ${motion.cardEnter}`}
      icon="ri-arrow-left-right-line" eyebrow="Enrolment operations"
      description="Find a request, check what can be carried across, and review the decision without leaving the list."
      metadata={<p className={styles.heroSummary}>{complete ? <><span className={styles.waitingBadge}><span aria-hidden="true" />{pendingCount} requests waiting</span><span>{approvedRequests.length} approved · {hoursLabel(recognisedHours)} recognised{needsRefresh ? ' · Refresh required' : ''}</span></> : data ? 'Loading the complete request summary…' : reading ? 'Loading transfer requests…' : 'Request summary unavailable'}</p>}
      actions={<><button type="button" className={styles.button} disabled={!complete || busy || needsRefresh} onClick={exportLog}><Download size={15} aria-hidden="true" />Export log</button><button type="button" className={styles.button} disabled={busy} onClick={refresh}><RefreshCw size={15} aria-hidden="true" />Refresh</button></>} />
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    {error && <div role="alert" className={styles.error}>{error}{data && <span> Showing the last retrieved requests.</span>}<button type="button" className={styles.button} disabled={busy} onClick={refresh}>Retry refresh</button></div>}
    {reading && <p role="status" className={styles.scopeNote}>{reading === 'more' ? 'Loading remaining request pages…' : data ? 'Refreshing the complete request list…' : 'Loading the complete request list…'}</p>}
    <TransferRequestList data={data} reading={!!reading} saving={saving} error={error} onReview={review} onContinue={more} />
    <details className={styles.guidance}>
      <summary><Info size={17} aria-hidden="true" /><span><strong>How transfers work</strong><small>Eligibility, duplicate counting and what happens after approval</small></span></summary>
      <ol>
        <li>Review the learner, request ID, source modules and destination modules.</li>
        <li>Check completed-component matches. Existing and matched completions count once per component; recorded hours and historical information are preserved.</li>
        <li>Confirm inside the review. The server validates the exact request and module assignments before recording approval.</li>
      </ol>
    </details>
    {selected && <RequestDetails key={selected.requestId} request={selected} saving={saving} busy={busy} canApprove={canApprove} error={saveError} onClose={close} onApprove={(decisions, csrfToken) => void confirm(decisions, csrfToken)} onClearError={clearSaveError} returnFocusRef={trigger} />}
  </div>;
}
