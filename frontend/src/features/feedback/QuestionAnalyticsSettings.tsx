import type { ReactNode } from 'react';
import type { FeedbackQuestion, FeedbackQuestionAnalyticsSettings } from '@/api/feedback';
import { IMPORTANCE_OPTIONS, questionAnalyticsSettings } from './questionAnalyticsConfig';
import { isScorableQuestion, previewClass, previewQuestionScore, scoringReadiness } from './scorePreview';
import styles from './ScoringSetup.module.css';
import { SCORE_CLASSIFICATION_TEXT } from './scoreClassification';

const field = 'mt-1.5 w-full rounded-lg border border-foreground-200/70 bg-white px-3 py-2 text-xs disabled:bg-background-100';
const OPTION_TYPES = new Set(['single_choice', 'dropdown', 'likert', 'multiple_choice']);

export function QuestionAnalyticsSettings({ question, disabled, onChange, renderAnswerOptions }: {
  question: FeedbackQuestion; disabled: boolean; onChange: (config: FeedbackQuestion['config']) => void;
  renderAnswerOptions?: (renderScore: (option: string, index: number) => ReactNode) => ReactNode;
}) {
  const settings = questionAnalyticsSettings(question);
  const update = (patch: FeedbackQuestionAnalyticsSettings) => onChange({
    ...question.config, analytics: { ...settings, ...((OPTION_TYPES.has(question.type) || question.type === 'yes_no') ? { scoring: 'options' as const } : {}), ...patch },
  });
  const hasScoring = isScorableQuestion(question);
  const readiness = scoringReadiness(question);
  const scale = question.type === 'rating' && readiness.state === 'ready'
    && Number.isInteger(question.config.min ?? 1) && Number.isInteger(question.config.max ?? 5)
    && (question.config.max ?? 5) - (question.config.min ?? 1) <= 9
    ? Array.from({ length: (question.config.max ?? 5) - (question.config.min ?? 1) + 1 }, (_, index) => (question.config.min ?? 1) + index) : [];
  const positive = settings.scoring !== 'options' ? ''
    : settings.optionScores.yes === 100 && settings.optionScores.no === 0 ? 'yes'
      : settings.optionScores.yes === 0 && settings.optionScores.no === 100 ? 'no' : 'custom';
  const renderOptionScore = (option: string, index: number) => <div className={styles.scoreControl}>
    <input disabled={disabled} type="number" min={0} max={100} step="any" aria-label={`Score for answer ${index + 1}: ${option}`} className={field} value={settings.optionScores[option] ?? ''} onChange={event => {
      const optionScores = { ...settings.optionScores };
      if (event.target.value === '') delete optionScores[option];
      else optionScores[option] = Number(event.target.value);
      update({ optionScores });
    }} />
    <small><span className={`${styles.badge} ${styles[previewClass(settings.optionScores[option] ?? null)]}`}>{previewClass(settings.optionScores[option] ?? null)}</span></small>
  </div>;
  return <>
    {OPTION_TYPES.has(question.type) && renderAnswerOptions?.(renderOptionScore)}
    <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-primary-100 bg-primary-50/30 p-3">
    <legend className="px-1 text-xs font-bold text-primary-800">Scoring &amp; analytics</legend>
    <span className={`${styles.badge} ${styles[readiness.state]}`}>{readiness.label}</span>
    {hasScoring && <label className="block text-xs font-semibold text-foreground-700">Importance<select aria-label="Question importance" className={field} value={settings.importance} onChange={event => update({ importance: event.target.value as FeedbackQuestionAnalyticsSettings['importance'] })}>{IMPORTANCE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label} (weight {option.weight})</option>)}</select><span className="mt-1 block text-[11px] font-normal text-foreground-500">A higher weight gives this question more influence on the complete response score.</span></label>}
    {question.type === 'rating' && <label className="block text-xs font-semibold text-foreground-700">Scoring<select aria-label="Question scoring" className={field} value={settings.scoring === 'none' ? '' : settings.scoring} onChange={event => update({ scoring: event.target.value as FeedbackQuestionAnalyticsSettings['scoring'] })}><option value="" disabled>Choose scoring direction</option><option value="higher">Higher is better</option><option value="lower">Lower is better</option></select><span className="mt-1 block text-[11px] font-normal text-foreground-500">A 1–5 scale maps to 0%, 25%, 50%, 75%, 100%. Lower is better reverses the scale.</span></label>}
    {scale.length > 0 && <ul aria-label="Rating score mapping" className={styles.scale}>{scale.map(value => { const score = previewQuestionScore(question, value)!; const classification = previewClass(score); return <li key={value}><strong>{value}{question.config.display === 'stars' ? ' ★' : ''}</strong>{Math.round(score * 100) / 100}%<span className={`block ${styles[classification]}`}>{classification[0].toUpperCase() + classification.slice(1)}</span></li>; })}</ul>}
    {question.type === 'yes_no' && <label className="block text-xs font-semibold text-foreground-700">Positive answer<select aria-label="Positive answer" className={field} value={positive} onChange={event => update(event.target.value === 'custom' ? { scoring: 'options', optionScores: settings.optionScores } : { scoring: 'options', optionScores: event.target.value === 'yes' ? { yes: 100, no: 0 } : { yes: 0, no: 100 } })}><option value="" disabled>Choose a preset or enter scores below</option><option value="yes">Yes is positive (100%)</option><option value="no">No is positive (100%)</option><option value="custom">Custom answer scores</option></select></label>}
    {question.type === 'yes_no' && <div className="grid grid-cols-2 gap-3">{(['yes', 'no'] as const).map(option => <label key={option} className="text-xs font-semibold">{option === 'yes' ? 'Yes score (%)' : 'No score (%)'}<input type="number" min={0} max={100} step="any" aria-label={option === 'yes' ? 'Yes score' : 'No score'} className={field} value={settings.optionScores[option] ?? ''} onChange={event => {
      const optionScores = { ...settings.optionScores };
      if (event.target.value === '') delete optionScores[option];
      else optionScores[option] = Number(event.target.value);
      update({ optionScores });
    }} /><span className={`${styles.badge} ${styles[previewClass(settings.optionScores[option] ?? null)]}`}>{previewClass(settings.optionScores[option] ?? null)}</span></label>)}</div>}
    {question.type === 'number' && <>
      <label className="block text-xs font-semibold text-foreground-700">Scoring<select aria-label="Question scoring" className={field} value={settings.scoring === 'none' ? '' : settings.scoring} onChange={event => update({ scoring: event.target.value as 'none' | 'higher' | 'lower' })}><option value="" disabled>Choose scoring direction</option><option value="higher">Higher is better</option><option value="lower">Lower is better</option></select></label>
      {hasScoring && <><div className="grid grid-cols-2 gap-3">{(['scoreMin', 'scoreMax'] as const).map(key => <label key={key} className="text-xs font-semibold">{key === 'scoreMin' ? 'Scoring minimum' : 'Scoring maximum'}<input aria-label={key === 'scoreMin' ? 'Scoring minimum' : 'Scoring maximum'} type="number" step="any" className={field} value={settings[key] ?? ''} onChange={event => update({ [key]: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>)}</div><p className="text-[11px] leading-5 text-foreground-500">This range affects reporting only. Values outside the range receive the nearest endpoint score (0% or 100%); student answer validation is unchanged. Lower is better reverses the scale.</p></>}
    </>}
    {OPTION_TYPES.has(question.type) && <>
      <p className="text-xs font-semibold text-foreground-700">Score for each answer (required before publishing)</p>
      <div className="space-y-2"><p className="text-[11px] text-foreground-500">Give every answer a score from 0 to 100. Zero is a valid score.{question.type === 'multiple_choice' ? ' For multiple answers, the question score is the average of the selected options.' : ''}</p>{!renderAnswerOptions && (question.config.options || []).map((option, index) => <div key={index} className={styles.optionScore}><span>{option}</span>{renderOptionScore(option, index)}</div>)}</div>
    </>}
    {!['rating', 'yes_no', 'number', ...OPTION_TYPES].includes(question.type) && <p className="text-[11px] text-foreground-600">Qualitative or informational question. Answer rate is shown without an automatic score. Written answers require human review; no AI sentiment is inferred.</p>}
    {hasScoring && <label className="flex items-center gap-2 text-xs font-medium text-foreground-700"><input type="checkbox" checked={settings.includeInOverall} onChange={event => update({ includeInOverall: event.target.checked })} />Include in Overall Score</label>}
    {hasScoring && <p className="text-[11px] text-foreground-500">Included questions also contribute to the complete response classification. Excluded questions still show their own answer statistics.</p>}
    <p className="text-[11px] leading-5 text-foreground-500">Staff settings only. Learners do not see scores or weights. These settings never change question selection or feedback availability.</p>
    <p className="text-[11px] leading-5 text-primary-800">{SCORE_CLASSIFICATION_TEXT} Text and unanswered questions are never automatically negative.</p>
    {readiness.state === 'incomplete' && <p role="status" className={styles.notice}>{readiness.message}</p>}
    </fieldset>
  </>;
}
