import { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchStaffUsers } from '@/api/staffUsers';
import { fetchCurriculumTutors } from '@/lib/curriculumApi';

const EMPTY_VALUE = '--';
const TUTOR_ACCESS = 'tutor';

export interface DirectoryTutor {
  id: string;
  name: string;
  /** May be blank: a curriculum tutor profile does not have to carry one. */
  email: string;
  jobTitle: string;
  /** Delivery modules the curriculum assigns them, and their groups. */
  moduleCount: number;
  groupCount: number;
  inProgressCount: number;
  /** True when an account holds Tutor access — they can sign in themselves. */
  hasAccount: boolean;
}

function initials(name: string, email: string) {
  const source = name.trim() || email.split('@')[0].replace(/[._-]+/g, ' ');
  const parts = source.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return `${first}${last}`.toUpperCase();
}

function matches(tutor: DirectoryTutor, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${tutor.name} ${tutor.email} ${tutor.jobTitle}`.toLowerCase().includes(needle);
}

function toCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

/**
 * The tutor an administrator is opening the workspace as.
 *
 * Two sources, unioned, because "every tutor" means two overlapping things here
 * and showing only one of them hides real people:
 *
 *  - the curriculum's tutor profiles — everybody added under Curriculum ->
 *    Staff profiles, which is where module assignments actually live;
 *  - the accounts holding Tutor access — everybody who can sign in as a tutor,
 *    including someone nobody has given a profile yet.
 *
 * Unlike the coach directory, a profile without a login account is still worth a
 * card: the workspace endpoint resolves a tutor by email OR by name, and the
 * modules themselves carry a tutor name — so an admin can open the workspace of
 * a tutor who has never signed in, which is exactly the person whose timetable
 * nobody else can see. Rows are deduplicated by address first, then by name.
 */
export function TutorDirectoryPicker({ onSelect }: { onSelect: (tutor: DirectoryTutor) => void }) {
  const [tutors, setTutors] = useState<DirectoryTutor[]>([]);
  const [countsAvailable, setCountsAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      // Settled, not all-or-nothing: either source failing should cost its own
      // rows, not the whole list. Both failing is the only real error.
      const [profileResult, staffResult] = await Promise.allSettled([
        fetchCurriculumTutors(),
        fetchStaffUsers(),
      ]);
      if (cancelled) return;

      if (profileResult.status === 'rejected' && staffResult.status === 'rejected') {
        const reason = profileResult.reason;
        setTutors([]);
        setError(reason instanceof Error ? reason.message : 'Unable to load the tutor list.');
        setLoading(false);
        return;
      }

      const profiles = profileResult.status === 'fulfilled' ? profileResult.value : [];
      const staff = staffResult.status === 'fulfilled' ? staffResult.value : [];

      const merged: DirectoryTutor[] = [];
      const seenEmail = new Set<string>();
      const seenName = new Set<string>();

      const add = (tutor: DirectoryTutor) => {
        const nameKey = tutor.name.trim().toLowerCase();
        if (tutor.email && seenEmail.has(tutor.email)) return;
        if (!tutor.email && nameKey && seenName.has(nameKey)) return;
        if (tutor.email) seenEmail.add(tutor.email);
        if (nameKey) seenName.add(nameKey);
        merged.push(tutor);
      };

      // Profiles first: they carry the teaching load, and a card is more useful
      // showing that than showing an account with nothing attached to it.
      for (const profile of profiles) {
        const email = String(profile.email || '').trim().toLowerCase();
        const name = String(profile.name || '').trim();
        if (!email && !name) continue;
        add({
          id: `profile-${String(profile.id ?? (name || email))}`,
          name: name || email,
          email,
          jobTitle: String(profile.jobTitle || '').trim(),
          moduleCount: toCount(profile.moduleCount),
          groupCount: toCount(profile.groupCount),
          inProgressCount: toCount(profile.inProgressCount),
          hasAccount: false,
        });
      }

      // Then the accounts, which fill in anyone with Tutor access and no profile
      // — and mark the profiles that do have an account behind them.
      for (const row of staff) {
        if (String(row.access || '').trim().toLowerCase() !== TUTOR_ACCESS) continue;
        const email = String(row.email || '').trim().toLowerCase();
        const name = String(row.name || '').trim();
        if (!email && !name) continue;
        const existing = merged.find(
          tutor => (email && tutor.email === email)
            || (!!name && tutor.name.trim().toLowerCase() === name.toLowerCase()),
        );
        if (existing) {
          existing.hasAccount = true;
          // A profile with no address, matched by name, gains the account's —
          // which is what the workspace will prefer when it resolves them.
          if (!existing.email && email) existing.email = email;
          continue;
        }
        add({
          id: `account-${row.id}`,
          name: name || email,
          email,
          jobTitle: String(row.position || '').trim(),
          moduleCount: 0,
          groupCount: 0,
          inProgressCount: 0,
          hasAccount: true,
        });
      }

      setTutors(merged);
      // The counts come from the profiles alone, so their absence is what makes
      // the numbers meaningless rather than merely zero.
      setCountsAvailable(profileResult.status === 'fulfilled');
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => tutors.filter(tutor => matches(tutor, search)), [tutors, search]);

  return (
    <section className="rounded-[24px] border border-foreground-200/70 bg-background-50/95 p-4 md:p-6 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.28)]">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-heading font-semibold text-foreground-900">Open a tutor workspace</h2>
          <p className="mt-1 text-sm text-foreground-400">
            One card per tutor. Open one to see the modules they deliver and their next
          session, exactly as they do.
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search name or email..."
            className="w-full rounded-lg border border-background-200 bg-background-50 py-2 pl-9 pr-3 text-sm text-foreground-800 placeholder-foreground-400 focus:border-primary-400 focus:outline-none"
          />
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map(key => (
            <div key={key} className="h-[132px] animate-pulse rounded-2xl border border-foreground-200/60 bg-background-100/60" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">{error}</div>
      )}

      {!loading && !error && !tutors.length && (
        <div className="rounded-xl border border-foreground-200/60 bg-background-100/40 p-6 text-center text-sm text-foreground-400">
          No tutors yet. Add them under Curriculum &rarr; Staff profiles, or grant an account
          Tutor access from the Users directory, and they will appear here.
        </div>
      )}

      {!loading && !error && tutors.length > 0 && !filtered.length && (
        <div className="rounded-xl border border-foreground-200/60 bg-background-100/40 p-6 text-center text-sm text-foreground-400">
          No tutor matches &ldquo;{search.trim()}&rdquo;.
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map(tutor => (
              <button
                key={tutor.id}
                type="button"
                onClick={() => onSelect(tutor)}
                className="group flex cursor-pointer flex-col gap-3 rounded-2xl border border-foreground-200/60 bg-background-50 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-[0_18px_40px_-28px_rgba(15,23,42,0.35)] focus:outline-none focus-visible:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-200"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-bold text-primary-700">
                    {initials(tutor.name, tutor.email)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground-900">{tutor.name || tutor.email}</p>
                    <p className="truncate text-[11px] text-foreground-400">
                      {tutor.email || 'No address — opened by name'}
                    </p>
                    {tutor.jobTitle && (
                      <p className="truncate text-[10px] text-foreground-300">{tutor.jobTitle}</p>
                    )}
                  </div>
                  <AppIcon className="ri-arrow-right-line mt-1 shrink-0 text-foreground-300 transition-colors group-hover:text-primary-500" />
                </div>

                <div className="flex items-center gap-4 border-t border-foreground-200/50 pt-3 text-[11px] text-foreground-500">
                  <span className="flex items-center gap-1.5">
                    <AppIcon className="ri-book-open-line text-foreground-400" />
                    <strong className="font-semibold text-foreground-800">
                      {countsAvailable ? tutor.moduleCount : EMPTY_VALUE}
                    </strong>
                    modules
                  </span>
                  <span className="flex items-center gap-1.5">
                    <AppIcon className="ri-group-line text-foreground-400" />
                    <strong className="font-semibold text-foreground-800">
                      {countsAvailable ? tutor.groupCount : EMPTY_VALUE}
                    </strong>
                    groups
                  </span>
                </div>
              </button>
            ))}
          </div>

          {!countsAvailable && (
            <p className="mt-4 text-[11px] text-foreground-400">
              Teaching numbers are unavailable right now. The tutor list itself is current.
            </p>
          )}
        </>
      )}
    </section>
  );
}
