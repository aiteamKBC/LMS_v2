import { type StaffUserRow } from '@/api/staffUsers';
import { type EmployerRow } from '@/api/employers';
import type { UserListRow, UsersFilter } from './types';

// The learning plan is only editable once the three onboarding reviews are
// signed and the learner has moved into delivery — see the backend's
// promote_to_delivery_if_ready.
export const DELIVERY_STATUS = 'Delivery';


/** Statuses whose learning plan can still be changed from the enrolment
 *  directory. Delivery is the planning stage, but a plan is not frozen when
 *  teaching starts: modules get added, swapped or corrected mid-programme, and
 *  an enrolment officer had no way to do it without moving the learner
 *  backwards. 'On break' is included for the same reason Shift module includes
 *  it — a paused learner is still on a programme.
 *
 *  Anything else (Withdrawn, Completed, EnteredEpa, Onboarding) opens the plan
 *  read-only: those plans are history or not yet started. */
export const PLAN_EDITABLE_STATUSES: string[] = [DELIVERY_STATUS, 'Active', 'On break'];


/**
 * A directory row. Learner rows are plain UserListRows; staff rows carry the
 * extra Staff_users columns the edit modal prefills from, so the list holds the
 * union and narrows on `source === 'staff'`.
 */
export type DirectoryRow = UserListRow & Partial<StaffUserRow> & { employer?: EmployerRow };


/**
 * Whether a directory row is a learner record.
 *
 * Keyed on `source` — which table the row came from — and never on the Type
 * column. Type is an editable label on the learner row (User, Referrer,
 * Caseowner...), so reading "is this a learner" off it meant relabelling
 * somebody silently took away their programme, their learning plan, their
 * status badge and every action on the row, including the Edit button needed to
 * put it back. What a row *is* cannot be a field somebody can type over.
 */
export function isLearnerRow(row: Pick<UserListRow, 'source'>): boolean {
  return row.source !== 'staff' && row.source !== 'employer';
}


/** Keep Created_users records by their physical identity, never by email.
 * The first occurrence wins so an imported replacement can precede old state.
 * Staff/employer sources are not independent records in this directory.
 */
export function mergeDirectoryRows(rows: DirectoryRow[]): DirectoryRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (!isLearnerRow(row) || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

/** Summary categories use Created_users.Type, never another table's role. */
export function directoryCategory(row: DirectoryRow): 'admins' | 'employers' | 'learners' {
  if (!differs(row.type, 'Admin')) return 'admins';
  if (!differs(row.type, 'Employer')) return 'employers';
  return 'learners';
}


/** True when a row value doesn't match a chosen filter value, ignoring case/padding. */
export function differs(rowValue: string | undefined, filterValue: string): boolean {
  return (rowValue ?? '').trim().toLowerCase() !== filterValue.trim().toLowerCase();
}


/** The role(s) a row's Type column names, split back out of a merged row's
 *  "Admin · User" for filtering and options -- an ordinary row has exactly
 *  one. */
export function rowTypes(row: Pick<DirectoryRow, 'type'>): string[] {
  return (row.type || '').split(' · ').map((s) => s.trim()).filter(Boolean);
}


export function matches(row: DirectoryRow, f: UsersFilter): boolean {
  if (f.userName && !row.name.toLowerCase().includes(f.userName.toLowerCase())) return false;
  if (f.email && !row.email.toLowerCase().includes(f.email.toLowerCase())) return false;
  // Folded like programme/cohort below: group names can now come from the
  // curriculum lookup rather than only from the rows themselves.
  if (f.groups && f.groups.length > 0 && !f.groups.some((g) => !differs(row.group, g))) return false;
  if (f.statuses && f.statuses.length > 0 && !f.statuses.includes(row.subscriptionStatus)) return false;
  // A merged row's type is the two roles joined ("Admin · User"), so an exact
  // match would make it invisible under either filter option. Split and check
  // membership instead, which also matches an ordinary single-role row exactly
  // as before.
  if (f.type && f.type !== 'all' && !rowTypes(row).includes(f.type)) return false;
  // Programme and cohort are picked from the curriculum lists, but the values on
  // the row were written as free text at create time, so both sides are folded
  // before comparing — casing drift on an older row shouldn't empty the results.
  if (f.programme && differs(row.programme, f.programme)) return false;
  if (f.cohort && differs(row.cohort, f.cohort)) return false;
  if (f.programmeStatus && (row.programmeStatus ?? '') !== f.programmeStatus) return false;
  // 'any' is the unset value here, not '' — the select's own placeholder. Owner
  // names are free text on the row like programme and cohort, so they are
  // compared the same folded way.
  if (f.caseOwner && f.caseOwner !== 'any' && differs(row.caseOwner, f.caseOwner)) return false;
  if (f.referenceNumber && !(row.reference ?? '').toLowerCase().includes(f.referenceNumber.toLowerCase())) return false;
  return true;
}
