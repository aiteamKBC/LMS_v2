// ============================================================================
// First sessions — enrolment workspace
//
// Every learner's first learning session booking: when they booked it, when the
// session is, who it is with and its Teams join link. Read only — nothing here
// books, moves or cancels a meeting.
//
// All bookings are listed, cancelled and failed-to-sync ones too; the status
// column says which, so a booking Microsoft never accepted is not mistaken for
// a working meeting. Filters live in the URL so a filtered view can be shared.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataPanel } from '@/pages/admin/_shared/AdminPage';
import { EnrolmentPage as AdminPage } from '../presentation/EnrolmentPage';
import styles from './sessions.module.css';
import motion from '../presentation/EnrolmentMotion.module.css';
import { AppIcon } from '@/components/feature/AppIcon';
import { SelectMenu } from '@/components/feature/SelectField';
import { DatePickerField } from '@/components/feature/DatePickerField';
import design from '../presentation/EnrolmentWorkspace.module.css';
import { formatSystemTimestamp } from '@/lib/format';
import {
  FILTER_KEYS,
  caseOwnerOptions,
  fetchFirstSessionBookings,
  filterFirstSessionBookings,
  programmeOptions,
  type FirstSessionBooking,
  type FirstSessionBookingFilters,
} from '@/api/firstSessionBookings';

type Tone = 'ok' | 'bad' | 'warn' | 'neutral';

const STATE_LABELS: Record<string, { label: string; tone: Tone }> = {
  scheduled: { label: 'Scheduled', tone: 'ok' },
  'in-progress': { label: 'In progress', tone: 'ok' },
  requested: { label: 'Awaiting approval', tone: 'warn' },
  'awaiting-signature': { label: 'Awaiting signature', tone: 'warn' },
  completed: { label: 'Completed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
  'sync-pending': { label: 'Teams sync pending', tone: 'warn' },
  'sync-failed': { label: 'Teams sync failed', tone: 'bad' },
  'needs-reconciliation': { label: 'Needs reconciliation', tone: 'warn' },
};

const HIDDEN_STATUS_FILTERS = new Set(['requested', 'in-progress', 'awaiting-signature', 'completed', 'cancelled']);

function stateBadge(state: string) {
  return STATE_LABELS[state] ?? { label: state.replace(/-/g, ' ') || 'Unknown', tone: 'neutral' as Tone };
}

/** A UK calendar day, shown as the day it is — no time-zone conversion. */
function formatDay(value: string | null): string {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function formatBookedAt(value: string | null): string {
  if (!value) return '—';
  return formatSystemTimestamp(value, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) || '—';
}

function learnerInitials(booking: FirstSessionBooking): string {
  return (booking.learnerName.trim() || booking.learnerEmail).split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
}

export default function FirstSessionBookingsPage() {
  const [params, setParams] = useSearchParams();
  const [bookings, setBookings] = useState<FirstSessionBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchFirstSessionBookings(controller.signal)
      .then(data => setBookings(data.results))
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load first-session bookings.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [version]);

  const filters = useMemo(
    () => Object.fromEntries(FILTER_KEYS.map(key => [key, params.get(key) || ''])) as unknown as FirstSessionBookingFilters,
    [params],
  );
  const selectedState = params.get('state') || '';
  const filtering = FILTER_KEYS.some(key => filters[key]) || Boolean(selectedState);
  const filtered = useMemo(() => filterFirstSessionBookings(bookings, filters), [bookings, filters]);
  const shown = useMemo(() => filtered.filter(booking => !selectedState || booking.state === selectedState), [filtered, selectedState]);
  const states = useMemo(() => [...new Set(['scheduled', ...bookings.map(booking => booking.state), ...(selectedState ? [selectedState] : [])])]
    .filter(state => !HIDDEN_STATUS_FILTERS.has(state)), [bookings, selectedState]);
  const owners = useMemo(() => caseOwnerOptions(bookings), [bookings]);
  const programmes = useMemo(() => programmeOptions(bookings), [bookings]);

  const setFilter = useCallback((key: keyof FirstSessionBookingFilters | 'state', value: string) => {
    setParams(current => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  }, [setParams]);

  const clearFilters = () => setParams(current => {
    const next = new URLSearchParams(current);
    FILTER_KEYS.forEach(key => next.delete(key));
    next.delete('state');
    return next;
  }, { replace: true });

  return (
    <AdminPage
      workspaceRole="compliance"
      title="First sessions"
      subtitle="Learners who have booked their first learning session"
      icon="ri-calendar-check-line"
      heroTitle="First sessions"
      heroClassName={styles.hero}
      directoryLayout
      heroBlurb="Every first-session booking — when the learner booked it, when the session is, and its Teams link. Cancelled and past bookings are included."
      heroMetadata={<p className={styles.summary}>
        {loading ? 'Loading first sessions…' : error ? 'Session summary unavailable' : <>
          <span className={styles.summaryBadge}><span aria-hidden="true" />{bookings.filter(booking => booking.state === 'scheduled').length} scheduled</span>
          <span>{bookings.length} bookings · {bookings.filter(booking => booking.state === 'requested').length} awaiting approval · {bookings.filter(booking => booking.state === 'completed').length} completed</span>
        </>}
      </p>}
    >
      <p className={styles.infoStrip}><AppIcon name="ri-eye-line" size={16} aria-hidden="true" />Booking and Teams sync statuses are shown as recorded. A booking does not confirm that all attendees have accepted.</p>
      <form
        aria-label="Filter first-session bookings"
        onSubmit={event => event.preventDefault()}
        className={`${styles.filters} ${motion.sectionEnter}`}
      >
        <div className={styles.filterFields}>
        <div className={styles.selectFilter}>
          <label htmlFor="first-sessions-case-owner">Case owner</label>
          <SelectMenu id="first-sessions-case-owner" ariaLabel="Case owner" value={filters.caseOwner} onChange={value => setFilter('caseOwner', value)}
            options={[{ value: '', label: 'All case owners' }, ...owners]} size="sm" searchPlaceholder="Search case owners…"
            triggerClassName={styles.selectTrigger} menuClassName={`${design.shellFont} ${design.filterSelectMenu}`} />
        </div>
        <div className={styles.selectFilter}>
          <label htmlFor="first-sessions-programme">Programme</label>
          <SelectMenu id="first-sessions-programme" ariaLabel="Programme" value={filters.programme} onChange={value => setFilter('programme', value)}
            options={[{ value: '', label: 'All programmes' }, ...programmes.map(programme => ({ value: programme, label: programme }))]} size="sm" searchPlaceholder="Search programmes…"
            triggerClassName={styles.selectTrigger} menuClassName={`${design.shellFont} ${design.filterSelectMenu}`} />
        </div>
        <fieldset>
          <legend className="sr-only">Session date</legend>
          <DatePickerField label="Session from" value={filters.sessionFrom} max={filters.sessionTo || undefined} onChange={value => setFilter('sessionFrom', value)}
            className={styles.dateFilter} panelClassName={`${design.shellFont} ${styles.datePanel}`} />
          <DatePickerField label="Session to" value={filters.sessionTo} min={filters.sessionFrom || undefined} onChange={value => setFilter('sessionTo', value)}
            className={styles.dateFilter} panelClassName={`${design.shellFont} ${styles.datePanel}`} />
        </fieldset>
        <fieldset>
          <legend className="sr-only">Booked-on date</legend>
          <DatePickerField label="Booked from" value={filters.bookedFrom} max={filters.bookedTo || undefined} onChange={value => setFilter('bookedFrom', value)}
            className={styles.dateFilter} panelClassName={`${design.shellFont} ${styles.datePanel}`} />
          <DatePickerField label="Booked to" value={filters.bookedTo} min={filters.bookedFrom || undefined} onChange={value => setFilter('bookedTo', value)}
            className={styles.dateFilter} panelClassName={`${design.shellFont} ${styles.datePanel}`} />
        </fieldset>
        </div>
        <div className={styles.filterFooter}>
        <p aria-live="polite">{loading ? 'Loading first sessions…' : error ? 'First sessions could not be loaded.' : <>Showing <strong>{shown.length}</strong> of <strong>{bookings.length}</strong> sessions</>}</p>
        <button
          type="button"
          onClick={clearFilters}
          disabled={!filtering}
          className={styles.clearFilters}
        >
          <AppIcon name="ri-close-line" size={14} aria-hidden="true" />
          Clear filters
        </button>
        </div>
      </form>

      <div className={styles.statusFilters} role="group" aria-label="Filter by session status">
        {['', ...states].map(state => <button key={state} type="button" aria-pressed={selectedState === state} onClick={() => setFilter('state', state)}>
          {state ? stateBadge(state).label : 'All'}{' '}<span>{loading || error ? '—' : state ? filtered.filter(booking => booking.state === state).length : filtered.length}</span>
        </button>)}
      </div>

      <div className={`${styles.results} ${motion.sectionEnter}`}>
      <DataPanel
        loading={loading}
        error={error}
        empty={shown.length === 0}
        emptyMessage={filtering ? 'No first-session bookings match these filters.' : 'No first-session bookings yet.'}
        emptyIcon="ri-calendar-line"
        onRetry={() => setVersion(value => value + 1)}
      >
        <div className={styles.sessionTable}>
            <table role="table">
              <caption className="sr-only">First-session bookings</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col">Learner</th>
                  <th scope="col">Programme</th>
                  <th scope="col">Case owner</th>
                  <th scope="col">Booked on</th>
                  <th scope="col">Session date</th>
                  <th scope="col">Session time</th>
                  <th scope="col">Status</th>
                  <th scope="col">Meeting</th>
                </tr>
              </thead>
              <tbody role="rowgroup" className={motion.staggerRows}>
                {shown.map(booking => {
                  const badge = stateBadge(booking.state);
                  return (
                    <tr role="row" key={booking.id}>
                      <td role="cell" data-label="Learner">
                        <span className={styles.avatar} data-color={booking.id % 3} aria-hidden="true">{learnerInitials(booking)}</span>
                        <div className={styles.learnerCopy}>
                        {booking.learnerId !== null ? (
                          <Link
                            to={`/users/${booking.learnerId}${booking.source === 'commercial' ? '?source=commercial' : ''}`}
                            className="font-medium text-foreground-800 hover:text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200 rounded"
                          >
                            {booking.learnerName || booking.learnerEmail || 'Unnamed learner'}
                          </Link>
                        ) : (
                          <span className="font-medium text-foreground-800">{booking.learnerName || booking.learnerEmail || 'Unknown learner'}</span>
                        )}
                        {booking.learnerEmail && <div className="text-[11px] text-foreground-500">{booking.learnerEmail}</div>}
                        </div>
                      </td>
                      <td role="cell" data-label="Programme">{booking.programme || '—'}</td>
                      <td role="cell" data-label="Case owner">
                        {booking.caseOwner.name || booking.caseOwner.email || '—'}
                      </td>
                      <td role="cell" data-label="Booked on">{formatBookedAt(booking.bookedAt)}</td>
                      <td role="cell" data-label="Session date">
                        <span>{formatDay(booking.sessionDate)}</span>
                      </td>
                      <td role="cell" data-label="Session time">{booking.sessionTime ? `${booking.sessionTime} UK time${booking.durationMinutes ? ` · ${booking.durationMinutes} min` : ''}` : '—'}</td>
                      <td role="cell" data-label="Status"><span className={styles.status} data-tone={badge.tone}><span aria-hidden="true" />{badge.label}</span></td>
                      <td role="cell" data-label="Meeting">
                        {booking.meetingLink ? (
                          <a
                            href={booking.meetingLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open Teams meeting for ${booking.learnerName || booking.learnerEmail || 'learner'}`}
                            className={styles.joinLink}
                          >
                            <AppIcon name="ri-vidicon-line" aria-hidden="true" />
                            Join link
                          </a>
                        ) : (
                          <span className="text-foreground-400">No link</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
        </div>
      </DataPanel>
      </div>
    </AdminPage>
  );
}
