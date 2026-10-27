import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { TransferReview } from '@/api/progressTransfer';
import { byWeek } from './componentSuggestions';
import styles from './progressTransfers.module.css';

type Sources = TransferReview['modules'][number]['sources'];

export function SourceWeekReview({ moduleTitle, sources, isMatched, disabled, children }: {
  moduleTitle: string; sources: Sources; isMatched: (source: Sources[number]) => boolean;
  disabled: boolean; children: (sources: Sources) => ReactNode;
}) {
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const panels = useRef<(HTMLElement | null)[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const focusPanel = useRef(false);
  const weeks = useMemo(() => byWeek(sources), [sources]);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const selectedIndex = Math.max(0, weeks.findIndex(([week]) => week === selectedWeek));
  const totals = weeks.map(([, rows]) => rows.filter(isMatched).length);
  const nextUnmatched = [...weeks.keys()].map(index => (selectedIndex + index + 1) % weeks.length)
    .find(index => index !== selectedIndex && totals[index] < weeks[index][1].length);
  function select(index: number, moveFocus = false) {
    if (disabled || !weeks[index]) return;
    focusPanel.current = moveFocus;
    setSelectedWeek(weeks[index][0]);
  }
  useLayoutEffect(() => {
    if (focusPanel.current) panels.current[selectedIndex]?.focus({ preventScroll: true });
    focusPanel.current = false;
    const tab = tabs.current[selectedIndex]?.getBoundingClientRect();
    const bounds = list.current?.getBoundingClientRect();
    if (tab && bounds && list.current) {
      list.current.scrollTop += Math.max(0, tab.bottom - bounds.bottom) + Math.min(0, tab.top - bounds.top);
    }
  }, [selectedIndex]);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowDown' ? (index + 1) % weeks.length
      : event.key === 'ArrowUp' ? (index + weeks.length - 1) % weeks.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? weeks.length - 1 : null;
    if (next === null || disabled) return;
    event.preventDefault();
    select(next);
    tabs.current[next]?.focus();
  }
  if (!weeks.length) return null;
  return <div className={styles.sourceWeekLayout}>
    <aside className={styles.sourceWeekSidebar}>
      <div className={styles.sourceWeekIntro}><strong>Old LMS weeks</strong><span>Select a week to review its matches.</span></div>
      <div ref={list} role="tablist" aria-label={`Old LMS weeks in ${moduleTitle}`} aria-orientation="vertical" className={styles.sourceWeekList}>
        {weeks.map(([week, rows], index) => <button key={week} type="button" role="tab" id={`${id}-tab-${index}`}
          ref={element => { tabs.current[index] = element; }} className={styles.sourceWeekTab}
          aria-selected={index === selectedIndex} aria-controls={`${id}-panel-${index}`}
          tabIndex={index === selectedIndex ? 0 : -1} disabled={disabled}
          onClick={() => select(index)} onKeyDown={event => navigate(event, index)}>
          <strong>{week || 'No week specified'}</strong>{' '}
          <span>{rows.length} {rows.length === 1 ? 'component' : 'components'} · {totals[index]}/{rows.length} matched</span>{' '}
          <small className={totals[index] === rows.length ? styles.sourceWeekDone : styles.sourceWeekPending}>
            {totals[index] === rows.length ? 'All matched' : `${rows.length - totals[index]} ${rows.length - totals[index] === 1 ? 'needs' : 'need'} a match`}
          </small>
        </button>)}
      </div>
    </aside>
    <label className={styles.sourceWeekMobile}>
      <span>Week in {moduleTitle}</span>
      <select value={selectedIndex} onChange={event => select(Number(event.target.value))} disabled={disabled}
        aria-controls={`${id}-panel-${selectedIndex}`}>
        {weeks.map(([week, rows], index) => <option key={week} value={index}>
          {week || 'No week specified'} · {totals[index]}/{rows.length} matched
        </option>)}
      </select>
    </label>
    <div className={styles.sourceWeekContent}>
      {weeks.map(([week, rows], index) => <section key={week} id={`${id}-panel-${index}`} role="tabpanel"
        ref={element => { panels.current[index] = element; }}
        aria-label={`${moduleTitle}: ${week || 'No week specified'}`} hidden={index !== selectedIndex}
        tabIndex={0} className={styles.sourceWeekPanel}>
        {index === selectedIndex && <>
          <header className={styles.sourceWeekHeader}>
            <div><span>Week {index + 1} of {weeks.length}</span><h4>{week || 'No week specified'}</h4>
              <p>{rows.length} {rows.length === 1 ? 'component' : 'components'} · {totals[index]} matched · {rows.length - totals[index]} unmatched</p></div>
            {nextUnmatched !== undefined && <button type="button" className={styles.secondaryButton} disabled={disabled}
              onClick={() => select(nextUnmatched, true)}>Next unmatched week</button>}
          </header>
          <div className={styles.sourceWeekItems}>{children(rows)}</div>
          <footer className={styles.sourceWeekFooter}>
            <button type="button" className={styles.secondaryButton} disabled={disabled || index === 0} onClick={() => select(index - 1, true)}>Previous week</button>
            <span>{index + 1} / {weeks.length}</span>
            <button type="button" className={styles.secondaryButton} disabled={disabled || index === weeks.length - 1} onClick={() => select(index + 1, true)}>Next week</button>
          </footer>
        </>}
      </section>)}
    </div>
  </div>;
}
