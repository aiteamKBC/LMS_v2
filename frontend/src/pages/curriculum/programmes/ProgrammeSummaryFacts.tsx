import { AppIcon } from '@/components/feature/AppIcon';
import type { CurriculumProgramme, CurriculumStandard } from '@/lib/curriculumApi';
import styles from './ProgrammeSummaryFacts.module.css';

interface ProgrammeSummaryFactsProps {
  programme: CurriculumProgramme;
  source: { value: string; title: string; subtitle: string; detail: string; ksbCount: number; standard?: CurriculumStandard };
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenSource: () => void;
  onOpen: (tab: 'delivery' | 'design' | 'coverage', view?: 'mapping' | 'achievement') => void;
}

/** Uses the same programme and applied-source records as the former tools card. */
export function ProgrammeSummaryFacts({ programme, source, loading, error, onRetry, onOpenSource, onOpen }: ProgrammeSummaryFactsProps) {
  const standard = source.standard;
  const sourceEmpty = Boolean(source.value) && source.ksbCount < 1;
  const learnerCount = programme.learnerKsbLearnerCount || 0;
  const hasDenominator = (programme.learnerKsbExpectedWeight || 0) > 0 && learnerCount > 0;
  const progress = Math.max(0, Math.min(100, Math.round(programme.learnerKsbProgressPercentage || 0)));
  const mapping = source.value && programme.ksbTotal > 0 ? Math.round(programme.ksbMapped / programme.ksbTotal * 100) : 0;
  const metadata = [
    ['Minimum compliance hours', standard?.minimumHours ? `${standard.minimumHours} hrs min` : ''],
    ['Maximum funding', standard?.maxFunding ? `${standard.maxFunding} max funding` : ''],
    ['Typical duration', standard?.duration], ['Route', standard?.route], ['Qualification type', standard?.degree],
    ['LARS code', standard?.larsCode ? `LARS ${standard.larsCode}` : ''],
    ['External quality assurance', standard?.eqaProvider], ['Approved for delivery', standard?.approvedForDelivery],
  ].filter(([, value]) => Boolean(value));
  return <div className={styles.facts} role="group" aria-label="Programme facts">
    {loading ? <p role="status">Loading applied KSB source…</p>
      : error ? <p role="alert">Applied KSB source unavailable. <button type="button" onClick={onRetry}>Retry KSB source</button></p>
        : <>
          <button type="button" className={styles.source} onClick={onOpenSource}
            aria-label={!source.value ? `Set the KSB source for ${programme.name}` : sourceEmpty ? `Choose a real KSB source for ${programme.name}` : `View KSBs for ${source.title}`}>
            <AppIcon className={source.value && !sourceEmpty ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'} />
            <span><small>{!source.value ? 'KSB Source required' : sourceEmpty ? 'Applied KSB Source · empty' : 'Applied KSB Source'}</small>
              <strong>{source.title}</strong><span>{!source.value ? 'Modules cannot map KSBs and coverage cannot be measured until one is applied.'
                : sourceEmpty ? 'A placeholder with no KSB codes in it. Apply the programme’s real profile or standard to make it mappable.' : source.detail || source.subtitle}</span></span>
            <AppIcon className="ri-arrow-right-s-line" />
          </button>
          {metadata.length > 0 && <dl className={styles.metadata}>{metadata.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
        </>}
    <button type="button" className={styles.progress} onClick={() => onOpen('coverage', 'mapping')} aria-label={`Open KSB coverage for ${programme.name}`}>
      <span><strong>KSB Progress</strong><span>{hasDenominator ? `${programme.learnerKsbCodesStarted || 0}/${programme.learnerKsbCodesTotal || 0} KSBs · ${learnerCount} learner${learnerCount === 1 ? '' : 's'}`
        : loading ? 'Loading source' : error ? 'Mapping unavailable' : `Mapping ${source.value ? `${mapping}%` : 'not applied'}`}</span></span>
      <span className={styles.progressLine}><span className={styles.track}><span style={{ width: `${hasDenominator ? progress : 0}%` }} /></span>
        <span>{hasDenominator ? `${progress}%` : learnerCount === 0 ? 'No learners' : 'Needs mapping'}</span></span>
    </button>
    {programme.description && <p className={styles.description}>{programme.description}</p>}
  </div>;
}
