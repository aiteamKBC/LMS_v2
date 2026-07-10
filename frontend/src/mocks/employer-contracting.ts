// ============================================================================
// EMPLOYER CONTRACTING — Mock data for the employer contracting & workplace validation engine
// ============================================================================

export interface EmployerDocument {
  id: string;
  name: string;
  type: string;
  status: 'required' | 'sent' | 'signed' | 'expired' | 'not_applicable';
  sentDate?: string;
  signedDate?: string;
  signedBy?: string;
  notes?: string;
}

export interface EmployerContractingRecord {
  id: string;
  learnerId: string;
  learnerName: string;
  programme: string;
  standardCode: string;
  cohort: string;

  // Employer details
  employerLegalName: string;
  employerTradingName: string;
  employerType: string;
  companyNumber: string;
  ukAddress: string;
  workplaceAddress: string;
  workplaceInEngland: boolean;
  employerContactName: string;
  employerContactEmail: string;
  employerContactPhone: string;
  employerSignatoryName: string;
  employerSignatoryEmail: string;

  // Line manager
  lineManagerName: string;
  lineManagerEmail: string;
  lineManagerPhone: string;

  // Learner employment details
  learnerJobTitle: string;
  employmentStatus: string;
  contractType: string;
  workingHours: number;
  normalWorkingPattern: string;

  // Funding & DAS
  payeConfirmed: boolean;
  dasAccountStatus: string;
  providerAddedToDas: boolean;
  fundingRoute: string;
  levyStatus: string;
  coInvestmentRequired: boolean;
  coInvestmentAmount?: number;

  // Commitments & declarations
  employerCommitmentSigned: boolean;
  contractForServicesSigned: boolean;
  workplaceValidationCompleted: boolean;
  employerDeclarationSigned: boolean;
  healthAndSafetyConfirmed: boolean;
  employerSupportConfirmed: boolean;
  otjhPaidHoursConfirmed: boolean;
  progressReviewCommitmentConfirmed: boolean;
  dataSharingConfirmed: boolean;

  // Status
  currentStatus: string;
  statusHistory: ContractingStatusEntry[];
  documents: EmployerDocument[];

  // Meta
  caseOwner: string;
  lastUpdated: string;
  daysSinceLastUpdate: number;
  nextAction: string;
  nextActionDue: string;
  riskStatus: 'Low' | 'Medium' | 'High';
  riskReason: string;
  notes: string;
}

export interface ContractingStatusEntry {
  status: string;
  date?: string;
  notes?: string;
  isCurrent: boolean;
}

export const CONTRACTING_STATUSES = [
  'Not Started',
  'Employer Details Required',
  'Employer In Review',
  'Employer Invalid',
  'UK Address Required',
  'Workplace England Check Failed',
  'Line Manager Missing',
  'Signatory Missing',
  'PAYE Confirmation Required',
  'DAS Action Required',
  'Contract Sent',
  'Awaiting Employer Signature',
  'Awaiting Provider Signature',
  'Contract Signed',
  'Ready for Learner Onboarding',
];

export const EMPLOYER_TYPES = [
  'Local Authority',
  'NHS Trust',
  'Private Limited Company',
  'Public Limited Company',
  'Charity / Non-Profit',
  'Sole Trader',
  'Partnership',
  'Academy Trust',
  'Government Department',
  'Further Education College',
];

export const FUNDING_ROUTES = [
  'Levy-funded',
  'Non-levy (co-investment)',
  'Levy transfer',
  'Fully funded (waiver)',
];

export const EMPLOYER_CONTRACTING_RECORDS: EmployerContractingRecord[] = [
  {
    id: 'EC-001',
    learnerId: 'PAL-007',
    learnerName: 'Sophie Martin',
    programme: 'Business Administrator Level 3',
    standardCode: 'ST0070',
    cohort: 'Cohort 2026-B',
    employerLegalName: 'Canterbury City Council',
    employerTradingName: 'Canterbury City Council',
    employerType: 'Local Authority',
    companyNumber: '',
    ukAddress: '14 St George\'s Street, Canterbury, Kent, CT1 2SR',
    workplaceAddress: 'Canterbury City Council Offices, Military Road, Canterbury, Kent, CT1 1YW',
    workplaceInEngland: true,
    employerContactName: 'David Thompson',
    employerContactEmail: 'd.thompson@canterbury.gov.uk',
    employerContactPhone: '01227 862000',
    employerSignatoryName: 'Cllr. Margaret Ashford',
    employerSignatoryEmail: 'm.ashford@canterbury.gov.uk',
    lineManagerName: 'James O\'Brien',
    lineManagerEmail: 'j.obrien@canterbury.gov.uk',
    lineManagerPhone: '01227 862145',
    learnerJobTitle: 'Business Support Apprentice',
    employmentStatus: 'Full-time Employee',
    contractType: 'Permanent',
    workingHours: 37,
    normalWorkingPattern: 'Monday–Friday, 9am–5pm',
    payeConfirmed: true,
    dasAccountStatus: 'Active',
    providerAddedToDas: true,
    fundingRoute: 'Levy-funded',
    levyStatus: 'Levy-paying employer',
    coInvestmentRequired: false,
    employerCommitmentSigned: true,
    contractForServicesSigned: true,
    workplaceValidationCompleted: true,
    employerDeclarationSigned: true,
    healthAndSafetyConfirmed: true,
    employerSupportConfirmed: true,
    otjhPaidHoursConfirmed: true,
    progressReviewCommitmentConfirmed: true,
    dataSharingConfirmed: true,
    currentStatus: 'Contract Signed',
    caseOwner: 'Eleanor Hart (Compliance)',
    lastUpdated: '2026-03-30',
    daysSinceLastUpdate: 72,
    nextAction: 'Proceed to learner self-onboarding',
    nextActionDue: '2026-04-01',
    riskStatus: 'Low',
    riskReason: '',
    notes: 'All documents signed efficiently. Employer fully cooperative. DAS confirmed — levy funds allocated.',
    statusHistory: [
      { status: 'Not Started', date: '2026-02-10', isCurrent: false },
      { status: 'Employer Details Required', date: '2026-02-12', isCurrent: false },
      { status: 'Employer In Review', date: '2026-02-18', isCurrent: false },
      { status: 'Contract Sent', date: '2026-03-05', isCurrent: false },
      { status: 'Awaiting Employer Signature', date: '2026-03-08', isCurrent: false },
      { status: 'Awaiting Provider Signature', date: '2026-03-20', isCurrent: false },
      { status: 'Contract Signed', date: '2026-03-30', isCurrent: true },
      { status: 'Ready for Learner Onboarding', isCurrent: false },
    ],
    documents: [
      { id: 'DOC-001', name: 'Employer Contract for Services', type: 'contract', status: 'signed', sentDate: '2026-03-05', signedDate: '2026-03-28', signedBy: 'Cllr. Margaret Ashford' },
      { id: 'DOC-002', name: 'Employer Declaration', type: 'declaration', status: 'signed', sentDate: '2026-03-05', signedDate: '2026-03-25', signedBy: 'Cllr. Margaret Ashford' },
      { id: 'DOC-003', name: 'Workplace Confirmation', type: 'confirmation', status: 'signed', sentDate: '2026-03-05', signedDate: '2026-03-22', signedBy: 'James O\'Brien' },
      { id: 'DOC-004', name: 'Line Manager Confirmation', type: 'confirmation', status: 'signed', sentDate: '2026-03-05', signedDate: '2026-03-22', signedBy: 'James O\'Brien' },
      { id: 'DOC-005', name: 'Payment / Co-investment Schedule', type: 'financial', status: 'not_applicable', notes: 'Levy-funded — no co-investment required' },
      { id: 'DOC-006', name: 'DAS Instruction / Provider Add Guide', type: 'guide', status: 'sent', sentDate: '2026-03-10', notes: 'DAS already active — provider added 14 Mar' },
      { id: 'DOC-007', name: 'Data Sharing and Communication Consent', type: 'consent', status: 'signed', sentDate: '2026-03-05', signedDate: '2026-03-25', signedBy: 'Cllr. Margaret Ashford' },
    ],
  },
  {
    id: 'EC-002',
    learnerId: 'PAL-004',
    learnerName: 'Oliver Grant',
    programme: 'Data Technician Level 3',
    standardCode: 'ST0795',
    cohort: 'Cohort 2026-C',
    employerLegalName: 'Dartford Borough Council',
    employerTradingName: 'Dartford Borough Council',
    employerType: 'Local Authority',
    companyNumber: '',
    ukAddress: 'Civic Centre, Home Gardens, Dartford, Kent, DA1 1DR',
    workplaceAddress: 'Dartford Borough Council, ICT Services, Civic Centre, Home Gardens, Dartford, DA1 1DR',
    workplaceInEngland: true,
    employerContactName: '',
    employerContactEmail: '',
    employerContactPhone: '',
    employerSignatoryName: '',
    employerSignatoryEmail: '',
    lineManagerName: 'Sarah Jenkins',
    lineManagerEmail: 's.jenkins@dartford.gov.uk',
    lineManagerPhone: '',
    learnerJobTitle: 'Junior Data Technician',
    employmentStatus: 'Full-time Employee',
    contractType: 'Permanent',
    workingHours: 37,
    normalWorkingPattern: 'Monday–Friday, 8:30am–5pm',
    payeConfirmed: false,
    dasAccountStatus: 'Unknown',
    providerAddedToDas: false,
    fundingRoute: '',
    levyStatus: '',
    coInvestmentRequired: false,
    employerCommitmentSigned: false,
    contractForServicesSigned: false,
    workplaceValidationCompleted: false,
    employerDeclarationSigned: false,
    healthAndSafetyConfirmed: false,
    employerSupportConfirmed: false,
    otjhPaidHoursConfirmed: false,
    progressReviewCommitmentConfirmed: false,
    dataSharingConfirmed: false,
    currentStatus: 'Employer In Review',
    caseOwner: 'Eleanor Hart (Compliance)',
    lastUpdated: '2026-06-02',
    daysSinceLastUpdate: 8,
    nextAction: 'Escalate to employer engagement team — employer contact details missing',
    nextActionDue: '2026-06-08',
    riskStatus: 'High',
    riskReason: 'Employer not responding — contact details and signatory missing. 8 days since last update.',
    notes: 'Line manager Sarah Jenkins responsive but cannot sign contracts. Need director-level signatory. Employer contact person not yet identified.',
    statusHistory: [
      { status: 'Not Started', date: '2026-04-10', isCurrent: false },
      { status: 'Employer Details Required', date: '2026-04-12', isCurrent: false },
      { status: 'Employer In Review', date: '2026-05-02', isCurrent: true },
      { status: 'Contract Sent', isCurrent: false },
      { status: 'Awaiting Employer Signature', isCurrent: false },
      { status: 'Awaiting Provider Signature', isCurrent: false },
      { status: 'Contract Signed', isCurrent: false },
      { status: 'Ready for Learner Onboarding', isCurrent: false },
    ],
    documents: [
      { id: 'DOC-008', name: 'Employer Contract for Services', type: 'contract', status: 'required' },
      { id: 'DOC-009', name: 'Employer Declaration', type: 'declaration', status: 'required' },
      { id: 'DOC-010', name: 'Workplace Confirmation', type: 'confirmation', status: 'required' },
      { id: 'DOC-011', name: 'Line Manager Confirmation', type: 'confirmation', status: 'required' },
      { id: 'DOC-012', name: 'Payment / Co-investment Schedule', type: 'financial', status: 'required' },
      { id: 'DOC-013', name: 'DAS Instruction / Provider Add Guide', type: 'guide', status: 'required' },
      { id: 'DOC-014', name: 'Data Sharing and Communication Consent', type: 'consent', status: 'required' },
    ],
  },
  {
    id: 'EC-003',
    learnerId: 'PAL-003',
    learnerName: 'Amina Hussein',
    programme: 'Business Administrator Level 3',
    standardCode: 'ST0070',
    cohort: 'Cohort 2026-C',
    employerLegalName: 'Kent Fire & Rescue Service',
    employerTradingName: 'Kent Fire & Rescue Service',
    employerType: 'Government Department',
    companyNumber: '',
    ukAddress: 'The Godlands, Straw Mill Hill, Tovil, Maidstone, Kent, ME15 6XB',
    workplaceAddress: 'Kent Fire & Rescue HQ, The Godlands, Straw Mill Hill, Tovil, Maidstone, Kent, ME15 6XB',
    workplaceInEngland: true,
    employerContactName: 'Joanne Phelps',
    employerContactEmail: 'j.phelps@kent.fire.uk',
    employerContactPhone: '01622 692121',
    employerSignatoryName: 'CFO Mark Rist',
    employerSignatoryEmail: 'm.rist@kent.fire.uk',
    lineManagerName: 'David Chen',
    lineManagerEmail: 'd.chen@kent.fire.uk',
    lineManagerPhone: '01622 692340',
    learnerJobTitle: 'Business Administration Apprentice',
    employmentStatus: 'Full-time Employee',
    contractType: 'Fixed-term (apprenticeship)',
    workingHours: 37,
    normalWorkingPattern: 'Monday–Friday, 9am–5pm with flexible start',
    payeConfirmed: true,
    dasAccountStatus: 'Active',
    providerAddedToDas: true,
    fundingRoute: 'Levy-funded',
    levyStatus: 'Levy-paying employer',
    coInvestmentRequired: false,
    employerCommitmentSigned: false,
    contractForServicesSigned: false,
    workplaceValidationCompleted: true,
    employerDeclarationSigned: false,
    healthAndSafetyConfirmed: true,
    employerSupportConfirmed: true,
    otjhPaidHoursConfirmed: true,
    progressReviewCommitmentConfirmed: true,
    dataSharingConfirmed: true,
    currentStatus: 'Awaiting Employer Signature',
    caseOwner: 'Eleanor Hart (Compliance)',
    lastUpdated: '2026-06-07',
    daysSinceLastUpdate: 3,
    nextAction: 'Chase CFO Mark Rist for contract signature — documents sent 25 May',
    nextActionDue: '2026-06-12',
    riskStatus: 'Medium',
    riskReason: 'Contract sent 25 May — awaiting signatory response. CFO aware but busy.',
    notes: 'Workplace validation passed with flying colours. H&S, support, OTJH and progress review commitments all verbally confirmed. Just awaiting formal signatures.',
    statusHistory: [
      { status: 'Not Started', date: '2026-04-01', isCurrent: false },
      { status: 'Employer Details Required', date: '2026-04-05', isCurrent: false },
      { status: 'Employer In Review', date: '2026-04-15', isCurrent: false },
      { status: 'Contract Sent', date: '2026-05-25', isCurrent: false },
      { status: 'Awaiting Employer Signature', date: '2026-05-25', isCurrent: true },
      { status: 'Awaiting Provider Signature', isCurrent: false },
      { status: 'Contract Signed', isCurrent: false },
      { status: 'Ready for Learner Onboarding', isCurrent: false },
    ],
    documents: [
      { id: 'DOC-015', name: 'Employer Contract for Services', type: 'contract', status: 'sent', sentDate: '2026-05-25' },
      { id: 'DOC-016', name: 'Employer Declaration', type: 'declaration', status: 'sent', sentDate: '2026-05-25' },
      { id: 'DOC-017', name: 'Workplace Confirmation', type: 'confirmation', status: 'signed', sentDate: '2026-05-15', signedDate: '2026-05-20', signedBy: 'David Chen' },
      { id: 'DOC-018', name: 'Line Manager Confirmation', type: 'confirmation', status: 'signed', sentDate: '2026-05-15', signedDate: '2026-05-20', signedBy: 'David Chen' },
      { id: 'DOC-019', name: 'Payment / Co-investment Schedule', type: 'financial', status: 'not_applicable', notes: 'Levy-funded' },
      { id: 'DOC-020', name: 'DAS Instruction / Provider Add Guide', type: 'guide', status: 'sent', sentDate: '2026-05-15', notes: 'DAS already active — provider confirmed' },
      { id: 'DOC-021', name: 'Data Sharing and Communication Consent', type: 'consent', status: 'sent', sentDate: '2026-05-25' },
    ],
  },
  {
    id: 'EC-004',
    learnerId: 'PAL-005',
    learnerName: 'Chloe Parkinson',
    programme: 'Business Administrator Level 3',
    standardCode: 'ST0070',
    cohort: 'Cohort 2026-C',
    employerLegalName: 'Tonbridge & Malling Borough Council',
    employerTradingName: 'TMBC',
    employerType: 'Local Authority',
    companyNumber: '',
    ukAddress: 'Gibson Building, Gibson Drive, Kings Hill, West Malling, Kent, ME19 4LZ',
    workplaceAddress: 'Tonbridge & Malling Borough Council, Gibson Building, Gibson Drive, Kings Hill, West Malling, ME19 4LZ',
    workplaceInEngland: true,
    employerContactName: 'Rebecca Stone',
    employerContactEmail: 'r.stone@tmbc.gov.uk',
    employerContactPhone: '01732 844522',
    employerSignatoryName: 'Cllr. Alan McDermott',
    employerSignatoryEmail: 'a.mcdermott@tmbc.gov.uk',
    lineManagerName: 'Mark Dawson',
    lineManagerEmail: 'm.dawson@tmbc.gov.uk',
    lineManagerPhone: '01732 844601',
    learnerJobTitle: 'Business Administration Apprentice',
    employmentStatus: 'Full-time Employee',
    contractType: 'Permanent',
    workingHours: 37,
    normalWorkingPattern: 'Monday–Thursday 8:30am–5pm, Friday 8:30am–4:30pm',
    payeConfirmed: true,
    dasAccountStatus: 'Active',
    providerAddedToDas: true,
    fundingRoute: 'Levy-funded',
    levyStatus: 'Levy-paying employer',
    coInvestmentRequired: false,
    employerCommitmentSigned: true,
    contractForServicesSigned: true,
    workplaceValidationCompleted: true,
    employerDeclarationSigned: true,
    healthAndSafetyConfirmed: true,
    employerSupportConfirmed: true,
    otjhPaidHoursConfirmed: true,
    progressReviewCommitmentConfirmed: true,
    dataSharingConfirmed: true,
    currentStatus: 'Contract Signed',
    caseOwner: 'Eleanor Hart (Compliance)',
    lastUpdated: '2026-05-15',
    daysSinceLastUpdate: 26,
    nextAction: 'None — contracting complete. Learner moved to self-onboarding.',
    nextActionDue: '',
    riskStatus: 'Low',
    riskReason: '',
    notes: 'All documentation signed and returned promptly. Employer fully engaged — no issues.',
    statusHistory: [
      { status: 'Not Started', date: '2026-03-25', isCurrent: false },
      { status: 'Employer Details Required', date: '2026-03-28', isCurrent: false },
      { status: 'Employer In Review', date: '2026-04-05', isCurrent: false },
      { status: 'Contract Sent', date: '2026-04-28', isCurrent: false },
      { status: 'Awaiting Employer Signature', date: '2026-05-01', isCurrent: false },
      { status: 'Awaiting Provider Signature', date: '2026-05-06', isCurrent: false },
      { status: 'Contract Signed', date: '2026-05-15', isCurrent: true },
      { status: 'Ready for Learner Onboarding', date: '2026-05-15', isCurrent: false },
    ],
    documents: [
      { id: 'DOC-022', name: 'Employer Contract for Services', type: 'contract', status: 'signed', sentDate: '2026-04-28', signedDate: '2026-05-14', signedBy: 'Cllr. Alan McDermott' },
      { id: 'DOC-023', name: 'Employer Declaration', type: 'declaration', status: 'signed', sentDate: '2026-04-28', signedDate: '2026-05-12', signedBy: 'Cllr. Alan McDermott' },
      { id: 'DOC-024', name: 'Workplace Confirmation', type: 'confirmation', status: 'signed', sentDate: '2026-04-28', signedDate: '2026-05-10', signedBy: 'Mark Dawson' },
      { id: 'DOC-025', name: 'Line Manager Confirmation', type: 'confirmation', status: 'signed', sentDate: '2026-04-28', signedDate: '2026-05-10', signedBy: 'Mark Dawson' },
      { id: 'DOC-026', name: 'Payment / Co-investment Schedule', type: 'financial', status: 'not_applicable', notes: 'Levy-funded' },
      { id: 'DOC-027', name: 'DAS Instruction / Provider Add Guide', type: 'guide', status: 'sent', sentDate: '2026-04-28', notes: 'Provider added 2 May' },
      { id: 'DOC-028', name: 'Data Sharing and Communication Consent', type: 'consent', status: 'signed', sentDate: '2026-04-28', signedDate: '2026-05-12', signedBy: 'Cllr. Alan McDermott' },
    ],
  },
  {
    id: 'EC-005',
    learnerId: 'PAL-006',
    learnerName: 'Ryan Fletcher',
    programme: 'Digital Marketing Level 3',
    standardCode: 'ST0122',
    cohort: 'Cohort 2026-D',
    employerLegalName: 'Gravesham Borough Council',
    employerTradingName: 'Gravesham Council',
    employerType: 'Local Authority',
    companyNumber: '',
    ukAddress: 'Civic Centre, Windmill Street, Gravesend, Kent, DA12 1AU',
    workplaceAddress: '',
    workplaceInEngland: false,
    employerContactName: '',
    employerContactEmail: '',
    employerContactPhone: '',
    employerSignatoryName: '',
    employerSignatoryEmail: '',
    lineManagerName: 'Lucy Webb',
    lineManagerEmail: '',
    lineManagerPhone: '',
    learnerJobTitle: 'Digital Marketing Apprentice',
    employmentStatus: '',
    contractType: '',
    workingHours: 0,
    normalWorkingPattern: '',
    payeConfirmed: false,
    dasAccountStatus: 'Unknown',
    providerAddedToDas: false,
    fundingRoute: '',
    levyStatus: '',
    coInvestmentRequired: false,
    employerCommitmentSigned: false,
    contractForServicesSigned: false,
    workplaceValidationCompleted: false,
    employerDeclarationSigned: false,
    healthAndSafetyConfirmed: false,
    employerSupportConfirmed: false,
    otjhPaidHoursConfirmed: false,
    progressReviewCommitmentConfirmed: false,
    dataSharingConfirmed: false,
    currentStatus: 'Employer Details Required',
    caseOwner: 'Eleanor Hart (Compliance)',
    lastUpdated: '2026-06-09',
    daysSinceLastUpdate: 1,
    nextAction: 'Request employer details — learner is still at Lead/Candidate stage',
    nextActionDue: '2026-06-16',
    riskStatus: 'Low',
    riskReason: '',
    notes: 'Learner still at early recruitment stage. Employer details not yet collected. This record created proactively for pipeline tracking.',
    statusHistory: [
      { status: 'Not Started', date: '2026-05-15', isCurrent: false },
      { status: 'Employer Details Required', date: '2026-06-09', isCurrent: true },
      { status: 'Employer In Review', isCurrent: false },
      { status: 'Contract Sent', isCurrent: false },
      { status: 'Awaiting Employer Signature', isCurrent: false },
      { status: 'Awaiting Provider Signature', isCurrent: false },
      { status: 'Contract Signed', isCurrent: false },
      { status: 'Ready for Learner Onboarding', isCurrent: false },
    ],
    documents: [
      { id: 'DOC-029', name: 'Employer Contract for Services', type: 'contract', status: 'required' },
      { id: 'DOC-030', name: 'Employer Declaration', type: 'declaration', status: 'required' },
      { id: 'DOC-031', name: 'Workplace Confirmation', type: 'confirmation', status: 'required' },
      { id: 'DOC-032', name: 'Line Manager Confirmation', type: 'confirmation', status: 'required' },
      { id: 'DOC-033', name: 'Payment / Co-investment Schedule', type: 'financial', status: 'required' },
      { id: 'DOC-034', name: 'DAS Instruction / Provider Add Guide', type: 'guide', status: 'required' },
      { id: 'DOC-035', name: 'Data Sharing and Communication Consent', type: 'consent', status: 'required' },
    ],
  },
];

export const CONTRACTING_STATS = {
  total: 5,
  byRisk: { low: 3, medium: 1, high: 1 },
  readyForOnboarding: 2,
  awaitingSignature: 1,
  overdueActions: 2,
};