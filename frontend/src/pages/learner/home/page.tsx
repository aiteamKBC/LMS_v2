import { useEffect, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRight, CalendarCheck2, MapPin, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLearnerSummaryParam } from '@/hooks/useLearnerSummaryParam';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';
import { isFreshStatus, isOnboardingStatus } from '@/hooks/useOnboardingRedirect';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { overviewSchedule, overviewHome } from '@/api/learnerOverview';
import type { LearnerKind } from '@/api/learnerDetail';
import { LearnerLoadError } from '@/components/feature/LearnerLoadError';
import { homeActions, greeting, upcomingEvents } from './homeData';
import { ReferenceIcon } from './ReferenceIcon';
import { ProgressCard } from './ProgressCard';
import { ShieldAction, ShieldCrest } from './ShieldArtwork';
import { ContinueLearning } from './ContinueLearning';
import { StudentHomeHeader } from './StudentHomeHeader';
import styles from './studentHome.module.css';

function LearningShield({ dashboardHref, children }: { dashboardHref: string; children: ReactNode }) {
  return <section className={styles.shield} aria-label="Learning actions">
    <svg className={styles.shieldShape} viewBox="0 0 1000 1270" aria-hidden="true">
      <defs>
        <linearGradient id="shield-purple" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#402a50"/><stop offset=".55" stopColor="#281535"/><stop offset="1" stopColor="#452e54"/></linearGradient>
        <linearGradient id="shield-gold"><stop stopColor="#ead38a"/><stop offset=".4" stopColor="#b3903f"/><stop offset=".7" stopColor="#fae6a3"/><stop offset="1" stopColor="#b18e3e"/></linearGradient>
        <path id="learning-shield-outline" d="M500 7.5 C664 87 828 137 991 159 C991 321 994 492 991 647 C991 906 858 1131 500 1262.5 C142 1131 9 906 9 647 C6 492 9 321 9 159 C172 137 336 87 500 7.5Z"/>
      </defs>
      <use href="#learning-shield-outline" fill="url(#shield-purple)" stroke="url(#shield-gold)" strokeWidth="15" strokeLinejoin="round"/>
      <use href="#learning-shield-outline" transform="translate(500 635) scale(.95) translate(-500 -635)" fill="none" stroke="#91774b" strokeOpacity=".28" strokeWidth="2"/>
    </svg>
    <ShieldCrest/>
    {homeActions.map((action, index) => <ShieldAction
      key={action.title} index={index} href={action.icon === 'chart' ? dashboardHref : action.href} label={action.title}>
      <ReferenceIcon name={action.icon} className={styles.actionIcon}/><strong>{index === 2
        ? <>Attend or<br/>Report Absence</> : index === 3
          ? <>Book for Monthly<br/>Coaching Session</> : action.title}</strong>
      <span>{action.text}</span><ArrowRight aria-hidden="true" className={styles.actionArrow}/>
    </ShieldAction>)}
    {children}
    <div className={styles.shieldMotto} aria-hidden="true">SMALL STEPS<br/>BIGGER TOMORROWS<ReferenceIcon name="laurel" className={styles.laurel}/></div>
  </section>;
}

export default function StudentHome() {
  const { auth } = useAuth();
  const account = auth.account;
  if (account?.role === 'learner') {
    const kind = account.learnerType === 'commercial' || account.learnerType === 'apprenticeship' ? account.learnerType : undefined;
    return <LearnerHome key={account.id} kind={kind} id={String(account.subjectId)} />;
  }
  if (account?.role === 'staff' || account?.role === 'admin') return <StaffStudentHome />;
  return <Navigate to="/" replace />;
}

function StaffStudentHome() {
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(urlKind, urlId);
  // A staff/admin review must be represented by the URL before the learner
  // reads begin. This makes a bare workspace entry safe across refreshes.
  if (!urlKind && !urlId && kind && id) {
    return <Navigate to={`/workspace/learner/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`} replace />;
  }
  return <LearnerHome key={`${kind}:${id}`} kind={kind} id={id} preview />;
}

function LearnerHome({ kind, id, preview = false }: { kind?: LearnerKind; id?: string; preview?: boolean }) {
  useEffect(() => {
    // A cross-site Back navigation can restore frozen fetches and expired
    // timers from bfcache. Reinitialize the session and reads in a fresh document.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);
  const { auth, retryInitialization } = useAuth();
  const now = new Date();
  const account = auth.account!;
  const homeHref = preview && kind && id ? `/workspace/learner/${kind}/${id}` : '/workspace/learner';
  const dashboardHref = `${homeHref}/dashboard`;
  const profile = useLearnerSummaryParam(kind, id);
  const ready = !!profile.real && !profile.loadError;
  // The landing page remains the entry at every programme stage. Existing
  // enrolment/learning prerequisites are still checked by destination pages.
  const onboarding = kind !== 'commercial' && isOnboardingStatus(profile.real?.programmeStatus);
  const fresh = isFreshStatus(profile.real?.programmeStatus);
  const loadCards = ready && !onboarding && !fresh;
  const schedule = useLiveLearnerRead(kind, id, loadCards, overviewSchedule.read, overviewSchedule.peek);
  const week = useLiveLearnerRead(kind, id, loadCards, overviewHome.read, overviewHome.peek);
  useEffect(() => { const previous = document.title; document.title = 'Student Home — Kent Business College'; return () => { document.title = previous; }; }, []);

  if (!kind || !id) return <LearnerLoadError error="We could not verify your learner profile. Please try again." onRetry={retryInitialization}/>;
  if (profile.loadError) return <LearnerLoadError error={profile.loadError} onRetry={profile.refresh}/>;
  if (!profile.real) return <div className={styles.loading} role="status">Loading your student home…</div>;
  const name = profile.real.name?.trim() || (!preview && account.displayName?.trim()) || 'Learner';
  const firstName = name.split(/\s+/)[0];
  const events = upcomingEvents(schedule.error ? null : schedule.data, week.error ? null : week.data, now);
  return <div className={styles.home}>
    <a href="#student-main" className={styles.skip}>Skip to main content</a>
    <StudentHomeHeader key={`${account.id}:${kind}:${id}`} name={name} homeHref={homeHref}
      identity={`${account.id}:${kind}:${id}`} events={events} loading={schedule.loading || week.loading}
      error={!!schedule.error || !!week.error} onRetry={() => { schedule.refresh(); week.refresh(); }}/>
    <main id="student-main" className={styles.scene}>
      <section className={styles.hero} aria-labelledby="welcome-heading"><p>{greeting(now)}</p>
        <h1 id="welcome-heading">{firstName} <span aria-hidden="true">👋</span></h1>
        <h2>Welcome to Kent Business College</h2><p className={styles.intro}>Your learning journey, your goals, our support.<br/>Let’s make progress together.</p>
      </section>
      <blockquote className={styles.quote}><p>“A brighter future<br/>belongs to those who keep learning.”</p><cite>KENT BUSINESS COLLEGE</cite></blockquote>
      <LearningShield dashboardHref={dashboardHref}>
        <ContinueLearning kind={kind} learnerId={id} enabled={loadCards} week={week.data}
          loading={week.loading} error={week.error} onRetry={week.refresh}/>
      </LearningShield>
      <ProgressCard data={week.data?.homeProgress} loading={week.loading} error={week.error} refresh={week.refresh} dashboardHref={dashboardHref}/>
      <div className={styles.kent} aria-hidden="true"><span>Kent</span><p>Always a step ahead</p></div>
      <div className={styles.sideActions}>
        <a className={styles.safeguarding} href={import.meta.env.VITE_SAFEGUARDING_URL || (import.meta.env.DEV ? 'http://127.0.0.1:5173/' : 'https://safeguarding.kentbusinesscollege.net/')}>
          <ShieldCheck aria-hidden="true"/><span>Inclusion &amp; Safeguarding</span><ArrowRight aria-hidden="true"/>
        </a>
        <div className={styles.location}><p><MapPin aria-hidden="true"/>Canterbury, Kent</p><em>“History inspires progress.”</em></div>
      </div>
      <aside className={`${styles.card} ${styles.upcoming}`} aria-labelledby="home-upcoming-heading">
        <div className={styles.cardHeading}><h2 id="home-upcoming-heading"><CalendarCheck2 aria-hidden="true"/>Upcoming</h2><Link to="/learner/calendar" aria-label="View all upcoming events">View all</Link></div>
        <ul>{events.map(event => {
          const source = event.kind === 'assignment' ? week : schedule;
          const detail = !event.date && source.loading ? 'Loading upcoming activity…'
            : !event.date && source.error ? 'Upcoming activity unavailable' : event.detail;
          return <li key={event.kind} aria-label={`Next ${event.kind}`}>
            {event.date ? <time dateTime={event.date}>
              <span>{new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Europe/London' }).format(new Date(event.date))}</span>
              {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(event.date))}</time>
              : <span className={styles.eventDate} aria-label="No date available">—</span>}
            <Link to={event.href}><strong>{event.title}</strong><span>{detail}</span></Link>
          </li>;
        })}</ul>
        {(schedule.loading || week.loading) && <p role="status" className={styles.empty}>Loading upcoming activity…</p>}
        {(schedule.error || week.error) && <div className={styles.empty} role="alert">Some upcoming activity could not be loaded. <button onClick={() => { schedule.refresh(); week.refresh(); }}>Try again</button></div>}
      </aside>
      <footer className={styles.footer}><span>KENT BUSINESS COLLEGE&nbsp;&nbsp; LEARN&nbsp;&nbsp; BELONG&nbsp;&nbsp; ACHIEVE</span><p>A Brighter Kent<br/>A Bolder You</p></footer>
    </main>
  </div>;
}
