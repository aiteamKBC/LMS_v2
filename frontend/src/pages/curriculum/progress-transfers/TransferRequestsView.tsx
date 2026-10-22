import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, ArrowRight, CalendarDays, CheckCheck, ChevronRight, CircleAlert, CircleX, Clock3, Download, Eye, Hourglass, Layers, RefreshCw, Search, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { AdminTransfer, TransferModule } from '@/api/progressTransfer';
import { Modal } from '@/pages/users/components/Modal';
import { formatSystemTimestamp } from '@/lib/format';
import { formatHoursMinutes } from '@/utils/learnerJourney';
import { useTransferRequests } from './useTransferRequests';
import styles from './TransferProgress.module.css';

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

function RequestDetails({ request, saving, busy, canApprove, error, onClose, onApprove }: {
  request: AdminTransfer; saving: boolean; busy: boolean; canApprove: boolean; error: string; onClose: () => void; onApprove: () => void;
}) {
  const pending = request.status === 'pending';
  return <Modal className={styles.drawer} title={<span className={styles.drawerHeader}>
    <span className={styles.drawerIcon}><ArrowLeftRight size={18} aria-hidden="true" /></span>
    <span className={styles.drawerTitle}><span className={styles.eyebrow}>Transfer progress</span><strong>{request.learnerName}</strong><span>{request.programme || 'Programme not provided'}</span></span>
    <Badge approved={!pending}>{pending ? 'Awaiting decision' : 'Approved'}</Badge>
  </span>} onClose={onClose} dismissible={!saving} footer={<>
    <button type="button" className={`${styles.button} ${styles.cancel}`} disabled={saving} onClick={onClose}>{pending ? 'Cancel' : 'Close'}</button>
    {pending && <><button type="button" className={styles.button} disabled title="Declining transfer requests is not available."><CircleX size={14} aria-hidden="true" />Decline unavailable</button>
      <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || !canApprove} onClick={onApprove}><CheckCheck size={14} aria-hidden="true" />{saving ? 'Transferring…' : 'Approve transfer'}</button></>}
  </>}>
    <div className={styles.details} aria-busy={busy}>
      <section><h3>Request</h3><dl className={styles.requestFacts}>
        <div><dt>Learner</dt><dd>{request.learnerName}</dd></div><div><dt>Current learner programme</dt><dd>{request.programme || 'Not provided'}</dd></div>
        <div><dt>Enrolment ID</dt><dd>{request.learnerId}</dd></div><div><dt>Learner type</dt><dd>{request.learnerKind === 'commercial' ? 'Commercial' : 'Apprenticeship'}</dd></div>
        <div><dt>Requested</dt><dd>{date(request.requestedAt, true)}</dd></div><div><dt>Request ID</dt><dd>{request.requestId}</dd></div>
        {!pending && <div><dt>Approved</dt><dd>{date(request.approvedAt, true)}</dd></div>}
      </dl></section>
      <section className={styles.detailHours} aria-label="Request hours"><span>{pending ? 'Recorded hours in request' : 'Hours carried over'}</span><strong>{hoursLabel(hours(request.modules))}</strong><p>Saved recorded hours across all {request.modules.length} modules in this request. Withheld hours and overlapping weeks are not provided.</p></section>
      <section><h3>{request.modules.length} modules in this request</h3><ul className={styles.moduleDetails}>{request.modules.map(item => <li key={moduleKey(item)}>
        <div className={styles.mapping}><div><strong>{item.oldTitle}</strong><small>Old LMS · {item.courseRef}</small></div><ArrowRight size={14} aria-hidden="true" /><div><strong>{item.newTitle}</strong><small>New LMS · {item.moduleId}</small></div></div>
        <div className={styles.moduleFacts}><Badge>{percent(item.percent) === null ? 'Progress unavailable' : `${item.percent}% saved progress`}</Badge><span>{hoursLabel(validHours(item.hours) ? item.hours : null)} recorded</span>{item.demoProgress && <Badge>Demo progress</Badge>}</div><SavedProgress item={item} />
      </li>)}</ul></section>
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
  const confirm = async () => { if (selected && await approve(selected.requestId)) setSelectedId(null); };

  return <div id="curriculum-progress-transfers" className={styles.page}>
    <section className={styles.intro} aria-labelledby="transfer-heading">
      <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link to="/workspace/curriculum">Curriculum</Link><ChevronRight size={11} aria-hidden="true" /><span>Transfer Progress</span></nav>
      <div className={styles.introLine}><div><span className={styles.eyebrow}>Curriculum operations</span><h1 id="transfer-heading">Transfer Progress</h1><p>{description}</p>
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
    {selected && <RequestDetails request={selected} saving={saving} busy={busy} canApprove={canApprove} error={saveError} onClose={close} onApprove={() => void confirm()} />}
  </div>;
}
