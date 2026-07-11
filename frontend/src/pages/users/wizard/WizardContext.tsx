import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { PCP_STANDARD } from '@/mocks/enrolment-console';
import type { ContactPreferencesForm, EnrolmentBoard, WizardDraft } from '../types';

/** DD/MM/YYYY -> YYYY-MM-DD (for native date inputs); returns '' if unparseable. */
export function ddmmToIso(s?: string): string {
  if (!s) return '';
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function emptyContactPreferences(): ContactPreferencesForm {
  return {
    consent: { courses: null, surveys: null, byPost: null, byPhone: null, byEmail: null },
    nextOfKin: { fullName: '', relationship: '', email: '', phone: '', sameAddressAsLearner: null, postcode: '', address: '', address2: '', city: '' },
    eligibility: {
      countryOfBirth: '', employedInEngland: null, countryOfResidence: '', ukEeaNational: null, nationality: '',
      residentPrev3Years: null, yearsInUk: undefined, requiresWorkPermit: null, evidenceDescription: '', evidenceFiles: [],
    },
    otherGovFundedTraining12m: null,
    circumstances: { homeSituation: '', caringResponsibilities: '', other: '', supportNeeded: '', careLeaver: null },
    understanding: { programmeUnderstanding: '', careerProgression: '' },
    additional: { wageRateBand: '', disabilityDiscussEmployer: '', otherIncome: '', aged16to18: null, aged19to24: null },
    media: { consent: null, preferredName: '', genderIdentity: '', genderOther: '', pronouns: '' },
    declarations: { plrShared: null, dfeContact: null, epaoDetails: null, kbcHoldsCerts: null, infoAccurate: null },
  };
}

function makeInitialDraft(b: EnrolmentBoard): WizardDraft {
  const parts = b.user.name.split(' ');
  const first = parts[0] ?? '';
  const last = parts.slice(1).join(' ');
  const iso = ddmmToIso(b.contact.dob);
  return {
    personalDetails: { firstName: first, lastName: last, email: b.contact.email, phone: b.contact.phone, address: '', dob: iso, age: undefined, sex: '' },
    skillsRadar: { standardId: PCP_STANDARD.id, assessments: {} },
    ilr: {
      familyName: last, givenNames: first, dob: iso, currentPostcode: '',
      addressLine1: '', addressLine2: '', addressLine3: '', addressLine4: '', yearsAtAddress: undefined,
      telephone: b.contact.phone, postcodePriorToEnrolment: '', niNumber: '', email: b.contact.email,
      legalSex: '', pronouns: '', ethnicityCode: '', hasLongTermDisability: null, priorAttainment: [], employmentStatus: [],
    },
    contactPreferences: emptyContactPreferences(),
    plr: { uln: '', records: [] },
    cvJob: { pmQualifications: '', experienceText: '', functionalSkillsEnrol: '' },
    policies: { acknowledged: {} },
  };
}

interface WizardContextValue {
  userId: string;
  board: EnrolmentBoard;
  draft: WizardDraft;
  setSection: <K extends keyof WizardDraft>(key: K, value: WizardDraft[K]) => void;
  completed: boolean[];
  markComplete: (index: number, done: boolean) => void;
}

const WizardContext = createContext<WizardContextValue | null>(null);

export function WizardProvider({ userId, board, children }: { userId: string; board: EnrolmentBoard; children: ReactNode }) {
  const [draft, setDraft] = useState<WizardDraft>(() => makeInitialDraft(board));
  const [completed, setCompleted] = useState<boolean[]>(() => Array(9).fill(false));

  const value = useMemo<WizardContextValue>(
    () => ({
      userId,
      board,
      draft,
      setSection: (key, val) => setDraft((prev) => ({ ...prev, [key]: val })),
      completed,
      markComplete: (index, done) => setCompleted((prev) => prev.map((c, i) => (i === index ? done : c))),
    }),
    [userId, board, draft, completed]
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard must be used within WizardProvider');
  return ctx;
}
