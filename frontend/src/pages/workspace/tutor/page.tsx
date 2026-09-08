import { useEffect, useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { roleNavMap } from '@/mocks/navigation';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { useAuth } from '@/hooks/useAuth';
import { useTutorIdentity } from '@/hooks/useTutorIdentity';
import { clearTutorViewAs, setTutorViewAs } from '@/lib/tutorViewAs';
import { formatHoursMinutes } from '@/lib/format';
import { TutorDirectoryPicker } from './TutorDirectoryPicker';
import { isJoinButtonEnabled, scheduledInstant, UK_TIME_ZONE } from './meetingTiming';
import {
  fetchModuleStructure,
  fetchTutorWorkspace,
  type ModuleComponent,
  type ModuleWeek,
  type TutorModule,
  type TutorNextSession,
  type TutorWorkspace,
} from '@/api/tutorWorkspace';

/* ═══════════════════════════════════════════════════════
   TUTOR WORKSPACE

   Two things, both real: the modules this tutor is assigned
   to deliver, and when their next live session is.

   It replaced a dashboard of mock counters — assignment
   marking queues, evidence review totals, KSB validation
   tiles — none of which read from anything. Numbers that do
   not come from data are worse than an empty page, because
   they look like work waiting to be done.

   The tutor is resolved from their signed-in account by email
   first, then by name — the login account and the curriculum tutor
   profile are separate records with no key in common, so the match
   is on whatever they share. Modules come only from the profile's
   explicit assigned-module IDs. An account matching no profile is
   told exactly that rather than shown an empty timetable — see the
   unlinked state below.
   ═══════════════════════════════════════════════════════ */

const tutorNav = roleNavMap.tutor;

/** "Saturday 09:00–11:00", or whichever parts the module actually has. */
function weeklySlot(module: TutorModule): string {
  const time = [module.sessionStartTime, module.sessionEndTime].filter(Boolean).join('–');
  return [module.sessionWeekDay, time].filter(Boolean).join(' ') || 'Not scheduled';
}

/** A YYYY-MM-DD date as "1 Aug 2026". Blank stays blank. */
function shortDate(value: string): string {
  if (!value) return '';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/** A scheduled instant formatted in the meeting's UK timezone. */
function sessionMoment(iso: string): { day: string; time: string } {
  if (!iso) return { day: '', time: '' };
  const date = scheduledInstant(iso);
  if (!date) return { day: iso, time: '' };
  return {
    day: new Intl.DateTimeFormat('en-GB', { timeZone: UK_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date),
    time: new Intl.DateTimeFormat('en-GB', { timeZone: UK_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(date),
  };
}

/** "in 6 days" / "today" / "tomorrow", from now to the session. */
function countdown(iso: string): string {
  if (!iso) return '';
  const start = scheduledInstant(iso)?.getTime();
  if (start == null) return '';
  const days = Math.round((start - Date.now()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return `in ${days} days`;
  const weeks = Math.round(days / 7);
  return weeks === 1 ? 'in a week' : `in ${weeks} weeks`;
}

/** Keep the button state current when a tutor leaves this page open. */
function useJoinButtonEnabled(session: TutorNextSession): boolean {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [session.scheduledStart, session.scheduledEnd]);

  return isJoinButtonEnabled(session.scheduledStart, session.scheduledEnd, now);
}

function MeetingJoinButton({ session, compact = false }: { session: TutorNextSession; compact?: boolean }) {
  const isEnabled = useJoinButtonEnabled(session);
  const className = compact
    ? 'shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors'
    : 'mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors';
  const stateClassName = isEnabled
    ? 'meeting-join-action cursor-pointer'
    : 'cursor-not-allowed bg-foreground-200 text-foreground-400';
  const label = compact ? 'Join' : 'Join the meeting';

  if (!isEnabled) {
    return (
      <button type="button" disabled aria-disabled="true" className={`${className} ${stateClassName}`}>
        <AppIcon className="ri-vidicon-line text-[14px]" /> {label}
      </button>
    );
  }

  return (
    <a href={session.joinUrl} target="_blank" rel="noreferrer" className={`${className} ${stateClassName}`}>
      <AppIcon className="ri-vidicon-line text-[14px]" /> {label}
    </a>
  );
}

function NextSessionCard({ session }: { session: TutorNextSession }) {
  const { day, time } = sessionMoment(session.scheduledStart);
  const end = sessionMoment(session.scheduledEnd).time;
  return (
    <section className="overflow-hidden rounded-2xl border border-primary-200/70 shadow-sm">
      <div className="bg-gradient-to-r from-primary-600 to-primary-500 px-5 py-4 text-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Next session
            </span>
            <h2 className="mt-1 truncate font-heading text-lg font-bold leading-tight text-white">{day || 'Scheduled'}</h2>
            <p className="truncate text-[12px] text-white/75">{session.moduleTitle || 'Module'}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-heading text-2xl font-bold leading-none tabular-nums">
              {time}{end ? `–${end}` : ''}
            </p>
            <p className="mt-0.5 text-[11px] text-white/75">{countdown(session.scheduledStart)}</p>
          </div>
        </div>
      </div>

      <div className="bg-background-50 p-4 md:p-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact label="Session" value={session.sessionNumber != null ? `${session.sessionNumber}${session.repeatOccurrences ? ` of ${session.repeatOccurrences}` : ''}` : '—'} />
          <Fact label="Duration" value={session.durationMinutes ? `${session.durationMinutes} min` : '—'} />
          <Fact label="Time zone" value={session.timezone || '—'} />
          <Fact label="Repeats" value={session.repeatPattern || 'Once'} />
        </dl>
        {session.joinUrl && <MeetingJoinButton session={session} />}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-semibold text-foreground-800">{value}</dd>
    </div>
  );
}

/** Component types, as the curriculum builder names them, to icon and label. */
const COMPONENT_META: Record<string, { icon: string; label: string }> = {
  powerpoint: { icon: 'ri-slideshow-line', label: 'Slides' },
  reading: { icon: 'ri-book-open-line', label: 'Reading' },
  video: { icon: 'ri-play-circle-line', label: 'Video' },
  podcast: { icon: 'ri-mic-line', label: 'Podcast' },
  quiz: { icon: 'ri-questionnaire-line', label: 'Quiz' },
  assignment: { icon: 'ri-edit-line', label: 'Assignment' },
  activity: { icon: 'ri-lightbulb-line', label: 'Activity' },
  reflection: { icon: 'ri-chat-quote-line', label: 'Reflection' },
  live_session: { icon: 'ri-vidicon-line', label: 'Live session' },
  'workplace-evidence': { icon: 'ri-briefcase-line', label: 'Workplace evidence' },
};

function componentMeta(type: string) {
  return COMPONENT_META[type] || { icon: 'ri-file-line', label: type || 'Component' };
}

function ComponentRow({ component }: { component: ModuleComponent }) {
  const meta = componentMeta(component.type);
  const [open, setOpen] = useState(false);
  // Only the requirements that are actually set, so a plain component stays plain.
  const requirements = [
    component.reflectionRequired && 'Reflection',
    component.workplaceEvidenceRequired && 'Evidence',
    component.tutorValidationRequired && 'Your validation',
  ].filter(Boolean) as string[];
  const detailsId = `component-details-${component.id}`;

  return (
    <li className="overflow-hidden rounded-xl border border-foreground-100 bg-background-100/40">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen(wasOpen => !wasOpen)}
        className="flex w-full cursor-pointer items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-primary-50/40"
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-background-50 text-foreground-500">
          <AppIcon className={`${meta.icon} text-[13px]`} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-foreground-800">{component.title || meta.label}</span>
          <span className="block text-[10.5px] uppercase tracking-wider text-foreground-400">{meta.label}</span>
          {requirements.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {requirements.map((requirement) => (
                <span key={requirement} className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-700">
                  {requirement}
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="shrink-0 text-right">
          {component.expectedOtjh != null && component.expectedOtjh > 0 && (
            <span className="block text-[11px] font-semibold tabular-nums text-foreground-600">{component.expectedOtjh}h</span>
          )}
          {component.points != null && component.points > 0 && (
            <span className="block text-[10px] text-foreground-400">{component.points} pts</span>
          )}
        </span>
        <AppIcon className={`mt-1 shrink-0 text-sm text-foreground-400 transition-transform ${open ? 'rotate-180' : ''} ri-arrow-down-s-line`} />
      </button>

      {open && (
        <div id={detailsId} className="border-t border-foreground-100 bg-background-50/70 px-3 py-3 pl-[3.75rem]">
          <p className="text-[12px] leading-relaxed text-foreground-600">
            {component.description || 'No description has been added for this component yet.'}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Expected OTJH</dt>
              <dd className="mt-0.5 text-[12px] font-semibold text-foreground-800">
                {component.expectedOtjh != null ? formatHoursMinutes(component.expectedOtjh) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Points</dt>
              <dd className="mt-0.5 text-[12px] font-semibold text-foreground-800">
                {component.points != null ? component.points : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Requirements</dt>
              <dd className="mt-0.5 text-[12px] font-semibold text-foreground-800">
                {requirements.length > 0 ? requirements.length : 'None'}
              </dd>
            </div>
          </dl>
          {requirements.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {requirements.map((requirement) => (
                <span key={requirement} className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-700">
                  {requirement}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function WeekBlock({ week }: { week: ModuleWeek }) {
  const components = week.components;
  const hours = components.reduce((total, component) => total + (component.expectedOtjh || 0), 0);
  const [open, setOpen] = useState(false);
  const detailsId = `week-details-${week.id || week.weekNumber}`;
  return (
    <div className="rounded-xl border border-foreground-100 bg-background-50 p-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen(wasOpen => !wasOpen)}
        className="flex w-full cursor-pointer items-center gap-3 text-left transition-colors hover:text-primary-700"
      >
      <div className="flex flex-1 items-baseline justify-between gap-3">
        <h5 className="truncate text-[13px] font-bold text-foreground-800">
          {week.title || `Week ${week.weekNumber}`}
        </h5>
        <span className="shrink-0 text-[10.5px] text-foreground-400">
          {components.length === 0
            ? 'Nothing added yet'
            : `${components.length} item${components.length === 1 ? '' : 's'}${hours > 0 ? ` · ${hours}h` : ''}`}
        </span>
      </div>
      <AppIcon className={`shrink-0 text-sm text-foreground-400 transition-transform ${open ? 'rotate-180' : ''} ri-arrow-down-s-line`} />
      </button>
      {open && (
        <div id={detailsId} className="mt-3 border-t border-foreground-100 pt-3">
          {week.summary && <p className="text-[12px] leading-snug text-foreground-500">{week.summary}</p>}
          {components.length > 0 ? (
            <ul className={`${week.summary ? 'mt-2.5' : ''} space-y-1.5`}>
              {components.map((component) => (
                <ComponentRow key={component.id} component={component} />
              ))}
            </ul>
          ) : (
            <p className={`${week.summary ? 'mt-2.5' : ''} rounded-lg bg-background-100/60 px-3 py-2 text-[12px] text-foreground-500`}>
              Nothing added to this week yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The module's own next session, inside its opened card. */
function ModuleSessionLine({ session }: { session: TutorNextSession }) {
  const { day, time } = sessionMoment(session.scheduledStart);
  const end = sessionMoment(session.scheduledEnd).time;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary-200/70 bg-primary-50/50 px-3.5 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-500 text-white">
        <AppIcon className="ri-calendar-event-line text-sm" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-primary-700">Next live session</p>
        <p className="truncate text-[13px] font-semibold text-foreground-800">
          {day}{time ? ` · ${time}${end ? `–${end}` : ''}` : ''}
        </p>
        <p className="truncate text-[11px] text-foreground-500">
          {[
            session.sessionNumber != null
              ? `Session ${session.sessionNumber}${session.repeatOccurrences ? ` of ${session.repeatOccurrences}` : ''}`
              : '',
            session.timezone,
            countdown(session.scheduledStart),
          ].filter(Boolean).join(' · ')}
        </p>
      </div>
      {session.joinUrl && <MeetingJoinButton session={session} compact />}
    </div>
  );
}

/**
 * One assigned module, opening to its weeks and components.
 *
 * The structure is fetched when the card is first opened, not with the module
 * list: a tutor with several modules would otherwise wait on every module's
 * weeks to see any of them. Once fetched it is kept, so reopening is instant.
 */
function ModuleCard({ module }: { module: TutorModule }) {
  const deliveryWindow = [shortDate(module.startDate), shortDate(module.endDate)].filter(Boolean).join(' → ');
  const [open, setOpen] = useState(false);
  const [weeks, setWeeks] = useState<ModuleWeek[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // `loading` is deliberately neither guarded on nor a dependency: it is set
    // inside this effect, so including it re-ran the effect, and the first run's
    // cleanup then aborted the request it had just started. `weeks !== null` is
    // what stops a refetch, and nothing else here changes mid-flight.
    if (!open || weeks !== null) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchModuleStructure(module.moduleCatalogueId, controller.signal)
      .then((structure) => setWeeks(structure.weeks))
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Could not load this module.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, weeks, module.moduleCatalogueId]);

  return (
    <article className="overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50">
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        className="w-full cursor-pointer p-4 text-left transition-smooth hover:bg-primary-50/30 md:p-5"
      >
        <div className="flex items-start gap-3">
          {/* The module's own colour from the curriculum builder, so the card is
              recognisable against the same module there. */}
          <span
            className="mt-0.5 h-9 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: module.colour || 'var(--primary-500, #7c3aed)' }}
          />
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-heading text-[15px] font-bold text-foreground-900">{module.title || 'Untitled module'}</h3>
            <p className="mt-0.5 truncate text-[12px] text-foreground-500">
              {[module.programmeName, module.cohortName, module.groupName].filter(Boolean).join(' · ') || 'No delivery context set'}
            </p>
          </div>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-400">
            <AppIcon className={`ri-arrow-down-s-line text-sm transition-transform ${open ? 'rotate-180' : ''}`} />
          </span>
        </div>

        {module.description && (
          <p className="mt-3 line-clamp-2 text-[12.5px] leading-relaxed text-foreground-600">{module.description}</p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-foreground-100 pt-3 sm:grid-cols-4">
          <Fact label="Weekly slot" value={weeklySlot(module)} />
          <Fact label="Sessions" value={module.sessionsNumber != null ? String(module.sessionsNumber) : '—'} />
          <Fact label="OTJ hours" value={module.totalOtjh != null && Number(module.totalOtjh) > 0 ? formatHoursMinutes(Number(module.totalOtjh)) : '—'} />
          <Fact label="Delivery window" value={deliveryWindow || '—'} />
        </dl>
      </button>

      {open && (
        <div className="space-y-3 border-t border-foreground-100 bg-background-100/30 p-4 md:p-5">
          {module.nextSession ? (
            <ModuleSessionLine session={module.nextSession} />
          ) : (
            <p className="rounded-xl border border-foreground-100 bg-background-50 px-3.5 py-2.5 text-[12px] text-foreground-500">
              No live session is scheduled against this module yet.
            </p>
          )}

          <div>
            <h4 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-foreground-400">
              Weeks and components
            </h4>
            {loading ? (
              <RowsSkeleton rows={3} avatar={false} />
            ) : error ? (
              <p className="rounded-xl border border-red-200 bg-red-50/70 px-3.5 py-2.5 text-[12px] text-red-800">{error}</p>
            ) : !weeks || weeks.length === 0 ? (
              <p className="rounded-xl border border-foreground-100 bg-background-50 px-3.5 py-2.5 text-[12px] text-foreground-500">
                No weeks have been built for this module yet.
              </p>
            ) : (
              <div className="space-y-2">
                {weeks.map((week) => (
                  <WeekBlock key={week.id || week.weekNumber} week={week} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * Shown when nothing identifies the tutor being asked about.
 *
 * `viewingAsTutor` changes who "this" is: an admin who picked a tutor from the
 * directory is being told about that tutor, not about their own account, and
 * the difference decides whether the fix is theirs to make.
 */
function UnlinkedNotice({ email, name, viewingAsTutor = false }: { email: string; name: string; viewingAsTutor?: boolean }) {
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-6 text-center">
      <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
        <AppIcon className="ri-link-unlink text-xl" />
      </span>
      <h2 className="font-heading text-base font-bold text-foreground-900">
        {viewingAsTutor ? 'No modules are linked to this tutor yet' : 'No modules are linked to this account yet'}
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-foreground-600">
        Nothing matches{' '}
        <strong className="font-semibold text-foreground-800">{name || email || 'this account'}</strong>
        {name && email ? <> or <strong className="font-semibold text-foreground-800">{email}</strong></> : null}
        {' '}— no tutor profile carries that name or address.
      </p>
      <p className="mx-auto mt-2 max-w-xl text-[12.5px] leading-relaxed text-foreground-500">
        An administrator can fix this in <strong className="font-semibold text-foreground-700">Curriculum → Staff profiles</strong>,
        by matching the tutor’s name to this account or setting its email, and by
        assigning them a module.
      </p>
    </section>
  );
}

export default function TutorDashboard() {
  const { auth, isInitialized } = useAuth();
  const tutor = useTutorIdentity();
  const adminEmail = String(auth.account?.email || '').trim().toLowerCase();

  // Whose workspace to load. An administrator has no teaching of their own, so
  // they pick a tutor and the page asks about that identity instead — the same
  // email/name pair, just somebody else's. A tutor's own account is unchanged.
  const email = tutor.isViewingAsTutor ? tutor.viewingEmail : auth.account?.email || '';
  // The name a curriculum tutor profile and a module's tutor_name are matched
  // against when no email lines up. For a tutor added under Curriculum with no
  // address, it is the only thing that identifies them.
  const accountName = tutor.isViewingAsTutor ? tutor.name : auth.account?.displayName || '';

  const [data, setData] = useState<TutorWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isInitialized) return undefined;
    // An admin who has not picked yet is about to be shown the directory, so
    // there is nobody to ask about — and asking about the admin's own account
    // would spend a request to be told what the picker already knows.
    if (tutor.canChooseTutor && !tutor.isViewingAsTutor) {
      setData(null);
      setLoading(false);
      return undefined;
    }
    if (!email && !accountName) {
      setData(null);
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    fetchTutorWorkspace({ email, name: accountName }, controller.signal)
      .then((payload) => setData(payload))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : 'Could not load your workspace.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [email, accountName, isInitialized, tutor.canChooseTutor, tutor.isViewingAsTutor]);

  const heading = useMemo(() => {
    const name = data?.tutor?.name || auth.account?.displayName || 'Tutor';
    return name.split(' ')[0] || name;
  }, [data, auth.account]);

  const modules = data?.modules ?? [];

  // Before a tutor is chosen there is nothing to load: an admin gets one card
  // per tutor rather than their own empty workspace and the "not linked"
  // notice, which is true of the admin's account but useless to them.
  if (tutor.canChooseTutor && !tutor.isViewingAsTutor) {
    return (
      <WorkspaceShell
        role="tutor"
        roleLabel={tutorNav.label}
        navItems={tutorNav.items}
        workspaceLabel={tutorNav.workspaceLabel}
        pageTitle="Tutor Workspace"
        pageSubtitle="Choose a tutor to open their workspace"
        userName={auth.account?.displayName || auth.user?.fullName || 'Administrator'}
        userRole="Administrator"
      >
        <div className="tutor-workspace-page mx-auto max-w-5xl space-y-5 p-3 md:p-6">
          <TutorDirectoryPicker
            onSelect={selected => setTutorViewAs({ email: selected.email, name: selected.name }, adminEmail)}
          />
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      role="tutor"
      roleLabel={tutorNav.label}
      navItems={tutorNav.items}
      workspaceLabel={tutorNav.workspaceLabel}
      pageTitle={loading ? 'Loading your modules…' : `Good morning, ${heading}`}
      pageSubtitle={
        modules.length
          ? `${modules.length} module${modules.length === 1 ? '' : 's'} assigned to you`
          : 'Your assigned modules and next session'
      }
      userName={data?.tutor?.name || auth.account?.displayName || 'Tutor'}
      userRole="Tutor"
    >
      <div className="tutor-workspace-page mx-auto max-w-5xl space-y-5 p-3 md:p-6">
        {/* Whose workspace this is, and the way back to the other cards. The
            modules below are that tutor's own — the admin is reading their
            workspace, not a copy of it. */}
        {tutor.isViewingAsTutor && (
          <div className="flex items-center gap-3 rounded-xl border border-primary-200/70 bg-primary-50/60 p-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-600">
              <AppIcon className="ri-eye-line text-sm" />
            </span>
            <p className="min-w-0 flex-1 text-[12.5px] text-primary-900">
              Viewing <strong className="font-semibold">{tutor.name || tutor.viewingEmail}</strong>&rsquo;s
              workspace. Read-only.
            </p>
            <button
              type="button"
              onClick={clearTutorViewAs}
              className="shrink-0 cursor-pointer rounded-lg border border-primary-300 px-2.5 py-1 text-[11px] font-semibold text-primary-700 transition-smooth hover:bg-primary-100"
            >
              All tutors
            </button>
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
            <RowsSkeleton rows={3} />
          </div>
        ) : loadError ? (
          <section className="rounded-2xl border border-red-200 bg-red-50/70 p-6 text-center">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 text-red-600">
              <AppIcon className="ri-error-warning-line text-xl" />
            </span>
            <h2 className="font-heading text-base font-bold text-foreground-900">Could not load your workspace</h2>
            <p className="mx-auto mt-2 max-w-md text-[13px] text-foreground-600">{loadError}</p>
          </section>
        ) : !data?.linked ? (
          <UnlinkedNotice email={email} name={accountName} viewingAsTutor={tutor.isViewingAsTutor} />
        ) : (
          <>
            {data.nextSession ? (
              <NextSessionCard session={data.nextSession} />
            ) : (
              <section className="rounded-2xl border border-foreground-200/60 bg-background-50 p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background-100 text-foreground-400">
                    <AppIcon className="ri-calendar-line text-lg" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-heading text-[15px] font-bold text-foreground-900">No upcoming session scheduled</h2>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-foreground-500">
                      {modules.length
                        ? 'None of your modules has a future live session on its schedule. Sessions are created against a module in the curriculum builder.'
                        : 'You have no modules assigned yet, so there is nothing scheduled.'}
                    </p>
                  </div>
                </div>
              </section>
            )}

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-heading text-base font-semibold text-foreground-900">Your modules</h2>
                {modules.length > 0 && (
                  <span className="text-[11px] text-foreground-400">
                    {modules.length} assigned
                  </span>
                )}
              </div>
              {modules.length === 0 ? (
                <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-6 text-center">
                  <p className="text-[13px] text-foreground-500">
                    No modules are assigned to you yet. An administrator assigns them
                    in Curriculum → Staff profiles.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {modules.map((module) => (
                    <ModuleCard key={module.moduleCatalogueId} module={module} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}
