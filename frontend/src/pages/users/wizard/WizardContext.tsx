import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  fetchExtendedIlr,
  peekExtendedIlr,
  saveExtendedIlr,
  type ExtendedIlrResponse,
  type LearnerKind,
} from '@/api/extendedIlr';
import { uploadEnrolmentDocument } from '@/api/enrolmentDocuments';
import { fetchKsbProfile } from '@/api/curriculum';
import { ilrDocumentBlob, ilrDocumentFilename } from './steps/ilrDocument';
import { WIZARD_STEPS, type EnrolmentBoard, type IlrForm, type Ksb, type WizardDraft } from '../types';

/** DD/MM/YYYY -> YYYY-MM-DD (for native date inputs); returns '' if unparseable. */
export function ddmmToIso(s?: string): string {
  if (!s) return '';
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

/**
 * Whole years between a YYYY-MM-DD date of birth and today.
 *
 * Age is derived, never typed: the field is read-only in Personal Details, so
 * this is the only thing that sets it. Computed from date parts rather than a
 * millisecond difference so leap years and DST can't shift a birthday.
 * `undefined` for anything not usable — unparseable, a future date, or a value
 * so old it must be a typo — which leaves the step's required-check failing
 * rather than showing a nonsense age.
 */
export function ageFromDob(iso?: string): number | undefined {
  if (!iso) return undefined;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dob = new Date(y, mo - 1, d);
  // Rejects impossible calendar dates (31 Feb rolls over to March).
  if (dob.getFullYear() !== y || dob.getMonth() !== mo - 1 || dob.getDate() !== d) return undefined;
  const now = new Date();
  let age = now.getFullYear() - y;
  // Birthday hasn't come round yet this year.
  if (now.getMonth() < mo - 1 || (now.getMonth() === mo - 1 && now.getDate() < d)) age -= 1;
  if (age < 0 || age > 120) return undefined;
  return age;
}

function emptyIlr(firstNames: string, surname: string): IlrForm {
  return {
    contact: { byPost: null, byPhone: null, byEmail: null },
    nextOfKin: { fullName: '', relationship: '', email: '', phone: '', sameAddressAsLearner: null },
    eligibility: {
      employedInEngland: null, countryOfResidence: '', ukEeaNational: null, nationality: '',
      residentPrev3Years: null, yearsInUk: undefined, requiresWorkPermit: null, evidenceDescription: '', evidenceFiles: [],
    },
    employer: { organisationName: '', postcode: '', address: '', city: '', lineManagerName: '', lineManagerEmail: '', lineManagerPhone: '' },
    otherTraining: { attended12m: null, completedWhen: '' },
    circumstances: { caringResponsibilities: '', other: '', careLeaver: null },
    understanding: { programmeUnderstanding: '', careerProgression: '' },
    additional: { aged16to18: null, aged19to24: null },
    media: { consent: null },
    declarations: {
      plrShared: null, dfeContact: null, epaoDetails: null, kbcHoldsCerts: null, infoAccurate: null,
      over50PercentEngland: null, wageRateBand: '', knownByOtherName: null, plrAccessAware: null,
    },
    // Pre-fill the declaration name from the learner record; the signature and
    // date stay empty until someone actually signs.
    learnerSignature: { firstNames, surname, date: '' },
    providerSignature: { printName: '', date: '' },
  };
}

function makeInitialDraft(b: EnrolmentBoard): WizardDraft {
  const parts = b.user.name.split(' ');
  const first = parts[0] ?? '';
  const last = parts.slice(1).join(' ');
  const iso = ddmmToIso(b.contact.dob);
  return {
    // Age is derived from the DOB, so a learner whose record already carries one
    // arrives with the field filled — it is read-only and could not be answered
    // by hand otherwise.
    personalDetails: { firstName: first, lastName: last, email: b.contact.email, phone: b.contact.phone, address: '', dob: iso, age: ageFromDob(iso), sex: '' },
    // The standard is resolved from the learner's own programme by the Skills
    // Radar step (curriculum.ksb_profiles), so it isn't seeded to a fixed one.
    skillsRadar: { standardId: '', assessments: {} },
    ilr: emptyIlr(first, last),
    plr: { uln: '', records: [] },
    cvJob: { pmQualifications: '', experienceText: '', functionalSkillsEnrol: '' },
    policies: { acknowledged: {} },
  };
}

/**
 * Fold a saved ILR response onto a seeded draft.
 *
 * Extracted so the synchronous cache seed and the async hydration below cannot
 * drift: a returning learner must get exactly the same draft whether their
 * answers came from memory or from the wire.
 */
function mergeSaved(prev: WizardDraft, res: ExtendedIlrResponse): WizardDraft {
  const next: WizardDraft = { ...prev, ...(res.draft ?? {}) };
  // Merged per-section over the seeded blanks so a step added after this row was
  // saved still gets its defaults instead of coming back undefined.
  if (res.answers) next.ilr = { ...prev.ilr, ...res.answers };
  // Recomputed rather than trusted: a row saved last year carries an age that is
  // now a year out of date, and rows written before age was derived may hold a
  // hand-typed value that never matched the DOB.
  if (next.personalDetails?.dob) {
    next.personalDetails = { ...next.personalDetails, age: ageFromDob(next.personalDetails.dob) };
  }
  return next;
}

interface WizardContextValue {
  userId: string;
  /** Which table this learner lives in — decides where wizard edits are saved. */
  isCommercial: boolean;
  board: EnrolmentBoard;
  draft: WizardDraft;
  setSection: <K extends keyof WizardDraft>(key: K, value: WizardDraft[K]) => void;
  completed: boolean[];
  markComplete: (index: number, done: boolean) => void;
  /**
   * True on the staff side for learner-owned steps (currently the Skills Radar
   * self-assessment): staff review it but must not overwrite the learner's own
   * answers. Set from the provider's `readOnlyLearnerSteps` prop.
   */
  readOnly: boolean;
  /** Persist the Extended ILR answers to enrolment."Extended_ILR". */
  saveIlr: () => Promise<void>;
  ilrSaving: boolean;
  /** Last successful save (ISO), or '' if nothing saved this session. */
  ilrSavedAt: string;
  /**
   * True once the saved answers have been loaded (or the load has failed).
   * Anything that judges completeness — step gating, deep-link guards — must
   * wait for it, or a returning learner is measured against a blank draft.
   *
   * Note this covers the saved answers only. The programme's competencies arrive
   * in a second request after it — see `ready` for the whole picture.
   */
  hydrated: boolean;
  /**
   * True once the draft is actually worth measuring: the saved answers have
   * loaded *and* the programme's competencies have been seeded (or settled as
   * having none).
   *
   * `hydrated` alone is not enough. The Skills Radar's completeness is judged
   * against the seeded assessment rows, and an empty map has nothing unrated in
   * it — so between hydration and seeding the step reads as finished, which both
   * flickered the progress rail and briefly let the gating wave a learner past
   * their own self-assessment.
   */
  ready: boolean;
  /**
   * Render the Extended ILR to PDF and file it in the enrolment-docs container,
   * so it shows up under Compliance documents on the learner's board.
   */
  fileIlrDocument: () => Promise<void>;
  ilrFiling: boolean;
}

const WizardContext = createContext<WizardContextValue | null>(null);

export function WizardProvider({
  userId,
  isCommercial = false,
  board,
  readOnlyLearnerSteps = false,
  children,
}: {
  userId: string;
  isCommercial?: boolean;
  board: EnrolmentBoard;
  /** Set on the staff wizard: learner-owned steps render read-only. */
  readOnlyLearnerSteps?: boolean;
  children: ReactNode;
}) {
  const kindForSeed: LearnerKind = isCommercial ? 'commercial' : 'apprenticeship';
  /**
   * The saved answers, if they are already in memory.
   *
   * The bootstrap primes this cache before the provider mounts, so on a normal
   * open — and on every revisit within the TTL — the wizard can hydrate on its
   * first frame. Read during render rather than in an effect precisely because
   * effects run after paint: hydrating there always cost one visible frame of
   * "Loading your answers…" for a draft that was never actually missing.
   */
  const seed = peekExtendedIlr(kindForSeed, userId);

  const [draft, setDraft] = useState<WizardDraft>(() => {
    const blank = makeInitialDraft(board);
    return seed && (seed.answers || seed.draft) ? mergeSaved(blank, seed) : blank;
  });
  const [completed, setCompleted] = useState<boolean[]>(() => Array(WIZARD_STEPS.length).fill(false));
  const [ilrSaving, setIlrSaving] = useState(false);
  const [ilrSavedAt, setIlrSavedAt] = useState(() => seed?.meta.updatedAt ?? '');
  const [ilrFiling, setIlrFiling] = useState(false);
  // A cache hit means the answers are already in `draft`, so there is nothing to
  // wait for; the effect below still runs and is a no-op on the same payload.
  const [hydrated, setHydrated] = useState(Boolean(seed));
  /** Whether the programme's competencies have been seeded (or settled as none). */
  const [ksbsSettled, setKsbsSettled] = useState(false);

  /**
   * The draft as it was last written to the server (or last read from it).
   *
   * saveIlr writes the whole 8-step draft in one row, so without this every
   * step change fired a full write even when the learner had typed nothing —
   * a step with no inputs at all (Introduction, Next Steps) would still spin
   * "Saving…" on the way out of it. Reference equality is the whole test:
   * every edit goes through setSection, which always builds a new object, so
   * an untouched draft is still the very same object that was saved.
   */
  const lastSavedDraft = useRef<WizardDraft | null>(null);
  // A draft seeded from the cache came off the server, so it is already saved.
  // Without this the learner's first move fired a full write of answers that had
  // not changed — and showed the "Saving…" spinner while doing it.
  if (lastSavedDraft.current === null && seed && (seed.answers || seed.draft)) {
    lastSavedDraft.current = draft;
  }

  const kind: LearnerKind = kindForSeed;

  // Hydrate the previously saved Extended ILR. A learner with nothing saved
  // comes back with answers: null, which leaves the seeded blank form in place.
  useEffect(() => {
    let cancelled = false;
    fetchExtendedIlr(kind, userId)
      .then((res) => {
        if (cancelled || (!res.answers && !res.draft)) return;
        setDraft((prev) => {
          const next = mergeSaved(prev, res);
          // What just came back from the server is, by definition, saved — so
          // opening the wizard and paging through it writes nothing.
          lastSavedDraft.current = next;
          return next;
        });
        setIlrSavedAt(res.meta.updatedAt);
      })
      .catch(() => {
        // A failed load is not fatal — the wizard still opens on a blank form.
      })
      // Flagged in .finally, not .then: a failed load must still release the
      // gating, otherwise the learner is stuck on step one with no way forward.
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, userId]);

  /**
   * Seed an unrated row for every competency on the learner's programme.
   *
   * The Skills Radar's completeness is measured against the assessments held in
   * the draft, and only the step itself knows the KSB list — so without this a
   * learner who never opened that step would have no rows at all and the step
   * would count as finished, letting them tab straight past their own
   * self-assessment. Seeded here rather than in the step because the gating
   * judges every step at once, including ones that have never been rendered.
   *
   * Runs after hydration (the merge above replaces skillsRadar wholesale) and
   * never for staff, who review this step rather than answer it.
   */
  const programmeName = board.programme.name || '';
  useEffect(() => {
    // Staff never seed, and a learner with no programme has nothing to seed —
    // both are settled by definition, or `ready` would never come true and the
    // rail would sit on "Loading your answers…" for good.
    if (readOnlyLearnerSteps || !programmeName) {
      setKsbsSettled(true);
      return;
    }
    // Still waiting on the saved answers; this effect re-runs when they land.
    if (!hydrated) return;
    let cancelled = false;
    fetchKsbProfile(programmeName)
      .then((res) => {
        const ksbs = res.results as Ksb[];
        if (cancelled || ksbs.length === 0) return;
        setDraft((prev) => {
          const assessments = { ...prev.skillsRadar.assessments };
          let seeded = false;
          for (const k of ksbs) {
            if (assessments[k.id]) continue;
            assessments[k.id] = { ksbId: k.id, level: null, evidenceFiles: [], actionPlan: null };
            seeded = true;
          }
          if (!seeded) return prev;
          const next = { ...prev, skillsRadar: { ...prev.skillsRadar, assessments } };
          // Seeding is not an answer: these rows are unrated placeholders that
          // are regenerated from the programme on every load, so they are not
          // worth a write of their own. Counting them as dirty would make the
          // first Next of every visit save — the spinner this fix removes.
          // A learner rating a competency dirties the draft normally.
          if (lastSavedDraft.current === prev) lastSavedDraft.current = next;
          return next;
        });
      })
      .catch(() => {
        // The step surfaces its own load error; a learner is not blocked on
        // competencies we could not fetch.
      })
      // Settled in .finally for the same reason `hydrated` is: a failed fetch
      // must still release whatever is waiting on it, or the rail would report
      // "loading" forever on a learner whose profile could not be read.
      .finally(() => {
        if (!cancelled) setKsbsSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [readOnlyLearnerSteps, hydrated, programmeName]);

  const value = useMemo<WizardContextValue>(
    () => ({
      userId,
      isCommercial,
      board,
      draft,
      readOnly: readOnlyLearnerSteps,
      setSection: (key, val) => setDraft((prev) => ({ ...prev, [key]: val })),
      completed,
      markComplete: (index, done) => setCompleted((prev) => prev.map((c, i) => (i === index ? done : c))),
      saveIlr: async () => {
        // Nothing has changed since the last write — moving off a step the
        // learner didn't touch costs no request and shows no spinner.
        if (draft === lastSavedDraft.current) return;
        // Captured before the await: the learner can keep typing while the
        // request is in flight, and marking *that* newer draft saved would
        // silently drop the edits made during the round-trip.
        const saving = draft;
        setIlrSaving(true);
        try {
          // Save every step, not just the ILR — the other steps have no storage
          // of their own, so without this they would be lost on close.
          const { ilr, ...rest } = saving;
          const res = await saveExtendedIlr(kind, userId, ilr, rest);
          lastSavedDraft.current = saving;
          setIlrSavedAt(res.meta.updatedAt);
        } finally {
          setIlrSaving(false);
        }
      },
      ilrSaving,
      ilrSavedAt,
      hydrated,
      ready: hydrated && ksbsSettled,
      fileIlrDocument: async () => {
        setIlrFiling(true);
        try {
          const sig = draft.ilr.learnerSignature;
          const pdf = await ilrDocumentBlob(draft.ilr, board);
          await uploadEnrolmentDocument(
            kind,
            userId,
            'extended-ilr',
            pdf,
            ilrDocumentFilename(board),
            // Flagged signed only when both parties have signed, matching how
            // the ILR row's Completed is derived server-side.
            { signed: Boolean(sig.signatureUrl && draft.ilr.providerSignature.signatureUrl), learnerName: board.user.name }
          );
        } finally {
          setIlrFiling(false);
        }
      },
      ilrFiling,
    }),
    [userId, isCommercial, board, readOnlyLearnerSteps, draft, completed, kind, ilrSaving, ilrSavedAt, hydrated, ksbsSettled, ilrFiling]
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard must be used within WizardProvider');
  return ctx;
}
