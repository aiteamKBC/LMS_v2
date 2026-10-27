import { useState } from 'react';
import type { FeedbackSection } from '@/api/feedback';
import { scoringQuestions } from './scorePreview';
import { FormScorePreview } from './FormScorePreview';
import styles from './ScoringSetup.module.css';

export function FormScoringSetup({ sections, bank, locked, onSelect }: { sections: FeedbackSection[]; bank: boolean; locked: boolean; onSelect: (sectionIndex: number, questionIndex: number) => void }) {
  const [reviewing, setReviewing] = useState(false);
  const [trying, setTrying] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const entries = scoringQuestions(sections);
  const filtered = entries.filter(entry => (filter === 'all' || entry.readiness.state === filter) && `${entry.section.title} ${entry.question.text}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 8));
  const current = Math.min(page, pages);
  const incomplete = entries.filter(entry => entry.readiness.state === 'incomplete').length;
  return <section aria-label="Form scoring setup" className={styles.panel}>
    <header className={styles.header}><div><h2>Form scoring setup</h2><p className={styles.help}>Set how answers contribute to Positive, Neutral or Negative feedback. These settings are visible to staff only.</p></div><div className={styles.actions}><button type="button" className={styles.button} onClick={() => setReviewing(value => !value)} aria-expanded={reviewing}>{reviewing ? 'Hide scoring review' : 'Review question scoring'}</button><button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => setTrying(value => !value)} aria-expanded={trying}>{trying ? 'Close scoring example' : 'Try scoring'}</button></div></header>
    <div className={styles.stats}>{[['ready', 'Ready to score'], ['incomplete', 'Needs setup'], ['not_scored', 'Not scored']].map(([state, label]) => <div key={state} className={styles.stat}><strong>{entries.filter(entry => entry.readiness.state === state).length}</strong>{label}</div>)}</div>
    {reviewing && <div className={styles.body}>
      {locked && <p className={styles.help}>This version is locked. You can inspect its scoring and try example answers; its saved questions remain read-only.</p>}
      {incomplete > 0 && <p role="status" className={styles.notice}>Finish the scoring settings for {incomplete} {incomplete === 1 ? 'question' : 'questions'}, or choose Not scored. A blank option score is different from 0%.</p>}
      <div className={styles.filters}><label>Find a question<input type="search" aria-label="Search scoring questions" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className={styles.field} placeholder="Question or category" /></label><label>Scoring status<select aria-label="Filter scoring readiness" value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }} className={styles.field}><option value="all">All questions</option><option value="incomplete">Needs setup</option><option value="ready">Ready to score</option><option value="not_scored">Not scored</option></select></label></div>
      <ul className={styles.list}>{filtered.slice((current - 1) * 8, current * 8).map(entry => <li key={entry.key} className={styles.row}><div className={styles.rowText}><strong>{entry.question.text || `Question ${entry.questionIndex + 1}`}</strong><small>{entry.section.title} · {entry.readiness.message}</small></div><span className={`${styles.badge} ${styles[entry.readiness.state]}`}>{entry.readiness.label}</span><button type="button" className={styles.button} aria-label={`${locked ? 'Inspect' : 'Configure'} scoring ${entry.sectionIndex + 1}.${entry.questionIndex + 1}`} onClick={() => onSelect(entry.sectionIndex, entry.questionIndex)}>{locked ? 'Inspect' : 'Configure'}</button></li>)}</ul>
      {!filtered.length && <p className={styles.help}>No questions match this selection.</p>}
      <div className={styles.pager}><span>{filtered.length} questions · page {current} of {pages}</span><div className={styles.actions}><button type="button" className={styles.button} disabled={current === 1} onClick={() => setPage(current - 1)}>Previous questions</button><button type="button" className={styles.button} disabled={current === pages} onClick={() => setPage(current + 1)}>Next questions</button></div></div>
    </div>}
    {trying && <FormScorePreview sections={sections} bank={bank} />}
  </section>;
}
