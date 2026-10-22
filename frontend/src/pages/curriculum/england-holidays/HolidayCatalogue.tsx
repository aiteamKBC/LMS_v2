import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { SelectMenu } from '@/components/feature/SelectField';
import type { CurriculumHoliday } from '@/lib/curriculumApi';
import { formatDateLabel, matchesSearch } from '../shared/entities/model';
import { dateDay, holidayDateStatus, holidayMonth, holidayRange, monthLabel, periodDays, regionLabel, uniqueClosedDays, type DateStatus } from './calendar';
import styles from './BankHolidays.module.css';

interface Props {
  holidays: CurriculumHoliday[]; loaded: boolean; loading: boolean; today: string;
  search: string; onSearch: (value: string) => void; year: string; onYear: (value: string) => void;
  source: string; onSource: (value: string) => void; onReset: () => void;
  lastSuccess: string; feedSource: string; logUnavailable: boolean;
  checking: boolean; mutationPending: boolean;
  onSync: () => void; onAdd: () => void; onEdit: (holiday: CurriculumHoliday) => void; onDelete: (holiday: CurriculumHoliday) => void;
  renderTable: (holidays: CurriculumHoliday[]) => ReactNode;
}
const statusLabels: Record<DateStatus,string> = { upcoming: 'Upcoming', current: 'Ongoing', past: 'Past', unavailable: 'Dates unavailable' };

export default function HolidayCatalogue(props: Props) {
  const [view, setView] = useState<'month'|'table'>('month');
  const [status, setStatus] = useState('');
  const sorted = useMemo(() => [...props.holidays].sort((a,b) => (a.startDate || '').localeCompare(b.startDate || '') || String(a.id).localeCompare(String(b.id))), [props.holidays]);
  const years = [...new Set(sorted.filter(holidayRange).map(item => item.startDate.slice(0,4)))].sort();
  const visible = sorted.filter(item => (!props.year || item.startDate.slice(0,4) === props.year)
    && (!props.source || (props.source === 'gov.uk' ? item.source === 'gov.uk' : item.source !== 'gov.uk'))
    && (!status || holidayDateStatus(item,props.today) === status)
    && matchesSearch(props.search,[item.label,item.startDate,item.endDate,item.notes,item.type,monthLabel(holidayMonth(item)),regionLabel(item)]));
  const months = new Map<string,CurriculumHoliday[]>();
  visible.forEach(item => { const key = holidayMonth(item); months.set(key,[...(months.get(key)||[]),item]); });
  const next = sorted.find(item => holidayRange(item) && item.startDate >= props.today);
  const closedDays = uniqueClosedDays(sorted);
  const count = props.loaded ? sorted.length : props.loading ? 'Loading...' : 'Unavailable';
  const upcoming = props.loaded ? sorted.filter(item => holidayDateStatus(item,props.today) === 'upcoming').length : props.loading ? 'Loading...' : 'Unavailable';
  const regions = [...new Set(sorted.map(regionLabel).filter(Boolean))];
  const relative = (item: CurriculumHoliday) => {
    const start = dateDay(item.startDate), today = dateDay(props.today);
    return start === null || today === null ? 'Timing unavailable' : start === today ? 'Starts today' : start > today ? `In ${start-today} days` : statusLabels[holidayDateStatus(item,props.today)];
  };
  const reset = () => { props.onReset(); setStatus(''); };
  const actions = (item: CurriculumHoliday) => <div className={styles.actions}>
    <Link to="/curriculum/session-calendar" title="Open the session calendar"><AppIcon name="ri-calendar-line" size={14} /><span className="sr-only">Open calendar for {item.label}</span></Link>
    {item.source !== 'gov.uk' && <>
      <button type="button" disabled={props.mutationPending} onClick={() => props.onEdit(item)} title="Edit this manual holiday" aria-label={`Edit ${item.label}`}><AppIcon name="ri-edit-line" size={14} /></button>
      <button type="button" disabled={props.mutationPending} onClick={() => props.onDelete(item)} title="Delete this manual holiday" aria-label={`Delete ${item.label}`}><AppIcon name="ri-delete-bin-line" size={14} /></button>
    </>}
  </div>;
  return <div className={styles.catalogue}>
    <section className={styles.intro}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link to="/workspace/curriculum">Curriculum</Link><span>/</span><Link to="/curriculum/module-builder">Module Builder</Link><span>/</span><span>Bank holidays</span></nav>
      <div className={styles.introLine}>
        <div><h1>Bank holidays</h1><p>Bank holidays and manual closure periods in one calendar. Review stored dates before planning delivery.</p></div>
        <div className={styles.actions}>
          <button type="button" onClick={props.onSync} disabled={props.checking || props.mutationPending} aria-label="Check GOV.UK now"><AppIcon name="ri-refresh-line" size={14} />{props.checking ? 'Checking GOV.UK...' : 'Sync feed'}</button>
          <button type="button" className={styles.primary} onClick={props.onAdd} disabled={props.checking || props.mutationPending} aria-label="Add manual holiday"><AppIcon name="ri-add-line" size={14} />Add closure</button>
        </div>
      </div>
      <div className={styles.source}><span>Last successful check: {props.logUnavailable ? 'Unavailable' : props.lastSuccess || 'Not recorded'}</span><span>{regions.join(' · ') || 'Region unavailable'}</span><span>{props.feedSource || 'Feed source unavailable'}</span></div>
    </section>
    <dl className={styles.metrics} aria-label="Closure totals">
      <div className={styles.metric}><AppIcon name="ri-calendar-line" size={16} /><div><dd>{count}</dd><dt>Closure periods</dt><p>{props.loaded ? closedDays === null ? 'Closed-day total unavailable' : `${closedDays} unique closed days` : 'Reading stored intervals'}</p></div></div>
      <div className={styles.metric}><AppIcon name="ri-checkbox-circle-line" size={16} /><div><dd>Unavailable</dd><dt>Applied to delivery</dt><p>Application status unavailable</p></div></div>
      <div className={styles.metric}><AppIcon name="ri-time-line" size={16} /><div><dd>{upcoming}</dd><dt>Upcoming closures</dt><p>Periods starting after today</p></div></div>
      <div className={styles.metric}><AppIcon name="ri-calendar-event-line" size={16} /><div><dd>Unavailable</dd><dt>Sessions moved</dt><p>Workshop impact unavailable</p></div></div>
    </dl>
    {props.loaded && next && <section className={styles.next} aria-label="Next closure">
      <div><p className={styles.eyebrow}>Next closure</p><h2>{next.label} · {formatDateLabel(next.startDate)} – {formatDateLabel(next.endDate || next.startDate)}</h2><p>{periodDays(next)}-day period · {relative(next)} · Delivery scope unavailable</p></div>
      <div className={styles.actions}><Link className={styles.primary} to="/curriculum/session-calendar"><AppIcon name="ri-calendar-line" size={14} />Open calendar</Link></div>
    </section>}
    <div className={styles.toolbar}>
      <div role="group" aria-label="Holiday view" className={styles.tabs}><button type="button" aria-pressed={view==='month'} onClick={() => setView('month')}>By month</button><button type="button" aria-pressed={view==='table'} onClick={() => setView('table')}>Table</button></div>
      <span>{props.loaded ? `Showing ${visible.length} of ${sorted.length} holidays` : props.loading ? 'Loading holidays...' : 'Holiday calendar unavailable'}</span>
    </div>
    <section className={styles.filters} aria-label="Holiday filters">
      <div className={styles.filterGrid}>
        <div className={styles.field}><label htmlFor="holiday-search">Search closures</label><input id="holiday-search" value={props.search} onChange={event => props.onSearch(event.target.value)} placeholder="Search bank holidays..." /></div>
        <div className={styles.field}><label htmlFor="holiday-year">Start year</label><SelectMenu id="holiday-year" ariaLabel="Year" value={props.year} onChange={props.onYear} options={[{value:'',label:'All years'},...years.map(year => ({value:year,label:year}))]} size="sm" /></div>
        <div className={styles.field}><label htmlFor="holiday-status">Date status</label><SelectMenu id="holiday-status" ariaLabel="Status" value={status} onChange={setStatus} options={[{value:'',label:'Any date status'},...Object.entries(statusLabels).map(([value,label])=>({value,label}))]} size="sm" /></div>
        <div className={styles.field}><label htmlFor="holiday-source">Source</label><SelectMenu id="holiday-source" ariaLabel="Source" value={props.source} onChange={props.onSource} options={[{value:'',label:'All holidays'},{value:'gov.uk',label:'GOV.UK'},{value:'manual',label:'Manual'}]} size="sm" /></div>
        <button type="button" className={styles.reset} onClick={reset}>Reset</button>
      </div>
      <div className={styles.jumps}><span>Jump to</span>{[...months].map(([key,items])=><button key={key} type="button" onClick={() => { setView('month'); window.requestAnimationFrame(() => document.getElementById(`holiday-month-${key}`)?.scrollIntoView({block:'start'})); }}>{monthLabel(key)} ({items.length})</button>)}</div>
      <p className={styles.scopeNote}>Grouped and filtered by start date. Full ranges are preserved; date status does not confirm delivery application.</p>
    </section>
    {view === 'table' ? props.renderTable(visible) : !props.loaded ? <p role="status" className={styles.empty}>{props.loading ? 'Loading holiday calendar...' : 'Holiday calendar unavailable. Retry the request below.'}</p> : !visible.length ? <div className={styles.empty}><h2>{sorted.length ? 'No holidays match these filters' : 'No bank holidays stored yet'}</h2><p>Change the filters, sync the configured feed, or add a manual closure.</p></div> : [...months].map(([key,items])=><section key={key} className={styles.month} id={`holiday-month-${key}`} aria-label={monthLabel(key)}>
      <div className={styles.monthHeading}><AppIcon name="ri-calendar-line" size={15} /><h2>{monthLabel(key)}</h2><span>{items.length} periods · {uniqueClosedDays(items) ?? 'Unavailable'} unique days in these periods</span></div>
      <div className={styles.monthRows}>{items.map(item => {
        const days = periodDays(item), state = holidayDateStatus(item,props.today), isNext = String(next?.id) === String(item.id);
        return <article key={String(item.id)} className={styles.card} aria-label={`${item.label} - ${item.id}`}>
          <div className={styles.tile} aria-hidden="true"><span>{holidayMonth(item) === 'unavailable' ? 'Date' : new Intl.DateTimeFormat('en-GB',{month:'short',timeZone:'UTC'}).format(new Date(`${item.startDate}T00:00:00Z`))}</span><strong>{days === null ? '—' : Number(item.startDate.slice(8,10))}</strong></div>
          <div className={styles.cardBody}>
            <div className={styles.titleLine}><h3>{item.label}</h3><span className={styles.badge} data-status={state}>{statusLabels[state]}</span><span className={styles.badge}>{days === null ? 'Duration unavailable' : `${days}-day period`}</span>{isNext && <span className={styles.badge}>Next closure</span>}</div>
            <p><span>{formatDateLabel(item.startDate)} – {formatDateLabel(item.endDate || item.startDate)}</span><span>{item.source === 'gov.uk' ? `GOV.UK · ${regionLabel(item) || 'Region unavailable'}` : item.type || 'Manual holiday'}</span>{state === 'upcoming' && <span>{relative(item)}</span>}</p>
            {item.notes && <p>{item.notes}</p>}
          </div>
          {actions(item)}
        </article>;
      })}</div>
    </section>)}
  </div>;
}
