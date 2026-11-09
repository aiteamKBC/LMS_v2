/**
 * A group's coaches.
 *
 * A group may have several coaches (curriculum.group_coaches). The API keeps
 * `coach` as the one display string, the names joined with ", ", and adds a
 * `coaches` list; writes may send either, because the backend splits the
 * joined string the same way. These helpers are the one place that knows the
 * separator, so a list a screen builds and a label it shows always agree.
 */

export const COACH_SEPARATOR = ', ';

const NOBODY = new Set(['', 'unassigned', 'none', 'n/a']);

/** The coach names in a group's `coaches` list or joined `coach` string, without blanks or repeats. */
export function groupCoachNames(value?: string | readonly string[] | null): string[] {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
  const seen = new Set<string>();
  const names: string[] = [];
  parts.forEach(part => {
    const name = String(part ?? '').trim();
    const key = name.toLocaleLowerCase();
    if (NOBODY.has(key) || seen.has(key)) return;
    seen.add(key);
    names.push(name);
  });
  return names;
}

/** The names as the one `coach` string a group save sends ('' = nobody). */
export function joinCoachNames(names: readonly string[]): string {
  return groupCoachNames(names).join(COACH_SEPARATOR);
}

/** Every coach of a group: its `coaches` list when the API sent one, else its `coach` string split. */
export function coachesOfGroup(group: { coach?: string | null; coaches?: readonly string[] | null }): string[] {
  return groupCoachNames(group.coaches?.length ? group.coaches : group.coach);
}

/** True when `name` is one of the group's coaches (case-insensitive). */
export function groupHasCoach(group: { coach?: string | null; coaches?: readonly string[] | null }, name: string): boolean {
  const wanted = String(name ?? '').trim().toLocaleLowerCase();
  return Boolean(wanted) && coachesOfGroup(group).some(coach => coach.toLocaleLowerCase() === wanted);
}
