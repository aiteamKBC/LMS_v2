import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { ActivityChart, CohortChart, WeeklySessionChart } from './DeliveryCharts';
import { cohortSegments, deliveryDateLabel, deliverySessionTime, deliveryWeek, type DeliveryLiveSession } from './deliveryDashboard';
import styles from './DeliveryWorkspace.module.css';

type Destination = { title: string; description: string; href: string; icon: string; meta?: string };
type AttentionItem = { label: string; value: number; href: string; icon: string };

export interface DeliveryWorkspaceProps {
  description: string;
  cards: Destination[];
  attentionItems: AttentionItem[];
  cohorts: Array<{ status?: string }>;
  activeCohortGroups: number;
  activeGroups: number | null;
  totalGroups: number;
  activeModules: number | null;
  totalModules: number;
  modulesLoading: boolean;
  modulesError: string | null;
  sessions: DeliveryLiveSession[];
  undatedSessionCount?: number;
  sessionsLoading: boolean;
  sessionsError: string | null;
  loading: boolean;
  unavailable: boolean;
  error: string | null;
  onRetry?: () => void;
  onRetrySessions?: () => void;
  onRetryActivity?: () => void;
  heroVariant?: 'glass' | 'campus' | 'classic';
  staffing?: { needsTutor: number | null; needsCoach: number | null; loading: boolean; tutorLoading?: boolean; coachLoading?: boolean };
  /** Deterministic local preview/test clock; production follows the LMS business time zone. */
  now?: Date;
}

const number = new Intl.NumberFormat('en-GB');
const accents = ['violet', 'sky', 'gold', 'violet', 'gold', 'green'] as const;
function LoadingValue() { return <span className={styles.skeleton} aria-hidden="true" />; }
function ChartSkeleton() { return <div className={styles.chartSkeleton} aria-hidden="true" />; }

export default function DeliveryWorkspace({
  description, cards, attentionItems, cohorts, activeCohortGroups, activeGroups, totalGroups,
  activeModules, totalModules, modulesLoading, modulesError, sessions, undatedSessionCount, sessionsLoading, sessionsError,
  loading, unavailable, error, onRetry, onRetrySessions, onRetryActivity, heroVariant = 'glass', staffing, now: previewNow,
}: DeliveryWorkspaceProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [clock, setClock] = useState(() => new Date());
  const [slow, setSlow] = useState(false);
  const pending = loading || sessionsLoading || modulesLoading;
  useEffect(() => {
    setSlow(false);
    if (!pending) return;
    const timer = window.setTimeout(() => setSlow(true), 5_000);
    return () => window.clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    if (previewNow) return;
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [previewNow]);
  const week = deliveryWeek(sessions, previewNow ?? clock, weekOffset);
  const undated = undatedSessionCount ?? week.undated;
  const activeCohorts = cohortSegments(cohorts)[0].value;
  const sessionsUnavailable = Boolean(sessionsError && !sessions.length);
  const nextLabel = week.next ? `${deliveryDateLabel(week.next.date, true)} · ${deliverySessionTime(week.next.startTime)} UK` : '';
  return <main className={styles.page}>
    <div className={styles.watermark} aria-hidden="true" />
    <div className={styles.content}>
      <section className={`${styles.hero} ${heroVariant === 'campus' ? styles.campusHero : heroVariant === 'glass' ? styles.glassHero : ''}`}
        data-hero-variant={heroVariant} aria-labelledby="delivery-title">
        {heroVariant !== 'classic' && <>
          <div className={styles.campusPhoto} aria-hidden="true" />
          <svg className={styles.campusWaves} viewBox="0 0 1440 150" preserveAspectRatio="none" aria-hidden="true">
            <path d="M250 150 C650 -30 960 210 1440 30 L1440 150Z" fill="#b69af4" opacity=".15" />
            <path d="M0 146 C500 165 810 130 1440 146 L1440 150 L0 150Z" fill="#eee8fa" opacity=".8" />
            <path d="M0 144 C500 163 810 128 1440 144" fill="none" stroke="#ddb86b" strokeWidth="1.6" />
          </svg>
        </>}
        <div className={styles.heroHeading}>
          <span className={styles.heroIcon}><AppIcon className="ri-calendar-schedule-line" size={25} /></span>
          <div><p className={styles.eyebrow}>Delivery workspace</p><h1 id="delivery-title">Delivery</h1></div>
        </div>
        <p className={styles.heroDescription}>{description}</p>
        <Link className={styles.primaryAction} to="/curriculum/cohorts"><AppIcon className="ri-group-line" size={17} /> Open Cohorts<AppIcon className="ri-arrow-right-line" size={16} /></Link>
      </section>

      {error && <div className={styles.error} role="alert"><AppIcon className="ri-error-warning-line" size={19} /><span>Some live curriculum counts could not be loaded: {error}</span>{onRetry && <button type="button" onClick={onRetry}>Try again</button>}</div>}
      {sessionsError && <div className={styles.error} role="alert"><AppIcon className="ri-error-warning-line" size={19} /><span>Live session dates could not be refreshed: {sessionsError}</span>{onRetrySessions && <button type="button" onClick={onRetrySessions}>Retry live sessions</button>}</div>}
      {slow && pending && <p className={styles.loadingFeedback} role="status">{loading ? 'Delivery figures' : modulesLoading ? 'Module activity' : 'Live session dates'} are taking longer than usual. Available figures stay visible while this finishes.</p>}

      <section className={styles.stats} aria-label="Delivery numbers" aria-busy={loading || sessionsLoading || modulesLoading}>
        {loading && <span className={styles.srOnly} role="status">Loading delivery figures.</span>}
        <article className={styles.stat} aria-label="Cohort overview" data-accent="violet">
          <div className={styles.statHeading}><div><h2>Cohort overview</h2>
            <p className={styles.value}><span aria-label="Active cohorts count">{loading ? <LoadingValue /> : unavailable ? 'Unavailable' : number.format(activeCohorts)}</span><span className={styles.valueHint}>active cohorts</span></p>
          </div><span className={styles.icon}><AppIcon className="ri-group-line" size={20} /></span></div>
          {loading ? <ChartSkeleton /> : unavailable ? <p className={styles.statNote}>Figures could not be loaded.</p> : <CohortChart cohorts={cohorts} />}
          <div className={styles.statFooter}>{loading || unavailable ? 'Groups in active cohorts' : `${number.format(activeCohortGroups)} groups in active cohorts`}</div>
        </article>

        <article className={styles.stat} aria-label="Delivery activity" data-accent="sky">
          <div className={styles.statHeading}><h2>Delivery activity</h2><span className={styles.icon}><AppIcon className="ri-bar-chart-line" size={20} /></span></div>
          {loading ? <ChartSkeleton /> : unavailable ? <p className={styles.statNote}>Figures could not be loaded.</p> : (
            <ActivityChart activeGroups={activeGroups} totalGroups={totalGroups} activeModules={activeModules} totalModules={totalModules} modulesLoading={modulesLoading} modulesError={modulesError} />
          )}
          {modulesError && onRetryActivity && <button type="button" className={styles.retryActivity} onClick={onRetryActivity}>Retry activity</button>}
          {staffing && <div className={styles.staffingSummary} role="group" aria-label="Staffing to complete">
            <p>Staffing to complete</p>
            <div>{[
              { label: 'Need tutor', count: staffing.needsTutor, loading: staffing.tutorLoading ?? staffing.loading, href: '/curriculum/module-builder', title: 'Active modules or modules with live sessions in the next 14 days, without an assigned tutor.' },
              { label: 'Need coach', count: staffing.needsCoach, loading: staffing.coachLoading ?? staffing.loading, href: '/curriculum/groups', title: 'Active groups without an assigned coach.' },
            ].map(item => <Link key={item.label} to={item.href} title={item.title}
              aria-label={`${item.label}: ${item.loading ? 'Loading' : item.count === null ? 'Unavailable' : number.format(item.count)}`}
              data-clear={item.count === 0 && !item.loading || undefined}>
              <span>{item.label}</span><strong aria-label={`${item.label} count`}>{item.loading ? '…' : item.count === null ? 'Unavailable' : number.format(item.count)}</strong>
            </Link>)}</div>
          </div>}
          <div className={styles.statFooter}><Link to="/curriculum/module-builder">Review modules <AppIcon className="ri-arrow-right-line" size={13} /></Link></div>
        </article>

        <article className={styles.stat} aria-label="Scheduled live sessions" data-accent="gold" aria-busy={sessionsLoading}>
          <div className={styles.statHeading}><div><h2>Scheduled live sessions</h2>
            <p className={styles.value} aria-label="Scheduled live sessions count">{sessionsLoading ? <LoadingValue /> : sessionsUnavailable ? 'Unavailable' : number.format(week.count)}<span className={styles.valueHint}>{weekOffset ? 'next week' : 'this week'}</span></p>
          </div><span className={styles.icon}><AppIcon className="ri-calendar-schedule-line" size={20} /></span></div>
          <div className={styles.weekControls}>
            <span>{deliveryDateLabel(week.days[0].date, true)} – {deliveryDateLabel(week.days[6].date, true)}</span>
            <select aria-label="Session week" value={weekOffset} onChange={event => setWeekOffset(Number(event.target.value))}><option value={0}>This week</option><option value={1}>Next week</option></select>
          </div>
          {sessionsLoading ? <><span className={styles.srOnly} role="status">Loading live sessions.</span><ChartSkeleton /></> : sessionsUnavailable ? <p className={styles.statNote}>Session dates could not be loaded.</p> : <>
            <WeeklySessionChart week={week} />
            <p className={styles.nextSession}>{week.next ? <><span>Next live</span> <strong title={week.next.title}>{nextLabel}</strong></> : 'No upcoming live sessions scheduled.'}</p>
            {!week.count && <span className={styles.srOnly}>No live sessions in the selected week.</span>}
          </>}
          {!sessionsLoading && undated > 0 && <p className={styles.activityWarning}>{number.format(undated)} live sessions without a valid date</p>}
          {!sessionsLoading && week.invalidTimes > 0 && <p className={styles.activityWarning}>{number.format(week.invalidTimes)} live sessions need their time or time zone checked</p>}
          <div className={styles.statFooter}><Link to="/curriculum/session-calendar">View session calendar <AppIcon className="ri-arrow-right-line" size={13} /></Link><span>UK time</span></div>
        </article>
      </section>

      <section className={styles.workspaces} aria-labelledby="delivery-workspaces-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Workspaces</p><h2 id="delivery-workspaces-title">Choose what you want to do</h2><p>Each destination owns one job, so you always know where a change will be saved.</p></div><span className={styles.workspaceCount}><span aria-hidden="true" />6 workspaces</span></div>
        <div className={styles.grid}>{cards.map((card, index) => {
          const calendar = card.href === '/curriculum/session-calendar';
          const pending = calendar ? sessionsLoading : loading;
          const missing = calendar ? sessionsUnavailable : unavailable;
          return <Link to={card.href} key={card.href} className={styles.card} data-accent={accents[index]}>
            <div className={styles.cardTop}><span className={styles.icon}><AppIcon className={card.icon} size={23} /></span>{card.meta && (pending ? <LoadingValue /> : <span className={styles.badge}>{missing ? 'Unavailable' : card.meta}</span>)}</div>
            <h3>{card.title}</h3><p>{card.description}</p>
            {calendar && week.next && !pending && !missing && <span className={styles.nextCardSession}>Next live · {nextLabel}</span>}
            <span className={styles.cardAction}>Open workspace <AppIcon className="ri-arrow-right-line" size={16} /></span>
          </Link>;
        })}</div>
      </section>

      <section className={styles.readiness} aria-labelledby="delivery-setup-title">
        <div className={styles.readinessHeading}><div><p className={styles.eyebrow}>Delivery readiness</p><h2 id="delivery-setup-title">Delivery setup to finish</h2><p>Assignments that can block a clean launch.</p></div><span className={styles.checks}><AppIcon className="ri-checkbox-multiple-line" size={15} />3 checks</span></div>
        <ul>{attentionItems.map(item => <li key={item.label}>
          <Link to={item.href} className={styles.attention} aria-label={`${item.label}: ${loading ? 'Loading' : unavailable ? 'Unavailable' : item.value === 0 ? 'Clear' : number.format(item.value)}`} data-clear={!loading && !unavailable && item.value === 0 || undefined}>
            <span className={styles.attentionIcon}><AppIcon className={!loading && !unavailable && item.value === 0 ? 'ri-checkbox-circle-line' : item.icon} size={20} /></span><span className={styles.attentionLabel}>{item.label}</span>
            {loading ? <LoadingValue /> : <span className={styles.attentionValue}>{unavailable ? 'Unavailable' : item.value === 0 ? 'Clear' : number.format(item.value)}</span>}<AppIcon className={`ri-arrow-right-s-line ${styles.chevron}`} size={18} />
          </Link>
        </li>)}</ul>
      </section>
    </div>
  </main>;
}
