import type { EmployerContractingRecord } from '@/mocks/employer-contracting';
import { EMPLOYER_TYPES, FUNDING_ROUTES } from '@/mocks/employer-contracting';

interface ContractingFormProps {
  record: EmployerContractingRecord;
}

export function ContractingForm({ record }: ContractingFormProps) {
  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
      <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-1">Employer Details</h3>
      <p className="text-[11px] text-foreground-400 mb-5">Complete employer information for contracting and workplace validation</p>

      <form className="space-y-5">
        {/* Section: Employer Information */}
        <Section title="Employer Information" icon="ri-building-2-line">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Employer Legal Name" value={record.employerLegalName} icon="ri-building-line" />
            <FormField label="Trading Name" value={record.employerTradingName} icon="ri-store-line" />
            <FormField label="Employer Type" value={record.employerType} icon="ri-government-line" type="select" options={EMPLOYER_TYPES} />
            <FormField label="Company Number (if applicable)" value={record.companyNumber || ''} icon="ri-hashtag" placeholder="e.g. 12345678" />
          </div>
        </Section>

        {/* Section: Addresses */}
        <Section title="Addresses" icon="ri-map-pin-line">
          <div className="grid grid-cols-1 gap-3">
            <FormField label="UK Address" value={record.ukAddress} icon="ri-map-pin-2-line" type="textarea" />
            <FormField label="Workplace Address" value={record.workplaceAddress} icon="ri-building-line" type="textarea" />
            <div className="flex items-center gap-3">
              <span className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${record.workplaceInEngland ? 'bg-emerald-50 text-emerald-600' : 'bg-background-100 text-foreground-300'}`}>
                <AppIcon className={`${record.workplaceInEngland ? 'ri-check-line' : 'ri-close-line'} text-xs`}></AppIcon>
              </span>
              <span className={`text-[13px] ${record.workplaceInEngland ? 'text-emerald-700 font-medium' : 'text-foreground-400'}`}>
                Workplace in England confirmed
              </span>
            </div>
          </div>
        </Section>

        {/* Section: Contacts */}
        <Section title="Contacts & Signatory" icon="ri-contacts-line">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Employer Contact Name" value={record.employerContactName} icon="ri-user-line" />
            <FormField label="Contact Email" value={record.employerContactEmail} icon="ri-mail-line" type="email" />
            <FormField label="Contact Phone" value={record.employerContactPhone} icon="ri-phone-line" />
            <div></div>
            <FormField label="Employer Signatory Name" value={record.employerSignatoryName} icon="ri-user-star-line" />
            <FormField label="Signatory Email" value={record.employerSignatoryEmail} icon="ri-mail-line" type="email" />
          </div>
        </Section>

        {/* Section: Line Manager */}
        <Section title="Line Manager" icon="ri-user-settings-line">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FormField label="Line Manager Name" value={record.lineManagerName} icon="ri-user-line" />
            <FormField label="Email" value={record.lineManagerEmail} icon="ri-mail-line" type="email" />
            <FormField label="Phone" value={record.lineManagerPhone} icon="ri-phone-line" />
          </div>
        </Section>

        {/* Section: Learner Employment */}
        <Section title="Learner Employment Details" icon="ri-briefcase-line">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FormField label="Job Title" value={record.learnerJobTitle} icon="ri-briefcase-line" />
            <FormField label="Employment Status" value={record.employmentStatus} icon="ri-user-line" type="select" options={['Full-time Employee', 'Part-time Employee', 'Fixed-term Contract', 'Apprentice (New Hire)', 'Existing Staff']} />
            <FormField label="Contract Type" value={record.contractType} icon="ri-file-text-line" type="select" options={['Permanent', 'Fixed-term (apprenticeship)', 'Fixed-term (other)']} />
            <FormField label="Working Hours (per week)" value={record.workingHours > 0 ? String(record.workingHours) : ''} icon="ri-time-line" placeholder="e.g. 37" />
            <FormField label="Normal Working Pattern" value={record.normalWorkingPattern} icon="ri-calendar-line" placeholder="e.g. Mon-Fri 9-5" />
          </div>
        </Section>

        {/* Section: Funding & DAS */}
        <Section title="Funding & DAS" icon="ri-money-pound-circle-line">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center gap-3">
              <span className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${record.payeConfirmed ? 'bg-emerald-50 text-emerald-600' : 'bg-background-100 text-foreground-300'}`}>
                <AppIcon className={`${record.payeConfirmed ? 'ri-check-line' : 'ri-close-line'} text-xs`}></AppIcon>
              </span>
              <span className={`text-[13px] ${record.payeConfirmed ? 'text-emerald-700 font-medium' : 'text-foreground-400'}`}>
                PAYE Confirmed
              </span>
            </div>
            <FormField label="DAS Account Status" value={record.dasAccountStatus} icon="ri-database-2-line" type="select" options={['Active', 'Pending Setup', 'Unknown', 'Not Applicable']} />
            <div className="flex items-center gap-3">
              <span className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${record.providerAddedToDas ? 'bg-emerald-50 text-emerald-600' : 'bg-background-100 text-foreground-300'}`}>
                <AppIcon className={`${record.providerAddedToDas ? 'ri-check-line' : 'ri-close-line'} text-xs`}></AppIcon>
              </span>
              <span className={`text-[13px] ${record.providerAddedToDas ? 'text-emerald-700 font-medium' : 'text-foreground-400'}`}>
                Provider Added to DAS
              </span>
            </div>
            <FormField label="Funding Route" value={record.fundingRoute} icon="ri-funds-line" type="select" options={FUNDING_ROUTES} />
            <FormField label="Levy Status" value={record.levyStatus} icon="ri-building-4-line" type="select" options={['Levy-paying employer', 'Non-levy employer', 'Levy transfer receiver', 'Levy transfer sender']} />
            {record.coInvestmentRequired && (
              <FormField label="Co-investment Amount" value={record.coInvestmentAmount ? '£' + record.coInvestmentAmount.toLocaleString() : ''} icon="ri-money-pound-circle-line" />
            )}
            {!record.coInvestmentRequired && record.fundingRoute && (
              <div className="flex items-center gap-3">
                <span className="w-5 h-5 rounded flex items-center justify-center shrink-0 bg-background-100 text-foreground-300">
                  <AppIcon className="ri-close-line text-xs"></AppIcon>
                </span>
                <span className="text-[13px] text-foreground-400">No co-investment required</span>
              </div>
            )}
          </div>
        </Section>

        {/* Section: Commitments */}
        <Section title="Declarations & Commitments" icon="ri-check-double-line">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <CommitmentCheck label="Employer Commitment Statement Signed" done={record.employerCommitmentSigned} />
            <CommitmentCheck label="Contract for Services Signed" done={record.contractForServicesSigned} />
            <CommitmentCheck label="Workplace Validation Completed" done={record.workplaceValidationCompleted} />
            <CommitmentCheck label="Employer Declaration Signed" done={record.employerDeclarationSigned} />
            <CommitmentCheck label="Health & Safety Confirmation" done={record.healthAndSafetyConfirmed} />
            <CommitmentCheck label="Employer Support Confirmation" done={record.employerSupportConfirmed} />
            <CommitmentCheck label="OTJH Paid Working Hours Confirmed" done={record.otjhPaidHoursConfirmed} />
            <CommitmentCheck label="Progress Review Commitment" done={record.progressReviewCommitmentConfirmed} />
            <CommitmentCheck label="Data Sharing & Communication Consent" done={record.dataSharingConfirmed} />
          </div>
        </Section>

        {/* Notes */}
        <Section title="Case Notes" icon="ri-sticky-note-line">
          <FormField label="Internal Notes" value={record.notes} icon="ri-chat-1-line" type="textarea" />
        </Section>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button type="button" className="px-5 py-2.5 bg-primary-500 text-white text-[13px] font-medium rounded-lg hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
            Save Changes
          </button>
          <button type="button" className="px-5 py-2.5 bg-background-100 text-foreground-600 text-[13px] font-medium rounded-lg hover:bg-background-200/60 transition-smooth cursor-pointer whitespace-nowrap">
            Reset
          </button>
          <button type="button" className="ml-auto px-4 py-2.5 text-[12px] text-red-600 hover:bg-red-50 rounded-lg transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-delete-bin-line mr-1.5"></AppIcon>Delete Record
          </button>
        </div>
      </form>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <fieldset className="border border-foreground-200/60 rounded-lg p-4">
      <legend className="flex items-center gap-2 px-2 text-[12px] font-semibold text-foreground-600 font-heading">
        <AppIcon className={`${icon} text-foreground-400`}></AppIcon>
        {title}
      </legend>
      <div className="mt-1">
        {children}
      </div>
    </fieldset>
  );
}

function FormField({ label, value, icon, type, options, placeholder }: {
  label: string; value: string; icon: string; type?: string; options?: string[]; placeholder?: string;
}) {
  return (
    <div className="min-w-0">
      <label className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium block mb-1">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 pointer-events-none">
          <AppIcon className={`${icon} text-[13px]`}></AppIcon>
        </span>
        {type === 'select' && options ? (
          <select
            className="w-full pl-9 pr-8 py-2 text-[13px] text-foreground-700 bg-background-50 border border-foreground-200 rounded-lg appearance-none focus:outline-none focus:border-primary-300/60 focus:ring-1 focus:ring-primary-200/40 transition-smooth cursor-pointer"
            defaultValue={value}
          >
            {value && <option value={value}>{value}</option>}
            {options.filter(o => o !== value).map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        ) : type === 'textarea' ? (
          <textarea
            className="w-full pl-9 pr-3 py-2 text-[13px] text-foreground-700 bg-background-50 border border-foreground-200 rounded-lg resize-none focus:outline-none focus:border-primary-300/60 focus:ring-1 focus:ring-primary-200/40 transition-smooth"
            rows={2}
            defaultValue={value}
            readOnly
          ></textarea>
        ) : (
          <input
            type={type || 'text'}
            className="w-full pl-9 pr-3 py-2 text-[13px] text-foreground-700 bg-background-50 border border-foreground-200 rounded-lg focus:outline-none focus:border-primary-300/60 focus:ring-1 focus:ring-primary-200/40 transition-smooth"
            defaultValue={value}
            placeholder={placeholder}
            readOnly
          />
        )}
        {type === 'select' && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-300 pointer-events-none">
            <AppIcon className="ri-arrow-down-s-line text-xs"></AppIcon>
          </span>
        )}
      </div>
    </div>
  );
}

function CommitmentCheck({ label, done }: { label: string; done: boolean }) {
  return (
    <label className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-smooth ${
      done ? 'bg-emerald-50/50 border-emerald-200/50' : 'bg-background-50 border-foreground-200/60 hover:border-background-300/60'
    }`}>
      <input type="checkbox" defaultChecked={done} className="w-4 h-4 rounded border-background-300 text-emerald-500 focus:ring-emerald-400/30 cursor-pointer" />
      <span className={`text-[13px] ${done ? 'text-emerald-800 font-medium' : 'text-foreground-600'}`}>{label}</span>
    </label>
  );
}