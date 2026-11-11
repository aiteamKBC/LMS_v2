import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Eye, Hourglass, Plus, Search, X } from 'lucide-react';
import type { AdminTransfer, AdminTransfers, TransferModule } from '@/api/progressTransfer';
import { formatSystemTimestamp, systemDateParts } from '@/lib/format';
import { formatHoursMinutes } from '@/utils/learnerJourney';
import styles from './TransferProgress.module.css';
import motion from '@/pages/users/presentation/EnrolmentMotion.module.css';

type Status = AdminTransfer['status'];
const PAGE_SIZE = 10;
const sorts = [
  ['oldest', 'Requested: oldest first'], ['newest', 'Requested: newest first'],
  ['learner', 'Learner: A–Z'], ['programme', 'Programme: A–Z'],
] as const;
const time = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const moduleKey = (module: TransferModule) => `${module.courseRef}:${module.moduleId}`;
const requestedDay = (value: string | null) => {
  const parts = value ? systemDateParts(value) : null;
  return parts ? `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}` : '';
};

function RequestDate({ value, pending = false }: { value: string | null; pending?: boolean }) {
  const timestamp = time(value);
  const days = timestamp === null ? null : Math.floor((Date.now() - timestamp) / 86_400_000);
  return <span className={styles.date}>
    {timestamp === null ? <span>Not provided</span> : <time dateTime={value!}>{formatSystemTimestamp(value!, { day: 'numeric', month: 'short', year: 'numeric' })}</time>}
    {pending && days !== null && days >= 0 && <small>{days === 0 ? 'Requested today' : `Waiting ${days} ${days === 1 ? 'day' : 'days'}`}</small>}
  </span>;
}

function ModuleSummary({ modules, requestId }: { modules: TransferModule[]; requestId: string }) {
  return <div className={styles.moduleOverview}>
    <div className={styles.moduleProgress}><span className={styles.moduleBars} aria-hidden="true">{modules.slice(0, 6).map(module => <span key={moduleKey(module)} data-progress={module.percent === 100 ? 'complete' : Number.isFinite(module.percent) && module.percent > 0 && module.percent < 100 ? 'partial' : 'unknown'} title={`${module.oldTitle}: ${Number.isFinite(module.percent) && module.percent >= 0 && module.percent <= 100 ? `${module.percent}% saved` : 'Progress unavailable'}`} />)}</span><span>{modules.filter(module => module.percent === 100).length}/{modules.length} at 100% saved</span></div>
    <details className={styles.moduleDisclosure}>
    <summary><Plus size={12} className={styles.showIcon} aria-hidden="true" /><span className={styles.showLabel}>Show</span><span>{modules.length} {modules.length === 1 ? 'module' : 'modules'}</span><span className="sr-only"> in request {requestId}</span><ChevronDown size={15} className={styles.disclosureArrow} aria-hidden="true" /></summary>
    <ul aria-label={`Modules in request ${requestId}`}>{modules.map(item => <li key={`${item.courseRef}:${item.moduleId}`}>
      <strong>{item.oldTitle || 'Source module not provided'}</strong><small>Old LMS · {item.courseRef}</small>
      <span className={styles.destination}>To <strong>{item.newTitle || 'Destination module not provided'}</strong></span><small>New LMS · {item.moduleId}</small>
      <span>{Number.isFinite(item.percent) && item.percent >= 0 && item.percent <= 100 ? `${item.percent}% saved` : 'Progress unavailable'} · {Number.isFinite(item.hours) && item.hours >= 0 ? formatHoursMinutes(item.hours) : 'Hours unavailable'}</span>
      {item.demoProgress && <span className={styles.badge}>Demo progress</span>}
    </li>)}</ul>
  </details></div>;
}

export function TransferRequestList({ data, reading, saving, error, onReview, onContinue }: {
  data: AdminTransfers | null; reading: boolean; saving: boolean; error: string;
  onReview: (id: string, trigger: HTMLButtonElement) => void; onContinue: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const id = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const status: Status = params.get('transferStatus') === 'approved' ? 'approved' : 'pending';
  const query = params.get('transferQuery') || '';
  const programme = params.get('transferProgramme') || '';
  const moduleFilter = params.get('transferModule') || '';
  const requestedFrom = params.get('transferFrom') || '';
  const requestedTo = params.get('transferTo') || '';
  const requestedSort = params.get('transferSort') || 'oldest';
  const sort = sorts.some(([key]) => key === requestedSort) ? requestedSort : 'oldest';
  const requestedPage = Number(params.get('transferPage'));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const complete = !!data && data.nextOffset === null;
  const controlsDisabled = !complete || reading || saving;
  const requests = data?.requests || [];
  const counts = { pending: requests.filter(row => row.status === 'pending').length, approved: requests.filter(row => row.status === 'approved').length };
  const programmes = [...new Set(requests.map(row => row.programme).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const modules = [...new Map(requests.flatMap(row => row.modules.map(module => [moduleKey(module), module] as const))).values()].sort((a, b) => a.newTitle.localeCompare(b.newTitle));
  const hasFilters = Boolean(query || programme || moduleFilter || requestedFrom || requestedTo || sort !== 'oldest');
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = requests.filter(row => row.status === status && (!complete || (
    (!programme || row.programme === programme)
    && (!moduleFilter || row.modules.some(module => moduleKey(module) === moduleFilter))
    && (!(requestedFrom || requestedTo) || Boolean(requestedDay(row.requestedAt)) && (!requestedFrom || requestedDay(row.requestedAt) >= requestedFrom) && (!requestedTo || requestedDay(row.requestedAt) <= requestedTo))
    && terms.every(term => `${row.learnerName} ${row.programme} ${row.requestId} ${row.learnerId}`.toLocaleLowerCase().includes(term))
  ))).sort((a, b) => {
    if (!complete) return 0;
    if (sort === 'learner' || sort === 'programme') {
      const result = (sort === 'learner' ? a.learnerName : a.programme).localeCompare(sort === 'learner' ? b.learnerName : b.programme);
      if (result) return result;
    } else {
      const left = time(a.requestedAt), right = time(b.requestedAt);
      if (left === null && right !== null) return 1;
      if (right === null && left !== null) return -1;
      if (left !== null && right !== null && left !== right) return sort === 'newest' ? right - left : left - right;
    }
    return a.requestId.localeCompare(b.requestId);
  });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const update = (values: Record<string, string>, resetPage = true) => setParams(previous => {
    const next = new URLSearchParams(previous);
    for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); }
    if (resetPage) next.delete('transferPage');
    return next;
  }, { replace: true });

  useEffect(() => {
    if (complete && !reading && page > pages) setParams(previous => {
      const next = new URLSearchParams(previous);
      if (pages === 1) next.delete('transferPage'); else next.set('transferPage', String(pages));
      return next;
    }, { replace: true });
  }, [complete, reading, page, pages, setParams]);

  const changeTab = (next: Status) => update({ transferStatus: next === 'pending' ? '' : next });
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : status === 'pending' ? 1 : 0;
    changeTab(index === 0 ? 'pending' : 'approved');
    tabRefs.current[index]?.focus();
  };
  const clear = () => update({ transferQuery: '', transferProgramme: '', transferSort: '', transferModule: '', transferFrom: '', transferTo: '' });

  return <section className={`${styles.requestArea} ${motion.sectionEnter}`} aria-label="Transfer requests">
    <div className={styles.statusBar}><div className={styles.tabs} role="tablist" aria-label="Transfer request status">
      {(['pending', 'approved'] as const).map((value, index) => <button key={value} ref={node => { tabRefs.current[index] = node; }} id={`${id}-${value}`} type="button" role="tab"
        aria-label={`${value === 'pending' ? 'Pending' : 'Approved'} ${data ? `${counts[value]} ${complete ? 'retrieved' : 'loaded'}` : '—'}`}
        aria-selected={status === value} aria-controls={`${id}-panel`} tabIndex={status === value ? 0 : -1} onKeyDown={tabKey} onClick={() => changeTab(value)}>
        {value === 'pending' ? <Hourglass size={13} aria-hidden="true" /> : <CheckCheck size={14} aria-hidden="true" />}{value === 'pending' ? 'Pending' : 'Approved'} <span>{data ? <>{counts[value]}<span className="sr-only"> {complete ? 'retrieved' : 'loaded'}</span></> : '—'}</span>
      </button>)}
    </div><p className={styles.sortHint}>{sort === 'oldest' ? 'Oldest request first keeps the longest wait at the top' : sorts.find(([key]) => key === sort)?.[1]}</p></div>
    <div className={styles.filters}>
      <label className={`${styles.field} ${styles.searchField}`}><span>Search requests</span><span className={styles.search}><Search size={17} aria-hidden="true" /><input type="search" value={query} disabled={controlsDisabled} onChange={event => update({ transferQuery: event.target.value })} placeholder="Learner, programme or request ID" /></span></label>
      <label className={styles.field}><span>Module</span><select value={moduleFilter} disabled={controlsDisabled} onChange={event => update({ transferModule: event.target.value })}><option value="">All modules</option>{moduleFilter && !modules.some(module => moduleKey(module) === moduleFilter) && <option value={moduleFilter}>{moduleFilter}</option>}{modules.map(module => <option key={moduleKey(module)} value={moduleKey(module)}>{module.newTitle || module.oldTitle || module.moduleId}</option>)}</select></label>
      <label className={styles.field}><span>Programme</span><select value={programme} disabled={controlsDisabled} onChange={event => update({ transferProgramme: event.target.value })}><option value="">All programmes</option>{programme && !programmes.includes(programme) && <option value={programme}>{programme}</option>}{programmes.map(name => <option key={name}>{name}</option>)}</select></label>
      <label className={styles.field}><span>Sort requests</span><select value={sort} disabled={controlsDisabled} onChange={event => update({ transferSort: event.target.value })}>{sorts.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <div className={styles.requestedRange} role="group" aria-label="Requested date range"><span><CalendarDays size={13} aria-hidden="true" />Requested</span>
        <label><span className="sr-only">Requested from</span><input type="date" value={requestedFrom} max={requestedTo || undefined} disabled={controlsDisabled} onChange={event => update({ transferFrom: event.target.value })} /></label><span aria-hidden="true">–</span>
        <label><span className="sr-only">Requested to</span><input type="date" value={requestedTo} min={requestedFrom || undefined} disabled={controlsDisabled} onChange={event => update({ transferTo: event.target.value })} /></label>
      </div>
      <button type="button" className={`${styles.button} ${styles.clearFilters}`} disabled={controlsDisabled || !hasFilters} onClick={clear}><X size={14} aria-hidden="true" />Clear filters</button>
    </div>
    <p className={styles.resultSummary} aria-live="polite">{!data ? reading ? 'Loading requests…' : 'Requests unavailable.' : complete
      ? `${filtered.length} ${status} ${filtered.length === 1 ? 'request' : 'requests'}${hasFilters ? ` matching filters · ${counts[status]} before filters` : ''} · All request pages retrieved.`
      : `${requests.length} requests retrieved so far. Search, programme filtering and sorting require the complete list.`}</p>
    {data && !complete && !reading && <div className={styles.incomplete}><span>The list is incomplete. Counts are for retrieved records only.</span><button className={styles.button} type="button" disabled={saving} onClick={onContinue}>Continue loading requests</button></div>}
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${status}`} className={styles.listPanel} tabIndex={0} aria-busy={reading}>
      {data && shown.length > 0 ? <table className={styles.table} role="table" data-status={status} aria-label={status === 'pending' ? 'Pending transfer requests' : 'Approved transfer requests'}>
        <thead role="rowgroup"><tr role="row"><th scope="col">Learner</th><th scope="col">Programme &amp; modules</th><th scope="col">Requested</th>{status === 'approved' && <th scope="col">Approved</th>}<th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody role="rowgroup" className={motion.staggerRows}>{shown.map(row => <tr role="row" key={row.requestId} aria-label={`Request ${row.requestId} for ${row.learnerName}`}>
          <td role="cell" data-label="Learner"><div className={styles.learnerCell}><span className={styles.avatar} data-color={row.learnerId.length % 3} aria-hidden="true">{row.learnerName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'}</span><div><strong>{row.learnerName || 'Learner name not provided'}</strong><small>Request {row.requestId}</small></div></div></td>
          <td role="cell" data-label="Programme & modules"><div className={styles.programmeCell}><div><strong className={styles.programmeName}>{row.programme || 'Programme not provided'}</strong><small className={styles.programmeDirection}>Old LMS → assigned modules</small></div><ModuleSummary modules={row.modules} requestId={row.requestId} /></div></td>
          <td role="cell" data-label="Requested"><RequestDate value={row.requestedAt} pending={status === 'pending'} /></td>
          {status === 'approved' && <td role="cell" data-label="Approved"><RequestDate value={row.approvedAt} /></td>}
          <td role="cell" className={styles.rowAction}><button type="button" className={`${styles.button} ${status === 'pending' ? styles.reviewAction : ''}`} disabled={reading || saving} onClick={event => onReview(row.requestId, event.currentTarget)} title={status === 'pending' ? 'Review before approving' : 'View transfer details'} aria-label={status === 'pending' ? `Review transfer request ${row.requestId}` : `Details for request ${row.requestId}`}>{status === 'pending' ? 'Review transfer' : <><Eye size={16} aria-hidden="true" /><span className="sr-only">View details</span></>}</button></td>
        </tr>)}</tbody>
      </table> : <div className={styles.empty}>{!data ? reading ? 'Loading transfer requests…' : 'Transfer requests could not be loaded.'
        : !complete ? reading ? 'Loading all request pages…' : `No ${status} requests in the retrieved records. Complete the list to check the rest.`
          : hasFilters ? <><strong>No requests match your filters.</strong><button className={styles.button} type="button" onClick={clear}>Clear filters</button></>
            : status === 'pending' ? 'No requests waiting for approval.' : 'No approved transfers yet.'}</div>}
    </div>
    {data && filtered.length > 0 && <nav className={styles.pagination} aria-label="Request pages"><span>Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} {complete ? 'matching requests' : 'loaded requests'}</span><div>
      <button className={styles.button} type="button" aria-label="Previous request page" disabled={reading || currentPage === 1} onClick={() => update({ transferPage: String(currentPage - 1) }, false)}><ChevronLeft size={16} aria-hidden="true" />Previous</button>
      <span>Page {currentPage} of {pages}</span>
      <button className={styles.button} type="button" aria-label="Next request page" disabled={reading || currentPage === pages} onClick={() => update({ transferPage: String(currentPage + 1) }, false)}>Next<ChevronRight size={16} aria-hidden="true" /></button>
    </div></nav>}
    {error && data && <p className={styles.stale}>These are the last retrieved requests. Refresh failed; approval is paused until a successful refresh.</p>}
  </section>;
}
