import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, ArrowRight, CalendarDays, CheckCheck, ChevronRight, CircleAlert, CircleX, Clock3, Download, Eye, Hourglass, Layers, RefreshCw, Search, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { AdminTransfer, TransferDecisions, TransferMapping, TransferModule, TransferReview } from '@/api/progressTransfer';
import { Modal } from '@/pages/users/components/Modal';
import { formatSystemTimestamp } from '@/lib/format';
import { formatHoursMinutes } from '@/utils/learnerJourney';
import { useTransferRequests } from './useTransferRequests';
import { useTransferReview } from './useTransferReview';
import styles from './TransferProgress.module.css';
import matchingStyles from './progressTransfers.module.css';
import { componentSuggestions, suggestedMappings } from './componentSuggestions';
import { previewComponentCounts } from './componentCounts';
import { SourceWeekReview } from './SourceWeekReview';
import { WeekComponentChoices } from './WeekComponentChoices';

const description = 'Review learner requests to move saved module progress and recorded hours from the old LMS.';
const date = (value: string | null, full = false) => value && Number.isFinite(Date.parse(value))
  ? formatSystemTimestamp(value, { day: 'numeric', month: 'short', year: 'numeric', ...(full ? { hour: '2-digit', minute: '2-digit' } : {}) }) : 'Not provided';
const validHours = (value: number) => Number.isFinite(value) && value >= 0;
const hours = (modules: TransferModule[]) => modules.every(item => validHours(item.hours)) ? modules.reduce((sum, item) => sum + item.hours, 0) : null;
const hoursLabel = (value: number | null) => value === null ? 'Unavailable' : formatHoursMinutes(value);
const percent = (value: number) => Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const moduleKey = (item: TransferModule) => `${item.courseRef}:${item.moduleId}`;
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';

function Badge({ approved = false, children }: { approved?: boolean; children: ReactNode }) {
  return <span className={`${styles.badge} ${approved ? styles.approved : ''}`}>{children}</span>;
}

function Metric({ label, value, note, icon: Icon }: { label: string; value: string | number; note: string; icon: LucideIcon }) {
  return <article className={styles.metric} aria-label={label}>
    <span className={styles.metricIcon}><Icon size={16} aria-hidden="true" /></span>
    <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
  </article>;
}

function SavedProgress({ item }: { item: TransferModule }) {
  const value = percent(item.percent);
  return value === null ? <small>Progress unavailable</small> : <div className={styles.savedProgress} role="progressbar" aria-label={`Saved progress for ${item.oldTitle}`} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${value}%` }} /></div>;
}

function RequestCard({ request, busy, canApprove, onReview }: { request: AdminTransfer; busy: boolean; canApprove: boolean; onReview: () => void }) {
  return <article className={styles.request} aria-label={`Request ${request.requestId} for ${request.learnerName}`}>
    <header className={styles.requestHeader}>
      <div className={styles.identity}><span className={styles.avatar} aria-hidden="true">{initials(request.learnerName)}</span><div><h3>{request.learnerName}</h3><p>{request.programme || 'Programme not provided'}</p><p>Request {request.requestId}</p></div></div>
      <Badge><CalendarDays size={11} aria-hidden="true" />Requested {date(request.requestedAt)}</Badge>
    </header>
    <div className={styles.systems}><div><span>From</span><strong>Old LMS</strong></div><ArrowRight size={14} aria-hidden="true" /><div><span>To</span><strong>New LMS</strong></div></div>
    <p className={styles.moduleCount}>{request.modules.length} {request.modules.length === 1 ? 'module' : 'modules'} included</p>
    <ul className={styles.previewModules}>{request.modules.slice(0, 2).map(item => <li key={moduleKey(item)}>
      <div><strong>{item.oldTitle}</strong><small>To {item.newTitle}</small>{item.demoProgress && <Badge>Demo progress</Badge>}<SavedProgress item={item} /></div>
      <span className={styles.previewNumbers}><span>{percent(item.percent) === null ? 'Unavailable' : `${item.percent}% saved`}</span><br /><span>{hoursLabel(validHours(item.hours) ? item.hours : null)}</span></span>
    </li>)}</ul>
    {request.modules.length > 2 && <p className={styles.moreModules}>+{request.modules.length - 2} more in this request</p>}
    <div className={styles.hoursRow}><span>Recorded hours in request</span><strong>{hoursLabel(hours(request.modules))}</strong></div>
    <footer className={styles.requestFooter}>
      <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || !canApprove} onClick={onReview}><CheckCheck size={14} aria-hidden="true" />Approve transfer</button>
      <button type="button" className={styles.button} disabled={busy} onClick={onReview}><Eye size={14} aria-hidden="true" />Review details</button>
      <small>Review before confirming</small>
    </footer>
  </article>;
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
    <p>Only completed old components transfer. Unfinished old components are excluded. Similar names are suggested for your review; unclear matches need a manual choice. Existing new completions are kept, and shared completions count once. Actual transferred hours stay unchanged.</p>
    <p>Saved matches and name matches are already selected for transfer. Review them before confirming. Open a component selector to browse by week; closing it keeps your match. Each destination can be used once.</p>
    {matched.length > 0 && <details className={matchingStyles.matchReview}>
      <summary>Matched components — quick review ({matched.length})</summary>
      <div className={matchingStyles.tableScroll} tabIndex={0} role="region" aria-label="Matched components review"><table className={matchingStyles.moduleTable} aria-label="Matched components review">
        <thead><tr><th scope="col">Completed old component</th><th scope="col">New component</th><th scope="col">Match</th></tr></thead>
        <tbody>{matched.map(({ module, source, target }) => <tr key={`${module.moduleId}:${source.sourceActivityRef}`}>
          <td>{source.title}<small className={matchingStyles.matchContext}>{module.title} · {source.week || 'No week specified'}</small></td>
          <td>{target.title}<small className={matchingStyles.matchContext}>{target.week || 'No week specified'}</small></td>
          <td>{source.automaticTargetId ? 'Verified source link' : source.savedTargetId === target.componentId ? 'Saved match — review' : proposed.some(row => row.moduleId === module.moduleId && row.sourceActivityRef === source.sourceActivityRef && row.targetComponentId === target.componentId) ? 'Matched by name — review' : 'Manual selection'}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
    {review.modules.map(module => <div key={module.moduleId} className={matchingStyles.matchModule}>
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
        const recommendation = module.targets.find(target => target.componentId === source.recommendedTargetId);
        const manualTarget = module.targets.find(target => target.componentId === value?.targetComponentId);
        const savedMatch = Boolean(manualTarget && source.savedTargetId === manualTarget.componentId);
        const nameMatched = proposed.some(row => row.moduleId === module.moduleId && row.sourceActivityRef === source.sourceActivityRef && row.targetComponentId === value?.targetComponentId);
        const { candidates, suggestedId } = componentSuggestions(source, module.targets, used);
        return <div className={matchingStyles.matchRow} key={source.sourceActivityRef}>
          <div><strong>{source.title}</strong><small>{source.week || 'No week specified'} · {source.type} · {source.sourceActivityRef}</small></div>
          {source.automaticTargetId ? <div><span className={matchingStyles.approvedBadge}>Automatically matched</span><strong>{automatic?.title || source.automaticTargetId}</strong><small>{automatic?.week}</small></div>
            : <div>{recommendation && <small><strong>Recommended: {recommendation.title}</strong>{' '}
                {recommendation.week || 'No week specified'}. Old LMS: {source.type}; new LMS: {recommendation.type}. Similar name; review the content and choose manually. This recommendation is not selected automatically.
              </small>}
              {manualTarget && <span className={matchingStyles.approvedBadge}>{savedMatch ? 'Saved match — review' : nameMatched ? 'Matched by name — review' : 'Match selected'}</span>}
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

function ComponentCounts({ title, counts, preview = false, mergedPercent }: {
  title: string; counts: ReturnType<typeof previewComponentCounts>; preview?: boolean; mergedPercent?: number;
}) {
  const percent = preview ? (counts.completed === null ? null : counts.total ? Math.round(counts.completed / counts.total * 10000) / 100 : 0) : mergedPercent;
  return <section className={matchingStyles.componentCounts} aria-label={`Component counts for ${title}`}>
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

function RequestDetails({ request, saving, busy, canApprove, error, onClose, onApprove, onClearError }: {
  request: AdminTransfer; saving: boolean; busy: boolean; canApprove: boolean; error: string; onClose: () => void;
  onApprove: (decisions: TransferDecisions, csrfToken: string) => void; onClearError: () => void;
}) {
  const pending = request.status === 'pending';
  const matching = useTransferReview(request.requestId, pending);
  const { review } = matching;
  const ready = !!review && matching.unresolved === 0;
  const approve = () => { if (review && ready) onApprove({ reviewToken: review.reviewToken, mappings: matching.mappings }, review.csrfToken); };
  return <Modal className={styles.drawer} title={<span className={styles.drawerHeader}>
    <span className={styles.drawerIcon}><ArrowLeftRight size={18} aria-hidden="true" /></span>
    <span className={styles.drawerTitle}><span className={styles.eyebrow}>Transfer progress</span><strong>{request.learnerName}</strong><span>{request.programme || 'Programme not provided'}</span></span>
    <Badge approved={!pending}>{pending ? 'Awaiting decision' : 'Approved'}</Badge>
  </span>} onClose={onClose} dismissible={!saving} footer={<>
    <button type="button" className={`${styles.button} ${styles.cancel}`} disabled={saving} onClick={onClose}>{pending ? 'Cancel' : 'Close'}</button>
    {pending && <><button type="button" className={styles.button} disabled title="Declining transfer requests is not available."><CircleX size={14} aria-hidden="true" />Decline unavailable</button>
      <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || !canApprove || !ready} onClick={approve}><CheckCheck size={14} aria-hidden="true" />{saving ? 'Transferring…' : 'Approve transfer'}</button></>}
  </>}>
    <div className={styles.details} aria-busy={busy}>
      <section><h3>Request</h3><dl className={styles.requestFacts}>
        <div><dt>Learner</dt><dd>{request.learnerName}</dd></div><div><dt>Current learner programme</dt><dd>{request.programme || 'Not provided'}</dd></div>
        <div><dt>Enrolment ID</dt><dd>{request.learnerId}</dd></div><div><dt>Learner type</dt><dd>{request.learnerKind === 'commercial' ? 'Commercial' : 'Apprenticeship'}</dd></div>
        <div><dt>Requested</dt><dd>{date(request.requestedAt, true)}</dd></div><div><dt>Request ID</dt><dd>{request.requestId}</dd></div>
        {!pending && <div><dt>Approved</dt><dd>{date(request.approvedAt, true)}</dd></div>}
      </dl></section>
      <section className={styles.detailHours} aria-label="Request hours"><span>{pending ? 'Recorded hours in request' : 'Hours carried over'}</span><strong>{hoursLabel(hours(request.modules))}</strong><p>Saved recorded hours across all {request.modules.length} modules in this request. Withheld hours and overlapping weeks are not provided.</p></section>
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
          {module.componentCounts ? <ComponentCounts title={module.newTitle} counts={module.componentCounts} mergedPercent={module.mergedPercent} />
            : <p>Component counts were not recorded for this earlier transfer.</p>}
        </div>)}
      </section>}
      {!pending && <ApprovedMatches request={request} />}
      <div className={styles.information}><Layers size={16} aria-hidden="true" /><div><strong>Matched activity credit</strong>Completed activities with verified matching source identities stay completed within the transferred percentage. New progress is added up to 100%.</div></div>
      <p className={styles.historyNote}><ShieldCheck size={14} aria-hidden="true" /> Historic learning records and evidence are retained. Programme versions, decision actors and request notes are not provided with this request.</p>
      {pending && !canApprove && <p className={styles.error}>Refresh requests before approving this transfer.</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  </Modal>;
}

export function TransferRequests() {
  const { data, reading, saving, error, saveError, notice, needsRefresh, refresh, more, approve, clearSaveError } = useTransferRequests();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [programme, setProgramme] = useState('');
  const [tab, setTab] = useState('all');
  const historyId = useId();
  const pending = data?.requests.filter(row => row.status === 'pending') ?? [];
  const history = useMemo(() => data?.requests.filter(row => row.status === 'approved') ?? [], [data]);
  const programmeNames = [...new Set(history.map(row => row.programme).filter(Boolean))].sort();
  const filtered = history.filter(row => (!programme || row.programme === programme) && [row.learnerName, row.learnerId, row.requestId, row.programme, ...row.modules.flatMap(item => [item.oldTitle, item.newTitle, item.courseRef, item.moduleId])].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const selected = data?.requests.find(row => row.requestId === selectedId);
  const busy = !!reading || saving;
  const initial = !!reading && !data;
  const canApprove = !!data?.csrfToken && !needsRefresh;
  const carried = hoursLabel(hours(history.flatMap(row => row.modules)));
  const value = (result: string | number) => initial ? 'Loading…' : data ? result : 'Unavailable';
  const review = (requestId: string) => { clearSaveError(); setSelectedId(requestId); };
  const close = () => { if (!saving) setSelectedId(null); };
  const confirm = async (decisions: TransferDecisions, csrfToken: string) => { if (selected && await approve(selected.requestId, decisions, csrfToken)) setSelectedId(null); };

  return <div id="curriculum-progress-transfers" className={styles.page}>
    <section className={styles.intro} aria-labelledby="transfer-heading">
      <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link to="/users">Enrolment</Link><ChevronRight size={11} aria-hidden="true" /><span>Transfer Progress</span></nav>
      <div className={styles.introLine}><div><span className={styles.eyebrow}>Enrolment operations</span><h1 id="transfer-heading">Transfer Progress</h1><p>{description}</p>
        <div className={styles.introMeta}><Badge>{value(`${pending.length} requests waiting`)}</Badge><span>{data ? `${history.length} approved · ${carried} on loaded approved requests` : initial ? 'Loading requests…' : 'Request summary unavailable'}</span></div>
      </div><div className={styles.actions}><button type="button" className={styles.button} disabled title="A transfer-log export is not available in this workspace." aria-describedby={`${historyId}-capabilities`}><Download size={14} aria-hidden="true" />Export log</button><button type="button" className={styles.button} disabled={busy} onClick={refresh}><RefreshCw size={14} aria-hidden="true" />Refresh</button></div></div>
    </section>
    <div className={styles.notice}><CircleAlert size={15} aria-hidden="true" /><div><strong>Review before you approve</strong>Check the saved module mappings, progress and hours first. Matching completed activities are included in the transferred percentage without being counted twice.</div></div>
    <section className={styles.metrics} aria-label="Transfer summary">
      <Metric label="Waiting for you" value={value(pending.length)} note="Loaded requests needing a decision" icon={Hourglass} />
      <Metric label="Approved" value={value(history.length)} note="Approved requests loaded so far" icon={CheckCheck} />
      <Metric label="Hours carried over" value={value(carried)} note="Saved hours on loaded approved requests" icon={Clock3} />
      <Metric label="Declined" value="Unavailable" note="Declining requests is not available" icon={CircleX} />
    </section>
    <p className={styles.scopeNote}>{data ? `${data.requests.length} requests loaded${data.nextOffset !== null ? ' · More requests available; counters are not full-list totals.' : ' · All requests loaded.'}` : 'Counters cover loaded requests only.'}</p>
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    {error && <div role="alert" className={styles.error}>{error}{data && <span> Showing the last loaded requests.</span>}<button type="button" disabled={busy} onClick={refresh}>Retry refresh</button></div>}
    {reading && <p role="status" className={styles.scopeNote}>{reading === 'more' ? 'Loading more requests…' : data ? 'Refreshing requests…' : 'Loading requests…'}</p>}
    <section aria-label="Pending transfer requests" aria-busy={busy}>
      <div className={styles.sectionHeading}><div><h2>Waiting for your approval</h2><p>Review every saved module before confirming the request.</p></div><span>Newest requests first · Loaded requests</span></div>
      {pending.length ? <div className={styles.requestGrid}>{pending.map(row => <RequestCard key={row.requestId} request={row} busy={busy} canApprove={canApprove} onReview={() => review(row.requestId)} />)}</div>
        : <p className={styles.empty}>{initial ? 'Loading pending requests…' : !data ? 'Pending requests are unavailable.' : data.nextOffset !== null ? 'No pending requests in the loaded records. Load more requests to continue.' : 'No requests waiting for approval.'}</p>}
    </section>
    <section aria-label="Transfer history">
      <div className={styles.sectionHeading}><div><h2>Transfer history</h2><p>Saved module progress and hours. Programme names reflect the current learner record.</p></div></div>
      <div className={styles.filters}>
        <div className={styles.tabs} role="tablist" aria-label="Transfer history decisions">
          <button type="button" role="tab" aria-selected={tab === 'all'} aria-controls={historyId} onClick={() => setTab('all')}>All decisions <span>{data ? history.length : '—'}</span></button>
          <button type="button" role="tab" aria-selected={tab === 'approved'} aria-controls={historyId} onClick={() => setTab('approved')}>Approved <span>{data ? history.length : '—'}</span></button>
          <button type="button" role="tab" aria-selected={false} disabled title="Decline decisions are not available.">Declined</button>
        </div>
        <div className={styles.filterFields}>
          <label className={styles.field}><span>Search loaded history</span><span className={styles.search}><Search size={14} aria-hidden="true" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Learner, programme or request…" /></span></label>
          <label className={styles.field}><span>Programme name</span><select value={programme} onChange={event => setProgramme(event.target.value)}><option value="">All programmes</option>{programme && !programmeNames.includes(programme) && <option value={programme}>{programme}</option>}{programmeNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
          <button type="button" className={styles.button} onClick={() => { setQuery(''); setProgramme(''); setTab('all'); }}><RefreshCw size={13} aria-hidden="true" />Reset</button>
        </div>
      </div>
      <p className={styles.resultSummary}>{data ? `${filtered.length} of ${history.length} loaded decisions${data.nextOffset !== null ? ' · More requests may be available' : ''}` : 'Decision history unavailable'}</p>
      <div id={historyId} role="tabpanel" aria-label={tab === 'all' ? 'All decisions' : 'Approved decisions'} className={styles.tableScroll} tabIndex={0}>
        <table className={styles.table}><caption>Transfer history · Loaded requests</caption><thead><tr><th scope="col">Learner</th><th scope="col">Current programme</th><th scope="col">Modules</th><th scope="col">Hours carried</th><th scope="col">Requested</th><th scope="col">Decision / date</th><th scope="col">Details</th></tr></thead>
          <tbody>{filtered.map(row => <tr key={row.requestId}><td>{row.learnerName}<small>Request {row.requestId}</small></td><td>{row.programme || 'Not provided'}</td><td>{row.modules.length} {row.modules.length === 1 ? 'module' : 'modules'}</td><td>{hoursLabel(hours(row.modules))}</td><td>{date(row.requestedAt)}</td><td><Badge approved>Approved</Badge><small>{date(row.approvedAt)}</small></td><td><button type="button" className={styles.button} disabled={saving} onClick={() => review(row.requestId)} aria-label={`Details for request ${row.requestId}`}><Eye size={13} aria-hidden="true" />Details</button></td></tr>)}
            {!filtered.length && <tr><td colSpan={7}>{initial ? 'Loading decision history…' : !data ? 'Decision history unavailable.' : history.length ? 'No loaded decisions match these filters.' : 'No approved decisions in the loaded requests.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className={styles.pagination}><span>{data ? `${data.requests.length} requests loaded${data.nextOffset !== null ? ' · List is incomplete' : ''}` : 'Requests unavailable'}</span>{data?.nextOffset != null && <button type="button" className={styles.button} disabled={busy || needsRefresh} onClick={more}>{reading === 'more' ? 'Loading…' : 'Load more requests'}</button>}</div>
    </section>
    <section className={styles.guidance}><h2>How a transfer decision works</h2><ol className={styles.steps}>
      <li><strong><span>1</span>Check the saved modules</strong><p>Review the old and new module identities, saved percentages and recorded hours for this request.</p></li>
      <li><strong><span>2</span>Review matched progress</strong><p>Verified matching activities stay completed within the transferred percentage. Additional progress is capped at 100%.</p></li>
      <li><strong><span>3</span>Confirm the exact request</strong><p>Approval rechecks the module assignments. Historic learning records and evidence are retained.</p></li>
    </ol></section>
    <p id={`${historyId}-capabilities`} className={styles.capabilities}>Declining requests and exporting a decision log are not available in this workspace. Programme versions, employer/cohort details, withheld hours and overlapping weeks are not provided.</p>
    {selected && <RequestDetails request={selected} saving={saving} busy={busy} canApprove={canApprove} error={saveError} onClose={close} onApprove={(decisions, csrfToken) => void confirm(decisions, csrfToken)} onClearError={clearSaveError} />}
  </div>;
}
