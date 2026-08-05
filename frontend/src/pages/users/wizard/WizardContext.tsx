import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchExtendedIlr, saveExtendedIlr, type LearnerKind } from '@/api/extendedIlr';
import { uploadEnrolmentDocument } from '@/api/enrolmentDocuments';
import { ilrDocumentBlob, ilrDocumentFilename } from './steps/ilrDocument';
import { WIZARD_STEPS, type EnrolmentBoard, type IlrForm, type WizardDraft } from '../types';

/** DD/MM/YYYY -> YYYY-MM-DD (for native date inputs); returns '' if unparseable. */
export function ddmmToIso(s?: string): string {
  if (!s) return '';
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
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
    personalDetails: { firstName: first, lastName: last, email: b.contact.email, phone: b.contact.phone, address: '', dob: iso, age: undefined, sex: '' },
    // The standard is resolved from the learner's own programme by the Skills
    // Radar step (curriculum.ksb_profiles), so it isn't seeded to a fixed one.
    skillsRadar: { standardId: '', assessments: {} },
    ilr: emptyIlr(first, last),
    plr: { uln: '', records: [] },
    cvJob: { pmQualifications: '', experienceText: '', functionalSkillsEnrol: '' },
    policies: { acknowledged: {} },
  };
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
  const [draft, setDraft] = useState<WizardDraft>(() => makeInitialDraft(board));
  const [completed, setCompleted] = useState<boolean[]>(() => Array(WIZARD_STEPS.length).fill(false));
  const [ilrSaving, setIlrSaving] = useState(false);
  const [ilrSavedAt, setIlrSavedAt] = useState('');
  const [ilrFiling, setIlrFiling] = useState(false);

  const kind: LearnerKind = isCommercial ? 'commercial' : 'apprenticeship';

  // Hydrate the previously saved Extended ILR. A learner with nothing saved
  // comes back with answers: null, which leaves the seeded blank form in place.
  useEffect(() => {
    let cancelled = false;
    fetchExtendedIlr(kind, userId)
      .then((res) => {
        if (cancelled || (!res.answers && !res.draft)) return;
        setDraft((prev) => {
          const next = { ...prev, ...(res.draft ?? {}) };
          // Merged per-section over the seeded blanks so a step added after this
          // row was saved still gets its defaults instead of coming back undefined.
          if (res.answers) next.ilr = { ...prev.ilr, ...res.answers };
          return next;
        });
        setIlrSavedAt(res.meta.updatedAt);
      })
      .catch(() => {
        // A failed load is not fatal — the wizard still opens on a blank form.
      });
    return () => {
      cancelled = true;
    };
  }, [kind, userId]);

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
        setIlrSaving(true);
        try {
          // Save every step, not just the ILR — the other steps have no storage
          // of their own, so without this they would be lost on close.
          const { ilr, ...rest } = draft;
          const res = await saveExtendedIlr(kind, userId, ilr, rest);
          setIlrSavedAt(res.meta.updatedAt);
        } finally {
          setIlrSaving(false);
        }
      },
      ilrSaving,
      ilrSavedAt,
      fileIlrDocument: async () => {
        setIlrFiling(true);
        try {
          const sig = draft.ilr.learnerSignature;
          await uploadEnrolmentDocument(
            kind,
            userId,
            'extended-ilr',
            ilrDocumentBlob(draft.ilr, board),
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
    [userId, isCommercial, board, readOnlyLearnerSteps, draft, completed, kind, ilrSaving, ilrSavedAt, ilrFiling]
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard must be used within WizardProvider');
  return ctx;
}
