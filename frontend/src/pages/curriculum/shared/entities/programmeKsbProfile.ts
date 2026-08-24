import {
  createCurriculumKsbFramework,
  fetchCurriculumKsbSets,
  type CurriculumKsbSet,
} from '@/lib/curriculumApi';
import { cleanText, normaliseKey } from './model';

/**
 * The one empty KSB profile a programme can be parked on.
 *
 * A programme with no applied source is not usable: its modules have no codes to
 * map against and coverage cannot be measured. But an empty profile per
 * programme is not the answer either — it fills the KSB Frameworks list with a
 * row per programme that nobody authored and nobody wanted. There is one, shared,
 * and it is assigned to whichever programmes have no real source yet.
 *
 * Empty on purpose, and it stays empty: the knowledge, skills and behaviours of
 * a real standard are authored as their own profile on the KSB Frameworks page.
 * Codes added to this one would be inherited by every programme parked on it, so
 * it is a placeholder to move off, not a profile to fill in.
 */
export const SHARED_EMPTY_KSB_PROFILE_NAME = 'Empty KSB profile';

const SHARED_EMPTY_KSB_PROFILE_NOTE = 'Placeholder for programmes that have no KSB source yet. '
  + 'Author each programme’s real knowledge, skills and behaviours as its own profile, then apply that instead.';

/** The identity the programme card and the picker match a profile on. */
function profileSourceId(set: CurriculumKsbSet): string {
  return cleanText(set.frameworkId) || cleanText(set.ksbProfileId) || cleanText(String(set.profileId ?? ''));
}

function findSharedEmptyProfile(sets: CurriculumKsbSet[]): CurriculumKsbSet | undefined {
  const wanted = normaliseKey(SHARED_EMPTY_KSB_PROFILE_NAME);
  return sets.find(set => normaliseKey(set.standard) === wanted || normaliseKey(set.programmeName) === wanted);
}

/**
 * Find the shared empty profile, creating it the first time it is needed.
 *
 * Created once and then reused: the name is what identifies it, and a framework
 * name is unique, so a 409 here means another writer got there first — which is
 * a hit, not a failure, and the refetch below picks it up.
 *
 * No programme is linked at creation. The assignment is a separate step, done
 * through the same path as applying any other source, so a programme parked here
 * is linked and unlinked exactly like one on a real profile.
 *
 * Returns the id to apply, plus the KSB sets it was found in — freshly fetched
 * when the profile had to be created, so the caller can apply it straight away
 * instead of waiting for its own state to catch up.
 */
export async function ensureSharedEmptyKsbProfile(
  sets: CurriculumKsbSet[],
): Promise<{ frameworkId: string; sets: CurriculumKsbSet[]; created: boolean }> {
  const existing = findSharedEmptyProfile(sets);
  if (existing) return { frameworkId: profileSourceId(existing), sets, created: false };

  let created = true;
  try {
    await createCurriculumKsbFramework({
      name: SHARED_EMPTY_KSB_PROFILE_NAME,
      description: SHARED_EMPTY_KSB_PROFILE_NOTE,
      notes: SHARED_EMPTY_KSB_PROFILE_NOTE,
      isActive: true,
      ksbItems: [],
      knowledgeCodes: [],
      skillCodes: [],
      behaviourCodes: [],
    });
  } catch (err) {
    // Anything other than "that name is taken" is a real failure. A taken name
    // is the profile already existing, which is the outcome being asked for.
    const status = (err as { status?: number } | null)?.status;
    if (status !== 409) throw err;
    created = false;
  }

  const nextSets = await fetchCurriculumKsbSets(undefined, { all: true });
  const profile = findSharedEmptyProfile(nextSets);
  const frameworkId = profile ? profileSourceId(profile) : '';
  if (!frameworkId) throw new Error('The empty KSB profile could not be created.');
  return { frameworkId, sets: nextSets, created };
}
