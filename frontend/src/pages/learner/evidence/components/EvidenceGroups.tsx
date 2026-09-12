import { useId, useMemo, useState } from 'react';
import { ArrowUpRight, CalendarDays, CheckCheck, ChevronDown, ChevronsDownUp, ChevronsUpDown, FileText, Folder, MessageSquare, Paperclip } from 'lucide-react';
import type { EvidenceItem } from './EvidenceBody';
import styles from './EvidenceGroups.module.css';
import { groupEvidence } from './evidenceGrouping';

export function EvidenceGroups({ items, expandMatches, onOpen }: { items: EvidenceItem[]; expandMatches: boolean; onOpen: (id: string) => void }) {
  const groups = useMemo(() => groupEvidence(items), [items]);
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const [closedComponents, setClosedComponents] = useState<Record<string, boolean>>({});
  const [expandComponents, setExpandComponents] = useState(expandMatches);
  const id = useId();
  if (!groups.length) return null;
  const isOpen = (key: string) => openMonths[key] ?? (expandMatches || key === groups[0].key);
  const allOpen = groups.every(month => isOpen(month.key));
  return <section className={styles.root} aria-label="Evidence by month">
    <div className={styles.heading}>
      <div><h2>Evidence by month</h2><p>{groups.length} {groups.length === 1 ? 'month' : 'months'} · Organised by component</p></div>
      <button type="button" className={styles.expandButton} onClick={() => {
        setOpenMonths(Object.fromEntries(groups.map(month => [month.key, !allOpen])));
        if (!allOpen) { setClosedComponents({}); setExpandComponents(true); }
      }}>{allOpen ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}{allOpen ? 'Collapse all months' : 'Expand all months'}</button>
    </div>
    <div className={styles.months}>
      {groups.map((month, index) => {
        const open = isOpen(month.key);
        const validated = month.items.filter(item => item.status === 'Validated').length;
        const needsWork = month.items.filter(item => item.status === 'Needs work').length;
        const preview = month.components.slice(0, 3).map(component => component.label).join(' · ');
        return <div key={month.key}>
          {(index === 0 || groups[index - 1].year !== month.year) && month.year && <div className={styles.year}><span>{month.year}</span><div /></div>}
          <section className={styles.month} data-open={open} aria-label={`${month.label} evidence`}>
            <h3><button type="button" className={styles.monthToggle} aria-label={month.label} aria-expanded={open} aria-controls={`${id}-month-${month.key || 'undated'}`} onClick={() => setOpenMonths(value => ({ ...value, [month.key]: !open }))}>
              <span className={styles.monthStamp}>{month.key ? <><strong>{month.short}</strong><span>{month.year}</span></> : <CalendarDays size={22} />}</span>
              <span className={styles.monthTitle}><strong>{month.label}</strong><span>{month.components.length} {month.components.length === 1 ? 'component' : 'components'}<i />{month.items.length} {month.items.length === 1 ? 'item' : 'items'}</span>
                {!open && <span className={styles.monthPreview}>{preview}{month.components.length > 3 ? ` · +${month.components.length - 3} more` : ''}</span>}</span>
              <span className={styles.monthStatus}>{needsWork > 0 ? <span className={styles.needsWork}>{needsWork} need attention</span> : validated > 0 ? <span><CheckCheck size={14} />{validated} validated</span> : null}</span>
              <ChevronDown size={18} className={styles.chevron} />
            </button></h3>
            {open && <div className={styles.components} id={`${id}-month-${month.key || 'undated'}`}>
              {month.components.map((component, componentIndex) => {
                const componentKey = JSON.stringify([month.key, component.key]);
                const componentOpen = closedComponents[componentKey] === undefined ? expandComponents || componentIndex === 0 : !closedComponents[componentKey];
                const contentId = `${id}-component-${month.key}-${componentIndex}`;
                return <section key={component.key} className={styles.component} aria-label={`${component.label} component`}>
                  <h4><button type="button" className={styles.componentToggle} aria-label={component.label} aria-expanded={componentOpen} aria-controls={contentId}
                    onClick={() => setClosedComponents(value => ({ ...value, [componentKey]: componentOpen }))}>
                    <Folder size={17} /><span className={styles.componentTitle}><strong>{component.label}</strong>{component.context && <span>{component.context}</span>}</span>
                    <span className={styles.componentCount}>{component.items.length} {component.items.length === 1 ? 'item' : 'items'}</span><ChevronDown size={15} className={styles.chevron} />
                  </button></h4>
                  {componentOpen && <div id={contentId} className={styles.files}>{component.items.map(item => <EvidenceFile key={item.id} item={item} onOpen={onOpen} />)}</div>}
                </section>;
              })}
            </div>}
          </section>
        </div>;
      })}
    </div>
  </section>;
}

function EvidenceFile({ item, onOpen }: { item: EvidenceItem; onOpen: (id: string) => void }) {
  const status = item.historical ? item.rawStatus || 'Recorded' : item.status;
  const tone = item.status === 'Validated' ? 'validated' : item.status === 'Needs work' ? 'needsWork'
    : item.status === 'Submitted' || item.status === 'Pending tutor' ? 'pending' : 'neutral';
  const previous = item.historical;
  return <button type="button" className={styles.file} aria-label={`Open evidence: ${item.title}`} onClick={() => onOpen(item.id)}>
    <span className={styles.fileIcon}>{previous && !previous.has_file && previous.has_note ? <MessageSquare size={18} /> : <FileText size={18} />}</span>
    <span className={styles.fileInfo}><span className={styles.fileTitle}>{item.title}</span>
      <span className={styles.fileMeta}><span>{item.date}</span><i /><span>{previous ? 'Previous evidence' : 'Uploaded here'}</span>
        <i /><span>{item.type}</span>{item.documents?.[0]?.size && <><i /><span>{item.documents[0].size}</span></>}
        {previous?.has_report && <span className={styles.attachment}><Paperclip size={12} />Assessment report</span>}
        {previous?.has_note && <span className={styles.attachment}><MessageSquare size={12} />Note</span>}
      </span>
      {item.ksb.length > 0 && <span className={styles.ksbs}>{item.ksb.slice(0, 3).map(code => <span key={code}>{code}</span>)}{item.ksb.length > 3 && <span title={item.ksb.slice(3).join(', ')}>+{item.ksb.length - 3}</span>}</span>}
    </span>
    <span className={`${styles.status} ${styles[tone]}`}><i />{status}</span><ArrowUpRight size={16} className={styles.fileArrow} />
  </button>;
}
