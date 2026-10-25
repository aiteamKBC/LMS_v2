import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Loader2, RefreshCw, Users, Video } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { loadCoachingCalendar, loadLinkedCoachingMeeting, type LinkedCoachingMeeting, type CoachingCalendar, type CoachingCalendarQuery } from '@/api/coachingRecordings';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { coachNavItems, curriculumNavItems } from '@/mocks/navigation';
import { addDays, CALENDAR_TIME_ZONES, formatFullDate, parseIsoDate, todayIso } from '@/pages/curriculum/recordings/utils';
import { periodBounds, type Period } from '@/pages/curriculum/recordings/filters';
import { filterMeetings, initialChecksPending, meetingDate, meetingKey, meetingCategory, categoryLabels, type MatchFilter, type MeetingFilter } from './model';
import MeetingDetailsDrawer from './MeetingDetailsDrawer';
import CoachMiniCalendar from './CoachMiniCalendar';
import MeetingCalendar from './MeetingCalendar';
import CoachLearnersDialog from './CoachLearnersDialog';
import SyncReviewDrawer from './SyncReviewDrawer';
import { readLocation, writeLocation, type CoachingLocation } from './location';

const control = 'max-w-full min-w-0 rounded-lg border border-background-200 bg-white px-3 py-2 text-sm text-foreground-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500';
const phaseLabels = { ended: 'Ended', upcoming: 'Upcoming', 'in-progress': 'In progress', cancelled: 'Cancelled' };
const filterLabels = { ...phaseLabels, ready: 'Ready to action', attention: 'Needs attention', all: 'All meetings' };

export default function CoachingRecordingsPage({ workspace = 'curriculum' }: { workspace?: 'curriculum' | 'coach' }) {
  const [params, setParams] = useSearchParams();
  const location = useMemo(() => readLocation(params), [params]);
  const { date, period, zone, coach, learner, phase, match, family, lectures: showLectures, meeting: linkedId, occurrenceDate, tab } = location;
  const locationRef = useRef(location); locationRef.current = location;
  const navigate = (patch: Partial<CoachingLocation>, closeMeeting = true) => {
    const next = { ...locationRef.current, ...(closeMeeting ? { meeting: '', tab: 'recordings' as const } : {}), ...patch };
    locationRef.current = next;
    setParams(writeLocation(next));
  };
  const setDate = (value: string) => navigate({ date: value });
  const setPeriod = (value: Period) => navigate({ period: value });
  const setPhase = (value: MeetingFilter) => navigate({ phase: value });
  const setMatch = (value: MatchFilter) => navigate({ match: value });
  const setFamily = (value: string) => navigate({ family: value });
  const [linked, setLinked] = useState<LinkedCoachingMeeting | null>(null), [linkError, setLinkError] = useState('');
  const [linkLoading, setLinkLoading] = useState(false), [linkAttempt, setLinkAttempt] = useState(0);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const selectedReference = useRef<string | undefined>(undefined);
  const [showLearners, setShowLearners] = useState(false);
  const [showSyncDetails, setShowSyncDetails] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  const [data, setData] = useState<CoachingCalendar | null>(null);
  const [directory, setDirectory] = useState<Pick<CoachingCalendar, 'coaches' | 'learners' | 'scope'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [pollEpoch, setPollEpoch] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [slow, setSlow] = useState(false);
  const [agendaLimit, setAgendaLimit] = useState(30);
  const lastRequest = useRef('');
  const lastRevision = useRef(0);
  const snapshot = useRef<{ query: CoachingCalendarQuery; data: CoachingCalendar } | undefined>(undefined);
  const loadAttempt = useRef(0);
  const polling = useRef({ attempt: 0, key: '', progress: '', delay: 5000, dueAt: 0 });
  const bounds = periodBounds(date, period);
  const month = parseIsoDate(date);
  const monthBounds = periodBounds(date, 'month');
  const requested = period === 'month' ? monthBounds : bounds;

  useEffect(() => {
    const controller = new AbortController();
    loadAttempt.current += 1;
    const key = JSON.stringify([requested.start, requested.end, zone, coach]);
    const refresh = lastRevision.current !== revision;
    lastRevision.current = revision;
    setLoading(lastRequest.current !== key || !snapshot.current); setRefreshing(true); setSlow(false); setError('');
    if (lastRequest.current !== key) setData(null);
    if (lastRequest.current !== key || refresh) setSelectedSession(null);
    lastRequest.current = key;
    const query = { start: requested.start, end: requested.end, timeZone: zone, coachEmail: coach };
    const publish = (value: CoachingCalendar) => {
      if (!controller.signal.aborted) { snapshot.current = { query, data: value }; setData(value); setDirectory(value); }
    };
    const slowTimer = window.setTimeout(() => setSlow(true), 12000);
    void loadCoachingCalendar(query, controller.signal, {
      background: true, refresh, previous: snapshot.current, onProgress: publish, onDirectory: value => {
        if (!controller.signal.aborted) {
          setData(current => current && current.scope !== value.scope ? null : current);
          setDirectory(value);
        }
      },
    })
      .then(publish)
      .catch(reason => {
        if (!controller.signal.aborted) {
          if (reason instanceof Error && reason.message.startsWith('You do not have access')) {
            snapshot.current = undefined; setData(null); setDirectory(null);
          }
          setError(reason instanceof Error ? reason.message : 'Coaching calendars could not be loaded.');
        }
      })
      .finally(() => { window.clearTimeout(slowTimer); if (!controller.signal.aborted) { setLoading(false); setRefreshing(false); } });
    return () => { controller.abort(); window.clearTimeout(slowTimer); };
  }, [requested.start, requested.end, zone, coach, revision, pollEpoch]);

  useEffect(() => {
    // Only completed reads advance the backoff. Closing a drawer or switching
    // tabs must not reset it or create an additional request.
    if (loading || refreshing || selectedSession || linkedId || !data?.sync) return;
    const key = JSON.stringify([lastRequest.current, lastRevision.current]);
    const progress = JSON.stringify([data.sync.version, data.sync.lastSuccessfulAt,
      data.sync.pendingCalendars, data.sync.pendingEvidence, data.coverage.checkedCoachEmails,
      data.meetings.reduce((sum, row) => sum + row.media.readyCount, 0)]);
    const previous = polling.current;
    if (previous.attempt !== loadAttempt.current || previous.key !== key) {
      const unchanged = previous.key === key && previous.progress === progress;
      const delay = error ? Math.min(300000, Math.max(60000, previous.delay * 2))
        : !initialChecksPending(data.sync) ? 300000 : unchanged ? Math.min(120000, previous.delay * 2) : 5000;
      polling.current = { attempt: loadAttempt.current, key, progress, delay, dueAt: Date.now() + delay };
    }
    let timer: number | undefined;
    let fired = false;
    const schedule = () => {
      window.clearTimeout(timer);
      if (fired || document.hidden || !navigator.onLine) return;
      timer = window.setTimeout(() => {
        fired = true;
        setPollEpoch(value => value + 1);
      }, Math.max(0, polling.current.dueAt - Date.now()));
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('online', schedule);
    window.addEventListener('offline', schedule);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('online', schedule);
      window.removeEventListener('offline', schedule);
    };
  }, [loading, refreshing, data, error, selectedSession, linkedId]);

  useEffect(() => { setAgendaLimit(30); setSelectedSession(null); }, [requested.start, requested.end, zone, coach, learner, phase, match, family, showLectures]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const catalog = data ?? directory;
  const preparing = initialChecksPending(data?.sync);
  const coachNames = useMemo(() => new Map(catalog?.coaches.map(row => [row.email, row.name])), [catalog?.coaches]);
  const learnerNames = useMemo(() => new Map(catalog?.learners.map(row => [row.id, row.name])), [catalog?.learners]);
  const clockFormatter = useMemo(() => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' }), [zone]);
  const linkedLearners = new Set((data?.meetings ?? []).filter(row => row.coachEmail === coach).flatMap(row => row.learnerIds));
  const learners = (catalog?.learners ?? []).filter(row => !coach || row.coachEmail === coach
    || linkedLearners.has(row.id));
  const scopedMeetings = (data?.meetings ?? []).filter(row => (!coach || row.coachEmail === coach)
    && (!learner || row.learnerIds.includes(learner)) && (showLectures || meetingCategory(row) !== 'LECTURE'));
  const visible = filterMeetings(scopedMeetings, phase, match, family, now);
  const allMatching = filterMeetings(scopedMeetings, 'all', match, family, now);
  const cancellations = (phase === 'cancelled' || phase === 'all') && match !== 'matched'
    ? (data?.cancelledBookings ?? []).filter(row => (!learner || row.learnerId === learner) && (!coach || row.coachEmail === coach) && (family === 'all' || family === row.family)
      && !visible.some(meeting => meeting.eventKey === row.eventKey && meeting.cancellationSources?.includes('lms'))) : [];
  const lmsOnly = (data?.lmsOnly ?? []).filter(row => (!learner || row.learnerId === learner) && (!coach || row.coachEmail === coach));
  const issues = [...new Map((data?.errors ?? []).map(item => [`${item.coachEmail}:${item.code}`, item])).values()];
  const listedLink = linkedId ? data?.meetings.find(row => row.meetingId === linkedId) : undefined;
  const selectedMeeting = linkedId ? linked?.meeting.meetingId === linkedId ? linked.meeting : listedLink : visible.find(row => meetingKey(row) === selectedSession);
  const activeKey = selectedMeeting ? meetingKey(selectedMeeting) : null;
  useEffect(() => {
    if (!linkedId) { setLinked(null); setLinkError(''); setLinkLoading(false); return; }
    if (listedLink || linked?.meeting.meetingId === linkedId) { setLinkLoading(false); setLinkError(''); return; }
    const controller = new AbortController(); setLinked(null); setLinkError(''); setLinkLoading(true);
    void loadLinkedCoachingMeeting(linkedId, occurrenceDate, zone, controller.signal, linkAttempt > 0)
      .then(value => { if (!controller.signal.aborted) setLinked(value); })
      .catch(reason => { if (!controller.signal.aborted) setLinkError(reason instanceof Error ? reason.message : 'This meeting link could not be opened.'); })
      .finally(() => { if (!controller.signal.aborted) setLinkLoading(false); });
    return () => controller.abort();
  }, [linkedId, occurrenceDate, zone, listedLink, linked, linkAttempt]);
  useEffect(() => {
    // An in-flight calendar read can remove the selected meeting from the
    // current filter. Release the review pause when its drawer disappears.
    if (!linkedId && selectedSession && !selectedMeeting) setSelectedSession(null);
  }, [selectedSession, selectedMeeting, linkedId]);
  const meetingDates = new Set<string>();
  for (const row of allMatching) {
    const first = meetingDate(row.startsAt, zone), last = meetingDate(new Date(Date.parse(row.endsAt) - 1).toISOString(), zone);
    for (let day = first > requested.start ? first : requested.start; day <= last && day <= requested.end; day = addDays(day, 1)) meetingDates.add(day);
  }
  const coachName = (email: string) => coachNames.get(email) ?? (linked?.coach.email === email ? linked.coach.name : email);
  const learnerName = (id: string) => learnerNames.get(id) ?? linked?.learners.find(row => row.id === id)?.name ?? 'Learner';
  const clock = (value: string) => clockFormatter.format(new Date(value));
  const shift = (direction: number) => {
    if (period !== 'month') setDate(addDays(date, direction * (period === 'day' ? 1 : 7)));
    else setDate(new Date(Date.UTC(month.year, month.month - 1 + direction, 1)).toISOString().slice(0, 10));
  };
  const selectDay = (value: string) => navigate({ date: value, period: 'day' });
  const selectMeeting = (row: CoachingCalendar['meetings'][number]) => {
    selectedReference.current = row.recordingsReference; setSelectedSession(row.meetingId ? null : meetingKey(row));
    if (row.meetingId) navigate({ meeting: row.meetingId, occurrenceDate: meetingDate(row.startsAt, zone) < requested.start ? requested.start : meetingDate(row.startsAt, zone), tab: 'recordings' }, false);
  };
  const closeMeeting = () => { setSelectedSession(null); navigate({ meeting: '', tab: 'recordings' }, false); };
  const rosterCoach = coach || (catalog?.scope === 'own' ? catalog.coaches[0]?.email ?? '' : '');
  const viewLearnerMeetings = (id: string) => {
    navigate({ coach: rosterCoach, learner: id, phase: 'all', match: 'all', family: 'all' }); setShowLearners(false);
  };

  return <WorkspaceShell role={workspace} roleLabel={workspace === 'coach' ? 'Coach' : 'Curriculum Designer'}
    workspaceLabel={workspace === 'coach' ? 'Coach Workspace' : 'Curriculum Studio'}
    navItems={workspace === 'coach' ? coachNavItems : curriculumNavItems}
    pageTitle="Coach Meetings & Recordings" pageSubtitle="Coach calendars, learners, meeting recordings and attendance">
    <main className="min-h-full bg-background-100 px-4 py-5 sm:px-6 lg:px-7">
      {workspace === 'curriculum' && <nav aria-label="Recording libraries" className="mb-5 flex gap-2 text-sm font-semibold">
        <Link to="/curriculum/recordings" className={`${control} hover:bg-primary-50`}>Lecture recordings</Link>
        <span aria-current="page" className="rounded-lg bg-primary-600 px-3 py-2 text-white">Coach Meetings &amp; Recordings</span>
      </nav>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary-600">Coaching workspace</p><h1 className="font-heading text-2xl font-extrabold text-foreground-950">Coach Meetings &amp; Recordings</h1>
          <p className="mt-1 text-sm text-foreground-600">See every meeting on a coach's calendar by its original title. Filter by coach, learner, date or status.</p></div>
        <div className="flex flex-wrap gap-2">
          {workspace === 'curriculum' && <Link className={`${control} inline-flex items-center gap-2 font-semibold text-primary-700`} to="/curriculum/coaching-recordings/reviews">Quality reviews &amp; evidence</Link>}
          <button type="button" className={`${control} inline-flex items-center gap-2 disabled:opacity-50`} disabled={loading || refreshing} onClick={() => setRevision(value => value + 1)}><RefreshCw aria-hidden="true" size={16} />Refresh calendars</button>
        </div>
      </div>
      {loading && <div role="status" className="mt-4 rounded-xl border border-primary-100 bg-white p-4">
        <div className="flex items-start gap-3"><Loader2 aria-hidden="true" size={19} className="mt-0.5 shrink-0 animate-spin text-primary-600 motion-reduce:animate-none" /><div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{data ? 'Loading the remaining coach calendars…' : 'Loading coach calendars…'}</p>
          <p className="mt-1 text-xs text-foreground-600">{data ? `${data.coverage.checkedCoachEmails.length} of ${data.coverage.totalCoaches} calendars checked. You can use the meetings already loaded.` : 'The first coach appears as soon as their calendar is checked.'}</p>
          {data && <progress aria-label="Calendar loading progress" className="mt-3 h-1.5 w-full accent-primary-600" max={Math.max(1, data.coverage.totalCoaches)} value={data.coverage.checkedCoachEmails.length} />}
          {slow && <p className="mt-2 text-xs text-amber-800">Microsoft is responding slowly. Choose one coach to narrow the request; unavailable calendars will be identified separately.</p>}
        </div></div>
      </div>}
      <section aria-label="Calendar filters" className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border border-background-200 bg-white p-4">
        <label className="grid gap-1 text-xs font-semibold">Coach<select aria-label="Coach" value={coach} className={control} onChange={event => navigate({ coach: event.target.value, learner: '' })}>
          <option value="">{catalog?.scope === 'own' ? 'My calendar' : 'All coaches'}</option>
          {catalog?.coaches.map(row => <option key={row.email} value={row.email}>{row.name}</option>)}
          {coach && !catalog?.coaches.some(row => row.email === coach) && <option value={coach}>{coach}</option>}
        </select></label>
        <button type="button" className={`${control} inline-flex items-center gap-2 disabled:opacity-50`} disabled={!rosterCoach} onClick={() => setShowLearners(true)}><Users size={16} aria-hidden="true" />Coach learners</button>
        <label className="grid gap-1 text-xs font-semibold">Learner<select aria-label="Learner" value={learner} className={control} onChange={event => navigate({ learner: event.target.value })}>
          <option value="">All learners</option>{learners.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          {learner && !learners.some(row => row.id === learner) && <option value={learner}>Selected learner</option>}
        </select></label>
        <button type="button" className={`${control} sm:hidden`} aria-expanded={moreFilters} aria-controls="coaching-extra-filters" onClick={() => setMoreFilters(value => !value)}>More filters</button>
        <div id="coaching-extra-filters" className={`${moreFilters ? 'flex' : 'hidden'} min-w-0 flex-wrap items-end gap-3 sm:flex`}>
        <label className="grid min-w-0 max-w-full gap-1 text-xs font-semibold">Meeting type<select aria-label="Meeting type" value={family} className={control} onChange={event => setFamily(event.target.value)}>
          <option value="all">All types</option>
          <optgroup label="MCM & PR"><option value="MCM">{categoryLabels.MCM}</option><option value="PR">{categoryLabels.PR}</option></optgroup>
          <optgroup label="Other meetings"><option value="SUPPORT">{categoryLabels.SUPPORT}</option><option value="OTHER">{categoryLabels.OTHER}</option></optgroup>
          {showLectures && <option value="LECTURE">Lectures / subjects</option>}
        </select></label>
        <button type="button" aria-pressed={showLectures} className={`${control} ${showLectures ? 'border-primary-300 bg-primary-50 text-primary-800' : ''}`}
          onClick={() => navigate({ lectures: !showLectures, family: family === 'LECTURE' ? 'all' : family })}>{showLectures ? 'Hide lectures / subjects' : 'Show lectures / subjects'}</button>
        <label className="grid gap-1 text-xs font-semibold">Match<select aria-label="LMS match" value={match} className={control} onChange={event => setMatch(event.target.value as MatchFilter)}>
          <option value="all">All matches</option><option value="matched">Matched to LMS</option><option value="review">Needs matching review</option>
        </select></label>
        <label className="grid gap-1 text-xs font-semibold">Time zone<select aria-label="Time zone" value={zone} className={control} onChange={event => navigate({ zone: event.target.value })}>
          {!CALENDAR_TIME_ZONES.includes(zone) && <option value={zone}>{zone}</option>}
          {CALENDAR_TIME_ZONES.map(value => <option key={value}>{value}</option>)}
        </select></label>
        </div>
        {!rosterCoach && <p className="w-full text-xs text-foreground-500">Choose one coach to view their learners.</p>}
      </section>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className={control} aria-label="Previous period" onClick={() => shift(-1)}>‹</button>
        <button className={control} onClick={() => setDate(todayIso(zone))}>Today</button>
        <button className={control} aria-label="Next period" onClick={() => shift(1)}>›</button>
        <label className="sr-only" htmlFor="coaching-date">Selected date</label><input id="coaching-date" aria-label="Selected date" type="date" className={control} value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }} />
        <select aria-label="Calendar period" className={control} value={period} onChange={event => setPeriod(event.target.value as Period)}>
          <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
        </select>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Meeting status">
          {(['ready', 'attention', 'ended', 'upcoming', 'in-progress', 'cancelled', 'all'] as const).map(value => <button key={value} aria-pressed={phase === value} onClick={() => { setPhase(value); setSelectedSession(null); }}
            className={phase === value ? 'rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white' : control}>{filterLabels[value]}</button>)}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Meeting summary">
        {[
          { label: 'Meetings in this period', count: scopedMeetings.length, icon: CalendarDays },
          { label: 'Ready recordings', count: filterMeetings(scopedMeetings, 'ready', 'all', 'all', now).length, icon: Video },
          { label: 'Upcoming meetings', count: filterMeetings(scopedMeetings, 'upcoming', 'all', 'all', now).length, icon: CalendarDays },
          { label: 'Coach calendars checked', count: data?.coverage.checkedCoachEmails.length ?? 0, icon: Users },
        ].map(({ label, count, icon: Icon }) => <div key={label} className="flex items-center gap-2 rounded-full border border-background-200 bg-white px-3 py-2 text-xs">
          <Icon aria-hidden="true" size={14} className="text-primary-500" /><span className="font-bold text-foreground-950">{data ? count : '—'}</span>
          <span className="text-foreground-600">{label}{loading && data ? ' · loading' : ''}</span>
        </div>)}
      </div>
      {loading && !data && <section aria-label="Loading calendar preview" aria-busy="true" className="mt-4 overflow-hidden rounded-xl border border-background-200 bg-white p-4">
        <div className="h-5 w-40 rounded bg-background-200 motion-safe:animate-pulse" />
        <div aria-hidden="true" className="mt-5 space-y-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="flex h-16 items-center gap-5 rounded-lg border border-background-100 px-4"><div className="h-3 w-16 rounded bg-background-200" /><div className="h-3 w-1/2 rounded bg-primary-100 motion-safe:animate-pulse" /></div>)}</div>
      </section>}
      {error && <div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error} <button className="font-semibold underline" onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
      {data && <>
        <section aria-label="Calendar data status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-background-200 bg-white px-4 py-3">
          <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-600">
            <span className="inline-flex items-center gap-2"><span aria-hidden="true" className={`h-2 w-2 rounded-full ${data.partial ? 'bg-amber-500' : preparing ? 'bg-primary-500' : 'bg-emerald-500'}`} />{data.coverage.checkedCoachEmails.length} of {data.coverage.totalCoaches} calendars loaded</span>
            {refreshing ? <span className="inline-flex items-center gap-1.5"><Loader2 size={12} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Checking for updates</span>
              : preparing ? <span>Remaining checks pending</span> : data.sync?.pending && <span>Saved results available</span>}
            {data.sync?.lastSuccessfulAt && <span>Last calendar check: {clock(data.sync.lastSuccessfulAt)}</span>}
            {data.partial && <span className="font-medium text-amber-800">{issues.length ? `${issues.length} ${issues.length === 1 ? 'check needs' : 'checks need'} attention` : 'Some results are incomplete'}</span>}
            {lmsOnly.length > 0 && <span>{lmsOnly.length} {lmsOnly.length === 1 ? 'booking' : 'bookings'} to compare</span>}
          </div>
          <button type="button" className="text-xs font-semibold text-primary-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500" onClick={() => { setSelectedSession(null); setShowSyncDetails(true); }}>Sync & booking details</button>
        </section>
        {!loading && !visible.length && phase === 'ready' && allMatching.length > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm">
          <p>{preparing ? 'Recording checks are still running.' : `No meetings match ${filterLabels[phase]}.`} There are {allMatching.length} meetings loaded across all statuses{data.partial ? '; some calendars are still unavailable' : ''}.</p>
          <button className={control} onClick={() => setPhase('all')}>Show all loaded meetings</button>
        </div>}
        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="hidden lg:block"><CoachMiniCalendar date={date} timeZone={zone} meetingDates={meetingDates} onSelectDay={selectDay} /></div>
          <section aria-label="Coaching meetings" className="min-w-0 space-y-4">
            {!loading && !preparing && !visible.length && !cancellations.length && <p className="rounded-xl border border-background-200 bg-white p-6 text-sm text-foreground-600">{data.partial ? 'No meetings loaded for these filters. Some calendars or recordings could not be checked.' : phase === 'ready' ? 'No ready recordings match these filters. Choose Ended or Needs attention to review the remaining sessions.' : 'No meetings match these filters in the selected period.'}</p>}
            <MeetingCalendar date={date} period={period} timeZone={zone} meetings={period === 'day' ? visible : visible.slice(0, agendaLimit)} totalMeetings={visible.length} now={now}
              selected={activeKey} coachName={coachName} learnerName={learnerName} onSelectDay={selectDay} onSelectMeeting={selectMeeting} />
            {period !== 'day' && visible.length > agendaLimit && <button className={control} onClick={() => setAgendaLimit(value => value + 30)}>Show more meetings ({visible.length - agendaLimit} remaining)</button>}
            {cancellations.length > 0 && <section aria-label="Saved LMS cancellations" className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <h2 className="text-sm font-bold text-rose-950">Saved LMS cancellations</h2>
              <p className="mt-1 text-xs text-rose-900">Source: LMS. Where the original meeting time was removed, the selected period uses the record update date. That date is not the original meeting or cancellation time.</p>
              <ul className="mt-3 space-y-3 text-sm">{cancellations.map(row => <li key={`${row.coachEmail}:${row.eventKey}`}>
                <p className="font-semibold">{learnerName(row.learnerId)} · {coachName(row.coachEmail)} · {categoryLabels[row.family]}</p>
                <p className="mt-1 text-xs">Cancelled · Source: LMS · {row.startsAt ? `Session: ${formatFullDate(meetingDate(row.startsAt, zone))} ${clock(row.startsAt)}` : `Original session time not retained. Record updated: ${row.recordUpdatedAt ? formatFullDate(meetingDate(row.recordUpdatedAt, zone)) : 'Unknown'}`}</p>
              </li>)}</ul>
            </section>}
          </section>
        </div>
      </>}
      {linkedId && linkLoading && !selectedMeeting && <p role="status" className="mt-4 rounded-xl border border-primary-100 bg-white p-4 text-sm">Opening the saved meeting…</p>}
      {linkedId && linkError && !selectedMeeting && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">{linkError}
        <button className={`${control} ml-2`} onClick={() => setLinkAttempt(value => value + 1)}>Retry meeting link</button>
        <button className={`${control} ml-2`} onClick={closeMeeting}>Close meeting link</button></div>}
      {selectedMeeting && <MeetingDetailsDrawer key={activeKey} meeting={selectedMeeting} reference={linkedId ? selectedMeeting.recordingsReference : selectedReference.current}
        qualityEnabled={workspace === 'curriculum'}
        activeTab={linkedId ? tab : undefined} onTabChange={linkedId ? value => navigate({ tab: value }, false) : undefined}
        timeZone={zone} now={now} coachName={coachName(selectedMeeting.coachEmail)} learnerNames={selectedMeeting.learnerIds.map(learnerName)} onClose={closeMeeting} />}
      {showSyncDetails && data && <SyncReviewDrawer data={data} issues={issues} bookings={lmsOnly} pending={loading} busy={refreshing}
        coachName={coachName} learnerName={learnerName} onClose={() => setShowSyncDetails(false)} onRefresh={() => setRevision(value => value + 1)}
        onViewCoach={email => { setShowSyncDetails(false); navigate({ coach: email, learner: '' }); }} />}
      {showLearners && rosterCoach && <CoachLearnersDialog key={`${rosterCoach}:${requested.start}:${requested.end}:${zone}`}
        coachEmail={rosterCoach} coachName={coachName(rosterCoach)} start={requested.start} end={requested.end} timeZone={zone}
        meetings={(data?.meetings ?? []).filter(row => row.coachEmail === rosterCoach)} calendarPartial={loading || !data || data.partial}
        onClose={() => setShowLearners(false)} onViewMeetings={viewLearnerMeetings} />}
    </main>
  </WorkspaceShell>;
}
