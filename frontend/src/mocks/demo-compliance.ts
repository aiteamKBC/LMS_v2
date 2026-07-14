// ============================================================================
// KBC LearningOS — Connected Demo Data: Compliance Layer
// Onboarding cases, eligibility, RPL, documents, signatures, DAS, ILR
// All learner IDs match demo-core.ts
// ============================================================================

// ---- ELIGIBILITY REVIEWS ----
export const DEMO_ELIGIBILITY_REVIEWS = [
  {
    id: 'elig-001', learnerId: 'lrn-001', learnerName: 'Sophie Williams',
    programme: 'Marketing Executive Level 4', employer: 'Tim Hortons UK',
    status: 'Eligible', reviewer: 'James Whitfield', reviewDate: '14 May 2026',
    residencyStatus: 'UK Citizen', priorAttainment: 'A Levels', fundingModel: 'Levy',
    ageMet: true, residencyMet: true, rightToWorkMet: true, priorQualMet: true,
    dasRef: 'DAS-001-2026', notes: 'All criteria met. Levy employer confirmed on DAS.',
  },
  {
    id: 'elig-002', learnerId: 'lrn-002', learnerName: 'James Okafor',
    programme: 'Marketing Executive Level 4', employer: 'Pret A Manger',
    status: 'Eligible', reviewer: 'James Whitfield', reviewDate: '15 May 2026',
    residencyStatus: 'UK Citizen', priorAttainment: 'A Levels', fundingModel: 'Non-Levy',
    ageMet: true, residencyMet: true, rightToWorkMet: true, priorQualMet: true,
    dasRef: 'DAS-002-2026', notes: 'Non-levy employer. Co-investment confirmed.',
  },
  {
    id: 'elig-003', learnerId: 'lrn-003', learnerName: 'Emily Chen',
    programme: 'Business Administrator Level 3', employer: 'Boots UK',
    status: 'Eligible', reviewer: 'Eleanor Hart', reviewDate: '28 May 2026',
    residencyStatus: 'UK Citizen', priorAttainment: 'GCSEs', fundingModel: 'Levy',
    ageMet: true, residencyMet: true, rightToWorkMet: true, priorQualMet: true,
    dasRef: 'DAS-003-2026', notes: 'All criteria met.',
  },
  {
    id: 'elig-004', learnerId: 'lrn-004', learnerName: 'Liam Patel',
    programme: 'Data Analyst Level 4', employer: 'Costa Coffee',
    status: 'Pending', reviewer: 'James Whitfield', reviewDate: '02 Apr 2026',
    residencyStatus: 'Settled Status', priorAttainment: 'Degree', fundingModel: 'Non-Levy',
    ageMet: true, residencyMet: false, rightToWorkMet: true, priorQualMet: true,
    dasRef: '', notes: 'CRITICAL: Settled status share code not verified. Residency evidence only covers 2 years — 3 years required. QA rejected on this basis.',
  },
  {
    id: 'elig-005', learnerId: 'lrn-005', learnerName: 'Ava Thompson',
    programme: 'Operations Manager Level 5', employer: 'Marks & Spencer',
    status: 'Eligible', reviewer: 'James Whitfield', reviewDate: '18 Dec 2024',
    residencyStatus: 'UK Citizen', priorAttainment: 'Degree', fundingModel: 'Levy',
    ageMet: true, residencyMet: true, rightToWorkMet: true, priorQualMet: true,
    dasRef: 'DAS-005-2024', notes: 'RPL applied — degree exempts from Maths functional skills. All eligible.',
  },
];

// ---- RPL REVIEWS ----
export const DEMO_RPL_REVIEWS = [
  {
    id: 'rpl-001', learnerId: 'lrn-005', learnerName: 'Ava Thompson',
    programme: 'Operations Manager Level 5', status: 'RPL Applied',
    reviewer: 'James Whitfield', reviewDate: '20 Dec 2024',
    priorExperience: '8 years operations management at Sainsbury\'s',
    ksbsExempted: ['K1', 'K2', 'K3', 'S1', 'S2'],
    durationReduction: '2 months', notes: 'RPL reduces programme from 24 to 22 months.',
  },
  {
    id: 'rpl-002', learnerId: 'lrn-006', learnerName: 'Noah Williams',
    programme: 'HR Consultant Partner Level 5', status: 'RPL Not Applied',
    reviewer: 'Eleanor Hart', reviewDate: '15 Mar 2025',
    priorExperience: '3 years HR admin — not sufficient for KSB exemptions',
    ksbsExempted: [],
    durationReduction: 'N/A', notes: 'Prior experience noted but insufficient for RPL at Level 5.',
  },
];

// ---- SIGNATURES (per learner) ----
export const DEMO_SIGNATURES = [
  {
    id: 'sig-001', learnerId: 'lrn-001', learnerName: 'Sophie Williams',
    documents: [
      { doc: 'Apprenticeship Agreement', learner: 'Signed 19 May 2026', employer: 'Signed 21 May 2026', provider: 'Signed 20 May 2026', status: 'Complete' },
      { doc: 'Training Plan', learner: 'Signed 19 May 2026', employer: 'Signed 21 May 2026', provider: 'Signed 20 May 2026', status: 'Complete' },
      { doc: 'GDPR Consent', learner: 'Signed 19 May 2026', employer: 'N/A', provider: 'N/A', status: 'Complete' },
      { doc: 'EPA Agreement', learner: 'Signed 19 May 2026', employer: 'Signed 21 May 2026', provider: 'Signed 20 May 2026', status: 'Complete' },
    ],
    overallStatus: 'Fully Signed',
  },
  {
    id: 'sig-002', learnerId: 'lrn-004', learnerName: 'Liam Patel',
    documents: [
      { doc: 'Apprenticeship Agreement', learner: 'Signed 31 Mar 2026', employer: 'Signed 02 Apr 2026', provider: 'Signed 01 Apr 2026', status: 'Complete' },
      { doc: 'Training Plan', learner: 'Signed 31 Mar 2026', employer: 'Awaiting', provider: 'Signed 01 Apr 2026', status: 'Incomplete' },
      { doc: 'GDPR Consent', learner: 'Signed 31 Mar 2026', employer: 'N/A', provider: 'N/A', status: 'Complete' },
      { doc: 'EPA Agreement', learner: 'Not Signed', employer: 'Not Signed', provider: 'Not Signed', status: 'Incomplete' },
    ],
    overallStatus: 'Partially Signed',
  },
];

// ---- DAS (Digital Apprenticeship Service) STATUS ----
export const DEMO_DAS_RECORDS = [
  { id: 'das-001', learnerId: 'lrn-001', learnerName: 'Sophie Williams', uln: '3847291056', employer: 'Tim Hortons UK', dasRef: 'DAS-001-2026', fundingModel: 'Levy', fundingBand: 9000, coInvestment: 0, status: 'Confirmed', confirmedDate: '17 May 2026', startDate: '19 May 2026' },
  { id: 'das-002', learnerId: 'lrn-002', learnerName: 'James Okafor', uln: '2938471605', employer: 'Pret A Manger', dasRef: 'DAS-002-2026', fundingModel: 'Non-Levy', fundingBand: 9000, coInvestment: 900, status: 'Confirmed', confirmedDate: '17 May 2026', startDate: '19 May 2026' },
  { id: 'das-003', learnerId: 'lrn-003', learnerName: 'Emily Chen', uln: '1928374650', employer: 'Boots UK', dasRef: 'DAS-003-2026', fundingModel: 'Levy', fundingBand: 5000, coInvestment: 0, status: 'Confirmed', confirmedDate: '30 May 2026', startDate: '02 Jun 2026' },
  { id: 'das-004', learnerId: 'lrn-004', learnerName: 'Liam Patel', uln: '8374659201', employer: 'Costa Coffee', dasRef: '', fundingModel: 'Non-Levy', fundingBand: 11000, coInvestment: 1100, status: 'Not Confirmed — QA Hold', confirmedDate: '', startDate: '' },
  { id: 'das-005', learnerId: 'lrn-005', learnerName: 'Ava Thompson', uln: '5647382910', employer: 'Marks & Spencer', dasRef: 'DAS-005-2024', fundingModel: 'Levy', fundingBand: 7000, coInvestment: 0, status: 'Confirmed', confirmedDate: '02 Jan 2025', startDate: '06 Jan 2025' },
  { id: 'das-006', learnerId: 'lrn-006', learnerName: 'Noah Williams', uln: '3746281905', employer: 'Next PLC', dasRef: 'DAS-006-2025', fundingModel: 'Levy', fundingBand: 7000, coInvestment: 0, status: 'Confirmed', confirmedDate: '08 Mar 2025', startDate: '10 Mar 2025' },
  { id: 'das-007', learnerId: 'lrn-007', learnerName: 'Mia Robinson', uln: '9283746501', employer: 'Tesco', dasRef: 'DAS-007-2026', fundingModel: 'Levy', fundingBand: 7000, coInvestment: 0, status: 'Confirmed', confirmedDate: '01 Feb 2026', startDate: '03 Feb 2026' },
  { id: 'das-008', learnerId: 'lrn-009', learnerName: 'Priya Sharma', uln: '7483920165', employer: 'NatWest Group', dasRef: 'DAS-009-2026', fundingModel: 'Levy', fundingBand: 5000, coInvestment: 0, status: 'Confirmed', confirmedDate: '31 May 2026', startDate: '02 Jun 2026' },
  { id: 'das-009', learnerId: 'lrn-010', learnerName: 'Connor Walsh', uln: '2847392106', employer: "Sainsbury's", dasRef: 'DAS-010-2026', fundingModel: 'Levy', fundingBand: 9000, coInvestment: 0, status: 'Confirmed', confirmedDate: '17 May 2026', startDate: '19 May 2026' },
];

// ---- ILR RECORDS ----
export const DEMO_ILR_RECORDS = [
  { id: 'ilr-001', learnerId: 'lrn-001', learnerName: 'Sophie Williams', uln: '3847291056', ukprn: '10003432', programme: 'Marketing Executive L4', aimCode: 'ZPROG001', startDate: '19 May 2026', plannedEndDate: '18 Nov 2027', status: 'Active', returnReady: true, lastChecked: '10 Jun 2026' },
  { id: 'ilr-002', learnerId: 'lrn-002', learnerName: 'James Okafor', uln: '2938471605', ukprn: '10003432', programme: 'Marketing Executive L4', aimCode: 'ZPROG001', startDate: '19 May 2026', plannedEndDate: '18 Nov 2027', status: 'Active', returnReady: true, lastChecked: '10 Jun 2026' },
  { id: 'ilr-003', learnerId: 'lrn-003', learnerName: 'Emily Chen', uln: '1928374650', ukprn: '10003432', programme: 'Business Admin L3', aimCode: 'ZPROG001', startDate: '02 Jun 2026', plannedEndDate: '01 Sep 2027', status: 'Active', returnReady: true, lastChecked: '10 Jun 2026' },
  { id: 'ilr-004', learnerId: 'lrn-004', learnerName: 'Liam Patel', uln: '8374659201', ukprn: '10003432', programme: 'Data Analyst L4', aimCode: 'ZPROG001', startDate: '', plannedEndDate: '13 Oct 2027', status: 'Pre-Active — Not Started', returnReady: false, lastChecked: '05 Jun 2026' },
  { id: 'ilr-005', learnerId: 'lrn-005', learnerName: 'Ava Thompson', uln: '5647382910', ukprn: '10003432', programme: 'Operations Manager L5', aimCode: 'ZPROG001', startDate: '06 Jan 2025', plannedEndDate: '05 Jan 2027', status: 'Active', returnReady: true, lastChecked: '10 Jun 2026' },
  { id: 'ilr-006', learnerId: 'lrn-007', learnerName: 'Mia Robinson', uln: '9283746501', ukprn: '10003432', programme: 'Project Manager L4', aimCode: 'ZPROG001', startDate: '03 Feb 2026', plannedEndDate: '02 Oct 2027', status: 'Active — Risk Flag', returnReady: true, lastChecked: '09 Jun 2026' },
  { id: 'ilr-007', learnerId: 'lrn-008', learnerName: 'Oliver Davis', uln: '6372819405', ukprn: '10003432', programme: 'Software Developer L4', aimCode: 'ZPROG001', startDate: '09 Sep 2024', plannedEndDate: '08 Mar 2026', status: 'Completed', returnReady: true, lastChecked: '09 Mar 2026' },
];

// ---- QA FINAL REVIEWS (Pre-Active) ----
export const DEMO_QA_REVIEWS_PREACTIVE = [
  {
    id: 'qa-pre-001', learnerId: 'lrn-001', learnerName: 'Sophie Williams',
    programme: 'Marketing Executive Level 4', employer: 'Tim Hortons UK',
    reviewer: 'Patricia Nkosi', reviewDate: '16 May 2026', status: 'Approved',
    complianceScore: 98, eligibilityChecked: true, rplChecked: true, signaturesChecked: true,
    dasChecked: true, ilrChecked: true, evidencePackChecked: true,
    findings: [], outcome: 'All documentation complete. Learner approved for activation.',
  },
  {
    id: 'qa-pre-002', learnerId: 'lrn-004', learnerName: 'Liam Patel',
    programme: 'Data Analyst Level 4', employer: 'Costa Coffee',
    reviewer: 'Patricia Nkosi', reviewDate: '07 Apr 2026', status: 'Rejected',
    complianceScore: 62, eligibilityChecked: false, rplChecked: true, signaturesChecked: true,
    dasChecked: false, ilrChecked: false, evidencePackChecked: true,
    findings: [
      'CRITICAL: Settled status share code not verified — residency test fails',
      'DAS not confirmed — employer not added to DAS service',
      'ILR record not created — cannot activate without confirmed start date',
      'Training plan signature missing from employer',
    ],
    outcome: 'REJECTED. Compliance Officer must resolve eligibility query before re-submission.',
  },
  {
    id: 'qa-pre-003', learnerId: 'lrn-005', learnerName: 'Ava Thompson',
    programme: 'Operations Manager Level 5', employer: 'Marks & Spencer',
    reviewer: 'Patricia Nkosi', reviewDate: '29 Dec 2024', status: 'Approved',
    complianceScore: 100, eligibilityChecked: true, rplChecked: true, signaturesChecked: true,
    dasChecked: true, ilrChecked: true, evidencePackChecked: true,
    findings: [], outcome: 'All criteria met including RPL application. Approved.',
  },
];

// ---- COMPLIANCE AUDIT SUMMARY ----
export const COMPLIANCE_SUMMARY = {
  activeLearners: 7,
  fullyCompliant: 6,
  hasIssues: 1,
  qaApproved: 6,
  qaRejected: 1,
  qaNotRequired: 2,
  dasConfirmed: 8,
  dasNotConfirmed: 1,
  ilrReady: 8,
  ilrNotReady: 1,
  allSignaturesSigned: 8,
  partialSignatures: 1,
};