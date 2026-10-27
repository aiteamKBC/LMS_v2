import { useState } from 'react';
import type { FeedbackAnswerValue, FeedbackQuestion, FeedbackSection } from '@/api/feedback';
import { questionAnalyticsSettings } from './questionAnalyticsConfig';
import { previewClass, previewQuestionScore, previewResponseScore, scoringQuestions } from './scorePreview';
import styles from './ScoringSetup.module.css';

const percent = (value: number) => `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value)}%`;

function ExampleAnswer({ question, value, onChange, label }: { question: FeedbackQuestion; value?: FeedbackAnswerValue; onChange: (value?: FeedbackAnswerValue) => void; label: string }) {
  const options = question.config.options || [];
  if (question.type === 'yes_no') return <label>Example answer<select aria-label={label} className={styles.field} value={typeof value === 'boolean' ? String(value) : ''} onChange={event => onChange(event.target.value === '' ? undefined : event.target.value === 'true')}><option value="">Choose an example answer</option><option value="true">Yes</option><option value="false">No</option></select></label>;
  if (question.type === 'multiple_choice') return <fieldset className={styles.options}><legend>{label} — choose one or more</legend>{options.map((option, index) => <label key={index}><input type="checkbox" checked={Array.isArray(value) && value.includes(option)} onChange={event => { const selected = Array.isArray(value) ? value : []; onChange(event.target.checked ? [...selected, option] : selected.filter(item => item !== option)); }} />{option}</label>)}</fieldset>;
  if (['single_choice', 'dropdown', 'likert'].includes(question.type)) return <label>Example answer<select aria-label={label} className={styles.field} value={typeof value === 'string' && options.includes(value) ? value : ''} onChange={event => onChange(event.target.value || undefined)}><option value="">Choose an example answer</option>{options.map((option, index) => <option key={index} value={option}>{option}</option>)}</select></label>;
  if (question.type === 'rating') {
    const min = question.config.min ?? 1, max = question.config.max ?? 5;
    if (Number.isInteger(min) && Number.isInteger(max) && max - min <= 20) return <label>Example rating<select aria-label={label} className={styles.field} value={typeof value === 'number' ? value : ''} onChange={event => onChange(event.target.value === '' ? undefined : Number(event.target.value))}><option value="">Choose a rating</option>{Array.from({ length: max - min + 1 }, (_, index) => min + index).map(rating => <option key={rating} value={rating}>{rating}{question.config.display === 'stars' ? rating === 1 ? ' star' : ' stars' : ''}</option>)}</select></label>;
  }
  return <label>Example value<input type="number" step="any" aria-label={label} className={styles.field} value={typeof value === 'number' ? value : ''} onChange={event => onChange(event.target.value === '' ? undefined : event.target.valueAsNumber)} /></label>;
}

function ScoreSimulation({ sections, bank }: { sections: FeedbackSection[]; bank: boolean }) {
  const entries = scoringQuestions(sections);
  const initialSelection = () => Object.fromEntries(entries.map(entry => [entry.key, entry.questionIndex < (bank ? entry.section.questionsPerDelivery ?? entry.section.questions.length : entry.section.questions.length)]));
  const [selected, setSelected] = useState<Record<string, boolean>>(initialSelection);
  const [answers, setAnswers] = useState<Record<string, FeedbackAnswerValue>>({});
  const outcome = previewResponseScore(entries.filter(entry => selected[entry.key]).map(entry => ({ ...entry, answer: answers[entry.key] })));
  const update = (key: string, value?: FeedbackAnswerValue) => setAnswers(current => {
    const next = { ...current };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next;
  });
  return <section aria-label="Staff scoring simulation" className={styles.preview}>
    <div className={styles.actions}><h3>Try an example response</h3><button type="button" className={styles.button} onClick={() => { setAnswers({}); setSelected(initialSelection()); }}>Reset example</button></div>
    <p className={styles.help}>Choose sample answers to see the calculation. Nothing is submitted or saved. Only answered, scored questions included in Overall Score contribute.</p>
    {bank && <p className={styles.help}>The first questions in each category are selected as an example. You can swap them below. Live lectures continue to use their own saved random selection.</p>}
    <div role="region" aria-label="Example response result" aria-live="polite" className={styles.result}><div><h4>Example response score</h4><strong>{outcome.score == null ? 'No score yet' : percent(outcome.score)}</strong><p>{outcome.scoredQuestions} answered questions in this calculation · total weight {outcome.weight}</p></div><span className={`${styles.badge} ${styles[outcome.classification]}`}>{outcome.classification[0].toUpperCase() + outcome.classification.slice(1)}</span></div>
    <div className={styles.categories}>{sections.map((section, sectionIndex) => {
      const questions = entries.filter(entry => entry.sectionIndex === sectionIndex);
      const count = questions.filter(entry => selected[entry.key]).length;
      const quota = bank ? section.questionsPerDelivery ?? questions.length : questions.length;
      const canSwap = bank && quota < questions.length;
      return <details key={sectionIndex} className={styles.category} open={sectionIndex === 0}><summary><span>{section.title || `Section ${sectionIndex + 1}`}</span><small>{count}/{quota} in example{canSwap ? ' · swap any selected question' : ' · fixed questions'}</small></summary><div className={styles.sampleList}>{questions.map(entry => {
        const settings = questionAnalyticsSettings(entry.question);
        const sampleScore = previewQuestionScore(entry.question, answers[entry.key]);
        const classification = previewClass(sampleScore);
        const label = `Example answer ${entry.sectionIndex + 1}.${entry.questionIndex + 1}: ${entry.question.text || 'Untitled question'}`;
        return <article key={entry.key} className={styles.sampleQuestion}><label className={styles.sampleTitle}><input type="checkbox" aria-label={`Include in example ${entry.sectionIndex + 1}.${entry.questionIndex + 1}`} checked={selected[entry.key] || false} disabled={!canSwap || (!selected[entry.key] && count >= quota)} onChange={event => setSelected(current => ({ ...current, [entry.key]: event.target.checked }))} />{entry.question.text || `Question ${entry.questionIndex + 1}`}</label>{selected[entry.key] && <div className={styles.sampleInputs}>{entry.readiness.state === 'ready' ? <><ExampleAnswer question={entry.question} value={answers[entry.key]} label={label} onChange={value => update(entry.key, value)} /><div className={styles.sampleNote}><span className={`${styles.badge} ${styles[classification]}`}>{sampleScore == null ? 'Unanswered · no score' : `${percent(sampleScore)} · ${classification}`}</span><span>{settings.importance} importance{settings.includeInOverall ? '' : ' · excluded from response score'}</span></div></> : <p className={styles.help}>{entry.readiness.message}</p>}</div>}</article>;
      })}</div></details>;
    })}</div>
    <details className={styles.breakdown}><summary>How the example score is calculated</summary><p className={styles.help}>Sum of (question score × importance weight) ÷ sum of contributing weights. Blank, unscored and excluded answers do not count as zero. Classification uses the unrounded result.</p><div className={styles.table}><table aria-label="Example score calculation"><thead><tr><th>Question</th><th>Score</th><th>Weight</th><th>Contribution</th></tr></thead><tbody>{outcome.rows.map(row => <tr key={row.key}><td>{row.question.text || 'Untitled question'}</td><td>{row.score == null ? 'Unscored / unanswered' : percent(row.score)}</td><td>{row.weight}</td><td>{row.included ? `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(row.score! * row.weight)} / ${row.weight}` : 'Excluded'}</td></tr>)}</tbody></table></div><p className={styles.help}>{outcome.weight ? `${outcome.total} ÷ ${outcome.weight} = ${percent(outcome.score!)}` : 'No contributing answers yet.'}</p></details>
    <p className={styles.help}>This is a staff calculation example. Required answers and all existing submission rules still apply to real learners.</p>
  </section>;
}

export function FormScorePreview({ sections, bank }: { sections: FeedbackSection[]; bank: boolean }) {
  // Structure edits reset sample identities; changing scores or importance keeps the sample for comparison.
  const shape = JSON.stringify([bank, sections.map(section => [section.id, section.title, section.questionsPerDelivery, section.questions.map(question => [question.id, question.type, question.text, question.config.options, question.config.min, question.config.max])])]);
  return <ScoreSimulation key={shape} sections={sections} bank={bank} />;
}
