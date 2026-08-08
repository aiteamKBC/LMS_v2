import { useState } from 'react';
import type { SelfOnboardingLearner } from '@/mocks/self-onboarding';

interface OnboardingFormProps {
  learner: SelfOnboardingLearner;
}

type SectionKey = 'personalDetails' | 'contactDetails' | 'emergencyContact' | 'employmentDetails' | 'employerAndLineManager' | 'residencyRightToWork' | 'priorAttainment' | 'governmentFundedTraining' | 'personalCircumstances' | 'supportNeeds' | 'learningSupportScreening' | 'englishAndMaths' | 'programmeUnderstanding' | 'priorLearning' | 'cvJobDescription' | 'declarations' | 'reviewAndSubmit';

interface SectionDef {
  key: SectionKey;
  title: string;
  icon: string;
  fields: FieldDef[];
  isBoolean?: boolean;
}

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'longtext' | 'date' | 'select' | 'boolean' | 'list' | 'number';
  options?: string[];
}

const SECTIONS: SectionDef[] = [
  {
    key: 'personalDetails', title: 'Personal Details', icon: 'ri-user-line',
    fields: [
      { key: 'firstName', label: 'First Name', type: 'text' },
      { key: 'lastName', label: 'Last Name', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'dateOfBirth', label: 'Date of Birth', type: 'date' },
      { key: 'nationalInsuranceNumber', label: 'National Insurance Number', type: 'text' },
      { key: 'legalSex', label: 'Legal Sex', type: 'select', options: ['Female', 'Male', 'Prefer not to say'] },
      { key: 'pronouns', label: 'Pronouns', type: 'select', options: ['She/Her', 'He/Him', 'They/Them', 'Other'] },
      { key: 'ethnicity', label: 'Ethnicity', type: 'text' },
      { key: 'disabilityHealthLearningDifficulty', label: 'Disability / Health / Learning Difficulty', type: 'select', options: ['No', 'Yes', 'Prefer not to say'] },
      { key: 'disabilityDetails', label: 'Disability Details (if applicable)', type: 'longtext' },
    ],
  },
  {
    key: 'contactDetails', title: 'Contact Details & Address History', icon: 'ri-map-pin-line',
    fields: [
      { key: 'currentAddress', label: 'Current Address', type: 'longtext' },
      { key: 'postcode', label: 'Postcode', type: 'text' },
      { key: 'previousAddress', label: 'Previous Address (if less than 3 years)', type: 'longtext' },
      { key: 'previousPostcode', label: 'Previous Postcode', type: 'text' },
      { key: 'livedAtCurrentSince', label: 'Lived at Current Address Since', type: 'text' },
    ],
  },
  {
    key: 'emergencyContact', title: 'Emergency Contact', icon: 'ri-alert-line',
    fields: [
      { key: 'fullName', label: 'Full Name', type: 'text' },
      { key: 'relationship', label: 'Relationship', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'alternativePhone', label: 'Alternative Phone', type: 'text' },
    ],
  },
  {
    key: 'employmentDetails', title: 'Employment Details', icon: 'ri-briefcase-line',
    fields: [
      { key: 'employmentStatus', label: 'Employment Status', type: 'select', options: ['Employed', 'Self-Employed', 'Unemployed', 'Volunteer'] },
      { key: 'jobTitle', label: 'Job Title', type: 'text' },
      { key: 'workingHours', label: 'Working Hours (per week)', type: 'number' },
      { key: 'workingPattern', label: 'Normal Working Pattern', type: 'text' },
      { key: 'workplaceAddress', label: 'Workplace Address', type: 'longtext' },
      { key: 'workplacePostcode', label: 'Workplace Postcode', type: 'text' },
      { key: 'contractType', label: 'Contract Type', type: 'select', options: ['Permanent', 'Fixed Term', 'Temporary', 'Zero Hours', 'Agency'] },
      { key: 'startDate', label: 'Employment Start Date', type: 'text' },
    ],
  },
  {
    key: 'employerAndLineManager', title: 'Employer & Line Manager', icon: 'ri-building-2-line',
    fields: [
      { key: 'employerLegalName', label: 'Employer Legal Name', type: 'text' },
      { key: 'tradingName', label: 'Trading Name (if different)', type: 'text' },
      { key: 'lineManagerName', label: 'Line Manager Name', type: 'text' },
      { key: 'lineManagerEmail', label: 'Line Manager Email', type: 'text' },
      { key: 'lineManagerPhone', label: 'Line Manager Phone', type: 'text' },
      { key: 'employerContactName', label: 'Employer Contact Name', type: 'text' },
      { key: 'employerContactEmail', label: 'Employer Contact Email', type: 'text' },
    ],
  },
  {
    key: 'residencyRightToWork', title: 'Residency & Right to Work', icon: 'ri-passport-line',
    fields: [
      { key: 'countryOfBirth', label: 'Country of Birth', type: 'text' },
      { key: 'nationality', label: 'Nationality', type: 'text' },
      { key: 'countryOfResidence', label: 'Country of Residence', type: 'text' },
      { key: 'residencyHistory', label: 'Residency History', type: 'longtext' },
      { key: 'rightToWorkConfirmed', label: 'Right to Work Confirmed', type: 'boolean' },
      { key: 'rightToWorkEvidence', label: 'Right to Work Evidence', type: 'text' },
      { key: 'visaRequired', label: 'Visa Required', type: 'boolean' },
      { key: 'visaType', label: 'Visa Type (if applicable)', type: 'text' },
      { key: 'visaExpiryDate', label: 'Visa Expiry Date (if applicable)', type: 'text' },
      { key: 'shareCode', label: 'Share Code (if applicable)', type: 'text' },
    ],
  },
  {
    key: 'priorAttainment', title: 'Prior Attainment', icon: 'ri-graduation-cap-line',
    fields: [
      { key: 'highestQualification', label: 'Highest Qualification', type: 'text' },
      { key: 'gcseEnglishGrade', label: 'GCSE English Grade', type: 'text' },
      { key: 'gcseMathsGrade', label: 'GCSE Maths Grade', type: 'text' },
      { key: 'functionalSkillsEnglish', label: 'Functional Skills English', type: 'text' },
      { key: 'functionalSkillsMaths', label: 'Functional Skills Maths', type: 'text' },
      { key: 'previousQualifications', label: 'Previous Qualifications', type: 'list' },
      { key: 'previousExperience', label: 'Previous Experience', type: 'longtext' },
      { key: 'highestLevelOfStudy', label: 'Highest Level of Study', type: 'text' },
      { key: 'yearCompleted', label: 'Year Completed', type: 'text' },
    ],
  },
  {
    key: 'governmentFundedTraining', title: 'Government-Funded Training', icon: 'ri-government-line',
    fields: [
      { key: 'previouslyFunded', label: 'Previously Received Govt-Funded Training', type: 'boolean' },
      { key: 'previousProgramme', label: 'Previous Programme Name', type: 'text' },
      { key: 'previousProgrammeDates', label: 'Previous Programme Dates', type: 'text' },
      { key: 'previousProvider', label: 'Previous Provider', type: 'text' },
      { key: 'previousOutcome', label: 'Previous Outcome', type: 'text' },
      { key: 'awareOfFundingRules', label: 'Aware of Apprenticeship Funding Rules', type: 'boolean' },
    ],
  },
  {
    key: 'personalCircumstances', title: 'Personal Circumstances', icon: 'ri-heart-line',
    fields: [
      { key: 'careLeaver', label: 'Care Leaver', type: 'boolean' },
      { key: 'careLeaverAuthority', label: 'Care Leaver Local Authority', type: 'text' },
      { key: 'careResponsibilities', label: 'Care Responsibilities', type: 'longtext' },
      { key: 'carerDetails', label: 'Carer Details', type: 'longtext' },
      { key: 'lookedAfterChild', label: 'Previously Looked-After Child', type: 'boolean' },
      { key: 'youngCarer', label: 'Young Carer', type: 'boolean' },
      { key: 'offendingHistory', label: 'Offending History', type: 'longtext' },
      { key: 'substanceMisuseHistory', label: 'Substance Misuse History', type: 'longtext' },
      { key: 'mentalHealthHistory', label: 'Mental Health History', type: 'longtext' },
      { key: 'housingSituation', label: 'Housing Situation', type: 'text' },
      { key: 'armedForcesFamily', label: 'Armed Forces Family', type: 'boolean' },
    ],
  },
  {
    key: 'supportNeeds', title: 'Support Needs', icon: 'ri-hand-heart-line',
    fields: [
      { key: 'requiresLearningSupport', label: 'Requires Learning Support', type: 'boolean' },
      { key: 'supportDetails', label: 'Support Details', type: 'longtext' },
      { key: 'requiresAccessArrangements', label: 'Requires Access Arrangements', type: 'boolean' },
      { key: 'accessArrangementDetails', label: 'Access Arrangement Details', type: 'longtext' },
      { key: 'requiresAssistiveTechnology', label: 'Requires Assistive Technology', type: 'boolean' },
      { key: 'assistiveTechDetails', label: 'Assistive Technology Details', type: 'longtext' },
      { key: 'hasEHCP', label: 'Has EHCP', type: 'boolean' },
      { key: 'ehcpDetails', label: 'EHCP Details', type: 'longtext' },
      { key: 'hasSEN', label: 'Has SEN', type: 'boolean' },
      { key: 'senDetails', label: 'SEN Details', type: 'longtext' },
    ],
  },
  {
    key: 'learningSupportScreening', title: 'Learning Support Screening', icon: 'ri-mental-health-line',
    fields: [
      { key: 'dyslexiaScreened', label: 'Dyslexia Screened', type: 'boolean' },
      { key: 'dyslexiaRisk', label: 'Dyslexia Risk Level', type: 'select', options: ['None', 'Low', 'Medium', 'High'] },
      { key: 'dyscalculiaScreened', label: 'Dyscalculia Screened', type: 'boolean' },
      { key: 'dyscalculiaRisk', label: 'Dyscalculia Risk Level', type: 'select', options: ['None', 'Low', 'Medium', 'High'] },
      { key: 'adhdScreened', label: 'ADHD Screened', type: 'boolean' },
      { key: 'adhdRisk', label: 'ADHD Risk Level', type: 'select', options: ['None', 'Low', 'Medium', 'High'] },
      { key: 'asdScreened', label: 'ASD Screened', type: 'boolean' },
      { key: 'asdRisk', label: 'ASD Risk Level', type: 'select', options: ['None', 'Low', 'Medium', 'High'] },
      { key: 'screeningCompletedDate', label: 'Screening Completed Date', type: 'text' },
      { key: 'screeningNotes', label: 'Screening Notes', type: 'longtext' },
    ],
  },
  {
    key: 'englishAndMaths', title: 'English & Maths', icon: 'ri-book-open-line',
    fields: [
      { key: 'englishLevel', label: 'English Level', type: 'text' },
      { key: 'mathsLevel', label: 'Maths Level', type: 'text' },
      { key: 'englishFunctionalSkillsRequired', label: 'English Functional Skills Required', type: 'boolean' },
      { key: 'mathsFunctionalSkillsRequired', label: 'Maths Functional Skills Required', type: 'boolean' },
      { key: 'englishInitialAssessmentScore', label: 'English Initial Assessment Score', type: 'number' },
      { key: 'mathsInitialAssessmentScore', label: 'Maths Initial Assessment Score', type: 'number' },
      { key: 'englishExemption', label: 'English Exemption', type: 'boolean' },
      { key: 'mathsExemption', label: 'Maths Exemption', type: 'boolean' },
      { key: 'englishExemptionEvidence', label: 'English Exemption Evidence', type: 'text' },
      { key: 'mathsExemptionEvidence', label: 'Maths Exemption Evidence', type: 'text' },
    ],
  },
  {
    key: 'programmeUnderstanding', title: 'Programme Understanding', icon: 'ri-lightbulb-line',
    fields: [
      { key: 'understandsProgrammeStructure', label: 'Understands Programme Structure', type: 'boolean' },
      { key: 'understandsOTJHRequirement', label: 'Understands OTJH Requirement', type: 'boolean' },
      { key: 'understandsAssessmentMethods', label: 'Understands Assessment Methods', type: 'boolean' },
      { key: 'understandsEPATimeline', label: 'Understands EPA Timeline', type: 'boolean' },
      { key: 'understandsAttendanceRequirement', label: 'Understands Attendance Requirement', type: 'boolean' },
      { key: 'understandsOffTheJobTraining', label: 'Understands Off-the-Job Training', type: 'boolean' },
      { key: 'questions', label: 'Questions for Provider', type: 'longtext' },
      { key: 'programmeBriefingAttended', label: 'Programme Briefing Attended', type: 'boolean' },
      { key: 'programmeBriefingDate', label: 'Programme Briefing Date', type: 'text' },
    ],
  },
  {
    key: 'priorLearning', title: 'PLR / Prior Learning', icon: 'ri-file-search-line',
    fields: [
      { key: 'hasPriorLearning', label: 'Has Prior Learning', type: 'boolean' },
      { key: 'priorLearningDetails', label: 'Prior Learning Details', type: 'longtext' },
      { key: 'rplApplied', label: 'RPL Applied', type: 'boolean' },
      { key: 'rplReductionMonths', label: 'RPL Reduction (months)', type: 'number' },
      { key: 'rplEvidenceProvided', label: 'RPL Evidence Provided', type: 'boolean' },
      { key: 'rplEvidenceList', label: 'RPL Evidence List', type: 'list' },
      { key: 'plrConsentGiven', label: 'PLR Consent Given', type: 'boolean' },
      { key: 'plrChecked', label: 'PLR Checked', type: 'boolean' },
      { key: 'plrResults', label: 'PLR Results', type: 'longtext' },
    ],
  },
  {
    key: 'cvJobDescription', title: 'CV / Job Description', icon: 'ri-file-text-line',
    fields: [
      { key: 'cvUploaded', label: 'CV Uploaded', type: 'boolean' },
      { key: 'cvFileName', label: 'CV File Name', type: 'text' },
      { key: 'cvUploadDate', label: 'CV Upload Date', type: 'text' },
      { key: 'jobDescriptionUploaded', label: 'Job Description Uploaded', type: 'boolean' },
      { key: 'jobDescriptionFileName', label: 'Job Description File Name', type: 'text' },
      { key: 'jobDescriptionUploadDate', label: 'Job Description Upload Date', type: 'text' },
      { key: 'currentResponsibilities', label: 'Current Responsibilities', type: 'longtext' },
      { key: 'relevantExperience', label: 'Relevant Experience', type: 'longtext' },
    ],
  },
  {
    key: 'declarations', title: 'Declarations', icon: 'ri-checkbox-circle-line',
    fields: [
      { key: 'mediaConsent', label: 'Media Consent', type: 'boolean' },
      { key: 'dataSharingConsent', label: 'Data Sharing Consent', type: 'boolean' },
      { key: 'fundingDeclaration', label: 'Funding Declaration', type: 'boolean' },
      { key: 'accuracyDeclaration', label: 'Accuracy Declaration', type: 'boolean' },
      { key: 'accuracyDate', label: 'Accuracy Declaration Date', type: 'text' },
      { key: 'accuracySignature', label: 'Accuracy Declaration Signature', type: 'text' },
      { key: 'healthAndSafetyDeclaration', label: 'Health & Safety Declaration', type: 'boolean' },
      { key: 'codeOfConductDeclaration', label: 'Code of Conduct Declaration', type: 'boolean' },
      { key: 'attendanceDeclaration', label: 'Attendance Declaration', type: 'boolean' },
      { key: 'learnerSigned', label: 'Learner Signed', type: 'boolean' },
      { key: 'learnerSignedDate', label: 'Learner Signed Date', type: 'text' },
      { key: 'employerSigned', label: 'Employer Signed', type: 'boolean' },
      { key: 'employerSignedDate', label: 'Employer Signed Date', type: 'text' },
      { key: 'providerSigned', label: 'Provider Signed', type: 'boolean' },
      { key: 'providerSignedDate', label: 'Provider Signed Date', type: 'text' },
    ],
  },
  {
    key: 'reviewAndSubmit', title: 'Review & Submit', icon: 'ri-send-plane-line',
    fields: [
      { key: 'reviewed', label: 'Reviewed', type: 'boolean' },
      { key: 'submitted', label: 'Submitted', type: 'boolean' },
      { key: 'submittedDate', label: 'Submitted Date', type: 'text' },
      { key: 'returnedForCorrection', label: 'Returned for Correction', type: 'boolean' },
      { key: 'returnReason', label: 'Return Reason', type: 'longtext' },
      { key: 'returnedDate', label: 'Returned Date', type: 'text' },
      { key: 'correctionCount', label: 'Correction Count', type: 'number' },
    ],
  },
];

export function OnboardingForm({ learner }: OnboardingFormProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(SECTIONS.slice(0, 3).map(s => s.key)));

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const expandAll = () => setExpandedSections(new Set(SECTIONS.map(s => s.key)));
  const collapseAll = () => setExpandedSections(new Set());

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-heading font-semibold text-foreground-900">Onboarding Form — {learner.sectionsComplete} of {learner.totalSections} sections complete</h3>
        <div className="flex items-center gap-2">
          <button onClick={expandAll} className="text-[11px] text-primary-600 hover:text-primary-700 font-medium cursor-pointer whitespace-nowrap">Expand All</button>
          <span className="text-[10px] text-foreground-300">|</span>
          <button onClick={collapseAll} className="text-[11px] text-primary-600 hover:text-primary-700 font-medium cursor-pointer whitespace-nowrap">Collapse All</button>
        </div>
      </div>

      <div className="space-y-3">
        {SECTIONS.map(section => {
          const data = learner[section.key] as Record<string, string | boolean | number | string[]>;
          const isExpanded = expandedSections.has(section.key);
          const filledCount = section.fields.filter(f => {
            const val = data[f.key];
            if (val === undefined || val === null || val === '') return false;
            if (Array.isArray(val)) return val.length > 0;
            if (typeof val === 'number') return !isNaN(val);
            return true;
          }).length;
          const isComplete = filledCount === section.fields.filter(f => {
            const def = section.fields.find(sf => sf.key === f.key);
            return def && !['disabilityDetails', 'carerDetails', 'senDetails', 'ehcpDetails', 'assistiveTechDetails', 'screeningNotes', 'englishExemptionEvidence', 'mathsExemptionEvidence', 'questions', 'alternativePhone', 'previousAddress', 'previousPostcode', 'tradingName', 'visaType', 'visaExpiryDate', 'shareCode', 'careLeaverAuthority', 'rplReductionMonths', 'rplEvidenceList'].includes(f.key);
          }).length;

          return (
            <div
              key={section.key}
              className={`bg-background-50 rounded-xl border transition-smooth ${
                isExpanded ? 'border-primary-200/60 shadow-sm' : 'border-background-200/50 card-premium'
              }`}
            >
              <button
                onClick={() => toggleSection(section.key)}
                className="w-full flex items-center justify-between px-5 py-4 cursor-pointer text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    isComplete ? 'bg-emerald-50 text-emerald-600' : filledCount > 0 ? 'bg-primary-50 text-primary-600' : 'bg-background-100 text-foreground-400'
                  }`}>
                    <AppIcon className={`${section.icon} text-sm`}></AppIcon>
                  </span>
                  <div>
                    <p className="text-[15px] font-heading font-semibold text-foreground-800">{section.title}</p>
                    <p className="text-[11px] text-foreground-400">{section.fields.length} fields &middot; {filledCount} completed</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    isComplete ? 'bg-emerald-50 text-emerald-600' : filledCount > 0 ? 'bg-primary-50 text-primary-600' : 'bg-background-200 text-foreground-400'
                  }`}>
                    {isComplete ? 'Complete' : filledCount > 0 ? 'In Progress' : 'Pending'}
                  </span>
                  <AppIcon className={`text-foreground-300 text-sm ${isExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`}></AppIcon>
                </div>
              </button>

              {isExpanded && (
                <div className="px-5 pb-5 border-t border-background-200/50">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-4">
                    {section.fields.map(field => {
                      const val = data[field.key];
                      return (
                        <div key={field.key} className={`${field.type === 'longtext' || field.type === 'list' ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
                          <p className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium mb-1">{field.label}</p>
                          {renderFieldValue(field, val)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderFieldValue(field: FieldDef, val: string | boolean | number | string[] | undefined) {
  if (val === undefined || val === null || val === '') {
    return <p className="text-[12px] text-foreground-300 italic">— Not provided —</p>;
  }

  if (field.type === 'boolean') {
    const boolVal = val as boolean;
    return (
      <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${boolVal ? 'text-emerald-600' : 'text-red-500'}`}>
        <AppIcon className={`${boolVal ? 'ri-checkbox-circle-fill' : 'ri-close-circle-fill'} text-sm`}></AppIcon>
        {boolVal ? 'Yes' : 'No'}
      </span>
    );
  }

  if (field.type === 'list') {
    const arr = val as string[];
    if (arr.length === 0) return <p className="text-[12px] text-foreground-300 italic">— None listed —</p>;
    return (
      <div className="flex flex-wrap gap-1.5">
        {arr.map((item, i) => (
          <span key={i} className="text-[11px] bg-background-100 text-foreground-600 px-2 py-1 rounded-md">{item}</span>
        ))}
      </div>
    );
  }

  if (field.type === 'number') {
    const num = Number(val);
    if (isNaN(num) || num === 0) return <p className="text-[12px] text-foreground-300 italic">— Not provided —</p>;
    return <p className="text-[13px] text-foreground-700">{num}</p>;
  }

  if (field.type === 'date') {
    const str = String(val);
    if (!str) return <p className="text-[12px] text-foreground-300 italic">— Not provided —</p>;
    try {
      const d = new Date(str);
      return <p className="text-[13px] text-foreground-700">{d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>;
    } catch {
      return <p className="text-[13px] text-foreground-700">{str}</p>;
    }
  }

  const str = String(val);
  if (field.type === 'longtext') {
    return <p className="text-[13px] text-foreground-600 leading-relaxed">{str}</p>;
  }

  return <p className="text-[13px] text-foreground-700">{str}</p>;
}