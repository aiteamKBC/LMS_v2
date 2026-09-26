import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, CalendarDays, ChevronRight, Clock, GraduationCap, Map, Play, UserRound, UsersRound } from 'lucide-react';
import { statusTone, toneStyle } from '@/lib/statusTone';
import styles from './LearnerDashboardHero.module.css';

interface LearnerDashboardHeroProps {
  avatar: ReactNode;
  name: string;
  description?: string;
  cohort: string;
  moduleLabel: string;
  modules: { id: string; title: string; href: string }[];
  modulePlaceholder: string;
  allModulesHref: string;
  coach: string;
  status: string;
  startDate: string;
  plannedEnd: string;
  loading: boolean;
  onContinue: () => void;
  onOpenMap: () => void;
}

/** Presentation only: placement, dates, status and navigation come from the dashboard. */
export function LearnerDashboardHero(props: LearnerDashboardHeroProps) {
  const { avatar, name, description, cohort, moduleLabel, modules, modulePlaceholder,
    allModulesHref, coach, status, startDate, plannedEnd, loading, onContinue, onOpenMap } = props;
  const tone = statusTone(status);
  return (
    <header className={styles.hero} aria-label="Learner programme">
      <div className={styles.artwork} aria-hidden="true" />
      <div className={styles.top}>
        <div className={styles.identity}>
          <div className={styles.avatar}>{avatar}</div>
          <div className={styles.identityText}>
            <p className={styles.eyebrow}>Learner</p>
            <h1 className={styles.name}>{name}</h1>
            {description && <p className={styles.description}>{description}</p>}
            <p className={styles.quote}>“Progress turns goals into reality.”</p>
          </div>
        </div>
        <div className={styles.handwriting} aria-hidden="true">Keep<br /><span>learning</span></div>
        <div className={styles.actionArea}>
          <div className={styles.actions}>
            <button type="button" onClick={onContinue} disabled={loading} aria-busy={loading}
              className={`${styles.action} ${styles.primaryAction}`}>
              <Play aria-hidden="true" />Continue learning<ArrowRight aria-hidden="true" className={styles.actionArrow} />
            </button>
            <button type="button" onClick={onOpenMap} className={styles.action}>
              <Map aria-hidden="true" />Learner&apos;s Map
            </button>
          </div>
          <p className={styles.actionCaption}>Your learning journey. Further possibilities.</p>
        </div>
      </div>

      <div className={styles.cards}>
        <section className={`${styles.card} ${styles.cohortCard}`} aria-label="Cohort">
          <div className={styles.factRow}>
            <span className={styles.icon}><UsersRound aria-hidden="true" /></span>
            <dl><dt>Cohort</dt><dd>{cohort}</dd></dl>
          </div>
          <svg className={styles.peopleArtwork} viewBox="0 0 160 150" fill="currentColor" aria-hidden="true">
            <circle cx="80" cy="32" r="20" /><circle cx="28" cy="62" r="13" /><circle cx="135" cy="44" r="14" />
            <path d="M37 150V106a43 43 0 0 1 86 0v44ZM2 150v-40a26 26 0 0 1 34-25v65Zm122 0V94a28 28 0 0 1 36 27v29Z" />
          </svg>
          <p className={styles.cardMotto}>Learning<br />together</p>
        </section>

        <section className={`${styles.card} ${styles.modulesCard}`} aria-label={moduleLabel}>
          <div className={styles.moduleHeading}>
            <span className={styles.icon}><BookOpen aria-hidden="true" /></span>
            <h2>{moduleLabel}</h2>
            <Link to={allModulesHref} className={styles.viewAll}>View all<ArrowRight aria-hidden="true" /></Link>
          </div>
          <div className={styles.moduleContent}>
            <div className={styles.learningArtwork} aria-hidden="true">
              <span /><span /><span /><GraduationCap />
            </div>
            {modules.length ? <ul className={styles.moduleList} aria-label={moduleLabel} tabIndex={0}>
              {modules.map(module => <li key={module.id}>
                <Link to={module.href} title={module.title}>
                  <span className={styles.moduleDot} aria-hidden="true" />
                  <span className={styles.moduleTitle}>{module.title}</span>
                  <ChevronRight aria-hidden="true" />
                </Link>
              </li>)}
            </ul> : <p className={styles.modulePlaceholder} role="status">{modulePlaceholder}</p>}
          </div>
          <p className={styles.cardMotto}>Building your skills.</p>
        </section>

        <div className={styles.stack}>
          <section className={`${styles.card} ${styles.coachCard}`} aria-label="Coach">
            <div className={styles.factRow}>
              <span className={styles.icon}><UserRound aria-hidden="true" /></span>
              <dl><dt>Coach</dt><dd>{coach}</dd></dl>
            </div>
          </section>
          <section className={`${styles.card} ${styles.statusCard}`} aria-label="Programme status">
            <div className={styles.factRow}>
              <span className={styles.statusIcon} data-tone={tone} aria-hidden="true">
                <span className={toneStyle(tone).dot} />
              </span>
              <dl><dt>Status</dt><dd>{status}</dd></dl>
            </div>
            <p className={styles.cardMotto}>Keep going</p>
          </section>
        </div>

        <section className={`${styles.card} ${styles.datesCard}`} aria-label="Programme dates">
          <div className={styles.startDate}>
            <Clock aria-hidden="true" /><dl><dt>Start date</dt><dd>{startDate}</dd></dl>
          </div>
          <div className={styles.factRow}>
            <span className={styles.icon}><CalendarDays aria-hidden="true" /></span>
            <dl><dt>End date</dt><dd>{plannedEnd}</dd></dl>
          </div>
          <CalendarDays className={styles.calendarArtwork} aria-hidden="true" />
          <p className={styles.cardMotto}>A brighter<br />tomorrow</p>
        </section>
      </div>
    </header>
  );
}
