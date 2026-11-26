import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { MarkingSection, MarkingSectionEntry } from '@/features/coach/marking/types/marking.types';
import styles from './markingPartSections.module.css';

/** Long answers start collapsed so a coach can scan every step before reading in depth. */
const COLLAPSE_AFTER_CHARS = 700;

function Prose({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > COLLAPSE_AFTER_CHARS;
  const paragraphs = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  return (
    <div>
      <div className={styles.prose} data-collapsed={long && !expanded ? 'true' : undefined}>
        {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </div>
      {long && (
        <button type="button" className={styles.more} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          {expanded ? 'Show less' : 'Show full answer'}
          <i className={expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function hoursTotal(items: { hours?: string }[]) {
  const values = items.map(item => Number.parseFloat(item.hours ?? ''));
  return values.every(Number.isFinite) && values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function EntryBody({ entry }: { entry: MarkingSectionEntry }) {
  const items = entry.items ?? [];
  switch (entry.format) {
    case 'value':
      return <p className={styles.value}>{entry.text}</p>;
    case 'checks':
      return (
        <ul className={styles.checks}>
          {items.map(item => (
            <li key={item.label} data-passed={item.passed ? 'true' : 'false'}>
              <i className={item.passed ? 'ri-checkbox-circle-fill' : 'ri-close-circle-fill'} aria-hidden="true" />
              <span>{item.label}</span>
              <span className="sr-only">{item.passed ? 'Yes' : 'No'}</span>
            </li>
          ))}
        </ul>
      );
    case 'time': {
      const total = hoursTotal(items);
      return (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th scope="col">Date</th><th scope="col">Topic</th><th scope="col">Hours</th></tr></thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`${item.date}-${index}`}><td>{item.date || '—'}</td><td>{item.topic || '—'}</td><td>{item.hours ? `${item.hours} h` : '—'}</td></tr>
              ))}
            </tbody>
            {total !== null && <tfoot><tr><th scope="row" colSpan={2}>Total</th><td>{total} h</td></tr></tfoot>}
          </table>
        </div>
      );
    }
    case 'ksbs':
      return (
        <ul className={styles.ksbs}>
          {items.map(item => (
            <li key={item.code}><span className={styles.code}>{item.code}</span><p>{item.explanation}</p></li>
          ))}
        </ul>
      );
    case 'evidence':
      return items.length ? (
        <ul className={styles.evidence}>
          {items.map((item, index) => (
            <li key={`${item.name}-${index}`}>
              <i className={item.url ? 'ri-link' : 'ri-file-text-line'} aria-hidden="true" />
              <div>
                {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a> : <strong>{item.name}</strong>}
                {item.points && <span>Linked to answer points: {item.points}</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className={styles.empty}>{entry.text}</p>;
    case 'slides':
      return (
        <ol className={styles.slides}>
          {items.map((item, index) => (
            <li key={`${item.title}-${index}`}>
              <span className={styles.slideNumber}>{index + 1}</span>
              <div><strong>{item.title}</strong>{item.body && <p>{item.body}</p>}</div>
            </li>
          ))}
        </ol>
      );
    default:
      return <Prose text={entry.text} />;
  }
}

const FEEDBACK_TAB = 'feedback';

/**
 * The learner's answers for one part of a monthly report: one tab per step,
 * then the coach feedback and decision in the last tab.
 */
export function MarkingPartSections({ sections, feedback }: { sections: MarkingSection[]; feedback?: ReactNode }) {
  const tabs = [...sections.map(section => String(section.step)), ...(feedback ? [FEEDBACK_TAB] : [])];
  const [active, setActive] = useState(tabs[0] ?? FEEDBACK_TAB);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const section = sections.find(item => String(item.step) === active);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const edge = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : null;
    if (!offset && !edge) return;
    event.preventDefault();
    const next = edge ?? tabs[(tabs.indexOf(active) + offset + tabs.length) % tabs.length];
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className={styles.parts}>
      <div className={styles.stepNav} role="tablist" aria-label="Steps in this part" onKeyDown={onKeyDown}>
        {sections.map(item => {
          const id = String(item.step);
          return (
            <button type="button" role="tab" key={id} id={`marking-step-tab-${id}`} ref={node => { tabRefs.current[id] = node; }}
              aria-selected={active === id} aria-controls="marking-step-panel" tabIndex={active === id ? 0 : -1} onClick={() => setActive(id)}>
              <span>{item.step}</span>{item.title}
            </button>
          );
        })}
        {feedback && (
          <button type="button" role="tab" id={`marking-step-tab-${FEEDBACK_TAB}`} ref={node => { tabRefs.current[FEEDBACK_TAB] = node; }}
            aria-selected={active === FEEDBACK_TAB} aria-controls="marking-step-panel" tabIndex={active === FEEDBACK_TAB ? 0 : -1}
            data-feedback="true" onClick={() => setActive(FEEDBACK_TAB)}>
            <span><i className="ri-chat-check-line" aria-hidden="true" /></span>Feedback &amp; decision
          </button>
        )}
      </div>
      <div role="tabpanel" id="marking-step-panel" aria-labelledby={`marking-step-tab-${active}`}>
        {section ? (
          <section className={styles.step}>
            <header className={styles.stepHeader}>
              <span className={styles.badge} aria-hidden="true">{section.step}</span>
              <div>
                <p>Step {section.step} of {sections[sections.length - 1]?.step ?? section.step}</p>
                <h4>{section.title}</h4>
              </div>
            </header>
            <div className={styles.stepBody}>
              {section.entries.length ? section.entries.map(entry => (
                <div className={styles.entry} key={entry.label} data-format={entry.format ?? 'text'}>
                  <h5>{entry.label}</h5>
                  <EntryBody entry={entry} />
                </div>
              )) : <p className={styles.empty}>Nothing was entered for this step.</p>}
            </div>
          </section>
        ) : feedback}
      </div>
    </div>
  );
}
