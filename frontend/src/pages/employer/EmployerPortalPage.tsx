import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import { fetchEmployerPortal, type EmployerLearnerCard, type EmployerPortal } from '@/api/employerPortal';
import { useEmployerPortalChrome } from './employerPortalNav';
import styles from './EmployerPortalPage.module.css';

const BANNER_IMAGE = '/assets/employer/graduation-group.webp';

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((word) => word[0]).slice(0, 2).join('').toUpperCase();
}

function avatarTone(name: string) {
  const tones = [styles.avatarMint, styles.avatarBlue, styles.avatarPurple, styles.avatarRose, styles.avatarAmber];
  const seed = Array.from(name).reduce((total, character) => total + character.charCodeAt(0), 0);
  return tones[seed % tones.length];
}

function documentMessage(card: EmployerLearnerCard) {
  if (card.outstandingCount > 0) {
    return `${card.outstandingCount} document${card.outstandingCount === 1 ? '' : 's'} need your signature`;
  }
  if (card.documentsTotal > 0) return 'All documents signed';
  return 'No documents to sign yet';
}

function LearnerCard({ card, onOpen }: { card: EmployerLearnerCard; onOpen: () => void }) {
  const needsAction = card.outstandingCount > 0;
  const documentsComplete = !needsAction && card.documentsTotal > 0;
  const status = card.programmeStatus || (card.isActive ? 'Active' : card.onboardingStatus || 'Not set');

  return (
    <article className={styles.learnerCard}>
      <div className={styles.cardIdentityRow}>
        <span className={`${styles.avatar} ${avatarTone(card.name)}`} aria-hidden="true">{initials(card.name)}</span>
        <div className={styles.identityCopy}>
          <h2 title={card.name}>{card.name}</h2>
          <p title={card.email}>{card.email}</p>
        </div>
        <span className={`${styles.statusBadge} ${card.isActive ? styles.statusActive : styles.statusOnboarding}`}>
          <i className="ri-record-circle-fill" aria-hidden="true" />
          {status}
          <i className="ri-arrow-down-s-line" aria-hidden="true" />
        </span>
      </div>

      <dl className={styles.learnerDetails}>
        <div>
          <i className="ri-book-open-line" aria-hidden="true" />
          <span>
            <dt>Programme</dt>
            <dd title={card.programme}>{card.programme || 'Not assigned'}</dd>
          </span>
        </div>
        <div>
          <i className="ri-group-line" aria-hidden="true" />
          <span>
            <dt>Cohort</dt>
            <dd title={card.cohort}>{card.cohort || 'Not assigned'}</dd>
          </span>
        </div>
      </dl>

      <div className={styles.cardFooter}>
        <div className={`${styles.documentState} ${needsAction ? styles.documentAction : documentsComplete ? styles.documentComplete : styles.documentNeutral}`}>
          <i className={needsAction ? 'ri-error-warning-line' : documentsComplete ? 'ri-checkbox-circle-fill' : 'ri-file-text-line'} aria-hidden="true" />
          <span>{documentMessage(card)}</span>
        </div>
        <button type="button" className={styles.viewButton} onClick={onOpen} aria-label={`View ${card.name}`}>
          <i className="ri-eye-line" aria-hidden="true" />
          View
        </button>
      </div>
    </article>
  );
}

function PortalStat({ icon, label, value, tone }: { icon: string; label: string; value: number; tone: 'purple' | 'green' | 'amber' }) {
  const toneClass = tone === 'purple' ? styles.statPurple : tone === 'green' ? styles.statGreen : styles.statAmber;
  return (
    <div className={`${styles.statCard} ${toneClass}`}>
      <span className={styles.statIcon}><i className={icon} aria-hidden="true" /></span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
      <i className={`${styles.statWatermark} ${icon}`} aria-hidden="true" />
    </div>
  );
}

export default function EmployerPortalPage() {
  const { employerId = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<EmployerPortal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = () => {
    setLoading(true);
    setError(null);
    fetchEmployerPortal(employerId)
      .then(setData)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [employerId]);

  const learners = useMemo(() => data?.learners ?? [], [data?.learners]);
  const active = learners.filter((learner) => learner.isActive).length;
  const filteredLearners = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return learners;
    return learners.filter((learner) => [learner.name, learner.email, learner.programme, learner.cohort]
      .some((value) => value.toLocaleLowerCase().includes(term)));
  }, [learners, query]);

  const { isEmployerViewer, shell } = useEmployerPortalChrome(employerId, data?.employer.name);
  const organisation = data?.employer.employerGroupNames.join(', ') || 'No organisation';

  return (
    <WorkspaceShell {...shell} pageTitle="Employer" pageSubtitle={data?.employer.name ?? 'Employer portal'}>
      <PageContainer className={styles.page}>
        <section className={styles.hero} aria-labelledby="employer-portal-title">
          <div className={styles.heroIdentity}>
            <span className={styles.heroIcon} aria-hidden="true"><i className="ri-briefcase-line" /></span>
            <div>
              <h1 id="employer-portal-title">{data?.employer.name || 'Employer'}</h1>
              {data && (
                <p>
                  <span>{organisation}</span><span aria-hidden="true">·</span>
                  <span>{learners.length} learner{learners.length === 1 ? '' : 's'}</span><span aria-hidden="true">·</span>
                  <span>{data.outstandingTotal} awaiting your signature</span>
                </p>
              )}
            </div>
          </div>

          <div className={styles.heroMessage}>
            <img src={BANNER_IMAGE} alt="" />
            <p>Supporting your learners<br />towards a brighter future</p>
          </div>

          {!isEmployerViewer && (
            <button type="button" className={styles.backButton} onClick={() => navigate(-1)}>
              <i className="ri-arrow-left-line" aria-hidden="true" /> Back to users
            </button>
          )}
        </section>

        <label className={styles.searchBox}>
          <span className="sr-only">Search learners</span>
          <i className="ri-search-line" aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search learner by name or email..." />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear learner search"><i className="ri-close-line" aria-hidden="true" /></button>}
        </label>

        {loading && (
          <div
            role="status"
            aria-label="Loading learners"
            aria-live="polite"
            className="flex min-h-[18rem] items-center justify-center py-16"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-50 text-primary-700 shadow-sm">
                <LoaderCircle data-testid="learners-loading-spinner" aria-hidden="true" className="h-7 w-7 animate-spin" />
              </span>
              <div>
                <p className="text-[13px] font-semibold text-foreground-700">Loading learners...</p>
                <p className="mt-1 text-[11px] text-foreground-400">Preparing your learner list</p>
              </div>
            </div>
          </div>
        )}

        {!loading && error && (
          <div className={styles.errorState} role="alert">
            <i className="ri-error-warning-line" aria-hidden="true" /><p>{error}</p>
            <button type="button" onClick={load}><i className="ri-refresh-line" aria-hidden="true" /> Retry</button>
          </div>
        )}

        {!loading && !error && data && (
          <>
            <section className={styles.statsGrid} aria-label="Learner summary">
              <PortalStat icon="ri-group-line" label="Learners" value={learners.length} tone="purple" />
              <PortalStat icon="ri-play-circle-line" label="Active on programme" value={active} tone="green" />
              <PortalStat icon="ri-draft-line" label="Awaiting your signature" value={data.outstandingTotal} tone="amber" />
            </section>

            {learners.length === 0 ? (
              <div className={styles.emptyState}>
                <i className="ri-group-line" aria-hidden="true" /><h2>No learners linked yet</h2>
                <p>A learner is linked by choosing this employer on their record.</p>
              </div>
            ) : filteredLearners.length === 0 ? (
              <div className={styles.emptyState}>
                <i className="ri-search-eye-line" aria-hidden="true" /><h2>No matching learners</h2>
                <p>Try another name, email, programme or cohort.</p>
                <button type="button" onClick={() => setQuery('')}>Clear search</button>
              </div>
            ) : (
              <section className={styles.learnersGrid} aria-label="Employer learners">
                {filteredLearners.map((card) => (
                  <LearnerCard key={`${card.kind}-${card.id}`} card={card} onOpen={() => navigate(`/employers/${employerId}/learner/${card.kind}/${card.id}`)} />
                ))}
              </section>
            )}
          </>
        )}
      </PageContainer>
    </WorkspaceShell>
  );
}
