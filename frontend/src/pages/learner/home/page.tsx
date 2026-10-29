import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRight, CalendarCheck2, MapPin, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLearnerSummaryParam } from '@/hooks/useLearnerSummaryParam';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';
import { apprenticeHomeRedirect, isFreshStatus, isOnboardingStatus } from '@/hooks/useOnboardingRedirect';
import { useFirstLoginDetailsRedirect } from '@/hooks/useFirstLoginDetailsRedirect';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { upcomingSchedule, homeSummary } from '@/api/learnerOverview';
import { feedbackApi } from '@/api/feedback';
import type { LearnerKind } from '@/api/learnerDetail';
import { LearnerLoadError } from '@/components/feature/LearnerLoadError';
import { SupportChatWidget } from '@/components/SupportChatWidget';
import { learnerHref } from '@/lib/learnerRoutes';
import { LEARNER_FEEDBACK_ENABLED, LEARNER_POST_LECTURE_FEEDBACK_ENABLED } from '@/lib/featureFlags';
import { homeActions, greeting, homeUpcomingEvents, withLearner } from './homeData';
import { ReferenceIcon } from './ReferenceIcon';
import { SkeletonBlock } from '@/components/feature/Skeletons';
import { ProgressCard } from './ProgressCard';
import { ShieldAction, ShieldCrest } from './ShieldArtwork';
import { ContinueLearning } from './ContinueLearning';
import { StudentHomeHeader } from './StudentHomeHeader';
import styles from './studentHome.module.css';

function LearningShield({ link, children }: { link: (href: string) => string; children: ReactNode }) {
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
      key={action.title} index={index} href={link(action.href)} label={action.title}>
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
  const feedbackHref = preview && kind && id
    ? `/learner/feedback?learnerId=${encodeURIComponent(id)}&kind=${encodeURIComponent(kind)}`
    : '/learner/feedback';
  // A staff preview names the learner in every link, so the workspace sidebar
  // keeps routing to that learner. A learner's own links stay bare: their
  // pages resolve them from the session, and the address bar shows no ids.
  const dashboardHref = preview ? learnerHref('dashboard', kind, id) : learnerHref('dashboard');
  const link = (href: string) => (preview ? withLearner(href, kind, id) : href);
  const profile = useLearnerSummaryParam(kind, id);
  const ready = !!profile.real && !profile.loadError;
  // The landing page remains the entry at every programme stage. Existing
  // enrolment/learning prerequisites are still checked by destination pages.
  const onboarding = kind !== 'commercial' && isOnboardingStatus(profile.real?.programmeStatus);
  const fresh = isFreshStatus(profile.real?.programmeStatus);
  // A new apprentice gives their details and signature before anything else.
  // Their own sign-in only: a staff preview never redirects.
  const checkingFirstLogin = useFirstLoginDetailsRedirect(
    kind, id, profile.real?.programmeStatus, ready && !preview && account.role === 'learner',
  );
  const loadCards = ready && !onboarding && !fresh;
  const feedbackEnabled = LEARNER_FEEDBACK_ENABLED || LEARNER_POST_LECTURE_FEEDBACK_ENABLED;
  const loadFeedbackCount = feedbackEnabled && ready && (preview || kind === 'commercial' || (!onboarding && !fresh));
  const schedule = useLiveLearnerRead(kind, id, loadCards, upcomingSchedule.read, upcomingSchedule.peek);
  const week = useLiveLearnerRead(kind, id, loadCards, homeSummary.read, homeSummary.peek);
  const [feedbackPendingCount, setFeedbackPendingCount] = useState(0);
  useEffect(() => {
    let active = true;
    if (!loadFeedbackCount) { setFeedbackPendingCount(0); return () => { active = false; }; }
    feedbackApi.myForms(preview ? id : undefined).then(result => {
      if (active) setFeedbackPendingCount(result.forms.filter(form => form.status !== 'completed').length);
    }).catch(() => {
      if (active) setFeedbackPendingCount(0);
    });
    return () => { active = false; };
  }, [id, loadFeedbackCount, preview]);
  useEffect(() => { const previous = document.title; document.title = 'Student Home — Kent Business College'; return () => { document.title = previous; }; }, []);

  if (!kind || !id) return <LearnerLoadError error="We could not verify your learner profile. Please try again." onRetry={retryInitialization}/>;
  if (profile.loadError) return <LearnerLoadError error={profile.loadError} onRetry={profile.refresh}/>;
  if (!profile.real || checkingFirstLogin) return <div className={styles.loading} role="status">Loading your student home…</div>;
  // Student Home opens once an apprentice's programme has started; until then
  // each enrolment stage has its own page. Their own sign-in only — a staff
  // preview still shows the page, and commercial learners keep it throughout.
  const beforeActive = !preview && account.role === 'learner' && kind === 'apprenticeship'
    ? apprenticeHomeRedirect(profile.real.programmeStatus) : null;
  if (beforeActive) return <Navigate to={beforeActive} replace />;
  const name = profile.real.name?.trim() || (!preview && account.displayName?.trim()) || 'Learner';
  const firstName = name.split(/\s+/)[0];
  const events = homeUpcomingEvents(schedule.error ? null : schedule.data, now)
    .map(event => ({ ...event, href: link(event.href) }));
  return <div className={styles.home}>
    <a href="#student-main" className={styles.skip}>Skip to main content</a>
    <StudentHomeHeader key={`${account.id}:${kind}:${id}`} name={name} homeHref={homeHref}
      identity={`${account.id}:${kind}:${id}`} events={events} loading={schedule.loading}
      error={!!schedule.error} onRetry={schedule.refresh}
      feedbackEnabled={feedbackEnabled}
      feedbackHref={feedbackHref}
      feedbackPendingCount={feedbackPendingCount}
      supportHref={link('/learner/monthly-coaching')}/>
    <main id="student-main" className={styles.scene}>
      <section className={styles.hero} aria-labelledby="welcome-heading"><p>{greeting(now)}</p>
        <h1 id="welcome-heading">{firstName} <span aria-hidden="true">👋</span></h1>
        <h2>Welcome to Kent Business College</h2><p className={styles.intro}>Your learning journey, your goals, our support.<br/>Let’s make progress together.</p>
      </section>
      <blockquote className={styles.quote}><p>“A brighter future<br/>belongs to those who keep learning.”</p><cite>KENT BUSINESS COLLEGE</cite></blockquote>
      <LearningShield link={link}>
        <ContinueLearning kind={kind} learnerId={id} enabled={loadCards} week={week.data} linkIdentity={preview}
          loading={week.loading} error={week.error} onRetry={week.refresh}/>
      </LearningShield>
      <ProgressCard data={week.data?.homeProgress} loading={week.loading} error={week.error} refresh={week.refresh} dashboardHref={dashboardHref} link={link}/>
      <div className={styles.kent} aria-hidden="true"><span>Kent</span><p>Always a step ahead</p></div>
      <div className={styles.sideActions}>
        <a className={styles.safeguarding} href={import.meta.env.VITE_SAFEGUARDING_URL || (import.meta.env.DEV ? 'http://127.0.0.1:5173/' : 'https://safeguarding.kentbusinesscollege.net/')}>
          <ShieldCheck aria-hidden="true"/><span>Inclusion &amp; Safeguarding</span><ArrowRight aria-hidden="true"/>
        </a>
        <div className={styles.location}><p><MapPin aria-hidden="true"/>Canterbury, Kent</p><em>“History inspires progress.”</em></div>
      </div>
      <aside className={`${styles.card} ${styles.upcoming}`} aria-labelledby="home-upcoming-heading">
        <div className={styles.cardHeading}><h2 id="home-upcoming-heading"><CalendarCheck2 aria-hidden="true"/>Upcoming</h2><Link to={link('/learner/calendar')} aria-label="View all upcoming events">View all</Link></div>
        <ul>{events.length ? events.map(event => <li key={event.id} aria-label={`Upcoming ${event.kind}`}>
          <time dateTime={event.date!}>
            <span>{new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Europe/London' }).format(new Date(event.date!))}</span>
            {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(event.date!))}</time>
          <Link to={event.href}><strong>{event.title}</strong><span>{event.detail}</span></Link>
        </li>) : schedule.loading && [0, 1, 2].map(slot => <li key={slot} aria-hidden="true">
          <span className={styles.eventDate}>—</span><Link to={link('/learner/calendar')} tabIndex={-1}>
            <SkeletonBlock className="h-3 w-32"/><SkeletonBlock className="mt-1 h-2.5 w-28"/></Link>
        </li>)}</ul>
        {schedule.loading && <p role="status" className="sr-only">Loading upcoming activity…</p>}
        {!schedule.loading && !schedule.error && !events.length && <p className={styles.empty}>No sessions, assignments or reviews next week.</p>}
        {schedule.error && <div className={styles.empty} role="alert">Some upcoming activity could not be loaded. <button onClick={schedule.refresh}>Try again</button></div>}
      </aside>
      <footer className={styles.footer}><span>KENT BUSINESS COLLEGE&nbsp;&nbsp; LEARN&nbsp;&nbsp; BELONG&nbsp;&nbsp; ACHIEVE</span><p>A Brighter Kent<br/>A Bolder You</p></footer>
      {/* Home only. Its launcher is positioned against the Inclusion &
          Safeguarding tab, which lives on this page, and the learner is signed
          in by the time they reach it — neither holds on the login screen or
          on pages that render the shared workspace shell instead. */}
      <SupportChatWidget />
    </main>
  </div>;
}
